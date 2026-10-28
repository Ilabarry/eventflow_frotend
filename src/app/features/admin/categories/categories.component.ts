import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { CategoryAdminService } from '../../../core/services/category-admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CategoryRowComponent, ICON_GLYPHS } from './category-row.component';
import {
  CATEGORY_ICON_MAX,
  CATEGORY_MAX_PAGE_SIZE,
  CATEGORY_NAME_MAX,
  CATEGORY_REASON_MAX,
  CATEGORY_REASON_MIN,
  CategoryFieldErrors,
  CategoryWritePayload,
  SupervisionCategoryDto,
  SupervisionCategoryList,
} from '../../../core/models/supervision-category.model';

/* ------------------------------------------------------------------
 * Constantes et types de presentation
 * ------------------------------------------------------------------ */
type LoadState = 'loading' | 'ready' | 'error';
type StatusFilter = 'all' | 'active' | 'inactive';
type SortField = 'name' | 'events_total' | 'created_at';
type SortDir = 'asc' | 'desc';

/** null = le parametre n'est pas envoye : le back n'a pas de valeur « les deux ». */
const IS_ACTIVE_PARAM: Record<StatusFilter, boolean | null> = { all: null, active: true, inactive: false };

/** Format commun aux compteurs (les cellules elles-memes vivent dans `CategoryRowComponent`). */
const NUMBER = new Intl.NumberFormat('fr-FR');

/** Les bornes du backend, exposees au template (pas de nombre en dur dans le HTML). */
const LIMITS = {
  name: CATEGORY_NAME_MAX,
  icon: CATEGORY_ICON_MAX,
  description: 2000,
  reasonMin: CATEGORY_REASON_MIN,
  reason: CATEGORY_REASON_MAX,
};

interface SortState {
  field: SortField;
  dir: SortDir;
}

interface ModalState {
  mode: 'create' | 'edit';
  id: string | null;
  name: string;
  description: string;
  icon: string;
  slug: string;
  isActive: boolean;
}

interface ReasonState {
  action: 'activate' | 'deactivate' | 'delete';
  id: string;
  name: string;
  eventsTotal: number;
  reason: string;
  error: string | null;
}

interface StatsState {
  total: number;
  active: number;
  events: number;
  loading: boolean;
  failed: boolean;
}

/**
 * Traduit l'enveloppe `{ success: false, errors: { champ: [...] } }` du backend
 * en erreurs de champ affichables. `non_field_errors` est ramene sur `detail`
 * (`NON_FIELD_ERRORS_KEY` cote supervision).
 */
function fieldErrorsOf(error: unknown): CategoryFieldErrors {
  const errors = (error as { error?: { errors?: Record<string, string[] | string> } })?.error?.errors;
  if (!errors || typeof errors !== 'object') {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(errors)) {
    const key = field === 'non_field_errors' ? 'detail' : field;
    out[key] = Array.isArray(value) ? value : [String(value)];
  }
  return out as CategoryFieldErrors;
}

function messageOf(error: unknown, fallback: string): string {
  return (error as { error?: { message?: string } })?.error?.message || fallback;
}

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCategoriesComponent implements OnInit {
  /** Render `true` : sans banniere (la page est embarquee dans un autre ecran). */
  readonly dense = input(false);

  private readonly service = inject(CategoryAdminService);
  private readonly notifier = inject(NotificationService);

  private readonly searchTrigger = new SearchTrigger();

  readonly limits = LIMITS;
  /** 6 lignes de squelette : la hauteur du bloc ne bouge pas au 1er rendu. */
  readonly skeletonRows = [1, 2, 3, 4, 5, 6];
  /** Seules ces trois valeurs existent côté `SupervisionCategoryFilter`. */
  readonly statusOptions: readonly { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'active', label: 'Actifs' },
    { value: 'inactive', label: 'Inactifs' },
  ];
  /** 50 = `StandardPagination.max_page_size` : proposer plus serait ramene a 50. */
  readonly pageSizeOptions: readonly number[] = [5, 12, 24, 50];

  /* ------------------- etat de liste ------------------- */
  readonly loadState = signal<LoadState>('loading');
  readonly list = signal<SupervisionCategoryList | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly search = signal('');
  readonly status = signal<StatusFilter>('all');
  readonly sort = signal<SortState>({ field: 'created_at', dir: 'desc' });
  readonly page = signal(1);
  readonly pageSize = signal(12);
  /** Incrementee pour relancer volontairement le chargement. */
  private readonly reloadToken = signal(0);
  /** Identifiant de la derniere requete partie : la plus vieille reponse est jetee. */
  private requestId = 0;

  /* ------------------- etat d'action ------------------- */
  readonly busyId = signal<string | null>(null);
  readonly menuOpenFor = signal<string | null>(null);
  readonly modal = signal<ModalState | null>(null);
  readonly modalSaving = signal(false);
  readonly modalErrors = signal<CategoryFieldErrors>({});
  readonly reason = signal<ReasonState | null>(null);
  readonly reasonSaving = signal(false);
  readonly stats = signal<StatsState>({ total: 0, active: 0, events: 0, loading: true, failed: false });

  private readonly tableHost = viewChild<ElementRef<HTMLElement>>('tableHost');
  private readonly firstField = viewChild<ElementRef<HTMLInputElement>>('firstField');
  private readonly reasonField = viewChild<ElementRef<HTMLInputElement>>('reasonField');

  /* ------------------- derives ------------------- */
  readonly rows = computed(() => this.list()?.results ?? []);
  readonly total = computed(() => this.list()?.count ?? 0);
  readonly totalPages = computed(() => Math.max(1, this.list()?.total_pages ?? 1));
  readonly currentPage = computed(() => this.list()?.current_page ?? this.page());
  readonly isEmpty = computed(() => this.loadState() === 'ready' && this.rows().length === 0);
  readonly isFiltered = computed(() => this.search().trim() !== '' || this.status() !== 'all');
  readonly rangeLabel = computed(() => {
    const size = this.list()?.page_size ?? this.pageSize();
    const count = this.total();
    if (count === 0) {
      return 'aucune categorie';
    }
    const start = (this.currentPage() - 1) * size + 1;
    const end = Math.min(count, start + size - 1);
    return `${start}\u2009–\u2009${end} sur ${count}`;
  });
  /** Le tableau HTML est une region roulable : elle doit etre nommee. */
  readonly tableLabel = computed(() =>
    this.list() ? `Catégories — ${this.rangeLabel()}` : 'Chargement des catégories',
  );
  readonly canPrev = computed(() => this.currentPage() > 1);
  readonly canNext = computed(() => this.currentPage() < this.totalPages());

  /** Fenetre de pagination : 1 … n-1 n n+1 … last, avec de vrais points de suspension. */
  readonly pages = computed<(number | '…')[]>(() => {
    const last = this.totalPages();
    const current = this.currentPage();
    if (last <= 7) {
      return Array.from({ length: last }, (_, index) => index + 1);
    }
    const picked = new Set<number>([1, last, current, current - 1, current + 1]);
    if (current <= 3) {
      [2, 3, 4].forEach((n) => picked.add(n));
    }
    if (current >= last - 2) {
      [last - 3, last - 2, last - 1].forEach((n) => picked.add(n));
    }
    const sorted = [...picked].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    sorted.forEach((n, index) => {
      if (index > 0 && n - sorted[index - 1] > 1) {
        out.push('…');
      }
      out.push(n);
    });
    return out;
  });

  readonly orderingParam = computed(() => `${this.sort().dir === 'desc' ? '-' : ''}${this.sort().field}`);

  /**
   * Les compteurs de la maquette (total / actifs / evenements) viennent d'une
   * portee globale, pas de la page affichee : voir `loadStats()`.
   */
  readonly statCards = computed<
    { label: string; value: string; tone: string; icon: string[]; hint?: string; muted?: boolean }[]
  >(() => {
    const stats = this.stats();
    const dash = '\u2014';
    const value = (n: number) => (stats.loading ? dash : stats.failed ? dash : this.format(n));
    const ratio =
      !stats.loading && !stats.failed && stats.total > 0
        ? `${Math.round((stats.active / stats.total) * 100)}\u2009% du catalogue`
        : undefined;
    return [
      {
        label: 'Catégories',
        value: value(stats.total),
        tone: 'green',
        hint: stats.failed ? 'indisponible' : 'toutes, actives et inactives',
        icon: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
      },
      {
        label: 'Actives',
        value: value(stats.active),
        tone: 'violet',
        hint: ratio,
        icon: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
      },
      {
        label: 'Événements',
        value: value(stats.events),
        tone: 'green',
        hint: stats.failed ? 'indisponible' : 'tous statuts, brouillons inclus',
        icon: ['M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
      },
    ];
  });

  /** Le bouton « Effacer » n'a de sens que si un filtre est actif. */
  readonly canClear = computed(() => this.isFiltered());

  /** Formulaire : on ne laisse fermer que si rien n'a ete tape. */
  readonly modalDirty = computed(() => {
    const model = this.modal();
    const origin = this.origin;
    return !!model && !!origin && (model.name !== origin.name || model.description !== origin.description || model.icon !== origin.icon);
  });
  private origin: Pick<ModalState, 'name' | 'description' | 'icon'> | null = null;

  /**
   * Un seul chemin de chargement : cet effet relit les signaux de filtre a chaque
   * changement. Volontairement, il n'ECRIT aucun de ces signaux — un `page.set()`
   * ici meme ferait boucler l'effet (changement -> rechargement -> changement).
   * Si le backend corrige une page hors limites, on affiche `current_page` sans
   * jamais re-ecrire l'etat.
   */
  constructor() {
    effect(
      () => {
        const filters = {
          page: this.page(),
          pageSize: this.pageSize(),
          search: this.search().trim(),
          status: this.status(),
          ordering: this.orderingParam(),
          token: this.reloadToken(),
        };
        this.loadList(filters);
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    void this.loadStats();
  }

  /* ------------------------------------------------------------------
     Filtres
     ------------------------------------------------------------------ */
  /** L'input est en `ngModel` (deux-voies) ; on retarde seulement la requete. */
  onSearchChange(value: string): void {
    // La page revient a 1 immediatement : sinon un « page 7 » filtre une recherche
    // qui n'a que 2 resultats et l'admin voit un etat vide.
    this.page.set(1);
    this.searchDebounced(value);
  }

  private searchDebounced(value: string): void {
    this.searchTrigger.push(value, (debounced) => {
      if (debounced === this.search()) {
        return;
      }
      this.search.set(debounced);
    });
  }

  clearSearch(): void {
    this.searchTrigger.reset();
    if (this.search() !== '' || this.page() !== 1) {
      this.search.set('');
      this.page.set(1);
    }
  }

  /**
   * Après une création, on écarte ce qui pourrait masquer la nouvelle ligne :
   * une recherche encore saisie ou un filtre d'état. Sans ça, l'administrateur
   * voit un toast « créée » suivi d'une liste qui ne l'affiche pas — le pire
   * des signaux. Le tri choisi, lui, est respecté.
   */
  private revealCreatedRow(): void {
    if (this.search() !== '') {
      this.search.set('');
    }
    if (this.status() !== 'all') {
      this.status.set('all');
    }
    this.page.set(1);
  }

  clearFilters(): void {
    this.clearSearch();
    this.setStatus('all');
    this.sort.set({ field: 'created_at', dir: 'desc' });
    this.page.set(1);
  }

  setStatus(value: StatusFilter): void {
    if (this.status() !== value) {
      this.status.set(value);
      this.page.set(1);
    }
  }

  toggleSort(field: SortField): void {
    const current = this.sort();
    if (current.field !== field) {
      // Sens « naturel » par colonne : A→Z pour le nom, decroissant pour les
      // compteurs et les dates (le plus recent / le plus fourni d'abord).
      this.sort.set({ field, dir: field === 'name' ? 'asc' : 'desc' });
    } else {
      this.sort.update((state) => ({ ...state, dir: state.dir === 'asc' ? 'desc' : 'asc' }));
    }
    this.page.set(1);
  }

  /** Libelle d'etat de tri, pour l'info-bulle et le lecteur d'ecran. */
  sortLabel(field: SortField): string {
    switch (this.sortState(field)) {
      case 'asc':
        return 'croissant';
      case 'desc':
        return 'decroissant';
      default:
        return 'non trie';
    }
  }

  sortState(field: string): 'none' | 'asc' | 'desc' {
    const current = this.sort();
    return current.field === field ? current.dir : 'none';
  }

  /** Apercu du champ `icon` dans la modale : glyphe connu, sinon l'entree brute. */
  iconPreview(value: string): string {
    const raw = value.trim().toLowerCase();
    return ICON_GLYPHS[raw] ?? (raw.charAt(0) || '?').toUpperCase();
  }

  hasError(field: string): boolean {
    return (this.modalErrors() as Record<string, string[]>)[field]?.length > 0;
  }

  errorText(field: string): string {
    return ((this.modalErrors() as Record<string, string[]>)[field] ?? []).join(' ');
  }

  goPage(next: number): void {
    const clamped = Math.min(Math.max(1, next), this.totalPages());
    if (clamped !== this.page()) {
      this.page.set(clamped);
      this.tableHost()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  setPageSize(size: number): void {
    const next = Math.min(Math.max(5, size), CATEGORY_MAX_PAGE_SIZE);
    if (next !== this.pageSize()) {
      this.pageSize.set(next);
      this.page.set(1);
    }
  }

  /** Recharge la liste et les compteurs (les deux ont des sources differentes). */
  reload(): void {
    this.reloadToken.update((value) => value + 1);
    void this.loadStats();
  }

  retry(): void {
    this.loadState.set('loading');
    this.reload();
  }

  /* ------------------------------------------------------------------
     Chargement
     ------------------------------------------------------------------ */
  private loadList(filters: {
    page: number;
    pageSize: number;
    search: string;
    status: StatusFilter;
    ordering: string;
    token: number;
  }): void {
    const id = ++this.requestId;
    this.loadState.set('loading');
    this.service
      .listPage({
        page: filters.page,
        pageSize: filters.pageSize,
        search: filters.search || null,
        isActive: IS_ACTIVE_PARAM[filters.status],
        ordering: filters.ordering,
      })
      .subscribe({
        next: (response) => {
          if (id !== this.requestId) {
            return; // une frappe plus recente a déjà gagné
          }
          const data = response.data;
          if (!data) {
            this.errorMessage.set(response.message || 'Réponse inattendue du serveur.');
            this.loadState.set('error');
            return;
          }
          this.list.set(data);
          this.errorMessage.set(null);
          this.loadState.set('ready');
        },
        error: (error) => {
          if (id !== this.requestId) {
            return;
          }
          this.errorMessage.set(messageOf(error, 'Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.'));
          this.loadState.set('error');
        },
      });
  }

  /**
   * Les trois cartes du haut ne peuvent pas etre calculees sur la page
   * affichee : « 12 categories / 12 actives / 342 evenements » est une vue
   * d'ensemble, alors que le tableau est filtre. On les demande donc sur une
   * portee separate, en pages entieres de 50 (le plafond du back), en s'arretant
   * des qu'un seul appel a suffit — le cas reel d'EVENTFLOW.
   */
  private async loadStats(): Promise<void> {
    this.stats.update((state) => ({ ...state, loading: true }));
    const seen: SupervisionCategoryDto[] = [];
    try {
      let totalPages = 1;
      let count = 0;
      for (let cursor = 1; cursor <= 4 && cursor <= totalPages; cursor += 1) {
        const response = await firstValueFrom(
          this.service.listPage({ page: cursor, pageSize: CATEGORY_MAX_PAGE_SIZE }),
        );
        const data = response.data;
        if (!data) {
          break;
        }
        count = data.count;
        totalPages = Math.min(data.total_pages || 1, 4);
        seen.push(...data.results);
      }
      this.stats.set({
        total: count,
        active: seen.filter((row) => row.is_active).length,
        events: seen.reduce((sum, row) => sum + (row.events_total ?? 0), 0),
        loading: false,
        failed: false,
      });
    } catch {
      // Les compteurs ne doivent jamais transformer une page utile en page
      // cassée : on masque les valeurs, la liste reste exploitable.
      this.stats.update((state) => ({
        ...state,
        loading: false,
        failed: true,
        total: state.total || 0,
      }));
    }
  }

  /* ------------------------------------------------------------------
     Formulaire creer / modifier
     ------------------------------------------------------------------ */
  openCreate(): void {
    this.origin = { name: '', description: '', icon: '' };
    this.modalErrors.set({});
    this.modal.set({ mode: 'create', id: null, name: '', description: '', icon: '', slug: '', isActive: true });
    this.focusLater(this.firstField);
  }

  openEdit(row: SupervisionCategoryDto): void {
    this.menuOpenFor.set(null);
    this.origin = { name: row.name, description: row.description ?? '', icon: row.icon ?? '' };
    this.modalErrors.set({});
    this.modal.set({
      mode: 'edit',
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      icon: row.icon ?? '',
      slug: row.slug,
      isActive: row.is_active,
    });
    this.focusLater(this.firstField);
  }

  updateModal(patch: Partial<ModalState>): void {
    this.modal.update((model) => (model ? { ...model, ...patch } : model));
  }

  closeModal(): boolean {
    if (this.modalSaving()) {
      return false; // une écriture en cours ne s'interrompt pas
    }
    if (this.modalDirty() && !window.confirm('Vos modifications seront perdues. Fermer quand même ?')) {
      return false;
    }
    this.modal.set(null);
    this.modalErrors.set({});
    return true;
  }

  saveModal(): void {
    const model = this.modal();
    if (!model || this.modalSaving()) {
      return;
    }
    const name = model.name.trim();
    const errors: CategoryFieldErrors = {};
    if (name.length < 2) {
      errors['name'] = ['Le nom doit contenir au moins 2 caractères.'];
    } else if (name.length > CATEGORY_NAME_MAX) {
      errors['name'] = [`Le nom ne peut pas dépasser ${CATEGORY_NAME_MAX} caractères.`];
    }
    if (model.icon.trim().length > CATEGORY_ICON_MAX) {
      errors['icon'] = [`L'icône ne peut pas dépasser ${CATEGORY_ICON_MAX} caractères.`];
    }
    if (Object.keys(errors).length > 0) {
      this.modalErrors.set(errors);
      return;
    }

    const payload: CategoryWritePayload = {
      name,
      description: model.description.trim(),
      icon: model.icon.trim(),
    };
    const isCreate = model.mode === 'create';
    this.modalSaving.set(true);
    // Deux souscriptions separees (et non un ternaire sur l'Observable) : le type
    // resultant d'`Observable<A> | Observable<B>` rend `subscribe({next, error})`
    // non surchargeable, et le compilateur perd l'inference sur les callbacks.
    const onOk = (message?: string) => {
      this.modalSaving.set(false);
      this.modal.set(null);
      this.notifier.success(message || (isCreate ? 'Catégorie créée.' : 'Catégorie modifiée.'), isCreate ? 'Création' : 'Enregistrement');
      if (isCreate) {
        this.revealCreatedRow();
      }
      this.reload();
    };
    const onKo = (error: unknown) => {
      this.modalSaving.set(false);
      // 400 : on garde la fenetre ouverte et on colle le message du backend sous le
      // champ concerne — c'est lui qui connait la regle (nom unique ; nom « trop
      // proche » -> 409 ; slug en conflit).
      this.modalErrors.set(fieldErrorsOf(error));
    };

    if (isCreate) {
      this.service.create(payload).subscribe({
        next: (response) => onOk(response.message),
        error: onKo,
      });
    } else {
      this.service.update(model.id as string, payload).subscribe({
        next: (response) => onOk(response.message),
        error: onKo,
      });
    }
  }

  /* ------------------------------------------------------------------
     Actions d'etat et suppression
     ------------------------------------------------------------------ */
  openReason(row: SupervisionCategoryDto, action: ReasonState['action']): void {
    this.menuOpenFor.set(null);
    this.reason.set({
      action,
      id: row.id,
      name: row.name,
      eventsTotal: row.events_total ?? 0,
      reason: '',
      error: null,
    });
    if (action !== 'delete') {
      this.focusLater(this.reasonField);
    }
  }

  closeReason(): void {
    if (!this.reasonSaving()) {
      this.reason.set(null);
    }
  }

  updateReason(value: string): void {
    this.reason.update((state) => (state ? { ...state, reason: value, error: null } : state));
  }

  confirmReason(): void {
    const state = this.reason();
    if (!state || this.reasonSaving()) {
      return;
    }
    const reason = state.reason.trim();
    if (state.action !== 'delete' && reason.length < CATEGORY_REASON_MIN) {
      this.reason.update((current) =>
        current
          ? { ...current, error: `La raison est obligatoire (${CATEGORY_REASON_MIN} caractères minimum).` }
          : current,
      );
      return;
    }

    this.reasonSaving.set(true);
    this.busyId.set(state.id);

    const onOk = (message?: string) => {
      this.reasonSaving.set(false);
      this.busyId.set(null);
      this.reason.set(null);
      this.notifier.success(message || this.successLabel(state.action), this.titleLabel(state.action));
      this.reload();
    };

    // Un refus de suppression d'une categorie utilisee (409) n'est pas une
    // impasse : le contrat du back prevoit la desactivation a la place, on
    // rebascule donc la meme fenetre sur cette action, motif a l'appui.
    const onKo = (error: unknown) => {
      this.reasonSaving.set(false);
      this.busyId.set(null);
      const status = (error as { status?: number })?.status;
      if (status === 409 && state.action === 'delete') {
        this.reason.update((current) =>
          current
            ? {
                ...current,
                action: 'deactivate',
                error:
                  'Cette catégorie est utilisée par au moins un événement : elle ne peut pas être supprimée, mais vous pouvez la désactiver.',
              }
            : current,
        );
        return;
      }
      this.reason.update((current) =>
        current ? { ...current, error: messageOf(error, "L'action a été refusée par le serveur.") } : current,
      );
    };

    if (state.action === 'delete') {
      this.service.remove(state.id).subscribe({
        next: (response) => onOk(response.message),
        error: onKo,
      });
    } else {
      this.service.setActive(state.id, state.action === 'activate', reason).subscribe({
        next: (response) => onOk(response.message),
        error: onKo,
      });
    }
  }

  private successLabel(action: ReasonState['action']): string {
    if (action === 'delete') {
      return 'Catégorie supprimée.';
    }
    return action === 'activate' ? 'Catégorie réactivée.' : 'Catégorie désactivée.';
  }

  private titleLabel(action: ReasonState['action']): string {
    return action === 'delete' ? 'Suppression' : 'État de la catégorie';
  }

  reasonTitle(action: ReasonState['action']): string {
    return action === 'delete'
      ? 'Supprimer la catégorie'
      : action === 'activate'
        ? 'Réactiver la catégorie'
        : 'Désactiver la catégorie';
  }

  /* ------------------------------------------------------------------
     Menu par ligne + raccourcis clavier
     ------------------------------------------------------------------ */
  toggleMenu(id: string): void {
    this.menuOpenFor.update((open) => (open === id ? null : id));
  }

  closeMenu(): void {
    if (this.menuOpenFor()) {
      this.menuOpenFor.set(null);
    }
  }

  /** Le menu se ferme au clic ailleurs : on teste l'ancre data-* plutôt qu'un ViewChild par ligne. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpenFor()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-menu-root]')) {
      this.closeMenu();
    }
  }

  /** Echap ferme le plus prioritaire des calques ouverts. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.reason()) {
      this.closeReason();
      return;
    }
    if (this.modal()) {
      this.closeModal();
      return;
    }
    this.closeMenu();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.closeMenu();
  }

  /* ------------------------------------------------------------------
     Rendu des lignes
     ------------------------------------------------------------------ */
  format(value: number | null | undefined): string {
    return NUMBER.format(value ?? 0);
  }

  private focusLater(field: () => ElementRef<HTMLInputElement> | undefined): void {
    queueMicrotask(() => field()?.nativeElement.focus());
  }
}

/**
 * Debounce de recherche maison (350 ms) : le composant est en OnPush et l'etat
 * vit dans des signaux, un `Subject` + `debounceTime` oblige a gérer
 * manuellement la souscription. Cet objet garde le meme contrat — la derniere
 * frappe gagne, une frape « égale à la requete en cours » ne relance rien — sans
 * cycle de vie a surveiller.
 */
class SearchTrigger {
  private timer: ReturnType<typeof setTimeout> | null = null;

  push(value: string, emit: (value: string) => void): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      emit(value);
    }, 350);
  }

  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
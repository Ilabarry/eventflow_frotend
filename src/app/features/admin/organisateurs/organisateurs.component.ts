import { ViewportScroller } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, finalize, map, of, switchMap } from 'rxjs';

import {
  AdminEventStatus,
  AdminOrganizerDto,
  AdminOrganizerEvent,
  AdminOrganizerFilters,
  AdminOrganizerList,
  AdminOrganizerStats,
  OrganizerAction,
  OrganizerActionPayload,
  OrganizerActivity,
  OrganizerStatus,
} from '../../../core/models/admin.model';
import { AdminApiService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';

/* ------------------------------------------------------------------
 * Constantes
 * ------------------------------------------------------------------ */
const SEARCH_DEBOUNCE_MS = 400;
const MAX_VISIBLE_PAGES = 5;
const DEFAULT_PAGE_SIZE = 10;
const TEXT_MAX = 100;

type LoadState = 'loading' | 'ready' | 'error';
type SortKey = 'name' | 'events' | 'registrations' | 'upcoming' | 'status' | 'joined';
type SortDir = 'asc' | 'desc';
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type QuickFilter = 'all' | 'active' | 'with' | 'without' | 'pending' | 'suspended';

/** Champs de tri attendus par l'API. */
const SORT_FIELDS: Record<SortKey, string> = {
  name: 'full_name',
  events: 'events_count',
  registrations: 'registrations_count',
  upcoming: 'upcoming_count',
  status: 'status',
  joined: 'created_at',
};

const STATUS_META: Record<OrganizerStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Actif', tone: 'success' },
  PENDING: { label: 'En attente', tone: 'warning' },
  SUSPENDED: { label: 'Suspendu', tone: 'danger' },
};

const EVENT_STATUS_META: Record<AdminEventStatus, { label: string; tone: BadgeTone }> = {
  PUBLISHED: { label: 'Publié', tone: 'success' },
  PENDING: { label: 'À modérer', tone: 'warning' },
  DRAFT: { label: 'Brouillon', tone: 'neutral' },
  FINISHED: { label: 'Terminé', tone: 'info' },
  CANCELLED: { label: 'Annulé', tone: 'danger' },
};

const STATUS_OPTIONS: readonly { label: string; value: OrganizerStatus }[] = [
  { label: 'Actifs', value: 'ACTIVE' },
  { label: 'En attente de validation', value: 'PENDING' },
  { label: 'Suspendus', value: 'SUSPENDED' },
];

const ACTIVITY_OPTIONS: readonly { label: string; value: OrganizerActivity }[] = [
  { label: 'Avec événements', value: 'with_events' },
  { label: 'Avec événements à venir', value: 'with_upcoming' },
  { label: 'Sans événement', value: 'without_events' },
];

const JOINED_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '7 derniers jours', value: '7' },
  { label: '30 derniers jours', value: '30' },
  { label: '90 derniers jours', value: '90' },
  { label: '12 derniers mois', value: '365' },
];

const SUSPEND_REASONS = [
  { value: 'terms', label: "Non-respect des conditions d'utilisation" },
  { value: 'fraud', label: 'Événement frauduleux ou trompeur' },
  { value: 'reports', label: 'Signalements multiples' },
  { value: 'request', label: "Demande de l'organisateur" },
  { value: 'other', label: 'Autre motif' },
];

const REJECT_REASONS = [
  { value: 'incomplete', label: 'Dossier incomplet' },
  { value: 'identity', label: 'Identité non vérifiable' },
  { value: 'terms', label: "Non-respect des conditions d'utilisation" },
  { value: 'other', label: 'Autre motif' },
];

const DONE_MESSAGES: Record<OrganizerAction, (n: number) => string> = {
  validate: (n) => (n > 1 ? `${n} comptes ont été validés.` : 'Le compte a été validé.'),
  reject: () => 'La demande a été refusée.',
  suspend: (n) => (n > 1 ? `${n} comptes ont été suspendus.` : 'Le compte a été suspendu.'),
  reactivate: (n) => (n > 1 ? `${n} comptes ont été réactivés.` : 'Le compte a été réactivé.'),
};

const NUMBER = new Intl.NumberFormat('fr-FR');
const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function visiblePages(current: number, total: number): number[] {
  const count = Math.min(MAX_VISIBLE_PAGES, total);
  let first = Math.max(1, current - Math.floor(count / 2));
  first = Math.min(first, total - count + 1);
  return Array.from({ length: count }, (_, index) => first + index);
}

/** « Autre motif » impose une précision d'au moins 10 caractères. */
function reasonDetails(group: AbstractControl): ValidationErrors | null {
  const reason = group.get('reason')?.value as string;
  const details = String(group.get('details')?.value ?? '').trim();
  return reason === 'other' && details.length < 10 ? { detailsRequired: true } : null;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface DetailState {
  organizer: AdminOrganizerDto;
  events: AdminOrganizerEvent[];
  loading: boolean;
  failed: boolean;
}

interface ReasonRequest {
  action: 'suspend' | 'reject';
  targets: AdminOrganizerDto[];
}

interface ActionResult {
  count: number;
  updated: AdminOrganizerDto | null;
}

type LoadResult =
  | { ok: true; list: AdminOrganizerList }
  | { ok: false; notFound: boolean };

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-admin-organizers',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './organisateurs.component.html',
  styleUrl: './organisateurs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOrganizersComponent {
  private readonly admin = inject(AdminApiService);
  private readonly notification = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(NonNullableFormBuilder);

  private readonly reasonDialog = viewChild.required<ElementRef<HTMLDialogElement>>('reasonDialog');
  private readonly detailDialog = viewChild.required<ElementRef<HTMLDialogElement>>('detailDialog');

  readonly statusOptions = STATUS_OPTIONS;
  readonly activityOptions = ACTIVITY_OPTIONS;
  readonly joinedOptions = JOINED_OPTIONS;
  readonly statusMeta = STATUS_META;
  readonly eventStatusMeta = EVENT_STATUS_META;
  readonly pageSizes = [10, 25, 50];

  // Filtres
  readonly searchTerm = signal('');
  readonly status = signal<OrganizerStatus | ''>('');
  readonly activity = signal<OrganizerActivity | ''>('');
  readonly joined = signal('');
  readonly sortKey = signal<SortKey>('joined');
  readonly sortDir = signal<SortDir>('desc');
  readonly currentPage = signal(1);
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);

  // Données
  readonly loadState = signal<LoadState>('loading');
  readonly refreshing = signal(false);
  readonly rows = signal<AdminOrganizerDto[]>([]);
  readonly stats = signal<AdminOrganizerStats | null>(null);
  readonly totalCount = signal(0);
  readonly totalPages = signal(1);

  // Interactions
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly openMenuId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly exporting = signal(false);
  readonly reasonRequest = signal<ReasonRequest | null>(null);
  readonly reasonAttempted = signal(false);
  readonly detail = signal<DetailState | null>(null);

  readonly reasonForm = this.fb.group(
    {
      reason: ['', Validators.required],
      details: ['', Validators.maxLength(300)],
      notify: [true],
    },
    { validators: reasonDetails },
  );
  private readonly reasonValue = toSignal(this.reasonForm.controls.reason.valueChanges, { initialValue: '' });

  private readonly query$ = new Subject<AdminOrganizerFilters>();
  private readonly searchInput$ = new Subject<string>();

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  readonly pages = computed(() => visiblePages(this.currentPage(), this.totalPages()));

  readonly hasActiveFilter = computed(
    () => this.searchTerm().trim() !== '' || this.status() !== '' || this.activity() !== '' || this.joined() !== '',
  );

  readonly rangeLabel = computed(() => {
    const total = this.totalCount();
    if (total === 0) return '0';
    const start = (this.currentPage() - 1) * this.pageSize() + 1;
    return `${start}–${Math.min(start + this.pageSize() - 1, total)}`;
  });

  readonly selectedRows = computed(() => this.rows().filter((row) => this.selected().has(row.id)));
  readonly selectedPending = computed(() => this.selectedRows().filter((r) => r.status === 'PENDING'));
  readonly selectedActive = computed(() => this.selectedRows().filter((r) => r.status === 'ACTIVE'));
  readonly selectedSuspended = computed(() => this.selectedRows().filter((r) => r.status === 'SUSPENDED'));
  readonly allSelected = computed(() => this.rows().length > 0 && this.selectedRows().length === this.rows().length);
  readonly someSelected = computed(() => this.selectedRows().length > 0 && !this.allSelected());

  readonly cards = computed(() => {
    const s = this.stats();
    return [
      { key: 'all' as QuickFilter, label: 'Organisateurs', value: s?.total ?? null, tone: 'violet' },
      { key: 'active' as QuickFilter, label: 'Actifs', value: s?.active ?? null, tone: 'cyan' },
      { key: 'with' as QuickFilter, label: 'Avec événements', value: s?.with_events ?? null, tone: 'green' },
      { key: 'without' as QuickFilter, label: 'Sans événement', value: s?.without_events ?? null, tone: 'amber' },
    ];
  });

  readonly reasonOptions = computed(() => (this.reasonRequest()?.action === 'reject' ? REJECT_REASONS : SUSPEND_REASONS));
  readonly detailsRequired = computed(() => this.reasonValue() === 'other');
  readonly reasonTargetsLabel = computed(() => {
    const targets = this.reasonRequest()?.targets ?? [];
    return targets.length === 1 ? targets[0].full_name : `${targets.length} comptes`;
  });

  constructor() {
    this.restoreFromUrl();

    // switchMap annule la requête précédente si un filtre change avant la réponse.
    this.query$
      .pipe(
        switchMap((filters) =>
          this.admin.listOrganizers(filters).pipe(
            map((response): LoadResult => (response.data ? { ok: true, list: response.data } : { ok: false, notFound: false })),
            catchError((error: unknown) =>
              of<LoadResult>({ ok: false, notFound: error instanceof HttpErrorResponse && error.status === 404 }),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.applyResult(result));

    // Recherche : une requête 400 ms après la dernière frappe, pas à chaque touche.
    this.searchInput$.pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed()).subscribe((value) => {
      if (value.trim() === this.searchTerm().trim()) return;
      this.searchTerm.set(value);
      this.applyFilters();
    });

    this.load(false);
  }

  /* ------------------------------------------------------------------
     FILTRES, TRI, PAGINATION
     ------------------------------------------------------------------ */
  onSearchInput(event: Event): void {
    this.searchInput$.next((event.target as HTMLInputElement).value);
  }

  onStatus(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.status.set(STATUS_OPTIONS.some((o) => o.value === value) ? (value as OrganizerStatus) : '');
    this.applyFilters();
  }

  onActivity(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.activity.set(ACTIVITY_OPTIONS.some((o) => o.value === value) ? (value as OrganizerActivity) : '');
    this.applyFilters();
  }

  onJoined(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.joined.set(JOINED_OPTIONS.some((o) => o.value === value) ? value : '');
    this.applyFilters();
  }

  onPageSize(event: Event): void {
    this.pageSize.set(Number((event.target as HTMLSelectElement).value) || DEFAULT_PAGE_SIZE);
    this.applyFilters();
  }

  /** Cartes et pastilles : un clic applique le filtre correspondant. */
  applyQuickFilter(kind: QuickFilter): void {
    this.status.set(kind === 'active' ? 'ACTIVE' : kind === 'pending' ? 'PENDING' : kind === 'suspended' ? 'SUSPENDED' : '');
    this.activity.set(kind === 'with' ? 'with_events' : kind === 'without' ? 'without_events' : '');
    if (kind === 'all') {
      this.searchTerm.set('');
      this.joined.set('');
    }
    this.applyFilters();
  }

  isQuickActive(kind: QuickFilter): boolean {
    const status = this.status();
    const activity = this.activity();
    switch (kind) {
      case 'all': return !this.hasActiveFilter();
      case 'active': return status === 'ACTIVE' && activity === '';
      case 'with': return activity === 'with_events' && status === '';
      case 'without': return activity === 'without_events' && status === '';
      case 'pending': return status === 'PENDING';
      case 'suspended': return status === 'SUSPENDED';
    }
  }

  resetFilters(): void {
    this.applyQuickFilter('all');
  }

  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'name' || key === 'status' ? 'asc' : 'desc');
    }
    this.applyFilters();
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.load(false);
    this.viewportScroller.scrollToPosition([0, 0]);
  }

  retry(): void {
    this.load(false);
  }

  refresh(): void {
    if (!this.refreshing()) this.load(true);
  }

  private applyFilters(): void {
    this.currentPage.set(1);
    this.load(false);
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  private load(silent: boolean): void {
    if (silent) {
      this.refreshing.set(true);
    } else {
      this.loadState.set('loading');
      this.selected.set(new Set());
    }
    this.openMenuId.set(null);
    this.syncUrl();
    this.query$.next(this.buildFilters());
  }

  private buildFilters(page = this.currentPage(), pageSize = this.pageSize()): AdminOrganizerFilters {
    const days = Number(this.joined());
    const joinedAfter = days > 0 ? isoDay(new Date(Date.now() - days * 86_400_000)) : null;
    const prefix = this.sortDir() === 'desc' ? '-' : '';

    return {
      page,
      pageSize,
      search: this.searchTerm(),
      status: this.status() || null,
      activity: this.activity() || null,
      joinedAfter,
      ordering: `${prefix}${SORT_FIELDS[this.sortKey()]}`,
    };
  }

  private applyResult(result: LoadResult): void {
    const wasSilent = this.refreshing();
    this.refreshing.set(false);

    if (!result.ok) {
      // Page inexistante (adresse modifiée à la main, filtres plus restrictifs) : retour à la page 1.
      if (result.notFound && this.currentPage() > 1) {
        this.currentPage.set(1);
        this.load(false);
        return;
      }
      if (wasSilent && this.rows().length > 0) {
        this.notification.error("Actualisation impossible : la liste affichée peut être ancienne.", 'Organisateurs');
      } else {
        this.loadState.set('error');
      }
      return;
    }

    const { list } = result;
    this.rows.set(list.results);
    this.stats.set(list.stats);
    this.totalCount.set(list.count);
    this.totalPages.set(Math.max(1, list.total_pages));
    this.currentPage.set(list.current_page);

    // On ne garde que les sélections encore visibles.
    const visible = new Set(list.results.map((row) => row.id));
    this.selected.update((current) => new Set([...current].filter((id) => visible.has(id))));
    this.loadState.set('ready');
  }

  /* ------------------------------------------------------------------
     SÉLECTION
     ------------------------------------------------------------------ */
  toggleRow(row: AdminOrganizerDto): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(row.id)) next.add(row.id);
      return next;
    });
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows().map((row) => row.id)));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  /* ------------------------------------------------------------------
     ACTIONS SUR LES COMPTES
     ------------------------------------------------------------------ */
  toggleMenu(id: string): void {
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  validate(targets: AdminOrganizerDto[]): void {
    this.run(targets, 'validate');
  }

  reactivate(targets: AdminOrganizerDto[]): void {
    this.run(targets, 'reactivate');
  }

  askReason(action: 'suspend' | 'reject', targets: AdminOrganizerDto[]): void {
    if (targets.length === 0) return;
    this.openMenuId.set(null);
    this.reasonForm.reset({ reason: '', details: '', notify: true });
    this.reasonAttempted.set(false);
    this.reasonRequest.set({ action, targets });
    this.reasonDialog().nativeElement.showModal();
  }

  confirmReason(): void {
    const request = this.reasonRequest();
    if (!request) return;
    this.reasonAttempted.set(true);
    this.reasonForm.markAllAsTouched();
    if (this.reasonForm.invalid) return;

    const { reason, details, notify } = this.reasonForm.getRawValue();
    const label = this.reasonOptions().find((option) => option.value === reason)?.label ?? reason;
    const text = details.trim() ? `${label} : ${details.trim()}` : label;
    this.run(request.targets, request.action, { reason: text, notify });
  }

  closeReason(): void {
    if (!this.busy()) this.reasonDialog().nativeElement.close();
  }

  onReasonCancel(event: Event): void {
    if (this.busy()) event.preventDefault(); // Échap ne ferme pas la fenêtre pendant l'envoi
  }

  private run(targets: AdminOrganizerDto[], action: OrganizerAction, payload: OrganizerActionPayload = {}): void {
    if (targets.length === 0 || this.busy()) return;
    this.openMenuId.set(null);
    this.busy.set(true);

    const request$ =
      targets.length === 1
        ? this.admin
            .updateOrganizerStatus(targets[0].id, action, payload)
            .pipe(map((response): ActionResult => ({ count: 1, updated: response.data ?? null })))
        : this.admin
            .bulkUpdateOrganizers(targets.map((t) => t.id), action, payload)
            .pipe(map((response): ActionResult => ({ count: response.data?.updated ?? targets.length, updated: null })));

    request$
      .pipe(finalize(() => this.busy.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.notification.success(DONE_MESSAGES[action](result.count), 'Organisateurs');
          this.clearSelection();
          if (this.reasonRequest()) this.reasonDialog().nativeElement.close();

          const updated = result.updated;
          if (updated && this.detail()?.organizer.id === updated.id) {
            this.detail.update((d) => (d ? { ...d, organizer: updated } : d));
          }
          this.load(true);
        },
        error: (error: unknown) => this.notification.httpError(error),
      });
  }

  /* ------------------------------------------------------------------
     FICHE DÉTAILLÉE
     ------------------------------------------------------------------ */
  openDetail(row: AdminOrganizerDto): void {
    this.openMenuId.set(null);
    this.detail.set({ organizer: row, events: [], loading: true, failed: false });
    this.detailDialog().nativeElement.showModal();

    this.admin
      .getOrganizerDetail(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (this.detail()?.organizer.id !== row.id) return; // une autre fiche a été ouverte entre-temps
          this.detail.update((d) =>
            d ? { organizer: response.data?.organizer ?? d.organizer, events: response.data?.recent_events ?? [], loading: false, failed: false } : d,
          );
        },
        error: () => {
          if (this.detail()?.organizer.id !== row.id) return;
          this.detail.update((d) => (d ? { ...d, loading: false, failed: true } : d));
        },
      });
  }

  closeDetail(): void {
    this.detailDialog().nativeElement.close();
  }

  /** Clic sur le fond sombre : le clic arrive sur le <dialog> lui-même. */
  onBackdropClick(event: MouseEvent, kind: 'detail' | 'reason'): void {
    const element = (kind === 'detail' ? this.detailDialog() : this.reasonDialog()).nativeElement;
    if (event.target !== element) return;
    if (kind === 'detail') this.closeDetail();
    else this.closeReason();
  }

  /* ------------------------------------------------------------------
     EXPORT CSV
     ------------------------------------------------------------------ */
  exportAll(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.admin
      .exportOrganizers(this.buildFilters(1, 10_000))
      .pipe(finalize(() => this.exporting.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          downloadBlob(blob, `organisateurs-${isoDay(new Date())}.csv`);
          this.notification.success('La liste a été téléchargée.', 'Export');
        },
        error: (error: unknown) => this.notification.httpError(error),
      });
  }

  exportSelection(): void {
    const rows = this.selectedRows();
    if (rows.length === 0) return;
    const lines = [
      ['Nom', 'E-mail', 'Téléphone', 'Organisation', 'Ville', 'Statut', 'Événements', 'Inscriptions', 'À venir', 'Inscrit le'],
      ...rows.map((o) => [
        o.full_name, o.email, o.phone, o.organization_name ?? '', o.city ?? '', STATUS_META[o.status].label,
        String(o.events_count), String(o.registrations_count), String(o.upcoming_count), o.created_at.slice(0, 10),
      ]),
    ].map((row) => row.map(csvCell).join(';'));

    downloadBlob(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `selection-organisateurs-${isoDay(new Date())}.csv`);
    this.notification.success(`${rows.length} compte${rows.length > 1 ? 's' : ''} exporté${rows.length > 1 ? 's' : ''}.`, 'Export');
  }

  /* ------------------------------------------------------------------
     ADRESSE DE LA PAGE : les filtres survivent au retour arrière
     ------------------------------------------------------------------ */
  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        q: this.searchTerm().trim() || null,
        statut: this.status() || null,
        activite: this.activity() || null,
        inscription: this.joined() || null,
        tri: this.sortKey() !== 'joined' ? this.sortKey() : null,
        sens: this.sortKey() !== 'joined' || this.sortDir() !== 'desc' ? this.sortDir() : null,
        page: this.currentPage() > 1 ? this.currentPage() : null,
        taille: this.pageSize() !== DEFAULT_PAGE_SIZE ? this.pageSize() : null,
      },
    });
  }

  private restoreFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;

    this.searchTerm.set((params.get('q') ?? '').slice(0, TEXT_MAX));

    const status = params.get('statut');
    if (STATUS_OPTIONS.some((o) => o.value === status)) this.status.set(status as OrganizerStatus);

    const activity = params.get('activite');
    if (ACTIVITY_OPTIONS.some((o) => o.value === activity)) this.activity.set(activity as OrganizerActivity);

    const joined = params.get('inscription');
    if (JOINED_OPTIONS.some((o) => o.value === joined)) this.joined.set(joined as string);

    const sort = params.get('tri');
    if (sort && sort in SORT_FIELDS) this.sortKey.set(sort as SortKey);
    const dir = params.get('sens');
    if (dir === 'asc' || dir === 'desc') this.sortDir.set(dir);

    const page = Number(params.get('page'));
    if (Number.isInteger(page) && page >= 1) this.currentPage.set(page);
    const size = Number(params.get('taille'));
    if (this.pageSizes.includes(size)) this.pageSize.set(size);
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  initials(row: AdminOrganizerDto): string {
    return `${row.first_name.charAt(0)}${row.last_name.charAt(0)}`.toUpperCase();
  }

  avatarTone(row: AdminOrganizerDto): number {
    return Array.from(row.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  }

  formatNumber(value: number | null): string {
    return value === null ? '—' : NUMBER.format(value);
  }

  formatDate(iso: string | null): string {
    return iso ? DATE.format(new Date(iso)) : '—';
  }

  /** Les deux dernières lignes ouvrent leur menu vers le haut pour ne pas déborder. */
  menuUp(index: number): boolean {
    return this.rows().length > 3 && index >= this.rows().length - 2;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.menu-wrap')) this.openMenuId.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openMenuId.set(null);
  }
}
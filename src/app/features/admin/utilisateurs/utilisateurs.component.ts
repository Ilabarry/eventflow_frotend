import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { finalize } from 'rxjs';

import { AdminApiService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AdminUserDto, AdminUserFilters } from '../../../core/models/admin.model';

/* ------------------------------------------------------------------ */
const DEFAULT_PAGE_SIZE = 10;
const REASON_MIN = 5;
const REASON_MAX = 500;

type LoadState = 'loading' | 'ready' | 'error';
type RoleUtilisateur = 'Participant' | 'Organisateur' | 'Administrateur';
type StatutUtilisateur = 'Actif' | 'Suspendu';
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type StatTone = 'purple' | 'blue' | 'green' | 'red';

interface Utilisateur {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  phone: string;
  role: RoleUtilisateur;
  roles: string[];
  dateInscription: string;
  statut: StatutUtilisateur;
  avatar: string;
  isAdmin: boolean;
}

interface ReasonRequest {
  target: Utilisateur;
  action: 'suspend' | 'activate';
}

interface ContactTarget {
  full_name: string;
  email: string;
  phone: string;
}

interface UserStats {
  total: number;
  participants: number;
  organisateurs: number;
  suspendus: number;
}

const ROLE_TONE: Record<RoleUtilisateur, BadgeTone> = {
  Participant: 'info',
  Organisateur: 'warning',
  Administrateur: 'success',
};

const SUSPEND_REASONS = [
  { value: 'terms', label: "Non-respect des conditions d'utilisation" },
  { value: 'fraud', label: 'Comportement frauduleux ou trompeur' },
  { value: 'reports', label: 'Signalements multiples' },
  { value: 'request', label: "Demande de l'utilisateur" },
  { value: 'other', label: 'Autre motif' },
];

const NUMBER = new Intl.NumberFormat('fr-FR');
const DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function reasonDetails(group: AbstractControl): ValidationErrors | null {
  const reason = group.get('reason')?.value as string;
  const details = String(group.get('details')?.value ?? '').trim();
  if (reason !== 'other') return null;
  return details.length >= REASON_MIN ? null : { detailsRequired: true };
}

@Component({
  selector: 'app-utilisateurs',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './utilisateurs.component.html',
  styleUrl: './utilisateurs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsersComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);
  private readonly notifier = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(NonNullableFormBuilder);

  private readonly reasonDialog = viewChild.required<ElementRef<HTMLDialogElement>>('reasonDialog');
  private readonly contactDialog = viewChild.required<ElementRef<HTMLDialogElement>>('contactDialog');

  /* ------------------------- Filtres ------------------------- */
  readonly recherche = signal('');
  readonly roleFiltre = signal('Tous');
  readonly statutFiltre = signal('Tous');
  readonly dateFiltre = signal('Toutes');

  /* ------------------------- État liste ------------------------- */
  readonly loadState = signal<LoadState>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly utilisateurs = signal<Utilisateur[]>([]);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly currentPage = signal(1);
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);

  /* ------------------------- État action ------------------------- */
  readonly busyId = signal<string | null>(null);
  readonly menuOpenId = signal<string | null>(null);
  readonly reasonRequest = signal<ReasonRequest | null>(null);
  readonly reasonAttempted = signal(false);
  readonly reasonSaving = signal(false);
  readonly contactTarget = signal<ContactTarget | null>(null);
  readonly contacting = signal(false);

  /* ------------------------- Stats globales ------------------------- */
  readonly stats = signal<UserStats>({
    total: 0,
    participants: 0,
    organisateurs: 0,
    suspendus: 0,
  });

  readonly reasonForm = this.fb.group(
    {
      reason: ['', Validators.required],
      details: ['', Validators.maxLength(REASON_MAX)],
      notify: [true],
    },
    { validators: reasonDetails },
  );

  readonly reasonOptions = SUSPEND_REASONS;
  readonly pageSizeOptions = [5, 10, 25, 50];

  /* ------------------------- Dérivés ------------------------- */
  readonly rows = computed(() => this.utilisateurs());
  readonly isEmpty = computed(() => this.loadState() === 'ready' && this.rows().length === 0);
  readonly canPrev = computed(() => this.currentPage() > 1);
  readonly canNext = computed(() => this.currentPage() < this.totalPages());
  readonly detailsRequired = computed(() => this.reasonForm.controls.reason.value === 'other');
  readonly reasonTargetLabel = computed(() => this.reasonRequest()?.target.email ?? '');

  readonly cards = computed(() => {
    const s = this.stats();
    return [
      { key: 'all', label: 'Comptes', value: s.total, tone: 'purple' as StatTone },
      { key: 'participants', label: 'Participants', value: s.participants, tone: 'blue' as StatTone },
      { key: 'organisateurs', label: 'Organisateurs', value: s.organisateurs, tone: 'green' as StatTone },
      { key: 'suspendus', label: 'Suspendus', value: s.suspendus, tone: 'red' as StatTone },
    ];
  });

  ngOnInit(): void {
    this.loadStats();
    this.loadList();
  }

  /* ------------------------------------------------------------------
     Chargement des stats globales (indépendant de la pagination)
     ------------------------------------------------------------------ */
  private loadStats(): void {
    this.adminApi
      .listUsers({
        page: 1,
        pageSize: 10000,
        search: null,
        role: null,
        isActive: null,
        joinedFrom: null,
        joinedTo: null,
        ordering: '-created_at',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!response.success || !response.data) return;
          const all = response.data.results.map((u) => this.convertir(u));
          this.stats.set({
            total: response.data.count,
            participants: all.filter((u) => u.role === 'Participant').length,
            organisateurs: all.filter((u) => u.role === 'Organisateur').length,
            suspendus: all.filter((u) => u.statut === 'Suspendu').length,
          });
        },
        error: () => {
          // Les stats restent à zéro en cas d'erreur — non bloquant
        },
      });
  }

  /* ------------------------------------------------------------------
     Chargement de la liste paginée
     ------------------------------------------------------------------ */
  loadList(): void {
    this.loadState.set('loading');
    this.errorMessage.set(null);
    this.menuOpenId.set(null);

    const filters: AdminUserFilters = {
      page: this.currentPage(),
      pageSize: this.pageSize(),
      search: this.recherche().trim() || null,
      role: this.roleFiltre() === 'Tous' ? null : this.roleFiltre().toLowerCase(),
      isActive: this.statutFiltre() === 'Tous' ? null : this.statutFiltre() === 'Actif',
      joinedFrom: this.dateDepuisJours(),
      joinedTo: this.dateFiltre() === 'Toutes' ? null : this.dateDuJour(),
      ordering: '-created_at',
    };

    this.adminApi
      .listUsers(filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (!response.success || !response.data) {
            this.utilisateurs.set([]);
            this.total.set(0);
            this.totalPages.set(1);
            this.errorMessage.set(response.message || 'Impossible de charger les utilisateurs.');
            this.loadState.set('error');
            return;
          }
          const page = response.data;
          this.utilisateurs.set(page.results.map((u) => this.convertir(u)));
          this.total.set(page.count);
          this.totalPages.set(Math.max(1, page.total_pages));
          this.currentPage.set(page.current_page);
          this.loadState.set('ready');
        },
        error: (error: unknown) => {
          this.utilisateurs.set([]);
          this.total.set(0);
          this.totalPages.set(1);
          this.errorMessage.set(
            error instanceof HttpErrorResponse && error.status === 403
              ? 'Accès refusé : compte administrateur autorisé requis.'
              : error instanceof HttpErrorResponse && error.status === 401
                ? 'Session expirée. Veuillez vous reconnecter.'
                : 'Impossible de charger les utilisateurs. Vérifiez le serveur.',
          );
          this.loadState.set('error');
        },
      });
  }

  retry(): void {
    this.loadStats();
    this.loadList();
  }

  private convertir(user: AdminUserDto): Utilisateur {
    const roles = user.roles.map((r) => r.toLowerCase());
    const isAdmin =
      user.is_superuser ||
      user.is_admin ||
      user.is_staff ||
      roles.some((r) => ['administrateur', 'admin', 'administrator'].includes(r));

    let role: RoleUtilisateur = 'Participant';
    if (isAdmin) role = 'Administrateur';
    else if (roles.some((r) => ['organisateur', 'organizer'].includes(r))) role = 'Organisateur';

    const prenom = user.first_name || '';
    const nom = user.last_name || '';
    const initiales = `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();

    return {
      id: user.id,
      prenom,
      nom,
      email: user.email,
      phone: user.phone,
      role,
      roles,
      dateInscription: user.created_at,
      statut: user.is_active ? 'Actif' : 'Suspendu',
      avatar: initiales || '?',
      isAdmin,
    };
  }

  /* ------------------------------------------------------------------
     Filtres
     ------------------------------------------------------------------ */
  onSearchChange(value: string): void {
    this.recherche.set(value);
    this.currentPage.set(1);
    this.loadList();
  }

  onRoleChange(value: string): void {
    this.roleFiltre.set(value);
    this.currentPage.set(1);
    this.loadList();
  }

  onStatutChange(value: string): void {
    this.statutFiltre.set(value);
    this.currentPage.set(1);
    this.loadList();
  }

  onDateChange(value: string): void {
    this.dateFiltre.set(value);
    this.currentPage.set(1);
    this.loadList();
  }

  clearSearch(): void {
    if (this.recherche() === '') return;
    this.recherche.set('');
    this.currentPage.set(1);
    this.loadList();
  }

  onPageSize(event: Event): void {
    this.pageSize.set(Number((event.target as HTMLSelectElement).value) || DEFAULT_PAGE_SIZE);
    this.currentPage.set(1);
    this.loadList();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.loadList();
  }

  private dateDuJour(): string {
    return this.formaterDate(new Date());
  }

  private dateDepuisJours(): string | null {
    const filtre = this.dateFiltre();
    if (filtre === 'Toutes') return null;
    const jours = filtre === '7 jours' ? 7 : 30;
    const date = new Date();
    date.setDate(date.getDate() - jours);
    return this.formaterDate(date);
  }

  private formaterDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /* ------------------------------------------------------------------
     Menu
     ------------------------------------------------------------------ */
  toggleMenu(id: string): void {
    this.menuOpenId.update((current) => (current === id ? null : id));
  }

  closeMenu(): void {
    if (this.menuOpenId()) this.menuOpenId.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpenId()) return;
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[data-menu-root]')) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.reasonRequest()) { this.closeReason(); return; }
    if (this.contactTarget()) { this.closeContact(); return; }
    this.closeMenu();
  }

  /* ------------------------------------------------------------------
     Profil (à brancher sur une route dédiée si elle existe)
     ------------------------------------------------------------------ */
  openProfile(row: Utilisateur): void {
    this.closeMenu();
    this.notifier.info(
      `Profil de ${row.prenom} ${row.nom} — fonctionnalité à venir.`,
      'Profil',
    );
  }

  /* ------------------------------------------------------------------
     Contact
     ------------------------------------------------------------------ */
  openContact(row: Utilisateur): void {
    this.closeMenu();
    this.contactTarget.set({
      full_name: `${row.prenom} ${row.nom}`.trim() || row.email,
      email: row.email,
      phone: row.phone,
    });
    this.contactDialog().nativeElement.showModal();
  }

  closeContact(): void {
    if (this.contacting()) return;
    this.contactDialog().nativeElement.close();
  }

  onContactBackdropClick(event: MouseEvent): void {
    if (event.target === this.contactDialog().nativeElement) this.closeContact();
  }

  phoneHref(phone: string): string {
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
  }

  mailHref(email: string): string {
    const subject = encodeURIComponent('[EventFlow] Contact administrateur');
    return `mailto:${email}?subject=${subject}`;
  }

  async copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.notifier.success(`${label} copié.`, 'Copié');
    } catch {
      this.notifier.error('Impossible de copier : sélectionnez à la main.');
    }
  }

  /* ------------------------------------------------------------------
     Suspendre / Réactiver
     ------------------------------------------------------------------ */
  askSuspend(row: Utilisateur): void {
    if (row.isAdmin) return;
    this.closeMenu();
    this.reasonForm.reset({ reason: '', details: '', notify: true });
    this.reasonAttempted.set(false);
    this.reasonRequest.set({ target: row, action: 'suspend' });
    this.reasonDialog().nativeElement.showModal();
  }

  reactivate(row: Utilisateur): void {
    if (row.isAdmin) return;
    this.closeMenu();
    this.applyAction(row, 'activate', 'Réactivation par un administrateur.');
  }

  confirmReason(): void {
    const request = this.reasonRequest();
    if (!request) return;
    this.reasonAttempted.set(true);
    this.reasonForm.markAllAsTouched();
    if (this.reasonForm.invalid) return;

    const { reason, details } = this.reasonForm.getRawValue();
    const label = SUSPEND_REASONS.find((o) => o.value === reason)?.label ?? reason;
    const text = details.trim() ? `${label} : ${details.trim()}` : label;
    this.applyAction(request.target, 'suspend', text);
  }

  closeReason(): void {
    if (this.reasonSaving()) return;
    this.reasonDialog().nativeElement.close();
  }

  onReasonCancel(event: Event): void {
    if (this.reasonSaving()) event.preventDefault();
  }

  onReasonBackdropClick(event: MouseEvent): void {
    if (event.target === this.reasonDialog().nativeElement) this.closeReason();
  }

  private applyAction(row: Utilisateur, action: 'suspend' | 'activate', reason: string): void {
    if (this.busyId()) return;
    this.busyId.set(row.id);
    this.reasonSaving.set(action === 'suspend' && this.reasonRequest()?.target.id === row.id);

    const request$ =
      action === 'suspend'
        ? this.adminApi.suspendUser(row.id, reason)
        : this.adminApi.activateUser(row.id, reason);

    request$
      .pipe(
        finalize(() => {
          this.busyId.set(null);
          this.reasonSaving.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          if (this.reasonRequest()) this.reasonDialog().nativeElement.close();
          this.notifier.success(
            action === 'suspend' ? 'Compte suspendu.' : 'Compte réactivé.',
            'Utilisateurs',
          );
          this.loadStats();   // ← stats rechargées
          this.loadList();
        },
        error: (error: HttpErrorResponse) => {
          if (error.status === 400) {
            const msg =
              (error.error?.errors?.reason?.[0] as string | undefined) ?? 'Motif invalide.';
            this.notifier.error(msg, 'Utilisateurs');
          } else if (error.status === 403) {
            this.notifier.error('Action non autorisée pour ce compte.', 'Utilisateurs');
          } else if (error.status === 409) {
            this.notifier.error('Action impossible : état déjà atteint.', 'Utilisateurs');
          } else {
            this.notifier.error('Impossible de modifier le compte.', 'Utilisateurs');
          }
        },
      });
  }

  /* ------------------------------------------------------------------
     Affichage
     ------------------------------------------------------------------ */
  roleTone(role: RoleUtilisateur): BadgeTone {
    return ROLE_TONE[role];
  }

  formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : NUMBER.format(value);
  }

  formatDate(iso: string | null | undefined): string {
    return iso ? DATE.format(new Date(iso)) : '—';
  }

  initials(row: Utilisateur): string {
    return row.avatar;
  }

  avatarTone(row: Utilisateur): number {
    return Array.from(row.id).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5;
  }

  menuUp(index: number, total: number): boolean {
    return total > 3 && index >= total - 2;
  }
}
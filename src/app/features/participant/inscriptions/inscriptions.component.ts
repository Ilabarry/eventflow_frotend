import { ViewportScroller } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';

import { PaginatedResponse } from '../../../core/models/api-response.model';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ApiRegistrationStatus,
  MyRegistrationDto,
  MyRegistrationsFilters,
  RegistrationService,
} from '../../../core/services/registration.service';

/* ------------------------------------------------------------------
 * Constantes de la page
 * ------------------------------------------------------------------ */
const PAGE_SIZE = 6;
const SEARCH_DEBOUNCE_MS = 400;
const MAX_VISIBLE_PAGES = 5;

type LoadState = 'loading' | 'ready' | 'error';
type StatusTone = 'success' | 'warning' | 'danger';

interface StatusFilter {
  label: string;
  value: ApiRegistrationStatus | null;
}

/** Onglets : ils correspondent au filtre ?status= du backend. */
const STATUS_FILTERS: readonly StatusFilter[] = [
  { label: 'Toutes', value: null },
  { label: 'Confirmées', value: 'CONFIRMED' },
  { label: 'En attente', value: 'PENDING' },
  { label: 'Annulées', value: 'CANCELLED' },
];

const STATUS_DISPLAY: Record<ApiRegistrationStatus, { label: string; tone: StatusTone }> = {
  CONFIRMED: { label: 'Inscription confirmée', tone: 'success' },
  PENDING: { label: 'En attente de confirmation', tone: 'warning' },
  CANCELLED: { label: 'Inscription annulée', tone: 'danger' },
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------
 * Modèle d'affichage d'une carte (préparé une seule fois, pas dans le HTML)
 * ------------------------------------------------------------------ */
interface RegistrationCard {
  id: string;
  reference: string;
  eventId: string;
  title: string;
  categoryName: string | null;
  coverImage: string | null;
  startIso: string;
  dateLabel: string;
  timeLabel: string;
  isOnline: boolean;
  placeLabel: string;
  priceLabel: string;
  statusLabel: string;
  statusTone: StatusTone;
  isCancelled: boolean;
  registeredIso: string;
  registeredLabel: string;
}

function toCard(item: MyRegistrationDto): RegistrationCard {
  const event = item.event;
  const start = new Date(event.start_at);
  const isOnline = event.format === 'ONLINE';
  const status = STATUS_DISPLAY[item.status];
  const formatLabel = event.format === 'HYBRID' ? 'Hybride' : 'Présentiel';

  return {
    id: item.id,
    reference: item.reference,
    eventId: event.id,
    title: event.title,
    categoryName: event.category?.name ?? null,
    coverImage: event.cover_image,
    startIso: event.start_at,
    dateLabel: DATE_FORMAT.format(start),
    timeLabel: TIME_FORMAT.format(start).replace(':', 'h'),
    isOnline,
    placeLabel: isOnline ? 'En ligne' : [event.city, formatLabel].filter(Boolean).join(' · '),
    priceLabel: event.participation_type === 'FREE' ? 'Gratuit' : 'Payant',
    statusLabel: status.label,
    statusTone: status.tone,
    isCancelled: item.status === 'CANCELLED',
    registeredIso: item.registered_at,
    registeredLabel: DATE_FORMAT.format(new Date(item.registered_at)),
  };
}

/** Numéros de page affichés : au plus 5, centrés sur la page courante. */
function visiblePages(current: number, total: number): number[] {
  const count = Math.min(MAX_VISIBLE_PAGES, total);
  let first = Math.max(1, current - Math.floor(count / 2));
  first = Math.min(first, total - count + 1);
  return Array.from({ length: count }, (_, index) => first + index);
}

type LoadResult =
  | { ok: true; page: PaginatedResponse<MyRegistrationDto> }
  | { ok: false };

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-inscriptions',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './inscriptions.component.html',
  styleUrl: './inscriptions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParticipantRegistrationsComponent {
  private readonly registrationService = inject(RegistrationService);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly query$ = new Subject<MyRegistrationsFilters>();
  private readonly searchInput$ = new Subject<string>();

  readonly statusFilters = STATUS_FILTERS;

  // État de la page
  readonly activeStatus = signal<ApiRegistrationStatus | null>(null);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly loadState = signal<LoadState>('loading');
  readonly cards = signal<RegistrationCard[]>([]);
  readonly totalCount = signal(0);
  readonly totalPages = signal(1);

  // Valeurs dérivées
  readonly pages = computed(() => visiblePages(this.currentPage(), this.totalPages()));
  readonly hasActiveFilter = computed(() => this.activeStatus() !== null || this.searchTerm() !== '');
  

  constructor() {
    // switchMap annule la requête précédente si l'utilisateur change de filtre
    // avant la réponse : la page n'affiche jamais un résultat périmé.
    this.query$
      .pipe(
        switchMap((filters) =>
          this.registrationService.listMine(filters).pipe(
            map((response): LoadResult =>
              response.data ? { ok: true, page: response.data } : { ok: false },
            ),
            catchError(() => of<LoadResult>({ ok: false })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.applyResult(result));

    // Recherche : une requête 400 ms après la dernière frappe, pas à chaque touche.
    this.searchInput$
      .pipe(
        map((value) => value.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        takeUntilDestroyed(),
      )
      .subscribe((term) => {
        if (term === this.searchTerm()) {
          return; // même recherche qu'avant : aucune requête inutile
        }
        this.searchTerm.set(term);
        this.currentPage.set(1);
        this.load();
      });

    this.load();
  }

  /* --- actions de l'utilisateur ------------------------------------- */
  selectStatus(status: ApiRegistrationStatus | null): void {
    if (status === this.activeStatus()) {
      return;
    }
    this.activeStatus.set(status);
    this.currentPage.set(1);
    this.load();
  }

  onSearchInput(event: Event): void {
    this.searchInput$.next((event.target as HTMLInputElement).value);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) {
      return;
    }
    this.currentPage.set(page);
    this.load();
    this.viewportScroller.scrollToPosition([0, 0]);
  }

  resetFilters(): void {
    this.activeStatus.set(null);
    this.searchTerm.set('');
    this.currentPage.set(1);
    this.load();
  }

  retry(): void {
    this.load();
  }

  /* --- chargement ------------------------------------------------------ */
  private load(): void {
    this.loadState.set('loading');
    this.query$.next({
      page: this.currentPage(),
      pageSize: PAGE_SIZE,
      status: this.activeStatus(),
      search: this.searchTerm(),
    });
  }

  private applyResult(result: LoadResult): void {
    if (!result.ok) {
      // Le détail technique n'est jamais montré : l'intercepteur gère 401,
      // la page propose simplement de réessayer.
      this.loadState.set('error');
      return;
    }
    this.cards.set(result.page.results.map(toCard));
    this.totalCount.set(result.page.count);
    this.totalPages.set(Math.max(1, result.page.total_pages));
    this.currentPage.set(result.page.current_page);
    this.loadState.set('ready');
  }

  /**
   * Récupère le lien d'accès à l'événement en ligne.
   * Le backend ne renvoie `access_url` que pour les inscriptions CONFIRMED
   * (via RegistrationDetailSerializer → EventOrganizerSerializer).
   */
  joinEvent(card: RegistrationCard): void {
    this.registrationService
      .getById(card.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const url = res.data?.event?.access_url;
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          } else {
            this.notification.warning(
              "Le lien d'accès n'est pas encore disponible. Il sera communiqué avant l'événement.",
              'Lien indisponible',
            );
          }
        },
        error: () => {
          this.notification.error(
            "Impossible de récupérer le lien de l'événement.",
            'Erreur',
          );
        },
      });
  }

}

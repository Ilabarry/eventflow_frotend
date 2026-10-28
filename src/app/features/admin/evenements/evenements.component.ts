import { HttpErrorResponse } from '@angular/common/http';
import { ViewportScroller } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';

import { EventFormat, EventStatus } from '../../../core/models/event.model';
import {
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  SupervisionCategoryDto,
  SupervisionEventDetailDto,
  SupervisionEventDto,
  SupervisionEventFilters,
} from '../../../core/models/supervision.model';
import { NotificationService } from '../../../core/services/notification.service';
import { SupervisionService } from '../../../core/services/supervision.service';

/* ------------------------------------------------------------------
 * Constantes de la page
 * ------------------------------------------------------------------ */
const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 400;
const MAX_VISIBLE_PAGES = 5;

type LoadState = 'loading' | 'ready' | 'error';
type DatePreset = 'all' | 'upcoming' | 'past' | 'month';
type StatusTone = 'success' | 'neutral' | 'danger' | 'info';

interface Option<T> {
  label: string;
  value: T;
}

const STATUS_OPTIONS: readonly Option<EventStatus | null>[] = [
  { label: 'Tous les statuts', value: null },
  { label: 'Publiés', value: 'PUBLISHED' },
  { label: 'Brouillons', value: 'DRAFT' },
  { label: 'Terminés', value: 'COMPLETED' },
  { label: 'Annulés', value: 'CANCELLED' },
];

const FORMAT_OPTIONS: readonly Option<EventFormat | null>[] = [
  { label: 'Tous les formats', value: null },
  { label: 'Présentiel', value: 'IN_PERSON' },
  { label: 'En ligne', value: 'ONLINE' },
  { label: 'Hybride', value: 'HYBRID' },
];

const DATE_OPTIONS: readonly Option<DatePreset>[] = [
  { label: 'Toutes les dates', value: 'all' },
  { label: 'À venir', value: 'upcoming' },
  { label: 'Passés', value: 'past' },
  { label: 'Ce mois-ci', value: 'month' },
];

const STATUS_DISPLAY: Record<EventStatus, { label: string; tone: StatusTone }> = {
  PUBLISHED: { label: 'Publié', tone: 'success' },
  DRAFT: { label: 'Brouillon', tone: 'neutral' },
  COMPLETED: { label: 'Terminé', tone: 'info' },
  CANCELLED: { label: 'Annulé', tone: 'danger' },
};

const FORMAT_LABELS: Record<EventFormat, string> = {
  IN_PERSON: 'Présentiel',
  ONLINE: 'En ligne',
  HYBRID: 'Hybride',
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/** Date locale au format AAAA-MM-JJ attendu par les filtres du backend. */
function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Traduit le choix « Date » en bornes starts_from / starts_to. */
function dateRange(preset: DatePreset, today = new Date()): { startsFrom: string | null; startsTo: string | null } {
  switch (preset) {
    case 'upcoming':
      return { startsFrom: isoDate(today), startsTo: null };
    case 'past': {
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      return { startsFrom: null, startsTo: isoDate(yesterday) };
    }
    case 'month':
      return {
        startsFrom: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
        startsTo: isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    default:
      return { startsFrom: null, startsTo: null };
  }
}

/* ------------------------------------------------------------------
 * Modèle d'affichage d'une ligne
 * ------------------------------------------------------------------ */
interface EventRow {
  id: string;
  title: string;
  coverImage: string | null;
  organizerName: string;
  organizerEmail: string;
  startIso: string;
  dateLabel: string;
  isOnline: boolean;
  formatLabel: string;
  status: EventStatus;
  statusLabel: string;
  statusTone: StatusTone;
  /** Le backend refuse d'annuler un événement déjà annulé ou terminé. */
  canCancel: boolean;
  isPublished: boolean;
}

function toRow(event: SupervisionEventDto): EventRow {
  const status = STATUS_DISPLAY[event.status];
  const isOnline = event.format === 'ONLINE';
  const city = event.city || event.venue_name;

  return {
    id: event.id,
    title: event.title,
    coverImage: event.cover_image,
    organizerName: event.organizer_name || event.organizer_email,
    organizerEmail: event.organizer_email,
    startIso: event.start_at,
    dateLabel: DATE_FORMAT.format(new Date(event.start_at)),
    isOnline,
    formatLabel: isOnline || !city ? FORMAT_LABELS[event.format] : `${FORMAT_LABELS[event.format]}, ${city}`,
    status: event.status,
    statusLabel: status.label,
    statusTone: status.tone,
    canCancel: event.status === 'DRAFT' || event.status === 'PUBLISHED',
    isPublished: event.status === 'PUBLISHED',
  };
}

function visiblePages(current: number, total: number): number[] {
  const count = Math.min(MAX_VISIBLE_PAGES, total);
  let first = Math.max(1, current - Math.floor(count / 2));
  first = Math.min(first, total - count + 1);
  return Array.from({ length: count }, (_, index) => first + index);
}

/** Premier message d'erreur du backend pour un champ (ex. « reason »). */
function fieldError(error: unknown, field: string): string | null {
  const value = error instanceof HttpErrorResponse ? error.error?.errors?.[field] : undefined;
  return Array.isArray(value) ? value[0] : (value ?? null);
}

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-evenements',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './evenements.component.html',
  styleUrl: './evenements.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminEventsComponent {
  private readonly supervision = inject(SupervisionService);
  private readonly notification = inject(NotificationService);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);

  private readonly detailDialog = viewChild.required<ElementRef<HTMLDialogElement>>('detailDialog');
  private readonly cancelDialog = viewChild.required<ElementRef<HTMLDialogElement>>('cancelDialog');

  readonly statusOptions = STATUS_OPTIONS;
  readonly formatOptions = FORMAT_OPTIONS;
  readonly dateOptions = DATE_OPTIONS;
  readonly reasonMin = REASON_MIN_LENGTH;
  readonly reasonMax = REASON_MAX_LENGTH;

  // Filtres
  readonly searchTerm = signal('');
  readonly status = signal<EventStatus | null>(null);
  readonly format = signal<EventFormat | null>(null);
  readonly category = signal<string | null>(null);
  readonly datePreset = signal<DatePreset>('all');
  readonly currentPage = signal(1);

  // Données
  readonly loadState = signal<LoadState>('loading');
  readonly rows = signal<EventRow[]>([]);
  readonly totalCount = signal(0);
  readonly totalPages = signal(1);
  readonly categories = signal<SupervisionCategoryDto[]>([]);
  readonly counters = signal<{ label: string; value: number; tone: string; icon: string }[] | null>(null);

  // Menu « ⋯ » et fenêtres
  readonly openMenuId = signal<string | null>(null);
  readonly detail = signal<SupervisionEventDetailDto | null>(null);
  readonly detailLoading = signal(false);
  readonly cancelTarget = signal<EventRow | null>(null);
  readonly cancelReason = signal('');
  readonly cancelError = signal<string | null>(null);
  readonly cancelling = signal(false);

  readonly pages = computed(() => visiblePages(this.currentPage(), this.totalPages()));
  readonly hasActiveFilter = computed(
    () =>
      this.searchTerm() !== '' ||
      this.status() !== null ||
      this.format() !== null ||
      this.category() !== null ||
      this.datePreset() !== 'all',
  );
  readonly reasonLength = computed(() => this.cancelReason().trim().length);
  readonly reasonValid = computed(
    () => this.reasonLength() >= REASON_MIN_LENGTH && this.reasonLength() <= REASON_MAX_LENGTH,
  );

  private readonly query$ = new Subject<SupervisionEventFilters>();
  private readonly searchInput$ = new Subject<string>();

  constructor() {
    this.query$
      .pipe(
        switchMap((filters) =>
          this.supervision.listEvents(filters).pipe(
            map((response) => response.data ?? null),
            catchError(() => of(null)),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((page) => {
        if (!page) {
          this.loadState.set('error');
          return;
        }
        this.rows.set(page.results.map(toRow));
        this.totalCount.set(page.count);
        this.totalPages.set(Math.max(1, page.total_pages));
        this.currentPage.set(page.current_page);
        this.loadState.set('ready');
      });

    this.searchInput$
      .pipe(
        map((value) => value.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        takeUntilDestroyed(),
      )
      .subscribe((term) => {
        if (term !== this.searchTerm()) {
          this.searchTerm.set(term);
          this.reload();
        }
      });

    // La liste des catégories ne sert qu'au filtre : un échec n'empêche pas la page.
    this.supervision
      .listCategories()
      .pipe(takeUntilDestroyed())
      .subscribe({ next: (response) => this.categories.set(response.data?.results ?? []), error: () => undefined });

    this.loadCounters();
    this.load();
  }

  /* --- Filtres ------------------------------------------------------- */
  onSearchInput(event: Event): void {
    this.searchInput$.next((event.target as HTMLInputElement).value);
  }

  onStatusChange(event: Event): void {
    this.status.set(((event.target as HTMLSelectElement).value || null) as EventStatus | null);
    this.reload();
  }

  onFormatChange(event: Event): void {
    this.format.set(((event.target as HTMLSelectElement).value || null) as EventFormat | null);
    this.reload();
  }

  onCategoryChange(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value || null);
    this.reload();
  }

  onDateChange(event: Event): void {
    this.datePreset.set((event.target as HTMLSelectElement).value as DatePreset);
    this.reload();
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.status.set(null);
    this.format.set(null);
    this.category.set(null);
    this.datePreset.set('all');
    this.reload();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) {
      return;
    }
    this.currentPage.set(page);
    this.load();
    this.viewportScroller.scrollToPosition([0, 0]);
  }

  retry(): void {
    this.load();
  }

  /* --- Menu « ⋯ » ---------------------------------------------------- */
  toggleMenu(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  /** Un clic ailleurs ou la touche Échap ferme le menu ouvert. */
  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.openMenuId.set(null);
  }

  /* --- Détail -------------------------------------------------------- */
  openDetail(row: EventRow): void {
    this.closeMenu();
    this.detail.set(null);
    this.detailLoading.set(true);
    this.detailDialog().nativeElement.showModal();

    this.supervision
      .getEvent(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.detail.set(response.data ?? null);
          this.detailLoading.set(false);
        },
        error: () => {
          this.detailLoading.set(false);
          this.detailDialog().nativeElement.close();
        },
      });
  }

  closeDetail(): void {
    this.detailDialog().nativeElement.close();
  }

  formatDateTime(iso: string | null): string {
    return iso ? DATE_TIME_FORMAT.format(new Date(iso)) : '—';
  }

  statusLabel(status: EventStatus): string {
    return STATUS_DISPLAY[status].label;
  }

  formatLabel(format: EventFormat): string {
    return FORMAT_LABELS[format];
  }

  /* --- Annulation ---------------------------------------------------- */
  openCancel(row: EventRow): void {
    this.closeMenu();
    this.cancelTarget.set(row);
    this.cancelReason.set('');
    this.cancelError.set(null);
    this.cancelDialog().nativeElement.showModal();
  }

  closeCancel(): void {
    if (!this.cancelling()) {
      this.cancelDialog().nativeElement.close();
    }
  }

  onReasonInput(event: Event): void {
    this.cancelReason.set((event.target as HTMLTextAreaElement).value);
    this.cancelError.set(null);
  }

  confirmCancel(): void {
    const target = this.cancelTarget();
    if (!target || !this.reasonValid() || this.cancelling()) {
      return;
    }
    this.cancelling.set(true);

    this.supervision
      .cancelEvent(target.id, this.cancelReason())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelling.set(false);
          this.cancelDialog().nativeElement.close();
          this.notification.success(`« ${target.title} » a été annulé.`, 'Événement annulé');
          this.loadCounters();
          this.load();
        },
        error: (error: unknown) => {
          this.cancelling.set(false);
          // 400 de validation : message sous le champ. 409 / 400 métier : toast de l'intercepteur.
          this.cancelError.set(fieldError(error, 'reason'));
        },
      });
  }

  /* --- Chargement ---------------------------------------------------- */
  private reload(): void {
    this.currentPage.set(1);
    this.load();
  }

  private load(): void {
    this.loadState.set('loading');
    this.closeMenu();
    this.query$.next({
      page: this.currentPage(),
      pageSize: PAGE_SIZE,
      search: this.searchTerm(),
      status: this.status(),
      format: this.format(),
      category: this.category(),
      ...dateRange(this.datePreset()),
    });
  }

  private loadCounters(): void {
    this.supervision
      .getDashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const events = response.data?.events;
          this.counters.set(
            events
              ? [
                  { label: 'Total', value: events.total, tone: 'violet', icon: 'calendar' },
                  { label: 'Publiés', value: events.published, tone: 'success', icon: 'check' },
                  { label: 'Brouillons', value: events.draft, tone: 'info', icon: 'draft' },
                  { label: 'Terminés', value: events.completed, tone: 'neutral', icon: 'done' },
                ]
              : null,
          );
        },
        error: () => this.counters.set(null),
      });
  }
}

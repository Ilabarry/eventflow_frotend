import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, map, of, switchMap } from 'rxjs';

import { NotificationService } from '../../../core/services/notification.service';
import {
  ParticipantEventsQuery,
  ParticipantEventsService,
} from '../../../core/services/participant-events.service';
import { PaginatedResponse } from '../../../core/models/api-response.model';
import { BackendEvent, EventCategory } from '../../../core/models/event.model';

type LoadState = 'loading' | 'ready' | 'error';
type FormatFilter = 'IN_PERSON' | 'ONLINE' | 'HYBRID' | 'all';
type PriceFilter = 'FREE' | 'PAID' | 'all';
type DateFilter = 'today' | 'week' | 'month' | 'all';
type ViewMode = 'grid' | 'list';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 400;

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

@Component({
  selector: 'app-participant-events',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './evenements.component.html',
  styleUrl: './evenements.component.scss',
})
export class ParticipantEventsComponent {
  private readonly eventsService = inject(ParticipantEventsService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  // ------------------------------------------------------------------
  // ÉTAT
  // ------------------------------------------------------------------
  readonly loadState = signal<LoadState>('loading');
  readonly events = signal<BackendEvent[]>([]);
  readonly categories = signal<EventCategory[]>([]);
  readonly totalCount = signal(0);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);

  readonly searchTerm = signal('');
  readonly selectedCategory = signal('all');
  readonly selectedFormat = signal<FormatFilter>('all');
  readonly selectedPrice = signal<PriceFilter>('all');
  readonly selectedDate = signal<DateFilter>('all');
  readonly ordering = signal<'-start_at' | 'start_at'>('start_at');

  // ------------------------------------------------------------------
  // OPTIONS
  // ------------------------------------------------------------------
  readonly formatOptions: { value: FormatFilter; label: string }[] = [
    { value: 'all', label: 'Tous les formats' },
    { value: 'IN_PERSON', label: 'En présentiel' },
    { value: 'ONLINE', label: 'En ligne' },
    { value: 'HYBRID', label: 'Hybride' },
  ];
  readonly priceOptions: { value: PriceFilter; label: string }[] = [
    { value: 'all', label: 'Tous les prix' },
    { value: 'FREE', label: 'Gratuit' },
    { value: 'PAID', label: 'Payant' },
  ];
  readonly dateOptions: { value: DateFilter; label: string }[] = [
    { value: 'all', label: 'Toutes les dates' },
    { value: 'today', label: "Aujourd'hui" },
    { value: 'week', label: '7 prochains jours' },
    { value: 'month', label: 'Ce mois-ci' },
  ];

  // ------------------------------------------------------------------
  // DERIVED
  // ------------------------------------------------------------------
  readonly hasActiveFilters = computed(
    () =>
      this.searchTerm() !== '' ||
      this.selectedCategory() !== 'all' ||
      this.selectedFormat() !== 'all' ||
      this.selectedPrice() !== 'all' ||
      this.selectedDate() !== 'all',
  );

  /** Ne garde que les événements dont la date de début est dans le futur. */
  readonly upcomingEvents = computed(() =>
    this.events().filter((e) => new Date(e.start_at).getTime() > Date.now()),
  );

  readonly pages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const count = Math.min(5, total);
    let first = Math.max(1, current - Math.floor(count / 2));
    first = Math.min(first, total - count + 1);
    return Array.from({ length: count }, (_, i) => first + i);
  });


  // ------------------------------------------------------------------
  // affichage 'grid' | 'list'
  // ------------------------------------------------------------------
  readonly view = signal<ViewMode>(
    (localStorage.getItem('evf.participant.events.view') as ViewMode) ?? 'grid'
  );

  setView(mode: ViewMode): void {
    this.view.set(mode);
    localStorage.setItem('evf.participant.events.view', mode);
  }

  // ------------------------------------------------------------------
  // PIPELINE DE CHARGEMENT
  // ------------------------------------------------------------------
  private readonly query$ = new Subject<ParticipantEventsQuery>();
  private readonly searchInput$ = new Subject<string>();

  constructor() {
    // Charger les catégories une fois
    this.eventsService
      .listCategories()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res) => this.categories.set(res.data ?? []),
        error: () => this.categories.set([]),
      });

    // Pipeline principal
    this.query$
      .pipe(
        switchMap((q) =>
          this.eventsService.list(q).pipe(
            map((res) => ({ ok: true as const, res })),
            catchError(() => of({ ok: false as const })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (!result.ok) {
          this.loadState.set('error');
          return;
        }
        const page: PaginatedResponse<BackendEvent> | undefined = result.res.data;
        if (!page) {
          this.loadState.set('error');
          return;
        }
        this.events.set(page.results);
        this.totalCount.set(page.count);
        this.totalPages.set(Math.max(1, page.total_pages));
        this.currentPage.set(page.current_page);
        this.loadState.set('ready');
      });

    // Recherche debouncée
    this.searchInput$
      .pipe(
        map((v) => v.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        takeUntilDestroyed(),
      )
      .subscribe((term) => {
        if (term === this.searchTerm()) return;
        this.searchTerm.set(term);
        this.currentPage.set(1);
        this.load();
      });

    this.load();
  }

  // ------------------------------------------------------------------
  // ACTIONS
  // ------------------------------------------------------------------
  onSearchInput(event: Event): void {
    this.searchInput$.next((event.target as HTMLInputElement).value);
  }

  onCategoryChange(event: Event): void {
    this.selectedCategory.set((event.target as HTMLSelectElement).value);
    this.currentPage.set(1);
    this.load();
  }

  onFormatChange(event: Event): void {
    this.selectedFormat.set((event.target as HTMLSelectElement).value as FormatFilter);
    this.currentPage.set(1);
    this.load();
  }

  onPriceChange(event: Event): void {
    this.selectedPrice.set((event.target as HTMLSelectElement).value as PriceFilter);
    this.currentPage.set(1);
    this.load();
  }

  onDateChange(event: Event): void {
    this.selectedDate.set((event.target as HTMLSelectElement).value as DateFilter);
    this.currentPage.set(1);
    this.load();
  }

  toggleOrdering(): void {
    this.ordering.update((o) => (o === '-start_at' ? 'start_at' : '-start_at'));
    this.load();
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedCategory.set('all');
    this.selectedFormat.set('all');
    this.selectedPrice.set('all');
    this.selectedDate.set('all');
    this.currentPage.set(1);
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  retry(): void {
    this.load();
  }

  // ------------------------------------------------------------------
  // HELPERS D'AFFICHAGE
  // ------------------------------------------------------------------
  formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : `${DATE_FORMAT.format(d)} · ${TIME_FORMAT.format(d).replace(':', 'h')}`;
  }

  formatLabel(format: string): string {
    if (format === 'ONLINE') return 'En ligne';
    if (format === 'HYBRID') return 'Hybride';
    return 'Présentiel';
  }

  priceLabel(e: BackendEvent): string {
    return e.participation_type === 'FREE' ? 'Gratuit' : 'Payant';
  }

  eventImage(e: BackendEvent): string {
    return e.cover_image || 'img/FFFFFF.svg';
  }

  isUpcoming(e: BackendEvent): boolean {
    return new Date(e.start_at).getTime() > Date.now();
  }

  // ------------------------------------------------------------------
  // CHARGEMENT
  // ------------------------------------------------------------------
  private load(): void {
    this.loadState.set('loading');
    const q: ParticipantEventsQuery = {
      page: this.currentPage(),
      pageSize: PAGE_SIZE,
      search: this.searchTerm(),
      ordering: this.ordering(),
    };
    if (this.selectedCategory() !== 'all') q.category = this.selectedCategory();
    if (this.selectedFormat() !== 'all') q.format = this.selectedFormat() as any;
    if (this.selectedPrice() !== 'all') q.price = this.selectedPrice() as any;
    if (this.selectedDate() !== 'all') q.date = this.selectedDate() as any;
    this.query$.next(q);
  }
}
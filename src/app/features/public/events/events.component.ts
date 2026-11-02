import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';

import {
  BackendEvent,
  EventCategory,
  EventQueryParams,
} from '../../../core/models/event.model';
import { EventsApiService } from '../../../core/services/events-api.service';
import { AppLoggerService } from '../../../core/services/app-logger.service';

type EventFormatFilter = 'all' | 'ONLINE' | 'IN_PERSON';
type EventPriceFilter = 'all' | 'FREE' | 'PAID';

interface DateOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-events',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './events.component.html',
  styleUrl: './events.component.scss',
})
export class EventsComponent implements OnInit {
  private readonly eventsApi = inject(EventsApiService);
  private readonly logger = inject(AppLoggerService);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // Données reçues du backend (page courante uniquement).
  events: BackendEvent[] = [];
  categories: EventCategory[] = [];

  // États de la page.
  isLoading = false;
  isLoadingCategories = false;
  errorMessage = '';
  actionMessage = '';

  // Recherche et filtres rapides.
  searchQuery = '';
  selectedTopCategory = 'all';
  selectedTopDate = 'all';
  selectedTopFormat: EventFormatFilter = 'all';
  selectedTopPrice: EventPriceFilter = 'all';

  // Filtres latéraux.
  // NOTE : on stocke désormais des IDs (UUID) de catégories, pas des noms.
  selectedCategories: string[] = [];
  selectedFormats: string[] = [];
  selectedPrices: string[] = [];
  selectedDates: string[] = [];

  // Tri et pagination.
  sortBy: 'relevance' | 'date' | 'price' = 'relevance';
  currentPage = 1;
  pageSize = 12;
  totalCount = 0;
  totalPages = 1;

  // Fenêtre de détail.
  selectedEvent: BackendEvent | null = null;

  readonly formats = [
    { label: 'En présentiel', value: 'IN_PERSON' },
    { label: 'En ligne', value: 'ONLINE' },
  ];

  readonly priceOptions = [
    { label: 'Gratuit', value: 'FREE' },
    { label: 'Payant', value: 'PAID' },
  ];

  readonly dateOptions: DateOption[] = [
    { label: "Aujourd'hui", value: 'today' },
    { label: 'Cette semaine', value: 'week' },
    { label: 'Ce mois-ci', value: 'month' },
  ];

  ngOnInit(): void {
    this.applyQueryParams();
    this.loadCategoriesAndEvents();
  }

  /**
   * Lit les filtres envoyés par l'accueil :
   * /events?q=...&category=...&format=...&price=...&date=...
   */
  private applyQueryParams(): void {
    const params = this.route.snapshot.queryParamMap;

    this.searchQuery = params.get('q') ?? '';

    const category = params.get('category');
    if (category) this.selectedTopCategory = category;

    const format = params.get('format');
    if (format === 'ONLINE' || format === 'IN_PERSON') {
      this.selectedTopFormat = format;
    }

    const price = params.get('price');
    if (price === 'FREE' || price === 'PAID') {
      this.selectedTopPrice = price;
    }

    const date = params.get('date');
    if (date && this.dateOptions.some((option) => option.value === date)) {
      this.selectedTopDate = date;
    }
  }

  openEvent(event: BackendEvent): void {
    void this.router.navigate(['/events', event.id]);
  }

  /**
   * Charge la page courante d'événements en déléguant filtrage,
   * tri et pagination au backend (EventFilter + EventPagination).
   */
  loadEvents(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.eventsApi
      .getEvents(this.buildQueryParams())
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (response) => {
          if (!response.success || !response.data) {
            this.events = [];
            this.totalCount = 0;
            this.totalPages = 1;
            this.errorMessage =
              response.message || 'Impossible de charger les événements.';
            return;
          }

          this.events = response.data.results ?? [];
          this.totalCount = response.data.count ?? this.events.length;
          this.totalPages = Math.max(1, response.data.total_pages || 1);
          this.currentPage = response.data.current_page || 1;

          this.logger.info('Événements chargés.', {
            count: this.totalCount,
            page: this.currentPage,
            totalPages: this.totalPages,
          });
        },
        error: (error: unknown) => {
          this.events = [];
          this.totalCount = 0;
          this.totalPages = 1;

          this.errorMessage =
            error instanceof HttpErrorResponse && error.status === 0
              ? 'Le serveur est inaccessible. Vérifie que le backend Django fonctionne.'
              : 'Une erreur est survenue lors du chargement des événements.';

          this.logger.warn('Échec du chargement des événements.');
        },
      });
  }

  /**
   * Charge les catégories puis, une fois disponibles, résout les query
   * params (qui peuvent contenir un nom au lieu d'un UUID) et charge
   * la première page.
   */
  private loadCategoriesAndEvents(): void {
    this.isLoadingCategories = true;

    this.eventsApi
      .getCategories()
      .pipe(finalize(() => (this.isLoadingCategories = false)))
      .subscribe({
        next: (response) => {
          this.categories =
            response.success && response.data
              ? response.data.filter((c) => c.is_active)
              : [];

          // Résout la catégorie passée en query param (nom OU uuid → uuid)
          this.resolveCategoryFromQuery();

          this.loadEvents();
        },
        error: () => {
          this.categories = [];
          this.logger.warn('Échec du chargement des catégories.');
          this.loadEvents();
        },
      });
  }

/**
 * Si `selectedTopCategory` contient un nom (venant de /events?category=Culture),
 * on le remplace par l'UUID correspondant trouvé dans `this.categories`.
 * Si c'est déjà un UUID, on ne touche à rien.
 */
private resolveCategoryFromQuery(): void {
  const raw = this.selectedTopCategory;
  if (!raw || raw === 'all') return;

  // Détection simple d'un UUID (36 chars, tirets aux positions 8, 13, 18, 23)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  if (isUuid) return;

  const match = this.categories.find(
    (c) => c.name.toLowerCase() === raw.toLowerCase() ||
           c.slug.toLowerCase() === raw.toLowerCase(),
  );

  if (match) {
    this.selectedTopCategory = match.id;
  } else {
    // Nom inconnu → on ignore le filtre plutôt que de renvoyer 400
    this.selectedTopCategory = 'all';
    this.logger.warn(`Catégorie inconnue reçue en query param : "${raw}"`);
  }
}

  /**
   * Construit les paramètres de requête à envoyer au backend
   * en fonction de l'état courant des filtres, du tri et de la page.
   */
  private buildQueryParams(): EventQueryParams {
    const params: EventQueryParams = {
      page: this.currentPage,
      page_size: this.pageSize,
    };

    // Recherche
    const search = this.searchQuery.trim();
    if (search) params.search = search;

    // Catégorie : le backend attend un UUID, jamais un nom.
    const category =
      this.selectedTopCategory !== 'all'
        ? this.selectedTopCategory
        : this.selectedCategories[0];
    if (category) params.category = category;

    // Format
    const format =
      this.selectedTopFormat !== 'all'
        ? this.selectedTopFormat
        : (this.selectedFormats[0] as EventFormatFilter | undefined);
    if (format && format !== 'all') params.format = format;

    // Prix
    const price =
      this.selectedTopPrice !== 'all'
        ? this.selectedTopPrice
        : (this.selectedPrices[0] as EventPriceFilter | undefined);
    if (price && price !== 'all') params.participation_type = price;

    // Date → start_date / end_date / upcoming
    const date =
      this.selectedTopDate !== 'all'
        ? this.selectedTopDate
        : this.selectedDates[0];
    if (date && date !== 'all') {
      const range = this.dateRange(date);
      if (range.start) params.start_date = range.start;
      if (range.end) params.end_date = range.end;
      if (date === 'today' || date === 'week') params.upcoming = true;
    }

    // Tri
    params.ordering = this.orderingForSort();

    return params;
  }

  /**
   * Convertit un filtre de date UI en plage [start, end] au format
   * YYYY-MM-DD, interprétée par Django via start_at__date__gte/lte.
   */
  private dateRange(filter: string): { start?: string; end?: string } {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    if (filter === 'today') {
      return { start: iso(now), end: iso(now) };
    }

    if (filter === 'week') {
      const end = new Date(now);
      end.setDate(now.getDate() + 7);
      return { start: iso(now), end: iso(end) };
    }

    if (filter === 'month') {
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: iso(now), end: iso(end) };
    }

    return {};
  }

  /**
   * Traduit le tri UI en paramètre `ordering` accepté par le backend.
   * Les valeurs doivent exister dans ALLOWED_ORDERING_FIELDS.
   */
  private orderingForSort(): string {
    switch (this.sortBy) {
      case 'date':
        return 'start_at';
      case 'price':
        return 'participation_type';
      case 'relevance':
      default:
        return 'RANDOM';
    }
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  /**
   * Appelé à chaque modification de filtre / recherche / tri.
   * Réinitialise la page et recharge depuis le serveur.
   */
  onFiltersChanged(): void {
    this.currentPage = 1;
    this.loadEvents();
  }

  toggleFilter(
    group: 'categories' | 'formats' | 'prices' | 'dates',
    value: string,
    event: Event,
  ): void {
    const checked = (event.target as HTMLInputElement).checked;

    const selections: Record<
      'categories' | 'formats' | 'prices' | 'dates',
      string[]
    > = {
      categories: this.selectedCategories,
      formats: this.selectedFormats,
      prices: this.selectedPrices,
      dates: this.selectedDates,
    };

    const selected = selections[group];

    if (checked && !selected.includes(value)) {
      selected.push(value);
    } else if (!checked) {
      const index = selected.indexOf(value);
      if (index !== -1) {
        selected.splice(index, 1);
      }
    }

    this.onFiltersChanged();
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.selectedTopCategory = 'all';
    this.selectedTopDate = 'all';
    this.selectedTopFormat = 'all';
    this.selectedTopPrice = 'all';

    this.selectedCategories = [];
    this.selectedFormats = [];
    this.selectedPrices = [];
    this.selectedDates = [];

    this.sortBy = 'relevance';
    this.currentPage = 1;

    this.loadEvents();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
    this.loadEvents();
  }

  closeEvent(): void {
    this.selectedEvent = null;
  }

  showNavigationNotice(action: string): void {
    this.actionMessage = `${action} sera disponible dans une prochaine étape.`;
  }

  clearNavigationNotice(): void {
    this.actionMessage = '';
  }

  formatPrice(event: BackendEvent): string {
    return event.participation_type === 'FREE' ? 'Gratuit' : 'Payant';
  }

  formatEventDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'Date à confirmer';
    }

    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  formatLabel(format: BackendEvent['format']): string {
    return format === 'ONLINE' ? 'En ligne' : 'En présentiel';
  }

  getEventImage(event: BackendEvent): string {
    return event.cover_image || 'img/FFFFFF.svg';
  }
}
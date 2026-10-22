
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

import { BackendEvent, EventCategory } from '../../../core/models/event.model';
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

  // Données reçues du backend.
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
    this.loadCategories();
    this.loadEvents();
  }

  /**
   * Charge les événements publiquement accessibles.
   * Le service API sera responsable de la communication HTTP.
   */
  loadEvents(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.eventsApi
      .getEvents()
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
          this.totalPages = Math.max(
            1,
            response.data.total_pages || 1,
          );
          this.currentPage = response.data.current_page || 1;

          this.logger.info('Événements chargés.', {
            count: this.totalCount,
            page: this.currentPage,
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

  /** Charge les catégories actives depuis le backend. */
  private loadCategories(): void {
    this.isLoadingCategories = true;

    this.eventsApi
      .getCategories()
      .pipe(finalize(() => (this.isLoadingCategories = false)))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.categories = response.data.filter(
              (category) => category.is_active,
            );
          } else {
            this.categories = [];
          }
        },
        error: () => {
          this.categories = [];
          this.logger.warn('Échec du chargement des catégories.');
        },
      });
  }

  /**
   * Liste affichée par le template.
   * Les filtres locaux seront raccordés aux paramètres réellement
   * acceptés par EventFilter lors de l'intégration du service API.
   */
  get filteredEvents(): BackendEvent[] {
    const query = this.searchQuery.trim().toLocaleLowerCase();

    return this.events.filter((event) => {
      const categoryName = event.category?.name ?? '';
      const searchableText = [
        event.title,
        event.short_description,
        event.city,
        categoryName,
      ]
        .join(' ')
        .toLocaleLowerCase();

      const matchesSearch =
        query.length === 0 || searchableText.includes(query);

      const selectedCategory =
        this.selectedTopCategory === 'all' ||
        categoryName === this.selectedTopCategory ||
        event.category?.id === this.selectedTopCategory;

      const matchesCategory =
        selectedCategory &&
        (this.selectedCategories.length === 0 ||
          this.selectedCategories.includes(categoryName));

      const matchesFormat =
        (this.selectedTopFormat === 'all' ||
          event.format === this.selectedTopFormat) &&
        (this.selectedFormats.length === 0 ||
          this.selectedFormats.includes(event.format));

      const matchesPrice =
        (this.selectedTopPrice === 'all' ||
          event.participation_type === this.selectedTopPrice) &&
        (this.selectedPrices.length === 0 ||
          this.selectedPrices.includes(event.participation_type));

      const matchesDate =
        this.matchesDateFilter(event.start_at, this.selectedTopDate) &&
        (this.selectedDates.length === 0 ||
          this.selectedDates.some((date) =>
            this.matchesDateFilter(event.start_at, date),
          ));

      return (
        matchesSearch &&
        matchesCategory &&
        matchesFormat &&
        matchesPrice &&
        matchesDate
      );
    });
  }

  /** Le backend fournit déjà une page de résultats. */
  get paginatedEvents(): BackendEvent[] {
    return [...this.filteredEvents].sort((a, b) => {
      if (this.sortBy === 'date') {
        return (
          new Date(a.start_at).getTime() -
          new Date(b.start_at).getTime()
        );
      }

      if (this.sortBy === 'price') {
        const priceRank = (event: BackendEvent): number =>
          event.participation_type === 'FREE' ? 0 : 1;

        return priceRank(a) - priceRank(b);
      }

      return 0;
    });
  }

  get pageNumbers(): number[] {
    return Array.from(
      { length: this.totalPages },
      (_, index) => index + 1,
    );
  }

  onFiltersChanged(): void {
    // Les paramètres précis de filtrage seront ajoutés au service
    // une fois alignés sur EventFilter du backend.
    this.currentPage = 1;
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
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
    // Le chargement d'une page précise sera raccordé à l'API paginée
    // dans le service, sans charger toute la base côté navigateur.
  }

  openEvent(event: BackendEvent): void {
    this.selectedEvent = event;
    this.actionMessage = '';
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

  private matchesDateFilter(startAt: string, filter: string): boolean {
    if (filter === 'all') {
      return true;
    }

    const eventDate = new Date(startAt);
    const now = new Date();

    if (Number.isNaN(eventDate.getTime())) {
      return false;
    }

    if (filter === 'today') {
      return eventDate.toDateString() === now.toDateString();
    }

    if (filter === 'week') {
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + 7);

      return eventDate >= now && eventDate <= endOfWeek;
    }

    if (filter === 'month') {
      return (
        eventDate.getMonth() === now.getMonth() &&
        eventDate.getFullYear() === now.getFullYear()
      );
    }

    return true;
  }
}

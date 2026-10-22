import { Component, HostListener, computed, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { EventService } from '../../../core/services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import { EventDto } from '../../../core/models/event.model';
import { toOrganizerEvent } from './evenement.mapper';

type EventStatus = 'published' | 'draft' | 'finished';
type EventFormat = 'Présentiel' | 'En ligne' | 'Hybride';
type StatusFilter = 'all' | EventStatus;
type DateFilter = 'all' | 'upcoming' | 'past' | 'month';
type ViewMode = 'list' | 'grid';

export interface OrganizerEvent {
  id: string;
  title: string;
  imageUrl: string;
  status: EventStatus;
  format: EventFormat;
  category: string;
  startDate: string;
  location: string;
  registered: number;
  capacity: number;
}

interface EventView extends OrganizerEvent {
  dateLabel: string;
}

const PAGE_SIZE = 6;

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return `${dateFormatter.format(d)} - ${timeFormatter.format(d)}`;
};

@Component({
  selector: 'app-organizer-events',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './evenements.component.html',
  styleUrl: './evenements.component.scss',
})
export class OrganizerEvenementsComponent implements OnInit, OnDestroy {
  private readonly eventService = inject(EventService);
  private readonly notification = inject(NotificationService);
  private readonly destroy$ = new Subject<void>();

  // ------------------------------------------------------------------
  // DONNÉES RÉELLES
  // ------------------------------------------------------------------
  readonly events = signal<OrganizerEvent[]>([]);
  readonly loading = signal(true);

  // ------------------------------------------------------------------
  // CONFIG UI
  // ------------------------------------------------------------------
  readonly statusTabs: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'draft', label: 'Brouillon' },
    { value: 'published', label: 'Publiés' },
    { value: 'finished', label: 'Terminés' },
  ];
  readonly statusLabel: Record<EventStatus, string> = {
    published: 'Publié',
    draft: 'Brouillon',
    finished: 'Terminé',
  };
  readonly formats: EventFormat[] = ['Présentiel', 'En ligne', 'Hybride'];
  readonly dateOptions: { value: DateFilter; label: string }[] = [
    { value: 'all', label: 'Date' },
    { value: 'upcoming', label: 'À venir' },
    { value: 'past', label: 'Passés' },
    { value: 'month', label: 'Ce mois-ci' },
  ];

  // ------------------------------------------------------------------
  // ÉTAT UI
  // ------------------------------------------------------------------
  readonly query = signal('');
  readonly status = signal<StatusFilter>('all');
  readonly format = signal<'all' | EventFormat>('all');
  readonly date = signal<DateFilter>('all');
  readonly category = signal('all');
  readonly view = signal<ViewMode>('list');

  readonly visibleCount = signal(PAGE_SIZE);
  readonly openMenuId = signal<string | null>(null);
  readonly deleteTarget = signal<EventView | null>(null);

  // ------------------------------------------------------------------
  // DONNÉES DÉRIVÉES
  // ------------------------------------------------------------------
  private readonly eventsVm = computed<EventView[]>(() =>
    this.events().map((e) => ({ ...e, dateLabel: formatDate(e.startDate) })),
  );

  readonly categories = computed(() =>
    [...new Set(this.events().map((e) => e.category))].sort((a, b) => a.localeCompare(b, 'fr')),
  );

  readonly filteredEvents = computed(() => {
    const q = normalize(this.query().trim());
    const status = this.status();
    const format = this.format();
    const category = this.category();
    const date = this.date();
    const now = new Date();

    return this.eventsVm().filter((e) => {
      if (status !== 'all' && e.status !== status) return false;
      if (format !== 'all' && e.format !== format) return false;
      if (category !== 'all' && e.category !== category) return false;

      if (date !== 'all') {
        const d = new Date(e.startDate);
        if (date === 'upcoming' && d < now) return false;
        if (date === 'past' && d >= now) return false;
        if (date === 'month' && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) {
          return false;
        }
      }

      if (q && !normalize(`${e.title} ${e.location} ${e.category}`).includes(q)) return false;
      return true;
    });
  });

  readonly visibleEvents = computed(() => this.filteredEvents().slice(0, this.visibleCount()));
  readonly remaining = computed(() => this.filteredEvents().length - this.visibleEvents().length);

  readonly hasActiveFilters = computed(
    () =>
      this.query().trim() !== '' ||
      this.status() !== 'all' ||
      this.format() !== 'all' ||
      this.date() !== 'all' ||
      this.category() !== 'all',
  );

  // ------------------------------------------------------------------
  // LIFECYCLE
  // ------------------------------------------------------------------
  ngOnInit(): void {
    this.loadEvents();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadEvents(): void {
    this.loading.set(true);
    console.info('[OrganizerEvents] Chargement des événements...');

    this.eventService
      .getMyEvents()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const dtos: EventDto[] = res.data?.results ?? [];
          this.events.set(dtos.map(toOrganizerEvent));
          this.loading.set(false);
          console.info(`[OrganizerEvents] ${dtos.length} événements chargés (total ${res.data?.count})`);
        },
        error: (err) => {
          this.loading.set(false);
          console.error('[OrganizerEvents] Échec du chargement', err.status);
          this.notification.httpError(err);
        },
      });
  }

  // ------------------------------------------------------------------
  // FILTRES
  // ------------------------------------------------------------------
  private resetPage(): void {
    this.visibleCount.set(PAGE_SIZE);
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.resetPage();
  }

  setStatus(value: StatusFilter): void {
    this.status.set(value);
    this.resetPage();
  }

  onFormat(event: Event): void {
    this.format.set((event.target as HTMLSelectElement).value as 'all' | EventFormat);
    this.resetPage();
  }

  onDate(event: Event): void {
    this.date.set((event.target as HTMLSelectElement).value as DateFilter);
    this.resetPage();
  }

  onCategory(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value);
    this.resetPage();
  }

  resetFilters(): void {
    this.query.set('');
    this.status.set('all');
    this.format.set('all');
    this.date.set('all');
    this.category.set('all');
    this.resetPage();
  }

  showMore(): void {
    this.visibleCount.update((n) => n + PAGE_SIZE);
  }

  // ------------------------------------------------------------------
  // ACTIONS BRANCHÉES SUR L'API
  // ------------------------------------------------------------------
  toggleMenu(id: string): void {
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  askDelete(event: EventView): void {
    this.openMenuId.set(null);
    this.deleteTarget.set(event);
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;

    this.eventService
      .deleteEvent(target.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.events.update((list) => list.filter((e) => e.id !== target.id));
          this.deleteTarget.set(null);
          this.notification.success('Événement supprimé.');
        },
        error: (err) => {
          this.notification.httpError(err);
        },
      });
  }

  toggleStatus(event: EventView): void {
    const isDraft = event.status === 'draft';
    const observable = isDraft
      ? this.eventService.publishEvent(event.id)
      : this.eventService.cancelEvent(event.id);

    observable.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        // ✅ Extraction dans une variable locale → narrowing conservé
        const data = res.data;
        if (!data) {
          this.notification.error('Réponse inattendue du serveur.');
          return;
        }
        const updated = toOrganizerEvent(data);
        this.events.update((list) => list.map((e) => (e.id === updated.id ? updated : e)));
        this.openMenuId.set(null);
        this.notification.success(isDraft ? 'Événement publié.' : 'Événement annulé.');
      },
      error: (err) => this.notification.httpError(err),
    });
  }

  duplicate(event: EventView): void {
    this.eventService
      .getEvent(event.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const src = res.data;
          if (!src) {
            this.notification.error('Impossible de charger l\'événement à dupliquer.');
            return;
          }

          this.eventService
            .createEvent({
              title: `${src.title} (copie)`,
              short_description: src.short_description,
              description: src.description ?? '',
              format: src.format,
              participation_type: src.participation_type,
              capacity_type: src.capacity_type,
              capacity_limit: src.capacity_limit ?? null,
              base_price: src.base_price ?? null,
              start_at: src.start_at,
              end_at: src.end_at,
              venue_name: src.venue_name,
              address: src.address,
              city: src.city,
              room: src.room,
              online_platform: src.online_platform,
              access_url: src.access_url,
              category: src.category.id,
            })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (created) => {
                // ✅ Extraction dans une variable locale AVANT le callback de signal
                const newData = created.data;
                if (!newData) {
                  this.notification.error('Création réussie mais réponse vide.');
                  return;
                }
                this.events.update((list) => [toOrganizerEvent(newData), ...list]);
                this.openMenuId.set(null);
                this.notification.success('Événement dupliqué.');
              },
              error: (err) => this.notification.httpError(err),
            });
        },
        error: (err) => this.notification.httpError(err),
      });
  }

  onImageError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }

  // ------------------------------------------------------------------
  // GLOBAL
  // ------------------------------------------------------------------
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.card__menu-wrap')) {
      this.openMenuId.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openMenuId.set(null);
    this.deleteTarget.set(null);
  }
}
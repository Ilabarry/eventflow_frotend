import { Component, HostListener, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type EventStatus = 'published' | 'draft' | 'finished';
type EventFormat = 'Présentiel' | 'En ligne' | 'Hybride';
type StatusFilter = 'all' | EventStatus;
type DateFilter = 'all' | 'upcoming' | 'past' | 'month';
type ViewMode = 'list' | 'grid';

interface OrganizerEvent {
  id: number;
  title: string;
  imageUrl: string;
  status: EventStatus;
  format: EventFormat;
  category: string;
  startDate: string; // ISO
  location: string;
  registered: number;
  capacity: number;
}

interface EventView extends OrganizerEvent {
  dateLabel: string;
}

const PAGE_SIZE = 6;

/* Images de démonstration — TODO : utiliser l'image réelle de chaque événement */
const IMAGES = [
  'photo-1540575467063-178a50c2df87',
  'photo-1505373877841-8d25f7d46678',
  'photo-1511578314322-379afb476865',
  'photo-1492684223066-81342ee5ff30',
];
const img = (i: number) => `https://images.unsplash.com/${IMAGES[i % IMAGES.length]}?w=600&q=80`;

/** Compare sans tenir compte des accents ni de la casse */
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
export class OrganizerEvenementsComponent {
  /* ------------------------------------------------------------------
     DONNÉES (mock) — TODO : remplacer par ton service d'événements
     ------------------------------------------------------------------ */
  readonly events = signal<OrganizerEvent[]>([
    { id: 1, title: 'Tech Conférence', imageUrl: img(0), status: 'published', format: 'Hybride', category: 'Conférence', startDate: '2026-11-30T14:00:00', location: 'Dakar', registered: 480, capacity: 500 },
    { id: 2, title: 'Python Workshop', imageUrl: img(1), status: 'draft', format: 'En ligne', category: 'Formation', startDate: '2026-12-15T10:00:00', location: 'En ligne', registered: 0, capacity: 50 },
    { id: 3, title: "Salon de l'Entrepreneuriat", imageUrl: img(2), status: 'published', format: 'Présentiel', category: 'Salon', startDate: '2026-11-14T09:00:00', location: 'Dakar', registered: 210, capacity: 300 },
    { id: 4, title: 'Hackathon Innovation', imageUrl: img(3), status: 'published', format: 'Hybride', category: 'Hackathon', startDate: '2026-12-05T08:30:00', location: 'Dakar', registered: 96, capacity: 120 },
    { id: 5, title: 'Masterclass UX Design', imageUrl: img(1), status: 'published', format: 'En ligne', category: 'Masterclass', startDate: '2026-11-08T18:00:00', location: 'En ligne', registered: 150, capacity: 200 },
    { id: 6, title: 'Festival Jazz de Thiès', imageUrl: img(2), status: 'draft', format: 'Présentiel', category: 'Festival', startDate: '2027-05-20T20:00:00', location: 'Thiès', registered: 0, capacity: 2000 },
    { id: 7, title: 'Startup Pitch Night', imageUrl: img(3), status: 'published', format: 'Présentiel', category: 'Networking', startDate: '2026-10-29T19:00:00', location: 'Dakar', registered: 80, capacity: 100 },
    { id: 8, title: 'Webinaire Cybersécurité', imageUrl: img(0), status: 'published', format: 'En ligne', category: 'Webinaire', startDate: '2026-10-25T16:00:00', location: 'En ligne', registered: 320, capacity: 500 },
    { id: 9, title: 'Forum Emploi Jeunes', imageUrl: img(1), status: 'finished', format: 'Présentiel', category: 'Forum', startDate: '2026-09-18T09:00:00', location: 'Dakar', registered: 640, capacity: 700 },
    { id: 10, title: 'Atelier Photographie', imageUrl: img(2), status: 'finished', format: 'Présentiel', category: 'Atelier', startDate: '2026-09-05T10:00:00', location: 'Mbour', registered: 28, capacity: 30 },
    { id: 11, title: 'Conférence IA & Société', imageUrl: img(3), status: 'finished', format: 'Hybride', category: 'Conférence', startDate: '2026-08-22T15:00:00', location: 'Dakar', registered: 410, capacity: 450 },
    { id: 12, title: 'Bootcamp Web Full Stack', imageUrl: img(0), status: 'draft', format: 'Hybride', category: 'Formation', startDate: '2027-01-12T09:00:00', location: 'Dakar', registered: 0, capacity: 40 },
  ]);

  /* ------------------------------------------------------------------
     CONFIG UI
     ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
     ÉTAT (filtres, vue, menus)
     ------------------------------------------------------------------ */
  readonly query = signal('');
  readonly status = signal<StatusFilter>('all');
  readonly format = signal<'all' | EventFormat>('all');
  readonly date = signal<DateFilter>('all');
  readonly category = signal('all');
  readonly view = signal<ViewMode>('list');

  readonly visibleCount = signal(PAGE_SIZE);
  readonly openMenuId = signal<number | null>(null);
  readonly deleteTarget = signal<EventView | null>(null);

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
     ACTIONS FILTRES
     ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------
     ACTIONS ÉVÉNEMENT (TODO : brancher sur l'API)
     ------------------------------------------------------------------ */
  toggleMenu(id: number): void {
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  toggleStatus(event: EventView): void {
    this.events.update((list) =>
      list.map((e) =>
        e.id === event.id && e.status !== 'finished'
          ? { ...e, status: e.status === 'published' ? 'draft' : 'published' }
          : e,
      ),
    );
    this.openMenuId.set(null);
  }

  duplicate(event: EventView): void {
    const nextId = Math.max(0, ...this.events().map((e) => e.id)) + 1;
    const { dateLabel: _ignored, ...base } = event;
    this.events.update((list) => [
      ...list,
      { ...base, id: nextId, title: `${event.title} (copie)`, status: 'draft', registered: 0 },
    ]);
    this.openMenuId.set(null);
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
    if (target) this.events.update((list) => list.filter((e) => e.id !== target.id));
    this.deleteTarget.set(null);
  }

  onImageError(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }

  /* ------------------------------------------------------------------
     ÉVÉNEMENTS GLOBAUX
     ------------------------------------------------------------------ */
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
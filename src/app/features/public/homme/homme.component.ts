import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { BackendEvent, EventCategory } from '../../../core/models/event.model';
import { AppLoggerService } from '../../../core/services/app-logger.service';
import { EventsApiService } from '../../../core/services/events-api.service';

interface HeroSlide {
  key: string;
  image: string;
  tag: string;
  title: string;
  meta: string;
  link: string | (string | number)[];
}

interface HowStep {
  title: string;
  text: string;
  icon: string[];
}

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1400&q=85';

const FALLBACK_SLIDE: HeroSlide = {
  key: 'fallback',
  image: FALLBACK_IMAGE,
  tag: 'EVENTFLOW',
  title: 'Des événements pour chaque passion',
  meta: 'Conférences, ateliers, festivals…',
  link: '/events',
};

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Icône d'une catégorie, selon des mots-clés de son nom */
const CATEGORY_ICONS: { keys: string[]; icon: string[] }[] = [
  {
    keys: ['tech', 'digital', 'numerique', 'informatique', 'hackathon', 'data'],
    icon: ['M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z', 'M8 21h8', 'M12 17v4'],
  },
  {
    keys: ['business', 'entrepren', 'affaire', 'financ', 'network', 'startup', 'marketing'],
    icon: ['M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
  },
  {
    keys: ['educat', 'formation', 'atelier', 'workshop', 'etudiant', 'univers', 'ecole'],
    icon: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  },
  {
    keys: ['culture', 'festival', 'musique', 'concert', 'cinema', 'danse', 'theatre', 'exposition'],
    icon: ['M9 18V5l12-2v13', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  },
  {
    keys: ['sport', 'fitness', 'marathon', 'football'],
    icon: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  },
  {
    keys: ['sante', 'bien-etre', 'medic', 'yoga'],
    icon: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'],
  },
  {
    keys: ['gastronom', 'cuisine', 'food', 'restaur'],
    icon: ['M18 8h1a4 4 0 0 1 0 8h-1', 'M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z', 'M6 1v3', 'M10 1v3', 'M14 1v3'],
  },
];

const DEFAULT_ICON = ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'];

@Component({
  selector: 'app-homme',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './homme.component.html',
  styleUrl: './homme.component.scss',
})
export class HommeComponent implements OnInit, OnDestroy {
  private readonly eventsApi = inject(EventsApiService);
  private readonly logger = inject(AppLoggerService);
  private readonly router = inject(Router);

  /* ------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------ */
  readonly dateOptions = [
    { label: "Aujourd'hui", value: 'today' },
    { label: 'Cette semaine', value: 'week' },
    { label: 'Ce mois-ci', value: 'month' },
  ];
  readonly formats = [
    { label: 'En présentiel', value: 'IN_PERSON' },
    { label: 'En ligne', value: 'ONLINE' },
  ];
  readonly priceOptions = [
    { label: 'Gratuit', value: 'FREE' },
    { label: 'Payant', value: 'PAID' },
  ];

  readonly steps: HowStep[] = [
    {
      title: 'Découvrez',
      text: 'Parcourez les événements près de chez vous ou en ligne.',
      icon: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    },
    {
      title: 'Inscrivez-vous',
      text: 'Réservez votre place en quelques clics.',
      icon: ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M20 8v6', 'M23 11h-6'],
    },
    {
      title: 'Recevez votre ticket',
      text: 'Retrouvez-le à tout moment dans votre espace.',
      icon: [
        'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z',
        'M13 5v2', 'M13 11v2', 'M13 17v2',
      ],
    },
    {
      title: 'Participez',
      text: 'Vivez l’événement et repartez avec votre attestation.',
      icon: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
    },
  ];

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  events: BackendEvent[] = [];
  featuredEvents: BackendEvent[] = [];
  categories: EventCategory[] = [];
  topCategories: EventCategory[] = [];
  totalCount = 0;

  isLoading = true;
  isLoadingCategories = true;
  errorMessage = '';

  // Recherche (transmise à la page Événements)
  searchQuery = '';
  selectedCategory = 'all';
  selectedDate = 'all';
  selectedFormat = 'all';
  selectedPrice = 'all';

  // Carrousel
  heroSlides: HeroSlide[] = [FALLBACK_SLIDE];
  activeSlide = 0;
  autoplay = true;
  private held = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly reducedMotion =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  ngOnInit(): void {
    if (this.reducedMotion) this.autoplay = false;
    this.loadEvents();
    this.loadCategories();
    this.startTimer();
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  loadEvents(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.eventsApi
      .getEvents()
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (response) => {
          if (!response.success || !response.data) {
            this.resetEvents();
            this.errorMessage = response.message || 'Impossible de charger les événements.';
            return;
          }
          this.events = response.data.results ?? [];
          this.totalCount = response.data.count ?? this.events.length;
          this.buildFeatured();
        },
        error: (error: unknown) => {
          this.resetEvents();
          this.errorMessage =
            error instanceof HttpErrorResponse && error.status === 0
              ? 'Le serveur est inaccessible. Réessayez dans quelques instants.'
              : 'Une erreur est survenue lors du chargement des événements.';
          this.logger.warn('Échec du chargement des événements (accueil).');
        },
      });
  }

  private loadCategories(): void {
    this.isLoadingCategories = true;

    this.eventsApi
      .getCategories()
      .pipe(finalize(() => (this.isLoadingCategories = false)))
      .subscribe({
        next: (response) => {
          this.categories =
            response.success && response.data ? response.data.filter((c) => c.is_active) : [];
          this.topCategories = this.categories.slice(0, 6);
        },
        error: () => {
          this.categories = [];
          this.topCategories = [];
          this.logger.warn('Échec du chargement des catégories (accueil).');
        },
      });
  }

  private resetEvents(): void {
    this.events = [];
    this.featuredEvents = [];
    this.totalCount = 0;
    this.heroSlides = [FALLBACK_SLIDE];
    this.activeSlide = 0;
  }

  /** À venir d'abord (du plus proche au plus lointain), puis les événements passés */
  private rankedEvents(): BackendEvent[] {
    const now = Date.now();
    const time = (e: BackendEvent): number => new Date(e.start_at).getTime();
    const valid = this.events.filter((e) => !Number.isNaN(time(e)));
    const upcoming = valid.filter((e) => time(e) >= now).sort((a, b) => time(a) - time(b));
    const past = valid.filter((e) => time(e) < now).sort((a, b) => time(b) - time(a));
    return [...upcoming, ...past];
  }

  private buildFeatured(): void {
    const ranked = this.rankedEvents();
    this.featuredEvents = ranked.slice(0, 4);

    const withCover = ranked.filter((e) => !!e.cover_image).slice(0, 3);
    this.heroSlides = withCover.length
      ? withCover.map((e) => ({
          key: String(e.id),
          image: e.cover_image as string,
          tag: e.category?.name ?? 'Événement',
          title: e.title,
          meta: `${this.formatShortDate(e.start_at)} · ${e.city || this.formatLabel(e.format)}`,
          link: ['/events', e.id as string | number],
        }))
      : [FALLBACK_SLIDE];

    this.activeSlide = 0;
    this.restartTimer();
  }

  /* ------------------------------------------------------------------
     RECHERCHE : ouvre la page Événements avec les filtres choisis
     ------------------------------------------------------------------ */
  search(): void {
    const params: Record<string, string> = {};
    const query = this.searchQuery.trim();

    if (query) params['q'] = query;
    if (this.selectedCategory !== 'all') params['category'] = this.selectedCategory;
    if (this.selectedDate !== 'all') params['date'] = this.selectedDate;
    if (this.selectedFormat !== 'all') params['format'] = this.selectedFormat;
    if (this.selectedPrice !== 'all') params['price'] = this.selectedPrice;

    void this.router.navigate(['/events'], { queryParams: params });
  }

  /* ------------------------------------------------------------------
     CARROUSEL
     ------------------------------------------------------------------ */
  goToSlide(index: number): void {
    this.activeSlide = (index + this.heroSlides.length) % this.heroSlides.length;
    this.restartTimer();
  }

  nextSlide(): void {
    this.goToSlide(this.activeSlide + 1);
  }

  toggleAutoplay(): void {
    this.autoplay = !this.autoplay;
    this.restartTimer();
  }

  holdAutoplay(): void {
    this.held = true;
    this.stopTimer();
  }

  releaseAutoplay(): void {
    this.held = false;
    this.startTimer();
  }

  private startTimer(): void {
    this.stopTimer();
    if (!this.autoplay || this.held || this.heroSlides.length < 2 || this.reducedMotion) return;
    this.timer = setInterval(() => {
      this.activeSlide = (this.activeSlide + 1) % this.heroSlides.length;
    }, 6000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private restartTimer(): void {
    this.startTimer();
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  categoryIcon(name: string): string[] {
    const text = normalize(name);
    return CATEGORY_ICONS.find((c) => c.keys.some((k) => text.includes(k)))?.icon ?? DEFAULT_ICON;
  }

  getEventImage(event: BackendEvent): string {
    return event.cover_image || 'img/FFFFFF.svg';
  }

  formatLabel(format: BackendEvent['format']): string {
    return format === 'ONLINE' ? 'En ligne' : 'En présentiel';
  }

  formatPrice(event: BackendEvent): string {
    return event.participation_type === 'FREE' ? 'Gratuit' : 'Payant';
  }

  formatShortDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date à confirmer';
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }
}
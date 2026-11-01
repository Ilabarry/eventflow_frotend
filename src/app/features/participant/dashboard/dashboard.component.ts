import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiResponse, PaginatedResponse } from '../../../core/models/api-response.model';
import { CertificateService } from '../../../core/services/certificate.service';
import {
  DashboardService,
  ParticipantDashboardDto,
  ParticipantDashboardRegistrationDto,
} from '../../../core/services/dashboard.service';
import { MyTicketDto, TicketService } from '../../../core/services/ticket.service';

/* ------------------------------------------------------------------
 * Constantes de la page
 * ------------------------------------------------------------------ */
const OTHER_EVENTS_COUNT = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Marge pour absorber les décalages timezone / cache serveur. */
const UPCOMING_MARGIN_MS = 60 * 60 * 1000; // 1 heure

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

type LoadState = 'loading' | 'ready' | 'error';

/* ------------------------------------------------------------------
 * Modèles d'affichage
 * ------------------------------------------------------------------ */
interface EventCard {
  registrationId: string;
  eventId: string;
  title: string;
  coverImage: string | null;
  startIso: string;
  whenLabel: string;
  isOnline: boolean;
  placeLabel: string;
  isPending: boolean;
}

interface NextEvent extends EventCard {
  countdownLabel: string;
  hasTicket: boolean;
  ticketTypeName: string | null;
}

interface Counter {
  label: string;
  value: number | null;
  tone: 'success' | 'violet' | 'neutral';
  link: string;
}

interface DashboardData {
  dashboard: ParticipantDashboardDto;
  ticketCount: number | null;
  certificateCount: number | null;
  nextTicket: MyTicketDto | null;
}

function toEventCard(item: ParticipantDashboardRegistrationDto): EventCard {
  const event = item.event;
  const start = new Date(event.start_at);
  const isOnline = event.format === 'ONLINE';

  return {
    registrationId: item.id,
    eventId: event.id,
    title: event.title,
    coverImage: event.cover_image,
    startIso: event.start_at,
    whenLabel: `${DATE_FORMAT.format(start)} · ${TIME_FORMAT.format(start).replace(':', 'h')}`,
    isOnline,
    placeLabel: isOnline ? 'En ligne' : event.city || event.venue_name || 'Lieu à préciser',
    isPending: item.status === 'PENDING',
  };
}

/** « Aujourd'hui », « Demain » ou « Dans N jours », en jours de calendrier. */
function countdownLabel(startIso: string, now: Date): string {
  const start = new Date(startIso);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startDay - today) / DAY_MS);

  if (days <= 0) return "Aujourd'hui";
  return days === 1 ? 'Demain' : `Dans ${days} jours`;
}

/** Vrai si la date de début est dans le futur (avec marge de sécurité). */
function isUpcomingIso(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > Date.now() - UPCOMING_MARGIN_MS;
}

function countOf<T>(request: Observable<ApiResponse<PaginatedResponse<T>>>): Observable<number | null> {
  return request.pipe(
    map((response) => response.data?.count ?? null),
    catchError(() => of(null)),
  );
}

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParticipantDashboardComponent {
  private readonly authService = inject(AuthService);
  private readonly dashboardService = inject(DashboardService);
  private readonly ticketService = inject(TicketService);
  private readonly certificateService = inject(CertificateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loadState = signal<LoadState>('loading');
  readonly nextEvent = signal<NextEvent | null>(null);
  readonly otherEvents = signal<EventCard[]>([]);
  readonly counters = signal<Counter[]>([]);

  /**
   * Vrai si l'utilisateur a des inscriptions en base, mais qu'aucune n'est
   * à venir (toutes passées). Sert à afficher un message différent.
   */
  readonly hasPastOnly = signal(false);

  readonly firstName = computed(() => this.authService.currentUser()?.first_name?.trim() ?? '');

  constructor() {
    this.load();
  }

  retry(): void {
    this.load();
  }

  formatCount(value: number | null): string {
    return value === null ? '—' : String(value).padStart(2, '0');
  }

  /* --- chargement ------------------------------------------------------ */
  private load(): void {
    this.loadState.set('loading');
    this.hasPastOnly.set(false);

    this.dashboardService
      .getParticipantDashboard()
      .pipe(
        switchMap((response) => {
          if (!response.data) {
            throw new Error('Réponse du dashboard sans données');
          }

          // ⚠️ Filtrage défensif : ne garder que les inscriptions dont
          // l'événement est réellement à venir (marge de sécurité pour
          // absorber les décalages timezone / cache serveur).
          const allRegistrations = response.data.upcoming_registrations ?? [];
          const trulyUpcoming = allRegistrations
            .filter((r) => r?.event && isUpcomingIso(r.event.start_at))
            .sort(
              (a, b) =>
                new Date(a.event.start_at).getTime() -
                new Date(b.event.start_at).getTime(),
            );

          // Si le backend a renvoyé des inscriptions mais qu'on les a toutes
          // écartées, on mémorise qu'elles sont passées.
          const dashboardWithFiltered: ParticipantDashboardDto = {
            ...response.data,
            upcoming_registrations: trulyUpcoming,
          };

          const next = trulyUpcoming[0] ?? null;

          return forkJoin({
            dashboard: of(dashboardWithFiltered),
            ticketCount: countOf(this.ticketService.listMine({ page: 1, pageSize: 1 })),
            certificateCount: countOf(this.certificateService.listMine(1, 1)),
            nextTicket: next ? this.ticketOf(next.event.id) : of(null),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => this.applyData(data),
        error: (err) => {
          console.error('[Dashboard] load failed', err);
          this.loadState.set('error');
        },
      });
  }

  /** Ticket du participant pour un événement. */
  private ticketOf(eventId: string): Observable<MyTicketDto | null> {
    return this.ticketService.listMine({ page: 1, pageSize: 1, eventId }).pipe(
      map((response) => response.data?.results[0] ?? null),
      catchError(() => of(null)),
    );
  }

  private applyData(data: DashboardData): void {
    const { summary, upcoming_registrations: upcoming = [] } = data.dashboard;
    const [first, ...others] = upcoming;

    this.nextEvent.set(
      first
        ? {
            ...toEventCard(first),
            countdownLabel: countdownLabel(first.event.start_at, new Date()),
            hasTicket: data.nextTicket !== null,
            ticketTypeName: data.nextTicket?.ticket_type_name ?? null,
          }
        : null,
    );

    this.otherEvents.set(others.slice(0, OTHER_EVENTS_COUNT).map(toEventCard));

    // « Passés uniquement » : aucune inscription à venir MAIS au moins une
    // inscription comptée dans le résumé.
    this.hasPastOnly.set(upcoming.length === 0 && summary.total_registrations > 0);

    this.counters.set([
      { label: 'Inscriptions', value: summary.total_registrations, tone: 'success', link: '/participant/inscriptions' },
      { label: 'Tickets', value: data.ticketCount, tone: 'violet', link: '/participant/tickets' },
      { label: 'Mes attestations', value: data.certificateCount, tone: 'neutral', link: '/participant/attestations' },
    ]);

    this.loadState.set('ready');
  }
}
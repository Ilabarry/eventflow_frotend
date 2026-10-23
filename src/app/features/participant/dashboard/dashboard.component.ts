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
/** Nombre de cartes sous « Prochains événements » (après le prochain). */
const OTHER_EVENTS_COUNT = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

type LoadState = 'loading' | 'ready' | 'error';

/* ------------------------------------------------------------------
 * Modèles d'affichage (préparés ici, pas dans le HTML)
 * ------------------------------------------------------------------ */
interface EventCard {
  registrationId: string;
  eventId: string;
  title: string;
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
  value: number | null; // null : donnée indisponible
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

  if (days <= 0) {
    return "Aujourd'hui";
  }
  return days === 1 ? 'Demain' : `Dans ${days} jours`;
}

/** Un compteur secondaire en échec n'empêche pas d'afficher la page. */
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

  /** Prénom affiché dans le bandeau (vide tant que le profil n'est pas chargé). */
  readonly firstName = computed(() => this.authService.currentUser()?.first_name?.trim() ?? '');

  constructor() {
    this.load();
  }

  retry(): void {
    this.load();
  }

  /** « 5 » → « 05 », comme sur la maquette. */
  formatCount(value: number | null): string {
    return value === null ? '—' : String(value).padStart(2, '0');
  }

  /* --- chargement ------------------------------------------------------ */
  private load(): void {
    this.loadState.set('loading');

    this.dashboardService
      .getParticipantDashboard()
      .pipe(
        switchMap((response) => {
          if (!response.data) {
            throw new Error('Réponse du dashboard sans données');
          }
          const next = response.data.upcoming_registrations[0] ?? null;

          // Les 3 requêtes secondaires partent en parallèle.
          return forkJoin({
            dashboard: of(response.data),
            ticketCount: countOf(this.ticketService.listMine({ page: 1, pageSize: 1 })),
            certificateCount: countOf(this.certificateService.listMine(1, 1)),
            nextTicket: next ? this.ticketOf(next.event.id) : of(null),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => this.applyData(data),
        // Le détail technique n'est pas montré : l'intercepteur gère 401/403.
        error: () => this.loadState.set('error'),
      });
  }

  /** Ticket du participant pour un événement (type de billet, lien). */
  private ticketOf(eventId: string): Observable<MyTicketDto | null> {
    return this.ticketService.listMine({ page: 1, pageSize: 1, eventId }).pipe(
      map((response) => response.data?.results[0] ?? null),
      catchError(() => of(null)),
    );
  }

  private applyData(data: DashboardData): void {
    const { summary, upcoming_registrations: upcoming } = data.dashboard;
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
    this.counters.set([
      { label: 'Inscriptions', value: summary.total_registrations, tone: 'success', link: '/participant/inscriptions' },
      { label: 'Tickets', value: data.ticketCount, tone: 'violet', link: '/participant/tickets' },
      { label: 'Mes attestations', value: data.certificateCount, tone: 'neutral', link: '/participant/attestations' },
    ]);
    this.loadState.set('ready');
  }
}

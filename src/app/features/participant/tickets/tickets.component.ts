import { ViewportScroller } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, debounceTime, forkJoin, from, map, of, switchMap } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { PaginatedResponse } from '../../../core/models/api-response.model';
import {
  ApiTicketStatus,
  MyTicketDto,
  TicketDetailDto,
  TicketService,
} from '../../../core/services/ticket.service';

/* ------------------------------------------------------------------
 * Constantes de la page
 * ------------------------------------------------------------------ */
const PAGE_SIZE = 6;
const SEARCH_DEBOUNCE_MS = 400;
const MAX_VISIBLE_PAGES = 5;
/** Taille de l'image du QR : assez grande pour être scannée une fois agrandie. */
const QR_SIZE_PX = 320;

type LoadState = 'loading' | 'ready' | 'error';
type StatusTone = 'success' | 'info' | 'neutral' | 'danger';

interface StatusFilter {
  label: string;
  value: ApiTicketStatus | null;
}

/** Onglets : ils correspondent au filtre ?status= du backend. */
const STATUS_FILTERS: readonly StatusFilter[] = [
  { label: 'Tous', value: null },
  { label: 'Valides', value: 'VALID' },
  { label: 'Utilisés', value: 'USED' },
  { label: 'Expirés', value: 'EXPIRED' },
];

const STATUS_DISPLAY: Record<ApiTicketStatus, { label: string; tone: StatusTone }> = {
  VALID: { label: 'Valide', tone: 'success' },
  USED: { label: 'Utilisé', tone: 'info' },
  EXPIRED: { label: 'Expiré', tone: 'neutral' },
  CANCELLED: { label: 'Annulé', tone: 'danger' },
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* ------------------------------------------------------------------
 * Modèle d'affichage d'une carte
 * ------------------------------------------------------------------ */
interface TicketCard {
  id: string;
  reference: string;
  eventTitle: string;
  coverImage: string | null;
  ticketTypeName: string;
  statusLabel: string;
  statusTone: StatusTone;
  isValid: boolean;
  /** null si le détail n'a pas pu être chargé. */
  startIso: string | null;
  whenLabel: string | null;
  isOnline: boolean;
  placeLabel: string | null;
  /** Image du QR (data:image/png), seulement pour un ticket valide. */
  qrImage: string | null;
}

function placeOf(detail: TicketDetailDto): string {
  if (detail.event_format === 'ONLINE') {
    return 'En ligne';
  }
  const kind = detail.event_format === 'HYBRID' ? 'Hybride' : 'Présentiel';
  return [detail.event_city || detail.event_venue, kind].filter(Boolean).join(' · ');
}

function toCard(ticket: MyTicketDto, detail: TicketDetailDto | null, qrImage: string | null): TicketCard {
  const status = STATUS_DISPLAY[ticket.status];
  const start = detail ? new Date(detail.event_start_at) : null;

  return {
    id: ticket.id,
    reference: ticket.reference,
    eventTitle: ticket.event_title,
    coverImage: ticket.event_cover_image,
    ticketTypeName: ticket.ticket_type_name,
    statusLabel: status.label,
    statusTone: status.tone,
    isValid: ticket.status === 'VALID',
    startIso: detail?.event_start_at ?? null,
    whenLabel: start ? `${DATE_FORMAT.format(start)} · ${TIME_FORMAT.format(start).replace(':', 'h')}` : null,
    isOnline: detail?.event_format === 'ONLINE',
    placeLabel: detail ? placeOf(detail) : null,
    qrImage,
  };
}

/** Numéros de page affichés : au plus 5, centrés sur la page courante. */
function visiblePages(current: number, total: number): number[] {
  const count = Math.min(MAX_VISIBLE_PAGES, total);
  let first = Math.max(1, current - Math.floor(count / 2));
  first = Math.min(first, total - count + 1);
  return Array.from({ length: count }, (_, index) => first + index);
}

interface Query {
  page: number;
  status: ApiTicketStatus | null;
  search: string;
}

type LoadResult =
  | { ok: true; page: PaginatedResponse<MyTicketDto>; cards: TicketCard[] }
  | { ok: false };

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './tickets.component.html',
  styleUrl: './tickets.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParticipantTicketsComponent {
  private readonly ticketService = inject(TicketService);
  private readonly authService = inject(AuthService);
  private readonly viewportScroller = inject(ViewportScroller);

  private readonly qrDialog = viewChild.required<ElementRef<HTMLDialogElement>>('qrDialog');

  readonly statusFilters = STATUS_FILTERS;

  // État de la page
  readonly activeStatus = signal<ApiTicketStatus | null>(null);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly loadState = signal<LoadState>('loading');
  readonly cards = signal<TicketCard[]>([]);
  readonly totalCount = signal(0);
  readonly totalPages = signal(1);
  /** Ticket affiché en grand dans la fenêtre. */
  readonly openedTicket = signal<TicketCard | null>(null);

  // Valeurs dérivées
  readonly pages = computed(() => visiblePages(this.currentPage(), this.totalPages()));
  readonly hasActiveFilter = computed(() => this.activeStatus() !== null || this.searchTerm() !== '');
  /** Les tickets de /tickets/my/ sont ceux de l'utilisateur connecté. */
  readonly holderName = computed(() => this.authService.currentUser()?.full_name ?? '');

  private readonly query$ = new Subject<Query>();
  private readonly searchInput$ = new Subject<string>();

  constructor() {
    // switchMap annule le chargement précédent si un filtre change entre-temps.
    this.query$
      .pipe(
        switchMap((query) => this.fetchPage(query)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.applyResult(result));

    this.searchInput$
      .pipe(
        map((value) => value.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        takeUntilDestroyed(),
      )
      .subscribe((term) => {
        if (term === this.searchTerm()) {
          return;
        }
        this.searchTerm.set(term);
        this.currentPage.set(1);
        this.load();
      });

    this.load();
  }

  /* --- actions de l'utilisateur ------------------------------------- */
  selectStatus(status: ApiTicketStatus | null): void {
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

  openTicket(card: TicketCard): void {
    this.openedTicket.set(card);
    this.qrDialog().nativeElement.showModal();
  }

  closeTicket(): void {
    this.qrDialog().nativeElement.close();
  }

  /** Clic sur le fond sombre : le clic arrive sur le <dialog> lui-même. */
  onDialogClick(event: MouseEvent): void {
    if (event.target === this.qrDialog().nativeElement) {
      this.closeTicket();
    }
  }

  /* --- chargement ------------------------------------------------------ */
  private load(): void {
    this.loadState.set('loading');
    this.query$.next({ page: this.currentPage(), status: this.activeStatus(), search: this.searchTerm() });
  }

  /**
   * 1 requête pour la liste, puis 1 requête de détail par ticket
   * (la liste du backend ne contient ni la date, ni le lieu, ni le QR).
   */
  private fetchPage(query: Query): Observable<LoadResult> {
    return this.ticketService
      .listMine({ page: query.page, pageSize: PAGE_SIZE, status: query.status, search: query.search })
      .pipe(
        switchMap((response) => {
          const page = response.data;
          if (!page) {
            return of<LoadResult>({ ok: false });
          }
          if (page.results.length === 0) {
            return of<LoadResult>({ ok: true, page, cards: [] });
          }
          return forkJoin(page.results.map((ticket) => this.buildCard(ticket))).pipe(
            map((cards): LoadResult => ({ ok: true, page, cards })),
          );
        }),
        catchError(() => of<LoadResult>({ ok: false })),
      );
  }

  /** Un détail en échec n'empêche pas d'afficher la carte, sans date ni QR. */
  private buildCard(ticket: MyTicketDto): Observable<TicketCard> {
    return this.ticketService.getDetail(ticket.id).pipe(
      map((response) => response.data ?? null),
      catchError(() => of(null)),
      switchMap((detail) =>
        this.qrImageOf(ticket, detail).pipe(map((qrImage) => toCard(ticket, detail, qrImage))),
      ),
    );
  }

  /** Le QR n'a de sens que pour un ticket encore valide. */
  private qrImageOf(ticket: MyTicketDto, detail: TicketDetailDto | null): Observable<string | null> {
    if (ticket.status !== 'VALID' || !detail?.qr_payload) {
      return of(null);
    }
    // Chargement à la demande : la bibliothèque n'alourdit pas le reste de l'application.
    // « qrcode » est un module CommonJS : en import dynamique, ses fonctions
    // arrivent sous « default ».
    const payload = detail.qr_payload;
    return from(
      import('qrcode').then((module) => {
        const qrcode = module.default ?? module;
        return qrcode.toDataURL(payload, { width: QR_SIZE_PX, margin: 1, errorCorrectionLevel: 'M' });
      }),
    ).pipe(catchError(() => of(null)));
  }

  private applyResult(result: LoadResult): void {
    if (!result.ok) {
      this.loadState.set('error');
      return;
    }
    this.cards.set(result.cards);
    this.totalCount.set(result.page.count);
    this.totalPages.set(Math.max(1, result.page.total_pages));
    this.currentPage.set(result.page.current_page);
    this.loadState.set('ready');
  }
}

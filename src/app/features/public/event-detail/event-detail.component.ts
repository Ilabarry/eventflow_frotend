import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { BackendEvent, EventDetail, EventTicketType } from '../../../core/models/event.model';
import { AppLoggerService } from '../../../core/services/app-logger.service';
import { EventsApiService } from '../../../core/services/events-api.service';

type DetailState = 'loading' | 'ready' | 'notfound' | 'error';
type CtaState = 'open' | 'past' | 'full';

interface InfoItem {
  label: string;
  value: string;
  sub?: string;
  icon: string[];
}

interface TicketOption {
  id: string;
  name: string;
  priceLabel: string;
  description: string;
  remaining: number | null; // null = illimité
}

const ICONS = {
  calendar: [
    'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
    'M16 2v4', 'M8 2v4', 'M3 10h18',
  ],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  pin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  globe: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20',
    'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  ],
  tag: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
  users: [
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75',
  ],
};

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const numberFmt = new Intl.NumberFormat('fr-FR');

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './event-detail.component.html',
  styleUrl: './event-detail.component.scss',
})
export class EventDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly eventsApi = inject(EventsApiService);
  private readonly logger = inject(AppLoggerService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly destroyRef = inject(DestroyRef);

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  state: DetailState = 'loading';
  errorMessage = '';

  detail: EventDetail | null = null;
  info: InfoItem[] = [];
  ticketOptions: TicketOption[] = [];
  selectedTicketId: string | null = null;
  similar: BackendEvent[] = [];

  notice = '';
  copied = false;

  private eventId = '';
  private loadSub?: Subscription;
  private similarSub?: Subscription;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private readonly initialTitle = this.title.getTitle();

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id') ?? '';
      if (id === this.eventId && this.detail) return;
      this.eventId = id;
      this.loadEvent();
    });
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
    this.similarSub?.unsubscribe();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.title.setTitle(this.initialTitle);
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  loadEvent(): void {
    this.loadSub?.unsubscribe();
    this.similarSub?.unsubscribe();

    const hadEvent = !!this.detail;
    this.state = 'loading';
    this.errorMessage = '';
    this.detail = null;
    this.info = [];
    this.ticketOptions = [];
    this.similar = [];

    if (hadEvent && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (!this.eventId) {
      this.state = 'notfound';
      return;
    }

    this.loadSub = this.eventsApi.getEventById(this.eventId).subscribe({
      next: (response) => {
        if (!response.success || !response.data) {
          this.state = 'notfound';
          return;
        }
        const data = response.data;
        this.detail = data;
        this.info = this.buildInfo(data);
        this.ticketOptions = this.buildTickets(data);
        this.selectedTicketId = this.ticketOptions.find((t) => t.remaining !== 0)?.id ?? null;
        this.state = 'ready';
        this.applySeo(data);
        this.loadSimilar(data);
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.state = 'notfound';
          return;
        }
        this.state = 'error';
        this.errorMessage =
          error instanceof HttpErrorResponse && error.status === 0
            ? 'Le serveur est inaccessible. Réessayez dans quelques instants.'
            : 'Une erreur est survenue lors du chargement de l’événement.';
        this.logger.warn('Échec du chargement du détail de l’événement.');
      },
    });
  }

  private loadSimilar(current: EventDetail): void {
    this.similarSub = this.eventsApi.getEvents().subscribe({
      next: (response) => {
        const list = (response.data?.results ?? []).filter((e) => String(e.id) !== String(current.id));
        const sameCategory = list.filter((e) => e.category?.id === current.category?.id);
        const others = list.filter((e) => e.category?.id !== current.category?.id);
        this.similar = [...sameCategory, ...others].slice(0, 3);
      },
      error: () => (this.similar = []),
    });
  }

  private applySeo(data: EventDetail): void {
    this.title.setTitle(`${data.title} | EVENTFLOW`);
    if (data.short_description) {
      this.meta.updateTag({ name: 'description', content: data.short_description });
    }
  }

  /* ------------------------------------------------------------------
     DONNÉES AFFICHÉES (un seul endroit à adapter au serializer)
     ------------------------------------------------------------------ */
  private buildInfo(e: EventDetail): InfoItem[] {
    const items: InfoItem[] = [];
    const start = new Date(e.start_at);
    const end = e.end_at ? new Date(e.end_at) : null;

    if (!Number.isNaN(start.getTime())) {
      items.push({ label: 'Date', value: this.capitalize(longDate.format(start)), icon: ICONS.calendar });

      const endValid = end && !Number.isNaN(end.getTime());
      items.push({
        label: 'Horaire',
        value: endValid ? `${timeFmt.format(start)} – ${timeFmt.format(end as Date)}` : `À partir de ${timeFmt.format(start)}`,
        icon: ICONS.clock,
      });
    }

    if (e.format === 'ONLINE') {
      items.push({
        label: 'Lieu',
        value: 'Événement en ligne',
        sub: e.online_platform ? `Sur ${e.online_platform}` : undefined,
        icon: ICONS.globe,
      });
    } else {
      items.push({
        label: 'Lieu',
        value: e.venue_name || e.city || 'Lieu à préciser',
        sub: this.addressLine(e) || undefined,
        icon: ICONS.pin,
      });
    }

    items.push({ label: 'Tarif', value: this.priceLabel(e), icon: ICONS.tag });

    const remaining = this.remainingSeats(e);
    if (e.capacity) {
      items.push({
        label: 'Capacité',
        value: `${numberFmt.format(e.capacity)} places`,
        sub: remaining !== null ? `${numberFmt.format(remaining)} restante${remaining > 1 ? 's' : ''}` : undefined,
        icon: ICONS.users,
      });
    }
    return items;
  }

  private buildTickets(e: EventDetail): TicketOption[] {
    return (e.ticket_types ?? [])
      .filter((t) => t.is_active !== false)
      .map((t) => {
        const quantity = t.quantity ?? null;
        return {
          id: String(t.id),
          name: t.name,
          priceLabel: this.ticketPrice(t),
          description: t.description ?? '',
          remaining: quantity === null ? null : Math.max(quantity - (t.sold_count ?? 0), 0),
        };
      });
  }

  private ticketPrice(t: EventTicketType): string {
    const value = Number(t.price);
    if (!Number.isFinite(value) || value <= 0) return 'Gratuit';
    return `${numberFmt.format(value)} ${t.currency || 'FCFA'}`;
  }

  priceLabel(e: EventDetail): string {
    if (e.participation_type === 'FREE') return 'Gratuit';
    const prices = (e.ticket_types ?? [])
      .filter((t) => t.is_active !== false)
      .map((t) => Number(t.price))
      .filter((p) => Number.isFinite(p) && p > 0);
    if (prices.length === 0) return 'Payant';
    const currency = e.ticket_types?.[0]?.currency || 'FCFA';
    const min = Math.min(...prices);
    return prices.length > 1 && Math.max(...prices) !== min
      ? `À partir de ${numberFmt.format(min)} ${currency}`
      : `${numberFmt.format(min)} ${currency}`;
  }

  private remainingSeats(e: EventDetail): number | null {
    if (!e.capacity || e.registered_count === null || e.registered_count === undefined) return null;
    return Math.max(e.capacity - e.registered_count, 0);
  }

  private addressLine(e: EventDetail): string {
    return [e.room ? `Salle ${e.room}` : '', e.address, e.city].filter((x) => !!x && String(x).trim()).join(', ');
  }

  /* ------------------------------------------------------------------
     INSCRIPTION
     ------------------------------------------------------------------ */
  get remaining(): number | null {
    return this.detail ? this.remainingSeats(this.detail) : null;
  }

  get fillPercent(): number {
    const e = this.detail;
    const remaining = this.remaining;
    if (!e?.capacity || remaining === null) return 0;
    return Math.min(100, Math.round(((e.capacity - remaining) / e.capacity) * 100));
  }

  get lastSeats(): boolean {
    const e = this.detail;
    const remaining = this.remaining;
    return !!e?.capacity && remaining !== null && remaining > 0 && remaining <= Math.max(5, e.capacity * 0.1);
  }

  get ctaState(): CtaState {
    const e = this.detail;
    if (!e) return 'open';
    const last = new Date(e.end_at || e.start_at).getTime();
    if (!Number.isNaN(last) && last < Date.now()) return 'past';
    if (this.remaining === 0) return 'full';
    if (this.ticketOptions.length > 0 && this.ticketOptions.every((t) => t.remaining === 0)) return 'full';
    return 'open';
  }

  get ctaLabel(): string {
    switch (this.ctaState) {
      case 'past': return 'Événement terminé';
      case 'full': return 'Événement complet';
      default: return 'S’inscrire';
    }
  }

  /** TODO : remplacer par l'action d'inscription quand le parcours participant sera prêt */
  get registerQuery(): Record<string, string> {
    const query: Record<string, string> = { returnUrl: `/events/${this.eventId}` };
    if (this.selectedTicketId) query['ticket'] = this.selectedTicketId;
    return query;
  }

  selectTicket(option: TicketOption): void {
    if (option.remaining !== 0) this.selectedTicketId = option.id;
  }

  /* ------------------------------------------------------------------
     LOCALISATION & PARTAGE
     ------------------------------------------------------------------ */
  get locationText(): string {
    const e = this.detail;
    if (!e) return '';
    if (e.format === 'ONLINE') return e.online_platform ? `En ligne (${e.online_platform})` : 'En ligne';
    return [e.venue_name, this.addressLine(e)].filter(Boolean).join(', ');
  }

  get mapsUrl(): string {
    const query = encodeURIComponent(this.locationText);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  get shareUrl(): string {
    return typeof window === 'undefined' ? '' : window.location.href;
  }

  get whatsappUrl(): string {
    return `https://wa.me/?text=${encodeURIComponent(`${this.detail?.title ?? ''} ${this.shareUrl}`)}`;
  }

  get facebookUrl(): string {
    return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.shareUrl)}`;
  }

  get linkedinUrl(): string {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(this.shareUrl)}`;
  }

  get canNativeShare(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  async nativeShare(): Promise<void> {
    try {
      await navigator.share({ title: this.detail?.title, text: this.detail?.short_description, url: this.shareUrl });
    } catch {
      /* partage annulé par l'utilisateur */
    }
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl);
      this.copied = true;
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => (this.copied = false), 2200);
    } catch {
      this.showNotice('Impossible de copier le lien. Copiez-le depuis la barre d’adresse.');
    }
  }

  /** Télécharge un fichier .ics compatible Google Agenda, Outlook, Apple Calendrier */
  addToCalendar(): void {
    const e = this.detail;
    if (!e) return;
    const start = new Date(e.start_at);
    if (Number.isNaN(start.getTime())) return;

    const end = e.end_at && !Number.isNaN(new Date(e.end_at).getTime())
      ? new Date(e.end_at)
      : new Date(start.getTime() + 2 * 3_600_000);

    const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const escape = (v: string): string =>
      v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EVENTFLOW//FR',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${e.id}@eventflow`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escape(e.title)}`,
      `DESCRIPTION:${escape(e.short_description || '')}`,
      `LOCATION:${escape(this.locationText)}`,
      `URL:${this.shareUrl}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'evenement-eventflow.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  get initials(): string {
    const name = this.detail?.organizer?.name ?? '';
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w.charAt(0))
        .join('')
        .toUpperCase() || '?'
    );
  }

  formatLabel(format: BackendEvent['format']): string {
    return format === 'ONLINE' ? 'En ligne' : 'En présentiel';
  }

  formatShortDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date à confirmer' : shortDate.format(date);
  }

  formatPriceSimple(e: BackendEvent): string {
    return e.participation_type === 'FREE' ? 'Gratuit' : 'Payant';
  }

  getEventImage(e: BackendEvent): string {
    return e.cover_image || 'img/FFFFFF.svg';
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private showNotice(message: string): void {
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = ''), 4000);
  }

  clearNotice(): void {
    this.notice = '';
  }
}
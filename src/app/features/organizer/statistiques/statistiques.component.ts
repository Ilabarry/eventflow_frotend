import {
  Component, DestroyRef, ElementRef, NgZone,
  computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin, of, catchError } from 'rxjs';

import { EventService } from '../../../core/services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import { StatisticsService } from '../../../core/services/statistics.service';
import {
  OrganizerStatisticsDto,
  TimeSeriesPointDto,
} from '../../../core/services/dashboard.service';
import { TicketTypeDto } from '../../../core/services/ticket-type.service';
import { EventDto } from '../../../core/models/event.model';
import { RegistrationService } from '../../../core/services/registration.service';


type LoadState = 'loading' | 'ready' | 'error';
type Period = 7 | 30 | 90;
type ChartMode = 'cumulative' | 'daily';

interface DayPoint {
  date: string;   // YYYY-MM-DD
  count: number;
}

interface TicketType {
  name: string;
  seats: number;
  sold: number;
}

interface EventOption {
  id: string;
  title: string;
}

interface EventStats {
  id: string;
  title: string;
  isFree: boolean;
  capacity: number | null;
  confirmed: number;
  pending: number;
  cancelled: number;
  tickets: TicketType[];
  daily: DayPoint[];
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 7, label: '7 derniers jours' },
  { value: 30, label: '30 derniers jours' },
  { value: 90, label: '90 derniers jours' },
];

const dateShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dateTip = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dateLong = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });
const numberFmt = new Intl.NumberFormat('fr-FR');

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const slugify = (value: string): string =>
  normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

const isoDay = (d: Date): string => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

@Component({
  selector: 'app-organizer-statistics',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './statistiques.component.html',
  styleUrl: './statistiques.component.scss',
})
export class OrganizerStatistiquesComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly eventService = inject(EventService);
  private readonly statisticsService = inject(StatisticsService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chartHost = viewChild<ElementRef<HTMLElement>>('chartHost');
  private readonly registrationService = inject(RegistrationService);

  readonly events = signal<EventOption[]>([]);
  readonly periods = PERIODS;
  readonly pad = { top: 16, right: 16, bottom: 30, left: 40 };

  readonly eventId = signal<string | null>(null);
  readonly period = signal<Period>(30);
  readonly mode = signal<ChartMode>('cumulative');
  readonly stats = signal<EventStats | null>(null);
  readonly loadState = signal<LoadState>('loading');
  readonly width = signal(600);
  readonly hovered = signal<number | null>(null);
  readonly toast = signal<Toast | null>(null);

  private loadToken = 0;
  private lastLoaded: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  /* ------------------------------------------------------------------
     INDICATEURS
     ------------------------------------------------------------------ */
  private readonly kpis = computed(() => {
    const s = this.stats();
    if (!s) return null;
    const inscriptions = s.confirmed + s.pending;
    return {
      inscriptions,
      inPeriod: s.daily.slice(-this.period()).reduce((sum, d) => sum + d.count, 0),
      fill: s.capacity ? Math.round((inscriptions / s.capacity) * 100) : null,
      soldTickets: s.isFree ? inscriptions : s.tickets.reduce((sum, t) => sum + t.sold, 0),
      capacity: s.capacity,
      types: s.tickets.length,
      isFree: s.isFree,
    };
  });

  readonly view = computed(() => {
    const k = this.kpis();
    if (!k) {
      return { inscriptions: '—', fill: '—', tickets: '—', subInscriptions: '', subFill: '', subTickets: '' };
    }
    return {
      inscriptions: numberFmt.format(k.inscriptions),
      fill: k.fill === null ? '—' : `${k.fill}%`,
      tickets: numberFmt.format(k.soldTickets),
      subInscriptions: `+${numberFmt.format(k.inPeriod)} sur ${this.period()} jours`,
      subFill: k.capacity
        ? `${numberFmt.format(k.inscriptions)} / ${numberFmt.format(k.capacity)} places`
        : 'Capacité illimitée',
      subTickets: k.isFree
        ? 'Inscriptions gratuites'
        : `${k.types} type${k.types > 1 ? 's' : ''} de ticket`,
    };
  });

  readonly ticketRows = computed(() =>
    (this.stats()?.tickets ?? []).map((t) => ({
      ...t,
      percent: t.seats > 0 ? Math.min(100, Math.round((t.sold / t.seats) * 100)) : 0,
      full: t.seats > 0 && t.sold >= t.seats,
    })),
  );

  readonly statusItems = computed(() => {
    const s = this.stats();
    return [
      { key: 'confirmed', label: 'Confirmés', value: s?.confirmed ?? 0, tone: 'green' },
      { key: 'pending', label: 'En attente', value: s?.pending ?? 0, tone: 'amber' },
      { key: 'cancelled', label: 'Annulés', value: s?.cancelled ?? 0, tone: 'red' },
    ];
  });

  /* ------------------------------------------------------------------
     GRAPHIQUE
     ------------------------------------------------------------------ */
  private readonly series = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const all = s.daily;
    const start = Math.max(all.length - this.period(), 0);
    let running = all.slice(0, start).reduce((sum, d) => sum + d.count, 0);
    return all.slice(start).map((d) => {
      running += d.count;
      return { date: d.date, day: d.count, total: running };
    });
  });

  readonly periodTotal = computed(() => this.series().reduce((sum, p) => sum + p.day, 0));

  readonly height = computed(() => (this.width() < 480 ? 210 : 250));
  readonly innerW = computed(() => Math.max(this.width() - this.pad.left - this.pad.right, 1));
  readonly innerH = computed(() => this.height() - this.pad.top - this.pad.bottom);

  private readonly values = computed(() =>
    this.series().map((p) => (this.mode() === 'cumulative' ? p.total : p.day)),
  );

  private readonly yScale = computed(() => {
    const max = Math.max(...this.values(), 1);
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, Math.ceil(raw / mag) * mag);
    return { step, max: step * 4 };
  });

  readonly yTicks = computed(() => {
    const { step, max } = this.yScale();
    return [0, 1, 2, 3, 4].map((i) => ({
      value: i * step,
      y: this.pad.top + this.innerH() - ((i * step) / max) * this.innerH(),
    }));
  });

  readonly points = computed(() => {
    const list = this.series();
    const values = this.values();
    const { max } = this.yScale();
    const n = list.length;
    return list.map((p, i) => {
      const date = this.parse(p.date);
      return {
        ...p,
        label: dateShort.format(date),
        tip: dateTip.format(date),
        x: this.pad.left + (n === 1 ? this.innerW() / 2 : (i * this.innerW()) / (n - 1)),
        y: this.pad.top + this.innerH() - (values[i] / max) * this.innerH(),
      };
    });
  });

  readonly linePath = computed(() => {
    const pts = this.points();
    return pts.reduce((d, p, i) => {
      if (i === 0) return `M${p.x},${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `${d} C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }, '');
  });

  readonly areaPath = computed(() => {
    const pts = this.points();
    if (!pts.length) return '';
    const base = this.pad.top + this.innerH();
    return `${this.linePath()} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z`;
  });

  private readonly labelStep = computed(() =>
    Math.max(1, Math.ceil((this.points().length * 58) / this.innerW())),
  );

  readonly hoverPoint = computed(() => {
    const i = this.hovered();
    return i === null ? null : (this.points()[i] ?? null);
  });

  readonly chartSummary = computed(
    () =>
      `Courbe ${this.mode() === 'cumulative' ? 'cumulée' : 'quotidienne'} des inscriptions sur les ` +
      `${this.period()} derniers jours : ${this.periodTotal()} nouvelle${this.periodTotal() > 1 ? 's' : ''} inscription${this.periodTotal() > 1 ? 's' : ''}.`,
  );

  /* ------------------------------------------------------------------
     INITIALISATION
     ------------------------------------------------------------------ */
  constructor() {
    this.loadEvents();

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const period = Number(params.get('periode'));
      this.period.set(PERIODS.some((p) => p.value === period) ? (period as Period) : 30);
      this.hovered.set(null);

      const requested = params.get('evenement');
      if (requested && requested !== this.lastLoaded) {
        void this.load(requested);
      }
    });

    effect((onCleanup) => {
      const host = this.chartHost()?.nativeElement;
      if (!host || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) this.zone.run(() => this.width.set(w));
      });
      observer.observe(host);
      onCleanup(() => observer.disconnect());
    });

    this.destroyRef.onDestroy(() => {
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }

  private loadEvents(): void {
    this.eventService.getMyEvents().subscribe({
      next: (res) => {
        const list = (res.data?.results ?? []).map((e: EventDto) => ({
          id: e.id,
          title: e.title,
        }));
        this.events.set(list);
        console.info(`[Stats] ${list.length} événements chargés`);

        const requested = this.route.snapshot.queryParamMap.get('evenement');
        const target = list.some((e) => e.id === requested) ? requested : list[0]?.id ?? null;

        if (target && target !== this.lastLoaded) {
          if (target !== requested) {
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { evenement: target },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          } else {
            void this.load(target);
          }
        }
      },
      error: (err) => {
        console.error('[Stats] Échec chargement événements', err.status);
        this.notification.httpError(err);
      },
    });
  }

  /* ------------------------------------------------------------------
     CHARGEMENT DES STATS
     ------------------------------------------------------------------ */
  private async load(id: string): Promise<void> {
    const token = ++this.loadToken;
    this.lastLoaded = id;
    this.eventId.set(id);
    this.loadState.set('loading');
    this.hovered.set(null);
    console.info(`[Stats] Chargement événement ${id}...`);

    try {
      const periodParam =
        this.period() === 7 ? 'last_7_days' as const :
        this.period() === 30 ? 'last_30_days' as const :
        'custom';

      let startDate: string | undefined;
      let endDate: string | undefined;
      if (this.period() === 90) {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 90);
        startDate = isoDay(start);
        endDate = isoDay(end);
      }

      // ✅ UN SEUL Promise.all
      const [eventRes, statsRes, ticketsRes, regsRes] = await Promise.all([
        firstValueFrom(this.eventService.getEvent(id)),
        firstValueFrom(
          this.statisticsService.getOrganizerStatistics(id, periodParam, startDate, endDate).pipe(
            catchError(() => of({ success: true, data: undefined } as any)),
          ),
        ),
        firstValueFrom(
          this.statisticsService.getTicketTypes(id).pipe(
            catchError(() => of({ success: true, data: [] as TicketTypeDto[] } as any)),
          ),
        ),
        firstValueFrom(
          this.registrationService.listByEvent(id, 1, 1000).pipe(
            catchError(() => of({ success: true, data: { results: [] } } as any)),
          ),
        ),
      ]);

      if (token !== this.loadToken) return;

      const event: EventDto | undefined = eventRes.data;
      if (!event) {
        this.loadState.set('error');
        return;
      }

      // ✅ Calculs par statut depuis les inscriptions
      const regs: any[] = (regsRes.data?.results ?? []) as any[];
      const confirmed = regs.filter((r: any) => r.status === 'CONFIRMED').length;
      const pending = regs.filter((r: any) => r.status === 'PENDING').length;
      const cancelled = regs.filter((r: any) => r.status === 'CANCELLED').length;

      const tickets: TicketType[] = (ticketsRes.data ?? []).map((t: TicketTypeDto) => ({
        name: t.name,
        seats: t.quantity_total ?? 0,
        sold: t.quantity_sold,
      }));

      const statsData: OrganizerStatisticsDto | undefined = statsRes.data;
      const daily: DayPoint[] = (statsData?.registrations_over_time ?? []).map((p: TimeSeriesPointDto) => ({
        date: p.period,
        count: p.count,
      }));

      const isFree = event.participation_type === 'FREE';
      const capacity = event.capacity_type === 'LIMITED' ? event.capacity_limit ?? null : null;

      const stats: EventStats = {
        id: event.id,
        title: event.title,
        isFree,
        capacity,
        confirmed,
        pending,
        cancelled,
        tickets,
        daily,
      };

      this.stats.set(stats);
      this.loadState.set('ready');
      console.info(
        `[Stats] ${event.title} | ${daily.length} points | ${tickets.length} tickets | ` +
        `${confirmed} confirmés / ${pending} pending / ${cancelled} annulés`,
      );
    } catch (err) {
      console.error('[Stats] Échec chargement', err);
      if (token === this.loadToken) {
        this.loadState.set('error');
        this.notification.httpError(err);
      }
    }
  }

  retry(): void {
    this.lastLoaded = null;
    if (this.eventId()) void this.load(this.eventId()!);
  }

  /* ------------------------------------------------------------------
     FILTRES URL
     ------------------------------------------------------------------ */
  onEventChange(event: Event): void {
    this.navigate({ evenement: (event.target as HTMLSelectElement).value });
  }

  onPeriodChange(event: Event): void {
    const newPeriod = Number((event.target as HTMLSelectElement).value);
    this.navigate({ periode: newPeriod });
  }

  private navigate(queryParams: Record<string, string | number>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  setMode(mode: ChartMode): void {
    this.mode.set(mode);
    this.hovered.set(null);
  }

  /* ------------------------------------------------------------------
     GRAPHIQUE — interactions
     ------------------------------------------------------------------ */
  showLabel(index: number): boolean {
    return (this.points().length - 1 - index) % this.labelStep() === 0;
  }

  onChartMove(event: PointerEvent): void {
    const n = this.points().length;
    if (!n) return;
    const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect();
    const step = n > 1 ? this.innerW() / (n - 1) : 1;
    const index = Math.round((event.clientX - rect.left) / step);
    this.hovered.set(Math.min(n - 1, Math.max(0, index)));
  }

  tooltipX(x: number): number {
    return Math.min(Math.max(x, 70), this.width() - 70);
  }

  /* ------------------------------------------------------------------
     EXPORT CSV
     ------------------------------------------------------------------ */
  exportCsv(): void {
    const s = this.stats();
    const k = this.kpis();
    if (!s || !k) return;

    const rows: string[][] = [
      ['Statistiques', s.title],
      ['Période', `${this.period()} derniers jours`],
      ['Exporté le', dateLong.format(new Date())],
      [],
      ['Indicateur', 'Valeur'],
      ['Inscriptions', String(k.inscriptions)],
      ['Inscriptions sur la période', String(k.inPeriod)],
      ['Remplissage (%)', k.fill === null ? 'Capacité illimitée' : String(k.fill)],
      ['Tickets', String(k.soldTickets)],
      [],
      ['Ticket', 'Vendus', 'Places', 'Remplissage (%)'],
      ...this.ticketRows().map((t) => [t.name, String(t.sold), String(t.seats), String(t.percent)]),
      [],
      ['Statut', 'Participants'],
      ...this.statusItems().map((x) => [x.label, String(x.value)]),
      [],
      ['Date', 'Inscriptions du jour', 'Cumul'],
      ...this.series().map((p) => [p.date, String(p.day), String(p.total)]),
    ];
    const lines = rows.map((row) => row.map(csvCell).join(';'));

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statistiques-${slugify(s.title)}-${isoDay(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.notification.success('Statistiques exportées.', 'Export');
  }

  /* ------------------------------------------------------------------
     DIVERS
     ------------------------------------------------------------------ */
  private parse(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  formatNumber(value: number): string {
    return numberFmt.format(value);
  }

  private showToast(kind: Toast['kind'], text: string): void {
    this.toast.set({ kind, text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }
}
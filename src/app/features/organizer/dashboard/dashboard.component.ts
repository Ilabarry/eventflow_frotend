import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone,
  computed, inject, signal, viewChild, OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil, catchError, of } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ChartPeriod,
  DashboardService,
  OrganizerDashboardDto,
  OrganizerStatisticsDto,
  OrganizerUpcomingEventDto,
  OrganizerRecentRegistrationDto,
} from '../../../core/services/dashboard.service';

type Tone = 'violet' | 'green' | 'cyan';

interface StatCard {
  label: string;
  value: string;
  tone: Tone;
  link: string;
  icon: string[];
}

interface UpcomingEvent {
  id: string;
  title: string;
  imageUrl: string;
  mode: 'Présentiel' | 'En ligne' | 'Hybride';
  dateLabel: string;
  location: string;
  registered: number;
  capacity: number | null;
}

interface Activity {
  id: string;
  title: string;
  timeLabel: string;
  tone: Tone;
  link: string;
  icon: string[];
}

interface ChartPoint {
  label: string;
  value: number;
}

const ICON = {
  calendar: [
    'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
    'M16 2v4', 'M8 2v4', 'M3 10h18',
  ],
  userCheck: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M16 11l2 2 4-4',
  ],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  userPlus: [
    'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M20 8v6', 'M23 11h-6',
  ],
  checkCircle: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  ticket: [
    'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z',
    'M13 5v2', 'M13 11v2', 'M13 17v2',
  ],
} as const;

const PLACEHOLDER_IMG = 'img/event-placeholder.svg';

const numberFmt = new Intl.NumberFormat('fr-FR');
const longDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

const formatEventDate = (iso: string): string => longDate.format(new Date(iso));

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `Il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const mapFormat = (f: string): 'Présentiel' | 'En ligne' | 'Hybride' =>
  f === 'ONLINE' ? 'En ligne' : f === 'HYBRID' ? 'Hybride' : 'Présentiel';

const activityToneFromStatus = (s: string): Tone =>
  s === 'CONFIRMED' ? 'green' : s === 'PENDING' ? 'cyan' : 'violet';

@Component({
  selector: 'app-organizer-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class OrganizerDashboardComponent implements OnInit, AfterViewInit {
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);
  private readonly dashboardService = inject(DashboardService);
  private readonly notification = inject(NotificationService);
  private readonly destroy$ = new Subject<void>();

  private readonly chartHost = viewChild.required<ElementRef<HTMLElement>>('chartHost');

  /* ------------------------------------------------------------------
     ÉTAT DE LA PAGE
     ------------------------------------------------------------------ */
  readonly loading = signal(true);
  readonly chartLoading = signal(false);

  readonly userName = computed(() => this.authService.currentUser()?.first_name ?? '');

  readonly stats = signal<StatCard[]>([]);
  readonly upcomingEvents = signal<UpcomingEvent[]>([]);
  readonly activities = signal<Activity[]>([]);

  /* ------------------------------------------------------------------
     GRAPHIQUE (période et état)
     ------------------------------------------------------------------ */
  readonly periods: { value: ChartPeriod; label: string }[] = [
    { value: 'last_30_days', label: '30 derniers jours' },
    { value: 'last_6_months', label: '6 derniers mois' },
    { value: 'last_12_months', label: '12 derniers mois' },
  ];
  readonly period = signal<ChartPeriod>('last_6_months');

  private readonly rawChartData = signal<ChartPoint[]>([]);

  readonly pad = { top: 16, right: 16, bottom: 30, left: 40 };
  readonly width = signal(600);
  readonly height = computed(() => (this.width() < 480 ? 200 : 240));
  readonly hovered = signal<number | null>(null);

  private readonly data = computed(() => this.rawChartData());
  private readonly innerW = computed(() => Math.max(this.width() - this.pad.left - this.pad.right, 1));
  private readonly innerH = computed(() => this.height() - this.pad.top - this.pad.bottom);

  private readonly yScale = computed(() => {
    const max = Math.max(...this.data().map((d) => d.value), 1);
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = Math.ceil(raw / mag) * mag;
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
    const data = this.data();
    const { max } = this.yScale();
    const n = data.length;
    if (n === 0) return [];
    return data.map((d, i) => ({
      ...d,
      x: this.pad.left + (n === 1 ? this.innerW() / 2 : (i * this.innerW()) / (n - 1)),
      y: this.pad.top + this.innerH() - (d.value / max) * this.innerH(),
    }));
  });

  readonly colWidth = computed(() => {
    const n = this.points().length;
    return n > 1 ? this.innerW() / (n - 1) : this.innerW();
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
    Math.max(1, Math.ceil((this.data().length * 44) / this.innerW())),
  );

  showLabel(index: number): boolean {
    return (this.points().length - 1 - index) % this.labelStep() === 0;
  }

  readonly hoveredPoint = computed(() => {
    const i = this.hovered();
    return i === null ? null : (this.points()[i] ?? null);
  });

  tooltipX(x: number): number {
    return Math.min(Math.max(x, 56), this.width() - 56);
  }

  /* ------------------------------------------------------------------
     INITIALISATION
     ------------------------------------------------------------------ */
  ngOnInit(): void {
    this.loadDashboard();
    this.loadStatistics();
  }

  private loadDashboard(): void {
    this.loading.set(true);
    console.info('[Dashboard] Chargement du dashboard organisateur...');

    this.dashboardService
      .getOrganizerDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const data: OrganizerDashboardDto | undefined = res.data;
          if (!data) {
            this.loading.set(false);
            return;
          }

          this.stats.set(this.buildStats(data));
          this.upcomingEvents.set(data.upcoming_events.map((e) => this.toUpcomingEvent(e)));
          this.activities.set(data.recent_registrations.map((r) => this.toActivity(r)));
          console.log('[Dashboard DEBUG] activities:', this.activities());

          this.loading.set(false);
          console.info(
            `[Dashboard] ${data.summary.total_events} événements | ${data.summary.total_registrations} inscriptions`,
          );
        },
        error: (err) => {
          this.loading.set(false);
          console.error('[Dashboard] Échec chargement', err.status);
          this.notification.httpError(err);
        },
      });
  }

  private loadStatistics(): void {
    this.chartLoading.set(true);
    console.info(`[Dashboard] Chargement des stats (${this.period()})...`);

    this.dashboardService
      .getOrganizerStatistics(this.period())
      .pipe(
        takeUntil(this.destroy$),
        catchError((err) => {
          console.error('[Dashboard] Échec chargement stats', err.status);
          this.notification.httpError(err);
          return of({ success: false, message: '', data: undefined } as any);
        }),
      )
      .subscribe((res) => {
        const stats: OrganizerStatisticsDto | undefined = res.data;
        if (stats) {
          const series = stats.registrations_over_time.map((p) => ({
            label: this.formatPointLabel(p.period, stats.period.granularity),
            value: p.count,
          }));
          this.rawChartData.set(series);
          console.info(`[Dashboard] ${series.length} points chargés pour le graphique`);
        }
        this.chartLoading.set(false);
      });
  }

  /* ------------------------------------------------------------------
     MAPPERS
     ------------------------------------------------------------------ */
  private buildStats(d: OrganizerDashboardDto): StatCard[] {
    return [
      {
        label: 'Événements',
        value: numberFmt.format(d.summary.total_events),
        tone: 'violet',
        link: '/organisateur/evenements',
        icon: [...ICON.calendar],
      },
      {
        label: 'Inscriptions',
        value: numberFmt.format(d.summary.total_registrations),
        tone: 'green',
        link: '/organisateur/participants',
        icon: [...ICON.userCheck],
      },
      {
        label: 'À venir',
        value: numberFmt.format(d.summary.upcoming_events),
        tone: 'cyan',
        link: '/organisateur/evenements',
        icon: [...ICON.clock],
      },
    ];
  }

  private toUpcomingEvent(e: OrganizerUpcomingEventDto): UpcomingEvent {
    return {
      id: e.id,
      title: e.title,
      imageUrl: PLACEHOLDER_IMG,
      mode: mapFormat(e.format),
      dateLabel: formatEventDate(e.start_at),
      location: e.format === 'ONLINE' ? 'En ligne' : (e.city || e.venue_name || '—'),
      registered: e.capacity.occupied,
      capacity: e.capacity.limit,
    };
  }

  private toActivity(r: OrganizerRecentRegistrationDto): Activity {
    const tone = activityToneFromStatus(r.status);
    const statusLabel =
      r.status === 'CONFIRMED' ? 'inscription confirmée' :
      r.status === 'PENDING' ? 'inscription en attente' :
      'inscription annulée';
    return {
      id: r.reference,
      title: `${r.participant_name} — ${statusLabel} (${r.event.title})`,
      timeLabel: relativeTime(r.registered_at),
      tone,
      link: '/organisateur/participants',
      icon: [...(r.status === 'CONFIRMED' ? ICON.checkCircle : r.status === 'PENDING' ? ICON.clock : ICON.userPlus)],
    };
  }

  private formatPointLabel(period: string, granularity: 'day' | 'month'): string {
    if (granularity === 'month') {
      // "2026-10" → "Oct"
      const [y, m] = period.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
    }
    // "2026-10-22" → "22 Oct"
    const date = new Date(period);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  /* ------------------------------------------------------------------
     CHANGEMENT DE PÉRIODE
     ------------------------------------------------------------------ */
  onPeriodChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ChartPeriod;
    this.period.set(value);
    this.hovered.set(null);
    this.loadStatistics();
  }

  /* ------------------------------------------------------------------
     RESIZE OBSERVER
     ------------------------------------------------------------------ */
  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) this.zone.run(() => this.width.set(w));
    });
    observer.observe(this.chartHost().nativeElement);
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      this.destroy$.next();
      this.destroy$.complete();
    });
  }
}
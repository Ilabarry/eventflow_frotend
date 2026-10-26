import {
  ChangeDetectionStrategy, Component, ElementRef, NgZone, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, map, of, switchMap } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { AdminDashboardDto, AdminEventStatus } from '../../../core/models/admin.model';
import { AdminApiService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';

/* ------------------------------------------------------------------
 * Constantes
 * ------------------------------------------------------------------ */
type LoadState = 'loading' | 'ready' | 'error';
type Period = 7 | 30 | 90;
type Metric = 'registrations' | 'events' | 'users';
type Tone = 'violet' | 'cyan' | 'green';
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const PERIODS: readonly { value: Period; label: string }[] = [
  { value: 7, label: '7 derniers jours' },
  { value: 30, label: '30 derniers jours' },
  { value: 90, label: '90 derniers jours' },
];

const METRICS: readonly { value: Metric; label: string; one: string; many: string }[] = [
  { value: 'registrations', label: 'Inscriptions', one: 'inscription', many: 'inscriptions' },
  { value: 'events', label: 'Événements', one: 'événement créé', many: 'événements créés' },
  { value: 'users', label: 'Utilisateurs', one: 'nouvel utilisateur', many: 'nouveaux utilisateurs' },
];

const STATUS_META: Record<AdminEventStatus, { label: string; tone: BadgeTone }> = {
  PUBLISHED: { label: 'Publié', tone: 'success' },
  PENDING: { label: 'À modérer', tone: 'warning' },
  DRAFT: { label: 'Brouillon', tone: 'neutral' },
  FINISHED: { label: 'Terminé', tone: 'info' },
  CANCELLED: { label: 'Annulé', tone: 'danger' },
};

const ICONS = {
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  organizers: ['M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
  events: ['M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  published: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  registrations: [
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    'M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z', 'M9 14l2 2 4-4',
  ],
  tag: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
};

const NUMBER = new Intl.NumberFormat('fr-FR');
const PERCENT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DATE_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const DATE_TIP = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const DATE_EVENT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Protège contre l'injection de formules dans Excel / LibreOffice. */
const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

const parseDay = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/* ------------------------------------------------------------------
 * Modèles d'affichage
 * ------------------------------------------------------------------ */
interface KpiCard {
  key: string;
  label: string;
  value: string;
  caption: string | null;
  trend: number | null;
  tone: Tone;
  icon: string[];
  link: string;
  wide: boolean;
}

interface ReviewItem {
  key: string;
  label: string;
  hint: string;
  count: number;
  link: string;
  query: Record<string, string> | null;
  icon: string[];
}

type LoadResult = { ok: true; data: AdminDashboardDto } | { ok: false };

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardComponent {
  private readonly admin = inject(AdminApiService);
  private readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly zone = inject(NgZone);
  private readonly chartHost = viewChild<ElementRef<HTMLElement>>('chartHost');

  readonly periods = PERIODS;
  readonly metrics = METRICS;
  readonly statusMeta = STATUS_META;
  readonly icons = ICONS;
  readonly pad = { top: 16, right: 16, bottom: 30, left: 44 };

  readonly quickActions = [
    { label: 'Utilisateurs', link: '/admin/utilisateurs', icon: ICONS.users },
    { label: 'Organisateurs', link: '/admin/organisateurs', icon: ICONS.organizers },
    { label: 'Événements', link: '/admin/evenements', icon: ICONS.events },
    { label: 'Catégories', link: '/admin/categories', icon: ICONS.tag },
    { label: 'Supervision', link: '/admin/supervision', icon: ICONS.shield },
  ];

  // État
  readonly loadState = signal<LoadState>('loading');
  readonly refreshing = signal(false);
  readonly data = signal<AdminDashboardDto | null>(null);
  readonly period = signal<Period>(30);
  readonly metric = signal<Metric>('registrations');
  readonly width = signal(600);
  readonly hovered = signal<number | null>(null);

  private readonly request$ = new Subject<Period>();

  readonly firstName = computed(() => this.authService.currentUser()?.first_name?.trim() ?? '');
  readonly lastUpdate = computed(() => {
    const iso = this.data()?.generated_at;
    return iso ? TIME.format(new Date(iso)).replace(':', 'h') : '';
  });

  /* ------------------------------------------------------------------
     INDICATEURS
     ------------------------------------------------------------------ */
  readonly kpis = computed<KpiCard[]>(() => {
    const d = this.data();
    if (!d) {
      return [];
    }
    const k = d.kpis;
    const share = k.events.value > 0 ? Math.round((k.published_events.value / k.events.value) * 100) : 0;

    return [
      { key: 'users', label: 'Utilisateurs', value: NUMBER.format(k.users.value), caption: null, trend: k.users.trend, tone: 'violet', icon: ICONS.users, link: '/admin/utilisateurs', wide: false },
      { key: 'organizers', label: 'Organisateurs', value: NUMBER.format(k.organizers.value), caption: null, trend: k.organizers.trend, tone: 'cyan', icon: ICONS.organizers, link: '/admin/organisateurs', wide: false },
      { key: 'events', label: 'Événements', value: NUMBER.format(k.events.value), caption: 'Total', trend: k.events.trend, tone: 'green', icon: ICONS.events, link: '/admin/evenements', wide: false },
      { key: 'published', label: 'Événements publiés', value: NUMBER.format(k.published_events.value), caption: `${share} % du total`, trend: k.published_events.trend, tone: 'green', icon: ICONS.published, link: '/admin/evenements', wide: false },
      { key: 'registrations', label: 'Inscriptions', value: NUMBER.format(k.registrations.value), caption: null, trend: k.registrations.trend, tone: 'violet', icon: ICONS.registrations, link: '/admin/supervision', wide: true },
    ];
  });

  readonly reviewItems = computed<ReviewItem[]>(() => {
    const r = this.data()?.to_review;
    if (!r) {
      return [];
    }
    return [
      { key: 'orgs', label: 'Organisateurs à valider', hint: 'Comptes en attente de validation', count: r.pending_organizers, link: '/admin/organisateurs', query: { statut: 'PENDING' }, icon: ICONS.organizers },
      { key: 'events', label: 'Événements à modérer', hint: 'Publications en attente de contrôle', count: r.pending_events, link: '/admin/supervision', query: null, icon: ICONS.events },
      { key: 'reports', label: 'Signalements', hint: 'Contenus signalés par les utilisateurs', count: r.reports, link: '/admin/supervision', query: null, icon: ICONS.flag },
      { key: 'suspended', label: 'Comptes suspendus', hint: 'À réexaminer ou à réactiver', count: r.suspended_accounts, link: '/admin/organisateurs', query: { statut: 'SUSPENDED' }, icon: ICONS.lock },
    ].filter((item) => item.count > 0);
  });

  readonly recentEvents = computed(() => this.data()?.recent_events ?? []);

  /* ------------------------------------------------------------------
     GRAPHIQUE (SVG pur, sans librairie)
     ------------------------------------------------------------------ */
  readonly metricMeta = computed(() => METRICS.find((m) => m.value === this.metric()) ?? METRICS[0]);

  private readonly series = computed(() => {
    const metric = this.metric();
    return (this.data()?.activity ?? []).map((p) => ({ date: p.date, value: p[metric] }));
  });

  readonly periodTotal = computed(() => this.series().reduce((sum, p) => sum + p.value, 0));
  readonly dailyAverage = computed(() => {
    const n = this.series().length;
    return n ? Math.round(this.periodTotal() / n) : 0;
  });

  readonly height = computed(() => (this.width() < 480 ? 210 : 250));
  private readonly innerW = computed(() => Math.max(this.width() - this.pad.left - this.pad.right, 1));
  private readonly innerH = computed(() => this.height() - this.pad.top - this.pad.bottom);

  /** Échelle Y « propre » : 4 intervalles réguliers, valeurs entières. */
  private readonly yScale = computed(() => {
    const max = Math.max(...this.series().map((p) => p.value), 1);
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
    const { max } = this.yScale();
    const n = list.length;
    return list.map((p, i) => {
      const date = parseDay(p.date);
      return {
        value: p.value,
        date: p.date,
        label: DATE_SHORT.format(date),
        tip: DATE_TIP.format(date),
        x: this.pad.left + (n === 1 ? this.innerW() / 2 : (i * this.innerW()) / (n - 1)),
        y: this.pad.top + this.innerH() - (p.value / max) * this.innerH(),
      };
    });
  });

  /** Courbe lissée (Bézier horizontales, sans dépassement). */
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

  private readonly labelStep = computed(() => Math.max(1, Math.ceil((this.points().length * 58) / this.innerW())));

  readonly hoverPoint = computed(() => {
    const i = this.hovered();
    return i === null ? null : (this.points()[i] ?? null);
  });

  readonly chartSummary = computed(() => {
    const meta = this.metricMeta();
    const total = this.periodTotal();
    return `Courbe des ${meta.many} sur les ${this.period()} derniers jours : ${total} au total.`;
  });

  constructor() {
    this.request$
      .pipe(
        switchMap((days) =>
          this.admin.getDashboard(days).pipe(
            map((response): LoadResult => (response.data ? { ok: true, data: response.data } : { ok: false })),
            catchError(() => of<LoadResult>({ ok: false })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.apply(result));

    // Adapte le SVG à la largeur réelle du conteneur (texte net sur mobile).
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

    this.load(false);
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  private load(silent: boolean): void {
    if (silent) {
      this.refreshing.set(true);
    } else {
      this.loadState.set('loading');
    }
    this.request$.next(this.period());
  }

  private apply(result: LoadResult): void {
    this.refreshing.set(false);
    if (!result.ok) {
      if (this.data()) {
        this.notification.error('Actualisation impossible : les chiffres affichés peuvent être anciens.', 'Dashboard');
      } else {
        this.loadState.set('error');
      }
      return;
    }
    this.data.set(result.data);
    this.hovered.set(null);
    this.loadState.set('ready');
  }

  retry(): void {
    this.load(false);
  }

  refresh(): void {
    if (!this.refreshing()) {
      this.load(true);
    }
  }

  onPeriod(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (PERIODS.some((p) => p.value === value)) {
      this.period.set(value as Period);
      this.load(true);
    }
  }

  setMetric(metric: Metric): void {
    this.metric.set(metric);
    this.hovered.set(null);
  }

  /* ------------------------------------------------------------------
     GRAPHIQUE : interactions
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
     AFFICHAGE
     ------------------------------------------------------------------ */
  trendDirection(trend: number | null): 'up' | 'down' | 'flat' {
    return trend === null || trend === 0 ? 'flat' : trend > 0 ? 'up' : 'down';
  }

  trendLabel(trend: number | null): string {
    if (trend === null) return '—';
    const sign = trend > 0 ? '+' : trend < 0 ? '−' : '';
    return `${sign}${PERCENT.format(Math.abs(trend))} %`;
  }

  formatNumber(value: number): string {
    return NUMBER.format(value);
  }

  eventDate(iso: string): string {
    return DATE_EVENT.format(new Date(iso));
  }

  /* ------------------------------------------------------------------
     EXPORT DU RAPPORT (CSV)
     ------------------------------------------------------------------ */
  exportReport(): void {
    const d = this.data();
    if (!d) return;

    const kpi = (label: string, item: { value: number; trend: number | null }): string[] => [
      label, String(item.value), item.trend === null ? '' : String(item.trend),
    ];
    const rows: string[][] = [
      ['Rapport EventFlow', DATE_EVENT.format(new Date(d.generated_at))],
      [],
      ['Indicateur', 'Valeur', 'Évolution (%)'],
      kpi('Utilisateurs', d.kpis.users),
      kpi('Organisateurs', d.kpis.organizers),
      kpi('Événements', d.kpis.events),
      kpi('Événements publiés', d.kpis.published_events),
      kpi('Inscriptions', d.kpis.registrations),
      [],
      ['À traiter', 'Nombre'],
      ['Organisateurs à valider', String(d.to_review.pending_organizers)],
      ['Événements à modérer', String(d.to_review.pending_events)],
      ['Signalements', String(d.to_review.reports)],
      ['Comptes suspendus', String(d.to_review.suspended_accounts)],
      [],
      ['Date', 'Inscriptions', 'Événements créés', 'Nouveaux utilisateurs'],
      ...d.activity.map((p) => [p.date, String(p.registrations), String(p.events), String(p.users)]),
    ];

    const lines = rows.map((row) => row.map(csvCell).join(';'));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport-eventflow-${d.generated_at.slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.notification.success('Le rapport a été téléchargé.', 'Export');
  }
}
import {
  Component, DestroyRef, ElementRef, NgZone,
  computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

type LoadState = 'loading' | 'ready' | 'error';
type Period = 7 | 30 | 90;
type ChartMode = 'cumulative' | 'daily';

interface DayPoint {
  date: string; // YYYY-MM-DD
  count: number; // nouvelles inscriptions ce jour-là
}

interface TicketType {
  name: string;
  seats: number;
  sold: number;
}

interface EventStats {
  id: number;
  title: string;
  isFree: boolean;
  capacity: number | null; // null = illimitée
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
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const slugify = (value: string): string =>
  normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Protège contre l'injection de formules dans Excel / LibreOffice */
const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

/* ----------------------------------------------------------------
   DONNÉES DE DÉMONSTRATION
   TODO : remplacer EVENT_OPTIONS et fetchStats() par tes services
          (GET /events, GET /events/:id/stats?days=...)
   Les chiffres sont cohérents entre eux :
   inscriptions = confirmés + en attente = somme des tickets vendus
   ---------------------------------------------------------------- */
const EVENT_OPTIONS = [
  { id: 1, title: "Forum de l'Innovation Numérique" },
  { id: 2, title: 'Tech Conférence' },
  { id: 3, title: 'Python Workshop' },
  { id: 4, title: 'Hackathon Innovation' },
];

const MOCK: Record<number, Omit<EventStats, 'daily'>> = {
  1: {
    id: 1, title: "Forum de l'Innovation Numérique", isFree: false, capacity: 150,
    confirmed: 87, pending: 0, cancelled: 0,
    tickets: [
      { name: 'Standard', seats: 100, sold: 56 },
      { name: 'VIP', seats: 30, sold: 22 },
      { name: 'Premium', seats: 20, sold: 9 },
    ],
  },
  2: {
    id: 2, title: 'Tech Conférence', isFree: false, capacity: 500,
    confirmed: 408, pending: 14, cancelled: 9,
    tickets: [
      { name: 'Standard', seats: 350, sold: 310 },
      { name: 'VIP', seats: 100, sold: 100 },
      { name: 'Étudiant', seats: 50, sold: 12 },
    ],
  },
  3: { id: 3, title: 'Python Workshop', isFree: true, capacity: 50, confirmed: 28, pending: 2, cancelled: 3, tickets: [] },
  4: {
    id: 4, title: 'Hackathon Innovation', isFree: false, capacity: null,
    confirmed: 90, pending: 6, cancelled: 4,
    tickets: [{ name: 'Participant', seats: 120, sold: 96 }],
  },
};

const HISTORY_DAYS = 120;

/** Générateur pseudo-aléatoire déterministe (mulberry32) */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const isoDay = (d: Date): string => {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

/** Répartit `total` inscriptions sur HISTORY_DAYS jours, avec une croissance progressive */
const buildDaily = (total: number, seed: number): DayPoint[] => {
  const random = rng(seed);
  const weights = Array.from(
    { length: HISTORY_DAYS },
    (_, i) => Math.pow((i + 1) / HISTORY_DAYS, 1.8) * (0.4 + random()),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const counts = raw.map(Math.floor);
  const rest = total - counts.reduce((a, b) => a + b, 0);
  raw
    .map((value, i) => ({ i, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, rest)
    .forEach(({ i }) => counts[i]++);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return counts.map((count, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (HISTORY_DAYS - 1 - i));
    return { date: isoDay(d), count };
  });
};

const fetchStats = async (id: number): Promise<EventStats | null> => {
  await delay(450);
  const base = MOCK[id];
  if (!base) return null;
  return { ...structuredClone(base), daily: buildDaily(base.confirmed + base.pending, id * 104_729) };
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
  private readonly chartHost = viewChild<ElementRef<HTMLElement>>('chartHost');

  readonly events = EVENT_OPTIONS;
  readonly periods = PERIODS;
  readonly pad = { top: 16, right: 16, bottom: 30, left: 40 };

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  readonly eventId = signal(EVENT_OPTIONS[0].id);
  readonly period = signal<Period>(30);
  readonly mode = signal<ChartMode>('cumulative');
  readonly stats = signal<EventStats | null>(null);
  readonly loadState = signal<LoadState>('loading');
  readonly width = signal(600);
  readonly hovered = signal<number | null>(null);
  readonly toast = signal<Toast | null>(null);

  private loadToken = 0;
  private lastLoaded: number | null = null;
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
      subFill: k.capacity ? `${numberFmt.format(k.inscriptions)} / ${numberFmt.format(k.capacity)} places` : 'Capacité illimitée',
      subTickets: k.isFree ? 'Inscriptions gratuites' : `${k.types} type${k.types > 1 ? 's' : ''} de ticket`,
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
     GRAPHIQUE (SVG pur, sans librairie)
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

  /** Échelle Y « propre » : 4 intervalles réguliers, valeurs entières */
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

  /** Courbe lissée (courbes de Bézier horizontales, sans dépassement) */
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

  /** Évite le chevauchement des dates sur petit écran */
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

  constructor() {
    // L'événement et la période viennent de l'URL : /organisateur/statistiques?evenement=2&periode=7
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const period = Number(params.get('periode'));
      this.period.set(PERIODS.some((p) => p.value === period) ? (period as Period) : 30);
      this.hovered.set(null);

      const requested = Number(params.get('evenement'));
      const target = EVENT_OPTIONS.some((e) => e.id === requested) ? requested : EVENT_OPTIONS[0].id;
      if (target !== this.lastLoaded) void this.load(target);
    });

    // Adapte le SVG à la largeur réelle du conteneur (texte net sur mobile)
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

    inject(DestroyRef).onDestroy(() => {
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  private async load(id: number): Promise<void> {
    const token = ++this.loadToken;
    this.lastLoaded = id;
    this.eventId.set(id);
    this.loadState.set('loading');
    this.hovered.set(null);
    try {
      const data = await fetchStats(id); // TODO : service
      if (token !== this.loadToken) return; // l'utilisateur a changé d'événement entre-temps
      this.stats.set(data);
      this.loadState.set(data ? 'ready' : 'error');
    } catch {
      if (token === this.loadToken) this.loadState.set('error');
    }
  }

  retry(): void {
    this.lastLoaded = null;
    void this.load(this.eventId());
  }

  onEventChange(event: Event): void {
    this.navigate({ evenement: Number((event.target as HTMLSelectElement).value) });
  }

  onPeriodChange(event: Event): void {
    this.navigate({ periode: Number((event.target as HTMLSelectElement).value) });
  }

  private navigate(queryParams: Record<string, number>): void {
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
     INTERACTIONS DU GRAPHIQUE
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

    // BOM + séparateur « ; » : s'ouvre directement et correctement dans Excel
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statistiques-${slugify(s.title)}-${isoDay(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.showToast('success', 'Statistiques exportées.');
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
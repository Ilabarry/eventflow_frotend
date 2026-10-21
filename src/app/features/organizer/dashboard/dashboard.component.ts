import {
  AfterViewInit, Component, DestroyRef, ElementRef, NgZone,
  computed, inject, signal, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

type Period = '30j' | '6m' | '12m';
type Tone = 'violet' | 'green' | 'cyan';

interface StatCard {
  label: string;
  value: string;
  tone: Tone;
  link: string;
  icon: string[];
}

interface UpcomingEvent {
  id: number;
  title: string;
  imageUrl: string;
  mode: 'Présentiel' | 'En ligne' | 'Hybride';
  dateLabel: string;
  location: string;
  registered: number;
  capacity: number;
}

interface Activity {
  id: number;
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

/* Icônes (attributs "d" des <path>, style Feather) */
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
};

@Component({
  selector: 'app-organizer-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class OrganizerDashboardComponent implements AfterViewInit {
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chartHost = viewChild.required<ElementRef<HTMLElement>>('chartHost');

  /* ------------------------------------------------------------------
     DONNÉES (mock) — TODO : remplacer par tes services (API Laravel / Django…)
     ------------------------------------------------------------------ */
  readonly userName = signal('Barry');

  readonly stats = signal<StatCard[]>([
    { label: 'Événements', value: '12', tone: 'violet', link: '/organisateur/evenements', icon: ICON.calendar },
    { label: 'Inscriptions', value: '248', tone: 'green', link: '/organisateur/participants', icon: ICON.userCheck },
    { label: 'À venir', value: '08', tone: 'cyan', link: '/organisateur/evenements', icon: ICON.clock },
  ]);

  readonly upcomingEvents = signal<UpcomingEvent[]>([
    {
      id: 1,
      title: 'Tech conférence',
      imageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80',
      mode: 'Présentiel',
      dateLabel: '30 sept - 14:30',
      location: 'Dakar',
      registered: 480,
      capacity: 500,
    },
  ]);

  readonly activities = signal<Activity[]>([
    { id: 1, title: 'Nouvelle inscription', timeLabel: 'Il y a 5 min', tone: 'violet', link: '/organisateur/participants', icon: ICON.userPlus },
    { id: 2, title: 'Événements publiés', timeLabel: 'Il y a 1 h', tone: 'cyan', link: '/organisateur/evenements', icon: ICON.checkCircle },
    { id: 3, title: 'Ticket vendu', timeLabel: 'Il y a 2 h', tone: 'green', link: '/organisateur/tickets', icon: ICON.ticket },
  ]);

  /* ------------------------------------------------------------------
     GRAPHIQUE « Performance » (SVG pur, sans librairie)
     ------------------------------------------------------------------ */
  readonly periods: { value: Period; label: string }[] = [
    { value: '30j', label: '30 derniers jours' },
    { value: '6m', label: '6 derniers mois' },
    { value: '12m', label: '12 derniers mois' },
  ];
  readonly period = signal<Period>('6m');

  private readonly chartData: Record<Period, ChartPoint[]> = {
    '30j': [
      { label: 'S1', value: 12 }, { label: 'S2', value: 25 },
      { label: 'S3', value: 19 }, { label: 'S4', value: 38 },
    ],
    '6m': [
      { label: 'Mai', value: 20 }, { label: 'Juin', value: 34 }, { label: 'Juil', value: 28 },
      { label: 'Août', value: 52 }, { label: 'Sept', value: 47 }, { label: 'Oct', value: 78 },
    ],
    '12m': [
      { label: 'Nov', value: 8 }, { label: 'Déc', value: 14 }, { label: 'Jan', value: 12 },
      { label: 'Fév', value: 22 }, { label: 'Mars', value: 18 }, { label: 'Avr', value: 30 },
      { label: 'Mai', value: 20 }, { label: 'Juin', value: 34 }, { label: 'Juil', value: 28 },
      { label: 'Août', value: 52 }, { label: 'Sept', value: 47 }, { label: 'Oct', value: 78 },
    ],
  };

  readonly pad = { top: 16, right: 16, bottom: 30, left: 40 };
  readonly width = signal(600);
  readonly height = computed(() => (this.width() < 480 ? 200 : 240));
  readonly hovered = signal<number | null>(null);

  private readonly data = computed(() => this.chartData[this.period()]);
  private readonly innerW = computed(() => Math.max(this.width() - this.pad.left - this.pad.right, 1));
  private readonly innerH = computed(() => this.height() - this.pad.top - this.pad.bottom);

  /** Échelle Y « propre » : 4 intervalles réguliers */
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

  /** Évite le chevauchement des labels sur petit écran */
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

  onPeriodChange(event: Event): void {
    this.period.set((event.target as HTMLSelectElement).value as Period);
    this.hovered.set(null);
  }

  /** Adapte le SVG à la largeur réelle du conteneur (texte net sur mobile) */
  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) this.zone.run(() => this.width.set(w));
    });
    observer.observe(this.chartHost().nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
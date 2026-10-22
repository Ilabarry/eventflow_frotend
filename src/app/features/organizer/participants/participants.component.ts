import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

type ParticipantStatus = 'confirmed' | 'pending' | 'cancelled';
type Presence = 'all' | 'present' | 'absent';
type PeriodFilter = 'all' | 'today' | '7d' | '30d';
type SortKey = 'name' | 'email' | 'ticket' | 'status' | 'date';
type SortDir = 'asc' | 'desc';
type LoadState = 'loading' | 'ready' | 'error';

interface EventOption {
  id: number;
  title: string;
  imageUrl: string;
  dateLabel: string;
  location: string;
  capacity: number | null; // null = illimitée
  tickets: string[];
}

interface Participant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticket: string;
  status: ParticipantStatus;
  registeredAt: string; // ISO
  checkedIn: boolean;
  code: string;
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const day = 86_400_000;
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Compare sans tenir compte des accents ni de la casse */
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
   TODO : remplacer EVENTS par la liste des événements de l'organisateur
          et fetchParticipants() par ton service (GET /events/:id/participants)
   ---------------------------------------------------------------- */
const COVER = (id: string) => `https://images.unsplash.com/${id}?w=400&q=80`;

const EVENTS: EventOption[] = [
  { id: 1, title: "Forum de l'innovation numérique", imageUrl: COVER('photo-1540575467063-178a50c2df87'), dateLabel: '28 nov. 2026 · 09:00', location: 'Dakar', capacity: 100, tickets: ['Standard', 'VIP'] },
  { id: 2, title: 'Tech Conférence', imageUrl: COVER('photo-1505373877841-8d25f7d46678'), dateLabel: '30 nov. 2026 · 14:00', location: 'Dakar', capacity: 500, tickets: ['Standard', 'VIP'] },
  { id: 3, title: 'Python Workshop', imageUrl: COVER('photo-1511578314322-379afb476865'), dateLabel: '15 déc. 2026 · 10:00', location: 'En ligne', capacity: 50, tickets: ['Gratuit'] },
  { id: 4, title: 'Hackathon Innovation', imageUrl: COVER('photo-1492684223066-81342ee5ff30'), dateLabel: '5 déc. 2026 · 08:30', location: 'Dakar', capacity: null, tickets: ['Standard', 'VIP'] },
];

/** Nombre d'inscrits actifs (hors annulés) générés pour chaque événement de démonstration */
const MOCK_ACTIVE: Record<number, number> = { 1: 87, 2: 480, 3: 28, 4: 96 };

const FIRST_NAMES = [
  'Awa', 'Mamadou', 'Cheikh', 'Fatou', 'Ousmane', 'Aïssatou', 'Ibrahima', 'Khadija', 'Moussa', 'Mariama',
  'Abdoulaye', 'Ndeye', 'Samba', 'Rokhaya', 'Modou', 'Binta', 'Pape', 'Coumba', 'Alioune', 'Sokhna',
];
const LAST_NAMES = [
  'Diop', 'Fall', 'Sow', 'Ndiaye', 'Ba', 'Diallo', 'Gueye', 'Sarr', 'Faye', 'Thiam',
  'Seck', 'Mbaye', 'Cissé', 'Kane', 'Sy', 'Niang', 'Barry', 'Camara', 'Diouf', 'Touré',
];

/** Générateur pseudo-aléatoire déterministe (mulberry32) */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buildParticipants = (event: EventOption): Participant[] => {
  const random = rng(event.id * 7919);
  const active = MOCK_ACTIVE[event.id] ?? 20;
  const total = active + Math.round(active * 0.06);
  const emails = new Set<string>();
  const now = Date.now();

  return Array.from({ length: total }, (_, i) => {
    const firstName = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
    const lastName = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
    const base = `${slugify(firstName).replace(/-/g, '')}.${slugify(lastName).replace(/-/g, '')}`;
    let email = `${base}@email.com`;
    let n = 1;
    while (emails.has(email)) email = `${base}${++n}@email.com`;
    emails.add(email);

    const status: ParticipantStatus = i >= active ? 'cancelled' : random() < 0.82 ? 'confirmed' : 'pending';
    const premium = event.tickets.length > 1 && random() < 0.2;
    return {
      id: event.id * 10_000 + i + 1,
      firstName,
      lastName,
      email,
      phone: `77 ${String(Math.floor(random() * 900) + 100)} ${String(Math.floor(random() * 90) + 10)} ${String(Math.floor(random() * 90) + 10)}`,
      ticket: premium ? event.tickets[event.tickets.length - 1] : event.tickets[0],
      status,
      registeredAt: new Date(now - Math.floor(random() * 45 * day)).toISOString(),
      checkedIn: status === 'confirmed' && random() < 0.15,
      code: `EVF-${String(Math.floor(random() * 9000) + 1000)}`,
    };
  });
};

const fetchParticipants = async (event: EventOption): Promise<Participant[]> => {
  await delay(450);
  return buildParticipants(event);
};

@Component({
  selector: 'app-organizer-participants',
  standalone: true,
  imports: [],
  templateUrl: './participants.component.html',
  styleUrl: './participants.component.scss',
})
export class OrganizerParticipantsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /* ------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------ */
  readonly events = EVENTS;
  readonly pageSizes = [10, 25, 50];

  readonly statusLabel: Record<ParticipantStatus, string> = {
    confirmed: 'Confirmé',
    pending: 'En attente',
    cancelled: 'Annulé',
  };
  readonly statusOptions: { value: 'all' | ParticipantStatus; label: string }[] = [
    { value: 'all', label: 'Statut' },
    { value: 'confirmed', label: 'Confirmés' },
    { value: 'pending', label: 'En attente' },
    { value: 'cancelled', label: 'Annulés' },
  ];
  readonly presenceOptions: { value: Presence; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'present', label: 'Présents' },
    { value: 'absent', label: 'Non scannés' },
  ];
  readonly periodOptions: { value: PeriodFilter; label: string }[] = [
    { value: 'all', label: 'Date' },
    { value: 'today', label: "Aujourd'hui" },
    { value: '7d', label: '7 derniers jours' },
    { value: '30d', label: '30 derniers jours' },
  ];

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  readonly eventId = signal(EVENTS[0].id);
  readonly participants = signal<Participant[]>([]);
  readonly loadState = signal<LoadState>('loading');

  readonly query = signal('');
  readonly presence = signal<Presence>('all');
  readonly status = signal<'all' | ParticipantStatus>('all');
  readonly ticket = signal('all');
  readonly period = signal<PeriodFilter>('all');
  readonly sortKey = signal<SortKey>('date');
  readonly sortDir = signal<SortDir>('desc');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly openMenuId = signal<number | null>(null);
  readonly exportOpen = signal(false);
  readonly detailsId = signal<number | null>(null);
  readonly cancelTarget = signal<Participant | null>(null);
  readonly toast = signal<Toast | null>(null);

  private loadToken = 0;
  private lastLoaded: number | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // L'événement affiché vient de l'URL : /organisateur/participants?evenement=2
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = Number(params.get('evenement'));
      const target = EVENTS.some((e) => e.id === requested) ? requested : EVENTS[0].id;
      if (target !== this.lastLoaded) void this.loadEvent(target);
    });
  }

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  readonly currentEvent = computed(() => EVENTS.find((e) => e.id === this.eventId()) ?? EVENTS[0]);

  readonly stats = computed(() => {
    const list = this.participants();
    const active = list.filter((p) => p.status !== 'cancelled').length;
    const capacity = this.currentEvent().capacity;
    return {
      active,
      confirmed: list.filter((p) => p.status === 'confirmed').length,
      pending: list.filter((p) => p.status === 'pending').length,
      capacity,
      percent: capacity ? Math.min(100, Math.round((active / capacity) * 100)) : null,
    };
  });

  readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    const presence = this.presence();
    const status = this.status();
    const ticket = this.ticket();
    const period = this.period();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const list = this.participants().filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (ticket !== 'all' && p.ticket !== ticket) return false;
      if (presence === 'present' && !p.checkedIn) return false;
      if (presence === 'absent' && p.checkedIn) return false;
      if (period !== 'all') {
        const time = new Date(p.registeredAt).getTime();
        const limit = period === 'today' ? startOfToday.getTime() : now - (period === '7d' ? 7 : 30) * day;
        if (time < limit) return false;
      }
      if (q && !normalize(`${p.firstName} ${p.lastName} ${p.email} ${p.code}`).includes(q)) return false;
      return true;
    });
    return this.sortList(list);
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  readonly pageSafe = computed(() => Math.min(this.page(), this.totalPages()));

  readonly paged = computed(() => {
    const start = (this.pageSafe() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  readonly range = computed(() => {
    const total = this.filtered().length;
    if (total === 0) return { start: 0, end: 0 };
    const start = (this.pageSafe() - 1) * this.pageSize() + 1;
    return { start, end: Math.min(start + this.pageSize() - 1, total) };
  });

  readonly pageItems = computed(() => {
    const total = this.totalPages();
    const current = this.pageSafe();
    const pages = [...new Set([1, total, current - 1, current, current + 1])]
      .filter((p) => p >= 1 && p <= total)
      .sort((a, b) => a - b);
    const items: { page: number | null; key: string }[] = [];
    pages.forEach((p, i) => {
      if (i > 0 && p - pages[i - 1] > 1) items.push({ page: null, key: `gap-${p}` });
      items.push({ page: p, key: `page-${p}` });
    });
    return items;
  });

  readonly hasActiveFilters = computed(
    () =>
      this.query().trim() !== '' ||
      this.presence() !== 'all' ||
      this.status() !== 'all' ||
      this.ticket() !== 'all' ||
      this.period() !== 'all',
  );

  readonly detailsParticipant = computed(() => {
    const id = this.detailsId();
    return id === null ? null : (this.participants().find((p) => p.id === id) ?? null);
  });

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  private async loadEvent(id: number): Promise<void> {
    const token = ++this.loadToken;
    this.lastLoaded = id;
    this.eventId.set(id);
    this.loadState.set('loading');
    this.clearFilters();
    this.openMenuId.set(null);
    try {
      const data = await fetchParticipants(this.currentEvent()); // TODO : service
      if (token !== this.loadToken) return; // l'utilisateur a changé d'événement entre-temps
      this.participants.set(data);
      this.loadState.set('ready');
    } catch {
      if (token === this.loadToken) this.loadState.set('error');
    }
  }

  retry(): void {
    this.lastLoaded = null;
    void this.loadEvent(this.eventId());
  }

  onEventChange(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { evenement: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /* ------------------------------------------------------------------
     FILTRES, TRI, PAGINATION
     ------------------------------------------------------------------ */
  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  onPresence(event: Event): void {
    this.presence.set((event.target as HTMLSelectElement).value as Presence);
    this.page.set(1);
  }

  onStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value as 'all' | ParticipantStatus);
    this.page.set(1);
  }

  onTicket(event: Event): void {
    this.ticket.set((event.target as HTMLSelectElement).value);
    this.page.set(1);
  }

  onPeriod(event: Event): void {
    this.period.set((event.target as HTMLSelectElement).value as PeriodFilter);
    this.page.set(1);
  }

  onPageSize(event: Event): void {
    this.pageSize.set(Number((event.target as HTMLSelectElement).value));
    this.page.set(1);
  }

  resetFilters(): void {
    this.clearFilters();
  }

  private clearFilters(): void {
    this.query.set('');
    this.presence.set('all');
    this.status.set('all');
    this.ticket.set('all');
    this.period.set('all');
    this.page.set(1);
  }

  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'date' ? 'desc' : 'asc');
    }
    this.page.set(1);
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  goToPage(page: number): void {
    this.page.set(Math.min(Math.max(page, 1), this.totalPages()));
  }

  private sortList(list: Participant[]): Participant[] {
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const statusOrder: Record<ParticipantStatus, number> = { confirmed: 0, pending: 1, cancelled: 2 };
    const collator = new Intl.Collator('fr', { sensitivity: 'base' });

    return [...list].sort((a, b) => {
      let result: number;
      switch (key) {
        case 'name':
          result = collator.compare(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`);
          break;
        case 'email':
          result = collator.compare(a.email, b.email);
          break;
        case 'ticket':
          result = collator.compare(a.ticket, b.ticket);
          break;
        case 'status':
          result = statusOrder[a.status] - statusOrder[b.status];
          break;
        default:
          result = new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
      }
      return result * dir;
    });
  }

  /* ------------------------------------------------------------------
     ACTIONS SUR UN PARTICIPANT (TODO : brancher sur l'API)
     ------------------------------------------------------------------ */
  toggleMenu(id: number): void {
    this.exportOpen.set(false);
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  openDetails(p: Participant): void {
    this.openMenuId.set(null);
    this.detailsId.set(p.id);
  }

  toggleCheckIn(p: Participant): void {
    this.openMenuId.set(null);
    this.patch(p.id, { checkedIn: !p.checkedIn });
    this.showToast(
      'success',
      p.checkedIn
        ? `Présence retirée pour ${p.firstName} ${p.lastName}.`
        : `${p.firstName} ${p.lastName} est marqué présent.`,
    );
  }

  confirmRegistration(p: Participant): void {
    this.openMenuId.set(null);
    if (p.status === 'cancelled' && this.isFull()) {
      this.showToast('error', 'La capacité maximale est atteinte : impossible de rétablir cette inscription.');
      return;
    }
    this.patch(p.id, { status: 'confirmed' });
    this.showToast('success', `Inscription de ${p.firstName} ${p.lastName} confirmée.`);
  }

  askCancel(p: Participant): void {
    this.openMenuId.set(null);
    this.cancelTarget.set(p);
  }

  confirmCancel(): void {
    const target = this.cancelTarget();
    if (!target) return;
    this.patch(target.id, { status: 'cancelled', checkedIn: false });
    this.cancelTarget.set(null);
    this.showToast('success', `L'inscription de ${target.firstName} ${target.lastName} a été annulée.`);
  }

  resendTicket(p: Participant): void {
    this.openMenuId.set(null);
    // TODO : appeler l'API d'envoi du ticket
    this.showToast('success', `Ticket renvoyé à ${p.email}.`);
  }

  private isFull(): boolean {
    const { active, capacity } = this.stats();
    return capacity !== null && active >= capacity;
  }

  private patch(id: number, changes: Partial<Participant>): void {
    this.participants.update((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  }

  /* ------------------------------------------------------------------
     EXPORT
     ------------------------------------------------------------------ */
  toggleExport(): void {
    this.openMenuId.set(null);
    this.exportOpen.update((v) => !v);
  }

  exportCsv(): void {
    this.exportOpen.set(false);
    const rows = this.filtered();
    if (rows.length === 0) {
      this.showToast('error', 'Aucun participant à exporter.');
      return;
    }
    const header = ['Prénom', 'Nom', 'E-mail', 'Téléphone', 'Ticket', 'Statut', 'Inscrit le', 'Présent', 'Code ticket'];
    const lines = [
      header,
      ...rows.map((p) => [
        p.firstName, p.lastName, p.email, p.phone, p.ticket, this.statusLabel[p.status],
        this.formatDate(p.registeredAt), p.checkedIn ? 'Oui' : 'Non', p.code,
      ]),
    ].map((row) => row.map(csvCell).join(';'));

    // BOM + séparateur « ; » : s'ouvre directement et correctement dans Excel
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `participants-${slugify(this.currentEvent().title)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.showToast('success', `${rows.length} participant${rows.length > 1 ? 's' : ''} exporté${rows.length > 1 ? 's' : ''}.`);
  }

  async copyEmails(): Promise<void> {
    this.exportOpen.set(false);
    const emails = this.filtered().filter((p) => p.status !== 'cancelled').map((p) => p.email);
    if (emails.length === 0) {
      this.showToast('error', 'Aucune adresse e-mail à copier.');
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      this.showToast('success', `${emails.length} adresse${emails.length > 1 ? 's' : ''} e-mail copiée${emails.length > 1 ? 's' : ''}.`);
    } catch {
      this.showToast('error', "Impossible de copier : autorisez l'accès au presse-papiers.");
    }
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  initials(p: Participant): string {
    return `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase();
  }

  avatarTone(p: Participant): number {
    return p.id % 5;
  }

  ticketTone(p: Participant): 'vip' | 'std' | 'free' {
    return p.ticket === 'VIP' ? 'vip' : p.ticket === 'Gratuit' ? 'free' : 'std';
  }

  formatDate(iso: string): string {
    return dateFmt.format(new Date(iso));
  }

  formatDateTime(iso: string): string {
    return dateTimeFmt.format(new Date(iso));
  }

  private showToast(kind: Toast['kind'], text: string): void {
    this.toast.set({ kind, text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.menu-wrap')) {
      this.openMenuId.set(null);
      this.exportOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openMenuId.set(null);
    this.exportOpen.set(false);
    this.detailsId.set(null);
    this.cancelTarget.set(null);
  }
}
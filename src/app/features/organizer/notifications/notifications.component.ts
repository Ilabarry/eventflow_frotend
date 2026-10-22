import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type NotifType = 'registration' | 'ticket' | 'payment' | 'event' | 'reminder' | 'system';
type Category = 'all' | 'registrations' | 'sales' | 'events' | 'system';
type ReadFilter = 'all' | 'unread';
type LoadState = 'loading' | 'ready' | 'error';
type Tone = 'violet' | 'cyan' | 'green' | 'amber' | 'gray';

interface AppNotification {
  id: number;
  type: NotifType;
  title: string;
  message: string;
  createdAt: string; // ISO
  read: boolean;
  eventId: number | null;
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
  action?: string;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PAGE_SIZE = 8;

const dateShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const timeShort = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateFull = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const startOfDay = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Apparence et destination de chaque type de notification */
const META: Record<
  NotifType,
  {
    tone: Tone;
    category: Exclude<Category, 'all'>;
    icon: string[];
    route: string | null;
    cta: string | null;
    withEvent: boolean; // ajoute ?evenement=ID au lien
  }
> = {
  registration: {
    tone: 'violet', category: 'registrations',
    icon: ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M20 8v6', 'M23 11h-6'],
    route: '/organisateur/participants', cta: 'Voir les participants', withEvent: true,
  },
  ticket: {
    tone: 'cyan', category: 'sales',
    icon: [
      'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z',
      'M13 5v2', 'M13 11v2', 'M13 17v2',
    ],
    route: '/organisateur/tickets', cta: 'Voir les tickets', withEvent: true,
  },
  payment: {
    tone: 'green', category: 'sales',
    icon: ['M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M1 10h22'],
    route: '/organisateur/tickets', cta: 'Voir les tickets', withEvent: true,
  },
  event: {
    tone: 'violet', category: 'events',
    icon: [
      'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
      'M16 2v4', 'M8 2v4', 'M3 10h18', 'M9 16l2 2 4-4',
    ],
    route: '/organisateur/evenements', cta: 'Voir mes événements', withEvent: false,
  },
  reminder: {
    tone: 'amber', category: 'events',
    icon: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
    route: '/organisateur/evenements', cta: 'Voir mes événements', withEvent: false,
  },
  system: {
    tone: 'gray', category: 'system',
    icon: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    route: null, cta: null, withEvent: false,
  },
};

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'registrations', label: 'Inscriptions' },
  { value: 'sales', label: 'Ventes' },
  { value: 'events', label: 'Événements' },
  { value: 'system', label: 'Système' },
];

const GROUPS = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'yesterday', label: 'Hier' },
  { key: 'week', label: 'Cette semaine' },
  { key: 'older', label: 'Plus ancien' },
] as const;

/* ----------------------------------------------------------------
   DONNÉES DE DÉMONSTRATION
   TODO : remplacer fetchNotifications() par ton service
          (GET /notifications) et brancher les actions ci-dessous
   ---------------------------------------------------------------- */
const mk = (
  id: number, type: NotifType, title: string, message: string, ageMs: number, read: boolean, eventId: number | null,
): AppNotification => ({ id, type, title, message, createdAt: new Date(Date.now() - ageMs).toISOString(), read, eventId });

const buildMock = (): AppNotification[] => [
  mk(1, 'registration', 'Nouvelle inscription', "Awa Diop s'est inscrite à « Forum de l'Innovation Numérique ».", 5 * MIN, false, 1),
  mk(2, 'ticket', 'Ticket vendu', "1 ticket VIP vendu pour « Forum de l'Innovation Numérique ».", 18 * MIN, false, 1),
  mk(3, 'registration', 'Nouvelle inscription', "Mamadou Ba s'est inscrit à « Forum de l'Innovation Numérique ».", 45 * MIN, false, 1),
  mk(4, 'payment', 'Paiement reçu', 'Paiement de 15 000 FCFA reçu pour « Tech Conférence ».', 2 * HOUR, false, 2),
  mk(5, 'event', 'Événement publié', '« Tech Conférence » est publié et visible par les participants.', 3 * HOUR, false, 2),
  mk(6, 'registration', 'Nouvelle inscription', "Cheikh Fall s'est inscrit à « Tech Conférence ».", 5 * HOUR, true, 2),
  mk(7, 'reminder', 'Rappel : événement dans 3 jours', "« Forum de l'Innovation Numérique » approche. Vérifiez vos tickets et vos places.", 8 * HOUR, true, 1),
  mk(8, 'ticket', 'Ticket complet', 'Le ticket VIP de « Tech Conférence » est complet.', 27 * HOUR, true, 2),
  mk(9, 'registration', 'Nouvelle inscription', "Fatou Sow s'est inscrite à « Hackathon Innovation ».", 30 * HOUR, true, 4),
  mk(10, 'payment', 'Paiement reçu', 'Paiement de 5 000 FCFA reçu pour « Tech Conférence ».', 33 * HOUR, true, 2),
  mk(11, 'registration', 'Nouvelle inscription', "Ousmane Ndiaye s'est inscrit à « Hackathon Innovation ».", 3 * DAY, true, 4),
  mk(12, 'event', 'Brouillon enregistré', '« Python Workshop » a été enregistré en brouillon.', 4 * DAY, true, 3),
  mk(13, 'ticket', 'Ticket bientôt complet', "Le ticket Standard de « Forum de l'Innovation Numérique » est rempli à 80 %.", 4 * DAY, true, 1),
  mk(14, 'reminder', 'Rappel : événement dans 7 jours', '« Hackathon Innovation » commence dans une semaine.', 5 * DAY, true, 4),
  mk(15, 'registration', 'Nouvelle inscription', "Aïssatou Sarr s'est inscrite à « Python Workshop ».", 6 * DAY, true, 3),
  mk(16, 'payment', 'Paiement reçu', "Paiement de 15 000 FCFA reçu pour « Forum de l'Innovation Numérique ».", 10 * DAY, true, 1),
  mk(17, 'system', 'Nouvelles statistiques', 'Le suivi des inscriptions est désormais disponible dans la page Statistiques.', 12 * DAY, true, null),
  mk(18, 'registration', 'Nouvelle inscription', "Ibrahima Gueye s'est inscrit à « Python Workshop ».", 15 * DAY, true, 3),
  mk(19, 'event', 'Événement modifié', "« Forum de l'Innovation Numérique » a été mis à jour.", 18 * DAY, true, 1),
  mk(20, 'system', 'Bienvenue sur EVENTFLOW', 'Votre espace organisateur est prêt. Créez votre premier événement.', 28 * DAY, true, null),
];

const fetchNotifications = async (): Promise<AppNotification[]> => {
  await delay(450);
  return buildMock().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

@Component({
  selector: 'app-organizer-notifications',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class OrganizerNotificationsComponent {
  readonly categories = CATEGORIES;

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  readonly items = signal<AppNotification[]>([]);
  readonly loadState = signal<LoadState>('loading');

  readonly readFilter = signal<ReadFilter>('all');
  readonly category = signal<Category>('all');
  readonly visibleCount = signal(PAGE_SIZE);
  readonly toast = signal<Toast | null>(null);

  private lastDeleted: { item: AppNotification; index: number } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
    void this.load();
  }

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  readonly stats = computed(() => {
    const list = this.items();
    const today = startOfDay(Date.now());
    return {
      unread: list.filter((n) => !n.read).length,
      today: list.filter((n) => new Date(n.createdAt).getTime() >= today).length,
      total: list.length,
    };
  });

  readonly filtered = computed(() => {
    const read = this.readFilter();
    const category = this.category();
    return this.items().filter(
      (n) => (read === 'all' || !n.read) && (category === 'all' || META[n.type].category === category),
    );
  });

  readonly visible = computed(() => this.filtered().slice(0, this.visibleCount()));
  readonly remaining = computed(() => this.filtered().length - this.visible().length);

  readonly groups = computed(() => {
    const startToday = startOfDay(Date.now());
    const buckets: Record<string, AppNotification[]> = { today: [], yesterday: [], week: [], older: [] };
    for (const n of this.visible()) {
      const days = Math.round((startToday - startOfDay(new Date(n.createdAt).getTime())) / DAY);
      const key = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : 'older';
      buckets[key].push(n);
    }
    return GROUPS.filter((g) => buckets[g.key].length > 0).map((g) => ({ ...g, items: buckets[g.key] }));
  });

  readonly emptyKind = computed<'none' | 'caught-up' | 'filtered'>(() => {
    if (this.items().length === 0) return 'none';
    if (this.readFilter() === 'unread' && this.category() === 'all') return 'caught-up';
    return 'filtered';
  });

  readonly hasActiveFilters = computed(() => this.readFilter() !== 'all' || this.category() !== 'all');

  categoryUnread(category: Category): number {
    return this.items().filter(
      (n) => !n.read && (category === 'all' || META[n.type].category === category),
    ).length;
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  async load(): Promise<void> {
    this.loadState.set('loading');
    try {
      this.items.set(await fetchNotifications()); // TODO : service
      this.loadState.set('ready');
    } catch {
      this.loadState.set('error');
    }
  }

  /* ------------------------------------------------------------------
     FILTRES
     ------------------------------------------------------------------ */
  setReadFilter(value: ReadFilter): void {
    this.readFilter.set(value);
    this.visibleCount.set(PAGE_SIZE);
  }

  setCategory(value: Category): void {
    this.category.set(value);
    this.visibleCount.set(PAGE_SIZE);
  }

  resetFilters(): void {
    this.readFilter.set('all');
    this.category.set('all');
    this.visibleCount.set(PAGE_SIZE);
  }

  showMore(): void {
    this.visibleCount.update((n) => n + PAGE_SIZE);
  }

  /* ------------------------------------------------------------------
     ACTIONS (TODO : brancher sur l'API)
     ------------------------------------------------------------------ */
  open(n: AppNotification): void {
    if (!n.read) this.setRead(n.id, true);
  }

  toggleRead(n: AppNotification): void {
    this.setRead(n.id, !n.read);
  }

  private setRead(id: number, read: boolean): void {
    this.items.update((list) => list.map((n) => (n.id === id ? { ...n, read } : n)));
  }

  markAllRead(): void {
    const count = this.stats().unread;
    if (count === 0) return;
    this.items.update((list) => list.map((n) => (n.read ? n : { ...n, read: true })));
    this.showToast('success', `${count} notification${count > 1 ? 's' : ''} marquée${count > 1 ? 's' : ''} comme lue${count > 1 ? 's' : ''}.`);
  }

  remove(n: AppNotification): void {
    const index = this.items().findIndex((x) => x.id === n.id);
    if (index < 0) return;
    this.lastDeleted = { item: n, index };
    this.items.update((list) => list.filter((x) => x.id !== n.id));
    this.showToast('success', 'Notification supprimée.', 'Annuler');
  }

  undo(): void {
    const last = this.lastDeleted;
    if (!last) return;
    this.items.update((list) => {
      const next = [...list];
      next.splice(Math.min(last.index, next.length), 0, last.item);
      return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    this.lastDeleted = null;
    this.toast.set(null);
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  meta(n: AppNotification) {
    return META[n.type];
  }

  routeOf(n: AppNotification): string | null {
    return META[n.type].route;
  }

  queryOf(n: AppNotification): { evenement: number } | null {
    return META[n.type].withEvent && n.eventId !== null ? { evenement: n.eventId } : null;
  }

  timeLabel(iso: string): string {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    if (diff < MIN) return "À l'instant";
    if (diff < HOUR) return `Il y a ${Math.floor(diff / MIN)} min`;
    if (diff < DAY) return `Il y a ${Math.floor(diff / HOUR)} h`;
    return `${dateShort.format(date)} · ${timeShort.format(date)}`;
  }

  fullDate(iso: string): string {
    return dateFull.format(new Date(iso));
  }

  private showToast(kind: Toast['kind'], text: string, action?: string): void {
    this.toast.set({ kind, text, action });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), action ? 6000 : 4000);
  }
}
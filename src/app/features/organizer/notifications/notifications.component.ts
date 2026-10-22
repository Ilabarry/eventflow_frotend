import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, firstValueFrom } from 'rxjs';

import { NotificationService } from '../../../core/services/notification.service';
import {
  ApiNotificationType,
  NotificationApiService,
  NotificationDto,
} from '../../../core/services/notification-api.service';

type NotifType = 'registration' | 'ticket' | 'payment' | 'event' | 'reminder' | 'system';
type Category = 'all' | 'registrations' | 'sales' | 'events' | 'system';
type ReadFilter = 'all' | 'unread';
type LoadState = 'loading' | 'ready' | 'error';
type Tone = 'violet' | 'cyan' | 'green' | 'amber' | 'gray';

interface AppNotification {
  id: string;                  // UUID backend
  type: NotifType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  eventId: string | null;      // UUID depuis metadata ou related_entity_id
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

const startOfDay = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/* ------------------------------------------------------------------
   Mapping type backend → type UI
   ------------------------------------------------------------------ */
const toUiType = (api: ApiNotificationType): NotifType => {
  switch (api) {
    case 'REGISTRATION':      return 'registration';
    case 'TICKET':            return 'ticket';
    case 'PAYMENT':           return 'payment';
    case 'EVENT_PUBLICATION':
    case 'EVENT_UPDATE':      return 'event';
    case 'EVENT_REMINDER':    return 'reminder';
    default:                  return 'system';
  }
};

/* ------------------------------------------------------------------
   META : apparence et destination par type UI
   ------------------------------------------------------------------ */
const META: Record<
  NotifType,
  {
    tone: Tone;
    category: Exclude<Category, 'all'>;
    icon: string[];
    route: string | null;
    cta: string | null;
    withEvent: boolean;
  }
> = {
  registration: {
    tone: 'violet', category: 'registrations',
    icon: ['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M20 8v6', 'M23 11h-6'],
    route: '/organisateur/participants', cta: 'Voir les participants', withEvent: true,
  },
  ticket: {
    tone: 'cyan', category: 'sales',
    icon: ['M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z', 'M13 5v2', 'M13 11v2', 'M13 17v2'],
    route: '/organisateur/tickets', cta: 'Voir les tickets', withEvent: true,
  },
  payment: {
    tone: 'green', category: 'sales',
    icon: ['M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M1 10h22'],
    route: '/organisateur/tickets', cta: 'Voir les tickets', withEvent: true,
  },
  event: {
    tone: 'violet', category: 'events',
    icon: ['M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M16 2v4', 'M8 2v4', 'M3 10h18', 'M9 16l2 2 4-4'],
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

@Component({
  selector: 'app-organizer-notifications',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class OrganizerNotificationsComponent {
  private readonly api = inject(NotificationApiService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly destroy$ = new Subject<void>();

  readonly categories = CATEGORIES;

  readonly items = signal<AppNotification[]>([]);
  readonly loadState = signal<LoadState>('loading');

  readonly readFilter = signal<ReadFilter>('all');
  readonly category = signal<Category>('all');
  readonly visibleCount = signal(PAGE_SIZE);
  readonly toast = signal<Toast | null>(null);

  private lastDeleted: { item: AppNotification; index: number } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.destroy$.next();
      this.destroy$.complete();
    });
    void this.load();
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  async load(): Promise<void> {
    this.loadState.set('loading');
    console.info('[Notifications] Chargement...');

    try {
      const res = await firstValueFrom(
        this.api.list({ pageSize: 100 }),
      );

      const dtos: NotificationDto[] = res.data?.results ?? [];
      this.items.set(dtos.map((d) => this.toAppNotification(d)));
      this.loadState.set('ready');
      console.info(`[Notifications] ${dtos.length} notifications chargées`);
    } catch (err) {
      this.loadState.set('error');
      console.error('[Notifications] Échec chargement', err);
      this.notification.httpError(err);
    }
  }

  private toAppNotification(dto: NotificationDto): AppNotification {
    // eventId : priorité au metadata.url → sinon related_entity_id si type event/registration
    const eventId =
      dto.metadata?.['eventId'] ??
      dto.metadata?.['event_id'] ??
      (dto.related_entity_type === 'event' ? dto.related_entity_id : null);

    return {
      id: dto.id,
      type: toUiType(dto.type),
      title: dto.title,
      message: dto.message,
      createdAt: dto.created_at,
      read: dto.is_read,
      eventId: eventId ?? null,
    };
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
     ACTIONS → API
     ------------------------------------------------------------------ */
  async open(n: AppNotification): Promise<void> {
    if (!n.read) await this.setRead(n, true);
  }

  async toggleRead(n: AppNotification): Promise<void> {
    await this.setRead(n, !n.read);
  }

  private async setRead(n: AppNotification, read: boolean): Promise<void> {
    // Optimistic update
    this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read } : x)));

    if (!read) {
      // Pas d'endpoint "unread" côté backend → on ne fait rien
      this.notification.info('Marquage comme non-lu non supporté par le backend.', 'Info');
      return;
    }

    try {
      await firstValueFrom(this.api.markRead(n.id));
      console.info(`[Notifications] ${n.id} marquée lue`);
    } catch (err) {
      // Rollback
      this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: !read } : x)));
      this.notification.httpError(err);
    }
  }

  async markAllRead(): Promise<void> {
    const count = this.stats().unread;
    if (count === 0) return;

    // Optimistic update
    const previous = this.items();
    this.items.update((list) => list.map((n) => (n.read ? n : { ...n, read: true })));

    try {
      await firstValueFrom(this.api.markAllRead());
      this.showToast('success', `${count} notification${count > 1 ? 's' : ''} marquée${count > 1 ? 's' : ''} comme lue${count > 1 ? 's' : ''}.`);
      console.info(`[Notifications] ${count} notifications marquées lues`);
    } catch (err) {
      // Rollback
      this.items.set(previous);
      this.notification.httpError(err);
    }
  }

  async remove(n: AppNotification): Promise<void> {
    const index = this.items().findIndex((x) => x.id === n.id);
    if (index < 0) return;

    this.lastDeleted = { item: n, index };
    this.items.update((list) => list.filter((x) => x.id !== n.id));
    this.showToast('success', 'Notification supprimée.', 'Annuler');

    try {
      await firstValueFrom(this.api.remove(n.id));
      console.info(`[Notifications] ${n.id} supprimée`);
    } catch (err) {
      // Rollback
      this.items.update((list) => {
        const next = [...list];
        next.splice(Math.min(index, next.length), 0, n);
        return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      this.lastDeleted = null;
      this.notification.httpError(err);
    }
  }

  undo(): void {
    // L'undo n'est possible qu'avant l'appel API réussi.
    // Une fois la suppression confirmée par le backend, on ne peut plus annuler.
    const last = this.lastDeleted;
    if (!last) return;
    this.toast.set(null);
    this.notification.info(
      "L'annulation n'est pas possible : la notification a déjà été supprimée côté serveur.",
      'Info',
    );
    this.lastDeleted = null;
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

  queryOf(n: AppNotification): { evenement: string } | null {
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
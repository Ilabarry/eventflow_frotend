import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, forkJoin, of, catchError } from 'rxjs';

import { EventService } from '../../../core/services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  RegistrationOrganizerDto,
  RegistrationService,
} from '../../../core/services/registration.service';
import {
  AttendanceService,
  EventAttendanceRowDto,
} from '../../../core/services/attendance.service';
import { EventDto } from '../../../core/models/event.model';
import { TicketTypeService } from '../../../core/services/ticket-type.service';

type ParticipantStatus = 'confirmed' | 'pending' | 'cancelled';
type AttendanceState = 'present' | 'absent' | 'not_checked_in';
type Presence = 'all' | 'present' | 'absent';
type PeriodFilter = 'all' | 'today' | '7d' | '30d';
type SortKey = 'name' | 'email' | 'ticket' | 'status' | 'date';
type SortDir = 'asc' | 'desc';
type LoadState = 'loading' | 'ready' | 'error';

interface EventOption {
  id: string;
  title: string;
  imageUrl: string | null;
  dateLabel: string;
  location: string;
  capacity: number | null;
  tickets: string[];
}

interface Participant {
  id: string;              // registration.id (UUID)
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticket: string;
  status: ParticipantStatus;
  attendance: AttendanceState;
  registeredAt: string;
  checkedInAt: string | null;
  code: string;
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const day = 86_400_000;
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const slugify = (value: string): string =>
  normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

/* ------------------------------------------------------------------
   MAPPERS BACKEND → UI
   ------------------------------------------------------------------ */
const toUiStatus = (s: string): ParticipantStatus =>
  s === 'CONFIRMED' ? 'confirmed' :
  s === 'PENDING'   ? 'pending' :
  'cancelled';

const toUiAttendance = (s: string | null | undefined): AttendanceState =>
  s === 'PRESENT' ? 'present' :
  s === 'ABSENT'  ? 'absent' :
  'not_checked_in';

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

  private readonly eventService = inject(EventService);
  private readonly registrationService = inject(RegistrationService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly notification = inject(NotificationService);
  private readonly ticketTypeService = inject(TicketTypeService);

  readonly events = signal<EventOption[]>([]);
  readonly eventsLoading = signal(true);
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

  readonly eventId = signal<string | null>(null);
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

  readonly openMenuId = signal<string | null>(null);
  readonly exportOpen = signal(false);
  readonly detailsId = signal<string | null>(null);
  readonly cancelTarget = signal<Participant | null>(null);
  readonly toast = signal<Toast | null>(null);

  private loadToken = 0;
  private lastLoaded: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.loadEvents();

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('evenement');
      if (!requested) return;

      if (requested !== this.lastLoaded) {
        void this.loadParticipants(requested);
      }
    });
  }

  /* ------------------------------------------------------------------
     CHARGEMENT DES ÉVÉNEMENTS
     ------------------------------------------------------------------ */
  private loadEvents(): void {
    this.eventsLoading.set(true);
    this.eventService.getMyEvents().subscribe({
      next: (res) => {
        const list: EventOption[] = (res.data?.results ?? []).map((e: EventDto) => ({
          id: e.id,
          title: e.title,
          imageUrl: e.cover_image,
          dateLabel: this.formatEventDate(e.start_at),
          location: e.format === 'ONLINE' ? 'En ligne' : (e.city || '—'),
          capacity: e.capacity_type === 'LIMITED' ? e.capacity_limit ?? null : null,
          tickets: [],
        }));
        this.events.set(list);
        this.eventsLoading.set(false);

        // ✅ Si l'URL ne contient pas d'événement → on initialise avec le premier
        const requested = this.route.snapshot.queryParamMap.get('evenement');
        if (!requested && list.length > 0) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { evenement: list[0].id },
            replaceUrl: true,
          });
          // Le queryParamMap émettra → loadParticipants sera appelé
        } else if (requested && list.some((e) => e.id === requested)) {
          // ✅ L'URL pointe vers un événement existant, mais loadParticipants
          //    a pu échouer (events pas prêts). On garantit le chargement.
          if (requested !== this.lastLoaded) {
            void this.loadParticipants(requested);
          }
        }
      },
      error: (err) => {
        this.eventsLoading.set(false);
        this.notification.httpError(err);
      },
    });
  }

  /* ------------------------------------------------------------------
     CHARGEMENT DES PARTICIPANTS (croisement inscriptions + présences)
     ------------------------------------------------------------------ */
  private async loadParticipants(id: string): Promise<void> {
    const token = ++this.loadToken;
    this.lastLoaded = id;
    this.eventId.set(id);
    this.loadState.set('loading');
    this.clearFilters();
    this.openMenuId.set(null);

    try {
      const [regRes, attRes, tktRes] = await Promise.all([
        firstValueFrom(this.registrationService.listByEvent(id)),
        firstValueFrom(
          this.attendanceService.listByEvent(id).pipe(
            catchError(() => of({ success: true, data: { results: [] as EventAttendanceRowDto[] } } as any)),
          ),
        ),
        firstValueFrom(
          this.ticketTypeService.listByEvent(id).pipe(
            catchError(() => of({ success: true, data: [] as any[] } as any)),
          ),
        ),
      ]);

      if (token !== this.loadToken) return;

      // Injecter les noms de tickets dans l'événement courant
      const ticketNames = (tktRes.data ?? []).map((t: any) => t.name as string);
      this.events.update((list) =>
        list.map((e) => (e.id === id ? { ...e, tickets: ticketNames } : e)),
      );

      const attendances = new Map<string, EventAttendanceRowDto>(
        (attRes.data?.results ?? []).map((a: EventAttendanceRowDto) => [a.registration_id, a]),
      );

      const registrations: RegistrationOrganizerDto[] = regRes.data?.results ?? [];
      const participants: Participant[] = registrations.map((r) => {
        const [firstName, ...rest] = (r.participant_name ?? '').split(' ');
        const attendance = attendances.get(r.id);
        return {
          id: r.id,
          firstName: firstName || '—',
          lastName: rest.join(' ') || '—',
          email: r.participant_email,
          phone: r.participant_phone || '—',
          ticket: r.ticket_type_name ?? 'Aucun',
          status: toUiStatus(r.status),
          attendance: toUiAttendance(attendance?.attendance_status),
          registeredAt: r.registered_at,
          checkedInAt: attendance?.checked_in_at ?? null,
          code: r.reference,
        };
      });

      this.participants.set(participants);
      this.loadState.set('ready');
      console.info(
        `[Participants] ${participants.length} inscriptions + ${attendances.size} présences + ${ticketNames.length} tickets chargés`,
      );
    } catch (err) {
      console.error('[Participants] Échec chargement', err);
      if (token === this.loadToken) {
        this.loadState.set('error');
        this.notification.httpError(err);
      }
    }
  }

  retry(): void {
    const id = this.eventId();
    if (id) void this.loadParticipants(id);
  }

  onEventChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (id === this.eventId()) return; // même valeur
    // Met à jour l'URL → queryParamMap émet → loadParticipants
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { evenement: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  readonly currentEvent = computed<EventOption | null>(() => {
    const id = this.eventId();
    return this.events().find((e) => e.id === id) ?? null;
  });

  readonly stats = computed(() => {
    const list = this.participants();
    const active = list.filter((p) => p.status !== 'cancelled').length;
    const present = list.filter((p) => p.attendance === 'present').length;
    const capacity = this.currentEvent()?.capacity ?? null;
    return {
      active,
      confirmed: list.filter((p) => p.status === 'confirmed').length,
      pending: list.filter((p) => p.status === 'pending').length,
      present,
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
      if (presence === 'present' && p.attendance !== 'present') return false;
      if (presence === 'absent' && p.attendance !== 'not_checked_in') return false;
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
     ACTIONS → API
     ------------------------------------------------------------------ */
  toggleMenu(id: string): void {
    this.exportOpen.set(false);
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  openDetails(p: Participant): void {
    this.openMenuId.set(null);
    this.detailsId.set(p.id);
  }

  async markPresent(p: Participant): Promise<void> {
    this.openMenuId.set(null);
    try {
      await firstValueFrom(this.attendanceService.checkIn(p.id));
      this.patch(p.id, {
        attendance: 'present',
        checkedInAt: new Date().toISOString(),
      });
      this.notification.success(
        `${p.firstName} ${p.lastName} est marqué présent.`,
        'Succès',
      );
    } catch (err) {
      this.notification.httpError(err);
    }
  }

  async markAbsent(p: Participant): Promise<void> {
    this.openMenuId.set(null);
    if (p.attendance === 'present') {
      this.notification.warning(
        'Ce participant est déjà présent : impossible de le marquer absent.',
        'Action refusée',
      );
      return;
    }
    try {
      await firstValueFrom(this.attendanceService.markAbsent(p.id));
      this.patch(p.id, { attendance: 'absent' });
      this.notification.success(
        `${p.firstName} ${p.lastName} est marqué absent.`,
        'Succès',
      );
    } catch (err) {
      this.notification.httpError(err);
    }
  }

  askCancel(p: Participant): void {
    this.openMenuId.set(null);
    this.cancelTarget.set(p);
  }

  async confirmCancel(): Promise<void> {
    const target = this.cancelTarget();
    if (!target) return;
    try {
      await firstValueFrom(this.registrationService.cancel(target.id));
      this.patch(target.id, { status: 'cancelled', attendance: 'not_checked_in' });
      this.cancelTarget.set(null);
      this.notification.success(
        `L'inscription de ${target.firstName} ${target.lastName} a été annulée.`,
        'Succès',
      );
    } catch (err) {
      this.notification.httpError(err);
    }
  }

  resendTicket(p: Participant): void {
    this.openMenuId.set(null);
    this.notification.info(
      `Fonctionnalité non disponible (renvoi du ticket à ${p.email}).`,
      'Info',
    );
  }

  private patch(id: string, changes: Partial<Participant>): void {
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
      this.notification.error('Aucun participant à exporter.', 'Export');
      return;
    }
    const header = ['Prénom', 'Nom', 'E-mail', 'Téléphone', 'Ticket', 'Statut', 'Inscrit le', 'Présent', 'Code ticket'];
    const lines = [
      header,
      ...rows.map((p) => [
        p.firstName, p.lastName, p.email, p.phone, p.ticket, this.statusLabel[p.status],
        this.formatDate(p.registeredAt), p.attendance === 'present' ? 'Oui' : 'Non', p.code,
      ]),
    ].map((row) => row.map(csvCell).join(';'));

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const evTitle = this.currentEvent()?.title ?? 'evenement';
    link.download = `participants-${slugify(evTitle)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.notification.success(`${rows.length} participant(s) exporté(s).`, 'Export');
  }

  async copyEmails(): Promise<void> {
    this.exportOpen.set(false);
    const emails = this.filtered().filter((p) => p.status !== 'cancelled').map((p) => p.email);
    if (emails.length === 0) {
      this.notification.error('Aucune adresse e-mail à copier.', 'Export');
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      this.notification.success(`${emails.length} adresse(s) copiée(s).`, 'Export');
    } catch {
      this.notification.error('Impossible de copier : autorisez l\'accès au presse-papiers.', 'Erreur');
    }
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  initials(p: Participant): string {
    return `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toUpperCase();
  }

  avatarTone(p: Participant): number {
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
    return Math.abs(h) % 5;
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

  formatEventDate(iso: string): string {
    return dateTimeFmt.format(new Date(iso));
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
import { DOCUMENT } from '@angular/common';
import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn, Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin, of, catchError } from 'rxjs';

import { EventService } from '../../../core/services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  CreateTicketTypePayload,
  TicketTypeDto,
  TicketTypeService,
  UpdateTicketTypePayload,
} from '../../../core/services/ticket-type.service';
import { EventDto } from '../../../core/models/event.model';

type LoadState = 'loading' | 'ready' | 'error';
type TicketState = 'active' | 'paused' | 'soldout';

interface EventOption {
  id: string;
  title: string;
  isFree: boolean;
  capacity: number | null;  // null = illimité
}

interface Ticket {
  id: string;               // UUID backend (ou "temp-N" pour création locale)
  name: string;
  price: number;
  seats: number;
  sold: number;
  description: string;
  paused: boolean;
  isNew?: boolean;          // true = pas encore persisté côté backend
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const numberFmt = new Intl.NumberFormat('fr-FR');

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const NAME_MAX = 40;

@Component({
  selector: 'app-organizer-tickets',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './tickets.component.html',
  styleUrl: './tickets.component.scss',
})
export class OrganizerTicketsComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  private readonly eventService = inject(EventService);
  private readonly ticketService = inject(TicketTypeService);
  private readonly notification = inject(NotificationService);

  readonly nameMax = NAME_MAX;

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  readonly events = signal<EventOption[]>([]);
  readonly eventsLoading = signal(true);
  readonly eventId = signal<string | null>(null);
  readonly tickets = signal<Ticket[]>([]);
  readonly loadState = signal<LoadState>('loading');

  readonly query = signal('');
  readonly openMenuId = signal<string | null>(null);

  readonly editorOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);

  readonly deleteTarget = signal<Ticket | null>(null);
  readonly deleting = signal(false);

  readonly toast = signal<Toast | null>(null);

  private loadToken = 0;
  private lastLoaded: string | null = null;
  private lastFocus: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  readonly currentEvent = computed<EventOption | null>(() => {
    const id = this.eventId();
    return this.events().find((e) => e.id === id) ?? null;
  });

  readonly stats = computed(() => {
    const list = this.tickets();
    return {
      types: list.length,
      sold: list.reduce((s, t) => s + t.sold, 0),
      revenue: list.reduce((s, t) => s + t.sold * t.price, 0),
    };
  });

  readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return this.tickets();
    return this.tickets().filter((t) => normalize(`${t.name} ${t.description}`).includes(q));
  });

  readonly allocated = computed(() => this.tickets().reduce((s, t) => s + t.seats, 0));
  readonly editingTicket = computed(
    () => this.tickets().find((t) => t.id === this.editingId()) ?? null,
  );

  readonly minSeats = computed(() => Math.max(1, this.editingTicket()?.sold ?? 0));

  /** Places encore à répartir (hors ticket en édition) ; null = illimité. */
  readonly maxSeats = computed<number | null>(() => {
    const ev = this.currentEvent();
    if (!ev || ev.capacity === null) return null;
    const others = this.tickets()
      .filter((t) => t.id !== this.editingId())
      .reduce((sum, t) => sum + t.seats, 0);
    return Math.max(ev.capacity - others, 0);
  });

  /* ------------------------------------------------------------------
     FORMULAIRE
     ------------------------------------------------------------------ */
  private readonly uniqueName: ValidatorFn = (control) => {
    const value = normalize(String(control.value ?? '').trim());
    if (!value) return null;
    const editing = this.editingId();
    return this.tickets().some(
      (t) => t.id !== editing && normalize(t.name) === value,
    )
      ? { taken: true }
      : null;
  };

  private readonly seatsRange: ValidatorFn = (control) => {
    if (control.value === null || control.value === '') return null;
    const n = Number(control.value);
    if (!Number.isInteger(n)) return null;
    const min = this.minSeats();
    if (n < min) return min > 1 ? { belowSold: { min } } : { min: { min: 1 } };
    const max = this.maxSeats();
    if (max !== null && n > max) return { overCapacity: { max } };
    return null;
  };

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(NAME_MAX), this.uniqueName]],
    price: this.fb.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
      Validators.max(100_000_000),
      Validators.pattern(/^\d+$/),
    ]),
    seats: this.fb.control<number | null>(null, [
      Validators.required, Validators.pattern(/^\d+$/), this.seatsRange,
    ]),
    description: ['', Validators.maxLength(200)],
  });

  constructor() {
    // 1. Chargement des événements de l'organisateur
    this.loadEvents();

    // 2. Lecture du queryParam `evenement`
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('evenement');
      const target =
        requested && this.events().some((e) => e.id === requested)
          ? requested
          : this.events()[0]?.id ?? null;

      if (target && target !== this.lastLoaded) {
        void this.loadTickets(target);
      }
    });

    // 3. Blocage du scroll quand modale ouverte
    effect(() => {
      const open = this.editorOpen() || this.deleteTarget() !== null;
      this.document.body.style.overflow = open ? 'hidden' : '';
    });

    inject(DestroyRef).onDestroy(() => {
      this.document.body.style.overflow = '';
      if (this.toastTimer) clearTimeout(this.toastTimer);
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
          isFree: e.participation_type === 'FREE',
          capacity: e.capacity_type === 'LIMITED' ? e.capacity_limit ?? null : null,
        }));
        this.events.set(list);
        this.eventsLoading.set(false);
        console.info(`[Tickets] ${list.length} événements chargés`);

        // Relancer la sélection si l'URL contenait déjà un `evenement`
        const requested = this.route.snapshot.queryParamMap.get('evenement');
        const target = list.some((e) => e.id === requested) ? requested : list[0]?.id ?? null;
        if (target && target !== this.lastLoaded) void this.loadTickets(target);
      },
      error: (err) => {
        this.eventsLoading.set(false);
        console.error('[Tickets] Échec chargement événements', err.status);
        this.notification.httpError(err);
      },
    });
  }

  /* ------------------------------------------------------------------
     CHARGEMENT DES TICKETS
     ------------------------------------------------------------------ */
  private async loadTickets(id: string): Promise<void> {
    const token = ++this.loadToken;
    this.lastLoaded = id;
    this.eventId.set(id);
    this.loadState.set('loading');
    this.query.set('');
    this.openMenuId.set(null);

    try {
      const res = await firstValueFrom(this.ticketService.listByEvent(id));
      if (token !== this.loadToken) return;

      const tickets: Ticket[] = (res.data ?? []).map((t: TicketTypeDto) => ({
        id: t.id,
        name: t.name,
        price: Number(t.price),
        seats: t.quantity_total ?? 0,
        sold: t.quantity_sold,
        description: t.description ?? '',
        paused: !t.is_active,
      }));

      this.tickets.set(tickets);
      this.loadState.set('ready');
      console.info(`[Tickets] ${tickets.length} tickets chargés pour l'événement ${id}`);
    } catch (err) {
      console.error('[Tickets] Échec chargement tickets', err);
      if (token === this.loadToken) {
        this.loadState.set('error');
        this.notification.httpError(err);
      }
    }
  }

  retry(): void {
    const id = this.eventId();
    if (id) void this.loadTickets(id);
  }

  onEventChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { evenement: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /* ------------------------------------------------------------------
     AFFICHAGE
     ------------------------------------------------------------------ */
  percent(t: Ticket): number {
    return t.seats > 0 ? Math.min(100, Math.round((t.sold / t.seats) * 100)) : 0;
  }

  remaining(t: Ticket): number {
    return Math.max(t.seats - t.sold, 0);
  }

  stateOf(t: Ticket): TicketState {
    if (t.paused) return 'paused';
    return this.remaining(t) === 0 ? 'soldout' : 'active';
  }

  formatNumber(value: number): string {
    return numberFmt.format(value);
  }

  /* ------------------------------------------------------------------
     AJOUT / MODIFICATION
     ------------------------------------------------------------------ */
  openAdd(): void {
    const ev = this.currentEvent();
    if (!ev || ev.isFree || this.loadState() !== 'ready') return;
    this.openMenuId.set(null);
    this.editingId.set(null);

    if (this.maxSeats() === 0) {
      this.showToast('error', "Toutes les places de l'événement sont déjà réparties.");
      return;
    }

    this.rememberFocus();
    this.form.reset();
    this.editorOpen.set(true);
    this.focusFirstField();
  }

  openEdit(t: Ticket): void {
    this.openMenuId.set(null);
    this.rememberFocus();
    this.editingId.set(t.id);
    this.form.reset({
      name: t.name,
      price: t.price,
      seats: t.seats,
      description: t.description,
    });
    this.editorOpen.set(true);
    this.focusFirstField();
  }

  closeEditor(): void {
    if (this.saving()) return;
    this.editorOpen.set(false);
    this.restoreFocus();
  }

  async save(): Promise<void> {
    this.form.controls.name.updateValueAndValidity();
    this.form.controls.seats.updateValueAndValidity();
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      setTimeout(
        () => this.host.nativeElement.querySelector<HTMLElement>('.modal .ng-invalid')?.focus(),
        30,
      );
      return;
    }

    const eventId = this.eventId();
    if (!eventId) return;

    const v = this.form.getRawValue();
    const editingId = this.editingId();
    const payload = {
      name: v.name.trim(),
      price: String(Number(v.price)),
      quantity_total: Number(v.seats),
      description: v.description.trim() || undefined,
    };

    this.saving.set(true);
    console.info(`[Tickets] ${editingId ? 'Mise à jour' : 'Création'} en cours...`);

    try {
      if (!editingId) {
        const res = await firstValueFrom(this.ticketService.create(eventId, payload));
        const created = res.data;
        if (!created) throw new Error('Réponse vide.');

        const newTicket: Ticket = {
          id: created.id,
          name: created.name,
          price: Number(created.price),
          seats: created.quantity_total ?? 0,
          sold: created.quantity_sold,
          description: created.description ?? '',
          paused: !created.is_active,
        };
        this.tickets.update((list) => [...list, newTicket]);
        this.notification.success(`Ticket « ${newTicket.name} » ajouté.`, 'Succès');
      } else {
        const patch: UpdateTicketTypePayload = {
          name: payload.name,
          price: payload.price,
          quantity_total: payload.quantity_total,
          description: payload.description,
        };
        const res = await firstValueFrom(this.ticketService.update(editingId, patch));
        const updated = res.data;
        if (!updated) throw new Error('Réponse vide.');

        this.tickets.update((list) =>
          list.map((t) =>
            t.id === editingId
              ? {
                  ...t,
                  name: updated.name,
                  price: Number(updated.price),
                  seats: updated.quantity_total ?? 0,
                  description: updated.description ?? '',
                }
              : t,
          ),
        );
        this.notification.success(`Ticket « ${payload.name} » mis à jour.`, 'Succès');
      }
      this.saving.set(false);
      this.closeEditor();
    } catch (err: any) {
      console.error('[Tickets] Échec enregistrement', err);
      this.saving.set(false);
      if (err?.error?.errors) {
        this.applyServerErrors(err.error.errors);
        this.notification.error(err.error.message || 'Champs invalides.', 'Validation');
      } else {
        this.notification.httpError(err);
      }
    }
  }

  /* ------------------------------------------------------------------
     MENU / ACTIONS
     ------------------------------------------------------------------ */
  toggleMenu(id: string): void {
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  async togglePause(t: Ticket): Promise<void> {
    this.openMenuId.set(null);
    try {
      const res = await firstValueFrom(
        this.ticketService.update(t.id, { is_active: t.paused }),
      );
      const updated = res.data;
      if (!updated) return;

      this.tickets.update((list) =>
        list.map((x) => (x.id === t.id ? { ...x, paused: !updated.is_active } : x)),
      );
      this.notification.success(
        t.paused ? `Vente reprise pour « ${t.name} ».` : `Vente suspendue pour « ${t.name} ».`,
        'Succès',
      );
    } catch (err) {
      this.notification.httpError(err);
    }
  }

  async duplicate(t: Ticket): Promise<void> {
    this.openMenuId.set(null);
    const eventId = this.eventId();
    if (!eventId) return;

    const capacity = this.currentEvent()?.capacity ?? null;
    if (capacity !== null && this.allocated() + t.seats > capacity) {
      this.showToast(
        'error',
        `Capacité insuffisante : il reste ${Math.max(capacity - this.allocated(), 0)} place(s).`,
      );
      return;
    }

    const name = this.copyName(t.name);
    const payload: CreateTicketTypePayload = {
      name,
      price: String(t.price),
      quantity_total: t.seats,
      description: t.description || undefined,
    };

    try {
      const res = await firstValueFrom(this.ticketService.create(eventId, payload));
      const created = res.data;
      if (!created) return;

      this.tickets.update((list) => [
        ...list,
        {
          id: created.id,
          name: created.name,
          price: Number(created.price),
          seats: created.quantity_total ?? 0,
          sold: created.quantity_sold,
          description: created.description ?? '',
          paused: !created.is_active,
        },
      ]);
      this.notification.success(`Ticket dupliqué : « ${name} ».`, 'Succès');
    } catch (err) {
      this.notification.httpError(err);
    }
  }

  private copyName(base: string): string {
    const taken = (v: string) => this.tickets().some((t) => normalize(t.name) === normalize(v));
    let index = 1;
    let name: string;
    do {
      const suffix = index === 1 ? ' (copie)' : ` (copie ${index})`;
      name = base.slice(0, NAME_MAX - suffix.length) + suffix;
      index++;
    } while (taken(name));
    return name;
  }

  askDelete(t: Ticket): void {
    if (t.sold > 0) return;
    this.openMenuId.set(null);
    this.rememberFocus();
    this.deleteTarget.set(t);
  }

  cancelDelete(): void {
    if (this.deleting()) return;
    this.deleteTarget.set(null);
    this.restoreFocus();
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;

    this.deleting.set(true);
    console.info(`[Tickets] Suppression de "${target.name}"...`);
    try {
      await firstValueFrom(this.ticketService.remove(target.id));
      this.tickets.update((list) => list.filter((t) => t.id !== target.id));
      this.deleting.set(false);
      this.deleteTarget.set(null);
      this.notification.success(`Ticket « ${target.name} » supprimé.`, 'Succès');
    } catch (err) {
      console.error('[Tickets] Échec suppression', err);
      this.deleting.set(false);
      this.notification.httpError(err);
    }
  }

  /* ------------------------------------------------------------------
     ERREURS
     ------------------------------------------------------------------ */
  showError(control: AbstractControl | null): boolean {
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  errorMessage(control: AbstractControl | null): string {
    const e = control?.errors;
    if (!e) return '';
    if (e['required']) return 'Ce champ est obligatoire.';
    if (e['maxlength']) return `Maximum ${e['maxlength'].requiredLength} caractères.`;
    if (e['taken']) return 'Un ticket porte déjà ce nom.';
    if (e['pattern']) return 'Entrez un nombre entier.';
    if (e['belowSold']) return `Minimum ${e['belowSold'].min} places : elles sont déjà vendues.`;
    if (e['overCapacity']) return `Maximum ${e['overCapacity'].max} places : c'est ce qu'il reste à répartir.`;
    if (e['min']) return `La valeur minimale est ${e['min'].min}.`;
    if (e['max']) return `La valeur maximale est ${numberFmt.format(e['max'].max)}.`;
    if (e['server']) return String(e['server']);
    return 'Valeur invalide.';
  }

  private applyServerErrors(errors: Record<string, string[] | string>): void {
    const map: Record<string, AbstractControl | null> = {
      name: this.form.controls.name,
      price: this.form.controls.price,
      quantity_total: this.form.controls.seats,
      description: this.form.controls.description,
    };
    Object.entries(errors).forEach(([field, value]) => {
      const ctrl = map[field];
      if (!ctrl) return;
      const messages = Array.isArray(value) ? value : [value];
      ctrl.setErrors({ server: messages.join(' ') });
      ctrl.markAsTouched();
    });
  }

  /* ------------------------------------------------------------------
     DIVERS
     ------------------------------------------------------------------ */
  private rememberFocus(): void {
    this.lastFocus = this.document.activeElement as HTMLElement | null;
  }

  private restoreFocus(): void {
    setTimeout(() => {
      this.lastFocus?.focus?.();
      this.lastFocus = null;
    });
  }

  private focusFirstField(): void {
    setTimeout(
      () => this.host.nativeElement.querySelector<HTMLInputElement>('.modal input')?.focus(),
      30,
    );
  }

  private showToast(kind: Toast['kind'], text: string): void {
    this.toast.set({ kind, text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.menu-wrap')) this.openMenuId.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openMenuId.set(null);
    if (this.deleteTarget()) this.cancelDelete();
    else if (this.editorOpen()) this.closeEditor();
  }
}
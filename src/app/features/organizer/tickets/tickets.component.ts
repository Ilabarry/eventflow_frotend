import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

type LoadState = 'loading' | 'ready' | 'error';
type TicketState = 'active' | 'paused' | 'soldout';

interface EventOption {
  id: number;
  title: string;
  isFree: boolean;
  capacity: number | null; // null = illimitée
}

interface Ticket {
  id: number;
  name: string;
  price: number;
  seats: number; // places totales du ticket
  sold: number;
  description: string;
  paused: boolean; // vente suspendue
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const numberFmt = new Intl.NumberFormat('fr-FR');
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Compare sans tenir compte des accents ni de la casse */
const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const NAME_MAX = 40;

/* ----------------------------------------------------------------
   DONNÉES DE DÉMONSTRATION
   TODO : remplacer EVENTS et fetchTickets() par tes services
          (GET /events, GET /events/:id/tickets)
   ---------------------------------------------------------------- */
const EVENTS: EventOption[] = [
  { id: 1, title: "Forum de l'Innovation Numérique", isFree: false, capacity: 150 },
  { id: 2, title: 'Tech Conférence', isFree: false, capacity: 500 },
  { id: 3, title: 'Python Workshop', isFree: true, capacity: 50 },
  { id: 4, title: 'Hackathon Innovation', isFree: false, capacity: null },
];

const MOCK_TICKETS: Record<number, Ticket[]> = {
  1: [
    { id: 1, name: 'Standard', price: 5000, seats: 102, sold: 82, description: 'Accès standard', paused: false },
    { id: 2, name: 'VIP', price: 15000, seats: 43, sold: 36, description: 'Accès VIP + espace réservé', paused: false },
  ],
  2: [
    { id: 11, name: 'Standard', price: 5000, seats: 350, sold: 310, description: "Accès standard à l'événement", paused: false },
    { id: 12, name: 'VIP', price: 15000, seats: 100, sold: 100, description: 'Accès prioritaire et cocktail', paused: false },
    { id: 13, name: 'Étudiant', price: 2500, seats: 50, sold: 12, description: 'Sur présentation de la carte étudiante', paused: true },
  ],
  4: [{ id: 21, name: 'Participant', price: 3000, seats: 120, sold: 96, description: 'Accès aux deux jours', paused: false }],
};

const fetchTickets = async (eventId: number): Promise<Ticket[]> => {
  await delay(450);
  return structuredClone(MOCK_TICKETS[eventId] ?? []);
};

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

  readonly events = EVENTS;
  readonly nameMax = NAME_MAX;

  /* ------------------------------------------------------------------
     ÉTAT (déclaré AVANT le formulaire : les validateurs s'en servent)
     ------------------------------------------------------------------ */
  readonly eventId = signal(EVENTS[0].id);
  readonly tickets = signal<Ticket[]>([]);
  readonly loadState = signal<LoadState>('loading');

  readonly query = signal('');
  readonly openMenuId = signal<number | null>(null);

  readonly editorOpen = signal(false);
  readonly editingId = signal<number | null>(null); // null = nouveau ticket
  readonly saving = signal(false);

  readonly deleteTarget = signal<Ticket | null>(null);
  readonly deleting = signal(false);

  readonly toast = signal<Toast | null>(null);

  private loadToken = 0;
  private lastLoaded: number | null = null;
  private lastFocus: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  readonly currentEvent = computed(() => EVENTS.find((e) => e.id === this.eventId()) ?? EVENTS[0]);

  readonly stats = computed(() => {
    const list = this.tickets();
    return {
      types: list.length,
      sold: list.reduce((sum, t) => sum + t.sold, 0),
      revenue: list.reduce((sum, t) => sum + t.sold * t.price, 0),
    };
  });

  readonly filtered = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return this.tickets();
    return this.tickets().filter((t) => normalize(`${t.name} ${t.description}`).includes(q));
  });

  readonly allocated = computed(() => this.tickets().reduce((sum, t) => sum + t.seats, 0));
  readonly editingTicket = computed(() => this.tickets().find((t) => t.id === this.editingId()) ?? null);

  /** On ne peut pas descendre sous le nombre déjà vendu */
  readonly minSeats = computed(() => Math.max(1, this.editingTicket()?.sold ?? 0));

  /** Places encore à répartir (hors ticket en cours d'édition) ; null = capacité illimitée */
  readonly maxSeats = computed<number | null>(() => {
    const capacity = this.currentEvent().capacity;
    if (capacity === null) return null;
    const others = this.tickets()
      .filter((t) => t.id !== this.editingId())
      .reduce((sum, t) => sum + t.seats, 0);
    return Math.max(capacity - others, 0);
  });

  /* ------------------------------------------------------------------
     FORMULAIRE (ajout / modification d'un ticket)
     ------------------------------------------------------------------ */
  private readonly uniqueName: ValidatorFn = (control) => {
    const value = normalize(String(control.value ?? '').trim());
    if (!value) return null;
    const editing = this.editingId();
    return this.tickets().some((t) => t.id !== editing && normalize(t.name) === value) ? { taken: true } : null;
  };

  private readonly seatsRange: ValidatorFn = (control) => {
    if (control.value === null || control.value === '') return null;
    const n = Number(control.value);
    if (!Number.isInteger(n)) return null; // l'erreur « entier » est gérée par pattern
    const min = this.minSeats();
    if (n < min) return min > 1 ? { belowSold: { min } } : { min: { min: 1 } };
    const max = this.maxSeats();
    if (max !== null && n > max) return { overCapacity: { max } };
    return null;
  };

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(NAME_MAX), this.uniqueName]],
    price: this.fb.control<number | null>(null, [
      Validators.required, Validators.min(1), Validators.max(100_000_000), Validators.pattern(/^\d+$/),
    ]),
    seats: this.fb.control<number | null>(null, [Validators.required, Validators.pattern(/^\d+$/), this.seatsRange]),
    description: ['', Validators.maxLength(200)],
  });

  constructor() {
    // L'événement affiché vient de l'URL : /organisateur/tickets?evenement=2
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = Number(params.get('evenement'));
      const target = EVENTS.some((e) => e.id === requested) ? requested : EVENTS[0].id;
      if (target !== this.lastLoaded) void this.loadEvent(target);
    });

    // Bloque le scroll de la page quand une fenêtre est ouverte
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
     CHARGEMENT
     ------------------------------------------------------------------ */
  private async loadEvent(id: number): Promise<void> {
    const token = ++this.loadToken;
    this.lastLoaded = id;
    this.eventId.set(id);
    this.loadState.set('loading');
    this.query.set('');
    this.openMenuId.set(null);
    try {
      const data = await fetchTickets(id); // TODO : service
      if (token !== this.loadToken) return; // l'utilisateur a changé d'événement entre-temps
      this.tickets.set(data);
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

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /* ------------------------------------------------------------------
     AFFICHAGE D'UN TICKET
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
    if (this.currentEvent().isFree || this.loadState() !== 'ready') return;
    this.openMenuId.set(null);
    this.editingId.set(null);
    if (this.maxSeats() === 0) {
      this.showToast('error', "Toutes les places de l'événement sont déjà réparties entre vos tickets.");
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
    this.form.reset({ name: t.name, price: t.price, seats: t.seats, description: t.description });
    this.editorOpen.set(true);
    this.focusFirstField();
  }

  closeEditor(): void {
    if (this.saving()) return;
    this.editorOpen.set(false);
    this.restoreFocus();
  }

  async save(): Promise<void> {
    // Les règles dynamiques (nom unique, places) sont recalculées avant la validation
    this.form.controls.name.updateValueAndValidity();
    this.form.controls.seats.updateValueAndValidity();
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.modal .ng-invalid')?.focus(), 30);
      return;
    }

    const v = this.form.getRawValue();
    const data = {
      name: v.name.trim(),
      price: Number(v.price),
      seats: Number(v.seats),
      description: v.description.trim(),
    };
    const id = this.editingId();

    this.saving.set(true);
    try {
      // TODO : await firstValueFrom(id === null ? this.api.create(eventId, data) : this.api.update(id, data));
      await delay(500);
      if (id === null) {
        this.tickets.update((list) => [...list, { id: this.nextId(), sold: 0, paused: false, ...data }]);
        this.showToast('success', `Ticket « ${data.name} » ajouté.`);
      } else {
        this.tickets.update((list) => list.map((t) => (t.id === id ? { ...t, ...data } : t)));
        this.showToast('success', `Ticket « ${data.name} » mis à jour.`);
      }
      this.saving.set(false);
      this.closeEditor();
    } catch {
      this.saving.set(false);
      this.showToast('error', "L'enregistrement a échoué. Veuillez réessayer.");
    }
  }

  private nextId(): number {
    return Math.max(0, ...this.tickets().map((t) => t.id)) + 1;
  }

  /* ------------------------------------------------------------------
     ACTIONS DU MENU (TODO : brancher sur l'API)
     ------------------------------------------------------------------ */
  toggleMenu(id: number): void {
    this.openMenuId.update((current) => (current === id ? null : id));
  }

  togglePause(t: Ticket): void {
    this.openMenuId.set(null);
    this.tickets.update((list) => list.map((x) => (x.id === t.id ? { ...x, paused: !x.paused } : x)));
    this.showToast('success', t.paused ? `Vente reprise pour « ${t.name} ».` : `Vente suspendue pour « ${t.name} ».`);
  }

  duplicate(t: Ticket): void {
    this.openMenuId.set(null);
    const capacity = this.currentEvent().capacity;
    if (capacity !== null && this.allocated() + t.seats > capacity) {
      this.showToast('error', `Capacité insuffisante : il reste ${Math.max(capacity - this.allocated(), 0)} place(s) à répartir.`);
      return;
    }
    const name = this.copyName(t.name);
    this.tickets.update((list) => [...list, { ...t, id: this.nextId(), name, sold: 0, paused: false }]);
    this.showToast('success', `Ticket dupliqué : « ${name} ».`);
  }

  private copyName(base: string): string {
    const taken = (value: string) => this.tickets().some((t) => normalize(t.name) === normalize(value));
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
    if (t.sold > 0) return; // un ticket déjà vendu ne peut pas être supprimé
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
    try {
      // TODO : await firstValueFrom(this.api.delete(target.id));
      await delay(400);
      this.tickets.update((list) => list.filter((t) => t.id !== target.id));
      this.deleting.set(false);
      this.deleteTarget.set(null);
      this.showToast('success', `Ticket « ${target.name} » supprimé.`);
    } catch {
      this.deleting.set(false);
      this.showToast('error', 'La suppression a échoué. Veuillez réessayer.');
    }
  }

  /* ------------------------------------------------------------------
     ERREURS DU FORMULAIRE
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
    return 'Valeur invalide.';
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
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.modal input')?.focus(), 30);
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
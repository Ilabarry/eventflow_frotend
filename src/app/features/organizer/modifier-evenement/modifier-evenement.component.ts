import { NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit, Component, DestroyRef, ElementRef, HostListener, SecurityContext,
  computed, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn, Validators,
} from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin, of, switchMap, catchError, throwError } from 'rxjs';

import { CategoryService } from '../../../core/services/category.service';
import { EventService } from '../../../core/services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TicketTypeService, TicketTypeDto } from '../../../core/services/ticket-type.service';
import { CategoryDto, EventDto } from '../../../core/models/event.model';
import {
  UiCapacityMode, UiFormat, UiStatus, UiType,
  combineDateTime, splitIso, toApiCapacityMode, toApiFormat, toApiType,
  toUiCapacityMode, toUiFormat, toUiStatus, toUiType,
} from '../../../core/models/event-mapping';

type LoadState = 'loading' | 'ready' | 'notfound' | 'locked' | 'error';
type FormatCommand = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';

interface Ticket {
  id: string;              // UUID backend, ou "temp-N" pour les nouveaux
  name: string;
  price: number;
  seats: number;
  description: string;
  sold: number;
  isNew?: boolean;
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LAST_STEP = 5;

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const numberFmt = new Intl.NumberFormat('fr-FR');

/* ----------------------------------------------------------------
   VALIDATEURS (inchangés)
   ---------------------------------------------------------------- */
const todayIso = (): string => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

const optionalUrl: ValidatorFn = (control) => {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  try {
    return /^https?:$/.test(new URL(value).protocol) ? null : { url: true };
  } catch {
    return { url: true };
  }
};

const timeRange: ValidatorFn = (group) => {
  const start = group.get('startTime')?.value;
  const end = group.get('endTime')?.value;
  return start && end && end <= start ? { timeRange: true } : null;
};

const stripHtml = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const richText = (min: number): ValidatorFn => (control) => {
  const length = stripHtml(String(control.value ?? '')).length;
  if (length === 0) return { required: true };
  return length < min ? { minlength: { requiredLength: min, actualLength: length } } : null;
};

@Component({
  selector: 'app-organizer-edit-event',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './modifier-evenement.component.html',
  styleUrl: './modifier-evenement.component.scss',
})
export class OrganizerEditEventComponent implements AfterViewInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly eventService = inject(EventService);
  private readonly categoryService = inject(CategoryService);
  private readonly ticketTypeService = inject(TicketTypeService);
  private readonly notification = inject(NotificationService);

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly editor = viewChild.required<ElementRef<HTMLDivElement>>('editor');

  readonly today = todayIso();

  /* ------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------ */
  readonly steps = [
    { label: 'Informations', title: 'Informations générales' },
    { label: 'Date & lieu', title: 'Date & lieu' },
    { label: 'Participation', title: 'Participation' },
    { label: 'Tickets', title: 'Tickets' },
    { label: 'Description', title: 'Description' },
    { label: 'Aperçu', title: 'Aperçu' },
  ];

  readonly categories = signal<CategoryDto[]>([]);
  readonly platforms = ['Zoom', 'Google Meet', 'Microsoft Teams', 'YouTube Live', 'Autre'];

  readonly statusLabel: Record<UiStatus, string> = {
    draft: 'Brouillon',
    published: 'Publié',
    finished: 'Terminé',
  };

  /* ------------------------------------------------------------------
     ÉTAT DE L'ÉVÉNEMENT CHARGÉ
     ------------------------------------------------------------------ */
  readonly loadState = signal<LoadState>('loading');
  readonly eventId = signal<string | null>(null);
  readonly eventTitle = signal('');
  readonly status = signal<UiStatus>('draft');
  readonly registered = signal(0);
  readonly updatedAt = signal<string | null>(null);
  readonly originalDate = signal('');

  private loaded: EventDto | null = null;
  private originalTicketIds = new Set<string>();
  private currentLoad = 0;
  private hadCover = false;
  private skipGuard = false;
  private resolveView!: () => void;
  private readonly viewReady = new Promise<void>((resolve) => (this.resolveView = resolve));

  private readonly notPastUnlessUnchanged: ValidatorFn = (control) =>
    !control.value || control.value >= todayIso() || control.value === this.originalDate()
      ? null
      : { pastDate: true };

  /* ------------------------------------------------------------------
     FORMULAIRE
     ------------------------------------------------------------------ */
  readonly form = this.fb.group({
    info: this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
      category: ['', Validators.required],
      summary: ['', Validators.maxLength(200)],
    }),
    schedule: this.fb.group(
      {
        date: ['', [Validators.required, this.notPastUnlessUnchanged]],
        startTime: ['', Validators.required],
        endTime: [''],
        format: ['' as UiFormat, Validators.required],
        venueName: [''],
        address: [''],
        city: [''],
        room: [''],
        platform: [''],
        link: ['', optionalUrl],
      },
      { validators: timeRange },
    ),
    participation: this.fb.group({
      type: ['free' as UiType, Validators.required],
      capacityMode: ['' as UiCapacityMode, Validators.required],
      capacity: this.fb.control<number | null>(null),
    }),
    description: this.fb.group({
      full: ['', richText(30)],
      notes: ['', Validators.maxLength(2000)],
    }),
  });

  readonly info = this.form.controls.info;
  readonly schedule = this.form.controls.schedule;
  readonly participation = this.form.controls.participation;
  readonly description = this.form.controls.description;

  readonly ticketForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    price: this.fb.control<number | null>(null, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
    seats: this.fb.control<number | null>(null, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
    description: ['', Validators.maxLength(200)],
  });

  /* ------------------------------------------------------------------
     ÉTAT UI (inchangé)
     ------------------------------------------------------------------ */
  readonly step = signal(0);
  readonly visited = signal<number[]>([0]);
  readonly attemptedSteps = signal<number[]>([]);

  readonly tickets = signal<Ticket[]>([]);
  readonly editingTicket = signal<string | 'new' | null>(null);

  readonly cover = signal<{ name: string; size: number; url: string; remote: boolean } | null>(null);
  readonly coverError = signal<string | null>(null);
  readonly dragging = signal(false);
  private coverFile: File | null = null;

  readonly activeFormats = signal({ bold: false, italic: false, underline: false, ul: false, ol: false });
  readonly linkOpen = signal(false);
  readonly linkError = signal<string | null>(null);
  private savedRange: Range | null = null;

  readonly saving = signal<'save' | 'publish' | null>(null);
  readonly confirmDelete = signal(false);
  readonly deleting = signal(false);
  readonly notifyParticipants = signal(true);
  readonly toast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly baseline = signal<string[] | null>(null);

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  private readonly tick = toSignal(this.form.valueChanges, { initialValue: null });

  private readonly participationValue = computed(() => {
    this.tick();
    return this.participation.getRawValue();
  });

  readonly capacityLimit = computed<number | null>(() => {
    const p = this.participationValue();
    const n = Number(p.capacity);
    return p.capacityMode === 'limited' && Number.isInteger(n) && n > 0 ? n : null;
  });

  readonly isPaid = computed(() => this.participationValue().type === 'paid');
  readonly seatsAllocated = computed(() => this.tickets().reduce((sum, t) => sum + t.seats, 0));
  readonly overCapacity = computed(() => {
    const limit = this.capacityLimit();
    return limit !== null && this.seatsAllocated() > limit;
  });

  readonly editingSold = computed(() => {
    const id = this.editingTicket();
    if (typeof id !== 'string') return 0;
    return this.tickets().find((t) => t.id === id)?.sold ?? 0;
  });

  readonly ticketsIssue = computed<string | null>(() => {
    if (!this.isPaid()) return null;
    if (this.tickets().length === 0) return 'Ajoutez au moins un ticket pour un événement payant.';
    if (this.editingTicket() !== null) return 'Enregistrez ou annulez le ticket en cours de modification.';
    const limit = this.capacityLimit();
    if (limit !== null && this.seatsAllocated() > limit) {
      return `Le total des places (${this.seatsAllocated()}) dépasse la capacité de l'événement (${limit}).`;
    }
    return null;
  });

  readonly dateMin = computed(() => {
    const original = this.originalDate();
    return original && original < this.today ? original : this.today;
  });

  readonly canDelete = computed(() => this.status() === 'draft');

  readonly updatedLabel = computed(() => {
    const iso = this.updatedAt();
    return iso ? dateTime.format(new Date(iso)) : '';
  });

  private stepSnapshots(): string[] {
    const v = this.form.getRawValue();
    return [
      `${JSON.stringify(v.info)}|${this.cover()?.url ?? ''}`,
      JSON.stringify(v.schedule),
      JSON.stringify(v.participation),
      JSON.stringify(this.tickets()),
      JSON.stringify(v.description),
    ];
  }

  readonly changedSteps = computed<number[]>(() => {
    this.tick();
    const base = this.baseline();
    if (!base) return [];
    return this.stepSnapshots()
      .map((snapshot, i) => (snapshot !== base[i] ? i : -1))
      .filter((i) => i >= 0);
  });

  readonly hasChanges = computed(() => this.changedSteps().length > 0);

  readonly showNotify = computed(
    () => this.status() === 'published' && this.registered() > 0 && this.changedSteps().includes(1),
  );

  readonly summary = computed(() => {
    this.tick();
    const v = this.form.getRawValue();
    const s = v.schedule;
    const p = v.participation;
    const limit = Number(p.capacity);
    const cat = this.categories().find((c) => c.id === v.info.category);
    return {
      title: v.info.title.trim(),
      category: cat?.name ?? '',
      intro: v.info.summary.trim(),
      dateLabel: s.date ? this.formatDateLong(s.date) : '',
      timeLabel: s.startTime ? (s.endTime ? `${s.startTime} – ${s.endTime}` : `À partir de ${s.startTime}`) : '',
      format: s.format,
      formatLabel: s.format === 'online' ? 'En ligne' : s.format === 'onsite' ? 'Présentiel' : '',
      venue: s.venueName.trim(),
      address: [s.address, s.city].map((x) => x.trim()).filter(Boolean).join(', '),
      room: s.room.trim(),
      platform: s.platform,
      link: s.link.trim(),
      type: p.type,
      typeLabel: p.type === 'paid' ? 'Payant' : 'Gratuit',
      capacityLabel:
        p.capacityMode === 'limited' && limit > 0
          ? `${numberFmt.format(limit)} participant${limit > 1 ? 's' : ''} maximum`
          : p.capacityMode === 'unlimited'
            ? 'Capacité illimitée'
            : 'Non définie',
      descriptionHtml: v.description.full,
      notes: v.description.notes.trim(),
    };
  });

  constructor() {
    this.schedule.controls.format.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((format) => this.applyFormatValidators(format));
    this.participation.controls.capacityMode.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((mode) => this.applyCapacityValidators(mode));

    this.applyFormatValidators('');
    this.loadCategories();

    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => void this.load(params.get('id')));

    this.destroyRef.onDestroy(() => {
      this.releaseCover();
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }

  ngAfterViewInit(): void {
    this.resolveView();
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  private loadCategories(): void {
    this.categoryService.list().subscribe({
      next: (res) => this.categories.set(res.data ?? []),
      error: (err) => {
        console.error('[EditEvent] Échec chargement catégories', err.status);
        this.notification.httpError(err);
      },
    });
  }

  async load(id: string | null): Promise<void> {
    const token = ++this.currentLoad;
    this.eventId.set(id);
    this.loadState.set('loading');

    if (!id) {
      this.loadState.set('notfound');
      return;
    }

    try {
      // Charger l'événement + ses ticket-types en parallèle
      const [eventRes, ticketRes] = await Promise.all([
        firstValueFrom(this.eventService.getEvent(id)),
        firstValueFrom(
          this.ticketTypeService.listByEvent(id).pipe(
            catchError(() => of({ success: true, data: [], message: '' } as any)),
          ),
        ),
      ]);

      await this.viewReady;
      if (token !== this.currentLoad) return;

      const event = eventRes.data;
      if (!event) {
        this.loadState.set('notfound');
        return;
      }

      // ✅ Annotation explicite du tableau pour que TypeScript sache le type de `t`
      const tickets: Ticket[] = (ticketRes.data ?? []).map((t: TicketTypeDto): Ticket => ({
        id: t.id,
        name: t.name,
        price: Number(t.price),
        seats: t.quantity_total ?? 0,
        description: t.description ?? '',
        sold: t.quantity_sold,
        isNew: false,
      }));

      this.originalTicketIds = new Set(tickets.map((t: Ticket) => t.id));
      this.applyData(event, tickets);

      if (toUiStatus(event.status) === 'finished') {
        this.loadState.set('locked');
        return;
      }
      this.loadState.set('ready');
    } catch (err) {
      console.error('[EditEvent] Échec chargement', err);
      if (token === this.currentLoad) this.loadState.set('error');
    }
  }

  retry(): void {
    void this.load(this.eventId());
  }

  private applyData(d: EventDto, tickets: Ticket[]): void {
    this.loaded = d;
    this.eventTitle.set(d.title);
    this.status.set(toUiStatus(d.status));
    this.registered.set(d.registered_count ?? 0);
    this.originalDate.set(splitIso(d.start_at).date);
    this.updatedAt.set(d.updated_at ?? null);
    this.notifyParticipants.set(true);

    this.releaseCover();
    this.coverFile = null;
    this.coverError.set(null);
    this.hadCover = !!d.cover_image;
    this.cover.set(
      d.cover_image
        ? { name: 'Image actuelle', size: 0, url: d.cover_image, remote: true }
        : null,
    );

    this.tickets.set(tickets);
    this.editingTicket.set(null);
    this.ticketForm.reset();
    this.closeLink();

    const startSplit = splitIso(d.start_at);
    const endSplit = splitIso(d.end_at);

    this.form.reset({
      info: { title: d.title, category: d.category.id, summary: d.short_description },
      schedule: {
        date: startSplit.date,
        startTime: startSplit.time,
        endTime: endSplit.time,
        format: toUiFormat(d.format),
        venueName: d.venue_name ?? '',
        address: d.address ?? '',
        city: d.city ?? '',
        room: d.room ?? '',
        platform: d.online_platform ?? '',
        link: d.access_url ?? '',
      },
      participation: {
        type: toUiType(d.participation_type),
        capacityMode: toUiCapacityMode(d.capacity_type),
        capacity: d.capacity_limit ?? null,
      },
      description: { full: d.description ?? '', notes: '' },
    });

    this.applyFormatValidators(toUiFormat(d.format));
    this.applyCapacityValidators(toUiCapacityMode(d.capacity_type));

    const type = this.participation.controls.type;
    if ((d.registered_count ?? 0) > 0) type.disable({ emitEvent: false });
    else type.enable({ emitEvent: false });

    const el = this.editor().nativeElement;
    el.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, d.description ?? '') ?? '';
    this.description.controls.full.setValue(el.innerHTML);

    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.baseline.set(this.stepSnapshots());
  }

  resetChanges(): void {
    if (!this.loaded) return;
    this.applyData(this.loaded, this.tickets().filter((t) => !t.isNew));
    this.showToast('success', 'Modifications annulées.');
  }

  private commitSaved(): void {
    const current = this.cover();
    if (current) this.cover.set({ ...current, remote: true });
    this.coverFile = null;
    this.hadCover = current !== null;
    this.originalDate.set(this.schedule.controls.date.value);
    this.form.markAsPristine();
    this.baseline.set(this.stepSnapshots());
    this.tickets.update((list) => list.map((t) => ({ ...t, isNew: false })));
  }

  /* ------------------------------------------------------------------
     VALIDATEURS CONDITIONNELS (inchangés)
     ------------------------------------------------------------------ */
  private applyFormatValidators(format: UiFormat): void {
    const c = this.schedule.controls;
    this.setRequired([c.venueName, c.address, c.city], format === 'onsite');
    this.setRequired([c.platform], format === 'online');
  }

  private setRequired(controls: AbstractControl[], required: boolean): void {
    controls.forEach((control) => {
      control.setValidators(
        required ? [Validators.required, Validators.maxLength(150)] : [Validators.maxLength(150)],
      );
      control.updateValueAndValidity({ emitEvent: false });
    });
  }

  private applyCapacityValidators(mode: UiCapacityMode): void {
    const capacity = this.participation.controls.capacity;
    if (mode === 'limited') {
      const registered = this.registered();
      capacity.setValidators([
        Validators.required,
        Validators.min(1),
        Validators.max(1_000_000),
        Validators.pattern(/^\d+$/),
        (c: AbstractControl) =>
          registered > 0 && Number(c.value) < registered ? { belowRegistered: { min: registered } } : null,
      ]);
    } else {
      capacity.clearValidators();
      capacity.setValue(null, { emitEvent: false });
    }
    capacity.updateValueAndValidity({ emitEvent: false });
  }

  /* ------------------------------------------------------------------
     NAVIGATION (inchangée)
     ------------------------------------------------------------------ */
  isStepValid(index: number): boolean {
    switch (index) {
      case 0: return this.info.valid;
      case 1: return this.schedule.valid;
      case 2: return this.participation.valid;
      case 3: return this.ticketsIssue() === null;
      case 4: return this.description.valid;
      default: return true;
    }
  }

  stepState(index: number): 'current' | 'invalid' | 'todo' {
    if (index === this.step()) return 'current';
    const seen = this.visited().includes(index) || this.wasAttempted(index);
    return seen && !this.isStepValid(index) ? 'invalid' : 'todo';
  }

  isChanged(index: number): boolean {
    return this.changedSteps().includes(index);
  }

  invalidSteps(): number[] {
    return [0, 1, 2, 3, 4].filter((i) => !this.isStepValid(i));
  }

  wasAttempted(index: number): boolean {
    return this.attemptedSteps().includes(index);
  }

  goTo(index: number): void {
    this.moveTo(index);
  }

  next(): void {
    const index = this.step();
    if (this.status() === 'published') {
      this.attemptedSteps.update((list) => (list.includes(index) ? list : [...list, index]));
      this.markStepTouched(index);
      if (!this.isStepValid(index)) {
        this.focusFirstInvalid();
        return;
      }
    }
    this.moveTo(index + 1);
  }

  prev(): void {
    this.moveTo(this.step() - 1);
  }

  private moveTo(index: number): void {
    if (index < 0 || index > LAST_STEP) return;
    this.step.set(index);
    this.visited.update((list) => (list.includes(index) ? list : [...list, index]));
    this.scrollToPanel();
  }

  private markStepTouched(index: number): void {
    const groups = [this.info, this.schedule, this.participation, null, this.description];
    groups[index]?.markAllAsTouched();
  }

  private scrollToPanel(): void {
    setTimeout(() => this.panel().nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  private focusFirstInvalid(): void {
    setTimeout(() => {
      const target = this.host.nativeElement.querySelector<HTMLElement>(
        '.step:not([hidden]) :is(input, select, textarea, [contenteditable]).is-invalid, ' +
          '.step:not([hidden]) :is(input, select, textarea).ng-invalid',
      );
      target?.focus();
    }, 50);
  }

  /* ------------------------------------------------------------------
     ERREURS (inchangées)
     ------------------------------------------------------------------ */
  showError(control: AbstractControl | null): boolean {
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  showTimeRangeError(): boolean {
    const end = this.schedule.controls.endTime;
    return this.schedule.hasError('timeRange') && (end.touched || end.dirty);
  }

  errorMessage(control: AbstractControl | null): string {
    const e = control?.errors;
    if (!e) return '';
    if (e['required']) return 'Ce champ est obligatoire.';
    if (e['minlength']) return `Minimum ${e['minlength'].requiredLength} caractères.`;
    if (e['maxlength']) return `Maximum ${e['maxlength'].requiredLength} caractères.`;
    if (e['belowRegistered']) return `Impossible de descendre sous le nombre d'inscrits (${e['belowRegistered'].min}).`;
    if (e['belowSold']) return `Au moins ${e['belowSold'].min} places : elles sont déjà vendues.`;
    if (e['min']) return `La valeur minimale est ${e['min'].min}.`;
    if (e['max']) return `La valeur maximale est ${numberFmt.format(e['max'].max)}.`;
    if (e['pattern']) return 'Entrez un nombre entier.';
    if (e['pastDate']) return 'La date ne peut pas être dans le passé.';
    if (e['url']) return 'Entrez une adresse valide (https://...).';
    if (e['capacity']) return `Il ne reste que ${e['capacity'].max} place(s) disponible(s).`;
    if (e['server']) return String(e['server']);
    return 'Valeur invalide.';
  }

  withCurrent(list: (string | CategoryDto)[], value: string): string[] {
    if (!value) return list.map((x) => (typeof x === 'string' ? x : x.name));
    if (typeof list[0] === 'string') {
      const arr = list as string[];
      return arr.includes(value) ? arr : [value, ...arr];
    }
    const arr = list as CategoryDto[];
    const exists = arr.some((c) => c.id === value);
    if (exists) return arr.map((c) => c.name);
    const current = arr.find((c) => c.id === value);
    return current ? [current.name, ...arr.map((c) => c.name)] : arr.map((c) => c.name);
  }

  /* ------------------------------------------------------------------
     IMAGE (inchangée)
     ------------------------------------------------------------------ */
  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.setCover(file);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.setCover(file);
  }

  private setCover(file: File): void {
    if (!COVER_TYPES.includes(file.type)) {
      this.coverError.set('Format non supporté. Utilisez une image JPG, PNG ou WEBP.');
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      this.coverError.set("L'image dépasse 5 Mo.");
      return;
    }
    this.releaseCover();
    this.coverFile = file;
    this.cover.set({ name: file.name, size: file.size, url: URL.createObjectURL(file), remote: false });
    this.coverError.set(null);
    this.form.markAsDirty();
  }

  removeCover(): void {
    this.releaseCover();
    this.coverFile = null;
    this.cover.set(null);
    this.form.markAsDirty();
  }

  private releaseCover(): void {
    const current = this.cover();
    if (current && !current.remote) URL.revokeObjectURL(current.url);
  }

  formatSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
      : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  /* ------------------------------------------------------------------
     TICKETS (inchangés sauf types)
     ------------------------------------------------------------------ */
  addTicket(): void {
    this.ticketForm.reset();
    this.editingTicket.set('new');
    this.focusTicketEditor();
  }

  editTicket(ticket: Ticket): void {
    this.ticketForm.setValue({
      name: ticket.name,
      price: ticket.price,
      seats: ticket.seats,
      description: ticket.description,
    });
    this.editingTicket.set(ticket.id);
    this.focusTicketEditor();
  }

  cancelTicketEdit(): void {
    this.editingTicket.set(null);
  }

  saveTicket(): void {
    const editing = this.editingTicket();
    if (editing === null) return;
    if (this.ticketForm.invalid) {
      this.ticketForm.markAllAsTouched();
      return;
    }
    const v = this.ticketForm.getRawValue();
    const seats = Number(v.seats);
    const seatsControl = this.ticketForm.controls.seats;

    const sold = typeof editing === 'string' ? (this.tickets().find((t) => t.id === editing)?.sold ?? 0) : 0;
    if (seats < sold) {
      seatsControl.setErrors({ belowSold: { min: sold } });
      seatsControl.markAsTouched();
      return;
    }

    const limit = this.capacityLimit();
    if (limit !== null) {
      const others = this.tickets()
        .filter((t) => t.id !== editing)
        .reduce((sum, t) => sum + t.seats, 0);
      const remaining = limit - others;
      if (seats > remaining) {
        seatsControl.setErrors({ capacity: { max: Math.max(remaining, 0) } });
        seatsControl.markAsTouched();
        return;
      }
    }

    const data = {
      name: v.name.trim(),
      price: Number(v.price),
      seats,
      description: v.description.trim(),
    };
    if (editing === 'new') {
      this.tickets.update((list) => [...list, { id: `temp-${Date.now()}`, sold: 0, isNew: true, ...data }]);
    } else {
      this.tickets.update((list) => list.map((t) => (t.id === editing ? { ...t, ...data } : t)));
    }
    this.editingTicket.set(null);
  }

  deleteTicket(ticket: Ticket): void {
    if (ticket.sold > 0) return;
    this.tickets.update((list) => list.filter((t) => t.id !== ticket.id));
    if (this.editingTicket() === ticket.id) this.editingTicket.set(null);
  }

  private focusTicketEditor(): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.ticket--editing input')?.focus(), 50);
  }

  formatPrice(value: number): string {
    return `${numberFmt.format(value)} FCFA`;
  }

  /* ------------------------------------------------------------------
     ÉDITEUR (inchangé)
     ------------------------------------------------------------------ */
  format(command: FormatCommand): void {
    this.editor().nativeElement.focus();
    document.execCommand(command);
    this.onEditorInput();
    this.onSelectionChange();
  }

  onEditorInput(): void {
    const el = this.editor().nativeElement;
    if (!el.textContent?.trim() && !el.querySelector('li, a')) el.innerHTML = '';
    const control = this.description.controls.full;
    control.setValue(el.innerHTML);
    control.markAsDirty();
  }

  onEditorBlur(): void {
    this.description.controls.full.markAsTouched();
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }

  @HostListener('document:selectionchange')
  onSelectionChange(): void {
    const anchor = document.getSelection()?.anchorNode;
    if (!anchor || !this.editor().nativeElement.contains(anchor)) return;
    const next = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
    };
    if (JSON.stringify(next) !== JSON.stringify(this.activeFormats())) this.activeFormats.set(next);
  }

  openLink(): void {
    const selection = document.getSelection();
    const el = this.editor().nativeElement;
    this.savedRange =
      selection && selection.rangeCount && el.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    this.linkError.set(null);
    this.linkOpen.set(true);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.editor__link input')?.focus(), 30);
  }

  closeLink(): void {
    this.linkOpen.set(false);
    this.linkError.set(null);
  }

  applyLink(input: HTMLInputElement): void {
    let url = input.value.trim();
    if (!url) {
      this.linkError.set('Entrez une adresse.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    let href: string;
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocole');
      href = parsed.href;
    } catch {
      this.linkError.set('Adresse invalide.');
      return;
    }

    this.editor().nativeElement.focus();
    const selection = document.getSelection();
    if (selection && this.savedRange) {
      selection.removeAllRanges();
      selection.addRange(this.savedRange);
    }
    if (selection && !selection.isCollapsed) {
      document.execCommand('createLink', false, href);
    } else {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = href;
      document.execCommand('insertHTML', false, anchor.outerHTML);
    }
    input.value = '';
    this.closeLink();
    this.onEditorInput();
  }

  /* ------------------------------------------------------------------
     ENREGISTREMENT → API
     ------------------------------------------------------------------ */
  onNotifyChange(event: Event): void {
    this.notifyParticipants.set((event.target as HTMLInputElement).checked);
  }

  async save(publish = false): Promise<void> {
    const current = this.status();

    if (publish || current === 'published') {
      const firstInvalid = [0, 1, 2, 3, 4].find((i) => !this.isStepValid(i));
      if (firstInvalid !== undefined) {
        this.form.markAllAsTouched();
        this.attemptedSteps.update((list) => (list.includes(firstInvalid) ? list : [...list, firstInvalid]));
        this.moveTo(firstInvalid);
        this.focusFirstInvalid();
        this.showToast('error', 'Corrigez les champs signalés avant de continuer.');
        return;
      }
    } else if (this.info.controls.title.invalid) {
      this.info.controls.title.markAsTouched();
      this.moveTo(0);
      this.focusFirstInvalid();
      this.showToast('error', "Le nom de l'événement est obligatoire.");
      return;
    }

    this.saving.set(publish ? 'publish' : 'save');
    console.info(`[EditEvent] ${publish ? 'Publication' : 'Enregistrement'} en cours...`);

    try {
      const id = this.eventId();
      if (!id) throw new Error('Event ID manquant.');

      // 1. PATCH de l'événement
      const payload = this.buildUpdatePayload();
      await firstValueFrom(this.eventService.updateEvent(id, payload));
      console.info('[EditEvent] Événement mis à jour');

      // 2. Upload couverture si changée
      if (this.coverFile) {
        try {
          await firstValueFrom(this.eventService.uploadCover(id, this.coverFile));
          console.info('[EditEvent] Couverture mise à jour');
        } catch (coverErr) {
          console.warn('[EditEvent] Upload couverture échoué', coverErr);
          this.notification.warning("L'événement a été mis à jour mais l'image n'a pas pu être envoyée.", 'Attention');
        }
      }

      // 3. Tickets : créer les nouveaux, mettre à jour les existants, désactiver les supprimés
      if (this.isPaid()) {
        await this.syncTickets(id);
      }

      // 4. Publier si demandé (ou si déjà publié, on ne republie pas)
      if (publish && current === 'draft') {
        await firstValueFrom(this.eventService.publishEvent(id));
        this.status.set('published');
        console.info('[EditEvent] Événement publié');
      }

      // 5. État local + succès
      this.updatedAt.set(new Date().toISOString());
      this.commitSaved();
      this.notification.success(
        publish ? 'Événement publié.' : 'Modifications enregistrées.',
        'Succès',
      );
    } catch (err: any) {
      console.error('[EditEvent] Échec enregistrement', err);
      if (err?.error?.errors) {
        this.applyServerErrors(err.error.errors);
        this.notification.error(err.error.message || 'Certains champs sont invalides.', 'Validation');
      } else {
        this.notification.httpError(err);
      }
    } finally {
      this.saving.set(null);
    }
  }

  private buildUpdatePayload() {
    const v = this.form.getRawValue();
    const s = v.schedule;
    const p = v.participation;

    const start_at = combineDateTime(s.date, s.startTime);
    const end_at = s.endTime
      ? combineDateTime(s.date, s.endTime)
      : new Date(new Date(start_at).getTime() + 2 * 60 * 60 * 1000).toISOString();

    let base_price: string | null = null;
    if (p.type === 'paid' && this.tickets().length > 0) {
      base_price = String(Math.min(...this.tickets().map((t) => t.price)));
    } else if (p.type === 'paid') {
      base_price = '1';
    }

    return {
      title: v.info.title.trim(),
      short_description: v.info.summary.trim() || v.info.title.trim().slice(0, 100),
      description: v.description.full || `<p>${v.info.summary.trim()}</p>`,
      format: toApiFormat(s.format),
      participation_type: toApiType(p.type),
      capacity_type: toApiCapacityMode(p.capacityMode),
      capacity_limit: p.capacityMode === 'limited' ? Number(p.capacity) : null,
      base_price,
      start_at,
      end_at,
      venue_name: s.format === 'onsite' ? s.venueName.trim() : '',
      address: s.format === 'onsite' ? s.address.trim() : '',
      city: s.format === 'onsite' ? s.city.trim() : '',
      room: s.format === 'onsite' ? s.room.trim() : '',
      online_platform: s.format === 'online' ? s.platform : '',
      access_url: s.format === 'online' ? s.link.trim() : '',
      category: v.info.category,
    };
  }

  private async syncTickets(eventId: string): Promise<void> {
    const requests: Promise<any>[] = [];

    for (const t of this.tickets()) {
      if (t.isNew) {
        requests.push(
          firstValueFrom(
            this.ticketTypeService.create(eventId, {
              name: t.name,
              price: String(t.price),
              quantity_total: t.seats,
              description: t.description || undefined,
            }),
          ),
        );
      } else {
        requests.push(
          firstValueFrom(
            this.ticketTypeService.update(t.id, {
              name: t.name,
              price: String(t.price),
              quantity_total: t.seats,
              description: t.description || undefined,
            }),
          ),
        );
      }
    }

    // Tickets supprimés localement → désactiver côté backend
    const currentIds = new Set(this.tickets().filter((t) => !t.isNew).map((t) => t.id));
    for (const oldId of this.originalTicketIds) {
      if (!currentIds.has(oldId)) {
        requests.push(
          firstValueFrom(
            this.ticketTypeService.update(oldId, { is_active: false }),
          ),
        );
      }
    }

    if (requests.length) {
      await Promise.all(requests);
      console.info(`[EditEvent] ${requests.length} tickets synchronisés`);
    }
  }

  private applyServerErrors(errors: Record<string, string[] | string>): void {
    const map: Record<string, AbstractControl | null> = {
      title: this.info.controls.title,
      short_description: this.info.controls.summary,
      description: this.description.controls.full,
      category: this.info.controls.category,
      start_at: this.schedule.controls.date,
      end_at: this.schedule.controls.endTime,
      format: this.schedule.controls.format,
      venue_name: this.schedule.controls.venueName,
      address: this.schedule.controls.address,
      city: this.schedule.controls.city,
      online_platform: this.schedule.controls.platform,
      access_url: this.schedule.controls.link,
      capacity_limit: this.participation.controls.capacity,
      base_price: this.participation.controls.capacity,
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
     SUPPRESSION → API
     ------------------------------------------------------------------ */
  async deleteEvent(): Promise<void> {
    if (!this.canDelete()) return;
    const id = this.eventId();
    if (!id) return;

    this.deleting.set(true);
    console.info('[EditEvent] Suppression...');
    try {
      await firstValueFrom(this.eventService.deleteEvent(id));
      this.skipGuard = true;
      this.notification.success('Événement supprimé.', 'Succès');
      await this.router.navigate(['/organisateur/evenements']);
    } catch (err) {
      console.error('[EditEvent] Échec suppression', err);
      this.notification.httpError(err);
    } finally {
      this.deleting.set(false);
      this.confirmDelete.set(false);
    }
  }

  /* ------------------------------------------------------------------
     DIVERS (inchangés)
     ------------------------------------------------------------------ */
  formatDateLong(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return longDate.format(new Date(year, month - 1, day));
  }

  private showToast(kind: Toast['kind'], text: string): void {
    this.toast.set({ kind, text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4500);
  }

  canDeactivate(): boolean {
    return (
      this.skipGuard ||
      !this.hasChanges() ||
      window.confirm('Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter cette page ?')
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasChanges() && !this.skipGuard) event.preventDefault();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.confirmDelete.set(false);
  }
}
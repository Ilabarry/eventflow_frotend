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
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin, of, switchMap, catchError, throwError, Observable } from 'rxjs';

import { CategoryService } from '../../../core/services/category.service';
import { EventService } from '../../../core/services/event.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TicketTypeService } from '../../../core/services/ticket-type.service';
import { CategoryDto } from '../../../core/models/event.model';

type EventFormat = '' | 'online' | 'onsite';
type EventType = 'free' | 'paid';
type CapacityMode = '' | 'limited' | 'unlimited';
type SaveStatus = 'draft' | 'published';
type FormatCommand = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';

interface Ticket {
  id: number;
  name: string;
  price: number;
  seats: number;
  description: string;
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

interface DraftData {
  savedAt: number;
  step: number;
  tickets: Ticket[];
  form: unknown;
}

const DRAFT_KEY = 'evf.organizer.event-draft';
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const LAST_STEP = 5;

const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', style: 'short' } as Intl.DateTimeFormatOptions);
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

const notPastDate: ValidatorFn = (control) =>
  !control.value || control.value >= todayIso() ? null : { pastDate: true };

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
  selector: 'app-organizer-create-event',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './creer-evenement.component.html',
  styleUrl: './creer-evenement.component.scss',
})
export class OrganizerCreateEventComponent implements AfterViewInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly eventService = inject(EventService);
  private readonly categoryService = inject(CategoryService);
  private readonly ticketTypeService = inject(TicketTypeService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

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

  /** Catégories chargées dynamiquement depuis /api/categories/ */
  readonly categories = signal<CategoryDto[]>([]);
  readonly categoriesLoading = signal(true);

  readonly platforms = ['Zoom', 'Google Meet', 'Microsoft Teams', 'YouTube Live', 'Autre'];

  /* ------------------------------------------------------------------
     FORMULAIRE
     ------------------------------------------------------------------ */
  readonly form = this.fb.group({
    info: this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
      category: ['', Validators.required],           // stocke l'ID de la catégorie
      summary: ['', Validators.maxLength(200)],
    }),
    schedule: this.fb.group(
      {
        date: ['', [Validators.required, notPastDate]],
        startTime: ['', Validators.required],
        endTime: [''],
        format: ['' as EventFormat, Validators.required],
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
      type: ['free' as EventType, Validators.required],
      capacityMode: ['' as CapacityMode, Validators.required],
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
     ÉTAT
     ------------------------------------------------------------------ */
  readonly step = signal(0);
  readonly maxReached = signal(0);
  readonly attemptedSteps = signal<number[]>([]);

  readonly tickets = signal<Ticket[]>([]);
  readonly editingTicket = signal<number | 'new' | null>(null);
  private nextTicketId = 1;

  readonly cover = signal<{ name: string; size: number; url: string } | null>(null);
  readonly coverError = signal<string | null>(null);
  readonly dragging = signal(false);
  private coverFile: File | null = null;

  readonly activeFormats = signal({ bold: false, italic: false, underline: false, ul: false, ol: false });
  readonly linkOpen = signal(false);
  readonly linkError = signal<string | null>(null);
  private savedRange: Range | null = null;

  readonly publishing = signal(false);
  readonly published = signal(false);
  readonly restoredAt = signal<number | null>(null);
  readonly toast = signal<Toast | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.restoreDraft();
    this.loadCategories();

    this.destroyRef.onDestroy(() => {
      this.releaseCover();
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }

  ngAfterViewInit(): void {
    const html = this.description.controls.full.value;
    if (html) {
      this.editor().nativeElement.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
    }
  }

  /* ------------------------------------------------------------------
     CHARGEMENT DES CATÉGORIES
     ------------------------------------------------------------------ */
  private loadCategories(): void {
    this.categoriesLoading.set(true);
    this.categoryService.list().subscribe({
      next: (res) => {
        const list = res.data ?? [];
        this.categories.set(list);
        this.categoriesLoading.set(false);
        console.info(`[CreateEvent] ${list.length} catégories chargées`);
      },
      error: (err) => {
        this.categoriesLoading.set(false);
        console.error('[CreateEvent] Échec chargement catégories', err.status);
        this.notification.httpError(err);
      },
    });
  }

  /* ------------------------------------------------------------------
     VALIDATEURS CONDITIONNELS (inchangés)
     ------------------------------------------------------------------ */
  private applyFormatValidators(format: EventFormat): void {
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

  private applyCapacityValidators(mode: CapacityMode): void {
    const capacity = this.participation.controls.capacity;
    if (mode === 'limited') {
      capacity.setValidators([
        Validators.required, Validators.min(1), Validators.max(1_000_000), Validators.pattern(/^\d+$/),
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

  stepState(index: number): 'current' | 'done' | 'invalid' | 'todo' {
    if (index === this.step()) return 'current';
    if (index > this.maxReached() || index === LAST_STEP) return 'todo';
    return this.isStepValid(index) ? 'done' : 'invalid';
  }

  invalidSteps(): number[] {
    return [0, 1, 2, 3, 4].filter((i) => !this.isStepValid(i));
  }

  wasAttempted(index: number): boolean {
    return this.attemptedSteps().includes(index);
  }

  goTo(index: number): void {
    if (index <= this.maxReached()) this.moveTo(index);
  }

  editStep(index: number): void {
    this.moveTo(index);
  }

  next(): void {
    const index = this.step();
    this.attemptedSteps.update((list) => (list.includes(index) ? list : [...list, index]));
    this.markStepTouched(index);
    if (!this.isStepValid(index)) {
      this.focusFirstInvalid();
      return;
    }
    this.moveTo(index + 1);
  }

  prev(): void {
    this.moveTo(this.step() - 1);
  }

  private moveTo(index: number): void {
    if (index < 0 || index > LAST_STEP) return;
    this.step.set(index);
    this.maxReached.update((m) => Math.max(m, index));
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
    if (e['min']) return `La valeur minimale est ${e['min'].min}.`;
    if (e['max']) return `La valeur maximale est ${numberFmt.format(e['max'].max)}.`;
    if (e['pattern']) return 'Entrez un nombre entier.';
    if (e['pastDate']) return 'La date ne peut pas être dans le passé.';
    if (e['url']) return 'Entrez une adresse valide (https://...).';
    if (e['capacity']) return `Il ne reste que ${e['capacity'].max} place(s) disponible(s).`;
    return 'Valeur invalide.';
  }

  /* ------------------------------------------------------------------
     COUVERTURE (inchangée)
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
    this.cover.set({ name: file.name, size: file.size, url: URL.createObjectURL(file) });
    this.coverError.set(null);
    this.form.markAsDirty();
  }

  removeCover(): void {
    this.releaseCover();
    this.coverFile = null;
    this.cover.set(null);
  }

  private releaseCover(): void {
    const current = this.cover();
    if (current) URL.revokeObjectURL(current.url);
  }

  formatSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
      : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  /* ------------------------------------------------------------------
     TICKETS (inchangés)
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

    const limit = this.capacityLimit();
    if (limit !== null) {
      const others = this.tickets()
        .filter((t) => t.id !== editing)
        .reduce((sum, t) => sum + t.seats, 0);
      const remaining = limit - others;
      if (seats > remaining) {
        this.ticketForm.controls.seats.setErrors({ capacity: { max: Math.max(remaining, 0) } });
        this.ticketForm.controls.seats.markAsTouched();
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
      this.tickets.update((list) => [...list, { id: this.nextTicketId++, ...data }]);
    } else {
      this.tickets.update((list) => list.map((t) => (t.id === editing ? { ...t, ...data } : t)));
    }
    this.editingTicket.set(null);
    this.form.markAsDirty();
  }

  deleteTicket(id: number): void {
    this.tickets.update((list) => list.filter((t) => t.id !== id));
    if (this.editingTicket() === id) this.editingTicket.set(null);
    this.form.markAsDirty();
  }

  private focusTicketEditor(): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.ticket--editing input')?.focus(), 50);
  }

  formatPrice(value: number): string {
    return `${numberFmt.format(value)} FCFA`;
  }

  /* ------------------------------------------------------------------
     ÉDITEUR RICHE (inchangé)
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
     BROUILLON (inchangé)
     ------------------------------------------------------------------ */
  saveDraft(): void {
    const title = this.info.controls.title;
    if (!title.value.trim()) {
      title.markAsTouched();
      this.moveTo(0);
      this.focusFirstInvalid();
      this.showToast('error', "Donnez au moins un nom à votre événement pour l'enregistrer en brouillon.");
      return;
    }
    const data: DraftData = {
      savedAt: Date.now(),
      step: this.step(),
      tickets: this.tickets(),
      form: this.form.getRawValue(),
    };
    if (this.writeStorage(JSON.stringify(data))) {
      this.form.markAsPristine();
      this.showToast('success', 'Brouillon enregistré.');
      this.notification.info('Brouillon enregistré localement.', 'Info');
    } else {
      this.showToast('error', "Impossible d'enregistrer le brouillon sur cet appareil.");
    }
  }

  private restoreDraft(): void {
    const raw = this.readStorage();
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as DraftData;
      this.form.patchValue(data.form as never);
      const tickets = Array.isArray(data.tickets) ? data.tickets : [];
      this.tickets.set(tickets);
      this.nextTicketId = Math.max(0, ...tickets.map((t) => t.id)) + 1;
      const step = Math.min(Math.max(Number(data.step) || 0, 0), LAST_STEP);
      this.step.set(step);
      this.maxReached.set(step);
      this.restoredAt.set(data.savedAt);
    } catch {
      this.removeStorage();
    }
  }

  discardDraft(): void {
    this.removeStorage();
    this.createAnother();
  }

  private readStorage(): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(DRAFT_KEY);
    } catch {
      return null;
    }
  }

  private writeStorage(value: string): boolean {
    try {
      localStorage.setItem(DRAFT_KEY, value);
      return true;
    } catch {
      return false;
    }
  }

  private removeStorage(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* stockage indisponible */
    }
  }

  /* ------------------------------------------------------------------
     PUBLICATION → API
     ------------------------------------------------------------------ */
  async publish(): Promise<void> {
    const firstInvalid = [0, 1, 2, 3, 4].find((i) => !this.isStepValid(i));
    if (firstInvalid !== undefined) {
      this.form.markAllAsTouched();
      this.attemptedSteps.update((list) => (list.includes(firstInvalid) ? list : [...list, firstInvalid]));
      this.moveTo(firstInvalid);
      this.focusFirstInvalid();
      this.notification.warning('Complétez les informations obligatoires avant de publier.', 'Formulaire incomplet');
      return;
    }

    this.publishing.set(true);
    console.info('[CreateEvent] Publication en cours...');

    try {
      // 1. Créer l'événement en DRAFT
      const payload = this.buildCreatePayload();
      const created = await firstValueFrom(this.eventService.createEvent(payload));
      const createdData = created.data;
      if (!createdData) throw new Error('Réponse backend vide.');

      console.info(`[CreateEvent] Événement créé : ${createdData.id}`);

      // 2. Uploader la couverture si présente
      if (this.coverFile) {
        try {
          await firstValueFrom(this.eventService.uploadCover(createdData.id, this.coverFile));
          console.info('[CreateEvent] Couverture uploadée');
        } catch (coverErr) {
          console.warn('[CreateEvent] Upload couverture échoué', coverErr);
          this.notification.warning(
            "L'événement a été créé mais l'image de couverture n'a pas pu être envoyée.",
            'Attention',
          );
        }
      }

      // 3. Créer les TicketTypes (si payant)
      if (this.isPaid() && this.tickets().length > 0) {
        const ticketRequests = this.tickets().map((t) =>
          this.ticketTypeService.create(createdData.id, {
            name: t.name,
            price: String(t.price),
            quantity_total: t.seats,
            description: t.description || undefined,
          }),
        );
        await firstValueFrom(forkJoin(ticketRequests));
        console.info(`[CreateEvent] ${ticketRequests.length} tickets créés`);
      }

      // 4. Publier l'événement
      await firstValueFrom(this.eventService.publishEvent(createdData.id));
      console.info(`[CreateEvent] Événement ${createdData.id} publié`);

      // 5. Nettoyage + succès
      this.removeStorage();
      this.form.markAsPristine();
      this.published.set(true);
      this.notification.success(`Événement « ${createdData.title} » publié !`, 'Succès');
      this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err: any) {
      console.error('[CreateEvent] Échec publication', err);

      // Cas particulier : erreurs de validation DRF → champ par champ
      if (err?.error?.errors) {
        this.applyServerErrors(err.error.errors);
        this.notification.error(
          err.error.message || 'Certains champs sont invalides. Vérifiez le formulaire.',
          'Validation',
        );
      } else {
        this.notification.httpError(err);
      }
    } finally {
      this.publishing.set(false);
    }
  }

  private buildCreatePayload() {
    const v = this.form.getRawValue();
    const s = v.schedule;
    const p = v.participation;

    // Conversion format
    const format =
      s.format === 'online' ? 'ONLINE' :
      s.format === 'onsite' ? 'IN_PERSON' :
      'IN_PERSON';

    // Conversion participation
    const participation_type = p.type === 'paid' ? 'PAID' : 'FREE';

    // Conversion capacité
    const capacity_type = p.capacityMode === 'limited' ? 'LIMITED' : 'UNLIMITED';
    const capacity_limit =
      p.capacityMode === 'limited' && Number(p.capacity) > 0 ? Number(p.capacity) : null;

    // Conversion date + heure → ISO
    const start_at = this.combineDateAndTime(s.date, s.startTime);
    const end_at = s.endTime
      ? this.combineDateAndTime(s.date, s.endTime)
      : new Date(new Date(start_at).getTime() + 2 * 60 * 60 * 1000).toISOString(); // +2h par défaut

    // Prix (obligatoire si PAID)
    let base_price: string | null = null;
    if (participation_type === 'PAID' && this.tickets().length > 0) {
      // Le backend exige base_price > 0 sur l'Event.
      // On utilise le prix minimum des tickets comme prix "de base".
      const minPrice = Math.min(...this.tickets().map((t) => t.price));
      base_price = String(minPrice);
    } else if (participation_type === 'PAID') {
      // Sécurité : ne devrait pas arriver car ticketsIssue() l'empêche
      base_price = '1';
    }

    return {
      title: v.info.title.trim(),
      short_description: v.info.summary.trim() || v.info.title.trim().slice(0, 100),
      description: v.description.full || `<p>${v.info.summary.trim()}</p>`,
      format: format as any,
      participation_type: participation_type as any,
      capacity_type: capacity_type as any,
      capacity_limit,
      base_price,
      start_at,
      end_at,
      venue_name: format === 'IN_PERSON' ? s.venueName.trim() : '',
      address: format === 'IN_PERSON' ? s.address.trim() : '',
      city: format === 'IN_PERSON' ? s.city.trim() : '',
      room: format === 'IN_PERSON' ? s.room.trim() : '',
      online_platform: format === 'ONLINE' ? s.platform : '',
      access_url: format === 'ONLINE' ? s.link.trim() : '',
      category: v.info.category,   // ID
    };
  }

  /** Combine "2026-11-15" + "14:00" → ISO avec timezone locale. */
  private combineDateAndTime(date: string, time: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
  }

  /** Mappe les erreurs DRF sur les contrôles du formulaire. */
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
      base_price: this.participation.controls.capacity, // approximation
    };

    Object.entries(errors).forEach(([field, value]) => {
      const ctrl = map[field];
      if (!ctrl) return;
      const messages = Array.isArray(value) ? value : [value];
      ctrl.setErrors({ server: messages.join(' ') });
      ctrl.markAsTouched();
    });
  }

  createAnother(): void {
    this.form.reset();
    this.ticketForm.reset();
    this.tickets.set([]);
    this.editingTicket.set(null);
    this.nextTicketId = 1;
    this.removeCover();
    this.editor().nativeElement.innerHTML = '';
    this.closeLink();
    this.step.set(0);
    this.maxReached.set(0);
    this.attemptedSteps.set([]);
    this.restoredAt.set(null);
    this.published.set(false);
  }

  /* ------------------------------------------------------------------
     DIVERS
     ------------------------------------------------------------------ */
  formatDateLong(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return longDate.format(new Date(year, month - 1, day));
  }

  formatDateTime(timestamp: number): string {
    return dateTime.format(new Date(timestamp));
  }

  private showToast(kind: Toast['kind'], text: string): void {
    this.toast.set({ kind, text });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4500);
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty && !this.published()) event.preventDefault();
  }
}
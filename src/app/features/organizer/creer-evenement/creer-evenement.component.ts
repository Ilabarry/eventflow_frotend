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
import { RouterLink } from '@angular/router';

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
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const numberFmt = new Intl.NumberFormat('fr-FR');

/* ----------------------------------------------------------------
   VALIDATEURS
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

  readonly categories = [
    'Conférence', 'Formation', 'Atelier', 'Webinaire', 'Hackathon', 'Salon', 'Festival',
    'Networking', 'Forum', 'Masterclass', 'Culture', 'Sport', 'Autre',
  ];

  readonly platforms = ['Zoom', 'Google Meet', 'Microsoft Teams', 'YouTube Live', 'Autre'];

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

  /** Formulaire d'édition d'un ticket (un seul à la fois) */
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
  /** Se met à jour à chaque modification du formulaire */
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

  /** Message bloquant de l'étape « Tickets » (null = tout est bon) */
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
    return {
      title: v.info.title.trim(),
      category: v.info.category,
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

    this.destroyRef.onDestroy(() => {
      this.releaseCover();
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });
  }

  ngAfterViewInit(): void {
    // Réinjecte la description d'un brouillon restauré dans l'éditeur (HTML nettoyé)
    const html = this.description.controls.full.value;
    if (html) {
      this.editor().nativeElement.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
    }
  }

  /* ------------------------------------------------------------------
     VALIDATEURS CONDITIONNELS
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
     NAVIGATION ENTRE ÉTAPES
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

  /** Clic sur une étape de la liste : uniquement les étapes déjà atteintes */
  goTo(index: number): void {
    if (index <= this.maxReached()) this.moveTo(index);
  }

  /** Bouton « Modifier » de l'aperçu */
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
     ERREURS
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
     IMAGE DE COUVERTURE
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
     TICKETS
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
     ÉDITEUR RICHE (contenteditable)
     ------------------------------------------------------------------ */
  format(command: FormatCommand): void {
    this.editor().nativeElement.focus();
    document.execCommand(command);
    this.onEditorInput();
    this.onSelectionChange();
  }

  onEditorInput(): void {
    const el = this.editor().nativeElement;
    // Évite le <br> résiduel qui empêche l'affichage du placeholder
    if (!el.textContent?.trim() && !el.querySelector('li, a')) el.innerHTML = '';
    const control = this.description.controls.full;
    control.setValue(el.innerHTML);
    control.markAsDirty();
  }

  onEditorBlur(): void {
    this.description.controls.full.markAsTouched();
  }

  /** Colle toujours en texte brut (pas de styles ni de HTML externe) */
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
     BROUILLON (stockage local en attendant l'API)
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
    // TODO : remplacer par un appel API (création / mise à jour avec status 'draft')
    if (this.writeStorage(JSON.stringify(data))) {
      this.form.markAsPristine();
      this.showToast('success', 'Brouillon enregistré.');
    } else {
      this.showToast('error', "Impossible d'enregistrer le brouillon sur cet appareil.");
    }
  }

  private restoreDraft(): void {
    const raw = this.readStorage();
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as DraftData;
      this.form.patchValue(data.form as never); // déclenche aussi les validateurs conditionnels
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
      /* stockage indisponible : rien à faire */
    }
  }

  /* ------------------------------------------------------------------
     PUBLICATION
     ------------------------------------------------------------------ */
  async publish(): Promise<void> {
    const firstInvalid = [0, 1, 2, 3, 4].find((i) => !this.isStepValid(i));
    if (firstInvalid !== undefined) {
      this.form.markAllAsTouched();
      this.attemptedSteps.update((list) => (list.includes(firstInvalid) ? list : [...list, firstInvalid]));
      this.moveTo(firstInvalid);
      this.focusFirstInvalid();
      this.showToast('error', 'Complétez les informations obligatoires avant de publier.');
      return;
    }

    this.publishing.set(true);
    const payload = this.toPayload('published');
    try {
      // TODO : await firstValueFrom(this.eventService.create(payload));
      console.debug('Payload de création (à envoyer à l\'API)', payload);
      await new Promise((resolve) => setTimeout(resolve, 900));
      this.removeStorage();
      this.form.markAsPristine();
      this.published.set(true);
      this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      this.showToast('error', 'La publication a échoué. Veuillez réessayer.');
    } finally {
      this.publishing.set(false);
    }
  }

  private toPayload(status: SaveStatus) {
    const v = this.form.getRawValue();
    const s = v.schedule;
    const p = v.participation;
    return {
      status,
      title: v.info.title.trim(),
      category: v.info.category,
      summary: v.info.summary.trim(),
      coverImage: this.coverFile, // TODO : upload multipart ou URL signée
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime || null,
      format: s.format,
      venue:
        s.format === 'onsite'
          ? { name: s.venueName.trim(), address: s.address.trim(), city: s.city.trim(), room: s.room.trim() || null }
          : null,
      online: s.format === 'online' ? { platform: s.platform, link: s.link.trim() || null } : null,
      isFree: p.type === 'free',
      capacity: p.capacityMode === 'limited' ? Number(p.capacity) : null,
      tickets: p.type === 'paid' ? this.tickets() : [],
      description: v.description.full,
      notes: v.description.notes.trim() || null,
    };
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
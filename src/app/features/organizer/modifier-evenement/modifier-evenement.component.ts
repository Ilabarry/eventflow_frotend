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

type EventStatus = 'draft' | 'published' | 'finished';
type EventFormat = '' | 'online' | 'onsite';
type EventType = 'free' | 'paid';
type CapacityMode = '' | 'limited' | 'unlimited';
type LoadState = 'loading' | 'ready' | 'notfound' | 'locked' | 'error';
type FormatCommand = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';

interface Ticket {
  id: number; // négatif = ticket créé ici, pas encore enregistré côté serveur
  name: string;
  price: number;
  seats: number;
  description: string;
  sold: number;
}

interface EventData {
  id: number;
  status: EventStatus;
  title: string;
  category: string;
  summary: string;
  coverUrl: string | null;
  date: string;
  startTime: string;
  endTime: string;
  format: 'online' | 'onsite';
  venueName: string;
  address: string;
  city: string;
  room: string;
  platform: string;
  link: string;
  type: EventType;
  capacityMode: 'limited' | 'unlimited';
  capacity: number | null;
  tickets: Ticket[];
  descriptionHtml: string;
  notes: string;
  registered: number;
  updatedAt: string;
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
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ----------------------------------------------------------------
   DONNÉES DE DÉMONSTRATION
   TODO : remplacer fetchEvent() par ton service (GET /events/:id)
   Pour tester : /evenements/1/modifier (publié, avec ventes),
                 /evenements/2/modifier (brouillon),
                 /evenements/9/modifier (terminé → verrouillé)
   ---------------------------------------------------------------- */
const MOCK_EVENTS: EventData[] = [
  {
    id: 1, status: 'published', title: 'Tech Conférence', category: 'Conférence',
    summary: 'La grande conférence annuelle des acteurs du numérique à Dakar.',
    coverUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80',
    date: '2026-11-30', startTime: '14:00', endTime: '18:00', format: 'onsite',
    venueName: 'Centre de conférence', address: 'Avenue Cheikh Anta Diop', city: 'Dakar', room: 'Salle A',
    platform: '', link: '', type: 'paid', capacityMode: 'limited', capacity: 500,
    tickets: [
      { id: 1, name: 'Standard', price: 5000, seats: 400, description: "Accès standard à l'événement", sold: 380 },
      { id: 2, name: 'VIP', price: 10000, seats: 100, description: 'Accès prioritaire et cocktail', sold: 100 },
    ],
    descriptionHtml: '<p>Une journée de <b>conférences</b> et de rencontres.</p><ul><li>Keynotes</li><li>Ateliers pratiques</li><li>Networking</li></ul>',
    notes: "Pensez à apporter votre pièce d'identité.", registered: 480, updatedAt: '2026-10-18T09:30:00',
  },
  {
    id: 2, status: 'draft', title: 'Python Workshop', category: 'Formation',
    summary: 'Initiation pratique à Python en une demi-journée.',
    coverUrl: null,
    date: '2026-12-15', startTime: '10:00', endTime: '12:00', format: 'online',
    venueName: '', address: '', city: '', room: '', platform: 'Zoom', link: '',
    type: 'free', capacityMode: 'limited', capacity: 50, tickets: [],
    descriptionHtml: '<p>Apprenez les bases de Python avec des exercices guidés.</p>',
    notes: '', registered: 0, updatedAt: '2026-10-20T16:10:00',
  },
  {
    id: 9, status: 'finished', title: 'Forum Emploi Jeunes', category: 'Forum',
    summary: '', coverUrl: null, date: '2026-09-18', startTime: '09:00', endTime: '17:00', format: 'onsite',
    venueName: 'Palais des congrès', address: '', city: 'Dakar', room: '', platform: '', link: '',
    type: 'free', capacityMode: 'limited', capacity: 700, tickets: [],
    descriptionHtml: '<p>Forum terminé.</p>', notes: '', registered: 640, updatedAt: '2026-09-19T08:00:00',
  },
];

const fetchEvent = async (id: number): Promise<EventData | null> => {
  await delay(500);
  const found = MOCK_EVENTS.find((e) => e.id === id);
  return found ? structuredClone(found) : null;
};

/* ----------------------------------------------------------------
   VALIDATEURS
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

  readonly statusLabel: Record<EventStatus, string> = {
    draft: 'Brouillon',
    published: 'Publié',
    finished: 'Terminé',
  };

  /* ------------------------------------------------------------------
     ÉTAT DE L'ÉVÉNEMENT CHARGÉ
     ------------------------------------------------------------------ */
  readonly loadState = signal<LoadState>('loading');
  readonly eventId = signal<number | null>(null);
  readonly eventTitle = signal('');
  readonly status = signal<EventStatus>('draft');
  readonly registered = signal(0);
  readonly updatedAt = signal<string | null>(null);
  readonly originalDate = signal('');

  private loaded: EventData | null = null;
  private currentLoad = 0;
  private hadCover = false;
  private skipGuard = false;
  private resolveView!: () => void;
  private readonly viewReady = new Promise<void>((resolve) => (this.resolveView = resolve));

  /** La date d'origine reste valide même si elle est passée ; une nouvelle date ne peut pas l'être */
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
     ÉTAT UI
     ------------------------------------------------------------------ */
  readonly step = signal(0);
  readonly visited = signal<number[]>([0]);
  readonly attemptedSteps = signal<number[]>([]);

  readonly tickets = signal<Ticket[]>([]);
  readonly editingTicket = signal<number | 'new' | null>(null);
  private nextTempId = -1;

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

  /** Instantané de l'état chargé / enregistré, pour détecter les modifications par étape */
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
    return typeof id === 'number' ? (this.tickets().find((t) => t.id === id)?.sold ?? 0) : 0;
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

  readonly canDelete = computed(() => this.registered() === 0);

  readonly updatedLabel = computed(() => {
    const iso = this.updatedAt();
    return iso ? dateTime.format(new Date(iso)) : '';
  });

  /** Chaque étape est comparée à l'état d'origine */
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

  /** Date, heure, format ou lieu modifiés alors que des participants sont inscrits */
  readonly showNotify = computed(
    () => this.status() === 'published' && this.registered() > 0 && this.changedSteps().includes(1),
  );

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

    this.route.paramMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => void this.load(Number(params.get('id'))));

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
  async load(id: number): Promise<void> {
    const token = ++this.currentLoad;
    this.eventId.set(Number.isFinite(id) ? id : null);
    this.loadState.set('loading');
    try {
      const data = Number.isFinite(id) ? await fetchEvent(id) : null; // TODO : service
      await this.viewReady;
      if (token !== this.currentLoad) return; // on est passé à un autre événement entre-temps

      if (!data) {
        this.loadState.set('notfound');
        return;
      }
      this.loaded = data;
      this.eventTitle.set(data.title);
      this.status.set(data.status);

      if (data.status === 'finished') {
        this.loadState.set('locked');
        return;
      }
      this.applyData(data);
      this.step.set(0);
      this.visited.set([0]);
      this.attemptedSteps.set([]);
      this.loadState.set('ready');
    } catch {
      if (token === this.currentLoad) this.loadState.set('error');
    }
  }

  retry(): void {
    void this.load(this.eventId() ?? 0);
  }

  /** Remplit (ou remet à l'état d'origine) tout le formulaire */
  private applyData(d: EventData): void {
    this.registered.set(d.registered);
    this.originalDate.set(d.date);
    this.updatedAt.set(d.updatedAt);
    this.notifyParticipants.set(true);

    this.releaseCover();
    this.coverFile = null;
    this.coverError.set(null);
    this.hadCover = !!d.coverUrl;
    this.cover.set(d.coverUrl ? { name: 'Image actuelle', size: 0, url: d.coverUrl, remote: true } : null);

    this.tickets.set(d.tickets.map((t) => ({ ...t })));
    this.nextTempId = -1;
    this.editingTicket.set(null);
    this.ticketForm.reset();
    this.closeLink();

    this.form.reset({
      info: { title: d.title, category: d.category, summary: d.summary },
      schedule: {
        date: d.date, startTime: d.startTime, endTime: d.endTime, format: d.format,
        venueName: d.venueName, address: d.address, city: d.city, room: d.room,
        platform: d.platform, link: d.link,
      },
      participation: { type: d.type, capacityMode: d.capacityMode, capacity: d.capacity },
      description: { full: d.descriptionHtml, notes: d.notes },
    });
    this.applyFormatValidators(d.format);
    this.applyCapacityValidators(d.capacityMode);

    // Le type gratuit/payant ne change plus dès que des participants sont inscrits
    const type = this.participation.controls.type;
    if (d.registered > 0) type.disable({ emitEvent: false });
    else type.enable({ emitEvent: false });

    // Éditeur riche : contenu nettoyé, puis relu pour que l'instantané corresponde au rendu réel
    const el = this.editor().nativeElement;
    el.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, d.descriptionHtml) ?? '';
    this.description.controls.full.setValue(el.innerHTML);

    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.baseline.set(this.stepSnapshots());
  }

  /** Annule toutes les modifications non enregistrées */
  resetChanges(): void {
    if (!this.loaded) return;
    this.applyData(this.loaded);
    this.showToast('success', 'Modifications annulées.');
  }

  /** Après un enregistrement réussi : l'état courant devient la référence */
  private commitSaved(): void {
    const current = this.cover();
    if (current) this.cover.set({ ...current, remote: true });
    this.coverFile = null;
    this.hadCover = current !== null;
    this.originalDate.set(this.schedule.controls.date.value);
    this.loaded = { ...(this.loaded as EventData), status: this.status() };
    this.form.markAsPristine();
    this.baseline.set(this.stepSnapshots());
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
    // Brouillon : on peut avancer librement ; événement publié : l'étape doit être valide
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
    if (e['belowRegistered']) return `Impossible de descendre sous le nombre d'inscrits (${e['belowRegistered'].min}).`;
    if (e['belowSold']) return `Au moins ${e['belowSold'].min} places : elles sont déjà vendues.`;
    if (e['min']) return `La valeur minimale est ${e['min'].min}.`;
    if (e['max']) return `La valeur maximale est ${numberFmt.format(e['max'].max)}.`;
    if (e['pattern']) return 'Entrez un nombre entier.';
    if (e['pastDate']) return 'La date ne peut pas être dans le passé.';
    if (e['url']) return 'Entrez une adresse valide (https://...).';
    if (e['capacity']) return `Il ne reste que ${e['capacity'].max} place(s) disponible(s).`;
    return 'Valeur invalide.';
  }

  /** Garde l'ancienne valeur dans la liste même si elle n'existe plus dans les options */
  withCurrent(list: string[], value: string): string[] {
    return value && !list.includes(value) ? [value, ...list] : list;
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
    const seatsControl = this.ticketForm.controls.seats;

    // On ne peut pas réduire les places sous le nombre déjà vendu
    const sold = typeof editing === 'number' ? (this.tickets().find((t) => t.id === editing)?.sold ?? 0) : 0;
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
      this.tickets.update((list) => [...list, { id: this.nextTempId--, sold: 0, ...data }]);
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
     ENREGISTREMENT
     ------------------------------------------------------------------ */
  onNotifyChange(event: Event): void {
    this.notifyParticipants.set((event.target as HTMLInputElement).checked);
  }

  async save(publish = false): Promise<void> {
    const current = this.status();

    if (publish || current === 'published') {
      // Publié (ou en cours de publication) : toutes les étapes doivent être valides
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
      // Brouillon : seul le titre est indispensable
      this.info.controls.title.markAsTouched();
      this.moveTo(0);
      this.focusFirstInvalid();
      this.showToast('error', 'Le nom de l\'événement est obligatoire.');
      return;
    }

    this.saving.set(publish ? 'publish' : 'save');
    const payload = this.toPayload(publish ? 'published' : current);
    try {
      // TODO : await firstValueFrom(this.eventService.update(this.eventId()!, payload));
      //        puis remplacer les tickets locaux (ids négatifs) par ceux renvoyés par l'API
      console.debug("Payload de modification (à envoyer à l'API)", payload);
      await delay(800);

      if (publish) this.status.set('published');
      this.updatedAt.set(new Date().toISOString());
      this.commitSaved();
      this.showToast('success', publish ? 'Événement publié.' : 'Modifications enregistrées.');
    } catch {
      this.showToast('error', "L'enregistrement a échoué. Veuillez réessayer.");
    } finally {
      this.saving.set(null);
    }
  }

  private toPayload(status: EventStatus) {
    const v = this.form.getRawValue();
    const s = v.schedule;
    const p = v.participation;
    return {
      id: this.eventId(),
      status,
      title: v.info.title.trim(),
      category: v.info.category,
      summary: v.info.summary.trim(),
      coverAction: this.coverFile ? 'replace' : this.cover() ? 'keep' : this.hadCover ? 'remove' : 'none',
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
      tickets:
        p.type === 'paid'
          ? this.tickets().map((t) => ({
              id: t.id > 0 ? t.id : null, // null = nouveau ticket
              name: t.name,
              price: t.price,
              seats: t.seats,
              description: t.description,
            }))
          : [],
      description: v.description.full,
      notes: v.description.notes.trim() || null,
      notifyParticipants: this.showNotify() && this.notifyParticipants(),
    };
  }

  /* ------------------------------------------------------------------
     SUPPRESSION
     ------------------------------------------------------------------ */
  async deleteEvent(): Promise<void> {
    if (!this.canDelete()) return;
    this.deleting.set(true);
    try {
      // TODO : await firstValueFrom(this.eventService.delete(this.eventId()!));
      await delay(700);
      this.skipGuard = true;
      await this.router.navigate(['/organisateur/evenements']);
    } catch {
      this.showToast('error', "La suppression a échoué. Veuillez réessayer.");
    } finally {
      this.deleting.set(false);
      this.confirmDelete.set(false);
    }
  }

  /* ------------------------------------------------------------------
     DIVERS
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

  /** Utilisé par le guard de route canDeactivate */
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
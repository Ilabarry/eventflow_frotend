import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn, Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { merge } from 'rxjs';

type SectionKey = 'infos' | 'organisation' | 'comptes' | 'securite';
type LoadState = 'loading' | 'ready' | 'error';
type ImageKind = 'avatar' | 'logo';
type OrgType = 'association' | 'company' | 'institution' | 'community' | 'independent';
type PwKey = 'current' | 'next' | 'confirm';
type Busy = 'infos' | 'org' | 'password' | 'participant' | 'delete';
type ModalKind = 'deactivate' | 'delete';

interface ParticipantAccount {
  since: string; // ISO
  registrations: number;
  upcoming: number; // inscriptions à venir encore actives
  tickets: number;
}

interface ProfileData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  bio: string;
  avatarUrl: string | null;
  org: {
    name: string;
    type: OrgType;
    website: string;
    description: string;
    logoUrl: string | null;
    facebook: string;
    linkedin: string;
    instagram: string;
  };
  participant: ParticipantAccount | null; // null = pas de compte participant
  memberSince: string; // ISO
  passwordChangedAt: string | null;
  upcomingEventsWithRegistrations: number; // empêche la suppression du compte
}

interface ImageState {
  url: string;
  name: string;
  local: boolean; // true = aperçu local (blob) à libérer
}

interface Toast {
  kind: 'success' | 'error';
  text: string;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const dateLong = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/* ----------------------------------------------------------------
   DONNÉES DE DÉMONSTRATION
   TODO : remplacer fetchProfile() par ton service (GET /me) et brancher
          les actions (PUT /me, PUT /me/organisation, POST /me/password,
          POST /me/participant-account, DELETE /me/participant-account,
          DELETE /me)
   Pour tester la suppression du compte : mets
   upcomingEventsWithRegistrations à 0.
   ---------------------------------------------------------------- */
const MOCK_PROFILE: ProfileData = {
  firstName: 'Ila',
  lastName: 'Barry',
  email: 'ila.barry@email.com',
  phone: '77 123 45 67',
  city: 'Dakar',
  country: 'Sénégal',
  bio: "Organisatrice d'événements tech et communautaires.",
  avatarUrl: null,
  org: {
    name: 'Teranga Events',
    type: 'community',
    website: '',
    description: "Collectif d'organisateurs d'événements tech et culturels.",
    logoUrl: null,
    facebook: '',
    linkedin: '',
    instagram: '',
  },
  participant: null,
  memberSince: '2026-03-12',
  passwordChangedAt: '2026-08-14',
  upcomingEventsWithRegistrations: 2,
};

const fetchProfile = async (): Promise<ProfileData> => {
  await delay(450);
  return structuredClone(MOCK_PROFILE);
};

/* ----------------------------------------------------------------
   VALIDATEURS
   ---------------------------------------------------------------- */
const phoneValidator: ValidatorFn = (control) => {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  if (!/^[+\d][\d\s().-]*$/.test(value)) return { phone: true };
  const digits = value.replace(/\D/g, '').length;
  return digits >= 8 && digits <= 15 ? null : { phone: true };
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

const strongPassword: ValidatorFn = (control) => {
  const v = String(control.value ?? '');
  if (!v) return null;
  return v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) ? null : { weak: true };
};

const passwordGroup: ValidatorFn = (group) => {
  const current = group.get('current')?.value;
  const next = group.get('next')?.value;
  const confirm = group.get('confirm')?.value;
  const errors: Record<string, true> = {};
  if (next && current && next === current) errors['sameAsCurrent'] = true;
  if (confirm && next !== confirm) errors['mismatch'] = true;
  return Object.keys(errors).length ? errors : null;
};

@Component({
  selector: 'app-organizer-profile',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './profil.component.html',
  styleUrl: './profil.component.scss',
})
export class OrganizerProfileComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  /* ------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------ */
  readonly sections: { key: SectionKey; label: string; hint: string; icon: string[] }[] = [
    {
      key: 'infos', label: 'Informations personnelles', hint: 'Nom, e-mail, photo',
      icon: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    },
    {
      key: 'organisation', label: 'Organisation', hint: 'Nom, logo, réseaux',
      icon: ['M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
    },
    {
      key: 'comptes', label: 'Mes espaces', hint: 'Organisateur et participant',
      icon: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
    },
    {
      key: 'securite', label: 'Sécurité', hint: 'Mot de passe, compte',
      icon: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    },
  ];

  readonly orgTypes: { value: OrgType; label: string }[] = [
    { value: 'association', label: 'Association' },
    { value: 'company', label: 'Entreprise' },
    { value: 'institution', label: 'Université / Institution' },
    { value: 'community', label: 'Communauté / Collectif' },
    { value: 'independent', label: 'Organisateur indépendant' },
  ];

  readonly countries = [
    'Sénégal', "Côte d'Ivoire", 'Mali', 'Mauritanie', 'Guinée', 'Burkina Faso', 'Maroc', 'France', 'Autre',
  ];

  readonly socials = [
    { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/votre-page' },
    { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/votre-organisation' },
    { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/votre-compte' },
  ] as const;

  readonly pwFields = [
    { key: 'current', label: 'Mot de passe actuel', id: 'pf-pw-current', autocomplete: 'current-password' },
    { key: 'next', label: 'Nouveau mot de passe', id: 'pf-pw-next', autocomplete: 'new-password' },
    { key: 'confirm', label: 'Confirmer le nouveau mot de passe', id: 'pf-pw-confirm', autocomplete: 'new-password' },
  ] as const;

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  readonly loadState = signal<LoadState>('loading');
  readonly data = signal<ProfileData | null>(null);
  readonly section = signal<SectionKey>('infos');
  readonly saving = signal<Busy | null>(null);
  readonly modal = signal<ModalKind | null>(null);
  readonly toast = signal<Toast | null>(null);
  readonly pendingEmail = signal<string | null>(null);
  readonly deleteConfirm = signal('');

  readonly avatar = signal<ImageState | null>(null);
  readonly logo = signal<ImageState | null>(null);
  readonly imageError = signal<Record<ImageKind, string | null>>({ avatar: null, logo: null });
  private readonly files: Record<ImageKind, File | null> = { avatar: null, logo: null };

  readonly showPw = signal<Record<PwKey, boolean>>({ current: false, next: false, confirm: false });

  private readonly baseInfos = signal<string | null>(null);
  private readonly baseOrg = signal<string | null>(null);
  private skipGuard = false;
  private lastFocus: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  /* ------------------------------------------------------------------
     FORMULAIRES
     ------------------------------------------------------------------ */
  readonly profileForm = this.fb.group({
    firstName: ['', [Validators.required, Validators.maxLength(50)]],
    lastName: ['', [Validators.required, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(120)]],
    phone: ['', [phoneValidator]],
    city: ['', Validators.maxLength(60)],
    country: [''],
    bio: ['', Validators.maxLength(300)],
  });

  readonly orgForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    type: ['' as OrgType | '', Validators.required],
    website: ['', optionalUrl],
    description: ['', Validators.maxLength(500)],
    facebook: ['', optionalUrl],
    linkedin: ['', optionalUrl],
    instagram: ['', optionalUrl],
  });

  readonly passwordForm = this.fb.group(
    {
      current: ['', Validators.required],
      next: ['', [Validators.required, strongPassword]],
      confirm: ['', Validators.required],
    },
    { validators: passwordGroup },
  );

  /* ------------------------------------------------------------------
     DONNÉES DÉRIVÉES
     ------------------------------------------------------------------ */
  private readonly tick = toSignal(merge(this.profileForm.valueChanges, this.orgForm.valueChanges), {
    initialValue: null,
  });

  readonly infosChanged = computed(() => {
    this.tick();
    const base = this.baseInfos();
    return base !== null && this.infosSnapshot() !== base;
  });

  readonly orgChanged = computed(() => {
    this.tick();
    const base = this.baseOrg();
    return base !== null && this.orgSnapshot() !== base;
  });

  readonly hasUnsavedChanges = computed(() => this.infosChanged() || this.orgChanged());

  readonly identity = computed(() => {
    const d = this.data();
    if (!d) return null;
    return {
      name: `${d.firstName} ${d.lastName}`.trim(),
      email: d.email,
      org: d.org.name,
      avatar: d.avatarUrl,
      initials: `${d.firstName.charAt(0)}${d.lastName.charAt(0)}`.toUpperCase() || '?',
      since: dateLong.format(new Date(d.memberSince)),
    };
  });

  readonly participant = computed(() => this.data()?.participant ?? null);
  readonly canLeaveParticipant = computed(() => (this.participant()?.upcoming ?? 0) === 0);
  readonly deleteBlockers = computed(() => this.data()?.upcomingEventsWithRegistrations ?? 0);
  readonly deleteReady = computed(() => normalize(this.deleteConfirm().trim()) === 'supprimer');

  readonly passwordChanged = computed(() => {
    const iso = this.data()?.passwordChangedAt;
    return iso ? `Dernière modification le ${dateLong.format(new Date(iso))}` : 'Jamais modifié';
  });

  private readonly nextValue = toSignal(this.passwordForm.controls.next.valueChanges, { initialValue: '' });

  readonly rules = computed(() => {
    const v = this.nextValue();
    return [
      { label: '8 caractères minimum', ok: v.length >= 8 },
      { label: 'Une minuscule', ok: /[a-z]/.test(v) },
      { label: 'Une majuscule', ok: /[A-Z]/.test(v) },
      { label: 'Un chiffre', ok: /\d/.test(v) },
    ];
  });

  readonly strength = computed(() => {
    const v = this.nextValue();
    if (!v) return { level: 0, label: '' };
    const passed = this.rules().filter((r) => r.ok).length;
    if (passed <= 1) return { level: 1, label: 'Faible' };
    if (passed < 4) return { level: 2, label: 'Moyen' };
    return v.length >= 12 ? { level: 4, label: 'Excellent' } : { level: 3, label: 'Bon' };
  });

  constructor() {
    // La section affichée vient de l'URL : /organisateur/profil?section=comptes
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('section');
      this.section.set(this.sections.some((s) => s.key === requested) ? (requested as SectionKey) : 'infos');
    });

    // Bloque le scroll de la page quand une fenêtre est ouverte
    effect(() => {
      this.document.body.style.overflow = this.modal() !== null ? 'hidden' : '';
    });

    inject(DestroyRef).onDestroy(() => {
      this.document.body.style.overflow = '';
      this.releaseImage('avatar');
      this.releaseImage('logo');
      if (this.toastTimer) clearTimeout(this.toastTimer);
    });

    void this.load();
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  async load(): Promise<void> {
    this.loadState.set('loading');
    try {
      this.apply(await fetchProfile()); // TODO : service
      this.loadState.set('ready');
    } catch {
      this.loadState.set('error');
    }
  }

  private apply(d: ProfileData): void {
    this.data.set(d);
    this.pendingEmail.set(null);

    this.releaseImage('avatar');
    this.releaseImage('logo');
    this.files.avatar = null;
    this.files.logo = null;
    this.avatar.set(d.avatarUrl ? { url: d.avatarUrl, name: 'Photo actuelle', local: false } : null);
    this.logo.set(d.org.logoUrl ? { url: d.org.logoUrl, name: 'Logo actuel', local: false } : null);

    this.fillInfos(d);
    this.fillOrg(d);
    this.baseInfos.set(this.infosSnapshot());
    this.baseOrg.set(this.orgSnapshot());
  }

  private fillInfos(d: ProfileData): void {
    this.profileForm.reset({
      firstName: d.firstName, lastName: d.lastName, email: d.email,
      phone: d.phone, city: d.city, country: d.country, bio: d.bio,
    });
  }

  private fillOrg(d: ProfileData): void {
    this.orgForm.reset({
      name: d.org.name, type: d.org.type, website: d.org.website, description: d.org.description,
      facebook: d.org.facebook, linkedin: d.org.linkedin, instagram: d.org.instagram,
    });
  }

  private infosSnapshot(): string {
    return `${JSON.stringify(this.profileForm.getRawValue())}|${this.avatar()?.url ?? ''}`;
  }

  private orgSnapshot(): string {
    return `${JSON.stringify(this.orgForm.getRawValue())}|${this.logo()?.url ?? ''}`;
  }

  /* ------------------------------------------------------------------
     NAVIGATION ENTRE SECTIONS
     ------------------------------------------------------------------ */
  setSection(key: SectionKey): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section: key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  sectionDirty(key: SectionKey): boolean {
    return (key === 'infos' && this.infosChanged()) || (key === 'organisation' && this.orgChanged());
  }

  /* ------------------------------------------------------------------
     IMAGES (photo de profil, logo)
     ------------------------------------------------------------------ */
  image(kind: ImageKind): ImageState | null {
    return kind === 'avatar' ? this.avatar() : this.logo();
  }

  onImageInput(kind: ImageKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.setImage(kind, file);
    input.value = '';
  }

  private setImage(kind: ImageKind, file: File): void {
    if (!IMAGE_TYPES.includes(file.type)) {
      this.imageError.update((e) => ({ ...e, [kind]: 'Format non supporté. Utilisez JPG, PNG ou WEBP.' }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.imageError.update((e) => ({ ...e, [kind]: "L'image dépasse 2 Mo." }));
      return;
    }
    this.releaseImage(kind);
    this.files[kind] = file;
    const state: ImageState = { url: URL.createObjectURL(file), name: file.name, local: true };
    if (kind === 'avatar') this.avatar.set(state);
    else this.logo.set(state);
    this.imageError.update((e) => ({ ...e, [kind]: null }));
  }

  removeImage(kind: ImageKind): void {
    this.releaseImage(kind);
    this.files[kind] = null;
    if (kind === 'avatar') this.avatar.set(null);
    else this.logo.set(null);
    this.imageError.update((e) => ({ ...e, [kind]: null }));
  }

  imageErrorOf(kind: ImageKind): string | null {
    return this.imageError()[kind];
  }

  private releaseImage(kind: ImageKind): void {
    const current = this.image(kind);
    if (current?.local) URL.revokeObjectURL(current.url);
  }

  /* ------------------------------------------------------------------
     ENREGISTREMENT : INFORMATIONS PERSONNELLES
     ------------------------------------------------------------------ */
  cancelInfos(): void {
    const d = this.data();
    if (!d) return;
    this.removeLocalImage('avatar', d.avatarUrl);
    this.fillInfos(d);
    this.baseInfos.set(this.infosSnapshot());
  }

  async saveInfos(): Promise<void> {
    const current = this.data();
    if (!current) return;
    this.profileForm.markAllAsTouched();
    if (this.profileForm.invalid) {
      this.focusFirstInvalid();
      return;
    }

    const v = this.profileForm.getRawValue();
    const email = v.email.trim().toLowerCase();
    const emailChanged = email !== current.email.toLowerCase();

    this.saving.set('infos');
    try {
      // TODO : await firstValueFrom(this.api.updateProfile({ ...v, avatar: this.files.avatar }));
      await delay(600);
      const updated: ProfileData = {
        ...current,
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        phone: v.phone.trim(),
        city: v.city.trim(),
        country: v.country,
        bio: v.bio.trim(),
        avatarUrl: this.avatar()?.url ?? null,
      };
      this.data.set(updated);
      // L'ancienne adresse reste active tant que la nouvelle n'est pas confirmée
      if (emailChanged) this.pendingEmail.set(email);
      this.fillInfos(updated);
      this.baseInfos.set(this.infosSnapshot());
      this.showToast(
        'success',
        emailChanged
          ? `Profil mis à jour. Confirmez ${email} grâce à l'e-mail que nous venons d'envoyer.`
          : 'Profil mis à jour.',
      );
    } catch {
      this.showToast('error', "L'enregistrement a échoué. Veuillez réessayer.");
    } finally {
      this.saving.set(null);
    }
  }

  resendEmail(): void {
    // TODO : appeler l'API de renvoi de l'e-mail de confirmation
    this.showToast('success', `E-mail de confirmation renvoyé à ${this.pendingEmail()}.`);
  }

  cancelPendingEmail(): void {
    this.pendingEmail.set(null);
  }

  /* ------------------------------------------------------------------
     ENREGISTREMENT : ORGANISATION
     ------------------------------------------------------------------ */
  cancelOrg(): void {
    const d = this.data();
    if (!d) return;
    this.removeLocalImage('logo', d.org.logoUrl);
    this.fillOrg(d);
    this.baseOrg.set(this.orgSnapshot());
  }

  async saveOrg(): Promise<void> {
    const current = this.data();
    if (!current) return;
    this.orgForm.markAllAsTouched();
    if (this.orgForm.invalid) {
      this.focusFirstInvalid();
      return;
    }

    const v = this.orgForm.getRawValue();
    this.saving.set('org');
    try {
      // TODO : await firstValueFrom(this.api.updateOrganisation({ ...v, logo: this.files.logo }));
      await delay(600);
      const updated: ProfileData = {
        ...current,
        org: {
          name: v.name.trim(),
          type: v.type as OrgType,
          website: v.website.trim(),
          description: v.description.trim(),
          logoUrl: this.logo()?.url ?? null,
          facebook: v.facebook.trim(),
          linkedin: v.linkedin.trim(),
          instagram: v.instagram.trim(),
        },
      };
      this.data.set(updated);
      this.fillOrg(updated);
      this.baseOrg.set(this.orgSnapshot());
      this.showToast('success', "Informations de l'organisation mises à jour.");
    } catch {
      this.showToast('error', "L'enregistrement a échoué. Veuillez réessayer.");
    } finally {
      this.saving.set(null);
    }
  }

  /** Annule un aperçu local et revient à l'image enregistrée */
  private removeLocalImage(kind: ImageKind, savedUrl: string | null): void {
    this.releaseImage(kind);
    this.files[kind] = null;
    const state = savedUrl ? { url: savedUrl, name: 'Image actuelle', local: false } : null;
    if (kind === 'avatar') this.avatar.set(state);
    else this.logo.set(state);
    this.imageError.update((e) => ({ ...e, [kind]: null }));
  }

  /* ------------------------------------------------------------------
     COMPTE PARTICIPANT
     ------------------------------------------------------------------ */
  async activateParticipant(): Promise<void> {
    const current = this.data();
    if (!current || current.participant) return;
    this.saving.set('participant');
    try {
      // TODO : await firstValueFrom(this.api.activateParticipantAccount());
      await delay(600);
      this.data.set({
        ...current,
        participant: { since: new Date().toISOString(), registrations: 0, upcoming: 0, tickets: 0 },
      });
      this.showToast('success', 'Compte participant activé. Vous pouvez dès maintenant vous inscrire à des événements.');
    } catch {
      this.showToast('error', "L'activation a échoué. Veuillez réessayer.");
    } finally {
      this.saving.set(null);
    }
  }

  async confirmDeactivate(): Promise<void> {
    const current = this.data();
    if (!current || !this.canLeaveParticipant()) return;
    this.saving.set('participant');
    try {
      // TODO : await firstValueFrom(this.api.deactivateParticipantAccount());
      await delay(500);
      this.data.set({ ...current, participant: null });
      this.saving.set(null);
      this.closeModal();
      this.showToast('success', 'Compte participant désactivé.');
    } catch {
      this.saving.set(null);
      this.showToast('error', 'La désactivation a échoué. Veuillez réessayer.');
    }
  }

  /* ------------------------------------------------------------------
     SÉCURITÉ : MOT DE PASSE
     ------------------------------------------------------------------ */
  togglePw(key: PwKey): void {
    this.showPw.update((state) => ({ ...state, [key]: !state[key] }));
  }

  pwError(key: PwKey): string {
    const control = this.passwordForm.controls[key];
    if (!(control.touched || control.dirty)) return '';
    const group = this.passwordForm.errors;

    if (key === 'current') {
      if (control.hasError('required')) return 'Saisissez votre mot de passe actuel.';
      if (control.hasError('wrong')) return 'Mot de passe actuel incorrect.';
    } else if (key === 'next') {
      if (control.hasError('required')) return 'Choisissez un nouveau mot de passe.';
      if (control.hasError('weak')) return 'Le mot de passe ne respecte pas toutes les règles.';
      if (group?.['sameAsCurrent']) return "Le nouveau mot de passe doit être différent de l'actuel.";
    } else {
      if (control.hasError('required')) return 'Confirmez le nouveau mot de passe.';
      if (group?.['mismatch']) return 'Les mots de passe ne correspondent pas.';
    }
    return '';
  }

  async savePassword(): Promise<void> {
    const current = this.data();
    if (!current) return;
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid) {
      this.focusFirstInvalid();
      return;
    }

    this.saving.set('password');
    try {
      // TODO : await firstValueFrom(this.api.changePassword(current, next));
      //        en cas de 401, afficher l'erreur sur le champ :
      //        this.passwordForm.controls.current.setErrors({ wrong: true });
      await delay(700);
      this.data.set({ ...current, passwordChangedAt: new Date().toISOString() });
      this.passwordForm.reset();
      this.showPw.set({ current: false, next: false, confirm: false });
      this.showToast('success', 'Mot de passe modifié. Il s\'applique aussi à votre espace participant.');
    } catch {
      this.showToast('error', 'Le changement de mot de passe a échoué. Veuillez réessayer.');
    } finally {
      this.saving.set(null);
    }
  }

  /* ------------------------------------------------------------------
     SUPPRESSION DU COMPTE
     ------------------------------------------------------------------ */
  async confirmDelete(): Promise<void> {
    if (!this.deleteReady() || this.deleteBlockers() > 0) return;
    this.saving.set('delete');
    try {
      // TODO : await firstValueFrom(this.api.deleteAccount()); puis déconnexion
      await delay(800);
      this.skipGuard = true;
      await this.router.navigate(['/login']);
    } catch {
      this.showToast('error', 'La suppression a échoué. Veuillez réessayer.');
    } finally {
      this.saving.set(null);
      this.modal.set(null);
    }
  }

  /* ------------------------------------------------------------------
     FENÊTRES
     ------------------------------------------------------------------ */
  openModal(kind: ModalKind): void {
    if (kind === 'deactivate' && !this.canLeaveParticipant()) return;
    if (kind === 'delete' && this.deleteBlockers() > 0) return;
    this.lastFocus = this.document.activeElement as HTMLElement | null;
    this.deleteConfirm.set('');
    this.modal.set(kind);
    setTimeout(() => {
      this.host.nativeElement.querySelector<HTMLElement>('.modal input, .modal .btn')?.focus();
    }, 30);
  }

  closeModal(): void {
    if (this.saving() === 'participant' || this.saving() === 'delete') return;
    this.modal.set(null);
    setTimeout(() => {
      this.lastFocus?.focus?.();
      this.lastFocus = null;
    });
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
    if (e['email']) return 'Entrez une adresse e-mail valide.';
    if (e['phone']) return 'Numéro invalide (8 à 15 chiffres).';
    if (e['url']) return 'Entrez une adresse valide (https://...).';
    if (e['minlength']) return `Minimum ${e['minlength'].requiredLength} caractères.`;
    if (e['maxlength']) return `Maximum ${e['maxlength'].requiredLength} caractères.`;
    return 'Valeur invalide.';
  }

  private focusFirstInvalid(): void {
    setTimeout(() => {
      this.host.nativeElement
        .querySelector<HTMLElement>(
          '.panel:not([hidden]) :is(input, select, textarea).input--error, ' +
            '.panel:not([hidden]) :is(input, select, textarea).ng-invalid',
        )
        ?.focus();
    }, 50);
  }

  /* ------------------------------------------------------------------
     DIVERS
     ------------------------------------------------------------------ */
  formatDate(iso: string): string {
    return dateLong.format(new Date(iso));
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
      !this.hasUnsavedChanges() ||
      window.confirm('Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter cette page ?')
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges() && !this.skipGuard) event.preventDefault();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modal()) this.closeModal();
  }
}
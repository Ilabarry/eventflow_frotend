import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidatorFn, Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ProfileApiService } from '../../../core/services/profile-api.service';
import { User } from '../../../core/models/user.model';
import { ChangePasswordPayload } from '../../../core/models/auth.model';
import { NgTemplateOutlet } from '@angular/common';

type SectionKey = 'infos' | 'securite';
type LoadState = 'loading' | 'ready' | 'error';
type ImageKind = 'avatar';
type PwKey = 'current' | 'next' | 'confirm';
type Busy = 'infos' | 'password';

interface ImageState {
  url: string;
  name: string;
  local: boolean;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const dateLong = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });

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
  private readonly authService = inject(AuthService);
  private readonly profileApi = inject(ProfileApiService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  /* ------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------ */
  readonly sections: { key: SectionKey; label: string; hint: string; icon: string[] }[] = [
    {
      key: 'infos', label: 'Informations personnelles', hint: 'Nom, téléphone, photo',
      icon: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    },
    {
      key: 'securite', label: 'Sécurité', hint: 'Mot de passe',
      icon: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    },
  ];

  readonly pwFields = [
    { key: 'current', label: 'Mot de passe actuel', id: 'pf-pw-current', autocomplete: 'current-password' },
    { key: 'next', label: 'Nouveau mot de passe', id: 'pf-pw-next', autocomplete: 'new-password' },
    { key: 'confirm', label: 'Confirmer le nouveau mot de passe', id: 'pf-pw-confirm', autocomplete: 'new-password' },
  ] as const;

  /* ------------------------------------------------------------------
     ÉTAT
     ------------------------------------------------------------------ */
  readonly loadState = signal<LoadState>('loading');
  readonly user = signal<User | null>(null);
  readonly section = signal<SectionKey>('infos');
  readonly saving = signal<Busy | null>(null);

  readonly avatar = signal<ImageState | null>(null);
  readonly imageError = signal<string | null>(null);
  private avatarFile: File | null = null;

  readonly showPw = signal<Record<PwKey, boolean>>({ current: false, next: false, confirm: false });

  private readonly baseInfos = signal<string | null>(null);

  /* ------------------------------------------------------------------
     FORMULAIRES
     ------------------------------------------------------------------ */
  readonly profileForm = this.fb.group({
    firstName: ['', [Validators.required, Validators.maxLength(150)]],
    lastName: ['', [Validators.required, Validators.maxLength(150)]],
    phone: ['', [Validators.required, phoneValidator]],
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
  private readonly tick = toSignal(this.profileForm.valueChanges, { initialValue: null });

  readonly infosChanged = computed(() => {
    this.tick();
    const base = this.baseInfos();
    return base !== null && this.infosSnapshot() !== base;
  });

  readonly hasUnsavedChanges = computed(() => this.infosChanged());

  readonly identity = computed(() => {
    const u = this.user();
    if (!u) return null;
    return {
      name: u.full_name,
      email: u.email,
      initials: `${u.first_name.charAt(0)}${u.last_name.charAt(0)}`.toUpperCase() || '?',
      since: dateLong.format(new Date(u.created_at)),
      roles: u.roles,
      isOrganizer: u.roles.includes('organisateur'),
      isParticipant: u.roles.includes('participant'),
      isAdmin: u.roles.includes('administrateur'),
    };
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
    // Section depuis l'URL
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const requested = params.get('section') as SectionKey | null;
      this.section.set(
        requested && this.sections.some((s) => s.key === requested) ? requested : 'infos',
      );
    });

    this.destroyRef.onDestroy(() => this.releaseAvatar());

    void this.load();
  }

  /* ------------------------------------------------------------------
     CHARGEMENT
     ------------------------------------------------------------------ */
  async load(): Promise<void> {
    this.loadState.set('loading');
    console.info('[Profile] Chargement du profil...');

    try {
      const res = await firstValueFrom(this.profileApi.getMe());
      const u = res.data;
      if (!u) {
        this.loadState.set('error');
        return;
      }
      this.apply(u);
      this.loadState.set('ready');
      console.info(`[Profile] Profil chargé : ${u.email}`);
    } catch (err) {
      console.error('[Profile] Échec chargement', err);
      this.loadState.set('error');
      this.notification.httpError(err);
    }
  }

  private apply(u: User): void {
    this.user.set(u);
    this.releaseAvatar();
    this.avatarFile = null;
    this.avatar.set(
      u.profile_picture
        ? { url: u.profile_picture, name: 'Photo actuelle', local: false }
        : null,
    );
    this.imageError.set(null);

    this.profileForm.reset({
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
    });

    this.baseInfos.set(this.infosSnapshot());
  }

  private infosSnapshot(): string {
    return `${JSON.stringify(this.profileForm.getRawValue())}|${this.avatar()?.url ?? ''}`;
  }

  /* ------------------------------------------------------------------
     NAVIGATION
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
    return key === 'infos' && this.infosChanged();
  }

  /* ------------------------------------------------------------------
     IMAGE
     ------------------------------------------------------------------ */
  onImageInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.setAvatar(file);
    input.value = '';
  }

  private setAvatar(file: File): void {
    if (!IMAGE_TYPES.includes(file.type)) {
      this.imageError.set('Format non supporté. Utilisez JPG, PNG ou WEBP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.imageError.set("L'image dépasse 2 Mo.");
      return;
    }
    this.releaseAvatar();
    this.avatarFile = file;
    this.avatar.set({ url: URL.createObjectURL(file), name: file.name, local: true });
    this.imageError.set(null);
    this.profileForm.markAsDirty();
  }

  removeImage(): void {
    this.releaseAvatar();
    this.avatarFile = null;
    this.avatar.set(null);
    this.imageError.set(null);
    this.profileForm.markAsDirty();
  }

  private releaseAvatar(): void {
    const current = this.avatar();
    if (current?.local) URL.revokeObjectURL(current.url);
  }

  /* ------------------------------------------------------------------
     ENREGISTREMENT PROFIL
     ------------------------------------------------------------------ */
  cancelInfos(): void {
    const u = this.user();
    if (!u) return;
    this.releaseAvatar();
    this.avatarFile = null;
    this.avatar.set(u.profile_picture ? { url: u.profile_picture, name: 'Photo actuelle', local: false } : null);
    this.profileForm.reset({
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
    });
    this.baseInfos.set(this.infosSnapshot());
  }

  async saveInfos(): Promise<void> {
    this.profileForm.markAllAsTouched();
    if (this.profileForm.invalid) {
      this.focusFirstInvalid();
      return;
    }

    const v = this.profileForm.getRawValue();
    this.saving.set('infos');
    console.info('[Profile] Enregistrement du profil...');

    try {
      const res = await firstValueFrom(
        this.profileApi.updateProfile({
          first_name: v.firstName.trim(),
          last_name: v.lastName.trim(),
          phone: v.phone.trim(),
          profile_picture: this.avatarFile,
        }),
      );

      const updated = res.data;
      if (!updated) throw new Error('Réponse vide.');

      // Met à jour l'utilisateur côté AuthService (navbar, etc.)
      this.apply(updated);
      // Synchroniser le signal currentUser du AuthService
      // (impossible directement, on utilise loadCurrentUser pour rafraîchir)
      this.authService.loadCurrentUser();

      this.notification.success('Profil mis à jour.', 'Succès');
      console.info('[Profile] Profil enregistré');
    } catch (err: any) {
      console.error('[Profile] Échec enregistrement', err);
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

  private applyServerErrors(errors: Record<string, string[] | string>): void {
    const map: Record<string, AbstractControl | null> = {
      first_name: this.profileForm.controls.firstName,
      last_name: this.profileForm.controls.lastName,
      phone: this.profileForm.controls.phone,
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
     MOT DE PASSE
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
      if (control.hasError('server')) return String(control.errors?.['server']);
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
    this.passwordForm.markAllAsTouched();
    if (this.passwordForm.invalid) {
      this.focusFirstInvalid();
      return;
    }

    const v = this.passwordForm.getRawValue();
    const payload: ChangePasswordPayload = {
      old_password: v.current,
      new_password: v.next,
      new_password_confirm: v.confirm,
    };

    this.saving.set('password');
    console.info('[Profile] Changement de mot de passe...');

    try {
      await firstValueFrom(this.profileApi.changePassword(payload));
      this.passwordForm.reset();
      this.showPw.set({ current: false, next: false, confirm: false });
      this.notification.success(
        'Mot de passe modifié. Il s\'applique aussi à votre espace participant.',
        'Sécurité',
      );
      console.info('[Profile] Mot de passe changé');
    } catch (err: any) {
      console.error('[Profile] Échec changement mot de passe', err);

      if (err?.error?.errors) {
        const serverErrors = err.error.errors;
        if (serverErrors['old_password']) {
          this.passwordForm.controls.current.setErrors({
            server: serverErrors['old_password'].join(' '),
          });
          this.passwordForm.controls.current.markAsTouched();
        }
        if (serverErrors['new_password']) {
          this.passwordForm.controls.next.setErrors({
            server: serverErrors['new_password'].join(' '),
          });
          this.passwordForm.controls.next.markAsTouched();
        }
        if (serverErrors['new_password_confirm']) {
          this.passwordForm.controls.confirm.setErrors({
            server: serverErrors['new_password_confirm'].join(' '),
          });
          this.passwordForm.controls.confirm.markAsTouched();
        }
      } else {
        this.notification.httpError(err);
      }
    } finally {
      this.saving.set(null);
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
    if (e['phone']) return 'Numéro invalide (8 à 15 chiffres).';
    if (e['maxlength']) return `Maximum ${e['maxlength'].requiredLength} caractères.`;
    if (e['server']) return String(e['server']);
    return 'Valeur invalide.';
  }

  private focusFirstInvalid(): void {
    setTimeout(() => {
      this.host.nativeElement
        .querySelector<HTMLElement>(
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

  canDeactivate(): boolean {
    return (
      !this.hasUnsavedChanges() ||
      window.confirm(
        'Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter cette page ?',
      )
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }
}
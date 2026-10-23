import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiErrors } from '../../../core/models/api-response.model';
import { Role, User } from '../../../core/models/user.model';
import { NotificationService } from '../../../core/services/notification.service';

/* ------------------------------------------------------------------
 * Règles reprises du backend (apps/accounts)
 * ------------------------------------------------------------------ */
const NAME_MAX_LENGTH = 150; // constants.NAME_MAX_LENGTH
/** validators.PHONE_REGEX : 8 à 15 chiffres, « + » facultatif, sans espace. */
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const PASSWORD_MIN_LENGTH = 8; // validate_password_strength

const ROLE_LABELS: Record<string, string> = {
  [Role.PARTICIPANT]: 'Participant',
  [Role.ORGANISATEUR]: 'Organisateur',
  [Role.ADMINISTRATEUR]: 'Administrateur',
};

/** Retire espaces, points et tirets que l'utilisateur tape souvent. */
function normalizePhone(value: string): string {
  return value.replace(/[\s.-]/g, '');
}

function phoneValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = normalizePhone(control.value ?? '');
  return value === '' || PHONE_PATTERN.test(value) ? null : { phone: true };
}

/** Même politique que le backend : minuscule, majuscule et chiffre. */
function passwordStrengthValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value ?? '';
  if (value === '') {
    return null;
  }
  const strong = /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
  return strong ? null : { strength: true };
}

function passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
  const { new_password, new_password_confirm } = group.value as Record<string, string>;
  return new_password_confirm && new_password !== new_password_confirm ? { mismatch: true } : null;
}

/** Premier message d'erreur renvoyé par le backend pour chaque champ. */
function serverErrorsOf(error: unknown): Record<string, string> {
  const errors: ApiErrors | undefined = error instanceof HttpErrorResponse ? error.error?.errors : undefined;
  const result: Record<string, string> = {};
  for (const [field, value] of Object.entries(errors ?? {})) {
    result[field] = Array.isArray(value) ? value[0] : value;
  }
  return result;
}

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-profil',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './profil.component.html',
  styleUrl: './profil.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParticipantProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private readonly passwordDialog = viewChild.required<ElementRef<HTMLDialogElement>>('passwordDialog');

  readonly user = this.authService.currentUser;
  readonly nameMaxLength = NAME_MAX_LENGTH;
  readonly passwordMinLength = PASSWORD_MIN_LENGTH;

  readonly initials = computed(() => {
    const user = this.user();
    return user ? `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase() : '';
  });
  readonly roleLabel = computed(() =>
    (this.user()?.roles ?? []).map((role) => ROLE_LABELS[role] ?? role).join(', '),
  );

  roleLabelFor(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  // --- Formulaire « Informations personnelles » ---------------------------
  readonly profileForm = this.formBuilder.group({
    first_name: ['', [Validators.required, Validators.maxLength(NAME_MAX_LENGTH)]],
    last_name: ['', [Validators.required, Validators.maxLength(NAME_MAX_LENGTH)]],
    phone: ['', [Validators.required, phoneValidator]],
  });
  readonly savingProfile = signal(false);
  readonly profileServerErrors = signal<Record<string, string>>({});

  // --- Formulaire « Mot de passe » -----------------------------------------
  readonly passwordForm = this.formBuilder.group(
    {
      old_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), passwordStrengthValidator]],
      new_password_confirm: ['', Validators.required],
    },
    { validators: passwordsMatchValidator },
  );
  readonly savingPassword = signal(false);
  readonly passwordServerErrors = signal<Record<string, string>>({});

  constructor() {
    // Remplit le formulaire dès que le profil est disponible (il peut arriver
    // après l'affichage de la page, par exemple après un F5), sans écraser
    // une saisie en cours.
    effect(() => {
      const user = this.user();
      untracked(() => {
        if (user && !this.profileForm.dirty) {
          this.fillProfileForm(user);
        }
      });
    });
  }

  /** Message d'erreur d'un champ : d'abord le backend, sinon la validation locale. */
  profileError(field: 'first_name' | 'last_name' | 'phone'): string | null {
    const server = this.profileServerErrors()[field];
    if (server) {
      return server;
    }
    const control = this.profileForm.controls[field];
    if (!control.touched || !control.errors) {
      return null;
    }
    if (control.errors['required']) {
      return 'Ce champ est obligatoire.';
    }
    if (control.errors['maxlength']) {
      return `${NAME_MAX_LENGTH} caractères maximum.`;
    }
    return 'Format international attendu, par exemple +22997000000 (8 à 15 chiffres).';
  }

  passwordError(field: 'old_password' | 'new_password' | 'new_password_confirm'): string | null {
    const server = this.passwordServerErrors()[field];
    if (server) {
      return server;
    }
    const control = this.passwordForm.controls[field];
    if (!control.touched) {
      return null;
    }
    if (control.errors?.['required']) {
      return 'Ce champ est obligatoire.';
    }
    if (control.errors?.['minlength'] || control.errors?.['strength']) {
      return `Au moins ${PASSWORD_MIN_LENGTH} caractères, avec une minuscule, une majuscule et un chiffre.`;
    }
    if (field === 'new_password_confirm' && this.passwordForm.errors?.['mismatch']) {
      return 'Les deux mots de passe ne correspondent pas.';
    }
    return null;
  }

  /* --- Informations personnelles --------------------------------------- */
  clearProfileServerError(field: string): void {
    if (this.profileServerErrors()[field]) {
      this.profileServerErrors.update(({ [field]: _removed, ...rest }) => rest);
    }
  }

  saveProfile(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    if (this.savingProfile()) {
      return; // évite un double envoi
    }

    const value = this.profileForm.getRawValue();
    this.savingProfile.set(true);
    this.profileServerErrors.set({});

    this.authService
      .updateProfile({
        first_name: value.first_name.trim(),
        last_name: value.last_name.trim(),
        phone: normalizePhone(value.phone),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.savingProfile.set(false);
          if (response.data) {
            this.fillProfileForm(response.data);
          }
          this.profileForm.markAsPristine();
          // Recharge l'utilisateur courant pour mettre à jour la barre du haut.
          this.authService.loadCurrentUser();
          this.notification.success('Vos informations ont été enregistrées.', 'Profil mis à jour');
        },
        error: (error: unknown) => {
          this.savingProfile.set(false);
          this.profileServerErrors.set(serverErrorsOf(error));
        },
      });
  }

  cancelProfile(): void {
    const user = this.user();
    if (user) {
      this.fillProfileForm(user);
    }
    this.profileServerErrors.set({});
  }

  /* --- Mot de passe ------------------------------------------------------ */
  openPasswordDialog(): void {
    this.passwordForm.reset();
    this.passwordServerErrors.set({});
    this.passwordDialog().nativeElement.showModal();
  }

  closePasswordDialog(): void {
    this.passwordDialog().nativeElement.close();
  }

  onDialogClick(event: MouseEvent): void {
    if (event.target === this.passwordDialog().nativeElement && !this.savingPassword()) {
      this.closePasswordDialog();
    }
  }

  clearPasswordServerError(field: string): void {
    if (this.passwordServerErrors()[field]) {
      this.passwordServerErrors.update(({ [field]: _removed, ...rest }) => rest);
    }
  }

  savePassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    if (this.savingPassword()) {
      return;
    }

    this.savingPassword.set(true);
    this.passwordServerErrors.set({});

    this.authService
      .changePassword(this.passwordForm.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingPassword.set(false);
          this.passwordForm.reset(); // ne garde aucun mot de passe en mémoire
          this.closePasswordDialog();
          this.notification.success('Reconnectez-vous avec votre nouveau mot de passe.', 'Mot de passe modifié');
          // Le backend demande une reconnexion : on ferme la session.
          this.authService.logout();
        },
        error: (error: unknown) => {
          this.savingPassword.set(false);
          this.passwordServerErrors.set(serverErrorsOf(error));
        },
      });
  }

  private fillProfileForm(user: User): void {
    this.profileForm.reset({
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
    });
  }
}

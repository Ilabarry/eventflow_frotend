import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RegisterPayload } from '../../../core/models/auth.model';

/**
 * Page d'inscription.
 *
 * Gère :
 *   - Validation côté client (Validators Angular)
 *   - Choix du rôle (participant / organisateur)
 *   - Envoi HTTP au backend (AuthService.register)
 *   - Mapping des erreurs backend → champs du formulaire
 *   - Redirection vers /login après succès
 *
 * ⚠️ SÉCURITÉ :
 *   - Les validations Angular sont UX, pas sécurité.
 *   - Le backend valide TOUTES les données (RegisterSerializer).
 *   - Aucune donnée sensible n'est loggée.
 */
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly selectedRole = signal<'participant' | 'organisateur'>('participant');
  readonly success = signal(false);
  readonly registeredEmail = signal<string>('');

  readonly registerForm: FormGroup = this.fb.group(
    {
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.pattern(/^\+?[0-9]{8,15}$/)]],
      email: ['', [Validators.required, Validators.email]],
      password: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/),
        ],
      ],
      passwordConfirm: ['', [Validators.required]],
    },
    { validators: this.passwordsMatchValidator }
  );

  private passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
    const password = group.get('password')?.value;
    const confirm = group.get('passwordConfirm')?.value;
    if (password && confirm && password !== confirm) {
      return { passwordsMismatch: true };
    }
    return null;
  }

  selectRole(role: 'participant' | 'organisateur'): void {
    this.selectedRole.set(role);
  }

  onSubmit(): void {
    if (this.registerForm.invalid || this.isSubmitting()) {
      this.registerForm.markAllAsTouched();
      this.notification.warning(
        'Veuillez corriger les erreurs du formulaire.',
        'Formulaire invalide'
      );
      return;
    }

    this.isSubmitting.set(true);

    const formValue = this.registerForm.value;
    const payload: RegisterPayload = {
      first_name: formValue.firstName.trim(),
      last_name: formValue.lastName.trim(),
      email: formValue.email.trim().toLowerCase(),
      phone: formValue.phone.trim(),
      password: formValue.password,
      password_confirm: formValue.passwordConfirm,
      role: this.selectedRole(),
    };

    this.authService.register(payload).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        // ✅ Afficher l'écran de succès au lieu de rediriger
        this.registeredEmail.set(payload.email);
        this.success.set(true);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.handleBackendErrors(err);
      },
    });
  }

  /**
   * Mappe les erreurs backend (RegisterSerializer) vers les champs du formulaire.
   *
   * Format attendu :
   *   { "errors": { "email": ["Un compte... existe déjà."], ... } }
   */
  private handleBackendErrors(error: any): void {
    const errors = error?.error?.errors;
    if (!errors) return;

    const fieldMap: Record<string, string> = {
      first_name: 'firstName',
      last_name: 'lastName',
      phone: 'phone',
      email: 'email',
      password: 'password',
      password_confirm: 'passwordConfirm',
      role: 'role',
    };

    Object.keys(errors).forEach((field) => {
      const frontendField = fieldMap[field];
      if (!frontendField) return;

      const control = this.registerForm.get(frontendField);
      if (control) {
        const messages = Array.isArray(errors[field]) ? errors[field] : [errors[field]];
        control.setErrors({ backend: messages[0] });
        control.markAsTouched();
      }
    });
  }

  // ------------------------------------------------------------------
  // Helpers template
  // ------------------------------------------------------------------
  isFieldInvalid(field: string): boolean {
    const control = this.registerForm.get(field);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  getFieldError(field: string): string {
    const control = this.registerForm.get(field);
    if (!control || !control.errors) return '';

    const errors = control.errors;

    if (errors['backend']) return errors['backend'];
    if (errors['required']) return 'Ce champ est obligatoire.';
    if (errors['email']) return 'Adresse email invalide.';
    if (errors['minlength']) return `Minimum ${errors['minlength'].requiredLength} caractères.`;
    if (errors['pattern']) {
      if (field === 'phone') return 'Format de téléphone invalide (ex: +221771234567).';
      if (field === 'password') {
        return 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.';
      }
      return 'Format invalide.';
    }
    return 'Champ invalide.';
  }

  get passwordsMismatch(): boolean {
    return (
      this.registerForm.errors?.['passwordsMismatch'] === true &&
      this.registerForm.get('passwordConfirm')?.touched === true
    );
  }
}
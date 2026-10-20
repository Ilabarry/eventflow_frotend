import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LoginPayload } from '../../../core/models/auth.model';

/**
 * Page de connexion.
 *
 * Gère :
 *   - Validation côté client (email + mot de passe)
 *   - Appel HTTP au backend (AuthService.login)
 *   - Redirection selon le rôle après succès
 *   - Gestion des erreurs backend (toast)
 *   - Affichage/masquage du mot de passe
 *
 * ⚠️ SÉCURITÉ :
 *   - Aucune donnée sensible n'est stockée dans le composant.
 *   - Le mot de passe est envoyé en HTTPS au backend.
 *   - Les erreurs 401 sont gérées par l'intercepteur.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** État de soumission */
  readonly isSubmitting = signal(false);

  /** État de visibilité du mot de passe */
  readonly showPassword = signal(false);

  /** Message d'info (si l'utilisateur vient de s'inscrire) */
  readonly registeredMessage = signal<string | null>(
    this.route.snapshot.queryParamMap.get('registered') === 'true'
      ? 'Votre compte a été créé avec succès. Connectez-vous maintenant.'
      : null
  );

  /** Formulaire réactif */
  readonly loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  /** Bascule la visibilité du mot de passe */
  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  /** Soumet le formulaire */
  onSubmit(): void {
    if (this.loginForm.invalid || this.isSubmitting()) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);

    const payload: LoginPayload = {
      email: this.loginForm.value.email.trim().toLowerCase(),
      password: this.loginForm.value.password,
    };

    console.log('[LoginComponent] Submitting login', { email: payload.email });

    this.authService.login(payload).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        if (response.success && response.data) {
          const user = response.data.user;
          console.log('[LoginComponent] Login success', {
            email: user.email,
            roles: user.roles,
          });

          // Redirection selon le rôle
          this.redirectByRole(user.roles);
        }
      },
      error: (error) => {
        this.isSubmitting.set(false);
        console.error('[LoginComponent] Login error', error.status);
        // Les erreurs sont gérées par l'intercepteur (toast)
      },
    });
  }

  /** Redirige l'utilisateur selon son rôle principal */
  private redirectByRole(roles: string[]): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');

    // Si un returnUrl existe, on y va en priorité
    if (returnUrl) {
      this.router.navigateByUrl(returnUrl);
      return;
    }

    // Sinon, redirection selon le rôle
    if (roles.includes('administrateur')) {
      this.router.navigate(['/admin/dashboard']);
    } else if (roles.includes('organisateur')) {
      this.router.navigate(['/organisateur/dashboard']);
    } else {
      this.router.navigate(['/participant/dashboard']);
    }
  }

  // ------------------------------------------------------------------
  // Helpers template
  // ------------------------------------------------------------------
  isFieldInvalid(field: string): boolean {
    const control = this.loginForm.get(field);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  getFieldError(field: string): string {
    const control = this.loginForm.get(field);
    if (!control || !control.errors) return '';

    const errors = control.errors;
    if (errors['required']) return 'Ce champ est obligatoire.';
    if (errors['email']) return 'Adresse email invalide.';
    return 'Champ invalide.';
  }
}
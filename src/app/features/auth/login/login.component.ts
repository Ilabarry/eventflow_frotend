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

type LoginErrorType =
  | 'invalid_credentials'
  | 'account_disabled'
  | 'email_not_verified'
  | 'unknown';

interface LoginError {
  type: LoginErrorType;
  message: string;
  email?: string;
}

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

  /** Gestion des erreurs */
  readonly loginError = signal<LoginError | null>(null);
  readonly resending = signal(false);
  readonly resendSuccess = signal(false);

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
    this.loginError.set(null);
    this.resendSuccess.set(false);

    const payload: LoginPayload = {
      email: this.loginForm.value.email.trim().toLowerCase(),
      password: this.loginForm.value.password,
    };

    this.authService.login(payload).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        if (response.success && response.data) {
          this.redirectByRole();
        }
      },
      error: (error) => {
        this.isSubmitting.set(false);
        const loginError = this.parseLoginError(error, payload.email);
        this.loginError.set(loginError);

        // Toast selon le type
        switch (loginError.type) {
          case 'email_not_verified':
            this.notification.warning(loginError.message, 'Email non vérifié');
            break;
          case 'account_disabled':
            this.notification.error(loginError.message, 'Compte désactivé');
            break;
          case 'invalid_credentials':
            this.notification.error(loginError.message, 'Connexion échouée');
            break;
          default:
            this.notification.error(loginError.message, 'Erreur');
        }
      },
    });
  }

  private parseLoginError(error: any, email: string): LoginError {
    const backendMessage: string =
      error?.error?.errors?.non_field_errors?.[0] ||
      error?.error?.message ||
      '';

    if (
      backendMessage.toLowerCase().includes('pas encore vérifiée') ||
      backendMessage.toLowerCase().includes('not verified')
    ) {
      return {
        type: 'email_not_verified',
        message:
          "Votre adresse email n'est pas encore vérifiée. Consultez votre boîte de réception et cliquez sur le lien d'activation.",
        email,
      };
    }

    if (
      backendMessage.toLowerCase().includes('désactivé') ||
      backendMessage.toLowerCase().includes('disabled')
    ) {
      return {
        type: 'account_disabled',
        message:
          "Votre compte est désactivé. Contactez l'administrateur pour plus d'informations.",
        email,
      };
    }

    if (
      error?.status === 401 ||
      backendMessage.toLowerCase().includes('incorrect') ||
      backendMessage.toLowerCase().includes('identifiants invalides')
    ) {
      return {
        type: 'invalid_credentials',
        message: 'Email ou mot de passe incorrect.',
      };
    }

    return {
      type: 'unknown',
      message:
        backendMessage ||
        'Une erreur est survenue lors de la connexion. Réessayez.',
    };
  }

  /** Redirige l'utilisateur selon son rôle principal */
  private redirectByRole(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl) {
      this.router.navigateByUrl(returnUrl);
      return;
    }

    const target = this.authService.homeRouteForRole;

    if (target === '/') {
      this.notification.warning(
        "Votre compte n'a aucun rôle attribué. Contactez un administrateur.",
        'Accès restreint',
      );
    }

    this.router.navigateByUrl(target);
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

  resendVerificationEmail(): void {
    const err = this.loginError();
    if (!err?.email || this.resending()) return;

    this.resending.set(true);

    this.authService.resendVerificationEmail(err.email).subscribe({
      next: () => {
        this.resending.set(false);
        this.resendSuccess.set(true);
        this.notification.success(
          'Un nouvel email de vérification a été envoyé.',
          'Email envoyé',
        );
      },
      error: () => {
        this.resending.set(false);
        this.notification.error(
          "Impossible d'envoyer l'email. Réessayez dans quelques instants.",
          'Erreur',
        );
      },
    });
  }
}
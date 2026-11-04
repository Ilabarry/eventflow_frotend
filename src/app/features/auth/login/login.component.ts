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
 * Classification minimale d'un échec de connexion, utilisée pour
 * choisir le toast adapté. Les messages utilisateur vivent uniquement
 * dans les toasts : l'affichage en page a été supprimé (duplication).
 */
type LoginErrorType =
  | 'invalid_credentials'
  | 'account_disabled'
  | 'email_not_verified'
  | 'unknown';

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

  /** Gestion des erreurs : toasts uniquement. Seul l'échec « email non
   * vérifié » affiche un bouton d'action dans la page (renvoi d'email). */
  readonly resending = signal(false);
  readonly unverifiedEmail = signal<string | null>(null);

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
    this.unverifiedEmail.set(null);

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
        const { type, backendMessage } = this.classifyLoginError(error);

        // Seul l'échec « email non vérifié » ouvre l'action
        // « Renvoyer l'email » ; tout le reste passe par les toasts.
        this.unverifiedEmail.set(
          type === 'email_not_verified' ? payload.email : null,
        );

        switch (type) {
          case 'email_not_verified':
            this.notification.warning(
              "Votre adresse email n'est pas encore vérifiée. Consultez votre boîte de réception et cliquez sur le lien d'activation.",
              'Email non vérifié',
            );
            break;
          case 'account_disabled':
            this.notification.error(
              "Votre compte est désactivé. Contactez l'administrateur pour plus d'informations.",
              'Compte désactivé',
            );
            break;
          case 'invalid_credentials':
            this.notification.error(
              'Email ou mot de passe incorrect.',
              'Connexion échouée',
            );
            break;
          default:
            this.notification.error(
              backendMessage ||
                'Une erreur est survenue lors de la connexion. Réessayez.',
              'Erreur',
            );
        }
      },
    });
  }

  /**
   * Détermine le type d'échec à partir de la réponse backend.
   * Ne construit aucun message destiné à l'utilisateur (les toasts en
   * portent) ; retourne seulement le type et le message brut backend
   * (utilisé tel quel pour le cas « inconnu »).
   */
  private classifyLoginError(error: any): {
    type: LoginErrorType;
    backendMessage: string;
  } {
    const backendMessage: string =
      error?.error?.errors?.non_field_errors?.[0] ||
      error?.error?.message ||
      '';

    const msg = backendMessage.toLowerCase();

    if (msg.includes('pas encore vérifiée') || msg.includes('not verified')) {
      return { type: 'email_not_verified', backendMessage };
    }

    if (msg.includes('désactivé') || msg.includes('disabled')) {
      return { type: 'account_disabled', backendMessage };
    }

    if (
      error?.status === 401 ||
      msg.includes('incorrect') ||
      msg.includes('identifiants invalides')
    ) {
      return { type: 'invalid_credentials', backendMessage };
    }

    return { type: 'unknown', backendMessage };
  }

  /** Redirige l'utilisateur selon son rôle principal */
  private redirectByRole(): void {
    const returnUrl = this.safeReturnUrl(
      this.route.snapshot.queryParamMap.get('returnUrl'),
    );
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

  /**
   * N'accepte qu'un chemin interne commençant par un seul `/`.
   * Bloque `//evil.com`, `/\evil.com` et les URL absolues.
   */
  private safeReturnUrl(value: string | null): string | null {
    if (!value) return null;
    if (!value.startsWith('/')) return null;
    if (value.startsWith('//') || value.startsWith('/\\')) return null;
    return value;
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
    const email = this.unverifiedEmail();
    if (!email || this.resending()) return;

    this.resending.set(true);

    this.authService.resendVerificationEmail(email).subscribe({
      next: () => {
        this.resending.set(false);
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
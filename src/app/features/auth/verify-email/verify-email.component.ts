import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="verify-page">
      <!-- Fond décoratif gradient -->
      <div class="verify-page__bg" aria-hidden="true"></div>

      <div class="verify-card">
        <!-- Header gradient -->
        <header class="verify-card__header">
          <span class="verify-card__logo">EVENT<span>FLOW</span></span>
          <span class="verify-card__line"></span>
        </header>

        <!-- Contenu -->
        <div class="verify-card__body">
          @if (loading()) {
            <div class="verify-state verify-state--loading">
              <span class="verify-spinner" aria-hidden="true"></span>
              <h1 class="verify-title">Vérification en cours…</h1>
              <p class="verify-text">Nous confirmons votre adresse email.</p>
            </div>
          } @else if (success()) {
            <div class="verify-state verify-state--success">
              <div class="verify-icon verify-icon--success">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 6L9 17l-5-5"></path>
                </svg>
              </div>
              <h1 class="verify-title">Email vérifié !</h1>
              <p class="verify-text">
                Votre compte est maintenant actif.<br>
                Vous pouvez vous connecter.
              </p>
              <a routerLink="/login" class="verify-btn">
                Se connecter
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </a>
            </div>
          } @else if (error()) {
            <div class="verify-state verify-state--error">
              <div class="verify-icon verify-icon--error">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>
              <h1 class="verify-title">Vérification impossible</h1>
              <p class="verify-text">{{ error() }}</p>

              @if (resendAvailable()) {
                <button
                  type="button"
                  class="verify-btn verify-btn--secondary"
                  (click)="resendVerification()"
                  [disabled]="resending()"
                >
                  @if (resending()) {
                    <span class="verify-spinner verify-spinner--sm" aria-hidden="true"></span>
                    Envoi…
                  } @else {
                    Renvoyer un nouveau lien
                  }
                </button>
              }

              <a routerLink="/login" class="verify-link">
                Retour à la connexion
              </a>
            </div>
          }
        </div>

        <!-- Footer -->
        <footer class="verify-card__footer">
          <p>
            L'équipe <strong>EVENTFLOW</strong>
          </p>
          <p class="verify-card__footer-small">
            © {{ currentYear }} EVENTFLOW · Tous droits réservés
          </p>
        </footer>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
    }

    .verify-page {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem 1rem;
      background: #F5F5F7;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    .verify-page__bg {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 20% 20%, rgba(139, 124, 246, 0.15) 0%, transparent 40%),
        radial-gradient(circle at 80% 80%, rgba(34, 199, 214, 0.15) 0%, transparent 40%);
      pointer-events: none;
    }

    .verify-card {
      position: relative;
      width: 100%;
      max-width: 520px;
      background: #FFFFFF;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
      overflow: hidden;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ---------- HEADER ---------- */
    .verify-card__header {
      background: linear-gradient(135deg, #8B7CF6 0%, #22C7D6 100%);
      padding: 40px 32px;
      text-align: center;
    }

    .verify-card__logo {
      display: inline-block;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #FFFFFF;
    }

    .verify-card__logo span {
      opacity: 0.85;
    }

    .verify-card__line {
      display: block;
      width: 60px;
      height: 2px;
      background: rgba(255, 255, 255, 0.4);
      margin: 16px auto 0;
      border-radius: 2px;
    }

    /* ---------- BODY ---------- */
    .verify-card__body {
      padding: 48px 40px 32px;
    }

    .verify-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }

    .verify-title {
      margin: 0 0 12px;
      font-size: 24px;
      font-weight: 700;
      color: #1A1A1A;
      letter-spacing: -0.01em;
    }

    .verify-text {
      margin: 0 0 24px;
      font-size: 16px;
      line-height: 1.6;
      color: #4A4A4A;
    }

    /* ---------- ICONS ---------- */
    .verify-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      margin-bottom: 24px;
    }

    .verify-icon--success {
      background: linear-gradient(135deg, #8B7CF6 0%, #22C7D6 100%);
      color: #FFFFFF;
      animation: pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .verify-icon--error {
      background: #FEE2E2;
      color: #DC2626;
    }

    @keyframes pop {
      0% { transform: scale(0); }
      100% { transform: scale(1); }
    }

    /* ---------- BUTTON ---------- */
    .verify-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 32px;
      background: linear-gradient(135deg, #8B7CF6 0%, #22C7D6 100%);
      color: #FFFFFF;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      border: none;
      border-radius: 999px;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      margin-bottom: 12px;
    }

    .verify-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(139, 124, 246, 0.35);
    }

    .verify-btn--secondary {
      background: #F8F8FA;
      color: #8B7CF6;
      border: 1px solid #E4E4E7;
    }

    .verify-btn--secondary:hover {
      background: #F0EEFE;
      box-shadow: none;
    }

    .verify-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .verify-link {
      display: inline-block;
      margin-top: 8px;
      font-size: 14px;
      color: #8B7CF6;
      text-decoration: none;
      font-weight: 500;
    }

    .verify-link:hover {
      text-decoration: underline;
    }

    /* ---------- SPINNER ---------- */
    .verify-spinner {
      display: inline-block;
      width: 40px;
      height: 40px;
      border: 3px solid #EFEFF2;
      border-top-color: #8B7CF6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }

    .verify-spinner--sm {
      width: 16px;
      height: 16px;
      border-width: 2px;
      margin-bottom: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ---------- FOOTER ---------- */
    .verify-card__footer {
      padding: 24px 40px 32px;
      border-top: 1px solid #EFEFF2;
      text-align: center;
    }

    .verify-card__footer p {
      margin: 0 0 8px;
      font-size: 13px;
      color: #9B9BA0;
    }

    .verify-card__footer strong {
      color: #8B7CF6;
    }

    .verify-card__footer-small {
      margin: 0 !important;
      font-size: 12px !important;
      color: #B5B5BA !important;
    }

    /* ---------- RESPONSIVE ---------- */
    @media (max-width: 480px) {
      .verify-card__body {
        padding: 32px 24px 24px;
      }

      .verify-card__header {
        padding: 32px 24px;
      }

      .verify-title {
        font-size: 20px;
      }

      .verify-text {
        font-size: 15px;
      }

      .verify-btn {
        width: 100%;
      }
    }
  `],
})
export class VerifyEmailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly success = signal(false);
  readonly error = signal<string | null>(null);

  /** Affiche le bouton "Renvoyer" si le token est expiré/invalide
   *  ET qu'on connaît l'email (stocké temporairement dans le state). */
  readonly resendAvailable = signal(false);
  readonly resending = signal(false);

  private pendingEmail: string | null = null;

  readonly currentYear = new Date().getFullYear();

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.loading.set(false);
      this.error.set('Lien de vérification invalide (token manquant).');
      return;
    }

    this.http
      .post<{ success: boolean; message: string }>(
        `${environment.apiUrl}/auth/verify-email/`,
        { token },
      )
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.success.set(true);
        },
        error: (err) => {
          this.loading.set(false);
          const message: string =
            err?.error?.message ||
            err?.error?.errors?.token?.[0] ||
            'Le lien est invalide ou a expiré.';

          this.error.set(message);

          // Si le token est expiré et qu'on peut demander un nouveau lien
          if (
            message.toLowerCase().includes('expiré') ||
            message.toLowerCase().includes('invalide')
          ) {
            const email = this.route.snapshot.queryParamMap.get('email');
            if (email) {
              this.pendingEmail = email;
              this.resendAvailable.set(true);
            }
          }
        },
      });
  }

  resendVerification(): void {
    if (!this.pendingEmail || this.resending()) return;

    this.resending.set(true);

    this.http
      .post<{ success: boolean; message: string }>(
        `${environment.apiUrl}/auth/resend-verification/`,
        { email: this.pendingEmail },
      )
      .subscribe({
        next: () => {
          this.resending.set(false);
          this.error.set(
            'Un nouveau lien a été envoyé. Vérifiez votre boîte de réception.',
          );
          this.resendAvailable.set(false);
        },
        error: () => {
          this.resending.set(false);
          this.error.set(
            "Impossible d'envoyer l'email. Réessayez dans quelques instants.",
          );
        },
      });
  }
}
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
      @if (loading()) {
        <div class="spinner">Vérification en cours…</div>
      } @else if (success()) {
        <div class="success">
          <h1>✅ Email vérifié !</h1>
          <p>Votre compte est maintenant actif. Vous pouvez vous connecter.</p>
          <a routerLink="/login" class="btn">Se connecter</a>
        </div>
      } @else if (error()) {
        <div class="error">
          <h1>❌ Vérification impossible</h1>
          <p>{{ error() }}</p>
          <a routerLink="/login" class="btn">Retour à la connexion</a>
        </div>
      }
    </section>
  `,
})
export class VerifyEmailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly success = signal(false);
  readonly error = signal<string | null>(null);

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
        next: (res) => {
          this.loading.set(false);
          this.success.set(true);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(
            err?.error?.message || 'Le lien est invalide ou a expiré.',
          );
        },
      });
  }
}
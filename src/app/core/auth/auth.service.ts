import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, throwError, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import {
  // AuthResponse,
  RegisterPayload,
  LoginPayload,
  LoginResponse,
  ChangePasswordPayload,
} from '../models/auth.model';
import { ApiResponse } from '../models/api-response.model';
import { NotificationService } from '../services/notification.service';

/**
 * Service d'authentification.
 *
 * Gère :
 *   - Login / Register / Logout
 *   - Stockage des tokens (localStorage pour access, mémoire + localStorage pour refresh)
 *   - État réactif de l'utilisateur (signals)
 *   - Refresh automatique du token
 *
 * ⚠️ SÉCURITÉ :
 *   - Le refresh token est stocké en localStorage (en dev).
 *     En production, il faudrait utiliser un cookie HttpOnly (géré par le backend).
 *   - L'access token est stocké en localStorage ET en signal mémoire.
 *   - Aucune donnée sensible n'est loggée.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly notification = inject(NotificationService);

  private readonly API_URL = environment.apiUrl;

  // ------------------------------------------------------------------
  // Clés localStorage (centralisées)
  // ------------------------------------------------------------------
  private readonly ACCESS_TOKEN_KEY = 'evf_access_token';
  private readonly REFRESH_TOKEN_KEY = 'evf_refresh_token';

  // ------------------------------------------------------------------
  // État réactif (signals)
  // ------------------------------------------------------------------
  private _currentUser = signal<User | null>(null);
  private _accessToken = signal<string | null>(this.getStoredAccessToken());
  private _refreshToken = signal<string | null>(this.getStoredRefreshToken());

  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthenticated = computed(() => !!this._accessToken() && !!this._currentUser());
  readonly isAdmin = computed(() => this._currentUser()?.roles?.includes('administrateur') ?? false);
  readonly isOrganizer = computed(() => this._currentUser()?.roles?.includes('organisateur') ?? false);
  readonly isParticipant = computed(() => this._currentUser()?.roles?.includes('participant') ?? false);

  // ------------------------------------------------------------------
  // Accesseurs
  // ------------------------------------------------------------------
  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return this._refreshToken();
  }

  // ------------------------------------------------------------------
  // INSCRIPTION
  // ------------------------------------------------------------------
  register(payload: RegisterPayload): Observable<ApiResponse<User>> {
    console.log('[AuthService] Register attempt', { email: payload.email });

    return this.http
      .post<ApiResponse<User>>(`${this.API_URL}/auth/register/`, payload)
      .pipe(
        tap((response) => {
          console.log('[AuthService] Register success', { email: payload.email });
          this.notification.success(
            'Inscription réussie. Vous pouvez maintenant vous connecter.',
            'Bienvenue !'
          );
        }),
        catchError((error) => {
          console.error('[AuthService] Register error', error.status);
          // Les erreurs de validation sont gérées par le composant (mapping par champ)
          // Les erreurs HTTP génériques sont gérées par l'intercepteur
          return throwError(() => error);
        })
      );
  }

  // ------------------------------------------------------------------
  // CONNEXION
  // ------------------------------------------------------------------
  login(payload: LoginPayload): Observable<ApiResponse<LoginResponse>> {
    console.log('[AuthService] Login attempt', { email: payload.email });

    return this.http
      .post<ApiResponse<LoginResponse>>(`${this.API_URL}/auth/login/`, payload)
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this.handleAuthSuccess(response.data);
            console.log('[AuthService] Login success', {
              email: response.data.user.email,
              roles: response.data.user.roles,
            });
            this.notification.success(
              `Bienvenue ${response.data.user.first_name} !`,
              'Connexion réussie'
            );
          }
        }),
        catchError((error) => {
          console.error('[AuthService] Login error', error.status);
          if (error.status === 401) {
            this.notification.error(
              'Email ou mot de passe incorrect.',
              'Connexion échouée'
            );
          }
          return throwError(() => error);
        })
      );
  }

  // ------------------------------------------------------------------
  // DÉCONNEXION
  // ------------------------------------------------------------------
  logout(): void {
  const refresh = this.getRefreshToken();

  // ✅ Nettoyer AVANT l'appel réseau pour une UX réactive
  this.clearSession();

  // Puis blacklister le refresh token (best-effort, on ignore l'erreur)
  if (refresh) {
    this.http.post(`${this.API_URL}/auth/logout/`, { refresh }).subscribe({
      error: (err) => console.warn('[AuthService] Logout backend failed', err.status),
    });
  }
}

  // ------------------------------------------------------------------
  // PROFIL
  // ------------------------------------------------------------------
  getMe(): Observable<ApiResponse<User>> {
    return this.http.get<ApiResponse<User>>(`${this.API_URL}/users/me/`);
  }

  updateProfile(data: Partial<User>): Observable<ApiResponse<User>> {
    return this.http.patch<ApiResponse<User>>(`${this.API_URL}/users/me/`, data);
  }

  changePassword(payload: ChangePasswordPayload): Observable<ApiResponse<null>> {
    return this.http.post<ApiResponse<null>>(
      `${this.API_URL}/auth/change-password/`,
      payload
    );
  }

  // ------------------------------------------------------------------
  // REFRESH
  // ------------------------------------------------------------------
  refreshAccessToken(): Observable<ApiResponse<{ tokens: { access: string; refresh: string } }>> {
    const refresh = this.getRefreshToken();
    if (!refresh) {
      return throwError(() => new Error('No refresh token'));
    }

    return this.http
      .post<ApiResponse<{ tokens: { access: string; refresh: string } }>>(
        `${this.API_URL}/auth/refresh/`,
        { refresh }
      )
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this._accessToken.set(response.data.tokens.access);
            this._refreshToken.set(response.data.tokens.refresh);
            localStorage.setItem(this.ACCESS_TOKEN_KEY, response.data.tokens.access);
            localStorage.setItem(this.REFRESH_TOKEN_KEY, response.data.tokens.refresh);
          }
        })
      );
  }

  // ------------------------------------------------------------------
  // HELPERS PRIVÉS
  // ------------------------------------------------------------------
  private handleAuthSuccess(data: LoginResponse): void {
    this._currentUser.set(data.user);
    this._accessToken.set(data.tokens.access);
    this._refreshToken.set(data.tokens.refresh);

    localStorage.setItem(this.ACCESS_TOKEN_KEY, data.tokens.access);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, data.tokens.refresh);
  }

  private clearSession(): void {
    this._currentUser.set(null);
    this._accessToken.set(null);
    this._refreshToken.set(null);

    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);

    this.notification.info('Vous êtes déconnecté.', 'À bientôt');
    this.router.navigate(['/login']);
  }

  private getStoredAccessToken(): string | null {
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  private getStoredRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Charge l'utilisateur courant depuis le backend.
   * Appelé au démarrage de l'app si un token existe.
   */
  loadCurrentUser(): void {
    if (!this._accessToken()) return;

    console.log('[AuthService] Loading current user...');
    this.getMe().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this._currentUser.set(response.data);
          console.log('[AuthService] Current user loaded', { email: response.data.email });
        }
      },
      error: (error) => {
        console.error('[AuthService] Failed to load current user', error.status);
        this.clearSession();
      },
    });
  }
}
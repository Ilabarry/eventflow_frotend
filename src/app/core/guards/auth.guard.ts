import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/**
 * AuthGuard : protège les routes privées.
 *
 * Comportements :
 *  1. Utilisateur déjà chargé en mémoire → laisse passer
 *  2. Token présent mais profil non chargé (F5/refresh) → attend loadCurrentUserAsync()
 *  3. Aucun token → redirection /login avec returnUrl
 */
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const redirect = () =>
    router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);

  // 1. Déjà authentifié (profil en mémoire)
  if (authService.isAuthenticated()) {
    return true;
  }

  // 2. Token présent mais profil non chargé → attendre le chargement
  const token = authService.getAccessToken();
  if (token) {
    return authService.loadCurrentUserAsync().pipe(
      map((user) => (user ? true : redirect())),
      catchError(() => of(redirect())),
    );
  }

  // 3. Aucun token
  console.warn('[AuthGuard] Aucun token — redirection vers /login');
  return redirect();
};
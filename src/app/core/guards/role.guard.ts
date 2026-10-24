import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/**
 * Guard de rôle : vérifie que l'utilisateur possède au moins un des rôles requis.
 * Suppose que authGuard a déjà validé l'authentification,
 * mais on gère aussi le cas où le profil n'est pas encore chargé.
 */
export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    const check = (user: ReturnType<typeof authService.currentUser>) => {
      if (!user) {
        return router.parseUrl('/login');
      }
      const hasRole = user.roles.some((r) => allowedRoles.includes(r));
      if (hasRole) return true;

      console.warn(
        `[RoleGuard] Accès refusé — rôle requis: ${allowedRoles.join(', ')}`,
      );
      return router.parseUrl('/');
    };

    // Déjà chargé ?
    const user = authService.currentUser();
    if (user) return check(user);

    // Sinon attendre le chargement
    const token = authService.getAccessToken();
    if (!token) return router.parseUrl('/login');

    return authService.loadCurrentUserAsync().pipe(
      map((u) => check(u)),
      catchError(() => of(router.parseUrl('/login'))),
    );
  };
};
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

/**
 * Guard de rôle : vérifie que l'utilisateur possède au moins un des rôles requis.
 * Suppose que authGuard a déjà validé l'authentification.
 */
export const roleGuard = (allowedRoles: string[]): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    const user = authService.currentUser();
    if (!user) {
      router.navigate(['/login']);
      return false;
    }

    const hasRole = user.roles.some((r) => allowedRoles.includes(r));
    if (hasRole) return true;

    console.warn(`[RoleGuard] Accès refusé — rôle requis: ${allowedRoles.join(', ')}`);
    router.navigate(['/']);
    return false;
  };
};
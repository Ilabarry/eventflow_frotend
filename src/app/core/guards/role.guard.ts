import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { Role } from '../models/user.model';

/**
 * RoleGuard factory : protège une route selon le rôle.
 *
 * Exemple : { path: 'admin', canActivate: [roleGuard([Role.ADMINISTRATEUR])] }
 */
export const roleGuard = (allowedRoles: Role[]): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    const user = authService.currentUser();
    if (!user) {
      router.navigate(['/login']);
      return false;
    }

    const hasRole = user.roles.some((r) => allowedRoles.includes(r as Role));
    if (hasRole) return true;

    console.warn('[RoleGuard] Access denied — insufficient role');
    router.navigate(['/']);
    return false;
  };
};
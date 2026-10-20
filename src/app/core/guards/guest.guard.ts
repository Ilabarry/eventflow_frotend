import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';

/**
 * GuestGuard : empêche un utilisateur connecté d'accéder à /login ou /register.
 * Le redirige vers son dashboard.
 */
export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return true;
  }

  console.warn('[GuestGuard] Already authenticated — redirecting to dashboard');
  router.navigate(['/participant/dashboard']);
  return false;
};
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, BehaviorSubject, filter, take } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/**
 * Intercepteur JWT.
 *
 * - Ajoute le header Authorization à toutes les requêtes (sauf login/register/refresh).
 * - En cas de 401, tente un refresh automatique du token.
 * - Si le refresh échoue, déconnecte l'utilisateur.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Ne pas ajouter le token pour les endpoints publics
  const publicEndpoints = [
    '/auth/login/',
    '/auth/register/',
    '/auth/refresh/',
    '/auth/logout/',
  ];
  const isPublic = publicEndpoints.some((endpoint) => req.url.includes(endpoint));

  const token = authService.getAccessToken();

  let authReq = req;
  if (token && !isPublic) {
    authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isPublic && token) {
        // Tentative de refresh
        console.warn('[AuthInterceptor] 401 — Attempting token refresh');
        return authService.refreshAccessToken().pipe(
          switchMap((response) => {
            if (response.success && response.data) {
              const newToken = response.data.tokens.access;
              const retryReq = req.clone({
                setHeaders: { Authorization: `Bearer ${newToken}` },
              });
              return next(retryReq);
            }
            return throwError(() => error);
          }),
          catchError((refreshError) => {
            console.error('[AuthInterceptor] Refresh failed — Logout');
            authService.logout();
            return throwError(() => refreshError);
          })
        );
      }
      return throwError(() => error);
    })
  );
};
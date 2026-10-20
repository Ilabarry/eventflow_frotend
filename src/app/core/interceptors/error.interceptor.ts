import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

/**
 * Intercepte toutes les erreurs HTTP et affiche un toast.
 *
 * Gère les codes standards EVENTFLOW :
 *   - 400 : Données invalides
 *   - 401 : Non authentifié (le AuthService gère la redirection)
 *   - 403 : Accès refusé
 *   - 404 : Ressource introuvable
 *   - 409 : Conflit (déjà inscrit, complet, etc.)
 *   - 429 : Trop de requêtes
 *   - 500 : Erreur serveur
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notification = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // 401 : ne pas afficher de toast, le AuthService gère la redirection
      if (error.status === 401) {
        return throwError(() => error);
      }

      // 403 : accès refusé
      if (error.status === 403) {
        notification.error(
          error.error?.message || 'Vous n\'êtes pas autorisé à effectuer cette action.',
          'Accès refusé'
        );
        return throwError(() => error);
      }

      // 404 : ressource introuvable
      if (error.status === 404) {
        notification.warning(
          error.error?.message || 'La ressource demandée est introuvable.',
          'Introuvable'
        );
        return throwError(() => error);
      }

      // 409 : conflit (déjà inscrit, complet, etc.)
      if (error.status === 409) {
        notification.warning(
          error.error?.message || 'Un conflit est survenu.',
          'Conflit'
        );
        return throwError(() => error);
      }

      // 429 : trop de requêtes
      if (error.status === 429) {
        notification.warning(
          'Trop de requêtes. Veuillez patienter un instant.',
          'Trop de requêtes'
        );
        return throwError(() => error);
      }

      // Autres erreurs (400, 500, etc.)
      notification.httpError(error);
      return throwError(() => error);
    })
  );
};
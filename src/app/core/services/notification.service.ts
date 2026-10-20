import { Injectable, inject } from '@angular/core';
import { ToastrService } from 'ngx-toastr';

/**
 * Service centralisé de notifications toast.
 *
 * Wrappe ngx-toastr pour :
 *   - Uniformiser les messages
 *   - Ajouter des helpers (success, error, warning, info)
 *   - Faciliter les tests (on peut mocker ce service)
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly toastr = inject(ToastrService);

  // ------------------------------------------------------------------
  // Succès
  // ------------------------------------------------------------------
  success(message: string, title = 'Succès'): void {
    this.toastr.success(message, title);
  }

  // ------------------------------------------------------------------
  // Erreur
  // ------------------------------------------------------------------
  error(message: string, title = 'Erreur'): void {
    this.toastr.error(message, title);
  }

  // ------------------------------------------------------------------
  // Avertissement
  // ------------------------------------------------------------------
  warning(message: string, title = 'Attention'): void {
    this.toastr.warning(message, title);
  }

  // ------------------------------------------------------------------
  // Information
  // ------------------------------------------------------------------
  info(message: string, title = 'Information'): void {
    this.toastr.info(message, title);
  }

  // ------------------------------------------------------------------
  // Erreur HTTP générique
  // ------------------------------------------------------------------
  httpError(error: any): void {
    const message =
      error?.error?.message ||
      error?.message ||
      'Une erreur est survenue. Veuillez réessayer.';

    this.toastr.error(message, 'Erreur');
  }
}
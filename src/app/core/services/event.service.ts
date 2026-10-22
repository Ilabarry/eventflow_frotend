import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';
import {
  CreateEventPayload,
  EventDto,
} from '../models/event.model';

/**
 * Service d'accès aux endpoints /api/events/.
 *
 * Tous les appels renvoient des Observables typés, jamais de subscribe ici.
 * Les erreurs sont laissées remonter aux composants (via errorInterceptor
 * et/ou toastr local).
 */
@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/events`;

  // ------------------------------------------------------------------
  // LECTURE
  // ------------------------------------------------------------------

  /**
   * GET /api/events/my/
   * Événements de l'organisateur connecté (tous statuts).
   */
  getMyEvents(page = 1, pageSize = 20): Observable<ApiResponse<PaginatedResponse<EventDto>>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('page_size', pageSize.toString());

    return this.http.get<ApiResponse<PaginatedResponse<EventDto>>>(
      `${this.BASE}/my/`,
      { params }
    );
  }

  /**
   * GET /api/events/{id}/
   * Détail d'un événement (owner = EventOrganizerSerializer, public = EventDetailSerializer).
   */
  getEvent(id: string): Observable<ApiResponse<EventDto>> {
    return this.http.get<ApiResponse<EventDto>>(`${this.BASE}/${id}/`);
  }

  // ------------------------------------------------------------------
  // CRÉATION
  // ------------------------------------------------------------------

  /**
   * POST /api/events/
   * Crée un événement en statut DRAFT.
   */
  createEvent(payload: CreateEventPayload): Observable<ApiResponse<EventDto>> {
    console.info('[EventService] Creating event', { title: payload.title });
    return this.http
      .post<ApiResponse<EventDto>>(`${this.BASE}/`, payload)
      .pipe(
        tap((res) => console.info('[EventService] Event created', res.data?.id)),
        catchError((err) => {
          console.error('[EventService] Create failed', err.status);
          return throwError(() => err);
        })
      );
  }

  /**
   * PATCH /api/events/{id}/
   */
  updateEvent(id: string, payload: Partial<CreateEventPayload>): Observable<ApiResponse<EventDto>> {
    return this.http.patch<ApiResponse<EventDto>>(`${this.BASE}/${id}/`, payload);
  }

  // ------------------------------------------------------------------
  // ACTIONS
  // ------------------------------------------------------------------

  /**
   * POST /api/events/{id}/publish/
   * Publie un événement. Le backend valide les règles métier.
   */
  publishEvent(id: string): Observable<ApiResponse<EventDto>> {
    console.info('[EventService] Publishing', id);
    return this.http.post<ApiResponse<EventDto>>(`${this.BASE}/${id}/publish/`, {});
  }

  /**
   * POST /api/events/{id}/cancel/
   */
  cancelEvent(id: string): Observable<ApiResponse<EventDto>> {
    return this.http.post<ApiResponse<EventDto>>(`${this.BASE}/${id}/cancel/`, {});
  }

  /**
   * DELETE /api/events/{id}/
   */
  deleteEvent(id: string): Observable<ApiResponse<null>> {
    console.info('[EventService] Deleting', id);
    return this.http.delete<ApiResponse<null>>(`${this.BASE}/${id}/`);
  }

  /**
   * GET /api/events/{id}/share/
   */
  getShareData(id: string): Observable<ApiResponse<{ public_url: string; title: string }>> {
    return this.http.get<ApiResponse<{ public_url: string; title: string }>>(
      `${this.BASE}/${id}/share/`
    );
  }

   /**
     * POST /api/events/{id}/upload-cover/
     * Envoie l'image de couverture en multipart.
     */
    uploadCover(eventId: string, file: File): Observable<ApiResponse<EventDto>> {
    const formData = new FormData();
    formData.append('cover_image', file);
    return this.http.patch<ApiResponse<EventDto>>(
        `${this.BASE}/${eventId}/`,
        formData,
    );
    }

}
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';

/** Statut backend (MAJUSCULES). */
export type ApiRegistrationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

/** Inscription côté organisateur (RegistrationOrganizerSerializer). */
export interface RegistrationOrganizerDto {
  id: string;
  reference: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  registered_at: string;
  cancelled_at: string | null;
  participant_email: string;
  participant_name: string;
  participant_phone: string;
  ticket_type_name: string | null;
}

@Injectable({ providedIn: 'root' })
export class RegistrationService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /** GET /api/events/{eventId}/registrations/ */
  listByEvent(
    eventId: string,
    page = 1,
    pageSize = 100,
  ): Observable<ApiResponse<PaginatedResponse<RegistrationOrganizerDto>>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('page_size', pageSize.toString());

    return this.http.get<ApiResponse<PaginatedResponse<RegistrationOrganizerDto>>>(
      `${this.BASE}/events/${eventId}/registrations/`,
      { params },
    );
  }

  /** POST /api/registrations/{id}/cancel/ */
  cancel(registrationId: string): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(
      `${this.BASE}/registrations/${registrationId}/cancel/`,
      {},
    );
  }

}
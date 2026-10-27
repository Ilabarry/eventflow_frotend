import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';
import { EventDto } from '../models/event.model';

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

/** Inscription côté participant (RegistrationListSerializer) : GET /api/registrations/my/ */
export interface MyRegistrationDto {
  id: string;
  reference: string;
  status: ApiRegistrationStatus;
  registered_at: string;
  cancelled_at: string | null;
  event: EventDto;
}

/** Détail d'une inscription côté participant (RegistrationDetailSerializer). */
export interface RegistrationDetailDto {
  id: string;
  reference: string;
  status: ApiRegistrationStatus;
  registered_at: string;
  cancelled_at: string | null;
  ticket_type_name: string | null;
  event: EventDto & {
    access_url?: string | null;
  };
}

/** Filtres acceptés par GET /api/registrations/my/. */
export interface MyRegistrationsFilters {
  page: number;
  pageSize: number;
  status: ApiRegistrationStatus | null;
  search: string;
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

  /** GET /api/registrations/my/ : inscriptions du participant connecté. */
  listMine(
    filters: MyRegistrationsFilters,
  ): Observable<ApiResponse<PaginatedResponse<MyRegistrationDto>>> {
    let params = new HttpParams()
      .set('page', filters.page.toString())
      .set('page_size', filters.pageSize.toString());

    if (filters.status) {
      params = params.set('status', filters.status);
    }
    const search = filters.search.trim();
    if (search) {
      params = params.set('search', search);
    }

    return this.http.get<ApiResponse<PaginatedResponse<MyRegistrationDto>>>(
      `${this.BASE}/registrations/my/`,
      { params },
    );
  }

  /** POST /api/registrations/ : inscrire le participant connecté à un événement. */
  create(
    payload: CreateRegistrationPayload,
  ): Observable<ApiResponse<CreateRegistrationDto>> {
    return this.http.post<ApiResponse<CreateRegistrationDto>>(
      `${this.BASE}/registrations/`,
      payload,
    );
  }

  /** GET /api/registrations/{id}/ : détail complet (avec access_url si CONFIRMED). */
  getById(registrationId: string): Observable<ApiResponse<RegistrationDetailDto>> {
    return this.http.get<ApiResponse<RegistrationDetailDto>>(
      `${this.BASE}/registrations/${registrationId}/`,
    );
  }
}

/** Réponse de POST /api/registrations/ (RegistrationDetailSerializer). */
export interface CreateRegistrationDto {
  id: string;
  reference: string;
  status: ApiRegistrationStatus;
  registered_at: string;
  cancelled_at: string | null;
  event: EventDto;
  ticket_type_name: string | null;
}

/** Payload pour POST /api/registrations/. */
export interface CreateRegistrationPayload {
  event_id: string;
  ticket_type_id?: string | null;
}
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';

/** Statut d'un ticket (apps/tickets/constants.py → TicketStatus). */
export type ApiTicketStatus = 'VALID' | 'USED' | 'EXPIRED' | 'CANCELLED';

/** Ticket du participant (TicketListSerializer) : GET /api/tickets/my/ */
export interface MyTicketDto {
  id: string;
  reference: string;
  status: ApiTicketStatus;
  issued_at: string;
  used_at: string | null;
  event_id: string;
  event_title: string;
  /** URL complète de l'affiche de l'événement, ou null. */
  event_cover_image: string | null;
  ticket_type_name: string;
}

/** Détail d'un ticket (TicketDetailSerializer) : GET /api/tickets/{id}/ */
export interface TicketDetailDto {
  id: string;
  reference: string;
  status: ApiTicketStatus;
  issued_at: string;
  used_at: string | null;
  cancelled_at: string | null;
  registration_reference: string;
  event_title: string;
  event_start_at: string;
  event_end_at: string;
  event_venue: string;
  event_city: string;
  event_format: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  ticket_type_name: string;
  /** Texte signé « référence|signature » à encoder dans le QR code. */
  qr_payload: string;
}

export interface MyTicketsFilters {
  page: number;
  pageSize: number;
  /** Filtre ?event=<uuid> du backend (TicketFilter). */
  eventId?: string;
  status?: ApiTicketStatus | null;
  /** Recherche backend : référence du ticket ou de l'inscription. */
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class TicketService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/tickets`;

  /** GET /api/tickets/my/ — tickets du participant connecté, paginés. */
  listMine(filters: MyTicketsFilters): Observable<ApiResponse<PaginatedResponse<MyTicketDto>>> {
    let params = new HttpParams()
      .set('page', filters.page)
      .set('page_size', filters.pageSize);

    if (filters.eventId) {
      params = params.set('event', filters.eventId);
    }
    if (filters.status) {
      params = params.set('status', filters.status);
    }
    const search = filters.search?.trim();
    if (search) {
      params = params.set('search', search);
    }

    return this.http.get<ApiResponse<PaginatedResponse<MyTicketDto>>>(`${this.BASE}/my/`, { params });
  }

  /** GET /api/tickets/{id}/ — détail d'un ticket, avec le contenu du QR code. */
  getDetail(id: string): Observable<ApiResponse<TicketDetailDto>> {
    return this.http.get<ApiResponse<TicketDetailDto>>(`${this.BASE}/${id}/`);
  }
}

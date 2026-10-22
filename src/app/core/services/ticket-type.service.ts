import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

export interface CreateTicketTypePayload {
  name: string;
  price: string;              // decimal en string (backend)
  quantity_total: number | null;
  description?: string;
  is_active?: boolean;
}

export interface UpdateTicketTypePayload {
  name?: string;
  price?: string;
  quantity_total?: number | null;
  description?: string;
  is_active?: boolean;
}

export interface TicketTypeDto {
  id: string;
  event: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  quantity_total: number | null;
  quantity_sold: number;
  available_quantity: number | null;
  sales_start_at: string | null;
  sales_end_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class TicketTypeService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /** GET /api/events/{eventId}/ticket-types/ — vue organisateur (complet). */
  listByEvent(eventId: string): Observable<ApiResponse<TicketTypeDto[]>> {
    return this.http.get<ApiResponse<TicketTypeDto[]>>(
      `${this.BASE}/events/${eventId}/ticket-types/`,
    );
  }

  /** POST /api/events/{eventId}/ticket-types/ */
  create(eventId: string, payload: CreateTicketTypePayload): Observable<ApiResponse<TicketTypeDto>> {
    return this.http.post<ApiResponse<TicketTypeDto>>(
      `${this.BASE}/events/${eventId}/ticket-types/`,
      payload,
    );
  }

  /** PATCH /api/ticket-types/{id}/ */
  update(ticketId: string, payload: UpdateTicketTypePayload): Observable<ApiResponse<TicketTypeDto>> {
    return this.http.patch<ApiResponse<TicketTypeDto>>(
      `${this.BASE}/ticket-types/${ticketId}/`,
      payload,
    );
  }

  /** DELETE /api/ticket-types/{id}/ */
  remove(ticketId: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      `${this.BASE}/ticket-types/${ticketId}/`,
    );
  }
}
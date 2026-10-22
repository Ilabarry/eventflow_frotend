import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

export interface CreateTicketTypePayload {
  name: string;
  price: string;          // decimal en string
  quantity_total: number;
  description?: string;
}

export interface TicketTypeDto {
  id: string;
  event: string;
  name: string;
  price: string;
  quantity_total: number;
  quantity_sold: number;
  description: string;
  is_active: boolean;
}

@Injectable({ providedIn: 'root' })
export class TicketTypeService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /** POST /api/events/{eventId}/ticket-types/ */
  create(eventId: string, payload: CreateTicketTypePayload): Observable<ApiResponse<TicketTypeDto>> {
    return this.http.post<ApiResponse<TicketTypeDto>>(
      `${this.BASE}/events/${eventId}/ticket-types/`,
      payload,
    );
  }

  /** GET /api/events/{eventId}/ticket-types/ */
  listByEvent(eventId: string): Observable<ApiResponse<TicketTypeDto[]>> {
    return this.http.get<ApiResponse<TicketTypeDto[]>>(
      `${this.BASE}/events/${eventId}/ticket-types/`,
    );
  }

  update(eventId: string, ticketId: string, payload: Partial<CreateTicketTypePayload>) {
    return this.http.patch<ApiResponse<TicketTypeDto>>(
        `${this.BASE}/events/${eventId}/ticket-types/${ticketId}/`,
        payload,
    );
    }

    remove(eventId: string, ticketId: string) {
    return this.http.delete<ApiResponse<null>>(
        `${this.BASE}/ticket-types/${ticketId}/`,
    );
  }


}
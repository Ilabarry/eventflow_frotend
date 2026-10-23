import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';
import { BackendEvent, EventCategory } from '../models/event.model';

export interface ParticipantEventsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  format?: 'IN_PERSON' | 'ONLINE' | 'HYBRID' | null;
  price?: 'FREE' | 'PAID' | null;
  date?: 'today' | 'week' | 'month' | null;
  ordering?: 'start_at' | '-start_at' | 'created_at' | '-created_at';
}

@Injectable({ providedIn: 'root' })
export class ParticipantEventsService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /**
   * GET /api/events/
   * Ne renvoie que les événements PUBLISHED (le backend filtre).
   */
  list(query: ParticipantEventsQuery = {}): Observable<ApiResponse<PaginatedResponse<BackendEvent>>> {
    let params = new HttpParams()
      .set('page', (query.page ?? 1).toString())
      .set('page_size', (query.pageSize ?? 12).toString());

    if (query.search?.trim()) params = params.set('search', query.search.trim());
    if (query.category) params = params.set('category', query.category);
    if (query.format) params = params.set('format', query.format);
    if (query.price) params = params.set('participation_type', query.price);
    if (query.date) params = params.set('date', query.date);
    if (query.ordering) params = params.set('ordering', query.ordering);

    return this.http.get<ApiResponse<PaginatedResponse<BackendEvent>>>(
      `${this.BASE}/events/`,
      { params },
    );
  }

  /** GET /api/categories/ */
  listCategories(): Observable<ApiResponse<EventCategory[]>> {
    return this.http.get<ApiResponse<EventCategory[]>>(`${this.BASE}/categories/`);
  }

  /** GET /api/events/{id}/ */
  detail(id: string): Observable<ApiResponse<BackendEvent>> {
    return this.http.get<ApiResponse<BackendEvent>>(`${this.BASE}/events/${id}/`);
  }
}
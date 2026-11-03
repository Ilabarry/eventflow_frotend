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
  category?: string;              // UUID
  format?: 'IN_PERSON' | 'ONLINE' | 'HYBRID' | null;
  price?: 'FREE' | 'PAID' | null;
  date?: 'today' | 'week' | 'month' | null;
  ordering?: 'start_at' | '-start_at' | 'created_at' | '-created_at' | 'RANDOM';
  upcomingOnly?: boolean;         // défaut true
}

@Injectable({ providedIn: 'root' })
export class ParticipantEventsService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /**
   * GET /api/events/
   * Ne renvoie que les événements PUBLISHED et à venir (par défaut).
   */
  list(
    query: ParticipantEventsQuery = {},
  ): Observable<ApiResponse<PaginatedResponse<BackendEvent>>> {
    let params = new HttpParams()
      .set('page', (query.page ?? 1).toString())
      .set('page_size', (query.pageSize ?? 12).toString());

    // upcoming=true par défaut (sauf si explicitement désactivé)
    if (query.upcomingOnly !== false) {
      params = params.set('upcoming', 'true');
    }

    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }
    if (query.category) {
      params = params.set('category', query.category);
    }
    if (query.format) {
      params = params.set('format', query.format);
    }
    if (query.price) {
      params = params.set('participation_type', query.price);
    }
    // `date` → mapper vers start_date / end_date (même logique que events.component).
    if (query.date) {
      const today = new Date();
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      if (query.date === 'today') {
        startDate = endDate = today;
      } else if (query.date === 'week') {
        startDate = today;
        endDate = new Date(today);
        endDate.setDate(today.getDate() + 7);
      } else if (query.date === 'month') {
        startDate = today;
        endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      }
      if (startDate) {
        const isoStart = startDate.toISOString().slice(0, 10);
        const isoEnd = endDate ? endDate.toISOString().slice(0, 10) : null;
        if (isoStart) params = params.set('start_date', isoStart);
        if (isoEnd) params = params.set('end_date', isoEnd);
      }
    }
    if (query.ordering) {
      params = params.set('ordering', query.ordering);
    }

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
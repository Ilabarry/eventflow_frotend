import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';

/** Types backend (MAJUSCULES) — à aligner sur apps/notifications/constants.py */
export type ApiNotificationType =
  | 'REGISTRATION'
  | 'TICKET'
  | 'PAYMENT'
  | 'EVENT_PUBLICATION'
  | 'EVENT_UPDATE'
  | 'EVENT_REMINDER'
  | 'SYSTEM';

export interface NotificationDto {
  id: string;                    // UUID
  title: string;
  message: string;
  type: ApiNotificationType;
  is_read: boolean;
  read_at: string | null;
  related_entity_type: string;
  related_entity_id: string;
  metadata: Record<string, any>;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationApiService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/notifications`;

  /** GET /api/notifications/?is_read=false&type=PAYMENT */
  list(options: {
    isRead?: boolean;
    type?: ApiNotificationType;
    page?: number;
    pageSize?: number;
  } = {}): Observable<ApiResponse<PaginatedResponse<NotificationDto>>> {
    let params = new HttpParams()
      .set('page', (options.page ?? 1).toString())
      .set('page_size', (options.pageSize ?? 50).toString());

    if (options.isRead !== undefined) {
      params = params.set('is_read', String(options.isRead));
    }
    if (options.type) {
      params = params.set('type', options.type);
    }

    return this.http.get<ApiResponse<PaginatedResponse<NotificationDto>>>(
      `${this.BASE}/`,
      { params },
    );
  }

  /** GET /api/notifications/unread-count/ */
  unreadCount(): Observable<ApiResponse<{ unread_count: number }>> {
    return this.http.get<ApiResponse<{ unread_count: number }>>(
      `${this.BASE}/unread-count/`,
    );
  }

  /** PATCH /api/notifications/{id}/read/ */
  markRead(id: string): Observable<ApiResponse<NotificationDto>> {
    return this.http.patch<ApiResponse<NotificationDto>>(
      `${this.BASE}/${id}/read/`,
      {},
    );
  }

  /** PATCH /api/notifications/read-all/ */
  markAllRead(): Observable<ApiResponse<{ updated_count: number }>> {
    return this.http.patch<ApiResponse<{ updated_count: number }>>(
      `${this.BASE}/read-all/`,
      {},
    );
  }

  /** DELETE /api/notifications/{id}/ */
  remove(id: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(`${this.BASE}/${id}/`);
  }
}
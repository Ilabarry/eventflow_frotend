import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';

/** Statut de présence calculé côté backend. */
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'NOT_CHECKED_IN';

/** Ligne de la liste d'accueil d'un événement (EventAttendanceRowSerializer). */
export interface EventAttendanceRowDto {
  registration_id: string;
  registration_reference: string;
  participant_name: string;
  participant_email: string;
  attendance_id: string | null;
  attendance_status: AttendanceStatus;
  checked_in_at: string | null;
  check_in_method: 'MANUAL' | 'QR_CODE' | null;
}

/** Réponse d'un check-in ou mark-absent (AttendanceSerializer). */
export interface AttendanceDto {
  id: string;
  status: 'PRESENT' | 'ABSENT';
  checked_in_at: string | null;
  check_in_method: 'MANUAL' | 'QR_CODE' | null;
  registration_id: string;
  registration_reference: string;
  participant_name: string;
  participant_email: string;
  event_id: string;
  event_title: string;
  recorded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/attendance`;
  private readonly EVENTS_BASE = `${environment.apiUrl}/events`;

  /**
   * GET /api/events/{eventId}/attendance/
   * Liste d'accueil : inscriptions CONFIRMED avec statut de présence.
   */
  listByEvent(
    eventId: string,
    page = 1,
    pageSize = 100,
  ): Observable<ApiResponse<PaginatedResponse<EventAttendanceRowDto>>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('page_size', pageSize.toString());

    return this.http.get<ApiResponse<PaginatedResponse<EventAttendanceRowDto>>>(
      `${this.EVENTS_BASE}/${eventId}/attendance/`,
      { params },
    );
  }

  /** POST /api/attendance/check-in/ */
  checkIn(registrationId: string): Observable<ApiResponse<AttendanceDto>> {
    return this.http.post<ApiResponse<AttendanceDto>>(
      `${this.BASE}/check-in/`,
      { registration_id: registrationId },
    );
  }

  /** POST /api/attendance/mark-absent/ */
  markAbsent(registrationId: string): Observable<ApiResponse<AttendanceDto>> {
    return this.http.post<ApiResponse<AttendanceDto>>(
      `${this.BASE}/mark-absent/`,
      { registration_id: registrationId },
    );
  }
}
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { OrganizerStatisticsDto } from './dashboard.service';
import { TicketTypeDto } from './ticket-type.service';

export interface AttendanceStatsDto {
  total_registered: number;
  present: number;
  absent: number;
  not_checked_in: number;
  attendance_rate: number;
  manual_check_ins: number;
  qr_check_ins: number;
  check_ins_by_hour: { hour: string; count: number }[];
}

@Injectable({ providedIn: 'root' })
export class StatisticsService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /**
   * GET /api/dashboard/organizer/statistics/
   * Renvoie les séries temporelles filtrées par événement.
   */
  getOrganizerStatistics(
    eventId: string,
    period: 'last_7_days' | 'last_30_days' | 'last_12_months' | 'custom',
    startDate?: string,
    endDate?: string,
  ): Observable<ApiResponse<OrganizerStatisticsDto>> {
    let params = new HttpParams().set('event_id', eventId);

    if (period === 'custom' && startDate && endDate) {
      params = params.set('start_date', startDate).set('end_date', endDate);
    } else {
      params = params.set('period', period);
    }

    return this.http.get<ApiResponse<OrganizerStatisticsDto>>(
      `${this.BASE}/dashboard/organizer/statistics/`,
      { params },
    );
  }

  /** GET /api/events/{id}/ticket-types/ (vue organisateur) */
  getTicketTypes(eventId: string): Observable<ApiResponse<TicketTypeDto[]>> {
    return this.http.get<ApiResponse<TicketTypeDto[]>>(
      `${this.BASE}/events/${eventId}/ticket-types/`,
    );
  }

  /** GET /api/events/{id}/attendance/stats/ */
  getAttendanceStats(eventId: string): Observable<ApiResponse<AttendanceStatsDto>> {
    return this.http.get<ApiResponse<AttendanceStatsDto>>(
      `${this.BASE}/events/${eventId}/attendance/stats/`,
    );
  }
}
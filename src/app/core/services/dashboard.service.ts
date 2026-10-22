import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

/* ------------------------------------------------------------------
   DTOs — alignés sur les serializers backend
   ------------------------------------------------------------------ */

export interface OrganizerSummaryDto {
  total_events: number;
  published_events: number;
  upcoming_events: number;
  completed_events: number;
  draft_events: number;
  cancelled_events: number;
  total_registrations: number;
  active_registrations: number;
  pending_registrations: number;
  confirmed_registrations: number;
  cancelled_registrations: number;
  active_unique_participants: number;
}

export interface OrganizerCapacityDto {
  type: 'LIMITED' | 'UNLIMITED';
  limit: number | null;
  occupied: number;
  remaining: number | null;
  fill_rate: number | null;
}

export interface OrganizerUpcomingEventDto {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  format: 'IN_PERSON' | 'ONLINE' | 'HYBRID';
  participation_type: 'FREE' | 'PAID';
  city: string;
  venue_name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  pending_registrations_count: number;
  confirmed_registrations_count: number;
  capacity: OrganizerCapacityDto;
}

export interface OrganizerRecentRegistrationDto {
  reference: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  registered_at: string;
  participant_name: string;
  event: { id: string; title: string; start_at: string };
}

export interface OrganizerDashboardDto {
  summary: OrganizerSummaryDto;
  upcoming_events: OrganizerUpcomingEventDto[];
  recent_registrations: OrganizerRecentRegistrationDto[];
  payment_statistics_available: boolean;
  financial_statistics: any | null;
}

export interface StatisticsPeriodDto {
  start_date: string;
  end_date: string;
  granularity: 'day' | 'month';
  timezone: string;
}

export interface TimeSeriesPointDto {
  period: string;
  count: number;
}

export interface StatusCountDto {
  status: string;
  count: number;
}

export interface FormatCountDto {
  format: string;
  count: number;
}

export interface OrganizerStatisticsDto {
  period: StatisticsPeriodDto;
  events_created_over_time: TimeSeriesPointDto[];
  registrations_over_time: TimeSeriesPointDto[];
  events_by_status: StatusCountDto[];
  events_by_format: FormatCountDto[];
  registrations_by_status: StatusCountDto[];
  payment_statistics_available: boolean;
  financial_statistics: any | null;
}

/* ------------------------------------------------------------------
   Périodes côté frontend
   ------------------------------------------------------------------ */
export type ChartPeriod = 'last_30_days' | 'last_6_months' | 'last_12_months';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/dashboard`;

  /** GET /api/dashboard/organizer/ */
  getOrganizerDashboard(): Observable<ApiResponse<OrganizerDashboardDto>> {
    return this.http.get<ApiResponse<OrganizerDashboardDto>>(`${this.BASE}/organizer/`);
  }

  /** GET /api/dashboard/organizer/statistics/?period=… */
  getOrganizerStatistics(period: ChartPeriod): Observable<ApiResponse<OrganizerStatisticsDto>> {
    let params = new HttpParams();

    if (period === 'last_30_days' || period === 'last_12_months') {
      params = params.set('period', period);
    } else {
      // last_6_months → custom range 180 jours
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 180);
      params = params
        .set('start_date', start.toISOString().slice(0, 10))
        .set('end_date', end.toISOString().slice(0, 10));
    }

    return this.http.get<ApiResponse<OrganizerStatisticsDto>>(
      `${this.BASE}/organizer/statistics/`,
      { params },
    );
  }
}
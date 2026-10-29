import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, OperatorFunction, catchError, forkJoin, map, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  AdminDashboardDto,
  AdminOrganizerDetail,
  AdminOrganizerDto,
  AdminOrganizerFilters,
  AdminOrganizerList,
  AdminOrganizerStats,
  AdminUserDto,
  AdminUserFilters,
  AdminUserList,
  OrganizerAction,
  OrganizerActionPayload,
} from '../models/admin.model';
import { ApiResponse } from '../models/api-response.model';
import { AppLoggerService } from './app-logger.service';

/* ------------------------------------------------------------------
 * Endpoints backend (alignés sur apps/supervision/urls.py)
 * ------------------------------------------------------------------ */
const SUPERVISION_USERS = 'supervision/users/';
const SUPERVISION_ORGANIZERS = 'supervision/organizers/';
const ADMIN_DASHBOARD = 'admin/supervision/';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly logger = inject(AppLoggerService);
  private readonly baseUrl = environment.apiUrl;

  /* ==================================================================
   * Dashboard admin
   * ================================================================== */
  getDashboard(days: number): Observable<ApiResponse<AdminDashboardDto>> {
    const params = new HttpParams().set('days', String(days));
    return this.http
      .get<ApiResponse<AdminDashboardDto>>(`${this.baseUrl}/${ADMIN_DASHBOARD}`, { params })
      .pipe(this.failWith('Chargement du dashboard admin'));
  }

  /* ==================================================================
   * Utilisateurs
   * ================================================================== */
  listUsers(filters: AdminUserFilters): Observable<ApiResponse<AdminUserList>> {
    let params = new HttpParams()
      .set('page', String(filters.page))
      .set('page_size', String(filters.pageSize));

    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    if (filters.role) params = params.set('role', filters.role);
    if (filters.isActive !== null && filters.isActive !== undefined) {
      params = params.set('is_active', String(filters.isActive));
    }
    if (filters.joinedFrom) params = params.set('joined_from', filters.joinedFrom);
    if (filters.joinedTo) params = params.set('joined_to', filters.joinedTo);
    if (filters.ordering) params = params.set('ordering', filters.ordering);

    return this.http
      .get<ApiResponse<AdminUserList>>(`${this.baseUrl}/${SUPERVISION_USERS}`, { params })
      .pipe(this.failWith('Chargement des utilisateurs'));
  }

  suspendUser(userId: string, reason: string): Observable<ApiResponse<AdminUserDto>> {
    return this.http
      .post<ApiResponse<AdminUserDto>>(
        `${this.baseUrl}/${SUPERVISION_USERS}${encodeURIComponent(userId)}/suspend/`,
        { reason },
      )
      .pipe(this.failWith('Suspension de l’utilisateur'));
  }

  activateUser(userId: string, reason: string): Observable<ApiResponse<AdminUserDto>> {
    return this.http
      .post<ApiResponse<AdminUserDto>>(
        `${this.baseUrl}/${SUPERVISION_USERS}${encodeURIComponent(userId)}/activate/`,
        { reason },
      )
      .pipe(this.failWith('Activation de l’utilisateur'));
  }

  /* ==================================================================
   * Organisateurs
   * ================================================================== */
  listOrganizers(filters: AdminOrganizerFilters): Observable<ApiResponse<AdminOrganizerList>> {
    let params = new HttpParams()
      .set('page', String(filters.page))
      .set('page_size', String(filters.pageSize));

    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    if (filters.is_active !== null && filters.is_active !== undefined) {
      params = params.set('is_active', String(filters.is_active));
    }
    if (filters.ordering) params = params.set('ordering', filters.ordering);

    return this.http
      .get<ApiResponse<AdminOrganizerList>>(`${this.baseUrl}/${SUPERVISION_ORGANIZERS}`, { params })
      .pipe(
        map((response) => {
          if (!response.data) return response;
          const stats: AdminOrganizerStats = {
            total: response.data.count,
            active: response.data.results.filter((o) => o.is_active).length,
            suspended: response.data.results.filter((o) => !o.is_active).length,
            with_events: response.data.results.filter((o) => o.events_total > 0).length,
            without_events: response.data.results.filter((o) => o.events_total === 0).length,
          };
          return { ...response, data: { ...response.data, stats } };
        }),
        this.failWith('Chargement des organisateurs'),
      );
  }

  getOrganizerDetail(id: string): Observable<ApiResponse<AdminOrganizerDetail>> {
    return this.http
      .get<ApiResponse<AdminOrganizerDto>>(
        `${this.baseUrl}/${SUPERVISION_ORGANIZERS}${encodeURIComponent(id)}/`,
      )
      .pipe(
        map((response) => ({
          ...response,
          data: response.data
            ? { organizer: response.data, recent_events: [] }
            : undefined,
        })),
        this.failWith('Chargement de la fiche organisateur'),
      );
  }

  updateOrganizerStatus(
    id: string,
    action: OrganizerAction,
    payload: OrganizerActionPayload,
  ): Observable<ApiResponse<AdminOrganizerDto>> {
    const endpoint = action === 'suspend' ? 'suspend' : 'activate';
    return this.http
      .post<ApiResponse<AdminOrganizerDto>>(
        `${this.baseUrl}/${SUPERVISION_USERS}${encodeURIComponent(id)}/${endpoint}/`,
        { reason: payload.reason },
      )
      .pipe(this.failWith(`Organisateur : ${action}`));
  }

  bulkUpdateOrganizers(
    ids: string[],
    action: OrganizerAction,
    payload: OrganizerActionPayload,
  ): Observable<ApiResponse<{ updated: number }>> {
    const calls = ids.map((id) => this.updateOrganizerStatus(id, action, payload));
    return forkJoin(calls).pipe(
      map((responses) => ({
        success: true,
        message: 'Action groupée appliquée.',
        data: { updated: responses.filter((r) => r.success).length },
      })),
      this.failWith(`Organisateurs : ${action} groupé`),
    );
  }

  exportOrganizers(filters: AdminOrganizerFilters): Observable<Blob> {
    return this.listOrganizers({ ...filters, page: 1, pageSize: 10_000 }).pipe(
      map((response) => {
        const rows = response.data?.results ?? [];
        const lines = [
          ['Nom', 'E-mail', 'Téléphone', 'Statut', 'Événements', 'Inscriptions', 'Inscrit le'],
          ...rows.map((o) => [
            o.full_name,
            o.email,
            o.phone,
            o.is_active ? 'Actif' : 'Suspendu',
            String(o.events_total),
            String(o.registrations_confirmed),
            o.created_at.slice(0, 10),
          ]),
        ].map((row) => row.map(csvCell).join(';'));

        return new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      }),
      this.failWith('Export des organisateurs'),
    );
  }

  /* ==================================================================
   * Utilitaire d'erreur
   * ================================================================== */
  private failWith<T>(operation: string): OperatorFunction<T, T> {
    return catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        this.logger.error(`${operation} : échec HTTP.`, { status: error.status });
      } else {
        this.logger.error(`${operation} : erreur inattendue.`);
      }
      return throwError(() => error);
    });
  }
}

const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};
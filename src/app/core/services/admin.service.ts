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
<<<<<<< HEAD
  AdminUserDto,
  AdminUserFilters,
  AdminUserList,
=======
  AdminOrganizerStats,
>>>>>>> 726ec0ec69c7d6b2fea4babc70a9d83b16032fda
  OrganizerAction,
  OrganizerActionPayload,
} from '../models/admin.model';
import { ApiResponse } from '../models/api-response.model';
import { AppLoggerService } from './app-logger.service';

const SUPERVISION_ORGANIZERS_PATH = 'supervision/organizers/';
const SUPERVISION_USERS_PATH = 'supervision/users/';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly logger = inject(AppLoggerService);
  private readonly baseUrl = environment.apiUrl;
    listUsers(
    filters: AdminUserFilters,
  ): Observable<ApiResponse<AdminUserList>> {
    let params = new HttpParams();

    const entries: [
      string,
      string | number | boolean | null | undefined,
    ][] = [
      ['page', filters.page],
      ['page_size', filters.pageSize],
      ['search', filters.search?.trim()],
      ['role', filters.role],
      ['is_active', filters.isActive],
      ['joined_from', filters.joinedFrom],
      ['joined_to', filters.joinedTo],
      ['ordering', filters.ordering],
    ];

    for (const [key, value] of entries) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http
      .get<ApiResponse<AdminUserList>>(
        `${this.baseUrl}/supervision/users/`,
        { params },
      )
      .pipe(this.failWith('Chargement des utilisateurs'));
  }
  
  suspendUser(userId: string, reason: string) {
    return this.http.post(
      `${this.baseUrl}/supervision/users/${userId}/suspend/`,
      { reason },
    ).pipe(this.failWith('Suspension de l’utilisateur'));
  }

  activateUser(userId: string, reason: string) {
    return this.http.post(
      `${this.baseUrl}/supervision/users/${userId}/activate/`,
      { reason },
    ).pipe(this.failWith('Activation de l’utilisateur'));
  }


  /* ------------------------------------------------------------------
   * Dashboard admin — GET /api/admin/supervision/?days=30
   * ------------------------------------------------------------------ */
  getDashboard(days: number): Observable<ApiResponse<AdminDashboardDto>> {
    const params = new HttpParams().set('days', String(days));
    return this.http
      .get<ApiResponse<AdminDashboardDto>>(`${this.baseUrl}/admin/supervision/`, { params })
      .pipe(this.failWith('Chargement du dashboard admin'));
  }

  /* ------------------------------------------------------------------
   * Liste paginée des organisateurs
   * ------------------------------------------------------------------ */
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
      .get<ApiResponse<AdminOrganizerList>>(`${this.baseUrl}/${SUPERVISION_ORGANIZERS_PATH}`, { params })
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

  /* ------------------------------------------------------------------
   * Fiche d'un organisateur
   * GET /api/supervision/organizers/{id}/
   * ------------------------------------------------------------------ */
  getOrganizerDetail(id: string): Observable<ApiResponse<AdminOrganizerDetail>> {
    return this.http
      .get<ApiResponse<AdminOrganizerDto>>(
        `${this.baseUrl}/${SUPERVISION_ORGANIZERS_PATH}${encodeURIComponent(id)}/`,
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

  /* ------------------------------------------------------------------
   * Actions : suspendre / réactiver
   * ------------------------------------------------------------------ */
  updateOrganizerStatus(
    id: string,
    action: OrganizerAction,
    payload: OrganizerActionPayload,
  ): Observable<ApiResponse<AdminOrganizerDto>> {
    const endpoint = action === 'suspend' ? 'suspend' : 'activate';
    return this.http
      .post<ApiResponse<AdminOrganizerDto>>(
        `${this.baseUrl}/${SUPERVISION_USERS_PATH}${encodeURIComponent(id)}/${endpoint}/`,
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

  /* ------------------------------------------------------------------
   * Export CSV
   * ------------------------------------------------------------------ */
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
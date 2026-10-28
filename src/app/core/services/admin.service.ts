import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, OperatorFunction, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  AdminDashboardDto,
  AdminOrganizerDetail,
  AdminOrganizerDto,
  AdminOrganizerFilters,
  AdminOrganizerList,
  AdminUserDto,
  AdminUserFilters,
  AdminUserList,
  OrganizerAction,
  OrganizerActionPayload,
} from '../models/admin.model';
import { ApiResponse } from '../models/api-response.model';
import { AppLoggerService } from './app-logger.service';

/**
 * true  : les pages admin utilisent des données de démonstration (aucun appel réseau).
 * false : elles appellent le backend.
 */
const USE_MOCK_DATA = false;

/**
 * Chemin backend qui expose le dashboard de supervision.
 * L'URL finale est `${environment.apiUrl}/admin/supervision/`.
 */
const ADMIN_SUPERVISION_PATH = 'admin/supervision/';

/**
 * Noms des paramètres attendus par le backend pour la liste des organisateurs.
 */
const ORGANIZER_QUERY_PARAMS = {
  page: 'page',
  pageSize: 'page_size',
  search: 'search',
  status: 'status',
  activity: 'activity',
  joinedAfter: 'joined_after',
  ordering: 'ordering',
} as const;

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


  getDashboard(days: number): Observable<ApiResponse<AdminDashboardDto>> {
    const params = new HttpParams().set('days', String(days));
    return this.http
      .get<ApiResponse<AdminDashboardDto>>(`${this.baseUrl}/${ADMIN_SUPERVISION_PATH}`, { params })
      .pipe(this.failWith('Chargement du dashboard admin'));
  }

  listOrganizers(filters: AdminOrganizerFilters): Observable<ApiResponse<AdminOrganizerList>> {
    return this.http
      .get<ApiResponse<AdminOrganizerList>>(`${this.baseUrl}/admin/organizers/`, {
        params: this.organizerParams(filters),
      })
      .pipe(this.failWith('Chargement des organisateurs'));
  }

  getOrganizerDetail(id: string): Observable<ApiResponse<AdminOrganizerDetail>> {
    return this.http
      .get<ApiResponse<AdminOrganizerDetail>>(`${this.baseUrl}/admin/organizers/${encodeURIComponent(id)}/`)
      .pipe(this.failWith('Chargement de la fiche organisateur'));
  }

  updateOrganizerStatus(
    id: string,
    action: OrganizerAction,
    payload: OrganizerActionPayload = {},
  ): Observable<ApiResponse<AdminOrganizerDto>> {
    return this.http
      .post<ApiResponse<AdminOrganizerDto>>(
        `${this.baseUrl}/admin/organizers/${encodeURIComponent(id)}/${action}/`,
        payload,
      )
      .pipe(this.failWith(`Organisateur : action « ${action} »`));
  }

  bulkUpdateOrganizers(
    ids: string[],
    action: OrganizerAction,
    payload: OrganizerActionPayload = {},
  ): Observable<ApiResponse<{ updated: number }>> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(`${this.baseUrl}/admin/organizers/bulk-action/`, {
        ids,
        action,
        ...payload,
      })
      .pipe(this.failWith(`Organisateurs : action groupée « ${action} »`));
  }

  exportOrganizers(filters: AdminOrganizerFilters): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}/admin/organizers/export/`, {
        params: this.organizerParams(filters),
        responseType: 'blob',
      })
      .pipe(this.failWith('Export des organisateurs'));
  }

  private organizerParams(filters: AdminOrganizerFilters): HttpParams {
    const entries: [keyof typeof ORGANIZER_QUERY_PARAMS, string | number | null | undefined][] = [
      ['page', filters.page],
      ['pageSize', filters.pageSize],
      ['search', filters.search?.trim()],
      ['status', filters.status],
      ['activity', filters.activity],
      ['joinedAfter', filters.joinedAfter],
      ['ordering', filters.ordering],
    ];

    let params = new HttpParams();
    for (const [key, value] of entries) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(ORGANIZER_QUERY_PARAMS[key], String(value));
      }
    }
    return params;
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
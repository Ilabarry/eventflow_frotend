import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';
import {
  AuditLogDto,
  AuditResult,
  SupervisionAlertDto,
  SupervisionCategoryDto,
  SupervisionDashboardDto,
  SupervisionEventDetailDto,
  SupervisionEventDto,
  SupervisionEventFilters,
} from '../models/supervision.model';

/** Taille maximale d'une page côté backend (StandardPagination). */
const MAX_PAGE_SIZE = 50;

/**
 * Appels HTTP du module Supervision (/api/supervision/...).
 * Le backend vérifie lui-même que l'utilisateur est administrateur.
 */
@Injectable({ providedIn: 'root' })
export class SupervisionService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/supervision`;

  /** GET /api/supervision/dashboard/ — compteurs globaux de la plateforme. */
  getDashboard(): Observable<ApiResponse<SupervisionDashboardDto>> {
    return this.http.get<ApiResponse<SupervisionDashboardDto>>(`${this.BASE}/dashboard/`);
  }

  /** GET /api/supervision/events/ — tous les événements, brouillons compris. */
  listEvents(filters: SupervisionEventFilters): Observable<ApiResponse<PaginatedResponse<SupervisionEventDto>>> {
    const values: Record<string, string | number | null | undefined> = {
      page: filters.page,
      page_size: filters.pageSize,
      search: filters.search?.trim(),
      status: filters.status,
      format: filters.format,
      category: filters.category,
      starts_from: filters.startsFrom,
      starts_to: filters.startsTo,
      ordering: '-start_at',
    };

    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<ApiResponse<PaginatedResponse<SupervisionEventDto>>>(`${this.BASE}/events/`, { params });
  }

  /** GET /api/supervision/events/{id}/ — fiche détaillée avec les compteurs. */
  getEvent(id: string): Observable<ApiResponse<SupervisionEventDetailDto>> {
    return this.http.get<ApiResponse<SupervisionEventDetailDto>>(`${this.BASE}/events/${encodeURIComponent(id)}/`);
  }

  /**
   * POST /api/supervision/events/{id}/cancel/ — annulation pour modération.
   * Le motif est obligatoire et conservé dans le journal d'audit.
   */
  cancelEvent(id: string, reason: string): Observable<ApiResponse<SupervisionEventDetailDto>> {
    return this.http.post<ApiResponse<SupervisionEventDetailDto>>(
      `${this.BASE}/events/${encodeURIComponent(id)}/cancel/`,
      { reason: reason.trim() },
    );
  }

  /** GET /api/supervision/categories/ — pour le filtre « Catégorie » (actives et inactives). */
  listCategories(): Observable<ApiResponse<PaginatedResponse<SupervisionCategoryDto>>> {
    const params = new HttpParams().set('page_size', MAX_PAGE_SIZE).set('ordering', 'name');
    return this.http.get<ApiResponse<PaginatedResponse<SupervisionCategoryDto>>>(`${this.BASE}/categories/`, {
      params,
    });
  }

  /** GET /api/supervision/alerts/ — situations qui demandent l'attention de l'admin. */
  listAlerts(): Observable<ApiResponse<SupervisionAlertDto[]>> {
    return this.http.get<ApiResponse<SupervisionAlertDto[]>>(`${this.BASE}/alerts/`);
  }

  /** GET /api/supervision/audit-logs/ — journal des actions, les plus récentes d'abord. */
  listAuditLogs(
    page: number,
    pageSize: number,
    result: AuditResult | null = null,
  ): Observable<ApiResponse<PaginatedResponse<AuditLogDto>>> {
    let params = new HttpParams().set('page', page).set('page_size', pageSize);
    if (result) {
      params = params.set('result', result);
    }
    return this.http.get<ApiResponse<PaginatedResponse<AuditLogDto>>>(`${this.BASE}/audit-logs/`, { params });
  }
}

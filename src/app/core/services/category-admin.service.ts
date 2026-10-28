import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, OperatorFunction, catchError, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  CategoryWritePayload,
  SupervisionCategoryDto,
  SupervisionCategoryFilters,
  SupervisionCategoryList,
} from '../models/supervision-category.model';

/**
 * Catégories — périmètre ADMINISTRATION.
 *
 * Fichier AJOUTÉ, volontairement séparé de `CategoryService` : celui-ci sert la
 * liste PUBLIQUE (`GET /api/categories/`, non paginée) et est consommé par
 * « créer événement » et « modifier événement ». Y ajouter des méthodes aurait
 * été une modification de code existant — ici rien n'est touché, tout est ajouté.
 *
 * Contrat vérifié sur le backend (`apps/supervision/`), routes réelles :
 *   GET|POST     /api/supervision/categories/
 *   GET|PATCH|DELETE /api/supervision/categories/{id}/
 *   POST         /api/supervision/categories/{id}/activate/     (corps { reason })
 *   POST         /api/supervision/categories/{id}/deactivate/   (corps { reason })
 */
const ADMIN_PATH = 'supervision/categories';

/** Noms des paramètres réellement acceptés par `SupervisionCategoryFilter`. */
const ADMIN_QUERY = {
  page: 'page',
  pageSize: 'page_size',
  search: 'search',
  isActive: 'is_active',
  ordering: 'ordering',
} as const;

@Injectable({ providedIn: 'root' })
export class CategoryAdminService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/${ADMIN_PATH}`;

  /** GET /api/supervision/categories/ — page filtrée + triée + paginée. */
  listPage(filters: SupervisionCategoryFilters): Observable<ApiResponse<SupervisionCategoryList>> {
    return this.http
      .get<ApiResponse<SupervisionCategoryList>>(`${this.BASE}/`, { params: this.toParams(filters) })
      .pipe(this.failWith('Chargement des catégories'));
  }

  /** POST — 201 « Catégorie créée. », ou 400 (nom invalidé) / 409 (slug en conflit). */
  create(payload: CategoryWritePayload): Observable<ApiResponse<SupervisionCategoryDto>> {
    return this.http
      .post<ApiResponse<SupervisionCategoryDto>>(`${this.BASE}/`, payload)
      .pipe(this.failWith('Création d’une catégorie'));
  }

  /**
   * PATCH — seuls les champs envoyés sont modifiés ; le backend consigne
   * l'avant/après dans le journal d'audit. `slug` est en lecture seule.
   */
  update(id: string, payload: Partial<CategoryWritePayload>): Observable<ApiResponse<SupervisionCategoryDto>> {
    return this.http
      .patch<ApiResponse<SupervisionCategoryDto>>(`${this.BASE}/${encodeURIComponent(id)}/`, payload)
      .pipe(this.failWith('Modification de la catégorie'));
  }

  /**
   * DELETE — 200 « Catégorie supprimée. », ou 409 si au moins un événement
   * l'utilise (protection en base) : dans ce cas la désactivation est la sortie
   * prévue par le contrat.
   */
  remove(id: string): Observable<ApiResponse<null>> {
    return this.http
      .delete<ApiResponse<null>>(`${this.BASE}/${encodeURIComponent(id)}/`)
      .pipe(this.failWith('Suppression de la catégorie'));
  }

  /**
   * activate / deactivate — `reason` est OBLIGATOIRE côté backend (min. 5
   * caractères, conservé à l'audit) : une action d'état sans motif est refusée
   * en 400, et un changement vers l'état déjà atteint répond 409.
   */
  setActive(id: string, active: boolean, reason: string): Observable<ApiResponse<SupervisionCategoryDto>> {
    return this.http
      .post<ApiResponse<SupervisionCategoryDto>>(
        `${this.BASE}/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}/`,
        { reason },
      )
      .pipe(this.failWith(active ? 'Réactivation de la catégorie' : 'Désactivation de la catégorie'));
  }

  // ------------------------------------------------------------------

  private toParams(filters: SupervisionCategoryFilters): HttpParams {
    const entries: [keyof typeof ADMIN_QUERY, string | number | null | undefined][] = [
      ['page', filters.page],
      ['pageSize', filters.pageSize],
      ['search', filters.search?.trim()],
      // `false` est une valeur SIGNIFICATIVE (les inactives) : on ne saute que
      // null / undefined / '', jamais un `if (value)` tout-court.
      [
        'isActive',
        filters.isActive === null || filters.isActive === undefined ? undefined : String(filters.isActive),
      ],
      ['ordering', filters.ordering],
    ];

    let params = new HttpParams();
    for (const [key, value] of entries) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(ADMIN_QUERY[key], String(value));
      }
    }
    return params;
  }

  /** Trace l'échec et le relance : l'`error.interceptor` déjà en place montre le message à l'utilisateur. */
  private failWith<T>(operation: string): OperatorFunction<T, T> {
    return catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        console.error(`[EVENTFLOW] ${operation} : échec HTTP.`, { status: error.status });
      } else {
        console.error(`[EVENTFLOW] ${operation} : erreur inattendue.`);
      }
      return throwError(() => error);
    });
  }
}
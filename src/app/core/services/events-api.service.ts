import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';
import {
  BackendEvent,
  EventCategory,
  EventDetail,
  EventQueryParams,
} from '../models/event.model';
import { AppLoggerService } from './app-logger.service';

/**
 * Centralise les requêtes HTTP relatives aux événements publics.
 *
 * La pagination, le filtrage et le tri sont délégués au backend Django
 * (EventFilter + EventPagination) : le frontend ne fait que transmettre
 * les paramètres et afficher la page reçue.
 */
@Injectable({
  providedIn: 'root',
})
export class EventsApiService {
  private readonly http = inject(HttpClient);
  private readonly logger = inject(AppLoggerService);

  private readonly baseUrl = environment.apiUrl;

  /**
   * Récupère une page d'événements filtrée et triée par le backend.
   *
   * @param params Filtres, tri et pagination (optionnels).
   */
  getEvents(
    params: EventQueryParams = {},
  ): Observable<ApiResponse<PaginatedResponse<BackendEvent>>> {
    const url = `${this.baseUrl}/events/`;
    const httpParams = this.buildHttpParams(params);

    this.logger.debug('Chargement de la liste des événements.', {
      params: httpParams.toString(),
    });

    return this.http
      .get<ApiResponse<PaginatedResponse<BackendEvent>>>(url, { params: httpParams })
      .pipe(
        tap((response) => {
          this.logger.info('Réponse de la liste des événements reçue.', {
            success: response.success,
            count: response.data?.count ?? 0,
            page: response.data?.current_page ?? 1,
          });
        }),
        catchError((error: unknown) => {
          this.logHttpError('Chargement des événements', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Récupère les catégories actives utilisées dans les filtres.
   */
  getCategories(): Observable<ApiResponse<EventCategory[]>> {
    const url = `${this.baseUrl}/categories/`;

    this.logger.debug('Chargement des catégories.');

    return this.http
      .get<ApiResponse<EventCategory[]>>(url)
      .pipe(
        tap((response) => {
          this.logger.info('Réponse des catégories reçue.', {
            success: response.success,
            count: response.data?.length ?? 0,
          });
        }),
        catchError((error: unknown) => {
          this.logHttpError('Chargement des catégories', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Récupère le détail d'un événement public.
   * À vérifier : l'identifiant utilisé par ton backend (id, slug ou uuid).
   */
  getEventById(id: string): Observable<ApiResponse<EventDetail>> {
    const url = `${this.baseUrl}/events/${encodeURIComponent(id)}/`;

    this.logger.debug('Chargement du détail d’un événement.');

    return this.http.get<ApiResponse<EventDetail>>(url).pipe(
      catchError((error: unknown) => {
        this.logHttpError('Chargement du détail de l’événement', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Convertit un objet de paramètres en HttpParams en ignorant
   * les valeurs vides (null, undefined, chaîne vide).
   */
  private buildHttpParams(params: EventQueryParams): HttpParams {
    let httpParams = new HttpParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      httpParams = httpParams.set(key, String(value));
    });

    return httpParams;
  }

  /**
   * Journalise uniquement le contexte technique nécessaire au diagnostic.
   * L'intercepteur HTTP conserve la responsabilité des messages utilisateur.
   */
  private logHttpError(operation: string, error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      this.logger.error(`${operation} : échec HTTP.`, {
        status: error.status,
      });
      return;
    }

    this.logger.error(`${operation} : erreur inattendue.`);
  }
}
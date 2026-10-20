/**
 * Enveloppe standardisée des réponses backend EVENTFLOW.
 *
 * Succès :
 *   { "success": true, "message": "...", "data": {...} }
 *
 * Erreur :
 *   { "success": false, "message": "...", "errors": {...} }
 */

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  errors?: ApiErrors;
}

export interface ApiErrors {
  [field: string]: string[] | string;
}

/**
 * Réponse paginée (DRF PageNumberPagination).
 */
export interface PaginatedResponse<T> {
  count: number;
  total_pages: number;
  current_page: number;
  page_size: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
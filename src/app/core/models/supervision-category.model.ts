/**
 * Types de la page « Catégories » de l'administration.
 *
 * Source de vérité : le backend, `apps/supervision/serializers.py`
 * (`SupervisionCategorySerializer`, `SupervisionCategoryWriteSerializer`) et
 * `apps/supervision/filters.py` (`SupervisionCategoryFilter`).
 * Ces interfaces sont alignées champ par champ : pas de champ « confort »
 * inventé par le frontend — un champ qui n'existe pas côté API est un champ
 * qui casse au premier renommage côté back.
 *
 * Routes concernnées (préfixe `environment.apiUrl` = /api) :
 *   GET|POST           /supervision/categories/
 *   GET|PATCH|DELETE   /supervision/categories/{id}/
 *   POST               /supervision/categories/{id}/activate/     (corps { reason })
 *   POST               /supervision/categories/{id}/deactivate/   (corps { reason })
 */

/** Ligne renvoyée par `SupervisionCategorySerializer`. */
export interface SupervisionCategoryDto {
  id: string;
  name: string;
  /** Généré par le backend à partir du nom : lecture seule côté front. */
  slug: string;
  description: string;
  /**
   * Nom d'icône (max 100), pas une image : le backend documente « ex: 'tech',
   * 'music' ». On accepte aussi bien un mot-clé qu'une URL déjà stockée par une
   * autre page — le composant décide comment le rendre.
   */
  icon: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Compteurs annotés par le selector (tous statuts / publiés seulement). */
  events_total: number;
  events_published: number;
}

/** Corps de `paginated_response()` du module Supervision. */
export interface SupervisionCategoryList {
  count: number;
  total_pages: number;
  current_page: number;
  page_size: number;
  next: string | null;
  previous: string | null;
  results: SupervisionCategoryDto[];
}

/** Champs modifiables (`SupervisionCategoryWriteSerializer`). */
export interface CategoryWritePayload {
  name: string;
  description?: string;
  icon?: string;
}

/** Clés réellement acceptées par le filtre backend. */
export interface SupervisionCategoryFilters {
  page: number;
  pageSize: number;
  search?: string | null;
  /** null = « Tous » : le paramètre n'est PAS envoyé (pas de valeur « les deux » au back). */
  isActive?: boolean | null;
  /** name | created_at | events_total, préfixé par « - » pour le sens décroissant. */
  ordering?: string | null;
}

/** Bornes reprises du backend (mêmes nombres, un seul endroit où les lire). */
export const CATEGORY_NAME_MAX = 100;
export const CATEGORY_ICON_MAX = 100;
/** `REASON_MIN_LENGTH` / `REASON_MAX_LENGTH` de `apps/supervision/constants.py`. */
export const CATEGORY_REASON_MIN = 5;
export const CATEGORY_REASON_MAX = 500;
/** `StandardPagination.max_page_size` : demander plus est ramené à 50 par le back. */
export const CATEGORY_MAX_PAGE_SIZE = 50;

/** Erreurs de champ renvoyées par l'enveloppe `{ success: false, errors }`. */
export type CategoryFieldErrors = Partial<Record<keyof CategoryWritePayload | 'detail', string[]>>;
/**
 * Modèles du module Supervision (backend : apps/supervision/serializers.py).
 * Routes : /api/supervision/...  (réservées aux administrateurs).
 */
import { CapacityType, EventFormat, EventStatus, ParticipationType } from './event.model';

/* ------------------------------------------------------------------
 * Dashboard — GET /api/supervision/dashboard/ (DashboardSerializer)
 * ------------------------------------------------------------------ */
export interface SupervisionDashboardDto {
  generated_at: string;
  users: {
    total: number;
    active: number;
    suspended: number;
    participants: number;
    organizers: number;
    admins: number;
    new_last_30_days: number;
  };
  events: {
    total: number;
    draft: number;
    published: number;
    completed: number;
    cancelled: number;
    /** Publiés et pas encore commencés. */
    upcoming: number;
  };
  registrations: { total: number; pending: number; confirmed: number; cancelled: number };
  attendance: { present: number; absent: number; expected: number; attendance_rate: number };
  categories: { total: number; active: number; inactive: number };
  audit: { actions_last_7_days: number; denied_last_7_days: number };
}

/* ------------------------------------------------------------------
 * Événements — GET /api/supervision/events/ (SupervisionEventSerializer)
 * access_url n'est jamais exposé à l'administrateur.
 * ------------------------------------------------------------------ */
export interface SupervisionEventDto {
  id: string;
  title: string;
  /** URL complète de l'affiche, ou null. */
  cover_image: string | null;
  status: EventStatus;
  status_label: string;
  format: EventFormat;
  participation_type: ParticipationType;
  start_at: string;
  end_at: string;
  city: string;
  venue_name: string;
  capacity_type: CapacityType;
  capacity_limit: number | null;
  organizer_id: string;
  organizer_email: string;
  organizer_name: string;
  category_id: string | null;
  category_name: string | null;
  published_at: string | null;
  created_at: string;
  registrations_confirmed: number;
  attendances_present: number;
}

/** GET /api/supervision/events/{id}/ (SupervisionEventDetailSerializer) */
export interface SupervisionEventDetailDto extends SupervisionEventDto {
  short_description: string;
  updated_at: string;
  registrations_pending: number;
  registrations_cancelled: number;
}

/** Filtres de SupervisionEventFilter (apps/supervision/filters.py). */
export interface SupervisionEventFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: EventStatus | null;
  format?: EventFormat | null;
  category?: string | null;
  /** AAAA-MM-JJ, bornes incluses, sur la date de début. */
  startsFrom?: string | null;
  startsTo?: string | null;
}

/* ------------------------------------------------------------------
 * Catégories — GET /api/supervision/categories/ (SupervisionCategorySerializer)
 * ------------------------------------------------------------------ */
export interface SupervisionCategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  events_total: number;
  events_published: number;
}

/** Longueur du motif exigé par ReasonSerializer (supervision/constants.py). */
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 500;

/* ------------------------------------------------------------------
 * Alertes — GET /api/supervision/alerts/ (AlertSerializer)
 * Calculées en temps réel : seules les alertes déclenchées sont renvoyées,
 * les plus graves d'abord.
 * ------------------------------------------------------------------ */
export type AlertLevel = 'CRITICAL' | 'WARNING' | 'INFO';

/** Codes produits par get_alerts() (supervision/dashboard_selectors.py). */
export type AlertCode =
  | 'SECURITY_DENIALS'
  | 'ENDED_EVENTS_STILL_PUBLISHED'
  | 'STALE_PENDING_REGISTRATIONS'
  | 'UPCOMING_EVENTS_WITHOUT_REGISTRATIONS'
  | 'SUSPENDED_ACCOUNTS';

export interface SupervisionAlertDto {
  code: AlertCode | string;
  level: AlertLevel;
  message: string;
  count: number;
  /** Jusqu'à 5 exemples ; leurs champs dépendent du code de l'alerte. */
  samples: Record<string, string | null>[];
}

/* ------------------------------------------------------------------
 * Journal d'audit — GET /api/supervision/audit-logs/ (AuditLogSerializer)
 * ------------------------------------------------------------------ */
export type AuditResult = 'SUCCESS' | 'DENIED';

export interface AuditLogDto {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string;
  action: string;
  action_label: string;
  entity_type: string;
  entity_type_label: string;
  entity_id: string;
  description: string;
  reason: string;
  result: AuditResult;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string;
}

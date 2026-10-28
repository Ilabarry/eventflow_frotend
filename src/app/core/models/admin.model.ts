/** Modèles de l'espace administrateur (à aligner sur les serializers du backend). */

export type OrganizerStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED';
export type OrganizerActivity = 'with_events' | 'with_upcoming' | 'without_events';
export type OrganizerAction = 'validate' | 'reject' | 'suspend' | 'reactivate';
export type AdminEventStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'FINISHED' | 'CANCELLED';

/* ------------------------------------------------------------------
 * Dashboard
 * ------------------------------------------------------------------ */
export interface AdminKpi {
  value: number;
  /** Évolution en % par rapport à la période précédente (null si inconnue). */
  trend: number | null;
}

export interface AdminActivityPoint {
  date: string; // AAAA-MM-JJ
  registrations: number;
  events: number;
  users: number;
}

export interface AdminRecentEvent {
  id: string;
  title: string;
  status: AdminEventStatus;
  organizer_name: string;
  city: string | null;
  start_at: string;
}

export interface AdminDashboardDto {
  generated_at: string;
  kpis: {
    users: AdminKpi;
    organizers: AdminKpi;
    events: AdminKpi;
    published_events: AdminKpi;
    registrations: AdminKpi;
  };
  /** Éléments qui attendent une décision de l'administrateur. */
  to_review: {
    pending_organizers: number;
    pending_events: number;
    reports: number;
    suspended_accounts: number;
  };
  activity: AdminActivityPoint[];
  recent_events: AdminRecentEvent[];
}

/* ------------------------------------------------------------------
 * Organisateurs
 * ------------------------------------------------------------------ */
export interface AdminOrganizerDto {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  city: string | null;
  organization_name: string | null;
  avatar: string | null;
  status: OrganizerStatus;
  suspended_reason: string | null;
  events_count: number;
  registrations_count: number;
  upcoming_count: number;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminOrganizerStats {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  with_events: number;
  without_events: number;
}

export interface AdminOrganizerList {
  count: number;
  total_pages: number;
  current_page: number;
  results: AdminOrganizerDto[];
  stats: AdminOrganizerStats;
}

export interface AdminOrganizerEvent {
  id: string;
  title: string;
  status: AdminEventStatus;
  start_at: string;
  registrations_count: number;
}

export interface AdminOrganizerDetail {
  organizer: AdminOrganizerDto;
  recent_events: AdminOrganizerEvent[];
}

export interface AdminOrganizerFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: OrganizerStatus | null;
  activity?: OrganizerActivity | null;
  /** Inscrits depuis cette date (AAAA-MM-JJ). */
  joinedAfter?: string | null;
  /** Champ de tri, préfixé par « - » pour un tri décroissant. */
  ordering?: string | null;
}

export interface OrganizerActionPayload {
  reason?: string;
  notify?: boolean;
}


/* ------------------------------------------------------------------
 * Utilisateurs — supervision
 * ------------------------------------------------------------------ */

export interface AdminUserDto {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  roles: string[];
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  is_admin: boolean;
  last_login: string | null;
  created_at: string;
}

export interface AdminUserList {
  count: number;
  total_pages: number;
  current_page: number;
  page_size: number;
  next: string | null;
  previous: string | null;
  results: AdminUserDto[];
}

export interface AdminUserFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string | null;
  isActive?: boolean | null;
  joinedFrom?: string | null;
  joinedTo?: string | null;
  ordering?: string | null;
}

export interface AdminUserActionPayload {
  reason: string;
}

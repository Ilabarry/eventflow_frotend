/* ==================================================================
 * Statuts
 * ================================================================== */
export type OrganizerStatus = 'ACTIVE' | 'SUSPENDED';
export type OrganizerActivity = 'with_events' | 'with_upcoming' | 'without_events';
export type OrganizerAction = 'suspend' | 'reactivate';
export type AdminEventStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'FINISHED' | 'CANCELLED';

/* ==================================================================
 * Organisateurs — aligné sur OrganizerSerializer (backend)
 * ================================================================== */
export interface AdminOrganizerDto {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  last_login: string | null;

  events_total: number;
  events_published: number;
  events_upcoming: number;
  events_cancelled: number;
  registrations_confirmed: number;
}

export interface AdminOrganizerEvent {
  id: string;
  title: string;
  status: AdminEventStatus;
  start_at: string;
  registrations_count?: number;
}

export interface AdminOrganizerDetail {
  organizer: AdminOrganizerDto;
  recent_events: AdminOrganizerEvent[];
}

export interface AdminOrganizerStats {
  total: number;
  active: number;
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

export interface AdminOrganizerFilters {
  page: number;
  pageSize: number;
  search?: string | null;
  is_active?: boolean | null;
  activity?: OrganizerActivity | null;
  ordering?: string | null;
}

export interface OrganizerActionPayload {
  reason: string;
}

/* ==================================================================
 * Utilisateurs — aligné sur SupervisionUserSerializer (backend)
 * ================================================================== */
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
  results: AdminUserDto[];
}

export interface AdminUserFilters {
  page: number;
  pageSize: number;
  search?: string | null;
  role?: string | null;
  isActive?: boolean | null;
  joinedFrom?: string | null;
  joinedTo?: string | null;
  ordering?: string | null;
}

/* ==================================================================
 * Dashboard admin — aligné sur SupervisionDashboardSerializer
 * ================================================================== */
export interface AdminKpi {
  value: number;
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
  to_review: {
    pending_organizers: number;
    pending_events: number;
    reports: number;
    suspended_accounts: number;
  };
  activity: AdminActivityPoint[];
  recent_events: AdminRecentEvent[];
}
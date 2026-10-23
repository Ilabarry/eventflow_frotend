/**
 * Enum côté backend (apps/events/constants.py).
 * Le backend renvoie les valeurs en MAJUSCULES.
 */
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
export type EventFormat = 'IN_PERSON' | 'ONLINE' | 'HYBRID';
export type ParticipationType = 'FREE' | 'PAID';
export type CapacityType = 'LIMITED' | 'UNLIMITED';

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  is_active?: boolean;
  created_at?: string;
}

/**
 * Événement tel que renvoyé par le backend.
 * ⚠️ Certains champs ne sont présents que dans les serializers "détail".
 *    EventListSerializer ne renvoie pas `base_price`, `capacity_limit`, etc.
 *    EventOrganizerSerializer renvoie TOUT (utilisé dans /my/ et détail owner).
 */
export interface EventDto {
  id: string;
  title: string;
  short_description: string;
  description?: string;
  cover_image: string | null;
  format: EventFormat;
  participation_type: ParticipationType;
  capacity_type: CapacityType;
  capacity_limit?: number | null;
  base_price?: string | null;
  start_at: string; // ISO
  end_at: string;
  venue_name?: string;
  address?: string;
  city: string;
  room?: string;
  online_platform?: string;
  access_url?: string; // présent dans EventOrganizerSerializer uniquement
  status: EventStatus;
  published_at?: string | null;
  category: CategoryDto;
  organizer?: { id: string; email: string; first_name: string; last_name: string };
  available_slots?: number | null;
  registered_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Payload de création (POST /api/events/).
 * Aligné sur EventCreateSerializer.
 */
export interface CreateEventPayload {
  title: string;
  short_description: string;
  description: string;
  format: EventFormat;
  participation_type: ParticipationType;
  capacity_type: CapacityType;
  capacity_limit?: number | null;
  base_price?: string | null;
  start_at: string;
  end_at: string;
  venue_name?: string;
  address?: string;
  city?: string;
  room?: string;
  online_platform?: string;
  access_url?: string;
  category: string; // ID de catégorie
}

/**
 * Modèles TypeScript correspondant aux réponses du backend EVENTFLOW.
 * Les noms des propriétés respectent le contrat JSON de Django.
 */

export type BackendEventFormat = 'ONLINE' | 'IN_PERSON';

export type BackendParticipationType = 'FREE' | 'PAID';

export interface EventCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  is_active: boolean;
  created_at: string;
}

/** Événement retourné dans la liste publique de l'API. */
export interface BackendEvent {
  id: string;
  title: string;
  short_description: string;
  cover_image: string | null;
  format: BackendEventFormat;
  participation_type: BackendParticipationType;
  capacity_type: string;
  start_at: string;
  end_at: string;
  city: string;
  status: string;
  category: EventCategory;
  organizer: unknown;
  available_slots: number | null;
}


export interface EventOrganizer {
  id?: string | number;
  name: string;
  logo?: string | null;
  description?: string | null;
  website?: string | null;
}

export interface EventTicketType {
  id: string | number;
  name: string;
  price: number | string;
  currency?: string;
  quantity?: number | null;
  sold_count?: number | null;
  description?: string | null;
  is_active?: boolean;
}

export interface EventDetail extends Omit<BackendEvent, 'end_at' | 'organizer'> {
  end_at?: string | null;
  organizer?: EventOrganizer | null;
  description?: string | null;
  venue_name?: string | null;
  address?: string | null;
  room?: string | null;
  online_platform?: string | null;
  capacity?: number | null;
  registered_count?: number | null;
  ticket_types?: EventTicketType[];
}
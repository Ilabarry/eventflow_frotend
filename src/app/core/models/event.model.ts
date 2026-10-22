
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

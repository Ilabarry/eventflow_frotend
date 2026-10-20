/**
 * Modèle User — correspond exactement au UserSerializer backend.
 */
export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  profile_picture: string | null;
  roles: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Rôles disponibles côté backend.
 */
export enum Role {
  PARTICIPANT = 'participant',
  ORGANISATEUR = 'organisateur',
  ADMINISTRATEUR = 'administrateur',
}
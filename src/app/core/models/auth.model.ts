import { User } from './user.model';

/**
 * Réponse de login.
 */
export interface LoginResponse {
  user: User;
  tokens: {
    access: string;
    refresh: string;
  };
}

/**
 * Payload d'inscription (correspond au RegisterSerializer backend).
 */
export interface RegisterPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  password: string;
  password_confirm: string;
  role: 'participant' | 'organisateur';
}

/**
 * Payload de connexion.
 */
export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Payload de changement de mot de passe.
 */
export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
  new_password_confirm: string;
}

/**
 * Réponse de refresh.
 */
export interface RefreshResponse {
  tokens: {
    access: string;
    refresh: string;
  };
}
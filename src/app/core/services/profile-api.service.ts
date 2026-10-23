import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { User } from '../models/user.model';
import { ChangePasswordPayload } from '../models/auth.model';

/** Payload accepté par PATCH /api/users/me/ */
export interface UpdateProfilePayload {
  first_name?: string;
  last_name?: string;
  phone?: string;
  profile_picture?: File | null;
}

@Injectable({ providedIn: 'root' })
export class ProfileApiService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}`;

  /** GET /api/users/me/ */
  getMe(): Observable<ApiResponse<User>> {
    return this.http
      .get<ApiResponse<User>>(`${this.BASE}/users/me/`)
      .pipe(
        map((res) => ({
          ...res,
          data: res.data
            ? { ...res.data, profile_picture: absoluteMediaUrl(res.data.profile_picture) }
            : res.data,
        })),
      );
  }

  /**
   * PATCH /api/users/me/
   * Accepte JSON (sans image) ou FormData (avec profile_picture).
   */
  updateProfile(payload: UpdateProfilePayload): Observable<ApiResponse<User>> {
    const req = payload.profile_picture
      ? (() => {
          const form = new FormData();
          if (payload.first_name) form.append('first_name', payload.first_name);
          if (payload.last_name) form.append('last_name', payload.last_name);
          if (payload.phone) form.append('phone', payload.phone);
          form.append('profile_picture', payload.profile_picture);
          return this.http.patch<ApiResponse<User>>(`${this.BASE}/users/me/`, form);
        })()
      : this.http.patch<ApiResponse<User>>(`${this.BASE}/users/me/`, {
          first_name: payload.first_name,
          last_name: payload.last_name,
          phone: payload.phone,
        });

    return req.pipe(
      map((res) => ({
        ...res,
        data: res.data
          ? { ...res.data, profile_picture: absoluteMediaUrl(res.data.profile_picture) }
          : res.data,
      })),
    );
  }

  /** POST /api/auth/change-password/ */
  changePassword(payload: ChangePasswordPayload): Observable<ApiResponse<null>> {
    return this.http.post<ApiResponse<null>>(
      `${this.BASE}/auth/change-password/`,
      payload,
    );
  }
}

/**
 * Le backend renvoie des URLs relatives pour les fichiers média (/media/...).
 * On les préfixe avec l'origine du backend.
 */
function absoluteMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const backendOrigin = environment.apiUrl.replace(/\/api\/?$/, '');
  return `${backendOrigin}${url.startsWith('/') ? url : '/' + url}`;
}
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';

/** Statut d'une attestation (apps/certificates/constants.py → CertificateStatus). */
export type ApiCertificateStatus = 'PENDING' | 'ISSUED' | 'REVOKED';

/** Attestation du participant (MyCertificateSerializer) : GET /api/certificates/me/ */
export interface MyCertificateDto {
  id: string;
  reference: string;
  status: ApiCertificateStatus;
  issued_at: string;
  revoked_at: string | null;
  registration_reference: string;
  event_title: string;
  event_start_at: string;
  event_city: string;
  verification_url: string;
}

@Injectable({ providedIn: 'root' })
export class CertificateService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/certificates`;

  /** GET /api/certificates/me/ — attestations du participant connecté, paginées. */
  listMine(page: number, pageSize: number): Observable<ApiResponse<PaginatedResponse<MyCertificateDto>>> {
    const params = new HttpParams().set('page', page).set('page_size', pageSize);
    return this.http.get<ApiResponse<PaginatedResponse<MyCertificateDto>>>(`${this.BASE}/me/`, { params });
  }
}

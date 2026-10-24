
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../../../core/models/api-response.model';

export interface CertificateApi {
  id: string;
  reference: string;
  status: 'PENDING' | 'ISSUED' | 'REVOKED';
  issued_at: string | null;
  revoked_at: string | null;
  registration_reference: string | null;
  event_title: string;
  event_start_at: string | null;
  event_city: string;
  verification_url: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class CertificateService {
  private readonly apiUrl = `${environment.apiUrl}/certificates`;

  constructor(private readonly http: HttpClient) {}

  getMesCertificats(): Observable<
    ApiResponse<PaginatedResponse<CertificateApi>>
  > {
    return this.http.get<
      ApiResponse<PaginatedResponse<CertificateApi>>
    >(`${this.apiUrl}/me/`);
  }

  getCertificat(id: string): Observable<ApiResponse<CertificateApi>> {
    return this.http.get<ApiResponse<CertificateApi>>(
      `${this.apiUrl}/${id}/`
    );
  }

  telechargerPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/download/`, {
      responseType: 'blob'
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse, PaginatedResponse } from '../models/api-response.model';

/* ------------------------------------------------------------------ */
export type ApiPaymentStatus =
  | 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export type ApiPaymentMethod =
  | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER';

export type ApiPaymentProvider =
  | 'DEVELOPMENT' | 'PAYTECH' | 'WAVE' | 'ORANGE_MONEY';

export interface PaymentDetailDto {
  id: string;
  transaction_reference: string;
  provider_reference: string;
  registration_reference: string;
  event_title: string;
  amount: string;
  currency: string;
  payment_method: ApiPaymentMethod;
  provider: ApiPaymentProvider;
  status: ApiPaymentStatus;
  failure_code: string;
  failure_message: string;
  paid_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InitiatePaymentPayload {
  registration_id: string;
  payment_method: ApiPaymentMethod;
  provider: ApiPaymentProvider;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly BASE = `${environment.apiUrl}/payments`;

  /** POST /api/payments/initiate/ */
  initiate(payload: InitiatePaymentPayload): Observable<ApiResponse<PaymentDetailDto>> {
    return this.http.post<ApiResponse<PaymentDetailDto>>(
      `${this.BASE}/initiate/`,
      payload,
    );
  }

  /** GET /api/payments/{id}/ */
  get(id: string): Observable<ApiResponse<PaymentDetailDto>> {
    return this.http.get<ApiResponse<PaymentDetailDto>>(`${this.BASE}/${id}/`);
  }

  /**
   * POST /api/payments/development/{id}/simulate/
   * Dev uniquement : simule SUCCESS/FAILED/CANCELLED.
   */
  simulate(
    id: string,
    result: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING' = 'SUCCESS',
  ): Observable<ApiResponse<PaymentDetailDto>> {
    return this.http.post<ApiResponse<PaymentDetailDto>>(
      `${this.BASE}/development/${id}/simulate/`,
      { result },
    );
  }

  /** GET /api/payments/me/ */
  listMine(page = 1, pageSize = 20): Observable<ApiResponse<PaginatedResponse<PaymentDetailDto>>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('page_size', pageSize.toString());
    return this.http.get<ApiResponse<PaginatedResponse<PaymentDetailDto>>>(
      `${this.BASE}/me/`,
      { params },
    );
  }
}
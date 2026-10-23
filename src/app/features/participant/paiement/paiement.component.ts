import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, of, catchError, switchMap } from 'rxjs';

import { NotificationService } from '../../../core/services/notification.service';
import {
  ApiPaymentMethod,
  ApiPaymentProvider,
  PaymentDetailDto,
  PaymentService,
} from '../../../core/services/payment.service';
import { RegistrationService } from '../../../core/services/registration.service';

type LoadState = 'loading' | 'ready' | 'error';
type Step = 'form' | 'processing' | 'success' | 'failed';

const NUMBER_FMT = new Intl.NumberFormat('fr-FR');

@Component({
  selector: 'app-participant-paiement',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './paiement.component.html',
  styleUrl: './paiement.component.scss',
})
export class ParticipantPaiementComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly paymentService = inject(PaymentService);
  private readonly registrationService = inject(RegistrationService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loadState = signal<LoadState>('loading');
  readonly step = signal<Step>('form');
  readonly payment = signal<PaymentDetailDto | null>(null);
  readonly error = signal<string | null>(null);

  readonly method = signal<ApiPaymentMethod>('MOBILE_MONEY');
  readonly provider = signal<ApiPaymentProvider>('DEVELOPMENT');

  readonly methodOptions: { value: ApiPaymentMethod; label: string }[] = [
    { value: 'MOBILE_MONEY', label: 'Mobile Money' },
    { value: 'CARD', label: 'Carte bancaire' },
    { value: 'BANK_TRANSFER', label: 'Virement' },
  ];

  readonly registrationId = signal<string | null>(null);

  readonly amountLabel = computed(() => {
    const p = this.payment();
    if (!p) return '—';
    return `${NUMBER_FMT.format(Number(p.amount))} ${p.currency}`;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('registrationId');
    if (!id) {
      this.error.set('Inscription introuvable.');
      this.loadState.set('error');
      return;
    }
    this.registrationId.set(id);
    this.loadState.set('ready');
  }

  onMethodChange(event: Event): void {
    this.method.set((event.target as HTMLSelectElement).value as ApiPaymentMethod);
  }

  async pay(): Promise<void> {
    const id = this.registrationId();
    if (!id) return;

    this.step.set('processing');
    this.error.set(null);

    try {
      // 1. Initier le paiement
      const res = await firstValueFrom(
        this.paymentService.initiate({
          registration_id: id,
          payment_method: this.method(),
          provider: this.provider(),
        }),
      );
      const payment = res.data;
      if (!payment) throw new Error('Réponse vide.');
      this.payment.set(payment);

      // 2. En dev, simuler SUCCESS
      const sim = await firstValueFrom(this.paymentService.simulate(payment.id, 'SUCCESS'));
      const result = sim.data;
      if (result?.status === 'SUCCESS') {
        this.step.set('success');
        this.notification.success(
          'Paiement confirmé. Votre ticket est disponible.',
          'Succès',
        );
        // Redirection auto vers tickets après 2s
        setTimeout(() => this.router.navigate(['/participant/tickets']), 2000);
      } else {
        this.step.set('failed');
        this.error.set(result?.failure_message || 'Le paiement a échoué.');
      }
    } catch (err: any) {
      this.step.set('failed');
      this.error.set(err?.error?.message || 'Le paiement a échoué.');
      this.notification.httpError(err);
    }
  }
}
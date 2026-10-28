import { Component, OnInit, DestroyRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { NotificationService } from '../../../core/services/notification.service';
import {
  CertificateService,
  MyCertificateDto,
} from '../../../core/services/certificate.service';

type FilterValue = 'all' | 'ISSUED' | 'PENDING' | 'REVOKED';

@Component({
  selector: 'app-attestations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './attestations.component.html',
  styleUrl: './attestations.component.scss',
})
export class AttestationsComponent implements OnInit {
  private readonly certificateService = inject(CertificateService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly certificates = signal<MyCertificateDto[]>([]);
  readonly error = signal<string | null>(null);

  readonly filter = signal<FilterValue>('all');
  readonly search = signal('');

  readonly filtered = computed(() => {
    const list = this.certificates();
    const f = this.filter();
    const q = this.search().trim().toLowerCase();

    return list.filter((c) => {
      if (f !== 'all' && c.status !== f) return false;
      if (q) {
        const haystack = `${c.event_title} ${c.reference} ${c.event_city}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.certificateService
      .listMine(1, 50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.certificates.set(res.data?.results ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(
            'Impossible de charger les attestations. Vérifiez votre connexion puis réessayez.',
          );
          this.loading.set(false);
          this.notification.httpError(err);
        },
      });
  }

  setFilter(value: FilterValue): void {
    this.filter.set(value);
  }

  reset(): void {
    this.filter.set('all');
    this.search.set('');
  }

  label(status: MyCertificateDto['status']): string {
    return status === 'ISSUED'
      ? 'Disponible'
      : status === 'PENDING'
        ? 'En attente'
        : 'Révoqué';
  }

  download(cert: MyCertificateDto): void {
    if (cert.status !== 'ISSUED') return;

    this.certificateService
      .downloadPdf(cert.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${cert.reference}.pdf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: (err) => {
          if (err.status === 404) {
            this.notification.warning(
              "Le PDF de cette attestation n'est pas disponible.",
              'Attestation',
            );
          } else {
            this.notification.httpError(err);
          }
        },
      });
  }

  open(cert: MyCertificateDto): void {
    if (cert.status !== 'ISSUED') return;

    this.certificateService
      .downloadPdf(cert.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const win = window.open(url, '_blank');
          if (!win) {
            this.notification.warning(
              'Le navigateur a bloqué le PDF. Autorisez les pop-ups.',
              'Attestation',
            );
          }
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: (err) => this.notification.httpError(err),
      });
  }
}

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import {
  CertificateService,
  CertificateApi
} from './certificate.service';

type StatutAttestation = 'DISPONIBLE' | 'EN_ATTENTE' | 'REVOQUE';

interface Attestation {
  id: string;
  evenement: string;
  type: string;
  participant: string;
  date: string;
  lieu: string;
  reference: string;
  statut: StatutAttestation;
}

@Component({
  selector: 'app-attestations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './attestations.component.html',
  styleUrl: './attestations.component.scss'
})
export class AttestationsComponent implements OnInit, OnDestroy {
  filtreActif: 'TOUTES' | StatutAttestation = 'TOUTES';
  recherche = '';

  attestations: Attestation[] = [];
  chargement = false;
  erreur = '';

  private readonly subscriptions = new Subscription();

  constructor(private readonly certificateService: CertificateService) {}

  ngOnInit(): void {
    this.chargerAttestations();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  chargerAttestations(): void {
    this.chargement = true;
    this.erreur = '';

    const subscription = this.certificateService.getMesCertificats().subscribe({
      next: (response) => {
        const certificats = response.data?.results ?? [];

        this.attestations = certificats.map((certificat) =>
          this.convertirCertificat(certificat)
        );

        this.chargement = false;
      },
      error: (error) => {
        console.error('Erreur de chargement des certificats.', error);
        this.erreur =
          'Impossible de charger les attestations. Vérifiez votre connexion puis réessayez.';
        this.chargement = false;
      }
    });

    this.subscriptions.add(subscription);
  }

  private convertirCertificat(certificat: CertificateApi): Attestation {
    let statut: StatutAttestation;

    switch (certificat.status) {
      case 'ISSUED':
        statut = 'DISPONIBLE';
        break;
      case 'REVOKED':
        statut = 'REVOQUE';
        break;
      default:
        statut = 'EN_ATTENTE';
    }

    const date = certificat.event_start_at
      ? new Date(certificat.event_start_at).toLocaleDateString('fr-FR')
      : '';

    return {
      id: certificat.id,
      evenement: certificat.event_title || 'Événement',
      type: 'Participation',
      participant: '',
      date,
      lieu: certificat.event_city || 'Non précisé',
      reference: certificat.reference,
      statut
    };
  }

  get attestationsFiltrees(): Attestation[] {
    const terme = this.recherche.trim().toLowerCase();

    return this.attestations.filter((attestation) => {
      const correspondStatut =
        this.filtreActif === 'TOUTES' ||
        attestation.statut === this.filtreActif;

      const texte = [
        attestation.evenement,
        attestation.reference,
        attestation.participant,
        attestation.lieu
      ].join(' ').toLowerCase();

      return correspondStatut && texte.includes(terme);
    });
  }

  changerFiltre(filtre: 'TOUTES' | StatutAttestation): void {
    this.filtreActif = filtre;
  }

  reinitialiserRecherche(): void {
    this.recherche = '';
    this.filtreActif = 'TOUTES';
  }

  voirAttestation(attestation: Attestation): void {
    if (attestation.statut !== 'DISPONIBLE') {
      return;
    }

    this.ouvrirPdf(attestation, false);
  }

  telechargerAttestation(attestation: Attestation): void {
    if (attestation.statut !== 'DISPONIBLE') {
      return;
    }

    this.ouvrirPdf(attestation, true);
  }

  private ouvrirPdf(attestation: Attestation, telecharger: boolean): void {
    const subscription = this.certificateService
      .telechargerPdf(attestation.id)
      .subscribe({
        next: (blob) => {
          const fichierPdf = new Blob([blob], { type: 'application/pdf' });
          const url = URL.createObjectURL(fichierPdf);

          if (telecharger) {
            const lien = document.createElement('a');
            lien.href = url;
            lien.download = `${attestation.reference}.pdf`;
            lien.click();
          } else {
            const nouvelOnglet = window.open(url, '_blank');

            if (!nouvelOnglet) {
              this.erreur =
                'Le navigateur a bloqué l’ouverture du PDF. Autorisez les fenêtres pop-up puis réessayez.';
            }
          }

          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },
        error: (error) => {
          console.error('Erreur lors de la récupération du PDF.', error);

          this.erreur =
            error.status === 404
              ? 'Le fichier PDF de cette attestation n’est pas disponible.'
              : 'Impossible d’ouvrir ou de télécharger le PDF. Réessayez.';
        }
      });

    this.subscriptions.add(subscription);
  }

  trackById(_index: number, attestation: Attestation): string {
    return attestation.id;
  }
}

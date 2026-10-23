
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type StatutAttestation = 'DISPONIBLE' | 'EN_ATTENTE';

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
export class AttestationsComponent {
  filtreActif: 'TOUTES' | StatutAttestation = 'TOUTES';
  recherche = '';

  // Données de démonstration : à remplacer par les données de l'API.
  attestations: Attestation[] = [
    {
      id: '1',
      evenement: "FORUM DE L’INNOVATION NUMÉRIQUE",
      type: 'Forum',
      participant: 'ILA BARRY',
      date: '25 octobre 2026',
      lieu: 'Dakar',
      reference: 'ATT-2026-0087',
      statut: 'DISPONIBLE'
    },
    {
      id: '2',
      evenement: 'PYTHON WORKSHOP',
      type: 'Formation',
      participant: 'ILA BARRY',
      date: '',
      lieu: 'Dakar',
      reference: 'ATT-2026-0088',
      statut: 'EN_ATTENTE'
    }
  ];

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

    // À connecter à la route ou au service de consultation du PDF.
    console.info('Consulter l’attestation :', attestation.reference);
  }

  telechargerAttestation(attestation: Attestation): void {
    if (attestation.statut !== 'DISPONIBLE') {
      return;
    }

    // Le téléchargement sera relié à l'API des certificats.
    console.info('Télécharger l’attestation :', attestation.reference);
  }

  trackById(_index: number, attestation: Attestation): string {
    return attestation.id;
  }
}

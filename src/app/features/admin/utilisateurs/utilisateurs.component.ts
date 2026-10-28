
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

import { AdminApiService } from '../../../core/services/admin.service';
import {
  AdminUserDto,
  AdminUserFilters,
} from '../../../core/models/admin.model';

type RoleUtilisateur =
  | 'Participant'
  | 'Organisateur'
  | 'Administrateur';

type StatutUtilisateur = 'Actif' | 'Suspendu';

interface Utilisateur {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  role: RoleUtilisateur;
  dateInscription: string;
  statut: StatutUtilisateur;
  avatar: string;
}

@Component({
  selector: 'app-utilisateurs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './utilisateurs.component.html',
  styleUrl: './utilisateurs.component.scss',
})
export class AdminUsersComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);

  recherche = '';
  roleFiltre = 'Tous';
  statutFiltre = 'Tous';
  dateFiltre = 'Toutes';

  utilisateurs: Utilisateur[] = [];

  page = 1;
  pageServeur = 1;
  elementsParPage = 5;
  totalUtilisateurs = 0;
  nombrePages = 1;

  chargement = false;
  erreurChargement = '';

  ngOnInit(): void {
    this.chargerUtilisateurs();
  }

  chargerUtilisateurs(): void {
    this.chargement = true;
    this.erreurChargement = '';

    const filtres: AdminUserFilters = {
      page: this.page,
      pageSize: this.elementsParPage,
      search: this.recherche.trim() || undefined,
      role: this.roleFiltre === 'Tous' ? undefined : this.roleFiltre,
      isActive:
        this.statutFiltre === 'Tous'
          ? undefined
          : this.statutFiltre === 'Actif',
      joinedFrom: this.dateDepuisJours(),
      joinedTo:
        this.dateFiltre === 'Toutes' ? undefined : this.dateDuJour(),
      ordering: '-created_at',
    };

    this.adminApi
      .listUsers(filtres)
      .pipe(finalize(() => (this.chargement = false)))
      .subscribe({
        next: (response) => {
          if (!response.success || !response.data) {
            this.utilisateurs = [];
            this.totalUtilisateurs = 0;
            this.nombrePages = 1;
            this.erreurChargement =
              response.message || 'Impossible de charger les utilisateurs.';
            return;
          }

          const pageData = response.data;

          this.utilisateurs = pageData.results.map((user) =>
            this.convertirUtilisateur(user),
          );

          this.totalUtilisateurs = pageData.count;
          this.nombrePages = Math.max(1, pageData.total_pages);
          this.totalUtilisateurs = pageData.count;
          this.nombrePages = Math.max(1, pageData.total_pages);

          if (this.page > this.nombrePages) {
            this.page = this.nombrePages;
            this.chargerUtilisateurs();
          }
        },
        error: (error: unknown) => {
          this.utilisateurs = [];
          this.totalUtilisateurs = 0;
          this.nombrePages = 1;

          this.erreurChargement =
            error instanceof HttpErrorResponse && error.status === 403
              ? 'Accès refusé : un compte administrateur autorisé est nécessaire.'
              : error instanceof HttpErrorResponse && error.status === 401
                ? 'Session expirée ou non authentifiée. Reconnectez-vous.'
                : 'Impossible de charger les utilisateurs. Vérifiez Django et votre connexion.';
        },
      });
  }

  private convertirUtilisateur(user: AdminUserDto): Utilisateur {
    const roles = user.roles.map((role) => role.toLowerCase());

    let role: RoleUtilisateur = 'Participant';

    if (
      user.is_superuser ||
      user.is_admin ||
      roles.some((r) =>
        ['administrateur', 'admin', 'administrator'].includes(r),
      )
    ) {
      role = 'Administrateur';
    } else if (
      roles.some((r) =>
        ['organisateur', 'organizer'].includes(r),
      )
    ) {
      role = 'Organisateur';
    }

    const prenom = user.first_name || '';
    const nom = user.last_name || '';
    const initiales = `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase();

    return {
      id: user.id,
      prenom,
      nom,
      email: user.email,
      role,
      dateInscription: user.created_at,
      statut: user.is_active ? 'Actif' : 'Suspendu',
      avatar: initiales || '?',
    };
  }

  private dateDuJour(): string {
    return this.formaterDate(new Date());
  }

  private dateDepuisJours(): string | undefined {
    if (this.dateFiltre === 'Toutes') {
      return undefined;
    }

    const jours = this.dateFiltre === '7 jours' ? 7 : 30;
    const date = new Date();
    date.setDate(date.getDate() - jours);

    return this.formaterDate(date);
  }

  private formaterDate(date: Date): string {
    const annee = date.getFullYear();
    const mois = String(date.getMonth() + 1).padStart(2, '0');
    const jour = String(date.getDate()).padStart(2, '0');

    return `${annee}-${mois}-${jour}`;
  }

  get utilisateursFiltres(): Utilisateur[] {
    return this.utilisateurs;
  }

  get utilisateursPagines(): Utilisateur[] {
    return this.utilisateurs;
  }

  get nombreParticipants(): number {
    return this.utilisateurs.filter(
      (user) => user.role === 'Participant',
    ).length;
  }

  get nombreOrganisateurs(): number {
    return this.utilisateurs.filter(
      (user) => user.role === 'Organisateur',
    ).length;
  }

  get nombreSuspendus(): number {
    return this.utilisateurs.filter(
      (user) => user.statut === 'Suspendu',
    ).length;
  }

  changerPage(page: number): void {
    if (
      page >= 1 &&
      page <= this.nombrePages &&
      page !== this.page
    ) {
      this.page = page;
      this.chargerUtilisateurs();
    }
  }

  reinitialiserPage(): void {
    this.page = 1;
    this.chargerUtilisateurs();
  }

  changerStatut(utilisateur: Utilisateur): void {
    const estActif = utilisateur.statut === 'Actif';
    const action = estActif ? 'suspendre' : 'activer';

    const motif = window.prompt(
      `Pourquoi voulez-vous ${action} cet utilisateur ?`,
    );

    if (motif === null) {
      return;
    }

    const reason = motif.trim();

    if (reason.length < 5) {
      this.erreurChargement =
        'Le motif doit contenir au moins 5 caractères.';
      return;
    }

    if (reason.length > 500) {
      this.erreurChargement =
        'Le motif ne doit pas dépasser 500 caractères.';
      return;
    }

    const confirmation = window.confirm(
      `Confirmer l'action : ${action} ${utilisateur.email} ?`,
    );

    if (!confirmation) {
      return;
    }

    this.chargement = true;
    this.erreurChargement = '';

    const requete = estActif
      ? this.adminApi.suspendUser(utilisateur.id, reason)
      : this.adminApi.activateUser(utilisateur.id, reason);

    requete
      .pipe(finalize(() => (this.chargement = false)))
      .subscribe({
        next: () => {
          this.chargerUtilisateurs();
        },
        error: (erreur: HttpErrorResponse) => {
          if (erreur.status === 400) {
            this.erreurChargement =
              erreur.error?.errors?.reason?.[0] ??
              'Le motif fourni est invalide.';
          } else if (erreur.status === 401) {
            this.erreurChargement =
              'Votre session a expiré. Veuillez vous reconnecter.';
          } else if (erreur.status === 403) {
            this.erreurChargement =
              'Vous ne disposez pas des droits nécessaires.';
          } else {
            this.erreurChargement =
              'Impossible de modifier le statut de cet utilisateur.';
          }
        },
      });
  }
}

import { Routes } from '@angular/router';
import { PublicLayoutComponent } from './layouts/public/public-layout/public-layout.component';
import { HommeComponent } from './features/public/homme/homme.component';
import { EventsComponent } from './features/public/events/events.component';
import { EventDetailComponent } from './features/public/event-detail/event-detail.component';
import { RegisterComponent } from './features/auth/register/register.component';
import { LoginComponent } from './features/auth/login/login.component';
import { OrganizerLayoutComponent } from './layouts/organizer/organizer-layout/organizer-layout.component';
import { OrganizerDashboardComponent } from './features/organizer/dashboard/dashboard.component';
import { OrganizerEvenementsComponent } from './features/organizer/evenements/evenements.component';
import { OrganizerParticipantsComponent } from './features/organizer/participants/participants.component';
import { OrganizerTicketsComponent } from './features/organizer/tickets/tickets.component';
import { OrganizerStatistiquesComponent } from './features/organizer/statistiques/statistiques.component';
import { OrganizerNotificationsComponent } from './features/organizer/notifications/notifications.component';
import { ParticipantLayoutComponent } from './layouts/participant/participant-layout/participant-layout.component';
import { ParticipantDashboardComponent } from './features/participant/dashboard/dashboard.component';
import { ParticipantRegistrationsComponent } from './features/participant/inscriptions/inscriptions.component';
import { ParticipantTicketsComponent } from './features/participant/tickets/tickets.component';
import { ParticipantCertificatesComponent } from './features/participant/attestations/attestations.component';
import { ParticipantProfileComponent } from './features/participant/profil/profil.component';
import { ParticipantNotificationsComponent } from './features/participant/notifications/notifications.component';
import { AdminLayoutComponent } from './layouts/admin/admin-layout/admin-layout.component';
import { AdminDashboardComponent } from './features/admin/dashboard/dashboard.component';
import { AdminOrganizersComponent } from './features/admin/organisateurs/organisateurs.component';
import { AdminUsersComponent } from './features/admin/utilisateurs/utilisateurs.component';
import { AdminEventsComponent } from './features/admin/evenements/evenements.component';
import { AdminCategoriesComponent } from './features/admin/categories/categories.component';
import { AdminSupervisionComponent } from './features/admin/supervision/supervision.component';
import { AdminNotificationsComponent } from './features/admin/notifications/notifications.component';
import { OrganizerCreateEventComponent } from './features/organizer/creer-evenement/creer-evenement.component';
import { OrganizerEditEventComponent } from './features/organizer/modifier-evenement/modifier-evenement.component';

import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { Role } from './core/models/user.model';

export const routes: Routes = [
  { path: 'register', component: RegisterComponent },
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: PublicLayoutComponent,
    children: [
      { path: '', component: HommeComponent },
      { path: 'events', component: EventsComponent },
      { path: 'events_detail', component: EventDetailComponent },
      { path: '', redirectTo: 'events', pathMatch: 'full' },
    ],
  },

  // ============================================================
  // ORGANISATEUR — auth + rôle
  // ============================================================
  {
    path: 'organisateur',
    component: OrganizerLayoutComponent,
    canActivate: [authGuard, roleGuard([Role.ORGANISATEUR])],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: OrganizerDashboardComponent },
      { path: 'evenements', component: OrganizerEvenementsComponent },
      { path: 'participants', component: OrganizerParticipantsComponent },
      { path: 'tickets', component: OrganizerTicketsComponent },
      { path: 'statistiques', component: OrganizerStatistiquesComponent },
      { path: 'notifications', component: OrganizerNotificationsComponent },
      { path: 'creer-evenement', component: OrganizerCreateEventComponent },
      {
        path: 'evenements/:id/modifier',
        component: OrganizerEditEventComponent,
        canDeactivate: [(component: OrganizerEditEventComponent) => component.canDeactivate()],
      },
    ],
  },

  // ============================================================
  // PARTICIPANT — auth + rôle
  // ============================================================
  {
    path: 'participant',
    component: ParticipantLayoutComponent,
    canActivate: [authGuard, roleGuard([Role.PARTICIPANT])],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: ParticipantDashboardComponent },
      { path: 'inscriptions', component: ParticipantRegistrationsComponent },
      { path: 'tickets', component: ParticipantTicketsComponent },
      { path: 'attestations', component: ParticipantCertificatesComponent },
      { path: 'profil', component: ParticipantProfileComponent },
      { path: 'notifications', component: ParticipantNotificationsComponent },
    ],
  },

  // ============================================================
  // ADMIN — auth + rôle
  // ============================================================
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [authGuard, roleGuard([Role.ADMINISTRATEUR])],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: AdminDashboardComponent },
      { path: 'organisateurs', component: AdminOrganizersComponent },
      { path: 'utilisateurs', component: AdminUsersComponent },
      { path: 'evenements', component: AdminEventsComponent },
      { path: 'categories', component: AdminCategoriesComponent },
      { path: 'supervision', component: AdminSupervisionComponent },
      { path: 'notifications', component: AdminNotificationsComponent },
    ],
  },

  // ============================================================
  // 404
  // ============================================================
  { path: '**', redirectTo: '' },
];
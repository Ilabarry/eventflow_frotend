import { Routes } from '@angular/router';
import { PublicLayoutComponent } from './layouts/public/public-layout/public-layout.component';
import { HommeComponent } from './features/public/homme/homme.component';
import { EventsComponent } from './features/public/events/events.component';
import { EventDetailComponent } from './features/public/event-detail/event-detail.component';
import { RegisterComponent } from './features/auth/register/register.component';
import { LoginComponent } from './features/auth/login/login.component';
import { OrganizerLayoutComponent } from './layouts/organizer/organizer-layout/organizer-layout.component';
import { DashboardComponent } from './features/organizer/dashboard/dashboard.component';
import { EvenementsComponent } from './features/organizer/evenements/evenements.component';
import { ParticipantsComponent } from './features/organizer/participants/participants.component';
import { TicketsComponent } from './features/organizer/tickets/tickets.component';
import { StatistiquesComponent } from './features/organizer/statistiques/statistiques.component';
import { NotificationsComponent } from './features/organizer/notifications/notifications.component';
import { ParticipantLayoutComponent } from './layouts/participant/participant-layout/participant-layout.component';
import { ParticipantDashboardComponent } from './features/participant/dashboard/dashboard.component';
import { ParticipantRegistrationsComponent } from './features/participant/inscriptions/inscriptions.component';
import { ParticipantTicketsComponent } from './features/participant/tickets/tickets.component';
import { ParticipantCertificatesComponent } from './features/participant/attestations/attestations.component';
import { ParticipantProfileComponent } from './features/participant/profil/profil.component';
import { ParticipantNotificationsComponent } from './features/participant/notifications/notifications.component';

export const routes: Routes = [

    {path: 'register',component:RegisterComponent},
    {path: 'login',component:LoginComponent},
    {
        path: '',
        component: PublicLayoutComponent, // Le conteneur du Header et Footer
        children: [
        { path: '', component: HommeComponent },
        { path: 'events', component: EventsComponent },
        { path: 'events_detail', component: EventDetailComponent },
        ]
    },

    {
    path: 'organisateur',
    component: OrganizerLayoutComponent,
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'evenements', component: EvenementsComponent },
      { path: 'participants', component: ParticipantsComponent },
      { path: 'tickets', component: TicketsComponent },
      { path: 'statistiques', component: StatistiquesComponent },
      { path: 'notifications', component: NotificationsComponent },
    //   { path: 'parametres', component: OrganizerSettingsComponent },
    //   { path: 'messages', component: OrganizerMessagesComponent },
    ],
  },

  {
  path: 'participant',
  component: ParticipantLayoutComponent,
  children: [
    { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    { path: 'dashboard', component: ParticipantDashboardComponent },
    { path: 'inscriptions', component: ParticipantRegistrationsComponent },
    { path: 'tickets', component: ParticipantTicketsComponent },
    { path: 'attestations', component: ParticipantCertificatesComponent },
    { path: 'profil', component: ParticipantProfileComponent },
    { path: 'notifications', component: ParticipantNotificationsComponent },
    // { path: 'parametres', component: ParticipantSettingsComponent },
    // { path: 'messages', component: ParticipantMessagesComponent },
  ],
},

];

import { Routes } from '@angular/router';
import { PublicLayoutComponent } from './layouts/public/public-layout/public-layout.component';
import { HommeComponent } from './features/public/homme/homme.component';
import { EventsComponent } from './features/public/events/events.component';
import { EventDetailComponent } from './features/public/event-detail/event-detail.component';
import { RegisterComponent } from './features/auth/register/register.component';
import { LoginComponent } from './features/auth/login/login.component';

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
    }

];

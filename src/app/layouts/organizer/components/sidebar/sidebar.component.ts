import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
interface NavItem {
  label: string;
  path: string;      // segment enfant de /organisateur
  icon: string[];    // attributs "d" des <path> SVG
}

@Component({
  selector: 'app-organizer-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class OrganizerSidebarComponent {
  
  readonly open = input(false);
  readonly closed = output<void>();

  readonly items: NavItem[] = [
    {
      label: 'Dashboard',
      path: 'dashboard',
      icon: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
    },
    {
      label: 'Mes événements',
      path: 'evenements',
      icon: [
        'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
        'M16 2v4', 'M8 2v4', 'M3 10h18',
      ],
    },
    {
      label: 'Participants',
      path: 'participants',
      icon: [
        'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
        'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
        'M23 21v-2a4 4 0 0 0-3-3.87',
        'M16 3.13a4 4 0 0 1 0 7.75',
      ],
    },
    {
      label: 'Tickets',
      path: 'tickets',
      icon: [
        'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z',
        'M13 5v2', 'M13 11v2', 'M13 17v2',
      ],
    },
    {
      label: 'Statistiques',
      path: 'statistiques',
      icon: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
    },
    {
      label: 'Notifications',
      path: 'notifications',
      icon: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
    },
    {
      label: 'Paramètres',
      path: 'parametres',
      icon: [
        'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
        'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
      ],
    },
  ];
  
}
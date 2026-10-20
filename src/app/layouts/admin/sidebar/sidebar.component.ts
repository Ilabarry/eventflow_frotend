import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  label: string;
  path: string;      // segment enfant de /admin
  icon: string[];    // attributs "d" des <path> SVG
}

@Component({
  selector: 'app-admin-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class AdminSidebarComponent {
  readonly open = input(false);
  readonly closed = output<void>();
  readonly logout = output<void>();

  readonly items: NavItem[] = [
    {
      label: 'Dashboard',
      path: 'dashboard',
      icon: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
    },
    {
      label: 'Organisateurs',
      path: 'organisateurs',
      icon: [
        'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z',
        'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
      ],
    },
    {
      label: 'Utilisateurs',
      path: 'utilisateurs',
      icon: [
        'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
        'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
        'M23 21v-2a4 4 0 0 0-3-3.87',
        'M16 3.13a4 4 0 0 1 0 7.75',
      ],
    },
    {
      label: 'Evenements',
      path: 'evenements',
      icon: [
        'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
        'M16 2v4', 'M8 2v4', 'M3 10h18',
      ],
    },
    {
      label: 'Catégories',
      path: 'categories',
      icon: ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
    },
    {
      label: 'Supervision',
      path: 'supervision',
      icon: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
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
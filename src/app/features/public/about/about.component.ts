import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

type Tone = 'violet' | 'cyan' | 'green' | 'amber';

interface Stat {
  value: string;
  label: string;
  icon: string[];
}

interface Value {
  title: string;
  description: string;
  tone: Tone;
  icon: string[];
}

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  shortBio: string;
  longBio: string;
  skills: string[];
  email?: string;
  linkedin?: string;
  github?: string;
  photoUrl: string;
  tone: Tone;
}

const ICON = {
  sparkle: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  users: [
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M23 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  calendar: [
    'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
    'M16 2v4', 'M8 2v4', 'M3 10h18',
  ],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  rocket: [
    'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91 0z',
    'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z',
    'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0',
    'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  ],
  heart: [
    'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z',
  ],
  target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  bolt: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
  check: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  mail: ['M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', 'M22 6l-10 7L2 6'],
} as const;

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  /* ------------------------------------------------------------------
     HERO + STATS
     ------------------------------------------------------------------ */
  readonly stats: Stat[] = [
    { value: '150+', label: 'Événements organisés', icon: [...ICON.calendar] },
    { value: '12k+', label: 'Participants actifs', icon: [...ICON.users] },
    { value: '98%', label: 'Taux de satisfaction', icon: [...ICON.heart] },
    { value: '24/7', label: 'Support disponible', icon: [...ICON.shield] },
  ];

  /* ------------------------------------------------------------------
     VALEURS
     ------------------------------------------------------------------ */
  readonly values: Value[] = [
    {
      title: 'Simplicité',
      description: 'Une interface intuitive, sans friction, pensée pour l’organisateur comme pour le participant.',
      tone: 'violet',
      icon: [...ICON.bolt],
    },
    {
      title: 'Centralisation',
      description: 'Toute la gestion d’un événement sur une seule plateforme : création, inscription, billetterie, suivi.',
      tone: 'cyan',
      icon: [...ICON.target],
    },
    {
      title: 'Fiabilité',
      description: 'Une architecture robuste, sécurisée et prête à évoluer avec vos besoins.',
      tone: 'green',
      icon: [...ICON.shield],
    },
    {
      title: 'Expérience',
      description: 'Chaque événement doit offrir une expérience mémorable, du premier clic jusqu’au check-in.',
      tone: 'amber',
      icon: [...ICON.sparkle],
    },
  ];

  /* ------------------------------------------------------------------
     TIMELINE / HISTOIRE
     ------------------------------------------------------------------ */
  readonly milestones: { date: string; title: string; description: string }[] = [
    {
      date: '2024',
      title: 'Genèse du projet',
      description: 'Le constat d’un besoin : centraliser la gestion des événements au Sénégal et au-delà.',
    },
    {
      date: '2025',
      title: 'Conception & prototypage',
      description: 'Définition du cahier des charges, maquettes UX/UI, choix technologiques.',
    },
    {
      date: '2026',
      title: 'Développement Full Stack',
      description: 'Implémentation du backend Django/DRF et du frontend Angular dans le cadre du programme FORCE-N.',
    },
    {
      date: 'Aujourd’hui',
      title: 'Plateforme fonctionnelle',
      description: 'Une solution prête à accompagner les organisateurs et participants dans leurs événements.',
    },
  ];

  /* ------------------------------------------------------------------
     ÉQUIPE
     ------------------------------------------------------------------ */
  readonly team: TeamMember[] = [
    {
      id: 'ila-barry',
      firstName: 'Ila',
      lastName: 'Barry',
      role: 'Chef de projet',
      shortBio: 'Coordonne l’équipe et veille à la cohérence du projet de bout en bout.',
      longBio: 'Ila pilote EVENTFLOW avec une vision claire : faire de la gestion d’événements une expérience simple et professionnelle. Elle assure la coordination entre les développeurs, le designer et les parties prenantes du programme FORCE-N.',
      skills: ['Gestion de projet', 'Coordination', 'Product Ownership', 'Communication'],
      email: 'ila.barry@eventflow.sn',
      linkedin: 'https://www.linkedin.com/in/ila-barry',
      photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&q=80',
      tone: 'violet',
    },
    {
      id: 'ibrahima-sene',
      firstName: 'Ibrahima',
      lastName: 'Seck Sene',
      role: 'Backend Developer',
      shortBio: 'Architecte du backend Django/DRF et des APIs REST sécurisées.',
      longBio: 'Ibrahima conçoit l’architecture serveur d’EVENTFLOW. Il est responsable des modèles de données, des services métier, de l’authentification JWT et de la sécurité des endpoints.',
      skills: ['Python', 'Django', 'DRF', 'PostgreSQL', 'API REST', 'JWT'],
      email: 'ibrahima.sene@eventflow.sn',
      github: 'https://github.com/ibrahima-sene',
      photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80',
      tone: 'cyan',
    },
    {
      id: 'samba-mballo',
      firstName: 'Samba',
      lastName: 'Mballo',
      role: 'Frontend Developer',
      shortBio: 'Donne vie aux maquettes avec Angular, en garantissant performance et accessibilité.',
      longBio: 'Samba développe l’interface utilisateur d’EVENTFLOW avec Angular. Il veille à la fluidité des parcours, à la réactivité des écrans et à la cohérence du design system.',
      skills: ['Angular', 'TypeScript', 'SCSS', 'RxJS', 'UX Frontend'],
      email: 'samba.mballo@eventflow.sn',
      github: 'https://github.com/samba-mballo',
      photoUrl: 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=400&q=80',
      tone: 'green',
    },
    {
      id: 'oumar-cissoko',
      firstName: 'Oumar',
      lastName: 'Cissoko',
      role: 'Backend Developer',
      shortBio: 'Implémente la logique métier et les services de paiement et de tickets.',
      longBio: 'Oumar travaille sur les modules paiement, tickets et notifications. Il garantit la cohérence transactionnelle et la fiabilité des flux critiques.',
      skills: ['Python', 'Django', 'Transactions', 'Tests', 'Sécurité'],
      email: 'oumar.cissoko@eventflow.sn',
      photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80',
      tone: 'amber',
    },
    {
      id: 'ludosky-okou',
      firstName: 'Ludosky',
      lastName: 'Atinkpedjo Okou',
      role: 'UI/UX Designer',
      shortBio: 'Crée l’identité visuelle et les parcours utilisateur d’EVENTFLOW.',
      longBio: 'Ludosky est responsable du design system d’EVENTFLOW : palette, typographie, composants, maquettes. Il/elle veille à l’accessibilité et à la cohérence graphique.',
      skills: ['UI Design', 'UX Research', 'Figma', 'Design System', 'Prototypage'],
      photoUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&q=80',
      tone: 'violet',
    },
    {
      id: 'etranny-prince-kouame',
      firstName: 'Etranny',
      lastName: 'Prince Kouame',
      role: 'QA Tester',
      shortBio: 'Assure la qualité et la fiabilité de la plateforme via des tests rigoureux.',
      longBio: 'Etranny couvre les tests fonctionnels et les tests d’intégration d’EVENTFLOW. Il/elle rédige les scénarios de test, détecte les régressions et valide chaque livraison.',
      skills: ['Tests fonctionnels', 'Tests d’intégration', 'Automatisation', 'Documentation'],
      photoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&q=80',
      tone: 'cyan',
    },
  ];

  /* ------------------------------------------------------------------
     ÉTAT MODAL
     ------------------------------------------------------------------ */
  readonly selectedMember = signal<TeamMember | null>(null);

  readonly selectedInitials = computed(() => {
    const m = this.selectedMember();
    if (!m) return '';
    return `${m.firstName.charAt(0)}${m.lastName.charAt(0)}`.toUpperCase();
  });

  openMember(member: TeamMember): void {
    this.selectedMember.set(member);
    document.body.style.overflow = 'hidden';
  }

  closeMember(): void {
    this.selectedMember.set(null);
    document.body.style.overflow = '';
  }

  initials(member: TeamMember): string {
    return `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedMember()) this.closeMember();
  }
}
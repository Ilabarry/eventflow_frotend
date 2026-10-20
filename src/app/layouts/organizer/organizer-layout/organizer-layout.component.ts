import { Component, DestroyRef, HostListener, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { OrganizerNavbarComponent } from '../components/navbar/navbar.component';
import { OrganizerSidebarComponent } from '../components/sidebar/sidebar.component';
import { Router, RouterOutlet } from '@angular/router';
const DESKTOP_BREAKPOINT = 1024;

@Component({
  selector: 'app-organizer-layout',
  standalone: true,
  imports: [RouterOutlet, OrganizerNavbarComponent, OrganizerSidebarComponent],
  templateUrl: './organizer-layout.component.html',
  styleUrl: './organizer-layout.component.scss'
})
export class OrganizerLayoutComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly sidebarOpen = signal(false);

  // TODO : brancher sur tes services (utilisateur connecté, notifications, messages)
  readonly userName = signal('Barry');
  readonly avatarUrl = signal<string | null>(null);
  readonly notificationCount = signal(3);
  readonly messageCount = signal(0);

  constructor() {
    // Bloque le scroll de la page quand le drawer mobile est ouvert
    effect(() => {
      this.document.body.style.overflow = this.sidebarOpen() ? 'hidden' : '';
    });
    inject(DestroyRef).onDestroy(() => (this.document.body.style.overflow = ''));
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onLogout(): void {
    // TODO : appeler ton AuthService.logout() puis rediriger
    this.router.navigate(['/login']);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (window.innerWidth >= DESKTOP_BREAKPOINT) this.closeSidebar();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeSidebar();
  }
}
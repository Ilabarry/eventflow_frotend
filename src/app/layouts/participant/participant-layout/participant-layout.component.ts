import { Component, DestroyRef, HostListener, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { ParticipantNavbarComponent } from '../navbar/navbar.component';
import { ParticipantSidebarComponent } from '../sidebar/sidebar.component';

const DESKTOP_BREAKPOINT = 1024;

@Component({
  selector: 'app-participant-layout',
  standalone: true,
  imports: [RouterOutlet, ParticipantNavbarComponent, ParticipantSidebarComponent],
  templateUrl: './participant-layout.component.html',
  styleUrl: './participant-layout.component.scss',
})
export class ParticipantLayoutComponent {
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
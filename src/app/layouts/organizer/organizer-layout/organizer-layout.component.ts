import { Component, DestroyRef, HostListener, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, interval, startWith, switchMap, catchError, of } from 'rxjs';

import { OrganizerNavbarComponent } from '../components/navbar/navbar.component';
import { OrganizerSidebarComponent } from '../components/sidebar/sidebar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationApiService } from '../../../core/services/notification-api.service';

const DESKTOP_BREAKPOINT = 1024;

@Component({
  selector: 'app-organizer-layout',
  standalone: true,
  imports: [RouterOutlet, OrganizerNavbarComponent, OrganizerSidebarComponent],
  templateUrl: './organizer-layout.component.html',
  styleUrl: './organizer-layout.component.scss',
})
export class OrganizerLayoutComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly authService = inject(AuthService);
  private readonly notificationApi = inject(NotificationApiService);
  private readonly destroy$ = new Subject<void>();

  readonly sidebarOpen = signal(false);

  // ✅ Données réactives depuis AuthService
  readonly userName = signal('');
  readonly avatarUrl = signal<string | null>(null);
  readonly notificationCount = signal(0);
  readonly messageCount = signal(0); // pas d'endpoint backend pour l'instant

  constructor() {
    // Synchroniser userName et avatarUrl depuis le signal currentUser
    effect(() => {
      const user = this.authService.currentUser();
      this.userName.set(user?.full_name || user?.first_name || 'Utilisateur');
      this.avatarUrl.set(user?.profile_picture ?? null);
    });

    // Charger le compteur de notifications au montage puis toutes les 60 s
    interval(60_000)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.notificationApi.unreadCount().pipe(
            catchError(() => of({ success: true, data: { unread_count: 0 } } as any)),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        const count = res.data?.unread_count ?? 0;
        this.notificationCount.set(count);
      });

    // Bloque le scroll quand le drawer mobile est ouvert
    effect(() => {
      this.document.body.style.overflow = this.sidebarOpen() ? 'hidden' : '';
    });

    inject(DestroyRef).onDestroy(() => {
      this.document.body.style.overflow = '';
      this.destroy$.next();
      this.destroy$.complete();
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onLogout(): void {
    this.authService.logout();
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
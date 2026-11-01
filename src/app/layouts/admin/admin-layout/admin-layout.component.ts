import { Component, DestroyRef, HostListener, computed, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, startWith, switchMap, catchError, of } from 'rxjs';

import { AdminNavbarComponent } from '../navbar/navbar.component';
import { AdminSidebarComponent } from '../sidebar/sidebar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationApiService } from '../../../core/services/notification-api.service';

const DESKTOP_BREAKPOINT = 1024;

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, AdminNavbarComponent, AdminSidebarComponent],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent {
  private readonly document = inject(DOCUMENT);
  private readonly authService = inject(AuthService);
  private readonly notificationApi = inject(NotificationApiService);

  readonly sidebarOpen = signal(false);

  // ✅ Valeurs dérivées de l'utilisateur courant (pas d'écriture manuelle)
  readonly userName = computed(() => {
    const user = this.authService.currentUser();
    return user?.full_name || user?.first_name || 'Admin';
  });
  readonly avatarUrl = computed<string | null>(
    () => this.authService.currentUser()?.profile_picture ?? null,
  );

  readonly notificationCount = signal(0);
  readonly messageCount = signal(0); // icône désactivée dans le HTML

  constructor() {
    // Compteur de notifications rafraîchi toutes les 60 s
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
        this.notificationCount.set(res.data?.unread_count ?? 0);
      });

    // Bloque le scroll quand le drawer mobile est ouvert
    effect(() => {
      this.document.body.style.overflow = this.sidebarOpen() ? 'hidden' : '';
    });

    inject(DestroyRef).onDestroy(() => {
      this.document.body.style.overflow = '';
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  onLogout(): void {
    // Délègue tout à AuthService (blacklist backend + clear state + redirection)
    this.closeSidebar();
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
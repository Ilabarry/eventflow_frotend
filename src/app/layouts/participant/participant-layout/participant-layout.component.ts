import { Component, DestroyRef, HostListener, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, interval, startWith, switchMap, catchError, of } from 'rxjs';

import { ParticipantNavbarComponent } from '../navbar/navbar.component';
import { ParticipantSidebarComponent } from '../sidebar/sidebar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationApiService } from '../../../core/services/notification-api.service';

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
  private readonly authService = inject(AuthService);
  private readonly notificationApi = inject(NotificationApiService);
  private readonly destroy$ = new Subject<void>();

  readonly sidebarOpen = signal(false);

  // ✅ Données réactives depuis AuthService
  readonly userName = signal('');
  readonly avatarUrl = signal<string | null>(null);
  readonly notificationCount = signal(0);
  readonly messageCount = signal(0); // pas d'endpoint → icône désactivée dans le HTML

  constructor() {
    // Synchronisation du nom et de l'avatar depuis le signal currentUser
    effect(() => {
      const user = this.authService.currentUser();
      this.userName.set(user?.full_name || user?.first_name || 'Participant');
      this.avatarUrl.set(user?.profile_picture ?? null);
    });

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
    // ✅ Délègue tout à AuthService :
    //   - blackliste le refresh token côté backend
    //   - vide le state + localStorage
    //   - affiche un toast
    //   - redirige vers /login
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
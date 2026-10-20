import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-organizer-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class OrganizerNavbarComponent {
  
  readonly sidebarOpen = input(false);
  readonly userName = input('Utilisateur');
  readonly avatarUrl = input<string | null>(null);
  readonly notificationCount = input(0);
  readonly messageCount = input(0);

  readonly menuToggle = output<void>();
  readonly logout = output<void>();

  readonly userMenuOpen = signal(false);
  readonly initial = computed(() => this.userName().trim().charAt(0).toUpperCase());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  badge(count: number): string {
    return count > 9 ? '9+' : String(count);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((v) => !v);
  }

  onLogout(): void {
    this.userMenuOpen.set(false);
    this.logout.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.userMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen.set(false);
  }
  
}
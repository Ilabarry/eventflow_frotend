import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { NotificationService } from '../../../core/services/notification.service';
import {
  AttendanceService,
  MyAttendanceDto,
} from '../../../core/services/attendance.service';
import { environment } from '../../../../environments/environment';
type ViewMode = 'list' | 'grid';

type LoadState = 'loading' | 'ready' | 'error';
type AttendanceFilter = 'all' | 'PRESENT' | 'ABSENT';

const PAGE_SIZE = 10;

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

@Component({
  selector: 'app-participant-presences',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './presences.component.html',
  styleUrl: './presences.component.scss',
})
export class ParticipantPresencesComponent implements OnInit {
  private readonly attendanceService = inject(AttendanceService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loadState = signal<LoadState>('loading');
  readonly items = signal<MyAttendanceDto[]>([]);

  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly totalCount = signal(0);
  readonly activeFilter = signal<AttendanceFilter>('all');

  readonly statusFilters: { value: AttendanceFilter; label: string }[] = [
    { value: 'all', label: 'Toutes' },
    { value: 'PRESENT', label: 'Présences' },
    { value: 'ABSENT', label: 'Absences' },
  ];

  /** Mode d'affichage : liste (défaut) ou grille */
  readonly view = signal<ViewMode>(
    (localStorage.getItem('evf.participant.presences.view') as ViewMode) ?? 'list'
  );

  setView(mode: ViewMode): void {
    this.view.set(mode);
    localStorage.setItem('evf.participant.presences.view', mode);
  }

  private absoluteMediaUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    const backendOrigin = environment.apiUrl.replace(/\/api\/?$/, '');
    return `${backendOrigin}${url.startsWith('/') ? url : '/' + url}`;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadState.set('loading');
    const status = this.activeFilter() === 'all' ? undefined : this.activeFilter();
    this.attendanceService
      .listMine(this.currentPage(), PAGE_SIZE, status as 'PRESENT' | 'ABSENT' | undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const page = res.data;
          const items = (page?.results ?? []).map((a) => ({
            ...a,
            event_cover_image: this.absoluteMediaUrl(a.event_cover_image),
          }));
          this.items.set(items);
          this.totalCount.set(page?.count ?? 0);
          this.totalPages.set(Math.max(1, page?.total_pages ?? 1));
          this.currentPage.set(page?.current_page ?? 1);
          this.loadState.set('ready');
        },
        error: (err) => {
          this.loadState.set('error');
          this.notification.httpError(err);
        },
      });
  }

  selectFilter(value: AttendanceFilter): void {
    if (this.activeFilter() === value) return;
    this.activeFilter.set(value);
    this.currentPage.set(1);
    this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.currentPage()) return;
    this.currentPage.set(p);
    this.load();
  }

  whenLabel(iso: string): string {
    const d = new Date(iso);
    return `${DATE_FMT.format(d)} · ${TIME_FMT.format(d).replace(':', 'h')}`;
  }

  checkedInLabel(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return TIME_FMT.format(d).replace(':', 'h');
  }

  statusLabel(status: string): string {
    return status === 'PRESENT' ? 'Présent' : 'Absent';
  }

  statusTone(status: string): string {
    return status === 'PRESENT' ? 'success' : 'danger';
  }
}
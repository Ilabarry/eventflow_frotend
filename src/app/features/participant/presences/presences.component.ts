import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { NotificationService } from '../../../core/services/notification.service';
import {
  AttendanceService,
  MyAttendanceDto,
} from '../../../core/services/attendance.service';

type LoadState = 'loading' | 'ready' | 'error';

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

  ngOnInit(): void {
    this.attendanceService
      .listMine()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.items.set(res.data?.results ?? []);
          this.loadState.set('ready');
        },
        error: (err) => {
          this.loadState.set('error');
          this.notification.httpError(err);
        },
      });
  }

  whenLabel(iso: string): string {
    const d = new Date(iso);
    return `${DATE_FMT.format(d)} · ${TIME_FMT.format(d).replace(':', 'h')}`;
  }

  statusLabel(status: string): string {
    return status === 'PRESENT' ? 'Présent' : 'Absent';
  }

  statusTone(status: string): string {
    return status === 'PRESENT' ? 'success' : 'danger';
  }
}
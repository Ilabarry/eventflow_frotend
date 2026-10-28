import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import {
  AlertLevel,
  AuditLogDto,
  AuditResult,
  SupervisionAlertDto,
} from '../../../core/models/supervision.model';
import { SupervisionService } from '../../../core/services/supervision.service';

/* ------------------------------------------------------------------
 * Constantes de la page
 * ------------------------------------------------------------------ */
const HISTORY_PAGE_SIZE = 10;

type LoadState = 'loading' | 'ready' | 'error';
type LevelFilter = AlertLevel | null;

interface LevelOption {
  label: string;
  value: LevelFilter;
}

const LEVEL_OPTIONS: readonly LevelOption[] = [
  { label: 'Toutes', value: null },
  { label: 'Critiques', value: 'CRITICAL' },
  { label: 'Attention', value: 'WARNING' },
  { label: 'Information', value: 'INFO' },
];

const LEVEL_LABELS: Record<AlertLevel, string> = {
  CRITICAL: 'Critique',
  WARNING: 'Attention',
  INFO: 'Information',
};

/** Libellés de AuditAction (supervision/constants.py), pour les exemples d'alerte. */
const ACTION_LABELS: Record<string, string> = {
  USER_SUSPENDED: 'Suspension d’un utilisateur',
  USER_ACTIVATED: 'Réactivation d’un utilisateur',
  ROLE_GRANTED: 'Attribution d’un rôle',
  ROLE_REVOKED: 'Retrait d’un rôle',
  EVENT_CANCELLED: 'Annulation d’un événement',
  CATEGORY_CREATED: 'Création d’une catégorie',
  CATEGORY_UPDATED: 'Modification d’une catégorie',
  CATEGORY_DEACTIVATED: 'Désactivation d’une catégorie',
  CATEGORY_ACTIVATED: 'Réactivation d’une catégorie',
  CATEGORY_DELETED: 'Suppression d’une catégorie',
};

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const DATE_ONLY = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

function formatDate(value: string | null | undefined, withTime = true): string {
  if (!value) {
    return '';
  }
  return (withTime ? DATE_TIME : DATE_ONLY).format(new Date(value));
}

/**
 * Présentation de chaque type d'alerte :
 * titre, page d'administration où agir, et une ligne lisible par exemple.
 */
interface AlertPresentation {
  title: string;
  link: string | null;
  linkLabel: string;
  sample: (s: Record<string, string | null>) => string;
}

const ALERTS: Record<string, AlertPresentation> = {
  SECURITY_DENIALS: {
    title: 'Actions refusées par sécurité',
    link: null,
    linkLabel: '',
    sample: (s) => {
      const action = s['action'] ?? '';
      return `${s['actor_email'] || 'Compte supprimé'} — ${ACTION_LABELS[action] ?? action} — ${formatDate(s['created_at'])}`;
    },
  },
  ENDED_EVENTS_STILL_PUBLISHED: {
    title: 'Événements terminés encore publiés',
    link: '/admin/evenements',
    linkLabel: 'Ouvrir les événements',
    sample: (s) => `${s['title']} — terminé le ${formatDate(s['end_at'], false)} — ${s['organizer__email']}`,
  },
  STALE_PENDING_REGISTRATIONS: {
    title: 'Inscriptions en attente anciennes',
    link: null,
    linkLabel: '',
    sample: (s) =>
      `${s['reference']} — ${s['event__title']} — ${s['participant__email']} — depuis le ${formatDate(s['registered_at'], false)}`,
  },
  UPCOMING_EVENTS_WITHOUT_REGISTRATIONS: {
    title: 'Événements proches sans inscrit',
    link: '/admin/evenements',
    linkLabel: 'Ouvrir les événements',
    sample: (s) => `${s['title']} — le ${formatDate(s['start_at'])} — ${s['organizer__email']}`,
  },
  SUSPENDED_ACCOUNTS: {
    title: 'Comptes suspendus',
    link: '/admin/utilisateurs',
    linkLabel: 'Ouvrir les utilisateurs',
    sample: (s) => `${s['email']} — depuis le ${formatDate(s['updated_at'], false)}`,
  },
};

/** Modèle d'affichage d'une alerte. */
interface AlertCard {
  code: string;
  level: AlertLevel;
  levelLabel: string;
  title: string;
  message: string;
  count: number;
  samples: string[];
  link: string | null;
  linkLabel: string;
  /** Les refus de sécurité se consultent dans l'historique ci-dessous. */
  showsDeniedHistory: boolean;
}

function toCard(alert: SupervisionAlertDto): AlertCard {
  const presentation = ALERTS[alert.code];
  return {
    code: alert.code,
    level: alert.level,
    levelLabel: LEVEL_LABELS[alert.level],
    title: presentation?.title ?? LEVEL_LABELS[alert.level],
    message: alert.message,
    count: alert.count,
    samples: presentation ? alert.samples.map(presentation.sample) : [],
    link: presentation?.link ?? null,
    linkLabel: presentation?.linkLabel ?? '',
    showsDeniedHistory: alert.code === 'SECURITY_DENIALS',
  };
}

/** Modèle d'affichage d'une ligne d'historique. */
interface HistoryItem {
  id: string;
  denied: boolean;
  title: string;
  actor: string;
  reason: string;
  dateIso: string;
  dateLabel: string;
}

function toHistoryItem(log: AuditLogDto): HistoryItem {
  return {
    id: log.id,
    denied: log.result === 'DENIED',
    title: `${log.action_label} — ${log.description}`,
    actor: log.actor_email || 'Compte supprimé',
    reason: log.reason,
    dateIso: log.created_at,
    dateLabel: formatDate(log.created_at),
  };
}

/* ------------------------------------------------------------------
 * Composant
 * ------------------------------------------------------------------ */
@Component({
  selector: 'app-supervision',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './supervision.component.html',
  styleUrl: './supervision.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSupervisionComponent {
  private readonly supervision = inject(SupervisionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly levelOptions = LEVEL_OPTIONS;

  // Alertes
  readonly alertsState = signal<LoadState>('loading');
  readonly alerts = signal<AlertCard[]>([]);
  readonly level = signal<LevelFilter>(null);
  readonly expanded = signal<string | null>(null);
  readonly visibleAlerts = computed(() => {
    const level = this.level();
    return level ? this.alerts().filter((alert) => alert.level === level) : this.alerts();
  });

  // Compteurs (null : donnée indisponible)
  readonly suspended = signal<number | null>(null);
  readonly adminActions = signal<number | null>(null);
  readonly counters = computed(() => {
    const total = (level: AlertLevel) =>
      this.alerts()
        .filter((alert) => alert.level === level)
        .reduce((sum, alert) => sum + alert.count, 0);
    const ready = this.alertsState() === 'ready';
    return [
      { label: 'Critiques', value: ready ? total('CRITICAL') : null, tone: 'critical', icon: 'alert' },
      { label: 'À surveiller', value: ready ? total('WARNING') : null, tone: 'warning', icon: 'flag' },
      { label: 'Comptes suspendus', value: this.suspended(), tone: 'dark', icon: 'block' },
      { label: 'Actions admin (7 j)', value: this.adminActions(), tone: 'success', icon: 'check' },
    ];
  });

  // Historique
  readonly historyState = signal<LoadState>('loading');
  readonly history = signal<HistoryItem[]>([]);
  readonly historyFilter = signal<AuditResult | null>(null);
  readonly historyPage = signal(1);
  readonly historyHasMore = signal(false);
  readonly historyLoadingMore = signal(false);
  /** Ignore les réponses d'une requête devenue obsolète (filtre changé entre-temps). */
  private historyRequest = 0;

  constructor() {
    this.loadAlerts();
    this.loadCounters();
    this.loadHistory(1);
  }

  /* --- Alertes ------------------------------------------------------- */
  selectLevel(level: LevelFilter): void {
    this.level.set(level);
    this.expanded.set(null);
  }

  toggle(code: string): void {
    this.expanded.update((current) => (current === code ? null : code));
  }

  retryAlerts(): void {
    this.loadAlerts();
  }

  /** « Voir les refus » : filtre l'historique sur les actions refusées. */
  showDeniedHistory(): void {
    this.setHistoryFilter('DENIED');
    document.getElementById('history-title')?.scrollIntoView({ behavior: 'smooth' });
  }

  /* --- Historique ---------------------------------------------------- */
  setHistoryFilter(result: AuditResult | null): void {
    if (result === this.historyFilter()) {
      return;
    }
    this.historyFilter.set(result);
    this.loadHistory(1);
  }

  loadMore(): void {
    if (this.historyHasMore() && !this.historyLoadingMore()) {
      this.loadHistory(this.historyPage() + 1);
    }
  }

  retryHistory(): void {
    this.loadHistory(1);
  }

  /* --- Chargement ---------------------------------------------------- */
  private loadAlerts(): void {
    this.alertsState.set('loading');
    this.supervision
      .listAlerts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.alerts.set((response.data ?? []).map(toCard));
          this.alertsState.set('ready');
        },
        error: () => this.alertsState.set('error'),
      });
  }

  private loadCounters(): void {
    this.supervision
      .getDashboard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.suspended.set(response.data?.users.suspended ?? null);
          this.adminActions.set(response.data?.audit.actions_last_7_days ?? null);
        },
        error: () => undefined, // les compteurs restent « — »
      });
  }

  private loadHistory(page: number): void {
    const first = page === 1;
    const request = ++this.historyRequest;
    if (first) {
      this.historyState.set('loading');
    } else {
      this.historyLoadingMore.set(true);
    }

    this.supervision
      .listAuditLogs(page, HISTORY_PAGE_SIZE, this.historyFilter())
      .pipe(
        map((response) => response.data ?? null),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => {
        if (request !== this.historyRequest) {
          return;
        }
        this.historyLoadingMore.set(false);
        if (!data) {
          if (first) {
            this.historyState.set('error');
          }
          return;
        }
        const items = data.results.map(toHistoryItem);
        this.history.update((current) => (first ? items : [...current, ...items]));
        this.historyPage.set(data.current_page);
        this.historyHasMore.set(data.current_page < data.total_pages);
        this.historyState.set('ready');
      });
  }
}

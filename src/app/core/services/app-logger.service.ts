
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

type LogContext = Readonly<
  Record<string, string | number | boolean | null>
>;

/**
 * Logger centralisé pour le frontend EVENTFLOW.
 * Les logs de diagnostic sont désactivés en production.
 */
@Injectable({
  providedIn: 'root',
})
export class AppLoggerService {
  debug(message: string, context?: LogContext): void {
    if (!environment.production) {
      console.debug(`[EVENTFLOW] ${message}`, context ?? '');
    }
  }

  info(message: string, context?: LogContext): void {
    if (!environment.production) {
      console.info(`[EVENTFLOW] ${message}`, context ?? '');
    }
  }

  warn(message: string, context?: LogContext): void {
    if (!environment.production) {
      console.warn(`[EVENTFLOW] ${message}`, context ?? '');
    }
  }

  error(message: string, context?: LogContext): void {
    // Conserver un signal d'erreur sans données personnelles.
    console.error(`[EVENTFLOW] ${message}`, context ?? '');
  }
}

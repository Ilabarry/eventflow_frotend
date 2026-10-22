import { EventDto, EventFormat, EventStatus, ParticipationType, CapacityType } from './event.model';

export type UiStatus = 'draft' | 'published' | 'finished';
export type UiFormat = '' | 'online' | 'onsite';
export type UiType = 'free' | 'paid';
export type UiCapacityMode = '' | 'limited' | 'unlimited';

/** Backend → UI */
export const toUiStatus = (s: EventStatus): UiStatus =>
  s === 'PUBLISHED' ? 'published' :
  s === 'DRAFT' ? 'draft' :
  'finished';  // CANCELLED & COMPLETED → finished

export const toUiFormat = (f: EventFormat): Exclude<UiFormat, ''> =>
  f === 'ONLINE' ? 'online' : 'onsite';  // HYBRID → onsite par défaut

export const toUiType = (p: ParticipationType): Exclude<UiType, ''> =>
  p === 'PAID' ? 'paid' : 'free';

export const toUiCapacityMode = (c: CapacityType): Exclude<UiCapacityMode, ''> =>
  c === 'LIMITED' ? 'limited' : 'unlimited';

/** UI → Backend */
export const toApiFormat = (f: UiFormat): EventFormat =>
  f === 'online' ? 'ONLINE' :
  f === 'onsite' ? 'IN_PERSON' :
  'IN_PERSON';

export const toApiType = (t: UiType): ParticipationType =>
  t === 'paid' ? 'PAID' : 'FREE';

export const toApiCapacityMode = (c: UiCapacityMode): CapacityType =>
  c === 'limited' ? 'LIMITED' : 'UNLIMITED';

/** Convertit "YYYY-MM-DD" + "HH:mm" → ISO avec timezone locale. */
export const combineDateTime = (date: string, time: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
};

/** Convertit un ISO en { date: 'YYYY-MM-DD', time: 'HH:mm' } (locale). */
export const splitIso = (iso: string): { date: string; time: string } => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};
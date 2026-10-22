import { EventDto, EventFormat, EventStatus } from '../../../core/models/event.model';
import { OrganizerEvent } from './evenements.component';

const PLACEHOLDER_IMG = 'img/event-placeholder.svg';

/**
 * Mappe un EventDto backend vers le modèle d'affichage OrganizerEvent.
 *
 * ⚠️ Suppose que le backend expose `registered_count` dans EventOrganizerSerializer.
 *    Sinon, fallback sur `capacity_limit - available_slots`.
 */
export function toOrganizerEvent(dto: EventDto): OrganizerEvent {
  return {
    id: dto.id,
    title: dto.title,
    imageUrl: dto.cover_image ?? PLACEHOLDER_IMG,
    status: mapStatus(dto.status),
    format: mapFormat(dto.format),
    category: dto.category?.name ?? '—',
    startDate: dto.start_at,
    location: dto.format === 'ONLINE' ? 'En ligne' : (dto.city || '—'),
    registered: computeRegistered(dto),
    capacity: dto.capacity_limit ?? 0,
  };
}

function mapStatus(s: EventStatus): 'published' | 'draft' | 'finished' {
  switch (s) {
    case 'PUBLISHED': return 'published';
    case 'DRAFT':     return 'draft';
    case 'CANCELLED':
    case 'COMPLETED': return 'finished';
  }
}

function mapFormat(f: EventFormat): 'Présentiel' | 'En ligne' | 'Hybride' {
  switch (f) {
    case 'IN_PERSON': return 'Présentiel';
    case 'ONLINE':    return 'En ligne';
    case 'HYBRID':    return 'Hybride';
  }
}

function computeRegistered(dto: EventDto): number {
  // Priorité 1 : champ dédié du backend
  if (dto.registered_count != null) return dto.registered_count;
  // Fallback : déduction via available_slots
  if (dto.available_slots != null && dto.capacity_limit != null) {
    return Math.max(0, dto.capacity_limit - dto.available_slots);
  }
  return 0;
}
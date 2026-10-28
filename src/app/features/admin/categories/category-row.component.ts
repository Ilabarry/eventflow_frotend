import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SupervisionCategoryDto } from '../../../core/models/supervision-category.model';

export const ICON_GLYPHS: Record<string, string> = {
  tech: '💻', digital: '💻', informatique: '💻', numeric: '💻',
  business: '💼', biz: '💼', entreprise: '💼', travail: '💼', bussiness: '💼',
  culture: '🎭', art: '🎭', arts: '🎭',
  sport: '⚽', sports: '⚽', fitness: '🏋️',
  music: '🎵', musique: '🎵', concert: '🎵',
  food: '🍽️', cuisine: '🍽️', gastro: '🍽️',
  travel: '✈️', voyage: '✈️', voyages: '✈️',
  education: '🎓', formation: '🎓',
  health: '🩺', sante: '🩺',
  finance: '📈', argent: '📈',
  nature: '🌿', environnement: '🌿',
  social: '🤝', association: '🤝',
};
const AVATAR_TONES = ['violet', 'cyan', 'green', 'amber', 'rose'] as const;

const NUMBER = new Intl.NumberFormat('fr-FR');
const DATE_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'numeric', year: '2-digit' });
const DATE_LONG = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

export interface AvatarView {
  kind: 'image' | 'glyph' | 'letter';
  value: string;
  tone: (typeof AVATAR_TONES)[number];
}

function hash(value: string): number {
  let acc = 0;
  for (let i = 0; i < value.length; i += 1) {
    acc = (acc * 31 + value.charCodeAt(i)) >>> 0;
  }
  return acc;
}

/**
 * Une ligne de la liste des catégories.
 *
 * Le composant existe parce que la maquette demande DEUX rendus du même
 * contenu : un vrai `<table>` sur écran large (structure correcte pour des
 * données tabulaires) et des cartes en dessous de 760 px (un `<td>` ne sait pas
 * se recycler en block sans perdre ses rôles d'accessibilité). Un seul fichier =
 * une seule source de vérité pour l'affichage d'une catégorie.
 *
 * `variant` ne change QUE la mise en page ; les actions, les formats et les
 * info-bulles sont identiques, pour qu'aucun écran ne cache une information.
 */
@Component({
  selector: '[app-category-row]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-row.component.html',
  styleUrl: './category-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryRowComponent {
  readonly row = input.required<SupervisionCategoryDto>();
  readonly variant = input<'table' | 'card'>('table');
  /** Action en cours sur cette ligne (désactivation, suppression…). */
  readonly busy = input(false);
  readonly menuOpen = input(false);

  readonly edit = output<void>();
  readonly changeState = output<'activate' | 'deactivate'>();
  readonly remove = output<void>();
  readonly toggleMenu = output<void>();

  readonly avatar = computed<AvatarView>(() => {
    const value = this.row();
    const raw = (value.icon ?? '').trim();
    const tone = AVATAR_TONES[hash(`${value.name}${value.id}`) % AVATAR_TONES.length];
    if (/^(https?:|\/|data:image)/i.test(raw)) {
      return { kind: 'image', value: raw, tone };
    }
    const glyph = ICON_GLYPHS[raw.toLowerCase()];
    if (glyph) {
      return { kind: 'glyph', value: glyph, tone };
    }
    return { kind: 'letter', value: (value.name.trim().charAt(0) || '?').toUpperCase(), tone };
  });

  readonly count = computed(() => NUMBER.format(this.row().events_total ?? 0));
  readonly created = computed(() => {
    const date = this.row().created_at ? new Date(this.row().created_at) : null;
    return date && !Number.isNaN(date.getTime()) ? DATE_SHORT.format(date) : '—';
  });
  readonly createdLong = computed(() => {
    const date = this.row().created_at ? new Date(this.row().created_at) : null;
    return date && !Number.isNaN(date.getTime()) ? DATE_LONG.format(date) : '';
  });
  readonly eventsHint = computed(() => {
    const value = this.row();
    return `${NUMBER.format(value.events_published ?? 0)} événement(s) publié(s) sur ${NUMBER.format(value.events_total ?? 0)} — le total inclut les brouillons.`;
  });
}
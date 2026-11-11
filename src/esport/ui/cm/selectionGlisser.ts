/**
 * Glisser-déposer des tableaux CM : pas de sélection de texte pendant un geste (voir selectionGlisser.web.ts pour le web).
 * Sur iOS / Android, le glisser est géré par PanResponder sans sélection de texte : ces fonctions ne font rien.
 */

import { Platform } from 'react-native';

export function bloquerSelection(): void {}
export function libererSelection(): void {}

/** Style des zones qui se saisissent : pas de sélection, pas de menu de maintien (iPad / iPhone), pas de surbrillance au toucher. */
export const STYLE_SAISISSABLE: Record<string, string> = Platform.OS === 'web' ? { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' } : {};

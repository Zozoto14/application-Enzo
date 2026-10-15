/**
 * Qui a le Journal automatique : tout profil à qui l'app est ouverte (le
 * Fondateur d'office, un ami par l'Administration). Le journal est PRIVÉ au
 * profil : il vit dans SA base chiffrée (`contexte.baseProfil`), n'est dans
 * aucune donnée d'administration, n'est jamais envoyé sur le relais, et chaque
 * source ne rend que ce que ce profil a le droit de voir dans l'app d'origine.
 */

import type { ContexteHub } from '../hub/types';
import { ID_JOURNAL } from './constantes';

export const accesJournal = (contexte: Pick<ContexteHub, 'baseProfil'>): boolean => Boolean(contexte.baseProfil);

export { ID_JOURNAL };

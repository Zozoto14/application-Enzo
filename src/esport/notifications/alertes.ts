/**
 * Avis de tickets et alertes techniques (docs/esport/notifications.md « Alertes et avis ») côté app : types que l'on
 * peut couper un par un (les mêmes que le serveur, esport/noyau/notifications/alertes.mjs), leur icône monochrome et la
 * phrase d'une notification (cause lisible, compteur « ×3 » quand la même erreur s'est répétée dans les 6 h).
 */

import { aCleAl, trAl, type CleAl } from '../i18n/alertes';
import type { NomIcone } from '../../ui/icones/traces';

/** Types d'avis et d'alertes, dans l'ordre des préférences. */
export const TYPES_ALERTES = ['tk-avis', 'salon-match-alerte', 'vocal-alerte', 'role-evenement-alerte', 'role-temp-alerte'] as const;
export type TypeAlerte = (typeof TYPES_ALERTES)[number];

/** Icône monochrome (src/ui/icones) de chaque type. */
export const ICONES_ALERTES: Record<TypeAlerte, NomIcone> = {
  'tk-avis': 'etoile',
  'salon-match-alerte': 'bulle',
  'vocal-alerte': 'micro',
  'role-evenement-alerte': 'bouclier',
  'role-temp-alerte': 'sablier',
};

export const estTypeAlerte = (t: string): t is TypeAlerte => (TYPES_ALERTES as readonly string[]).includes(t);

const texte = (v: unknown): string => (typeof v === 'string' && v ? v : '');
const nombre = (v: unknown): string => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? String(v) : '?');

/** Cause lisible d'un code (`hierarchie`, `categorie-pleine`, `creation-hierarchie`, `discord-500`…). */
function cause(code: string, c: Record<string, unknown>): string {
  const sansPrefixe = code.startsWith('creation-') ? code.slice('creation-'.length) : code;
  const cle = `cause.${sansPrefixe}`;
  const base = aCleAl(cle) ? trAl(cle as CleAl, { nom: texte(c.nom) || '?' }) : trAl('cause.autre', { statut: typeof c.statut === 'number' ? c.statut : (/^discord-(\d+)$/.exec(sansPrefixe)?.[1] ?? '?') });
  return code.startsWith('creation-') ? trAl('creation_refusee', { cause: base }) : base;
}

/** Phrase d'un avis ou d'une alerte (ou `undefined` si ce n'en est pas une). */
export function phraseAlerte(type: string, c: Record<string, unknown>): string | undefined {
  if (type === 'tk-avis') {
    const nom = texte(c.nom);
    return trAl('avis', { numero: nombre(c.numero), note: nombre(c.note), categorie: nom ? ` · ${nom}` : '' });
  }
  if (!estTypeAlerte(type)) return undefined;
  const n = typeof c.compteur === 'number' ? c.compteur : 1;
  const quoiCle = `quoi.${texte(c.quoi)}`;
  const vars = {
    sujet: trAl(`sujet.${type}` as CleAl),
    cause: cause(texte(c.code), c),
    compteur: n > 1 ? trAl('compteur', { n }) : '',
    quoi: aCleAl(quoiCle) ? trAl(quoiCle as CleAl) : '',
  };
  return trAl(vars.quoi ? 'alerte_quoi' : 'alerte', vars);
}

/** Type de notification de chaque événement d'alerte du bus (journal d'activité). */
const TYPE_DE_EVENEMENT: Record<string, TypeAlerte> = {
  'alerte.salon_match': 'salon-match-alerte',
  'alerte.vocal': 'vocal-alerte',
  'alerte.role_evenement': 'role-evenement-alerte',
  'alerte.role_temp': 'role-temp-alerte',
};

/** Phrase d'un événement d'alerte dans le journal (ou `undefined` si ce n'en est pas un). */
export function phraseJournalAlerte(action: string, meta: Record<string, unknown>): string | undefined {
  const type = TYPE_DE_EVENEMENT[action];
  return type ? phraseAlerte(type, meta) : undefined;
}

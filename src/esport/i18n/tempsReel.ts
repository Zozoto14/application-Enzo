/**
 * Textes du temps réel (indicateur « En direct », pastille « en train de modifier », bandeau de conflit), en
 * français et en anglais. Même fonctionnement que `tr` / `trn` ; TypeScript refuse une clé anglaise manquante.
 */

import { categoriePluriel, formaterNombre, interpoler, langueCourante, type Variables } from './index';

const fr = {
  'etat.direct': 'En direct',
  'etat.direct_aide': 'Les modifications des autres arrivent en moins d’une seconde.',
  'etat.reconnexion': 'Reconnexion…',
  'etat.reconnexion_aide': 'Connexion au serveur en cours : les modifications des autres arriveront dès qu’elle sera rétablie.',
  'etat.sondage': 'Mise à jour régulière',
  'etat.sondage_aide': 'Le serveur est en mode économe : les modifications des autres arrivent toutes les quelques secondes.',
  'presence.un': '{pseudo} est en train de modifier',
  'presence.plusieurs.one': '{pseudo} et {n} autre personne modifient',
  'presence.plusieurs.other': '{pseudo} et {n} autres personnes modifient',
  'presence.inconnu': 'Quelqu’un',
  'distant.titre': '{pseudo} a modifié cet élément {quand}.',
  'distant.supprime': '{pseudo} a supprimé cet élément {quand}.',
  'conflit.titre': 'Pas enregistré : {pseudo} a modifié cet élément {quand}.',
  'conflit.aide': 'Rien n’a été écrasé, ni vos modifications ni les siennes. Rechargez pour voir sa version, puis refaites vos changements.',
  'quand.instant': 'à l’instant',
  'quand.secondes.one': 'il y a {n} s',
  'quand.secondes.other': 'il y a {n} s',
  'quand.minutes.one': 'il y a {n} min',
  'quand.minutes.other': 'il y a {n} min',
  'action.recharger': 'Recharger',
  'action.difference': 'Voir la différence',
  'action.masquer_difference': 'Masquer la différence',
  'action.copier': 'Copier mes modifications',
  'action.copie': 'Copié',
  'action.fermer': 'Fermer',
  'difference.miennes': 'Mes modifications',
  'difference.serveur': 'Version enregistrée',
  'difference.vide': 'Aucune différence sur les champs modifiés.',
};

const en: Record<keyof typeof fr, string> = {
  'etat.direct': 'Live',
  'etat.direct_aide': 'Other people’s changes arrive in less than a second.',
  'etat.reconnexion': 'Reconnecting…',
  'etat.reconnexion_aide': 'Connecting to the server: other people’s changes will arrive as soon as it is back.',
  'etat.sondage': 'Regular updates',
  'etat.sondage_aide': 'The server is in saving mode: other people’s changes arrive every few seconds.',
  'presence.un': '{pseudo} is editing',
  'presence.plusieurs.one': '{pseudo} and {n} other person are editing',
  'presence.plusieurs.other': '{pseudo} and {n} other people are editing',
  'presence.inconnu': 'Someone',
  'distant.titre': '{pseudo} changed this item {quand}.',
  'distant.supprime': '{pseudo} deleted this item {quand}.',
  'conflit.titre': 'Not saved: {pseudo} changed this item {quand}.',
  'conflit.aide': 'Nothing was overwritten, neither your changes nor theirs. Reload to see their version, then make your changes again.',
  'quand.instant': 'just now',
  'quand.secondes.one': '{n} s ago',
  'quand.secondes.other': '{n} s ago',
  'quand.minutes.one': '{n} min ago',
  'quand.minutes.other': '{n} min ago',
  'action.recharger': 'Reload',
  'action.difference': 'See the difference',
  'action.masquer_difference': 'Hide the difference',
  'action.copier': 'Copy my changes',
  'action.copie': 'Copied',
  'action.fermer': 'Close',
  'difference.miennes': 'My changes',
  'difference.serveur': 'Saved version',
  'difference.vide': 'No difference on the changed fields.',
};

export type CleTr = keyof typeof fr;
const DICTIONNAIRES = { fr, en } as const;

/** Traduit une clé du temps réel (clé inconnue : rendue telle quelle). */
export function trTr(cle: CleTr, vars?: Variables): string {
  return interpoler((DICTIONNAIRES[langueCourante()] as Record<string, string>)[cle] ?? (fr as Record<string, string>)[cle] ?? cle, vars);
}

type CleNombreTr = CleTr extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

export function trnTr(cle: CleNombreTr, n: number, vars?: Variables): string {
  const k = `${cle}.${categoriePluriel(langueCourante(), n)}` as CleTr;
  return trTr(k, { n: formaterNombre(n), ...vars });
}

/** « il y a 12 s », « à l'instant »… */
export function ilYA(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3) return trTr('quand.instant');
  if (s < 60) return trnTr('quand.secondes', s);
  return trnTr('quand.minutes', Math.round(s / 60));
}

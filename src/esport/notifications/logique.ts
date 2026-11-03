/**
 * Logique pure du centre de notifications : phrase lisible d'une notification (fil ou personnelle), icône par
 * catégorie, date relative, regroupement par jour, période d'un filtre. Testée sans écran.
 */

import { phraseJournal, phraseNotification } from '../libelles';
import { phraseJournalSponsors } from '../sponsors/libelles';
import { formaterDate } from '../i18n';
import { trNf, trnNf, type CleNf } from '../i18n/notifications';
import { trRp, type CleRp } from '../i18n/roles';
import type { CategorieNotification, NotificationCentre } from './api';

/** Icône (glyphe) par catégorie : la même dans la liste, les filtres et les préférences. */
export const ICONES: Record<CategorieNotification, string> = {
  planning: '◷',
  competition: '♛',
  resultats: '◉',
  cm: '✎',
  drive: '▤',
  sponsors: '◆',
  membres: '☺',
  discord: '◍',
  reunions: '❐',
  objectifs: '✓',
  jeu: '◎',
  devblog: '★',
  systeme: '⚙',
};

export const libelleCategorie = (c: CategorieNotification): string => trNf(`cat.${c}` as CleNf);

const nomDe = (noms: Record<string, string | null>, id: unknown): string =>
  typeof id === 'string' ? (noms[id] ?? (id === 'principal' ? trRp('fondateur') : trRp('inconnu'))) : trRp('inconnu');

/** Phrase d'une notification : personnelle (« Vous… »), sinon celle du journal, sinon une phrase de repli. */
export function phraseCentre(n: NotificationCentre, noms: Record<string, string | null>): string {
  if (n.source === 'perso') return phraseNotification({ id: n.id, type: n.type, team: n.team, charge: n.charge, lue: n.lue, date: n.date }, noms);
  const qui = nomDe(noms, n.acteur);
  const m = n.charge;
  const texte = (v: unknown) => (typeof v === 'string' && v ? v : '');
  switch (n.type.split('.')[0]) {
    case 'devblog':
      return trNf('devblog_publie', { titre: texte(m.titre) || 'DEVBLOG' });
    case 'drive':
      // `type` (drive.ajout, migration 0040) : fichier, dossier ou nouvelle version.
      return trNf(m.type === 'dossier' ? 'drive_ajout_dossier' : m.type === 'version' ? 'drive_ajout_version' : 'drive_ajout', { qui, nom: texte(m.nom) ? ` : ${texte(m.nom)}` : '' });
    case 'trombi':
      return trNf('trombi', { qui });
    case 'game':
      return trNf('jeu_profil', { qui, nom: texte(m.nom) ? ` : ${texte(m.nom)}` : '' });
    case 'roles': {
      const action = trRp(`action.${n.type}` as CleRp);
      return action !== `action.${n.type}` ? `${qui} ${action}${texte(m.nom) ? ` « ${texte(m.nom)} »` : ''}` : trNf('roles_club', { qui });
    }
    default:
      break;
  }
  const sponsors = n.type.startsWith('sponsors.') ? phraseJournalSponsors(n.type, qui, m) : undefined;
  if (sponsors) return sponsors;
  const phrase = phraseJournal({ id: n.id, action: n.type, acteur: n.acteur, entiteType: n.entite?.type ?? null, entiteId: n.entite?.id ?? null, meta: m, date: n.date }, noms);
  // Repli du journal (« Qui : type.technique ») : une phrase lisible avec la catégorie.
  return phrase === `${qui} : ${n.type}` ? trNf('generique', { qui, categorie: libelleCategorie(n.categorie) }) : phrase;
}

/** « À l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 jours », puis la date. */
export function dateRelative(iso: string, maintenant: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.round((maintenant - t) / 1000));
  if (s < 60) return trNf('a_l_instant');
  if (s < 3600) return trnNf('il_y_a_min', Math.floor(s / 60));
  if (s < 86_400) return trnNf('il_y_a_h', Math.floor(s / 3600));
  if (s < 7 * 86_400) return trnNf('il_y_a_j', Math.floor(s / 86_400));
  return formaterDate(new Date(t), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Jour local (AAAA-MM-JJ) d'un instant. */
function jourLocal(ms: number): string {
  const d = new Date(ms);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Titre d'un groupe de jour : « Aujourd'hui », « Hier », ou la date longue. */
export function titreJour(jour: string, maintenant: number = Date.now()): string {
  if (jour === jourLocal(maintenant)) return trNf('aujourdhui');
  if (jour === jourLocal(maintenant - 86_400_000)) return trNf('hier');
  const [a, m, j] = jour.split('-').map(Number);
  return formaterDate(new Date(a, m - 1, j), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Regroupe une liste (déjà triée) par jour local, dans l'ordre de la liste. */
export function grouperParJour<T extends { date: string }>(liste: readonly T[]): Array<{ jour: string; elements: T[] }> {
  const groupes: Array<{ jour: string; elements: T[] }> = [];
  for (const n of liste) {
    const ms = Date.parse(n.date);
    const jour = Number.isFinite(ms) ? jourLocal(ms) : n.date.slice(0, 10);
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.jour === jour) dernier.elements.push(n);
    else groupes.push({ jour, elements: [n] });
  }
  return groupes;
}

export type Periode = 'tout' | 'jour' | 'semaine' | 'mois';

/** Bornes `du` (AAAA-MM-JJ, UTC) d'une période relative. */
export function bornesPeriode(p: Periode, maintenant: number = Date.now()): { du?: string } {
  const jours = p === 'jour' ? 0 : p === 'semaine' ? 6 : p === 'mois' ? 29 : -1;
  if (jours < 0) return {};
  return { du: new Date(maintenant - jours * 86_400_000).toISOString().slice(0, 10) };
}

/** Texte de la pastille (« 9+ » au-delà de 9 ; rien à zéro). */
export const pastille = (n: number): string | undefined => (n <= 0 ? undefined : n > 9 ? '9+' : String(n));

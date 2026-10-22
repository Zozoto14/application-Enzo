/** Libellés et formats de la page « Statistiques » : pages, durées, dates relatives, CSV. */

import { nomModule } from '../../client';
import { formaterNombre, tr, trOu } from '../../i18n';
import { existeStats, trStats, trStatsOu, trnStats } from '../../i18n/statistiques';

const SECTIONS_COEUR: Record<string, () => string> = {
  accueil: () => tr('pageTeam.accueil'),
  membres: () => tr('membresRoles.membres_et_roles'),
  parametres: () => tr('pageTeam.parametres'),
  journal: () => tr('journal.journal'),
};

/** « team.agenda.planning » → « Agenda › Planning » ; « esport.dashboard » → « Dashboard ». */
export function libellePage(id: string): string {
  const [espace, groupe, section] = id.split('.');
  if (espace === 'esport' && groupe) return trStatsOu(`statistiques.page.${groupe}`, groupe);
  if (espace === 'team' && groupe && section) {
    const g = trStatsOu(`statistiques.groupe.${groupe}`, groupe);
    const s = SECTIONS_COEUR[section]?.() ?? nomModule(section);
    return groupe === 'accueil' && section === 'accueil' ? g : `${g} › ${s}`;
  }
  return id;
}

/** Action clé (« repere.ajoute ») → libellé ; action du journal inconnue : son code. */
export function libelleAction(action: string): string {
  const cle = `statistiques.action.${action.replace(/\./g, '_')}`;
  return existeStats(cle) ? trStats(cle) : action;
}

export const libelleFonction = (f: string): string => trStatsOu(`statistiques.fonction.${f}`, f);
export const libelleAppareil = (a: string | null | undefined): string => (a ? trStatsOu(`statistiques.appareil.${a}`, a) : '—');
export const libelleLangue = (l: string): string => trStatsOu(`statistiques.langue.${l}`, l);
export const libelleRole = (cle: string): string => trOu(`cat.role.${cle}.nom`, cle);

/** Durée lisible : « 45 s », « 12 min », « 1 h 05 ». */
export function duree(ms: number): string {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return trStats('statistiques.duree.s', { n: s });
  const min = Math.round(s / 60);
  if (min < 60) return trStats('statistiques.duree.min', { n: min });
  return trStats('statistiques.duree.h', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') });
}

/** « Aujourd'hui », « Il y a 3 jours ». */
export function depuis(iso: string | null, maintenant = Date.now()): string {
  if (!iso) return trStats('statistiques.aucune_activite');
  const jours = Math.floor((maintenant - Date.parse(iso)) / 86_400_000);
  return jours <= 0 ? trStats('statistiques.aujourdhui') : trnStats('statistiques.il_y_a', jours);
}

/** Tendance par rapport à la période précédente. */
export function tendance(actuel: number, precedent: number): string {
  if (precedent <= 0) return actuel > 0 ? trStats('statistiques.tendance.nouveau') : trStats('statistiques.tendance.stable');
  const p = Math.round(((actuel - precedent) / precedent) * 100);
  if (p === 0) return trStats('statistiques.tendance.stable');
  return p > 0 ? trStats('statistiques.tendance.hausse', { p: formaterNombre(p) }) : trStats('statistiques.tendance.baisse', { p: formaterNombre(-p) });
}

const champ = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
/** CSV (comme les exports du serveur) : BOM UTF-8, virgules, guillemets, fins de ligne CRLF. */
export function csv(entetes: string[], lignes: Array<Array<string | number | null | undefined>>): string {
  return `\ufeff${[entetes, ...lignes].map(l => l.map(champ).join(',')).join('\r\n')}\r\n`;
}

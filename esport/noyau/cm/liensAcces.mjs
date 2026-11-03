/**
 * Visibilité d'une ressource de DATA › Ressources (migration 0048, docs/esport/cm.md, « Qui voit la ressource »).
 *
 * Une ressource (`cm_liens`) est visible de « toute l'équipe CM » (`acces = 'tous'`, défaut et valeur de toutes les
 * ressources existantes : tout lecteur de la section, selon les règles de liens.mjs), ou RESTREINTE
 * (`acces = 'restreint'`) : seulement les personnes et les rôles choisis (`cm_lien_acces`, mêmes genres et niveaux
 * que l'accès aux tableaux, acces.mjs), chacun « peut voir » (lecture seule) ou « peut modifier » (ses permissions CM
 * habituelles). Son CRÉATEUR et le Fondateur la voient toujours (et peuvent la modifier, selon leurs permissions).
 * La restriction ne DONNE jamais rien : elle s'ajoute aux contrôles de lecture habituels, elle ne fait que retirer.
 *
 * Rôles relus à chaque requête (un retrait vaut tout de suite). Module sans état.
 */

import { niveauxRegles } from './acces.mjs';

export const ACCES_LIEN = Object.freeze(['tous', 'restreint']);
const FONDATEUR = 'principal';

export const lienRestreint = l => l?.acces === 'restreint';
const estFondateur = acteur => Boolean(acteur?.superAdmin) || acteur?.compte === FONDATEUR;

/**
 * Niveau de chaque compte qui voit une ressource RESTREINTE : `Map<compte, 'voir' | 'modifier'>` (le créateur y est
 * toujours, « modifier » ; jamais le Fondateur, qui a tout d'office). `regles` : à évaluer (par défaut, celles
 * enregistrées), pour vérifier un réglage avant de l'enregistrer.
 */
export async function niveauxLien(base, l, regles = null) {
  const lignes = regles ?? (await base.tous('SELECT genre, cible, niveau FROM cm_lien_acces WHERE lien_id = ?', [l.id]));
  // Ressource du club : lisible depuis le CM de chaque team, un rôle CM d'une team compte (membre actif).
  const sortie = await niveauxRegles(base, lignes, { teamId: l.team_id ?? null, toutesTeams: !l.team_id });
  if (l.cree_par && l.cree_par !== FONDATEUR) sortie.set(l.cree_par, 'modifier');
  return sortie;
}

/** Niveau d'un acteur sur une ressource : 'modifier', 'voir' ou null. Ouverte à tous : 'modifier' (ses permissions seules). */
export async function niveauLien(base, acteur, l) {
  if (!lienRestreint(l) || estFondateur(acteur)) return 'modifier';
  if (!acteur?.compte) return null;
  if (l.cree_par && l.cree_par === acteur.compte) return 'modifier';
  return (await niveauxLien(base, l)).get(acteur.compte) ?? null;
}

/**
 * Lecture « de base » d'une ressource (avant la restriction), d'après les portées CM du compte (`porteesDe`) : il faut
 * `cm.voir` du club ou d'une team ; une ressource rattachée à une team ne se lit qu'avec `cm.voir` du club ou de cette team.
 */
export function voitPortee(portees, l) {
  const club = portees.club.has('cm.voir');
  const equipes = [...portees.teams].filter(([, s]) => s.has('cm.voir')).map(([id]) => id);
  if (!club && !equipes.length) return false;
  return club || !l.team_id || equipes.includes(l.team_id);
}

/**
 * Lecteur de plusieurs ressources (liste, cartes et dossiers liés, journal, notifications) : mémorise les niveaux.
 * `interdits()` : identifiants des ressources restreintes que l'acteur ne voit pas ; avec `portees` (`porteesDe`),
 * aussi celles qu'il ne lit pas du tout (team sans accès CM).
 */
export function lecteurLiens(base, acteur, portees = null) {
  const cache = new Map();
  const fondateur = estFondateur(acteur);
  async function niveau(l) {
    if (!lienRestreint(l) || fondateur) return 'modifier';
    if (!cache.has(l.id)) cache.set(l.id, niveauLien(base, acteur, l));
    return cache.get(l.id);
  }
  let interditsP;
  function interdits() {
    if (fondateur) return Promise.resolve([]);
    interditsP ??= (async () => {
      const sortie = [];
      // Sans aucun accès CM, la catégorie CM est déjà masquée : seules les restreintes comptent (liste courte).
      const lisible = portees && (portees.club.has('cm.voir') || [...portees.teams.values()].some(x => x.has('cm.voir'))) ? portees : null;
      const lignes = lisible ? await base.tous('SELECT id, team_id, acces, cree_par FROM cm_liens', []) : await base.tous("SELECT id, team_id, acces, cree_par FROM cm_liens WHERE acces = 'restreint'", []);
      for (const l of lignes) if ((lisible && !voitPortee(lisible, l)) || !(await niveau(l))) sortie.push(l.id);
      return sortie;
    })();
    return interditsP;
  }
  return { niveau, interdits };
}

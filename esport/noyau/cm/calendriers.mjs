/**
 * Calendriers des teams superposés au calendrier éditorial du CM (docs/esport/cm.md) : LECTURE SEULE, et
 * seulement ce que le compte a déjà le droit de voir.
 *
 *  - team dont le compte est membre actif avec `planning.view` (ou Fondateur, ou rôle du club « Accès à toutes
 *    les teams ») : son planning, tel que la page Planning le lui montre (matchs, scrims, tournois, événements ;
 *    pas les entraînements ni les réunions) ;
 *  - team dont il ne voit QUE la partie CM (CM du club, correspondant sans planning) : les matchs et tournois
 *    PUBLIABLES (competition/resume.mjs), jamais un scrim, une note, un lieu ni la description d'un événement
 *    du planning (le périmètre du CM reste celui de la section).
 *
 * Une couleur par team (ordre alphabétique, palette fixe) ; l'app mémorise par compte les teams affichées
 * (`cm_preferences`, clé `calendrier.teams`).
 */

import { echec, iso } from '../outils.mjs';
import { lireDate } from '../planning/temps.mjs';
import { resumeAnnonce } from '../competition/resume.mjs';
import { espaceCm, porteesDe, voitEspaceCm } from './commun.mjs';

export const COULEURS_TEAMS = Object.freeze(['#579dff', '#f87462', '#4bce97', '#e2b203', '#9f8fef', '#e774bb', '#6cc3e0', '#faa53d', '#94c748', '#8590a2']);
const TYPES_AFFICHES = ['match', 'scrim', 'tournament', 'other'];
const JOUR_MS = 86_400_000;
const PLAGE_MAX_JOURS = 100;
const MAX_TEAMS = 60;
const MAX_EVENEMENTS = 400;

export function servicesCalendriersCm({ base, planning }) {
  async function teams(acteur, { du, au, langue = 'fr' } = {}) {
    const d = lireDate(du ?? '');
    const f = lireDate(au ?? '');
    if (!d || !f) throw echec(400, 'periode', 'Période invalide (du, au : AAAA-MM-JJ).');
    const a = Date.parse(`${du}T00:00:00Z`);
    const b = Date.parse(`${au}T00:00:00Z`) + JOUR_MS;
    if (!(b > a) || b - a > PLAGE_MAX_JOURS * JOUR_MS) throw echec(400, 'periode', 'Période de 100 jours au plus.');
    // Calendrier de l'espace « CM du club » : équipe CM seulement (jamais un rôle de team).
    const portees = espaceCm(await porteesDe(base, acteur));
    if (!voitEspaceCm(portees)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const toutes = await base.tous('SELECT id, nom, slug FROM teams WHERE supprimee_le IS NULL ORDER BY nom, id LIMIT ?', [MAX_TEAMS]);
    const sortie = [];
    for (const [i, t] of toutes.entries()) {
      const couleur = COULEURS_TEAMS[i % COULEURS_TEAMS.length];
      const viaPlanning = await depuisPlanning(acteur, t.id, du, au);
      if (viaPlanning) {
        sortie.push({ id: t.id, nom: t.nom, couleur, acces: 'planning', evenements: viaPlanning });
        continue;
      }
      // Partie CM seulement : compétition publiable (cm.voir sur la team, module CM activé).
      if (portees.teams.get(t.id)?.has('cm.voir')) sortie.push({ id: t.id, nom: t.nom, couleur, acces: 'competition', evenements: await publiables(t.id, a, b, langue) });
    }
    return { du, au, teams: sortie };
  }

  /** Planning de la team tel que le compte le voit (null s'il n'y a pas accès). */
  async function depuisPlanning(acteur, teamId, du, au) {
    if (!planning) return null;
    let r;
    try {
      // `au` inclus : la plage du planning s'arrête au début du jour `fin`.
      r = await planning.liste(acteur, teamId, { debut: du, fin: iso(Date.parse(`${au}T00:00:00Z`) + JOUR_MS).slice(0, 10), types: TYPES_AFFICHES.join(',') });
    } catch {
      return null;
    }
    const occ = r.occurrences.slice(0, MAX_EVENEMENTS);
    // Match de tournoi passé au planning : on retrouve le match (pré-remplissage d'un post s'il est publiable).
    const ids = [...new Set(occ.map(o => o.evenementId))];
    const matchs = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const lot = ids.slice(i, i + 200);
      for (const m of await base.tous(`SELECT m.id, m.tournoi_id, m.evenement_id, t.publiable FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.team_id = ? AND m.supprime_le IS NULL AND m.evenement_id IN (${lot.map(() => '?').join(', ')})`, [teamId, ...lot])) matchs.set(m.evenement_id, m);
    }
    return occ.map(o => {
      const m = matchs.get(o.evenementId);
      return {
        id: `${o.evenementId}:${o.cle}`,
        genre: 'planning',
        type: o.type,
        titre: o.titre,
        debut: o.debut,
        fin: o.fin,
        lieu: o.lieu ?? '',
        description: o.description ?? '',
        matchId: m ? m.id : null,
        tournoiId: m ? m.tournoi_id : null,
        publiable: m ? Number(m.publiable) === 1 : false,
      };
    });
  }

  /** Matchs de tournoi et tournois publiables de la période (aucun scrim, aucun détail du planning). */
  async function publiables(teamId, a, b, langue) {
    const sortie = [];
    const matchs = await base.tous(
      "SELECT m.id, m.debut, m.fin, m.tournoi_id FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND t.publiable = 1 AND t.statut <> 'annule' AND m.statut <> 'annule' AND m.debut IS NOT NULL AND m.debut >= ? AND m.debut < ? ORDER BY m.debut LIMIT ?",
      [teamId, iso(a), iso(b), MAX_EVENEMENTS],
    );
    for (const m of matchs) {
      const r = await resumeAnnonce(base, teamId, m.id, { langue });
      if (!r) continue;
      sortie.push({ id: `match:${m.id}`, genre: 'match', type: 'match', titre: r.adversaires?.length ? `${r.titre} · ${r.adversaires.map(x => x.nom).join(', ')}` : r.titre, debut: m.debut, fin: m.fin ?? null, lieu: '', description: '', matchId: m.id, tournoiId: m.tournoi_id, publiable: true });
    }
    const jourA = iso(a).slice(0, 10);
    const jourB = iso(b).slice(0, 10);
    const tournois = await base.tous(
      "SELECT id, nom, debut, fin FROM tournois WHERE team_id = ? AND supprime_le IS NULL AND publiable = 1 AND statut <> 'annule' AND debut IS NOT NULL AND debut < ? AND COALESCE(fin, debut) >= ? ORDER BY debut LIMIT 100",
      [teamId, jourB, jourA],
    );
    for (const t of tournois) sortie.push({ id: `tournoi:${t.id}`, genre: 'tournoi', type: 'tournament', titre: t.nom, debut: `${t.debut}T00:00:00.000Z`, fin: `${t.fin ?? t.debut}T23:59:00.000Z`, jour: true, lieu: '', description: '', matchId: null, tournoiId: t.id, publiable: true });
    return sortie.sort((x, y) => x.debut.localeCompare(y.debut));
  }

  return { teams };
}

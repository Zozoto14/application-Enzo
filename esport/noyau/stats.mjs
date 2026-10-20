/**
 * Statistiques globales d'une team sur une période (plan, phase 7) :
 * présence, tâches, résumés de réunions, activité.
 *
 * Une seule route (`GET /teams/:t/stats?du&au`), ouverte à tout membre
 * actif ; chaque bloc n'apparaît que si son module est activé ET que
 * l'acteur a le droit de voir ces données en entier :
 *  - présence : `attendance.view_all` ;
 *  - tâches : `goals_tasks.view` ;
 *  - résumés : `meeting_summaries.view_all` ou `meeting_summaries.write_summary` ;
 *  - activité (journal) : `activity_log.view`.
 * Présence : même définition que la page Présence (taux = présents et retards
 * / séances marquées ; un non-convoqué venu en plus n'y entre pas).
 * Sinon le bloc vaut `null`. Requêtes agrégées (GROUP BY) : rien n'est chargé
 * ligne à ligne.
 */

import { moduleDAction } from './journal.mjs';
import { exigerPeriode } from './periode.mjs';
import { dateDuJour } from './objectifs.mjs';
import { autorise } from './permissions.mjs';
import { pseudosDe } from './requetes.mjs';
import { iso } from './outils.mjs';
import { ajouterJours, dateLocale, texteDate } from './planning/temps.mjs';

const pourcentage = (n, total) => (total > 0 ? Math.round((n / total) * 100) : null);

export function servicesStats({ base, maintenant = () => Date.now(), socle }) {
  const { contexteTeam } = socle;

  async function stats(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    const peut = p => autorise(ctx.permissions, ctx.modules, p);
    const fuseau = ctx.team.fuseau;
    // Par défaut : les 30 derniers jours (aujourd'hui compris).
    const auj = dateLocale(fuseau, maintenant());
    const lu = exigerPeriode({ du: params.du || texteDate(ajouterJours(auj, -29)), au: params.au || texteDate(auj) }, fuseau, { maxJours: 731 });
    const du = iso(lu.du);
    const au = iso(lu.au);

    const membres = await base.tous('SELECT statut, COUNT(*) AS n FROM membres WHERE team_id = ? GROUP BY statut', [teamId]);
    const sortie = {
      periode: { du: lu.debut, au: lu.fin, fuseau },
      membres: { actifs: Number(membres.find(m => m.statut === 'actif')?.n ?? 0), suspendus: Number(membres.find(m => m.statut === 'suspendu')?.n ?? 0) },
      presence: null,
      taches: null,
      resumes: null,
      activite: null,
    };

    if (peut('attendance.view_all')) {
      const lignes = await base.tous(
        'SELECT compte_id, reel, rsvp, COUNT(*) AS n FROM presences WHERE team_id = ? AND occurrence >= ? AND occurrence < ? AND hors_convocation = 0 GROUP BY compte_id, reel, rsvp',
        [teamId, du, au],
      );
      const seances = await base.premier(
        "SELECT COUNT(DISTINCT evenement_id || '|' || occurrence) AS n FROM presences WHERE team_id = ? AND occurrence >= ? AND occurrence < ? AND hors_convocation = 0",
        [teamId, du, au],
      );
      const reel = { present: 0, retard: 0, absent: 0, excuse: 0, inconnu: 0 };
      const rsvp = { oui: 0, non: 0, peut_etre: 0, sans_reponse: 0 };
      const parJoueur = new Map();
      for (const l of lignes) {
        const n = Number(l.n);
        reel[l.reel] = (reel[l.reel] ?? 0) + n;
        rsvp[l.rsvp] = (rsvp[l.rsvp] ?? 0) + n;
        const j = parJoueur.get(l.compte_id) ?? { presents: 0, marques: 0 };
        if (l.reel !== 'inconnu') j.marques += n;
        if (l.reel === 'present' || l.reel === 'retard') j.presents += n;
        parJoueur.set(l.compte_id, j);
      }
      const marques = reel.present + reel.retard + reel.absent + reel.excuse;
      const pseudos = await pseudosDe(base, [...parJoueur.keys()]);
      sortie.presence = {
        seances: Number(seances?.n ?? 0),
        reel,
        rsvp,
        taux: pourcentage(reel.present + reel.retard, marques),
        joueurs: [...parJoueur.entries()]
          .map(([compte, j]) => ({ compte, pseudo: pseudos[compte] ?? null, marques: j.marques, taux: pourcentage(j.presents, j.marques) }))
          .sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1) || String(a.pseudo ?? '').localeCompare(String(b.pseudo ?? ''), 'fr')),
      };
    }

    if (peut('goals_tasks.view')) {
      const jour = dateDuJour(maintenant(), fuseau);
      const c = await base.premier(
        `SELECT
           SUM(CASE WHEN cree_le >= ? AND cree_le < ? THEN 1 ELSE 0 END) AS creees,
           SUM(CASE WHEN termine_le >= ? AND termine_le < ? THEN 1 ELSE 0 END) AS terminees,
           SUM(CASE WHEN statut <> 'fait' THEN 1 ELSE 0 END) AS ouvertes,
           SUM(CASE WHEN statut <> 'fait' AND echeance IS NOT NULL AND echeance < ? THEN 1 ELSE 0 END) AS en_retard,
           SUM(CASE WHEN statut = 'a_faire' THEN 1 ELSE 0 END) AS a_faire,
           SUM(CASE WHEN statut = 'en_cours' THEN 1 ELSE 0 END) AS en_cours
         FROM taches WHERE team_id = ? AND supprime_le IS NULL`,
        [du, au, du, au, jour, teamId],
      );
      const objectifs = await base.tous("SELECT statut, COUNT(*) AS n FROM objectifs WHERE team_id = ? AND supprime_le IS NULL GROUP BY statut", [teamId]);
      sortie.taches = {
        creees: Number(c?.creees ?? 0),
        terminees: Number(c?.terminees ?? 0),
        ouvertes: Number(c?.ouvertes ?? 0),
        enRetard: Number(c?.en_retard ?? 0),
        aFaire: Number(c?.a_faire ?? 0),
        enCours: Number(c?.en_cours ?? 0),
        objectifs: Object.fromEntries(['actif', 'atteint', 'abandonne'].map(s => [s, Number(objectifs.find(o => o.statut === s)?.n ?? 0)])),
      };
    }

    if (peut('meeting_summaries.view_all') || peut('meeting_summaries.write_summary')) {
      const r = await base.premier(
        `SELECT
           SUM(CASE WHEN cree_le >= ? AND cree_le < ? THEN 1 ELSE 0 END) AS deposes,
           SUM(CASE WHEN resume_le >= ? AND resume_le < ? THEN 1 ELSE 0 END) AS termines,
           SUM(CASE WHEN statut <> 'termine' THEN 1 ELSE 0 END) AS attente
         FROM reunions WHERE team_id = ? AND supprime_le IS NULL`,
        [du, au, du, au, teamId],
      );
      sortie.resumes = { deposes: Number(r?.deposes ?? 0), termines: Number(r?.termines ?? 0), enAttente: Number(r?.attente ?? 0) };
    }

    if (peut('activity_log.view')) {
      const actions = await base.tous('SELECT action, COUNT(*) AS n FROM journal WHERE team_id = ? AND cree_le >= ? AND cree_le < ? GROUP BY action', [teamId, du, au]);
      const parJour = await base.tous(
        'SELECT substr(cree_le, 1, 10) AS jour, COUNT(*) AS n FROM journal WHERE team_id = ? AND cree_le >= ? AND cree_le < ? GROUP BY substr(cree_le, 1, 10) ORDER BY jour',
        [teamId, du, au],
      );
      const acteurs = await base.premier('SELECT COUNT(DISTINCT acteur_id) AS n FROM journal WHERE team_id = ? AND cree_le >= ? AND cree_le < ? AND acteur_id IS NOT NULL', [teamId, du, au]);
      const parModule = {};
      let total = 0;
      for (const a of actions) {
        const m = moduleDAction(a.action);
        parModule[m] = (parModule[m] ?? 0) + Number(a.n);
        total += Number(a.n);
      }
      sortie.activite = { actions: total, membresActifs: Number(acteurs?.n ?? 0), parModule, parJour: parJour.map(j => ({ jour: j.jour, n: Number(j.n) })) };
    }
    return sortie;
  }

  return { stats };
}

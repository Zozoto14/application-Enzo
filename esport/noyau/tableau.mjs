/**
 * Dashboard de l'Esport (premier niveau, avant d'entrer dans une team) :
 * résumé de TOUTES les teams de l'acteur, en une seule requête HTTP
 * (`GET /dashboard`).
 *
 * Périmètre : les teams où l'acteur est membre actif (toutes pour le super
 * admin). Pour chaque bloc, le module doit être activé ET l'acteur doit avoir
 * la permission de lecture correspondante dans la team ; sinon le bloc vaut
 * `null` (l'app ne l'affiche pas). Les données sont lues par lots
 * (`team_id IN (…)`) : quelques requêtes en tout, pas une série par team.
 */

import { autorise } from './permissions.mjs';
import { occurrences, DEPLACEMENT_MAX_MS } from './planning/recurrence.mjs';
import { dateLocale, texteDate } from './planning/temps.mjs';
import { dateDuJour } from './objectifs.mjs';
import { convocationDe, estConvoque, normaliserConvocation } from './planning/convocations.mjs';
import { iso, jsonOu } from './outils.mjs';

const JOUR_MS = 86_400_000;
const MARGE_MS = DEPLACEMENT_MAX_MS + JOUR_MS;
const HORIZON_JOURS = 30;
const PRESENCE_JOURS = 14;
const RESUME_ANCIEN_JOURS = 7;

export function servicesTableau({ base, maintenant = () => Date.now(), noyau }) {
  async function tableau(acteur) {
    const t = maintenant();
    const ctxs = await noyau.contextesDe(acteur);
    const vide = { genereLe: iso(t), teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } };
    if (ctxs.length === 0) return vide;
    const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);
    const ids = ctxs.map(c => c.team.id);
    const dans = (liste, f) => {
      const choisis = ctxs.filter(f).map(c => c.team.id);
      return choisis.length > 0 ? liste(choisis) : Promise.resolve([]);
    };

    // ---- Membres (actifs, suspendus, invités pas encore connectés).
    const membres = await base.tous(
      `SELECT m.team_id, m.statut, CASE WHEN c.invite_le IS NOT NULL AND c.active_le IS NULL THEN 1 ELSE 0 END AS invite, COUNT(*) AS n
         FROM membres m JOIN comptes c ON c.id = m.compte_id
        WHERE m.team_id IN (${ids.map(() => '?').join(', ')}) GROUP BY m.team_id, m.statut, invite`,
      ids,
    );

    // ---- Planning : occurrences des 30 prochains jours (module + planning.view).
    const avecPlanning = ctxs.filter(c => peut(c, 'planning.view'));
    const au = t + HORIZON_JOURS * JOUR_MS;
    const evs = await dans(
      choisis =>
        base.tous(
          `SELECT * FROM planning_evenements
            WHERE team_id IN (${choisis.map(() => '?').join(', ')}) AND supprime_le IS NULL AND debut < ?
              AND (fin > ? OR (recurrence IS NOT NULL AND (fin_serie IS NULL OR fin_serie >= ?)))`,
          [...choisis, iso(au + MARGE_MS), iso(t - MARGE_MS), texteDate(dateLocale('UTC', t - MARGE_MS))],
        ),
      c => avecPlanning.includes(c),
    );
    const exceptions = new Map(evs.map(e => [e.id, new Map()]));
    if (evs.length > 0) {
      for (const x of await base.tous(`SELECT * FROM planning_exceptions WHERE evenement_id IN (${evs.map(() => '?').join(', ')})`, evs.map(e => e.id))) {
        exceptions.get(x.evenement_id)?.set(x.occurrence, x);
      }
    }
    // « Mes prochains événements » : ceux où l'acteur est CONVOQUÉ (un Propriétaire non coché n'est pas attendu).
    const moiDans = new Map(
      ctxs
        .filter(c => c.membre && c.membre.statut === 'actif')
        .map(c => [c.team.id, { compte: acteur.compte, cle: c.role?.cle_systeme ?? null, proprietaire: c.role?.cle_systeme === 'proprietaire', perms: c.permissions, rejointLe: c.membre.rejoint_le }]),
    );
    const occurrencesParTeam = new Map();
    for (const ev of evs) {
      const moi = moiDans.get(ev.team_id);
      if (!moi) continue;
      for (const o of occurrences(ev, t, au, exceptions.get(ev.id))) {
        if (o.fin <= t) continue;
        const convocation = (o.convocation && normaliserConvocation(o.convocation)) || convocationDe(ev);
        if (!estConvoque(convocation, moi, o.fin)) continue;
        const liste = occurrencesParTeam.get(ev.team_id) ?? [];
        liste.push({ teamId: ev.team_id, evenementId: ev.id, cle: o.cle, type: ev.type, titre: o.titre ?? ev.titre, debut: iso(o.debut), fin: iso(o.fin), lieu: o.lieu ?? ev.lieu ?? '' });
        occurrencesParTeam.set(ev.team_id, liste);
      }
    }
    for (const liste of occurrencesParTeam.values()) liste.sort((a, b) => a.debut.localeCompare(b.debut));

    // ---- Présence récente (14 jours ; module + attendance.view_all) : présences réelles marquées.
    const presences = await dans(
      choisis =>
        base.tous(
          `SELECT team_id, reel, COUNT(*) AS n FROM presences
            WHERE team_id IN (${choisis.map(() => '?').join(', ')}) AND occurrence >= ? AND occurrence < ? AND reel <> 'inconnu'
            GROUP BY team_id, reel`,
          [...choisis, iso(t - PRESENCE_JOURS * JOUR_MS), iso(t)],
        ),
      c => peut(c, 'attendance.view_all'),
    );

    // ---- Résumés en attente (module + rédacteur ou lecteur de tout).
    const lecteurResumes = c => peut(c, 'meeting_summaries.write_summary') || peut(c, 'meeting_summaries.view_all');
    const resumes = await dans(
      choisis =>
        base.tous(
          `SELECT team_id, statut, COUNT(*) AS n, MIN(cree_le) AS plus_ancien FROM reunions
            WHERE team_id IN (${choisis.map(() => '?').join(', ')}) AND supprime_le IS NULL AND statut <> 'termine'
            GROUP BY team_id, statut`,
          choisis,
        ),
      lecteurResumes,
    );

    // ---- Tâches en retard (module + goals_tasks.view) : échéance passée dans le fuseau de la team.
    const taches = await dans(
      choisis =>
        base.tous(
          `SELECT team_id, echeance FROM taches
            WHERE team_id IN (${choisis.map(() => '?').join(', ')}) AND supprime_le IS NULL AND statut <> 'fait' AND echeance IS NOT NULL AND echeance <= ?`,
          [...choisis, iso(t + JOUR_MS).slice(0, 10)],
        ),
      c => peut(c, 'goals_tasks.view'),
    );

    // ---- Dernière activité : la date pour toute team ; le détail avec le Journal (activity_log.view).
    const dernieres = await base.tous(
      `SELECT j.team_id, j.action, j.acteur_id, j.meta, j.cree_le FROM journal j
        WHERE j.team_id IN (${ids.map(() => '?').join(', ')})
          AND j.cree_le = (SELECT MAX(j2.cree_le) FROM journal j2 WHERE j2.team_id = j.team_id)`,
      ids,
    );
    const pseudos = new Map();
    const acteurs = [...new Set(dernieres.map(d => d.acteur_id).filter(Boolean))];
    if (acteurs.length > 0) {
      for (const c of await base.tous(`SELECT id, pseudo FROM comptes WHERE id IN (${acteurs.map(() => '?').join(', ')})`, acteurs)) pseudos.set(c.id, c.pseudo);
    }

    // ---- Assemblage, team par team.
    const teams = [];
    const alertes = [];
    let resumesARediger = 0;
    const semaine = [];
    for (const ctx of ctxs) {
      const id = ctx.team.id;
      const nom = ctx.team.nom;
      const lignesMembres = membres.filter(l => l.team_id === id);
      const somme = f => lignesMembres.filter(f).reduce((s, l) => s + Number(l.n), 0);
      const effectif = { actifs: somme(l => l.statut === 'actif' && Number(l.invite) === 0), invites: somme(l => Number(l.invite) === 1), suspendus: somme(l => l.statut === 'suspendu') };

      const planning = avecPlanning.includes(ctx) ? (occurrencesParTeam.get(id) ?? []) : null;
      if (planning) for (const o of planning) if (Date.parse(o.debut) < t + 7 * JOUR_MS) semaine.push({ ...o, teamNom: nom });

      let presence = null;
      if (peut(ctx, 'attendance.view_all')) {
        const de = reel => Number(presences.find(p => p.team_id === id && p.reel === reel)?.n ?? 0);
        const presents = de('present') + de('retard');
        const marques = presents + de('absent') + de('excuse');
        presence = { jours: PRESENCE_JOURS, marques, presents, taux: marques > 0 ? Math.round((presents * 100) / marques) : null };
        if (marques >= 5 && presence.taux < 60) alertes.push({ genre: 'presence', teamId: id, teamNom: nom, nombre: presence.taux, texte: `Présence de ${presence.taux} % sur ${PRESENCE_JOURS} jours` });
      }

      let resumesTeam = null;
      if (lecteurResumes(ctx)) {
        const lignes = resumes.filter(r => r.team_id === id);
        const aResumer = Number(lignes.find(r => r.statut === 'a_resumer')?.n ?? 0);
        const enCours = Number(lignes.find(r => r.statut === 'en_cours')?.n ?? 0);
        const plusAncien = lignes.map(r => r.plus_ancien).filter(Boolean).sort()[0] ?? null;
        const redacteur = peut(ctx, 'meeting_summaries.write_summary');
        resumesTeam = { aResumer, enCours, plusAncien, redacteur };
        if (redacteur) resumesARediger += aResumer + enCours;
        if (plusAncien && t - Date.parse(plusAncien) > RESUME_ANCIEN_JOURS * JOUR_MS) {
          alertes.push({ genre: 'resumes', teamId: id, teamNom: nom, nombre: aResumer + enCours, texte: `Résumé en attente depuis plus de ${RESUME_ANCIEN_JOURS} jours` });
        }
      }

      let tachesTeam = null;
      if (peut(ctx, 'goals_tasks.view')) {
        const jour = dateDuJour(t, ctx.team.fuseau);
        const enRetard = taches.filter(x => x.team_id === id && x.echeance < jour).length;
        tachesTeam = { enRetard };
        if (enRetard > 0) alertes.push({ genre: 'taches', teamId: id, teamNom: nom, nombre: enRetard, texte: `${enRetard} tâche${enRetard > 1 ? 's' : ''} en retard` });
      }

      if (effectif.invites > 0 && ctx.permissions.has('members.invite')) {
        alertes.push({ genre: 'invites', teamId: id, teamNom: nom, nombre: effectif.invites, texte: `${effectif.invites} invité${effectif.invites > 1 ? 's' : ''} pas encore connecté${effectif.invites > 1 ? 's' : ''}` });
      }

      const derniere = dernieres.filter(d => d.team_id === id).sort((a, b) => b.cree_le.localeCompare(a.cree_le))[0];
      const journalVisible = peut(ctx, 'activity_log.view');
      teams.push({
        team: noyau.teamPublique(ctx.team),
        role: ctx.role ? { nom: ctx.role.nom, couleur: ctx.role.couleur, cle: ctx.role.cle_systeme ?? null } : null,
        effectif,
        prochains: planning ? planning.slice(0, 3) : null,
        presence,
        resumes: resumesTeam,
        taches: tachesTeam,
        derniereActivite: derniere
          ? {
              date: derniere.cree_le,
              ...(journalVisible ? { action: derniere.action, acteur: derniere.acteur_id, pseudo: pseudos.get(derniere.acteur_id) ?? null, meta: jsonOu(derniere.meta, {}) } : {}),
            }
          : null,
      });
    }
    semaine.sort((a, b) => a.debut.localeCompare(b.debut));
    return { genereLe: iso(t), teams, global: { resumesARediger, evenementsSemaine: semaine.slice(0, 40), alertes } };
  }

  return { tableau };
}

/**
 * Événements de domaine des modules « Tournois » et « Résultats », et leur abonné « notifications
 * in-app ». Le journal reçoit déjà tout événement (abonneJournal) ; Discord s'abonne à
 * `tournoi.inscrit`, `tournoi.match_planifie`, `match.resultat_saisi` et `tournoi.termine`
 * (discord/catalogue.mjs ; messages EN + fil FR, embeds tirés du résumé publiable).
 *
 * Notifications : le roster est prévenu de l'inscription et du classement final ; les joueurs alignés
 * d'un résultat visible de toute la team sont prévenus de sa saisie. Les matchs du tournoi passent par
 * le planning (événement créé pour le roster : notifications et rappels habituels des convoqués).
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

export const TYPES_COMPETITION = [
  'tournoi.cree',
  'tournoi.modifie',
  'tournoi.roster_change',
  'tournoi.inscrit',
  'tournoi.checkin',
  'tournoi.statut_change',
  'tournoi.termine',
  'tournoi.annule',
  'tournoi.supprime',
  'tournoi.match_ajoute',
  'tournoi.match_planifie',
  'tournoi.match_modifie',
  'tournoi.match_supprime',
  'match.resultat_saisi',
  'match.resultat_modifie',
  'match.resultat_supprime',
];

async function notifier(base, ev, compte, type, charge) {
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le],
  );
}

/** Comptes actifs de la team parmi `comptes` qui ont la permission (Propriétaires compris). */
async function avecPermission(base, teamId, comptes, permission) {
  if (comptes.length === 0) return [];
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = ?
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)
       AND m.compte_id IN (${comptes.map(() => '?').join(', ')})`,
    [permission, teamId, ...comptes],
  );
  return lignes.map(l => l.compte);
}

async function moduleActif(base, teamId, module) {
  const l = await base.premier('SELECT active FROM team_modules WHERE team_id = ? AND module = ?', [teamId, module]);
  return Boolean(l && Number(l.active) === 1);
}

export async function abonneCompetition(base, ev) {
  if (!TYPES_COMPETITION.includes(ev.type) || !ev.team_id) return;
  let charge = {};
  try {
    charge = JSON.parse(ev.charge ?? '{}');
  } catch {
    charge = {};
  }
  if (ev.type === 'tournoi.inscrit' || ev.type === 'tournoi.termine') {
    if (!(await moduleActif(base, ev.team_id, 'tournois'))) return;
    const roster = (await base.tous('SELECT compte_id FROM tournoi_roster WHERE tournoi_id = ? AND team_id = ?', [ev.entite_id, ev.team_id])).map(l => l.compte_id);
    const type = ev.type === 'tournoi.inscrit' ? 'tournoi-inscrit' : 'tournoi-termine';
    for (const compte of await avecPermission(base, ev.team_id, roster, 'tournois.voir')) {
      if (compte !== ev.acteur_id) await notifier(base, ev, compte, type, { tournoi: ev.entite_id, nom: charge.nom ?? null, place: charge.classementFinal ?? null });
    }
    return;
  }
  if (ev.type === 'match.resultat_saisi') {
    if (!(await moduleActif(base, ev.team_id, 'resultats'))) return;
    // Relu : un résultat réservé au staff (ou supprimé entre-temps) ne prévient personne.
    const r = await base.premier('SELECT visibilite, supprime_le FROM resultats WHERE id = ? AND team_id = ?', [ev.entite_id, ev.team_id]);
    if (!r || r.supprime_le || r.visibilite !== 'team') return;
    const joueurs = (await base.tous('SELECT compte_id FROM resultat_joueurs WHERE resultat_id = ? AND compte_id IS NOT NULL', [ev.entite_id])).map(l => l.compte_id);
    for (const compte of await avecPermission(base, ev.team_id, joueurs, 'resultats.voir')) {
      if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'resultat-saisi', { resultat: ev.entite_id, issue: charge.issue ?? null, place: charge.place ?? null, adversaire: charge.adversaire ?? null, score: charge.score ?? null });
    }
  }
}

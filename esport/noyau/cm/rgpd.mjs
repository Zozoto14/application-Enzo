/**
 * RGPD de la section CM.
 *
 *  - Export (droit d'accès) : rôles CM, cartes créées, cartes où le compte est assigné, commentaires,
 *    clips proposés, liens utiles ajoutés, fichiers déposés, modèles de visuels et visuels créés, fichiers du Drive et favoris ; réunions
 *    de l'équipe CM (organisées ou invitées, sa réponse), ses disponibilités, son statut, ses offres de rendez-vous.
 *  - Suppression du compte : ses affectations et ses assignations disparaissent ; ce qu'il a écrit pour le
 *    club (cartes, commentaires, clips, pièces jointes, modèles et visuels) reste, sans auteur (« Compte
 *    supprimé ») ; il est retiré des membres liés aux posts. Réunions : il quitte les participants ; ses disponibilités,
 *    son statut, ses abonnements iCal, ses MP en file disparaissent ; ses offres de rendez-vous ferment (créneaux
 *    libres retirés) ; les réunions qu'il organisait restent au club, sans organisateur.
 */

import { jsonOu } from '../outils.mjs';
import { TEAM_CM_ID } from './teamCm.mjs';

export async function exportCm(base, compte) {
  const q = (sql, params = [compte]) => base.tous(`${sql} LIMIT 5000`, params);
  const tableaux = new Map((await base.tous('SELECT id, nom, cle_defaut FROM cm_tableaux', [])).map(t => [t.id, t.nom ?? t.cle_defaut ?? null]));
  const teams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, t.nom]));
  return {
    cmRoles: (await q('SELECT a.portee, a.cree_le, r.nom FROM cm_affectations a JOIN cm_roles r ON r.id = a.role_id WHERE a.compte_id = ? ORDER BY a.cree_le')).map(a => ({ role: a.nom, portee: a.portee === 'club' ? 'club' : (teams.get(a.portee) ?? a.portee), depuis: a.cree_le })),
    cmCartesCreees: (await q('SELECT tableau_id, titre, statut, origine, cree_le FROM cm_cartes WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(c => ({ tableau: tableaux.get(c.tableau_id) ?? null, titre: c.titre, statut: c.statut ?? null, origine: c.origine, creeLe: c.cree_le })),
    // Commentaires non lus (migration 0045) : quand il a ouvert chaque carte (ou marqué un tableau lu) et les cartes suivies.
    cmCommentairesVus: (await q('SELECT v.cle, v.vu_le, c.titre FROM cm_commentaires_vus v LEFT JOIN cm_cartes c ON c.id = v.cle WHERE v.compte_id = ? ORDER BY v.vu_le')).map(v => ({ cible: v.cle === '*' ? 'premier passage' : v.cle.startsWith('t:') ? `tableau : ${tableaux.get(v.cle.slice(2)) ?? v.cle.slice(2)}` : `carte : ${v.titre ?? v.cle}`, vuLe: v.vu_le })),
    cmCartesSuivies: (await q('SELECT c.tableau_id, c.titre, s.cree_le FROM cm_carte_suivis s JOIN cm_cartes c ON c.id = s.carte_id WHERE s.compte_id = ? AND c.supprime_le IS NULL ORDER BY s.cree_le')).map(c => ({ tableau: tableaux.get(c.tableau_id) ?? null, titre: c.titre, depuis: c.cree_le })),
    // Cartes favorites (migration 0074).
    cmCartesFavorites: (await q('SELECT c.tableau_id, c.titre, f.cree_le FROM cm_carte_favoris f JOIN cm_cartes c ON c.id = f.carte_id WHERE f.compte_id = ? AND c.supprime_le IS NULL ORDER BY f.cree_le')).map(c => ({ tableau: tableaux.get(c.tableau_id) ?? null, titre: c.titre, depuis: c.cree_le })),
    cmCartesAssignees: (await q('SELECT c.tableau_id, c.titre FROM cm_carte_membres m JOIN cm_cartes c ON c.id = m.carte_id WHERE m.compte_id = ? AND c.supprime_le IS NULL')).map(c => ({ tableau: tableaux.get(c.tableau_id) ?? null, titre: c.titre })),
    cmCommentaires: (await q('SELECT c.titre, x.texte, x.cree_le FROM cm_commentaires x JOIN cm_cartes c ON c.id = x.carte_id WHERE x.auteur_id = ? AND x.supprime_le IS NULL ORDER BY x.cree_le')).map(x => ({ carte: x.titre, texte: x.texte, date: x.cree_le })),
    cmClips: (await q('SELECT team_id, genre, url, titre, description, instant, statut, motif, cree_le FROM cm_clips WHERE propose_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(x => ({ team: teams.get(x.team_id) ?? null, genre: x.genre, url: x.url ?? null, titre: x.titre, description: x.description, instant: x.instant === null ? null : Number(x.instant), statut: x.statut, motif: x.motif ?? null, date: x.cree_le })),
    cmFichiers: (await q("SELECT nom_original, taille, type_mime, cree_le FROM cm_fichiers WHERE depose_par = ? AND supprime_le IS NULL ORDER BY cree_le")).map(f => ({ nom: f.nom_original, taille: Number(f.taille), type: f.type_mime, date: f.cree_le })),
    cmModeles: (await q('SELECT nom, type, portee, cree_le FROM cm_modeles WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(m => ({ nom: m.nom, type: m.type, portee: m.portee === 'club' ? 'club' : (teams.get(m.portee) ?? m.portee), creeLe: m.cree_le })),
    // Drive (migration 0027) : fichiers déposés (ou ajoutés en version) et favoris.
    cmDrive: (await q('SELECT nom, type_mime, taille, portee, version, cree_le FROM cm_drive_fichiers WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(f => ({ nom: f.nom, type: f.type_mime, taille: Number(f.taille), version: Number(f.version), portee: f.portee === 'club' ? 'club' : (teams.get(f.portee) ?? f.portee), date: f.cree_le })),
    cmPreferences: (await q('SELECT cle, valeur, maj_le FROM cm_preferences WHERE compte_id = ? ORDER BY cle')).map(p => ({ cle: p.cle, valeur: p.valeur, date: p.maj_le })),
    // Tableaux restreints où le compte figure nommément (migration 0046).
    cmTableauxAcces: (await q("SELECT a.niveau, a.ajoute_le, t.nom, t.cle_defaut FROM cm_tableau_acces a JOIN cm_tableaux t ON t.id = a.tableau_id WHERE a.genre = 'compte' AND a.cible = ? ORDER BY a.ajoute_le")).map(a => ({ tableau: a.nom ?? a.cle_defaut, niveau: a.niveau, depuis: a.ajoute_le })),
    cmDriveFavoris: (await q('SELECT genre, cree_le FROM cm_drive_favoris WHERE compte_id = ? ORDER BY cree_le')).map(f => ({ genre: f.genre, date: f.cree_le })),
    cmReunions: (await q("SELECT r.titre, r.genre, r.debut, r.fin, r.fuseau, r.statut, r.organisateur_id, p.reponse, p.commentaire FROM cm_reunion_participants p JOIN cm_reunions r ON r.id = p.reunion_id WHERE p.compte_id = ? ORDER BY r.debut")).map(r => ({ titre: r.titre, genre: r.genre, debut: r.debut, fin: r.fin, fuseau: r.fuseau, statut: r.statut, organisateur: r.organisateur_id === compte, reponse: r.reponse, commentaire: r.commentaire })),
    // Disponibilités de l'équipe CM = celles de la team CM du club (migration 0081) : semaine type, absences et
    // congés (aussi dans `disponibilites` de l'export Esport), et la semaine type mise de côté à l'unification.
    cmDisponibilites: {
      creneaux: (await q(`SELECT jour, debut, fin, type, fuseau FROM dispo_regles WHERE compte_id = ? AND team_id = ? ORDER BY jour, debut`, [compte, TEAM_CM_ID])).map(r => ({ jour: Number(r.jour), debut: r.debut, fin: r.fin, type: r.type, fuseau: r.fuseau })),
      exceptions: (await q(`SELECT debut, fin, type, motif, note FROM dispo_exceptions WHERE compte_id = ? AND team_id = ? ORDER BY debut`, [compte, TEAM_CM_ID])).map(x => ({ debut: x.debut, fin: x.fin, type: x.motif ?? x.type, note: x.note })),
      misesDeCote: (await q('SELECT jour, debut, fin, type, fuseau, origine, repris_le FROM dispo_regles_reprises WHERE compte_id = ? ORDER BY jour, debut')).map(r => ({ jour: Number(r.jour), debut: r.debut, fin: r.fin, type: r.type, fuseau: r.fuseau, origine: r.origine, le: r.repris_le })),
      statut: (await q('SELECT fuseau, statut, message, statut_jusqua FROM cm_reunion_profils WHERE compte_id = ?')).map(x => ({ fuseau: x.fuseau, statut: x.statut, message: x.message, jusqua: x.statut_jusqua }))[0] ?? null,
    },
    cmRendezVous: (await q('SELECT titre, description, duree_minutes, ouverte, cree_le FROM cm_rdv_offres WHERE proprietaire_id = ? ORDER BY cree_le')).map(o => ({ titre: o.titre, description: o.description, dureeMinutes: Number(o.duree_minutes), ouverte: Number(o.ouverte) === 1, creeLe: o.cree_le })),
    // Nouveautés du Drive (migration 0041) : dossiers vus et quand (pour les pastilles « nouveau »).
    cmDriveVus: (await q('SELECT portee, dossier, vu_le FROM cm_drive_vus WHERE compte_id = ? ORDER BY vu_le')).map(v => ({ portee: v.portee === 'club' ? 'club' : (teams.get(v.portee) ?? v.portee), dossier: v.dossier, vuLe: v.vu_le })),
    // Liens utiles de DATA › Ressources (migration 0045) : ceux qu'il a ajoutés.
    // Fichiers des ressources (migration 0051) : genre et nom du fichier (ses octets sont dans `cmDrive` s'il les a envoyés).
    cmLiens: (await q('SELECT l.titre, l.url, l.categorie, l.cree_le, l.acces, l.genre, l.source, f.nom AS fichier FROM cm_liens l LEFT JOIN cm_drive_fichiers f ON f.id = l.element_id WHERE l.cree_par = ? ORDER BY l.cree_le')).map(l => ({ titre: l.titre, genre: l.genre ?? 'lien', ...(l.genre === 'fichier' ? { fichier: l.source === 'envoi' ? (l.fichier ?? null) : null, source: l.source ?? null } : { url: l.url }), categorie: l.categorie ?? null, acces: l.acces ?? 'tous', creeLe: l.cree_le })),
    // Ressources restreintes où le compte figure nommément, et ressources partagées avec lui (migration 0048).
    cmLiensAcces: (await q("SELECT a.niveau, a.ajoute_le, l.titre FROM cm_lien_acces a JOIN cm_liens l ON l.id = a.lien_id WHERE a.genre = 'compte' AND a.cible = ? ORDER BY a.ajoute_le")).map(a => ({ ressource: a.titre, niveau: a.niveau, depuis: a.ajoute_le })),
    cmLiensPartages: (await q('SELECT p.partage_le, p.vu_le, l.titre FROM cm_lien_partages p JOIN cm_liens l ON l.id = p.lien_id WHERE p.compte_id = ? ORDER BY p.partage_le')).map(p => ({ ressource: p.titre, date: p.partage_le, vu: p.vu_le ?? null })),
    cmVisuelsDossiers: (await q('SELECT nom, cle, portee, cree_le FROM cm_visuels_dossiers WHERE cree_par = ? ORDER BY cree_le')).map(d => ({ nom: d.nom ?? d.cle, portee: d.portee === 'club' ? 'club' : (teams.get(d.portee) ?? d.portee), creeLe: d.cree_le })),
    cmVisuels: (await q('SELECT nom, type, format, langue, portee, cree_le FROM cm_visuels WHERE cree_par = ? AND supprime_le IS NULL ORDER BY cree_le')).map(v => ({ nom: v.nom, type: v.type, format: v.format, langue: v.langue, portee: v.portee === 'club' ? 'club' : (teams.get(v.portee) ?? v.portee), creeLe: v.cree_le })),
  };
}

/** Instructions d'effacement (à mettre dans le lot de la suppression du compte). */
export async function effacementCm(base, compte) {
  const lot = [
    { sql: 'DELETE FROM cm_affectations_directes WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_preferences WHERE compte_id = ?', params: [compte] },
    // Accès nominatifs aux tableaux restreints (migration 0046).
    { sql: "DELETE FROM cm_tableau_acces WHERE genre = 'compte' AND cible = ?", params: [compte] },
    { sql: 'UPDATE cm_tableau_acces SET ajoute_par = NULL WHERE ajoute_par = ?', params: [compte] },
    { sql: 'DELETE FROM cm_carte_membres WHERE compte_id = ?', params: [compte] },
    // Migration 0045 : son état « lu » des commentaires et ses cartes suivies disparaissent.
    { sql: 'DELETE FROM cm_commentaires_vus WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_carte_suivis WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_carte_favoris WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_commentaires SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
    { sql: 'UPDATE cm_activite SET acteur_id = NULL WHERE acteur_id = ?', params: [compte] },
    { sql: 'UPDATE cm_clips SET propose_par = NULL WHERE propose_par = ?', params: [compte] },
    { sql: 'UPDATE cm_clips SET decide_par = NULL WHERE decide_par = ?', params: [compte] },
    { sql: 'UPDATE cm_pieces SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: "UPDATE cm_fichiers SET depose_par = '' WHERE depose_par = ?", params: [compte] },
    { sql: 'UPDATE cm_tableaux SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_imports SET importe_par = NULL WHERE importe_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reglages SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_affectations_directes SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_charte SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_modeles SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_modeles SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_modele_versions SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels SET rendu_par = NULL WHERE rendu_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuel_images SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    // Drive (migration 0027) : ses fichiers restent au club, sans auteur ; ses favoris disparaissent.
    { sql: 'DELETE FROM cm_drive_favoris WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_fichiers SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_fichiers SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_fichiers SET supprime_par = NULL WHERE supprime_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_versions SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_dossiers SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_dossiers SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_drive_dossiers SET supprime_par = NULL WHERE supprime_par = ?', params: [compte] },
    // Migration 0041 : son état « vu » du Drive disparaît ; les dossiers de visuels qu'il a créés restent, sans auteur.
    { sql: 'DELETE FROM cm_drive_vus WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels_dossiers SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_visuels_dossiers SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    // Migration 0043 : le rangement des modèles par défaut qu'il a fait reste, sans auteur.
    { sql: 'UPDATE cm_visuels_defauts SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    // Migration 0044 : ses liens et leurs liaisons restent au club, sans auteur.
    { sql: 'UPDATE cm_liens SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_liens SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_lien_liaisons SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    // Migration 0048 : ses accès nominatifs et ses partages reçus disparaissent ; ceux qu'il a donnés restent, sans auteur.
    { sql: "DELETE FROM cm_lien_acces WHERE genre = 'compte' AND cible = ?", params: [compte] },
    { sql: 'UPDATE cm_lien_acces SET ajoute_par = NULL WHERE ajoute_par = ?', params: [compte] },
    { sql: 'DELETE FROM cm_lien_partages WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_lien_partages SET partage_par = NULL WHERE partage_par = ?', params: [compte] },
  ];
  // Réunions de l'équipe CM (migration 0039).
  lot.push(
    { sql: 'DELETE FROM cm_reunion_participants WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_reunion_rappels WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_reunion_mp WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_reunion_ical WHERE compte_id = ?', params: [compte] },
    // Disponibilités (team CM du club, migration 0081) : effacées avec celles des teams (comptes.mjs) ; ici la semaine
    // type mise de côté à l'unification.
    { sql: 'DELETE FROM dispo_regles_reprises WHERE compte_id = ?', params: [compte] },
    { sql: 'DELETE FROM cm_reunion_profils WHERE compte_id = ?', params: [compte] },
    { sql: 'UPDATE cm_reunions SET organisateur_id = NULL WHERE organisateur_id = ?', params: [compte] },
    { sql: 'UPDATE cm_reunions SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reunions SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reunions SET annule_par = NULL WHERE annule_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reunion_exceptions SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reunion_notes SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_reunion_taches SET assigne_a = NULL WHERE assigne_a = ?', params: [compte] },
    { sql: 'UPDATE cm_reunion_taches SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'DELETE FROM cm_rdv_creneaux WHERE reserve_par IS NULL AND offre_id IN (SELECT id FROM cm_rdv_offres WHERE proprietaire_id = ?)', params: [compte] },
    { sql: 'UPDATE cm_rdv_creneaux SET reserve_par = NULL WHERE reserve_par = ?', params: [compte] },
    { sql: 'UPDATE cm_rdv_offres SET ouverte = 0, proprietaire_id = NULL WHERE proprietaire_id = ?', params: [compte] },
  );
  lot.push(
    { sql: 'UPDATE cm_cartes SET cree_par = NULL WHERE cree_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET maj_par = NULL WHERE maj_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET soumis_par = NULL WHERE soumis_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET valide_par = NULL WHERE valide_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET refuse_par = NULL WHERE refuse_par = ?', params: [compte] },
    { sql: 'UPDATE cm_cartes SET publie_par = NULL WHERE publie_par = ?', params: [compte] },
    // Migration 0050 : qui a terminé la carte (déposée dans une colonne de fin).
    { sql: 'UPDATE cm_cartes SET terminee_par = NULL WHERE terminee_par = ?', params: [compte] },
  );
  // Membres liés aux posts (liens.membres, JSON) : le compte en est retiré.
  for (const c of await base.tous('SELECT id, liens FROM cm_cartes WHERE liens LIKE ?', [`%"${compte}"%`])) {
    const liens = jsonOu(c.liens, {});
    if (!Array.isArray(liens.membres) || !liens.membres.includes(compte)) continue;
    liens.membres = liens.membres.filter(m => m !== compte);
    if (!liens.membres.length) delete liens.membres;
    lot.push({ sql: 'UPDATE cm_cartes SET liens = ? WHERE id = ?', params: [JSON.stringify(liens), c.id] });
  }
  // Visuels d'un membre (recrue, départ, MVP) : la source désignant le compte devient « libre » (le rendu reste).
  for (const v of await base.tous("SELECT id, source FROM cm_visuels WHERE source LIKE ?", [`%"${compte}"%`])) {
    const source = jsonOu(v.source, {});
    if (source.genre !== 'membre' || source.id !== compte) continue;
    lot.push({ sql: 'UPDATE cm_visuels SET source = ? WHERE id = ?', params: [JSON.stringify({ genre: 'libre', teamId: source.teamId ?? null, id: null, date: null }), v.id] });
  }
  return lot;
}

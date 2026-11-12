/**
 * Export et import JSON de TOUTE la base Esport (migration vers un autre
 * serveur, sauvegarde). Le format ne dépend ni de PostgreSQL ni de SQLite : des
 * tables, des lignes, des valeurs texte ou nombre.
 *
 * L'import ne se fait que dans une base VIDE (schéma déjà migré) : il ne
 * fusionne jamais, pour ne rien écraser par erreur.
 */

import { echec, iso } from './outils.mjs';
import { TEAM_CM_ID, reprendreTeamCm } from './cm/teamCm.mjs';

export const FORMAT_EXPORT = 'applibourse-esport';
export const VERSION_EXPORT = 1;

/** Tables dans l'ordre des dépendances (clés étrangères) ; `tentatives` et `limites` (passagères) ne sont pas exportées. */
export const TABLES = [
  ['comptes', 'id'],
  ['teams', 'id'],
  ['team_modules', 'team_id, module'],
  ['roles', 'id'],
  ['role_permissions', 'role_id, permission'],
  ['membres', 'id'],
  ['invitations', 'id'],
  ['planning_evenements', 'id'],
  ['planning_exceptions', 'evenement_id, occurrence'],
  ['presences', 'evenement_id, occurrence, compte_id'],
  ['dispo_regles', 'id'],
  ['dispo_exceptions', 'id'],
  ['ical_jetons', 'id'],
  // Semaines personnalisées des disponibilités (migration 0062).
  ['dispo_semaines', 'team_id, compte_id, semaine'],
  // Semaine type mise de côté à l'unification des disponibilités de l'équipe CM (migration 0081).
  ['dispo_regles_reprises', 'id'],
  ['evenements', 'id'],
  ['journal', 'id'],
  ['notifications', 'id'],
  // Phase 3 (migration 0003).
  ['types_reunion', 'id'],
  ['fichiers', 'id'],
  ['reunions', 'id'],
  ['objectifs', 'id'],
  ['taches', 'id'],
  // Phase 4 (migration 0004) : l'adresse du webhook reste CHIFFRÉE dans l'export.
  ['discord_webhooks', 'team_id'],
  ['discord_notification_settings', 'team_id, cle'],
  ['discord_file', 'id'],
  ['discord_rappels', 'evenement_id, occurrence, genre'],
  // Phase 5 (migration 0005) : review vidéo et scouting.
  ['adversaires', 'id'],
  ['adversaire_joueurs', 'id'],
  ['adversaire_tendances', 'id'],
  ['reviews', 'id'],
  ['adversaire_vods', 'id'],
  ['review_reperes', 'id'],
  ['review_commentaires', 'id'],
  // Review v2 (migration 0010) : réactions 👍 / 👎.
  ['review_reactions', 'id'],
  // Phase 6 (migration 0006) : strats et playbook.
  ['strats', 'id'],
  ['strat_versions', 'id'],
  ['strat_partages', 'id'],
  ['playbook_entrees', 'id'],
  // Migration 0009 : demandes de compte.
  ['demandes_compte', 'id'],
  // Bot Discord (migration 0011) : identifiants Discord publics, empreintes des codes.
  ['discord_serveurs', 'team_id'],
  ['discord_comptes', 'compte_id'],
  ['discord_codes', 'code_hash'],
  ['discord_bot_pings', 'team_id, type_evenement'],
  ['discord_annonces', 'evenement_id, occurrence'],
  ['discord_debuts', 'evenement_id, occurrence'],
  // Suivi des joueurs (migration 0013) : notes du staff.
  ['notes_joueurs', 'id'],
  // Migration 0015 : récapitulatif e-mail (adresse CHIFFRÉE dans l'export).
  ['courriel_recap', 'compte_id'],
  // Migration 0019 : langue par défaut réglée avant la création de la fiche Esport du compte.
  ['langues_attente', 'compte_id'],
  // Vidéos et transcriptions (migration 0014) : envois par morceaux, transcriptions des réunions.
  ['envois', 'id'],
  ['transcriptions', 'id'],
  // Transcription sur le serveur (migration 0016) : file de travaux.
  ['travaux_transcription', 'id'],
  // Module Ressources (migration 0017) : le webhook dédié reste CHIFFRÉ dans l'export.
  ['ressource_categories', 'id'],
  ['ressources', 'id'],
  ['ressource_favoris', 'ressource_id, compte_id'],
  ['ressource_reactions', 'id'],
  ['ressource_commentaires', 'id'],
  ['ressource_visites', 'team_id, compte_id'],
  ['ressource_reglages', 'team_id'],
  // Tournois et résultats (migration 0022).
  ['tournois', 'id'],
  ['tournoi_roster', 'tournoi_id, compte_id'],
  ['tournoi_matchs', 'id'],
  ['resultats', 'id'],
  ['resultat_manches', 'id'],
  ['resultat_joueurs', 'id'],
  // Statistiques d'usage (migration 0018) : détail brut (90 jours) et agrégats journaliers.
  ['usage_evenements', 'id'],
  ['usage_jour_pages', 'jour, compte_id, team_id, page, appareil'],
  ['usage_jour_membres', 'jour, compte_id, appareil'],
  ['usage_jour_actions', 'jour, compte_id, team_id, action, appareil'],
  ['usage_jour_heures', 'jour, heure, compte_id, team_id, appareil'],
  ['usage_jour_erreurs', 'jour, empreinte, page, compte_id, appareil'],
  ['usage_reglages', 'cle'],
  // Messages Discord bilingues (migration 0020) : réglage du fil français, anti-spam des alertes.
  ['discord_bilingue', 'team_id'],
  ['discord_alertes_fil', 'salon_id'],
  // Profils de jeu et assistant IA (migration 0021) : profils, historique, travaux, propositions, usage, réglages,
  // délégations. Jamais la clé d'API (elle reste dans esport.env).
  ['jeux', 'cle'],
  ['jeu_versions', 'jeu_cle, version'],
  ['ia_travaux', 'id'],
  ['ia_propositions', 'id'],
  ['ia_appels', 'id'],
  ['ia_reglages', 'cle'],
  ['permissions_globales', 'compte_id, permission'],
  // Section CM (migration 0023) : rôles CM (les deux rôles système posés par la migration sont remplacés par ceux de
  // l'export), affectations, réglages, tableaux, listes, étiquettes, cartes et leurs détails, fichiers, clips, imports.
  ['cm_roles', 'id'],
  ['cm_role_permissions', 'role_id, permission'],
  // Team CM (migration 0068) : affectations directes (correspondants de team, rôles CM supplémentaires) ; les
  // affectations « club » sont les membres de la Team CM (tables teams, roles, membres). Un export antérieur a encore
  // `cm_affectations` : ses lignes sont reprises dans `cm_affectations_directes`, puis changées en membres (reprise).
  ['cm_affectations_directes', 'id'],
  ['cm_reglages', 'cle'],
  ['cm_tableaux', 'id'],
  // Accès restreint des tableaux (migration 0046) : personnes et rôles qui voient un tableau restreint.
  ['cm_tableau_acces', 'tableau_id, genre, cible'],
  ['cm_listes', 'id'],
  ['cm_etiquettes', 'id'],
  ['cm_etiquettes_retirees', 'tableau_id, trello_id'],
  ['cm_cartes', 'id'],
  ['cm_carte_etiquettes', 'carte_id, etiquette_id'],
  ['cm_carte_membres', 'carte_id, compte_id'],
  ['cm_checklists', 'id'],
  ['cm_checklist_elements', 'id'],
  ['cm_commentaires', 'id'],
  // Commentaires non lus (migration 0045) : état « vu » par compte, cartes suivies.
  ['cm_commentaires_vus', 'compte_id, cle'],
  ['cm_carte_suivis', 'carte_id, compte_id'],
  // Cartes favorites par compte (migration 0074).
  ['cm_carte_favoris', 'carte_id, compte_id'],
  ['cm_fichiers', 'id'],
  ['cm_pieces', 'id'],
  ['cm_activite', 'id'],
  ['cm_clips', 'id'],
  ['cm_imports', 'id'],
  // Sponsors & partenaires (migration 0024) : les étapes par défaut posées par la migration sont remplacées par
  // celles de l'export (renommées, réordonnées depuis).
  ['sp_etapes', 'id'],
  ['sp_prospects', 'id'],
  ['sp_partenaires', 'id'],
  ['sp_contrats', 'id'],
  ['sp_obligations', 'id'],
  ['sp_suivi', 'id'],
  ['sp_contacts', 'id'],
  ['sp_echanges', 'id'],
  ['sp_pieces', 'id'],
  // Visuels de la section CM (migration 0025).
  ['cm_charte', 'id'],
  ['cm_modeles', 'id'],
  ['cm_modele_versions', 'id'],
  ['cm_visuels', 'id'],
  ['cm_visuel_images', 'fichier_id'],
  // Page « Réseaux » de l'espace CM (migration 0026) : l'adresse des webhooks des salons du club reste CHIFFRÉE.
  ['cm_rs_salons', 'id'],
  ['cm_rs_comptes', 'id'],
  ['cm_rs_cibles', 'compte_id, cle'],
  ['cm_rs_publications', 'id'],
  ['cm_rs_releves_posts', 'id'],
  ['cm_rs_releves_comptes', 'id'],
  ['cm_rs_annonces', 'id'],
  // Drive de la section CM (migration 0027) : dossiers, fichiers, versions, étiquettes, favoris (les octets sont
  // dans `cm_fichiers` et le stockage, comme les autres fichiers).
  ['cm_drive_dossiers', 'id'],
  ['cm_drive_fichiers', 'id'],
  ['cm_drive_versions', 'id'],
  ['cm_drive_tags', 'element_id, tag'],
  ['cm_drive_favoris', 'compte_id, element_id'],
  // Nouveautés du Drive (migration 0041) : état « vu » par compte et par dossier ; dossiers des visuels.
  ['cm_drive_vus', 'compte_id, portee, dossier'],
  ['cm_visuels_dossiers', 'id'],
  // Rangement des modèles de visuels par défaut dans les dossiers (migration 0043).
  ['cm_visuels_defauts', 'portee, type'],
  // Liens utiles de DATA › Ressources et leurs liaisons avec des cartes et des dossiers du Drive (migration 0044).
  ['cm_liens', 'id'],
  ['cm_lien_liaisons', 'lien_id, genre, cible_id'],
  // Qui voit une ressource restreinte et à qui elle a été partagée (migration 0048).
  ['cm_lien_acces', 'lien_id, genre, cible'],
  ['cm_lien_partages', 'lien_id, compte_id'],
  // Choix d'affichage par compte de la section CM (migration 0042 : colonnes réduites, calendriers des teams).
  ['cm_preferences', 'compte_id, cle'],
  // Trombinoscope (migration 0030) : fiches et photos (image et miniature en base64, dans la base).
  ['trombi_fiches', 'compte_id'],
  ['trombi_photos', 'compte_id'],
  // Badges du trombinoscope (migration 0032) : catalogue du club et attributions manuelles.
  ['trombi_badges', 'id'],
  ['trombi_badges_membres', 'badge_id, compte_id, portee'],
  // Pings Discord une seule fois et relances par MP (migration 0031) : option de la team, registre des mentions,
  // MP déjà envoyés (idempotence des réessais), joueurs injoignables en MP.
  ['discord_mp_reglages', 'team_id'],
  ['discord_mentions', 'team_id, sujet, cible'],
  ['discord_mp_envois', 'ligne_id, discord_user_id'],
  ['discord_injoignables', 'team_id, compte_id'],
  // Rôles du club et modèle des rôles des nouvelles teams (migration 0033) : le rôle système « Second CEO » posé par
  // la migration est remplacé par celui de l'export (permissions modifiées depuis).
  ['roles_globaux', 'id'],
  ['roles_globaux_permissions', 'role_id, permission'],
  ['roles_globaux_affectations', 'role_id, compte_id'],
  ['roles_modele', 'cle_systeme'],
  // Devblog (migration 0036) : entrées, marques « vu » par compte, publications Discord, réglages.
  ['devblog_entrees', 'id'],
  ['devblog_vus', 'compte_id, entree_id'],
  ['devblog_discord', 'id'],
  ['devblog_reglages', 'cle'],
  // Devblog automatique (migration 0037) : journal des passages (réglages et état : lignes de devblog_reglages).
  ['devblog_auto', 'cree_le, id'],
  // Centre de notifications (migration 0038) : fil, lectures et préférences par compte.
  ['notifs_centre', 'cree_le, id'],
  ['notifs_lectures', 'compte_id, notif_id'],
  ['notifs_preferences', 'compte_id'],
  // Alertes et avis (migration 0077) : dédoublonnage des alertes par destinataire.
  ['notifs_alertes', 'compte_id, cle'],
  // Réunions de l'équipe CM (migration 0039) : réunions, participants, notes et tâches (confidentielles : restent
  // dans la base), statuts, rendez-vous, rappels, MP en file, abonnements iCal (empreinte du jeton). Leurs
  // disponibilités sont celles de la team CM du club (`dispo_*`, migration 0081).
  ['cm_reunions', 'id'],
  ['cm_reunion_participants', 'reunion_id, compte_id'],
  ['cm_reunion_exceptions', 'reunion_id, occurrence'],
  ['cm_reunion_notes', 'reunion_id'],
  ['cm_reunion_taches', 'id'],
  ['cm_reunion_profils', 'compte_id'],
  ['cm_rdv_offres', 'id'],
  ['cm_rdv_creneaux', 'id'],
  ['cm_reunion_rappels', 'reunion_id, occurrence, compte_id'],
  ['cm_reunion_mp', 'id'],
  ['cm_reunion_ical', 'id'],
  // Tickets Discord (migration 0054) : réglages, catégories, panneaux, liste noire, tickets, conversation (notes
  // internes comprises), pièces jointes (les octets copiés restent dans le stockage : esport/serveur/importer.mjs),
  // personnes ajoutées, lectures. Le bail du meneur et l'état de la connexion (passagers) ne sont pas exportés.
  ['tickets_reglages', 'cle'],
  ['tickets_categories', 'id'],
  ['tickets_panneaux', 'id'],
  ['tickets_liste_noire', 'discord_user_id'],
  ['tickets', 'numero'],
  ['tickets_messages', 'cree_le, id'],
  ['tickets_pieces', 'id'],
  ['tickets_membres', 'ticket_id, discord_user_id'],
  ['tickets_lectures', 'compte_id, ticket_id'],
  // Avis gardés (anonymes) des tickets supprimés (migration 0056).
  ['tickets_avis_anonymes', 'id'],
  // Bienvenue par rôle (migration 0058) : personnes déjà accueillies (jamais deux fois).
  ['discord_bienvenues', 'guild_id, discord_user_id, role_id'],
  // Salons vocaux temporaires (migration 0060) : salons ouverts sur Discord (un serveur repris les retrouve et les
  // nettoie une fois vides).
  ['vocaux_salons', 'salon_id'],
  // Événements organisés par le club, leurs équipes et rôles Discord (migration 0064 ; remplace les tables de 0063).
  ['club_evenements', 'id'],
  ['club_evenement_equipes', 'id'],
  ['club_evenement_membres', 'id'],
  ['club_evenement_staff', 'id'],
  // Salons de match Discord des événements et leurs historiques (migration 0073).
  ['club_salons_match', 'id'],
  // File d'envoi des messages des salons de match (migration 0079) : les messages en attente partent sur le nouveau serveur.
  ['club_salons_match_envois', 'cree_le, id'],
  // Rôles Discord temporaires des teams (migration 0066).
  ['roles_temp_reglages', 'team_id'],
  ['roles_temp_octrois', 'accorde_le, id'],
];
const NOMS_TABLES = TABLES.map(([t]) => t);
const MOTIF_COLONNE = /^[a-z_][a-z0-9_]{0,40}$/;

export async function exporterBase(base, maintenant = Date.now()) {
  const tables = {};
  for (const [table, ordre] of TABLES) {
    tables[table] = (await base.tous(`SELECT * FROM ${table} ORDER BY ${ordre}`, [])).map(l => ({ ...l }));
  }
  return { format: FORMAT_EXPORT, version: VERSION_EXPORT, exporteLe: iso(maintenant), tables };
}

export async function baseVide(base) {
  for (const table of ['comptes', 'journal']) {
    const l = await base.premier(`SELECT COUNT(*) AS n FROM ${table}`, []);
    if (Number(l?.n ?? 0) > 0) return false;
  }
  // La Team CM posée par la migration 0068 ne compte pas : elle est remplacée par celle de l'export.
  const teams = await base.premier('SELECT COUNT(*) AS n FROM teams WHERE id <> ?', [TEAM_CM_ID]);
  if (Number(teams?.n ?? 0) > 0) return false;
  return true;
}

/**
 * Export fait avant la migration 0064 : les équipes notées sur un tournoi d'une team (tournoi_discord, tournoi_equipes,
 * tournoi_equipe_membres) deviennent un événement du club au même identifiant, comme le fait la migration.
 */
export function reprendreTablesTournoi(tables) {
  const anciennes = ['tournoi_discord', 'tournoi_equipes', 'tournoi_equipe_membres'];
  if (!anciennes.some(t => t in tables)) return tables;
  const { tournoi_discord: d = [], tournoi_equipes: e = [], tournoi_equipe_membres: m = [], ...reste } = tables;
  const ids = [...new Set([...e.map(x => x.tournoi_id), ...d.map(x => x.tournoi_id)])];
  const tournois = Array.isArray(reste.tournois) ? reste.tournois : [];
  const evenements = ids
    .map(id => {
      const t = tournois.find(x => x.id === id);
      if (!t) return null;
      const r = d.find(x => x.tournoi_id === id) ?? {};
      return { id, nom: t.nom, jeu: t.jeu ?? null, debut: t.debut ?? null, fin: t.fin ?? null, statut: ['en_cours', 'termine', 'annule'].includes(t.statut) ? t.statut : 'a_venir', description: '', categorie_ticket_id: r.categorie_ticket_id ?? null, roles_auto: 1, modele_role: r.modele_role ?? '{tag} {nom}', couleur: r.couleur ?? null, role_ancre_id: null, suppression_h: r.suppression_h ?? 24, roles_crees_le: r.roles_crees_le ?? null, roles_supprimes_le: r.roles_supprimes_le ?? null, cree_par: null, cree_le: t.cree_le, maj_le: r.maj_le ?? t.maj_le };
    })
    .filter(Boolean);
  const gardes = new Set(evenements.map(x => x.id));
  const equipes = e.filter(x => gardes.has(x.tournoi_id)).map(x => ({ id: x.id, evenement_id: x.tournoi_id, nom: x.nom, tag: x.tag, role_id: x.role_id ?? null, role_nom: null, ticket_id: x.ticket_id ?? null, position: x.position ?? 0, cree_le: x.cree_le, maj_le: x.maj_le }));
  const idsEquipes = new Set(equipes.map(x => x.id));
  return {
    ...reste,
    club_evenements: [...(reste.club_evenements ?? []), ...evenements],
    club_evenement_equipes: [...(reste.club_evenement_equipes ?? []), ...equipes],
    club_evenement_membres: [...(reste.club_evenement_membres ?? []), ...m.filter(x => idsEquipes.has(x.equipe_id))],
  };
}

/** Importe un export dans une base vide ; rend le nombre de lignes par table. */
export async function importerBase(base, donnees, { tailleLot = 50 } = {}) {
  if (!donnees || donnees.format !== FORMAT_EXPORT || donnees.version !== VERSION_EXPORT || typeof donnees.tables !== 'object') {
    throw echec(400, 'format', 'Ce fichier n’est pas un export Esport (version 1).');
  }
  donnees = { ...donnees, tables: reprendreDisposCm(reprendreAffectationsCm(reprendreTablesTournoi(donnees.tables))) };
  for (const nom of Object.keys(donnees.tables)) {
    if (!NOMS_TABLES.includes(nom)) throw echec(400, 'table-inconnue', `Table inconnue dans l’export : ${String(nom).slice(0, 40)}`);
  }
  if (!(await baseVide(base))) throw echec(409, 'base-non-vide', 'La base de destination n’est pas vide : l’import ne fusionne jamais.');
  const bilan = {};
  for (const table of NOMS_TABLES) {
    const lignes = Array.isArray(donnees.tables[table]) ? donnees.tables[table] : [];
    // Types de réunion globaux posés par la migration : remplacés par ceux de l'export (éventuellement modifiés).
    if (table === 'types_reunion' && lignes.length > 0) await base.executer('DELETE FROM types_reunion WHERE team_id IS NULL', []);
    // Profils préconfigurés posés par la migration 0021 : remplacés par ceux de l'export (modifiés depuis).
    // Rôles CM système posés par la migration 0023 : remplacés par ceux de l'export (permissions modifiées depuis).
    if (table === 'cm_roles' && lignes.length > 0) {
      await base.executer('DELETE FROM cm_role_permissions', []);
      await base.executer('DELETE FROM cm_roles', []);
    }
    // Badges proposés par la migration 0032 : remplacés par le catalogue de l'export (modifié depuis).
    if (table === 'trombi_badges' && lignes.length > 0) {
      await base.executer('DELETE FROM trombi_badges_membres', []);
      await base.executer('DELETE FROM trombi_badges', []);
    }
    if (table === 'roles_globaux' && lignes.length > 0) {
      await base.executer('DELETE FROM roles_globaux_permissions', []);
      await base.executer('DELETE FROM roles_globaux', []);
    }
    // Team CM posée par la migration 0068 : remplacée par celle de l'export s'il en a une (même identifiant).
    if (table === 'teams' && lignes.some(l => l?.id === TEAM_CM_ID)) {
      await base.executer('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE team_id = ?)', [TEAM_CM_ID]);
      await base.executer('DELETE FROM roles WHERE team_id = ?', [TEAM_CM_ID]);
      await base.executer('DELETE FROM team_modules WHERE team_id = ?', [TEAM_CM_ID]);
      await base.executer('DELETE FROM teams WHERE id = ?', [TEAM_CM_ID]);
    }
    if (table === 'sp_etapes' && lignes.length > 0) await base.executer('DELETE FROM sp_etapes', []);
    if (table === 'jeux' && lignes.length > 0) {
      await base.executer('DELETE FROM jeu_versions', []);
      await base.executer('DELETE FROM jeux', []);
    }
    bilan[table] = lignes.length;
    let lot = [];
    for (const ligne of lignes) {
      const colonnes = Object.keys(ligne);
      if (colonnes.length === 0 || !colonnes.every(c => MOTIF_COLONNE.test(c))) throw echec(400, 'colonne', `Colonne illisible dans ${table}.`);
      const valeurs = colonnes.map(c => {
        const v = ligne[c];
        if (v === null || typeof v === 'string' || typeof v === 'number') return v;
        throw echec(400, 'valeur', `Valeur illisible dans ${table}.${c}.`);
      });
      lot.push({ sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: valeurs });
      if (lot.length >= tailleLot) {
        await base.lot(lot);
        lot = [];
      }
    }
    if (lot.length > 0) await base.lot(lot);
  }
  // Export antérieur à la migration 0068 : rôles CM créés depuis et affectations « club » → Team CM (sans effet sinon).
  await reprendreTeamCm(base);
  return bilan;
}

/** Export antérieur à la migration 0068 : la table `cm_affectations` devient `cm_affectations_directes`. */
export function reprendreAffectationsCm(tables) {
  if (!('cm_affectations' in tables)) return tables;
  const { cm_affectations: anciennes, ...reste } = tables;
  return { ...reste, cm_affectations_directes: [...(Array.isArray(reste.cm_affectations_directes) ? reste.cm_affectations_directes : []), ...(Array.isArray(anciennes) ? anciennes : [])] };
}

/** Date de reprise des semaines types mises de côté (comme la migration 0081). */
const REPRISE_DISPOS = '2026-11-12T00:00:00.000Z';

/**
 * Export antérieur à la migration 0081 : les disponibilités des Réunions CM (`cm_dispo_regles`, `cm_dispo_exceptions`)
 * deviennent celles de la team CM du club (`dispo_regles`, `dispo_exceptions` avec `motif`), exactement comme la
 * migration : un compte qui avait deux semaines types garde la plus récente, l'autre va dans `dispo_regles_reprises`.
 */
export function reprendreDisposCm(tables) {
  if (!('cm_dispo_regles' in tables) && !('cm_dispo_exceptions' in tables)) return tables;
  const { cm_dispo_regles: rcm = [], cm_dispo_exceptions: xcm = [], ...reste } = tables;
  const liste = v => (Array.isArray(v) ? v : []);
  let regles = liste(reste.dispo_regles);
  const reprises = [...liste(reste.dispo_regles_reprises)];
  const max = l => l.reduce((m, r) => (String(r.cree_le) > m ? String(r.cree_le) : m), '');
  const cm = liste(rcm);
  const ids = new Set(regles.map(r => r.id));
  for (const compte of new Set(cm.map(r => r.compte_id))) {
    const deCm = cm.filter(r => r.compte_id === compte);
    const deTeam = regles.filter(r => r.team_id === TEAM_CM_ID && r.compte_id === compte);
    const garder = (r, origine) => reprises.push({ id: r.id, compte_id: r.compte_id, jour: r.jour, debut: r.debut, fin: r.fin, type: r.type, fuseau: r.fuseau, cree_le: r.cree_le, origine, repris_le: REPRISE_DISPOS });
    if (deTeam.length && max(deCm) > max(deTeam)) {
      for (const r of deTeam) garder(r, 'planning');
      regles = regles.filter(r => !deTeam.includes(r));
    }
    if (regles.some(r => r.team_id === TEAM_CM_ID && r.compte_id === compte)) {
      for (const r of deCm) garder(r, 'reunions_cm');
      continue;
    }
    for (const r of deCm) {
      if (ids.has(r.id)) garder(r, 'reunions_cm');
      else regles.push({ id: r.id, team_id: TEAM_CM_ID, compte_id: r.compte_id, jour: r.jour, debut: r.debut, fin: r.fin, type: r.type, fuseau: r.fuseau, cree_le: r.cree_le });
    }
  }
  const exceptions = liste(reste.dispo_exceptions);
  const idsX = new Set(exceptions.map(x => x.id));
  for (const x of liste(xcm)) {
    if (idsX.has(x.id)) continue;
    exceptions.push({ id: x.id, team_id: TEAM_CM_ID, compte_id: x.compte_id, debut: x.debut, fin: x.fin, type: x.type === 'disponible' ? 'disponible' : 'indisponible', note: x.note ?? '', cree_le: x.cree_le, motif: x.type === 'absence' || x.type === 'conge' ? x.type : null });
  }
  return { ...reste, dispo_regles: regles, dispo_exceptions: exceptions, dispo_regles_reprises: reprises };
}

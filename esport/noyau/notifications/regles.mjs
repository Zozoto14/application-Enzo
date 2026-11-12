/**
 * Centre de notifications (migration 0038, docs/esport/notifications.md) : à quelle CATÉGORIE appartient un
 * événement du bus, QUI peut le voir (clé d'accès), et où mène son lien. Module FEUILLE (aucune base) : la
 * table est lue par le consommateur (centre.mjs) à la création, et la clé d'accès est réévaluée à CHAQUE lecture
 * (droits.mjs) : un changement de rôle s'applique tout de suite, dans les deux sens.
 *
 * Clé d'accès (`acces`) :
 *  - `team:p1|p2`  : une des permissions dans la team de l'événement (module activé : même logique que la page) ;
 *                    `team:*` = membre actif de la team (ou accès à toutes les teams) ;
 *  - `cm:p1|p2`    : permissions de la section CM (portée de la team de l'événement, ou du club sans team) ;
 *  - `club:p1|p2`  : permissions du club (rôles du club, affectations CM « club », Sponsors) ;
 *  - `tous`        : tout compte Esport (devblog publié) ;
 *  - `fondateur`   : le Fondateur seul (CEO, super admin) ; défaut prudent d'un type inconnu ;
 *  - `aucun`       : bruit technique (réactions, jetons iCal…) : jamais affiché, pas même au Fondateur.
 * Le Fondateur voit tout le reste. Une règle `team:` sur un événement SANS team devient `fondateur`.
 *
 * AJOUTER UN ÉVÉNEMENT : une entrée dans REGLES (type exact, ou préfixe terminé par `.*`) :
 *   'drive.ajout': { categorie: 'drive', acces: 'cm:cm.drive.voir|cm.drive.envoyer|cm.drive.gerer', lien: { vue: 'cm', onglet: 'drive' } }
 * La charge de l'événement est reprise (sans les champs sensibles : CHAMPS_RETIRES) pour la phrase affichée.
 */

export const CATEGORIES = Object.freeze(['planning', 'competition', 'resultats', 'cm', 'drive', 'sponsors', 'tickets', 'membres', 'discord', 'reunions', 'objectifs', 'jeu', 'devblog', 'systeme']);

const TEAM = section => ({ vue: 'team', section });
const CM = onglet => ({ vue: 'cm', onglet });
const DRIVE = 'cm:cm.drive.voir|cm.drive.envoyer|cm.drive.gerer';
const STAFF_REUNIONS = 'team:meeting_summaries.view_all|meeting_summaries.write_summary';
const AUCUN = { categorie: 'systeme', acces: 'aucun' };

/** Règles par type (exact d'abord, puis préfixe `xxx.*`). */
export const REGLES = Object.freeze({
  // ---- Planning (scrims, matchs, entraînements), convocations et présences.
  'event.*': { categorie: 'planning', acces: 'team:planning.view', lien: TEAM('module:planning') },
  'attendance.*': { categorie: 'planning', acces: 'team:attendance.view_all', lien: TEAM('module:attendance') },
  'attendance.rsvp': { categorie: 'planning', acces: 'team:attendance.view_all', lien: TEAM('module:attendance') },
  'availability.settings_changed': { categorie: 'planning', acces: 'team:availability.view_all', lien: TEAM('module:availability') },
  'availability.updated': AUCUN,
  'ical.*': AUCUN,
  // ---- Tournois et résultats.
  'tournoi.*': { categorie: 'competition', acces: 'team:tournois.voir', lien: TEAM('module:tournois') },
  'match.*': { categorie: 'resultats', acces: 'team:resultats.voir', lien: TEAM('module:resultats') },
  // ---- Section CM (posts, validations, clips, dépôts, suggestions, visuels, réseaux).
  'cm.*': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('tableaux') },
  // Commentaire d'une carte : jamais dans le fil de tout le monde, seulement la notification personnelle (cm-commentaire,
  // cm-mention) des personnes concernées.
  'cm.commentaire_ajoute': AUCUN,
  // Carte passée en urgent / critique : seulement la notification personnelle (cm-urgence) des personnes concernées.
  'cm.carte_urgence': AUCUN,
  // Carte terminée (colonne de fin) : seulement la notification personnelle (cm-carte-terminee) du créateur et des suiveurs.
  'cm.carte_terminee': AUCUN,
  'cm.carte_rouverte': AUCUN,
  'cm.liste_fin': AUCUN,
  'cm.post_soumis': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('valider') },
  'cm.post_valide': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('valider') },
  'cm.post_refuse': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('valider') },
  'cm.post_invalide': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('valider') },
  'cm.post_publie': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('calendrier') },
  'cm.post_adresses': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('calendrier') },
  'cm.clip_propose': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('clips') },
  'cm.clip_decide': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('clips') },
  'cm.visuel_genere': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('visuels') },
  'cm.modele_cree': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('visuels') },
  'cm.modele_modifie': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('visuels') },
  'cm.modele_supprime': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('visuels') },
  'cm.charte_modifiee': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('visuels') },
  // Liens utiles (DATA › Ressources, migration 0044).
  'cm.lien_*': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('ressources') },
  // Qui voit la ressource (migration 0048) : réglage changé pour ceux qui gèrent le CM ; partage : seulement la
  // notification PERSONNELLE (cm-lien-partage) des personnes choisies. Ressource restreinte : jamais montrée à qui
  // ne la voit pas (centre.mjs, `liensInterdits`).
  'cm.lien_acces': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('ressources') },
  'cm.lien_partage': { categorie: 'cm', acces: 'aucun', lien: CM('ressources') },
  // Accès d'un tableau changé (migration 0046) : ceux qui gèrent le CM (et qui voient le tableau : centre.mjs).
  'cm.tableau_acces': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('tableaux') },
  'cm.reglages_modifies': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('reglages') },
  'cm.import_trello': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('import') },
  'cm.reseau_*': { categorie: 'cm', acces: 'cm:cm.voir', lien: CM('reseaux') },
  'cm.reseau_import': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('reseaux') },
  'cm.reseau_export': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('reseaux') },
  'cm.reseau_reglages': { categorie: 'cm', acces: 'cm:cm.gerer', lien: CM('reseaux') },
  // Rôles CM et affectations : page Rôles et permissions / équipe CM.
  // Réunions de l'équipe CM (migration 0039, docs/esport/cm-reunions.md) : les invités, l'organisateur et la personne qui
  // propose un rendez-vous reçoivent leur notification PERSONNELLE ; le fil d'activité ne montre ces événements
  // qu'à qui gère toutes les réunions (cm.reunions.gerer). Rendez-vous (privés) et rappels : jamais dans le fil.
  'cm.reunion_*': { categorie: 'reunions', acces: 'club:cm.reunions.gerer', lien: CM('reunions') },
  'cm.reunion_rappel': AUCUN,
  'cm.rdv_*': AUCUN,
  'cm.role_cree': { categorie: 'membres', acces: 'club:cm.gerer|roles.gerer', lien: CM('equipe') },
  'cm.role_modifie': { categorie: 'membres', acces: 'club:cm.gerer|roles.gerer', lien: CM('equipe') },
  'cm.role_supprime': { categorie: 'membres', acces: 'club:cm.gerer|roles.gerer', lien: CM('equipe') },
  'cm.affectation_ajoutee': { categorie: 'membres', acces: 'club:cm.gerer|roles.gerer', lien: CM('equipe') },
  'cm.affectation_retiree': { categorie: 'membres', acces: 'club:cm.gerer|roles.gerer', lien: CM('equipe') },
  // ---- Drive de la section CM (et l'événement `drive.ajout` de l'onglet Drive / Visuels).
  'cm.drive_*': { categorie: 'drive', acces: DRIVE, lien: CM('drive') },
  'cm.drive_quota': { categorie: 'drive', acces: 'cm:cm.drive.gerer', lien: CM('drive') },
  'drive.*': { categorie: 'drive', acces: DRIVE, lien: CM('drive') },
  // ---- Sponsors (données sensibles : sponsors.voir du club seulement).
  'sponsors.*': { categorie: 'sponsors', acces: 'club:sponsors.voir', lien: CM('sponsors') },
  'sponsors.import': { categorie: 'sponsors', acces: 'club:sponsors.gerer', lien: CM('sponsors') },
  'sponsors.export': { categorie: 'sponsors', acces: 'club:sponsors.gerer', lien: CM('sponsors') },
  'sponsors.rgpd_contact': { categorie: 'sponsors', acces: 'club:sponsors.gerer', lien: CM('sponsors') },
  // ---- Tickets Discord (migration 0054) : l'accès dépend de la CATÉGORIE du ticket, que le fil ne sait pas exprimer :
  // jamais dans le fil ; seules les notifications personnelles `tk-*` (catégorie relue à chaque lecture : droits.mjs).
  'ticket.*': { categorie: 'tickets', acces: 'aucun', lien: { vue: 'tickets' } },
  'tickets.*': { categorie: 'tickets', acces: 'aucun', lien: { vue: 'tickets' } },
  // Alertes techniques (migration 0077) : jamais dans le fil ; seules les notifications personnelles (alertes.mjs), dont
  // l'accès est relu à chaque lecture.
  'alerte.*': AUCUN,
  // ---- Membres, rôles, invitations, comptes, trombinoscope, badges.
  'team.*': { categorie: 'membres', acces: 'team:*', lien: TEAM('accueil') },
  'modules.changed': { categorie: 'membres', acces: 'team:*', lien: TEAM('accueil') },
  'role.*': { categorie: 'membres', acces: 'team:roles.manage', lien: TEAM('membres') },
  'member.*': { categorie: 'membres', acces: 'team:members.view', lien: TEAM('membres') },
  'member.account_requested': { categorie: 'membres', acces: 'club:comptes.demandes.gerer', lien: { vue: 'membres', sous: 'tous' } },
  'member.account_request_validated': { categorie: 'membres', acces: 'club:comptes.demandes.gerer', lien: { vue: 'membres', sous: 'tous' } },
  'member.account_request_refused': { categorie: 'membres', acces: 'club:comptes.demandes.gerer', lien: { vue: 'membres', sous: 'tous' } },
  'invitation.*': { categorie: 'membres', acces: 'team:members.invite', lien: TEAM('membres') },
  'roles.*': { categorie: 'membres', acces: 'club:roles.gerer', lien: { vue: 'membres', sous: 'roles' } },
  'trombi.*': { categorie: 'membres', acces: 'club:membres.trombi.voir', lien: { vue: 'membres', sous: 'trombi' } },
  'account.*': AUCUN,
  // ---- Discord (réglages et échecs d'envoi : discord.manage).
  'discord.*': { categorie: 'discord', acces: 'team:discord.manage', lien: TEAM('parametres') },
  'discord.command_used': AUCUN,
  'discord.role_temp_given': AUCUN,
  'discord.role_temp_removed': AUCUN,
  'discord.test_mp': AUCUN,
  'discord.account_linked': AUCUN,
  'discord.account_unlinked': AUCUN,
  // ---- Réunions, résumés, transcriptions (staff : view_all / write_summary ; voir `affiner` pour les résumés publiés).
  'meeting.*': { categorie: 'reunions', acces: STAFF_REUNIONS, lien: TEAM('module:meeting_summaries') },
  'meeting_type.*': { categorie: 'reunions', acces: STAFF_REUNIONS, lien: TEAM('module:meeting_summaries') },
  'media.deleted': AUCUN,
  // ---- Objectifs et tâches.
  'goal.*': { categorie: 'objectifs', acces: 'team:goals_tasks.view', lien: TEAM('module:goals_tasks') },
  'task.*': { categorie: 'objectifs', acces: 'team:goals_tasks.view', lien: TEAM('module:goals_tasks') },
  // ---- Jeu : strats (privées : staff, voir `affiner`), playbook, review, scouting, ressources, notes du staff.
  'strat.*': { categorie: 'jeu', acces: 'team:strats.view', lien: TEAM('module:strat_editor') },
  'strat.share_created': { categorie: 'jeu', acces: 'team:strats.share', lien: TEAM('module:strat_editor') },
  'strat.share_revoked': { categorie: 'jeu', acces: 'team:strats.share', lien: TEAM('module:strat_editor') },
  'playbook.*': { categorie: 'jeu', acces: 'team:playbook.view', lien: TEAM('module:playbook') },
  'review.*': { categorie: 'jeu', acces: 'team:video_review.view', lien: TEAM('module:video_review') },
  'review.reaction_changed': AUCUN,
  'review.marker_updated': AUCUN,
  'review.marker_deleted': AUCUN,
  'review.comment_deleted': AUCUN,
  'opponent.*': { categorie: 'jeu', acces: 'team:scouting.view', lien: TEAM('module:scouting') },
  'resource.*': { categorie: 'jeu', acces: 'team:resources.view', lien: TEAM('module:resources') },
  'resource.proposed': { categorie: 'jeu', acces: 'team:resources.manage', lien: TEAM('module:resources') },
  'resource.refused': { categorie: 'jeu', acces: 'team:resources.manage', lien: TEAM('module:resources') },
  'resource.reaction_changed': AUCUN,
  'resource.comment_deleted': AUCUN,
  'resource_category.*': { categorie: 'jeu', acces: 'team:resources.manage', lien: TEAM('module:resources') },
  'resources.*': { categorie: 'jeu', acces: 'team:resources.manage', lien: TEAM('module:resources') },
  'player_note.*': { categorie: 'jeu', acces: 'team:player_notes.view', lien: TEAM('module:player_notes') },
  // ---- Devblog publié : tout le monde.
  'devblog.*': { categorie: 'devblog', acces: 'tous', lien: { vue: 'devblog' } },
  // ---- Système : profils de jeu, IA (Fondateur).
  'game.*': { categorie: 'systeme', acces: 'club:jeux.gerer', lien: { vue: 'jeux' } },
  'ia.*': { categorie: 'systeme', acces: 'fondateur', lien: { vue: 'jeux' } },
});

/** Défaut d'un type sans règle : visible du Fondateur seul (jamais d'un rôle qui n'y aurait pas droit). */
const REGLE_INCONNUE = Object.freeze({ categorie: 'systeme', acces: 'fondateur', lien: null });

/** Règle d'un type d'événement (exact, préfixe le plus long, défaut prudent). */
export function regleDe(type) {
  if (REGLES[type]) return REGLES[type];
  const morceaux = String(type).split('.');
  // `cm.drive_fichier_ajoute` → `cm.drive_*` avant `cm.*`.
  const dernier = morceaux[morceaux.length - 1];
  const tete = morceaux.slice(0, -1).join('.');
  const souligne = dernier.indexOf('_');
  if (souligne > 0 && REGLES[`${tete}.${dernier.slice(0, souligne)}_*`]) return REGLES[`${tete}.${dernier.slice(0, souligne)}_*`];
  for (let i = morceaux.length - 1; i > 0; i--) {
    const r = REGLES[`${morceaux.slice(0, i).join('.')}.*`];
    if (r) return r;
  }
  return REGLE_INCONNUE;
}

/**
 * Règle effective d'un événement, affinée selon l'élément (lu en base au moment de la création) :
 *  - réunion d'un type « staff » : jamais plus large que view_all / write_summary ; résumé publié d'un type
 *    « team » : aussi les lecteurs (view_summary) ;
 *  - strat privée : le staff (strats.delete) seulement ; ressource « staff » (ou proposée) : resources.post / manage ;
 *    résultat « staff » : resultats.saisir ;
 *  - événement de team sans team : Fondateur seul.
 */
/** L'élément du Drive (fichier ou dossier) est-il dans un dossier restreint (lui compris) ? */
export async function sousDossierRestreint(base, entiteType, id) {
  let dossier = entiteType === 'cm_drive_dossier' ? id : (await base.premier('SELECT dossier_id FROM cm_drive_fichiers WHERE id = ?', [id]))?.dossier_id;
  for (let n = 0; dossier && n < 20; n++) {
    const d = await base.premier('SELECT parent_id, restreint FROM cm_drive_dossiers WHERE id = ?', [dossier]);
    if (!d) return false;
    if (Number(d.restreint) === 1) return true;
    dossier = d.parent_id;
  }
  return false;
}

export async function regleEffective(base, ev) {
  const r = regleDe(ev.type);
  let acces = r.acces;
  if (ev.type === 'meeting.summary_published' && ev.entite_id) {
    const l = await base.premier('SELECT t.visibilite FROM reunions r LEFT JOIN types_reunion t ON t.id = r.type_id WHERE r.id = ?', [ev.entite_id]);
    if (l && (l.visibilite ?? 'team') === 'team') acces = `${STAFF_REUNIONS}|meeting_summaries.view_summary`;
  }
  if (ev.type.startsWith('strat.')) {
    // Strat privée (ou introuvable) : le staff seulement, quel que soit l'événement (titre compris).
    const l = ev.entite_id ? await base.premier('SELECT visibilite FROM strats WHERE id = ?', [ev.entite_id]) : null;
    if (!l || l.visibilite !== 'team') acces = 'team:strats.delete';
  }
  if (ev.type.startsWith('resource.') && ev.entite_type === 'ressource' && acces === 'team:resources.view') {
    // Ressource « staff », proposée ou refusée : ceux qui publient ou gèrent seulement.
    const l = ev.entite_id ? await base.premier('SELECT visibilite, statut FROM ressources WHERE id = ?', [ev.entite_id]) : null;
    if (!l || l.statut !== 'publiee' || l.visibilite !== 'team') acces = 'team:resources.post|resources.manage';
  }
  if (ev.type.startsWith('match.resultat') && ev.entite_type === 'resultat') {
    // Résultat « staff » : ceux qui saisissent seulement.
    const l = ev.entite_id ? await base.premier('SELECT visibilite FROM resultats WHERE id = ?', [ev.entite_id]) : null;
    if (!l || l.visibilite !== 'team') acces = 'team:resultats.saisir';
  }
  if ((ev.type === 'drive.ajout' || ev.type.startsWith('cm.drive_')) && ['cm_drive', 'cm_drive_dossier'].includes(ev.entite_type) && ev.entite_id) {
    // Élément du Drive sous un dossier RESTREINT (migration 0027) : ceux qui gèrent le Drive seulement.
    if (await sousDossierRestreint(base, ev.entite_type, ev.entite_id)) acces = 'cm:cm.drive.gerer';
  }
  if (acces.startsWith('team:') && !ev.team_id) acces = 'fondateur';
  return { categorie: r.categorie, acces, lien: r.lien ?? null };
}

/**
 * Notifications PERSONNELLES (table `notifications`, une ligne par destinataire, écrites par les abonnés de chaque
 * module) : leur catégorie, par type. Elles sont unifiées dans le centre (voir centre.mjs).
 */
export const CATEGORIES_PERSO = Object.freeze({
  bienvenue: 'membres',
  'membre-arrive': 'membres',
  'role-change': 'membres',
  retire: 'membres',
  modules: 'membres',
  'demande-compte': 'membres',
  'demande-compte-validee': 'membres',
  'demande-compte-refusee': 'membres',
  'trombi-modifiee': 'membres',
  'resume-depose': 'reunions',
  'resume-publie': 'reunions',
  'transcription-prete': 'reunions',
  'transcription-echec': 'reunions',
  'tache-assignee': 'objectifs',
  'tache-echeance': 'objectifs',
  'note-partagee': 'jeu',
  'jeu-brouillon-pret': 'systeme',
  'jeu-maj-proposee': 'systeme',
  'devblog-auto': 'devblog',
  // Réunions de l'équipe CM (migration 0039).
  'cm-reunion-invite': 'reunions',
  'cm-reunion-modifiee': 'reunions',
  'cm-reunion-annulee': 'reunions',
  'cm-reunion-reponse': 'reunions',
  'cm-reunion-rappel': 'reunions',
  'cm-rdv-reserve': 'reunions',
  // Avis de tickets et alertes techniques (migration 0077, alertes.mjs).
  'tk-avis': 'tickets',
  'salon-match-alerte': 'discord',
  'vocal-alerte': 'discord',
  'role-evenement-alerte': 'discord',
  'role-temp-alerte': 'discord',
});

/** Catégorie d'une notification personnelle (préfixes des modules : `cm-`, `sp-`, planning, review…). */
export function categoriePerso(type) {
  if (CATEGORIES_PERSO[type]) return CATEGORIES_PERSO[type];
  const t = String(type);
  if (t.startsWith('sp-')) return 'sponsors';
  if (t.startsWith('tk-')) return 'tickets';
  if (t.startsWith('cm-drive')) return 'drive';
  if (t.startsWith('cm-') || t.startsWith('reseau')) return 'cm';
  if (t.startsWith('tournoi') || t.startsWith('match')) return /resultat/.test(t) ? 'resultats' : 'competition';
  if (t.startsWith('resultat')) return 'resultats';
  if (/^(evenement|event|convocation|presence|rappel|planning|seance)/.test(t)) return 'planning';
  if (/^(review|ressource|strat|playbook|scouting)/.test(t)) return 'jeu';
  if (t.startsWith('discord')) return 'discord';
  return 'systeme';
}

/** Lien d'une notification personnelle sans événement connu : la page de sa catégorie. */
export function lienDeCategorie(categorie, teamId) {
  const parTeam = {
    planning: 'module:planning',
    competition: 'module:tournois',
    resultats: 'module:resultats',
    reunions: 'module:meeting_summaries',
    objectifs: 'module:goals_tasks',
    jeu: 'accueil',
    membres: 'membres',
    discord: 'parametres',
  };
  if (categorie === 'cm') return CM('tableaux');
  if (categorie === 'reunions' && !teamId) return CM('reunions');
  if (categorie === 'drive') return CM('drive');
  if (categorie === 'sponsors') return CM('sponsors');
  if (categorie === 'tickets') return { vue: 'tickets' };
  if (categorie === 'devblog') return { vue: 'devblog' };
  if (teamId && parTeam[categorie]) return TEAM(parTeam[categorie]);
  if (categorie === 'membres') return { vue: 'membres', sous: 'tous' };
  return null;
}

/** Champs jamais recopiés dans le centre (contenus libres, coordonnées, secrets) : la phrase n'en a pas besoin. */
export const CHAMPS_RETIRES = Object.freeze(['contenu', 'texte', 'corps', 'note', 'notes', 'commentaire', 'courriel', 'email', 'telephone', 'adresse', 'webhook', 'jeton', 'token', 'secret', 'cle', 'url', 'transcription', 'prompt']);

/** Charge nettoyée : champs sensibles retirés, textes bornés, au plus 4 Ko. */
export function chargePublique(charge) {
  const sortie = {};
  for (const [k, v] of Object.entries(charge && typeof charge === 'object' ? charge : {})) {
    if (CHAMPS_RETIRES.includes(k.toLowerCase())) continue;
    if (typeof v === 'string') sortie[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) sortie[k] = v;
    else if (Array.isArray(v)) sortie[k] = v.slice(0, 20).filter(x => ['string', 'number', 'boolean'].includes(typeof x)).map(x => (typeof x === 'string' ? x.slice(0, 80) : x));
  }
  const texte = JSON.stringify(sortie);
  return texte.length > 4096 ? '{}' : texte;
}

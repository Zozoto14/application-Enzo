/**
 * Comptes et membres au niveau de l'Esport (toutes teams) : invitation
 * directe, ajout d'un compte existant, annuaire des membres, retrait d'un
 * compte supprimé dans l'Administration.
 *
 * Invitation directe (voir docs/esport/invitations.md) :
 *  1. le Fondateur crée, depuis l'Esport, le compte du hub du joueur (sur SON
 *     appareil : il faut ses clés pour le séquestre, comme dans l'Administration) ;
 *  2. il PRÉ-ENREGISTRE ici le compte (identifiant du compte du relais, pseudo)
 *     et ses teams avec un rôle par team (`POST /comptes`, super admin seulement) ;
 *  3. à la première session Esport du joueur (jeton du relais validé par le
 *     relais, donc compte réellement à lui), le compte passe d'« invité » à
 *     « actif » (`activer`) et l'arrivée est annoncée dans chaque team.
 * Aucun code à saisir : le lien entre le compte du hub et ses teams est fait
 * par le serveur, sur l'identifiant vérifié par le relais.
 *
 * Les autres rôles d'équipe (Manager…) ne créent pas de compte (pas de clés du
 * Fondateur) : ils AJOUTENT à une team un compte qu'ils voient déjà (membre
 * d'une autre team où ils ont `members.view`), avec un rôle qu'ils peuvent
 * attribuer (anti-escalade de service.mjs).
 */

import { discordIdLibre, lireDiscordId } from './discordId.mjs';
import { evenement } from './evenements.mjs';
import { CLE_PROPRIETAIRE, autorise } from './permissions.mjs';
import { lirePseudo } from './service.mjs';
import { echec, iso, nouvelId, texteNettoye } from './outils.mjs';
import { effacementUsage } from './usage/collecte.mjs';

const MOTIF_COMPTE = /^[a-z0-9]{6,16}$/;
const AFFECTATIONS_MAX = 20;

function lireCompte(valeur) {
  // « principal » : le Fondateur (jeton maître), jamais un compte d'ami.
  if (typeof valeur !== 'string' || !MOTIF_COMPTE.test(valeur) || valeur === 'principal') throw echec(400, 'compte', 'Identifiant de compte invalide.');
  return valeur;
}

const lirePoste = valeur => (valeur ? texteNettoye(valeur, 30) || null : null);

/** Statut d'un compte Esport : invité (créé depuis l'Esport, jamais connecté) ou actif. */
const statutCompte = c => (c.invite_le && !c.active_le ? 'invite' : 'actif');

export function servicesComptes({ base, maintenant = () => Date.now(), noyau, demandes }) {
  const { contexteTeam, contextesDe, exiger, exigerRoleGerable, roleGerable, roleDeTeam } = noyau;

  /** Teams (et rôles) demandées : chaque team accessible, rôle de la team, une seule fois par team. */
  async function lireAffectations(acteur, liste) {
    if (!Array.isArray(liste) || liste.length === 0) throw echec(400, 'affectations', 'Choisissez au moins une team et un rôle.');
    if (liste.length > AFFECTATIONS_MAX) throw echec(400, 'affectations', `${AFFECTATIONS_MAX} teams au plus.`);
    const vues = new Set();
    const sortie = [];
    for (const a of liste) {
      const ctx = await contexteTeam(acteur, a?.teamId);
      if (vues.has(ctx.team.id)) throw echec(400, 'affectations', 'Une même team est demandée deux fois.');
      vues.add(ctx.team.id);
      exiger(ctx, 'members.invite');
      const role = await roleDeTeam(ctx.team.id, a?.roleId);
      await exigerRoleGerable(ctx, role, 'Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre.');
      sortie.push({ ctx, role, posteJeu: lirePoste(a?.posteJeu) });
    }
    return sortie;
  }

  async function pseudoLibre(pseudo, sauf = '') {
    const pris = await base.premier('SELECT id FROM comptes WHERE pseudo_cle = ? AND id <> ?', [pseudo.toLocaleLowerCase('fr'), sauf]);
    if (pris) throw echec(409, 'pseudo-pris', 'Ce pseudo est déjà pris dans l’Esport.');
  }

  /**
   * `POST /comptes` (super admin) : pré-enregistre un compte du hub tout juste
   * créé, avec son pseudo et ses teams. `verifier: true` : contrôle seulement
   * (pseudo libre, teams et rôles valides), AVANT de créer le compte du hub.
   */
  async function preinscrire(acteur, corps) {
    if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Seul le Fondateur crée des comptes : il faut ses clés du hub (Administration).');
    const pseudo = lirePseudo(corps?.pseudo);
    // Discord ID obligatoire à la création (migration 0015) : le bot pingue les convoqués avec.
    const discordId = lireDiscordId(corps?.discordId, { obligatoire: true });
    const affectations = await lireAffectations(acteur, corps?.affectations);
    // Compte déjà connu : message exact (et non « pseudo pris », qui serait le sien), avant le contrôle du pseudo.
    if (corps?.verifier !== true) {
      const deja = await base.premier('SELECT id FROM comptes WHERE id = ?', [lireCompte(corps?.compte)]);
      if (deja) throw echec(409, 'compte-existe', 'Ce compte a déjà un profil Esport : ajoutez-le à ses teams depuis la page Membres.');
    }
    await pseudoLibre(pseudo);
    await discordIdLibre(base, discordId);
    // Validation d'une demande de compte (members.create) : la demande doit être en attente ; close dans le même lot.
    const demande = corps?.demandeId !== undefined && corps?.demandeId !== null ? await demandes.aValider(acteur, corps.demandeId) : null;
    if (corps?.verifier === true) return { ok: true, verifie: true };
    const compte = lireCompte(corps?.compte);
    if (await base.premier('SELECT id FROM comptes WHERE id = ?', [compte])) {
      throw echec(409, 'compte-existe', 'Ce compte a déjà un profil Esport : ajoutez-le à une team depuis la page Membres.');
    }
    const t = maintenant();
    const date = iso(t);
    const lot = [
      {
        sql: 'INSERT INTO comptes (id, pseudo, pseudo_cle, cree_le, maj_le, invite_par, invite_le, discord_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [compte, pseudo, pseudo.toLocaleLowerCase('fr'), date, date, acteur.compte, date, discordId],
      },
    ];
    for (const { ctx, role, posteJeu } of affectations) {
      const membreId = nouvelId();
      lot.push(
        {
          sql: "INSERT INTO membres (id, team_id, compte_id, role_id, poste_jeu, statut, rejoint_le, maj_le) VALUES (?, ?, ?, ?, ?, 'actif', ?, ?)",
          params: [membreId, ctx.team.id, compte, role.id, posteJeu, date, date],
        },
        evenement('member.added', {
          teamId: ctx.team.id,
          acteur: acteur.compte,
          entiteType: 'membre',
          entiteId: membreId,
          charge: { compte, role: role.nom, invite: true },
          maintenant: t,
        }),
      );
    }
    if (demande) lot.push(...demandes.cloreValidee(acteur, demande, compte, t));
    try {
      await base.lot(lot);
    } catch (e) {
      // Deux créations simultanées du même pseudo : la contrainte UNIQUE tranche.
      if (/discord_id/i.test(String(e?.message ?? e))) throw echec(409, 'discord-id-pris', 'Ce Discord ID est déjà celui d’un autre membre de l’Esport.');
      if (/unique/i.test(String(e?.message ?? e))) throw echec(409, 'pseudo-pris', 'Ce pseudo est déjà pris dans l’Esport.');
      throw e;
    }
    return ficheCompte(acteur, compte);
  }

  /**
   * `POST /comptes/:compte/teams` : ajoute un compte à UNE OU PLUSIEURS teams en
   * une fois, un rôle par team, quel que soit son état :
   *  - compte déjà connu (invité, actif, avec ou sans team) : il rejoint les
   *    teams demandées ; son pseudo ne change pas ; les autres teams ne bougent pas ;
   *  - compte du hub sans fiche Esport (jamais connecté) : le Fondateur le
   *    pré-enregistre (`pseudo` requis), comme une invitation directe.
   * Tout ou rien : une team déjà rejointe, un rôle non attribuable (anti-escalade)
   * ou une team inaccessible refuse l'ensemble, sans rien écrire.
   */
  async function ajouterATeams(acteur, compteId, corps) {
    const id = compteId === 'principal' && acteur.superAdmin ? 'principal' : lireCompte(compteId);
    const fiche = await base.premier('SELECT * FROM comptes WHERE id = ?', [id]);
    if (!fiche) {
      if (!acteur.superAdmin) throw echec(404, 'compte-introuvable', 'Compte introuvable (il doit déjà être membre d’une de vos teams).');
      return preinscrire(acteur, { compte: id, pseudo: corps?.pseudo, discordId: corps?.discordId, affectations: corps?.affectations });
    }
    const liste = corps?.affectations;
    if (!Array.isArray(liste) || liste.length === 0) throw echec(400, 'affectations', 'Choisissez au moins une team et un rôle.');
    if (liste.length > AFFECTATIONS_MAX) throw echec(400, 'affectations', `${AFFECTATIONS_MAX} teams au plus.`);
    const vues = new Set();
    const prevues = [];
    let toutCreateur = true;
    for (const a of liste) {
      const ctx = await contexteTeam(acteur, a?.teamId);
      if (vues.has(ctx.team.id)) throw echec(400, 'affectations', 'Une même team est demandée deux fois.');
      vues.add(ctx.team.id);
      if (autorise(ctx.permissions, ctx.modules, 'members.create')) {
        // Créateur : tout compte qui a un profil Esport.
      } else {
        exiger(ctx, 'members.invite');
        toutCreateur = false;
      }
      const role = await roleDeTeam(ctx.team.id, a?.roleId);
      await exigerRoleGerable(ctx, role, 'Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre.');
      prevues.push({ ctx, role, posteJeu: lirePoste(a?.posteJeu) });
    }
    if (!toutCreateur && !(await compteVisible(acteur, id))) throw echec(404, 'compte-introuvable', 'Compte introuvable (il doit déjà être membre d’une de vos teams).');
    const deja = [];
    for (const { ctx } of prevues) {
      if (await base.premier('SELECT id FROM membres WHERE team_id = ? AND compte_id = ?', [ctx.team.id, id])) deja.push(ctx.team.nom);
    }
    if (deja.length > 0) throw echec(409, 'deja-membre', `${fiche.pseudo} est déjà membre de ${deja.join(', ')}.`);
    const t = maintenant();
    const date = iso(t);
    const actif = statutCompte(fiche) === 'actif';
    const lot = [];
    for (const { ctx, role, posteJeu } of prevues) {
      const membreId = nouvelId();
      lot.push(
        {
          sql: "INSERT INTO membres (id, team_id, compte_id, role_id, poste_jeu, statut, rejoint_le, maj_le) VALUES (?, ?, ?, ?, ?, 'actif', ?, ?)",
          params: [membreId, ctx.team.id, id, role.id, posteJeu, date, date],
        },
        evenement('member.added', { teamId: ctx.team.id, acteur: acteur.compte, entiteType: 'membre', entiteId: membreId, charge: { compte: id, role: role.nom, invite: !actif }, maintenant: t }),
      );
      // Compte déjà actif : il arrive tout de suite ; invité : à sa première session.
      if (actif) lot.push(evenement('member.joined', { teamId: ctx.team.id, acteur: id, entiteType: 'membre', entiteId: membreId, charge: { role: role.nom, ajoutePar: acteur.compte }, maintenant: t }));
    }
    await base.lot(lot);
    return ficheCompte(acteur, id);
  }

  /** Teams où l'acteur voit les membres (`members.view`) : périmètre de ce qu'il peut connaître des comptes. */
  async function contextesMembres(acteur) {
    return (await contextesDe(acteur)).filter(ctx => ctx.permissions.has('members.view'));
  }

  /** Le compte est-il visible de l'acteur (membre d'une team où l'acteur voit les membres) ? */
  async function compteVisible(acteur, compte) {
    if (acteur.superAdmin) return true;
    const ids = (await contextesMembres(acteur)).map(c => c.team.id);
    if (ids.length === 0) return false;
    return Boolean(await base.premier(`SELECT id FROM membres WHERE compte_id = ? AND team_id IN (${ids.map(() => '?').join(', ')})`, [compte, ...ids]));
  }

  /**
   * `POST /teams/:id/membres` : ajoute un compte EXISTANT à une team, avec un
   * rôle attribuable par l'acteur (anti-escalade).
   *  - `members.invite` : un compte déjà visible de l'acteur (membre d'une de
   *    ses teams) ; on n'ajoute pas un inconnu ;
   *  - `members.create` : tout compte du hub qui a DÉJÀ un profil Esport,
   *    désigné par son identifiant ou son pseudo exact (`pseudo`) : pas besoin
   *    du Fondateur, le compte existe.
   */
  async function ajouterMembre(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    const createur = autorise(ctx.permissions, ctx.modules, 'members.create');
    if (!createur) exiger(ctx, 'members.invite');
    const role = await roleDeTeam(teamId, corps?.roleId);
    await exigerRoleGerable(ctx, role, 'Vous ne pouvez pas attribuer un rôle plus élevé que le vôtre.');
    let fiche;
    if (corps?.compte === undefined && typeof corps?.pseudo === 'string' && createur) {
      fiche = await base.premier('SELECT * FROM comptes WHERE pseudo_cle = ?', [texteNettoye(corps.pseudo, 24).toLocaleLowerCase('fr')]);
      if (fiche?.id === 'principal' && !acteur.superAdmin) fiche = null;
    } else {
      const id = corps?.compte === 'principal' && acteur.superAdmin ? 'principal' : lireCompte(corps?.compte);
      fiche = await base.premier('SELECT * FROM comptes WHERE id = ?', [id]);
      if (fiche && !createur && !(await compteVisible(acteur, id))) fiche = null;
    }
    if (!fiche) throw echec(404, 'compte-introuvable', createur ? 'Aucun compte de l’Esport à ce nom : demandez sa création au Fondateur.' : 'Compte introuvable (il doit déjà être membre d’une de vos teams).');
    const compte = fiche.id;
    if (await base.premier('SELECT id FROM membres WHERE team_id = ? AND compte_id = ?', [teamId, compte])) throw echec(409, 'deja-membre', `${fiche.pseudo} est déjà membre de cette team.`);
    const t = maintenant();
    const date = iso(t);
    const membreId = nouvelId();
    const lot = [
      {
        sql: "INSERT INTO membres (id, team_id, compte_id, role_id, poste_jeu, statut, rejoint_le, maj_le) VALUES (?, ?, ?, ?, ?, 'actif', ?, ?)",
        params: [membreId, teamId, compte, role.id, lirePoste(corps?.posteJeu), date, date],
      },
      evenement('member.added', { teamId, acteur: acteur.compte, entiteType: 'membre', entiteId: membreId, charge: { compte, role: role.nom, invite: statutCompte(fiche) === 'invite' }, maintenant: t }),
    ];
    // Compte déjà actif : il arrive tout de suite (bienvenue, annonce au staff, Discord) ; invité : à sa première session.
    if (statutCompte(fiche) === 'actif') {
      lot.push(evenement('member.joined', { teamId, acteur: compte, entiteType: 'membre', entiteId: membreId, charge: { role: role.nom, ajoutePar: acteur.compte }, maintenant: t }));
    }
    await base.lot(lot);
    return ficheCompte(acteur, compte);
  }

  /**
   * `GET /membres` : annuaire de premier niveau. Toutes les teams où l'acteur
   * voit les membres (le super admin : toutes), leurs rôles (avec ceux qu'il
   * peut attribuer) et ses droits ; puis chaque compte avec ses
   * appartenances dans CES teams seulement. Rien d'une autre team ne sort.
   */
  async function annuaire(acteur) {
    // Teams où l'on voit les membres, et celles où l'on peut en proposer (members.create) : rôles et droits.
    const ctxs = (await contextesDe(acteur)).filter(ctx => ctx.permissions.has('members.view') || ctx.permissions.has('members.create'));
    const ids = ctxs.map(c => c.team.id);
    // Les comptes ne sortent que des teams où l'on voit les membres.
    const idsVus = ctxs.filter(ctx => ctx.permissions.has('members.view')).map(c => c.team.id);
    const teams = [];
    const rolesParId = new Map();
    const gerables = new Set();
    if (ids.length > 0) {
      const roles = await base.tous(`SELECT * FROM roles WHERE team_id IN (${ids.map(() => '?').join(', ')}) ORDER BY position, nom`, ids);
      for (const ctx of ctxs) {
        const sien = [];
        for (const r of roles.filter(x => x.team_id === ctx.team.id)) {
          const attribuable = await roleGerable(ctx, r);
          if (attribuable) gerables.add(r.id);
          rolesParId.set(r.id, r);
          sien.push({ id: r.id, nom: r.nom, couleur: r.couleur, cle: r.cle_systeme ?? null, position: Number(r.position), systeme: Number(r.systeme) === 1, attribuable });
        }
        const p = perm => ctx.permissions.has(perm);
        teams.push({
          id: ctx.team.id,
          nom: ctx.team.nom,
          slug: ctx.team.slug,
          jeu: ctx.team.jeu,
          archivee: Boolean(ctx.team.archivee_le),
          droits: { ajouter: p('members.invite'), demander: p('members.create'), roles: p('members.assign_role'), retirer: p('members.remove') },
          roles: sien,
        });
      }
    }
    const lignes =
      idsVus.length > 0
        ? await base.tous(
            `SELECT m.id, m.team_id, m.compte_id, m.role_id, m.poste_jeu, m.statut, m.rejoint_le, c.pseudo, c.pseudo_cle, c.riot_id, c.discord, c.discord_id, c.invite_le, c.active_le, dc.discord_user_id AS discord_lie
               FROM membres m JOIN comptes c ON c.id = m.compte_id LEFT JOIN discord_comptes dc ON dc.compte_id = c.id
              WHERE m.team_id IN (${idsVus.map(() => '?').join(', ')}) ORDER BY c.pseudo_cle`,
            idsVus,
          )
        : [];
    const comptes = new Map();
    const fiche = l => ({
      compte: l.compte_id ?? l.id,
      pseudo: l.pseudo,
      riotId: l.riot_id ?? null,
      discord: l.discord ?? null,
      // Discord ID (champ du membre) et liaison /lier vérifiée (elle prime pour les pings).
      discordId: l.discord_id ?? null,
      discordLie: Boolean(l.discord_lie),
      statut: statutCompte(l),
      inviteLe: l.invite_le ?? null,
      activeLe: l.active_le ?? null,
      moi: (l.compte_id ?? l.id) === acteur.compte,
      appartenances: [],
    });
    for (const l of lignes) {
      if (!comptes.has(l.compte_id)) comptes.set(l.compte_id, fiche(l));
      const role = rolesParId.get(l.role_id);
      comptes.get(l.compte_id).appartenances.push({
        teamId: l.team_id,
        membreId: l.id,
        role: { id: l.role_id, nom: role?.nom ?? '?', couleur: role?.couleur ?? '#8b8b9a', cle: role?.cle_systeme ?? null },
        posteJeu: l.poste_jeu ?? null,
        statut: l.statut,
        rejointLe: l.rejoint_le,
        // Rôle du membre sous celui de l'acteur (anti-escalade) : il peut agir sur lui.
        gerable: gerables.has(l.role_id),
      });
    }
    if (acteur.superAdmin) {
      // Le Fondateur voit aussi les comptes sans team (retirés de toutes, ou rattachement à refaire).
      for (const c of await base.tous('SELECT c.*, dc.discord_user_id AS discord_lie FROM comptes c LEFT JOIN discord_comptes dc ON dc.compte_id = c.id WHERE c.id NOT IN (SELECT compte_id FROM membres) ORDER BY c.pseudo_cle', [])) {
        if (!comptes.has(c.id)) comptes.set(c.id, fiche(c));
      }
    }
    const liste = [...comptes.values()].sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
    // Demandes de compte : en attente (Fondateur : toutes ; sinon les siennes).
    const attente = await base.premier(
      acteur.superAdmin ? "SELECT COUNT(*) AS n FROM demandes_compte WHERE statut = 'en_attente'" : "SELECT COUNT(*) AS n FROM demandes_compte WHERE statut = 'en_attente' AND demandeur_id = ?",
      acteur.superAdmin ? [] : [acteur.compte],
    );
    return {
      superAdmin: acteur.superAdmin,
      peutCreerCompte: acteur.superAdmin,
      // Seul le Fondateur modifie un Discord ID (contrôle serveur : majDiscordId).
      peutModifierDiscordId: acteur.superAdmin,
      teams,
      comptes: liste,
      demandesEnAttente: Number(attente?.n ?? 0),
    };
  }

  async function ficheCompte(acteur, compte) {
    const { comptes } = await annuaire(acteur);
    return comptes.find(c => c.compte === compte) ?? null;
  }

  /**
   * Première session Esport d'un compte : invité → actif. Chaque team
   * pré-enregistrée annonce son arrivée (`member.joined` : bienvenue, staff,
   * Discord). Idempotent : la date n'est posée qu'une fois.
   */
  async function activer(compte) {
    const fiche = await base.premier('SELECT invite_le, active_le FROM comptes WHERE id = ?', [compte]);
    if (!fiche || fiche.active_le) return false;
    const t = maintenant();
    const r = await base.executer('UPDATE comptes SET active_le = ? WHERE id = ? AND active_le IS NULL', [iso(t), compte]);
    if (!fiche.invite_le || r.changements === 0) return false;
    const membres = await base.tous(
      "SELECT m.id, m.team_id, r.nom AS role_nom FROM membres m JOIN roles r ON r.id = m.role_id JOIN teams t ON t.id = m.team_id WHERE m.compte_id = ? AND t.supprimee_le IS NULL",
      [compte],
    );
    if (membres.length > 0) {
      await base.lot(membres.map(m => evenement('member.joined', { teamId: m.team_id, acteur: compte, entiteType: 'membre', entiteId: m.id, charge: { role: m.role_nom, invitationDirecte: true }, maintenant: t })));
    }
    return true;
  }

  /**
   * `DELETE /admin/comptes/:compte/hub` (super admin) : le compte a été supprimé
   * dans l'Administration (source de vérité des comptes). Il quitte toutes
   * ses teams et ses données personnelles Esport sont effacées, comme pour
   * « Supprimer mes données » (sans le blocage du dernier Propriétaire : le
   * Fondateur garde la main sur toutes les teams). Idempotent.
   */
  async function retirerCompte(acteur, compte) {
    if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Réservé au Fondateur.');
    lireCompte(compte);
    const membres = await base.tous('SELECT m.*, r.cle_systeme FROM membres m JOIN roles r ON r.id = m.role_id WHERE m.compte_id = ?', [compte]);
    const existe = await base.premier('SELECT id, pseudo FROM comptes WHERE id = ?', [compte]);
    if (!existe && membres.length === 0) return { ok: true, retire: false, teams: 0 };
    const t = maintenant();
    const lot = membres.map(m =>
      evenement('member.removed', {
        teamId: m.team_id,
        acteur: acteur.compte,
        entiteType: 'membre',
        entiteId: m.id,
        // Pseudo gardé dans l'événement : le journal reste lisible une fois le compte effacé.
        charge: { compte, pseudo: existe?.pseudo ?? null, suppression: 'administration', proprietaire: m.cle_systeme === CLE_PROPRIETAIRE },
        maintenant: t,
      }),
    );
    lot.push(
      { sql: 'DELETE FROM membres WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM notifications WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM dispo_regles WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM dispo_exceptions WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM presences WHERE compte_id = ?', params: [compte] },
      // Ses demandes de compte en attente (avec l'adresse proposée) disparaissent.
      { sql: "DELETE FROM demandes_compte WHERE demandeur_id = ? AND statut = 'en_attente'", params: [compte] },
      { sql: 'DELETE FROM ical_jetons WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM discord_comptes WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM discord_codes WHERE compte_id = ?', params: [compte] },
      // Récapitulatif e-mail (migration 0015) : l'adresse chiffrée disparaît avec le compte.
      { sql: 'DELETE FROM courriel_recap WHERE compte_id = ?', params: [compte] },
      // Anonymisation, comme « Supprimer mes données » : plus rien n'est attribué à ce compte.
      { sql: 'UPDATE taches SET assigne_id = NULL WHERE assigne_id = ?', params: [compte] },
      { sql: 'UPDATE objectifs SET proprietaire_id = NULL WHERE proprietaire_id = ?', params: [compte] },
      { sql: 'UPDATE review_reperes SET cible_id = NULL WHERE cible_id = ?', params: [compte] },
      { sql: 'DELETE FROM review_reactions WHERE compte_id = ?', params: [compte] },
      // Ressources (migration 0017) : publiées et commentaires restent, anonymes ; favoris, réactions et visites effacés.
      { sql: 'UPDATE ressources SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
      { sql: 'UPDATE ressources SET valide_par = NULL WHERE valide_par = ?', params: [compte] },
      { sql: 'UPDATE ressource_commentaires SET auteur_id = NULL WHERE auteur_id = ?', params: [compte] },
      { sql: 'DELETE FROM ressource_favoris WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM ressource_reactions WHERE compte_id = ?', params: [compte] },
      { sql: 'DELETE FROM ressource_visites WHERE compte_id = ?', params: [compte] },
      // Suivi des joueurs : les notes du staff SUR lui sont effacées (ses données) ; celles qu'il a écrites restent, sans auteur.
      { sql: 'DELETE FROM notes_joueurs WHERE joueur_id = ?', params: [compte] },
      { sql: 'UPDATE notes_joueurs SET auteur_id = NULL, auteur_masque = 1 WHERE auteur_id = ?', params: [compte] },
      // Statistiques d'usage (migration 0018) : détail et agrégats du compte effacés.
      ...effacementUsage(compte),
      { sql: 'DELETE FROM comptes WHERE id = ?', params: [compte] },
      evenement('account.deleted', { acteur: acteur.compte, entiteType: 'compte', entiteId: compte, charge: { teams: membres.length, par: 'administration' }, maintenant: t }),
    );
    await base.lot(lot);
    return { ok: true, retire: true, teams: membres.length };
  }

  /**
   * `PUT /comptes/:compte/discord-id` `{ discordId }` : le Fondateur SEUL (super admin) pose, corrige ou
   * retire (`null`) le Discord ID d'un membre. Tout autre rôle, Propriétaire compris : 403.
   */
  async function majDiscordId(acteur, compteId, corps) {
    if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Seul le Fondateur modifie le Discord ID d’un membre.');
    const id = compteId === 'principal' ? 'principal' : lireCompte(compteId);
    const fiche = await base.premier('SELECT id FROM comptes WHERE id = ?', [id]);
    if (!fiche) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    const discordId = corps?.discordId === null ? null : lireDiscordId(corps?.discordId, { obligatoire: true });
    await discordIdLibre(base, discordId, id);
    try {
      await base.executer('UPDATE comptes SET discord_id = ?, maj_le = ? WHERE id = ?', [discordId, iso(maintenant()), id]);
    } catch (e) {
      if (/unique|discord_id/i.test(String(e?.message ?? e))) throw echec(409, 'discord-id-pris', 'Ce Discord ID est déjà celui d’un autre membre de l’Esport.');
      throw e;
    }
    return ficheCompte(acteur, id);
  }

  return { preinscrire, ajouterATeams, ajouterMembre, annuaire, activer, retirerCompte, majDiscordId };
}

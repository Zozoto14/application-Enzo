/**
 * Demandes de compte (permission `members.create`).
 *
 * Créer un compte du hub exige les clés du Fondateur (séquestre), sur un
 * appareil où il est connecté : un membre qui a `members.create` sans être le
 * Fondateur ne crée donc pas le compte lui-même. Il dépose une DEMANDE : nom
 * (pseudo), adresse e-mail, team et rôle (un rôle qu'il peut attribuer :
 * anti-escalade, jamais au-dessus du sien). Le Fondateur la voit dans
 * Esport › Membres (« Demandes en attente », notification in-app, Discord si
 * la team l'a activé) et :
 *  - la VALIDE en un clic : son app crée le compte du hub (comme une
 *    invitation directe), puis `POST /comptes` avec `demandeId` pré-enregistre
 *    le compte dans la team ET clôt la demande dans le même lot ;
 *  - ou la REFUSE (motif facultatif).
 * Le demandeur suit le statut de ses demandes ; il peut annuler une demande
 * en attente. L'adresse e-mail n'est gardée que jusqu'à la décision.
 *
 * Isolation : une demande ne se dépose que dans une team dont on est membre
 * avec la permission (404 sinon) ; le demandeur ne voit que les siennes.
 */

import { discordIdLibre, lireDiscordId } from './discordId.mjs';
import { evenement } from './evenements.mjs';
import { lirePseudo } from './service.mjs';
import { echec, iso, nouvelId, texteNettoye } from './outils.mjs';

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const DEMANDES_EN_ATTENTE_MAX = 10;

export function lireEmail(valeur) {
  const email = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
  if (email.length > 254 || !MOTIF_EMAIL.test(email)) throw echec(400, 'email', 'Adresse e-mail invalide : c’est par elle que partira l’invitation.');
  return email;
}

export function servicesDemandes({ base, maintenant = () => Date.now(), noyau }) {
  const { contexteTeam, exiger, exigerRoleGerable, roleDeTeam } = noyau;

  async function demandeDe(id) {
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'demande-introuvable', 'Demande introuvable.');
    const d = await base.premier('SELECT * FROM demandes_compte WHERE id = ?', [id]);
    if (!d) throw echec(404, 'demande-introuvable', 'Demande introuvable.');
    return d;
  }

  /** Forme publique ; l'adresse n'est montrée qu'au Fondateur et au demandeur, tant que la demande attend. */
  async function publiques(lignes, acteur) {
    if (lignes.length === 0) return [];
    const teams = new Map((await base.tous(`SELECT id, nom, slug FROM teams WHERE id IN (${lignes.map(() => '?').join(', ')})`, lignes.map(l => l.team_id))).map(t => [t.id, t]));
    const roles = new Map((await base.tous(`SELECT id, nom, couleur, cle_systeme FROM roles WHERE id IN (${lignes.map(() => '?').join(', ')})`, lignes.map(l => l.role_id))).map(r => [r.id, r]));
    const comptes = [...new Set(lignes.map(l => l.demandeur_id))];
    const pseudos = new Map((await base.tous(`SELECT id, pseudo FROM comptes WHERE id IN (${comptes.map(() => '?').join(', ')})`, comptes)).map(c => [c.id, c.pseudo]));
    return lignes.map(l => ({
      id: l.id,
      teamId: l.team_id,
      team: teams.get(l.team_id)?.nom ?? null,
      teamSlug: teams.get(l.team_id)?.slug ?? null,
      role: { id: l.role_id, nom: roles.get(l.role_id)?.nom ?? '?', couleur: roles.get(l.role_id)?.couleur ?? '#8b8b9a', cle: roles.get(l.role_id)?.cle_systeme ?? null },
      demandeur: l.demandeur_id,
      demandeurPseudo: pseudos.get(l.demandeur_id) ?? null,
      pseudo: l.pseudo,
      email: l.statut === 'en_attente' && (acteur.superAdmin || l.demandeur_id === acteur.compte) ? (l.email ?? null) : null,
      posteJeu: l.poste_jeu ?? null,
      // Discord ID proposé par le demandeur (facultatif) : le Fondateur le vérifie à la validation.
      discordId: l.discord_id ?? null,
      message: l.message ?? '',
      statut: l.statut,
      compte: l.compte_id ?? null,
      motif: l.motif ?? '',
      creeLe: l.cree_le,
      traiteLe: l.traite_le ?? null,
    }));
  }

  /** `POST /comptes/demandes` : { teamId, roleId, pseudo, email, posteJeu?, message? }. */
  async function creer(acteur, corps) {
    const ctx = await contexteTeam(acteur, corps?.teamId);
    exiger(ctx, 'members.create');
    if (ctx.team.archivee_le) throw echec(409, 'team-archivee', 'Cette team est archivée.');
    const role = await roleDeTeam(ctx.team.id, corps?.roleId);
    await exigerRoleGerable(ctx, role, 'Vous ne pouvez pas proposer un rôle plus élevé que le vôtre.');
    const pseudo = lirePseudo(corps?.pseudo);
    const email = lireEmail(corps?.email);
    const discordId = lireDiscordId(corps?.discordId);
    await discordIdLibre(base, discordId);
    const cle = pseudo.toLocaleLowerCase('fr');
    if (await base.premier('SELECT id FROM comptes WHERE pseudo_cle = ?', [cle])) {
      throw echec(409, 'pseudo-pris', 'Ce pseudo est déjà pris dans l’Esport : si ce compte existe déjà, ajoutez-le simplement à la team.');
    }
    if (await base.premier("SELECT id FROM demandes_compte WHERE pseudo_cle = ? AND statut = 'en_attente'", [cle])) {
      throw echec(409, 'demande-existe', 'Une demande est déjà en attente pour ce pseudo.');
    }
    const n = await base.premier("SELECT COUNT(*) AS n FROM demandes_compte WHERE demandeur_id = ? AND statut = 'en_attente'", [acteur.compte]);
    if (Number(n?.n ?? 0) >= DEMANDES_EN_ATTENTE_MAX) throw echec(409, 'trop-de-demandes', `${DEMANDES_EN_ATTENTE_MAX} demandes en attente au plus : attendez la réponse du Fondateur.`);
    const t = maintenant();
    const id = nouvelId();
    const poste = corps?.posteJeu ? texteNettoye(corps.posteJeu, 30) || null : null;
    await base.lot([
      {
        sql: `INSERT INTO demandes_compte (id, team_id, role_id, demandeur_id, pseudo, pseudo_cle, email, poste_jeu, message, statut, cree_le, maj_le, discord_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
        params: [id, ctx.team.id, role.id, acteur.compte, pseudo, cle, email, poste, texteNettoye(corps?.message, 200), iso(t), iso(t), discordId],
      },
      // Jamais l'adresse dans l'événement : il alimente le journal et Discord.
      evenement('member.account_requested', { teamId: ctx.team.id, acteur: acteur.compte, entiteType: 'demande', entiteId: id, charge: { pseudo, role: role.nom }, maintenant: t }),
    ]);
    return (await publiques([await demandeDe(id)], acteur))[0];
  }

  /**
   * `GET /comptes/demandes` : le Fondateur voit toutes les demandes en attente
   * (et les 30 dernières traitées) ; les autres, les leurs.
   */
  async function liste(acteur) {
    const lignes = acteur.superAdmin
      ? [
          ...(await base.tous("SELECT * FROM demandes_compte WHERE statut = 'en_attente' ORDER BY cree_le", [])),
          ...(await base.tous("SELECT * FROM demandes_compte WHERE statut <> 'en_attente' ORDER BY maj_le DESC LIMIT 30", [])),
        ]
      : await base.tous('SELECT * FROM demandes_compte WHERE demandeur_id = ? ORDER BY cree_le DESC LIMIT 30', [acteur.compte]);
    const demandes = await publiques(lignes, acteur);
    return { demandes, enAttente: demandes.filter(d => d.statut === 'en_attente').length, fondateur: acteur.superAdmin };
  }

  /** Demande en attente que le Fondateur peut valider (contrôle de `POST /comptes` avec `demandeId`). */
  async function aValider(acteur, id) {
    if (!acteur.superAdmin) throw echec(403, 'super-admin', 'Seul le Fondateur valide une demande de compte.');
    const d = await demandeDe(id);
    if (d.statut !== 'en_attente') throw echec(409, 'demande-traitee', 'Cette demande a déjà été traitée.');
    return d;
  }

  /** Instructions à ajouter au lot de la pré-inscription : la demande est close, l'adresse effacée. */
  function cloreValidee(acteur, d, compte, t) {
    return [
      {
        sql: "UPDATE demandes_compte SET statut = 'validee', compte_id = ?, email = NULL, traite_par = ?, traite_le = ?, maj_le = ? WHERE id = ? AND statut = 'en_attente'",
        params: [compte, acteur.compte, iso(t), iso(t), d.id],
      },
      evenement('member.account_request_validated', { teamId: d.team_id, acteur: acteur.compte, entiteType: 'demande', entiteId: d.id, charge: { pseudo: d.pseudo, demandeur: d.demandeur_id, compte }, maintenant: t }),
    ];
  }

  /** `POST /comptes/demandes/:id/refuser` (Fondateur) : { motif? }. */
  async function refuser(acteur, id, corps) {
    const d = await aValider(acteur, id);
    const t = maintenant();
    const motif = texteNettoye(corps?.motif, 200);
    await base.lot([
      {
        sql: "UPDATE demandes_compte SET statut = 'refusee', email = NULL, motif = ?, traite_par = ?, traite_le = ?, maj_le = ? WHERE id = ? AND statut = 'en_attente'",
        params: [motif, acteur.compte, iso(t), iso(t), d.id],
      },
      evenement('member.account_request_refused', { teamId: d.team_id, acteur: acteur.compte, entiteType: 'demande', entiteId: d.id, charge: { pseudo: d.pseudo, demandeur: d.demandeur_id, motif }, maintenant: t }),
    ]);
    return (await publiques([await demandeDe(id)], acteur))[0];
  }

  /** `DELETE /comptes/demandes/:id` : le demandeur annule sa demande en attente. */
  async function annuler(acteur, id) {
    const d = await demandeDe(id);
    if (d.demandeur_id !== acteur.compte) throw echec(404, 'demande-introuvable', 'Demande introuvable.');
    if (d.statut !== 'en_attente') throw echec(409, 'demande-traitee', 'Cette demande a déjà été traitée.');
    const t = maintenant();
    await base.executer("UPDATE demandes_compte SET statut = 'annulee', email = NULL, maj_le = ? WHERE id = ? AND statut = 'en_attente'", [iso(t), d.id]);
    return { ok: true };
  }

  return { creer, liste, aValider, cloreValidee, refuser, annuler };
}

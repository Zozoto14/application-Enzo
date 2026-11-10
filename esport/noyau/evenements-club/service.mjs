/**
 * Événements organisés par le club : Administration › Événements (docs/esport/evenements.md) — migration 0064.
 *
 * Un événement (ex. le tournoi The Nuke End) : nom, jeu, dates, statut (à venir, en cours, terminé, annulé), catégorie
 * de tickets des inscriptions, réglages Discord (rôles automatiques, modèle `{tag} {nom}`, couleur, rôle repère :
 * les rôles créés sont placés juste en dessous ; suppression N heures après la fin) et équipes participantes (nom,
 * TAG, membres avec Discord ID, Embark ID, poste), ajoutées à la main ou importées des tickets d'inscription.
 *
 * Rôles automatiques (activés par défaut) : ajouter une équipe crée aussitôt son rôle, le place et le donne à ses
 * membres présents ; modifier une équipe renomme le rôle et met à jour les attributions (membres ajoutés / retirés) ;
 * retirer une équipe supprime son rôle et son salon vocal. Plus de création automatique une fois l'événement
 * terminé, annulé ou nettoyé (« Resynchroniser les rôles » reste possible tant qu'il n'est ni terminé ni annulé).
 * Sans bot ou sans serveur Discord, les équipes s'enregistrent quand même (la réponse le dit : `discord.erreur`).
 *
 * Droits : permission du club `evenements.gerer` (le Fondateur l'a d'office) pour tout, actions Discord comprises ;
 * l'import demande en plus de voir les tickets de la catégorie choisie (Tickets).
 */

import { echec, iso, jsonOu, nouvelId } from '../outils.mjs';
import { aGlobale } from '../roles/globales.mjs';
import { droitsTickets, voitCategorie } from '../tickets/acces.mjs';
import { instructionReglage, lireGeneral } from '../tickets/reglages.mjs';
import { rest } from '../tickets/discord.mjs';
import { lireVocaux, validerVocaux } from '../vocaux/reglages.mjs';
import { evenement as evenementBus } from '../evenements.mjs';
import { nomMembre } from '../vocaux/salons.mjs';
import {
  LIMITES_EQUIPES,
  MODELE_ROLE_DEFAUT,
  POSTES,
  lireReponsesInscription,
} from './inscriptions.mjs';
import {
  equipesDe,
  finiPourDiscord,
  nettoyerEvenement,
  placerRoles,
  rolesDuServeur,
  supprimerRoleEquipe,
  synchroniser,
  synchroniserStaff,
  retirerDesCategories,
  verifierAncre,
} from './discord.mjs';

export const PERMISSION_EVENEMENTS = 'evenements.gerer';
export const STATUTS_EVENEMENT = Object.freeze([
  'a_venir',
  'en_cours',
  'termine',
  'annule',
]);
export const SUPPRESSION_DEFAUT_H = 24;
export const LIMITES_EVENEMENTS = Object.freeze({
  ...LIMITES_EQUIPES,
  evenements: 200,
  nom: 80,
  description: 1000,
  staff: 50,
});
const ID = /^\d{17,20}$/;
const ID_ROLE = /^\d{5,25}$/;
const UUID = /^[0-9a-f-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const texte = (v, max, quoi, { requis = false } = {}) => {
  if (v === undefined || v === null) {
    if (requis) throw echec(400, quoi, 'Champ obligatoire.');
    return '';
  }
  if (typeof v !== 'string') throw echec(400, quoi, 'Texte attendu.');
  const s = v.replace(/\s+/g, ' ').trim();
  if (requis && !s) throw echec(400, quoi, 'Champ obligatoire.');
  if (s.length > max) throw echec(400, quoi, `${max} caractères au plus.`);
  return s;
};

function validerEquipe(c) {
  if (!c || typeof c !== 'object')
    throw echec(400, 'equipe', 'Équipe illisible.');
  const nom = texte(c.nom, 80, 'equipe-nom', { requis: true });
  const tag = texte(c.tag, 6, 'equipe-tag', { requis: true }).toUpperCase();
  if (!/^[\p{L}\p{N}]{1,6}$/u.test(tag))
    throw echec(400, 'equipe-tag', 'TAG : lettres et chiffres, 6 au plus.');
  const membres = c.membres === undefined ? [] : c.membres;
  if (!Array.isArray(membres) || membres.length > LIMITES_EQUIPES.membres)
    throw echec(400, 'equipe-membres', 'Membres : 10 au plus.');
  return {
    nom,
    tag,
    ticketId:
      typeof c.ticketId === 'string' && UUID.test(c.ticketId)
        ? c.ticketId
        : null,
    membres: membres.map(m => {
      const poste = POSTES.includes(m?.poste) ? m.poste : 'joueur';
      const discordId =
        m?.discordId === null ||
        m?.discordId === undefined ||
        m?.discordId === ''
          ? null
          : String(m.discordId).trim();
      if (discordId !== null && !ID.test(discordId))
        throw echec(
          400,
          'equipe-discord',
          'Discord ID invalide (17 à 20 chiffres).',
        );
      return {
        poste,
        discordId,
        nom: texte(m?.nom ?? '', 100, 'equipe-membre'),
        embarkId: texte(m?.embarkId ?? '', 60, 'equipe-embark'),
      };
    }),
  };
}

const date = (v, quoi) => {
  if (v === undefined || v === null || v === '') return null;
  if (
    typeof v !== 'string' ||
    !DATE.test(v) ||
    Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  )
    throw echec(400, quoi, 'Date : AAAA-MM-JJ.');
  return v;
};

export const STAFF_MODELE_DEFAUT = 'Staff {evenement}';

const resume = l => ({
  id: l.id,
  nom: l.nom,
  jeu: l.jeu ?? null,
  debut: l.debut ?? null,
  fin: l.fin ?? null,
  statut: l.statut,
  description: l.description ?? '',
  categorieTicketId: l.categorie_ticket_id ?? null,
  discord: {
    rolesAuto: Number(l.roles_auto) === 1,
    modeleRole: l.modele_role || MODELE_ROLE_DEFAUT,
    couleur: l.couleur ?? null,
    roleAncreId: l.role_ancre_id ?? null,
    suppressionH: Number(l.suppression_h ?? SUPPRESSION_DEFAUT_H),
    rolesCreesLe: l.roles_crees_le ?? null,
    rolesSupprimesLe: l.roles_supprimes_le ?? null,
    staffModele: l.staff_modele || STAFF_MODELE_DEFAUT,
    staffRoleId: l.staff_role_id ?? null,
    staffRoleNom: l.staff_role_nom ?? null,
  },
  categoriesTickets: jsonOu(l.categories_tickets, []),
  creeLe: l.cree_le,
  majLe: l.maj_le,
});

export function servicesEvenements({
  base,
  maintenant = () => Date.now(),
  fetch: fetchDiscord,
  jetonBot,
  journal = console,
}) {
  async function exiger(acteur) {
    if (!(await aGlobale(base, acteur, PERMISSION_EVENEMENTS)))
      throw echec(
        403,
        'permission',
        'Vous n’avez pas la permission de faire cela.',
      );
  }

  /** Contexte Discord (bot et serveur des tickets), ou `{ erreur }`. */
  async function discordCtx() {
    if (!jetonBot) return { erreur: 'bot-absent' };
    const general = await lireGeneral(base);
    if (!general.guildId) return { erreur: 'sans-serveur' };
    return {
      base,
      fetch: fetchDiscord,
      jetonBot,
      guildId: general.guildId,
      maintenant,
      erreur: null,
    };
  }

  async function exigerDiscord() {
    const c = await discordCtx();
    if (c.erreur === 'bot-absent')
      throw echec(
        503,
        'bot-absent',
        'Bot Discord non configuré (DISCORD_BOT_TOKEN).',
      );
    if (c.erreur)
      throw echec(
        400,
        'vocaux-serveur',
        'Choisissez d’abord le serveur Discord (Tickets › Configuration › Général).',
      );
    return c;
  }

  async function ligne(id) {
    if (typeof id !== 'string' || !UUID.test(id))
      throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    const l = await base.premier('SELECT * FROM club_evenements WHERE id = ?', [
      id,
    ]);
    if (!l) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    return l;
  }

  /** Rôles automatiques : actifs, et l'événement n'est ni fini ni nettoyé. */
  const auto = evt =>
    Number(evt.roles_auto) === 1 &&
    !evt.roles_supprimes_le &&
    !finiPourDiscord(evt, maintenant());

  async function choix() {
    return {
      statuts: STATUTS_EVENEMENT,
      postes: POSTES,
      jeux: (
        await base.tous(
          "SELECT cle, nom FROM jeux WHERE statut = 'actif' ORDER BY nom",
          [],
        )
      ).map(j => ({ cle: j.cle, nom: j.nom })),
      limites: LIMITES_EVENEMENTS,
      modeleDefaut: MODELE_ROLE_DEFAUT,
      suppressionDefautH: SUPPRESSION_DEFAUT_H,
    };
  }

  async function lister(acteur) {
    await exiger(acteur);
    const lignes = await base.tous(
      'SELECT * FROM club_evenements ORDER BY COALESCE(debut, cree_le) DESC, nom LIMIT 200',
      [],
    );
    const n = lignes.length
      ? await base.tous(
          `SELECT evenement_id, COUNT(*) AS n FROM club_evenement_equipes WHERE evenement_id IN (${lignes.map(() => '?').join(', ')}) GROUP BY evenement_id`,
          lignes.map(l => l.id),
        )
      : [];
    return {
      evenements: lignes.map(l => ({
        ...resume(l),
        equipes: Number(n.find(x => x.evenement_id === l.id)?.n ?? 0),
      })),
      choix: await choix(),
      bot: Boolean(jetonBot),
    };
  }

  async function lire(acteur, id, extra = {}) {
    await exiger(acteur);
    const l = await ligne(id);
    const d = await droitsTickets(base, acteur);
    const categories = (
      await base.tous(
        'SELECT id, nom_fr, nom_en FROM tickets_categories WHERE supprime_le IS NULL ORDER BY position, nom_fr',
        [],
      )
    ).filter(c => d.fondateur || voitCategorie(d, c.id));
    const general = await lireGeneral(base);
    return {
      evenement: resume(l),
      equipes: await equipesDe(base, id),
      staff: (await base.tous('SELECT * FROM club_evenement_staff WHERE evenement_id = ? ORDER BY position, cree_le', [id])).map(m => ({ id: m.id, discordId: m.discord_id, nom: m.nom, compteId: m.compte_id ?? null, roleStatut: m.role_statut ?? null })),
      categoriesTickets: categories.map(c => ({
        id: c.id,
        nom: { fr: c.nom_fr, en: c.nom_en },
      })),
      serveur: general.guildId
        ? { id: general.guildId, nom: general.guildNom ?? '' }
        : null,
      hubs: (await lireVocaux(base)).hubs
        .filter(h => h.tournoiId === id)
        .map(h => ({ id: h.id, nom: h.nom })),
      droits: {
        importer: categories.length > 0,
        vocaux: await aGlobale(base, acteur, 'vocaux.configurer'),
      },
      bot: Boolean(jetonBot),
      choix: await choix(),
      suppression: await suppressionDe(id),
      ...extra,
    };
  }

  /** Champs d'un événement (création : nom requis ; modification : seuls les champs fournis changent). */
  async function valider(c, actuel = null) {
    if (!c || typeof c !== 'object')
      throw echec(400, 'evenement', 'Événement illisible.');
    const s = actuel
      ? { ...actuel }
      : {
          nom: '',
          jeu: null,
          debut: null,
          fin: null,
          statut: 'a_venir',
          description: '',
          categorie_ticket_id: null,
          roles_auto: 1,
          modele_role: MODELE_ROLE_DEFAUT,
          couleur: null,
          role_ancre_id: null,
          suppression_h: SUPPRESSION_DEFAUT_H,
          staff_modele: STAFF_MODELE_DEFAUT,
          categories_tickets: '[]',
        };
    if (c.nom !== undefined || !actuel)
      s.nom = texte(c.nom, LIMITES_EVENEMENTS.nom, 'evenement-nom', {
        requis: true,
      });
    if (c.jeu !== undefined) {
      if (
        c.jeu &&
        !(await base.premier('SELECT cle FROM jeux WHERE cle = ?', [
          String(c.jeu),
        ]))
      )
        throw echec(400, 'evenement-jeu', 'Jeu introuvable.');
      s.jeu = c.jeu || null;
    }
    if (c.debut !== undefined) s.debut = date(c.debut, 'evenement-debut');
    if (c.fin !== undefined) s.fin = date(c.fin, 'evenement-fin');
    if (s.debut && s.fin && s.fin < s.debut)
      throw echec(
        400,
        'evenement-fin',
        'La date de fin précède la date de début.',
      );
    if (c.statut !== undefined) {
      if (!STATUTS_EVENEMENT.includes(c.statut))
        throw echec(400, 'evenement-statut', 'Statut inconnu.');
      s.statut = c.statut;
    }
    if (c.description !== undefined)
      s.description = texte(
        c.description,
        LIMITES_EVENEMENTS.description,
        'evenement-description',
      );
    if (c.categorieTicketId !== undefined) {
      if (
        c.categorieTicketId &&
        !(await base.premier('SELECT id FROM tickets_categories WHERE id = ?', [
          String(c.categorieTicketId),
        ]))
      )
        throw echec(400, 'categories', 'Catégorie introuvable.');
      s.categorie_ticket_id = c.categorieTicketId || null;
    }
    if (c.categoriesTickets !== undefined) {
      // Catégories de tickets de l'événement (inscriptions, support) : le rôle staff traite leurs tickets.
      if (!Array.isArray(c.categoriesTickets) || c.categoriesTickets.length > 10) throw echec(400, 'categories', 'Catégories de tickets : 10 au plus.');
      const ids = [...new Set(c.categoriesTickets.map(String))];
      for (const x of ids) if (!(await base.premier('SELECT id FROM tickets_categories WHERE id = ?', [x]))) throw echec(400, 'categories', 'Catégorie introuvable.');
      s.categories_tickets = JSON.stringify(ids);
    }
    const d = c.discord ?? {};
    if (d.staffModele !== undefined) {
      const m = texte(d.staffModele, 90, 'evenement-staff-modele');
      s.staff_modele = m || STAFF_MODELE_DEFAUT;
    }
    if (d.rolesAuto !== undefined) s.roles_auto = d.rolesAuto === false ? 0 : 1;
    if (d.modeleRole !== undefined) {
      const m = texte(d.modeleRole, 90, 'evenement-modele-role');
      if (m && !/\{(tag|nom)\}/.test(m))
        throw echec(
          400,
          'evenement-modele-role',
          'Le modèle du nom des rôles doit contenir {tag} ou {nom}.',
        );
      s.modele_role = m || MODELE_ROLE_DEFAUT;
    }
    if (d.couleur !== undefined) {
      if (
        d.couleur !== null &&
        d.couleur !== '' &&
        (typeof d.couleur !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(d.couleur))
      )
        throw echec(400, 'couleur', 'Couleur : #rrggbb.');
      s.couleur = d.couleur ? d.couleur.toLowerCase() : null;
    }
    if (d.roleAncreId !== undefined) {
      if (
        d.roleAncreId !== null &&
        d.roleAncreId !== '' &&
        (typeof d.roleAncreId !== 'string' || !ID_ROLE.test(d.roleAncreId))
      )
        throw echec(400, 'evenement-ancre', 'Rôle Discord invalide.');
      s.role_ancre_id = d.roleAncreId || null;
    }
    if (d.suppressionH !== undefined) {
      const n = Number(d.suppressionH);
      if (!Number.isInteger(n) || n < 0 || n > 720)
        throw echec(
          400,
          'evenement-suppression',
          'Délai de suppression des rôles : de 0 à 720 heures.',
        );
      s.suppression_h = n;
    }
    return s;
  }

  /** Rôle repère choisi : il doit exister et être SOUS le rôle du bot (sinon Discord refuserait de placer les rôles). */
  async function verifierRepere(ancreId) {
    if (!ancreId) return;
    const c = await discordCtx();
    if (c.erreur) return;
    const serveur = await rolesDuServeur(c);
    if (serveur.erreur) return;
    const v = verifierAncre(serveur, ancreId);
    if (v.raison === 'introuvable')
      throw echec(
        400,
        'evenement-ancre',
        'Rôle introuvable sur le serveur Discord.',
      );
    if (v.raison === 'au-dessus-du-bot')
      throw echec(
        400,
        'evenement-ancre',
        'Ce rôle est au-dessus du rôle du bot Esport HQ (ou c’est le sien) : le bot ne peut placer des rôles que sous son propre rôle. Choisissez un rôle plus bas, ou montez « Esport HQ » dans Paramètres du serveur › Rôles.',
      );
  }

  async function creer(acteur, corps) {
    await exiger(acteur);
    const n = await base.premier(
      'SELECT COUNT(*) AS n FROM club_evenements',
      [],
    );
    if (Number(n?.n ?? 0) >= LIMITES_EVENEMENTS.evenements)
      throw echec(409, 'trop', '200 événements au plus.');
    const s = await valider(corps);
    await verifierRepere(s.role_ancre_id);
    const id = nouvelId();
    const t = iso(maintenant());
    await base.executer(
      'INSERT INTO club_evenements (id, nom, jeu, debut, fin, statut, description, categorie_ticket_id, roles_auto, modele_role, couleur, role_ancre_id, suppression_h, staff_modele, categories_tickets, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        s.nom,
        s.jeu,
        s.debut,
        s.fin,
        s.statut,
        s.description,
        s.categorie_ticket_id,
        s.roles_auto,
        s.modele_role,
        s.couleur,
        s.role_ancre_id,
        s.suppression_h,
        s.staff_modele,
        s.categories_tickets,
        acteur.compte ?? null,
        t,
        t,
      ],
    );
    return lire(acteur, id);
  }

  async function modifier(acteur, id, corps) {
    await exiger(acteur);
    const avant = await ligne(id);
    const s = await valider(corps, avant);
    if (s.role_ancre_id !== avant.role_ancre_id)
      await verifierRepere(s.role_ancre_id);
    await base.executer(
      'UPDATE club_evenements SET nom = ?, jeu = ?, debut = ?, fin = ?, statut = ?, description = ?, categorie_ticket_id = ?, roles_auto = ?, modele_role = ?, couleur = ?, role_ancre_id = ?, suppression_h = ?, staff_modele = ?, categories_tickets = ?, maj_le = ? WHERE id = ?',
      [
        s.nom,
        s.jeu,
        s.debut,
        s.fin,
        s.statut,
        s.description,
        s.categorie_ticket_id,
        s.roles_auto,
        s.modele_role,
        s.couleur,
        s.role_ancre_id,
        s.suppression_h,
        s.staff_modele,
        s.categories_tickets,
        iso(maintenant()),
        id,
      ],
    );
    const evt = await ligne(id);
    // Rôles existants : renommés / recolorés si le modèle ou la couleur ont changé, replacés si le repère a changé.
    let discord = null;
    const aDesRoles = await base.premier(
      'SELECT id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL LIMIT 1',
      [id],
    );
    const recolorer = evt.couleur !== avant.couleur;
    if (
      aDesRoles &&
      !evt.roles_supprimes_le &&
      (evt.modele_role !== avant.modele_role ||
        recolorer ||
        evt.role_ancre_id !== avant.role_ancre_id)
    ) {
      const c = await discordCtx();
      if (!c.erreur) {
        const ids = (
          await base.tous(
            'SELECT id FROM club_evenement_equipes WHERE evenement_id = ? AND role_id IS NOT NULL',
            [id],
          )
        ).map(l => l.id);
        if (evt.modele_role !== avant.modele_role || recolorer)
          discord = await synchroniser(c, evt, { equipeIds: ids, recolorer });
        if (evt.role_ancre_id !== avant.role_ancre_id)
          discord = { ...(discord ?? {}), position: await placerRoles(c, evt) };
      }
    }
    // Rôle staff : catégories de tickets, nom de l'événement ou modèle changés (ou rôle déjà là) : mis à jour.
    let staff = null;
    const staffChange = evt.categories_tickets !== avant.categories_tickets || evt.staff_modele !== avant.staff_modele || evt.nom !== avant.nom;
    if (staffChange && (evt.staff_role_id || auto(evt))) {
      const c = await discordCtx();
      if (!c.erreur) staff = await synchroniserStaff(c, evt);
    }
    return lire(acteur, id, discord || staff ? { discord: { erreur: null, bilan: discord, staff } } : {});
  }

  /**
   * Personnes proposées pour le staff (`q` : 2 caractères au moins) : comptes de l'app qui ont lié leur Discord (pseudo
   * ou nom Discord), puis membres du serveur Discord (recherche du bot).
   */
  async function candidatsStaff(acteur, q) {
    await exiger(acteur);
    const texteQ = String(q ?? '').trim().slice(0, 32);
    if (texteQ.length < 2) return { candidats: [] };
    const motif = `%${texteQ.toLowerCase().replace(/[%_]/g, '')}%`;
    const app = await base.tous(
      "SELECT dc.compte_id, dc.discord_user_id, dc.discord_nom, c.pseudo FROM discord_comptes dc LEFT JOIN comptes c ON c.id = dc.compte_id WHERE LOWER(COALESCE(c.pseudo, '')) LIKE ? OR LOWER(dc.discord_nom) LIKE ? ORDER BY c.pseudo LIMIT 10",
      [motif, motif],
    );
    const candidats = app.map(l => ({ discordId: l.discord_user_id, nom: l.pseudo || l.discord_nom || l.discord_user_id, compteId: l.compte_id, source: 'app' }));
    const c = await discordCtx();
    if (!c.erreur) {
      const r = await rest(fetchDiscord, jetonBot, 'GET', `/guilds/${c.guildId}/members/search?query=${encodeURIComponent(texteQ)}&limit=10`);
      for (const m of r.ok && Array.isArray(r.corps) ? r.corps : []) {
        if (m?.user?.bot || candidats.some(x => x.discordId === String(m.user.id))) continue;
        candidats.push({ discordId: String(m.user.id), nom: nomMembre(m), compteId: null, source: 'discord' });
      }
    }
    return { candidats: candidats.slice(0, 15) };
  }

  /** Ajoute une personne au staff de l'événement (`{ discordId, nom?, compteId? }`) ; rôle staff donné. */
  async function ajouterStaff(acteur, id, corps) {
    await exiger(acteur);
    const evt = await ligne(id);
    const discordId = String(corps?.discordId ?? '').trim();
    if (!ID.test(discordId)) throw echec(400, 'equipe-discord', 'Discord ID invalide (17 à 20 chiffres).');
    const n = await base.premier('SELECT COUNT(*) AS n FROM club_evenement_staff WHERE evenement_id = ?', [id]);
    if (Number(n?.n ?? 0) >= LIMITES_EVENEMENTS.staff) throw echec(409, 'trop', '50 personnes au plus dans le staff.');
    if (!(await base.premier('SELECT id FROM club_evenement_staff WHERE evenement_id = ? AND discord_id = ?', [id, discordId]))) {
      const lie = await base.premier('SELECT compte_id FROM discord_comptes WHERE discord_user_id = ?', [discordId]);
      await base.executer('INSERT INTO club_evenement_staff (id, evenement_id, discord_id, nom, compte_id, position, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [nouvelId(), id, discordId, texte(corps?.nom ?? '', 100, 'evenement-staff-nom'), lie?.compte_id ?? null, Number(n?.n ?? 0), iso(maintenant())]);
    }
    const staff = auto(evt) ? await staffAuto(evt) : null;
    return lire(acteur, id, staff ? { discord: staff } : {});
  }

  /** Retire une personne du staff : le rôle staff lui est retiré. */
  async function retirerStaff(acteur, id, staffId) {
    await exiger(acteur);
    const evt = await ligne(id);
    const m = await base.premier('SELECT * FROM club_evenement_staff WHERE id = ? AND evenement_id = ?', [staffId, id]);
    if (!m) throw echec(404, 'staff-introuvable', 'Introuvable.');
    await base.executer('DELETE FROM club_evenement_staff WHERE id = ?', [staffId]);
    let staff = null;
    if (evt.staff_role_id && m.role_statut === 'attribue') {
      const c = await discordCtx();
      staff = c.erreur ? { erreur: c.erreur, bilan: null } : { erreur: null, staff: await synchroniserStaff(c, evt, { retirer: [m.discord_id] }) };
    }
    return lire(acteur, id, staff ? { discord: staff } : {});
  }

  async function staffAuto(evt) {
    const c = await discordCtx();
    if (c.erreur) return { erreur: c.erreur, bilan: null };
    return { erreur: null, staff: await synchroniserStaff(c, evt) };
  }

  /**
   * Ce que la suppression de l'événement emporte (fiche : texte de la confirmation) : ses hubs vocaux, et si les
   * salons vocaux temporaires se désactivent faute d'autre hub.
   */
  async function suppressionDe(id) {
    const v = await lireVocaux(base);
    const hubs = v.hubs.filter(h => h.tournoiId === id).length;
    return { hubs, desactiveVocaux: hubs > 0 && v.actif && hubs === v.hubs.length };
  }

  /**
   * Supprime l'événement et tout ce qu'il a créé, au mieux :
   *  1. ses hubs vocaux retirés des réglages des salons vocaux (même stockage ; le dernier hub retiré désactive les
   *     salons vocaux, comme depuis la fiche ou le Bot Esport HQ) ;
   *  2. le nettoyage de fin d'événement (salons d'équipe supprimés sur Discord, rôles des équipes et rôle staff
   *     supprimés, rôle staff retiré des catégories de tickets) ; un refus de Discord ou l'absence de bot n'empêche
   *     pas la suppression : il est noté dans le journal du serveur et rendu dans `nettoyage` ;
   *  3. l'événement, ses équipes, ses membres et son staff.
   */
  async function supprimer(acteur, id) {
    await exiger(acteur);
    await ligne(id);
    const t = maintenant();
    // 1. Hubs vocaux de l'événement.
    const vocaux = await lireVocaux(base);
    const hubs = vocaux.hubs.filter(h => h.tournoiId === id);
    let vocauxDesactives = false;
    if (hubs.length) {
      const restants = vocaux.hubs.filter(h => h.tournoiId !== id);
      vocauxDesactives = vocaux.actif && !restants.length;
      const reglages = validerVocaux({ hubs: restants, ...(restants.length ? {} : { actif: false }) }, vocaux);
      await base.lot([
        instructionReglage('vocaux', reglages, acteur.compte, t),
        evenementBus('tickets.config_modifiee', { acteur: acteur.compte, entiteType: 'tickets', entiteId: 'vocaux', charge: { cle: 'vocaux', evenement: id, suppression: true }, maintenant: t }),
      ]);
    }
    // 2. Nettoyage Discord (au mieux).
    let nettoyage = { roles: 0, salons: 0, echecs: [], erreur: null };
    const c = await discordCtx();
    if (c.erreur) {
      nettoyage.erreur = c.erreur;
      const evt = await base.premier('SELECT staff_role_id FROM club_evenements WHERE id = ?', [id]);
      if (evt?.staff_role_id) await retirerDesCategories(base, evt.staff_role_id, null, maintenant);
    } else {
      try {
        nettoyage = { ...(await nettoyerEvenement(c, id)), erreur: null };
      } catch (e) {
        nettoyage.erreur = 'discord';
        journal.warn?.('[esport] événement supprimé : nettoyage Discord interrompu', e?.message ?? e);
      }
    }
    if (nettoyage.erreur || nettoyage.echecs.length)
      journal.warn?.(`[esport] événement ${id} supprimé : nettoyage Discord incomplet (${nettoyage.erreur ?? `${nettoyage.echecs.length} refus`}) ; rôles ou salons restants à supprimer à la main`, JSON.stringify(nettoyage.echecs));
    // Salons d'équipe encore connus (refus de Discord, pas de bot) : oubliés avec l'événement.
    await base.executer('DELETE FROM vocaux_salons WHERE tournoi_id = ?', [id]);
    const equipes = (
      await base.tous(
        'SELECT id FROM club_evenement_equipes WHERE evenement_id = ?',
        [id],
      )
    ).map(l => l.id);
    await base.lot([
      ...(equipes.length
        ? [
            {
              sql: `DELETE FROM club_evenement_membres WHERE equipe_id IN (${equipes.map(() => '?').join(', ')})`,
              params: equipes,
            },
          ]
        : []),
      {
        sql: 'DELETE FROM club_evenement_equipes WHERE evenement_id = ?',
        params: [id],
      },
      { sql: 'DELETE FROM club_evenement_staff WHERE evenement_id = ?', params: [id] },
      { sql: 'DELETE FROM club_evenements WHERE id = ?', params: [id] },
    ]);
    return { ok: true, hubs: hubs.length, vocauxDesactives, nettoyage };
  }

  async function ecrireMembres(equipeId, membres) {
    await base.executer(
      'DELETE FROM club_evenement_membres WHERE equipe_id = ?',
      [equipeId],
    );
    let i = 0;
    for (const m of membres)
      await base.executer(
        'INSERT INTO club_evenement_membres (id, equipe_id, poste, discord_id, nom, embark_id, role_statut, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          nouvelId(),
          equipeId,
          m.poste,
          m.discordId,
          m.nom,
          m.embarkId,
          m.roleStatut ?? null,
          i++,
        ],
      );
  }

  async function tagPris(evenementId, tag, sauf = null) {
    return Boolean(
      await base.premier(
        'SELECT id FROM club_evenement_equipes WHERE evenement_id = ? AND UPPER(tag) = ? AND id <> ?',
        [evenementId, tag.toUpperCase(), sauf ?? ''],
      ),
    );
  }

  /** Rôles automatiques après un changement d'équipes : `{ erreur, bilan }`, ou null s'ils sont coupés. */
  async function auto_(evt, options) {
    if (!auto(evt)) return null;
    const c = await discordCtx();
    if (c.erreur) return { erreur: c.erreur, bilan: null };
    return { erreur: null, bilan: await synchroniser(c, evt, options) };
  }

  /** Ajoute des équipes (`{ equipes: [...] }`) ; TAG déjà pris refusé ; rôles automatiques. */
  async function ajouterEquipes(acteur, id, corps) {
    await exiger(acteur);
    const evt = await ligne(id);
    const liste = Array.isArray(corps?.equipes) ? corps.equipes : [corps];
    const n = await base.premier(
      'SELECT COUNT(*) AS n FROM club_evenement_equipes WHERE evenement_id = ?',
      [id],
    );
    if (Number(n?.n ?? 0) + liste.length > LIMITES_EQUIPES.equipes)
      throw echec(409, 'trop', '64 équipes au plus par événement.');
    const valides = liste.map(validerEquipe);
    const tags = new Set();
    for (const e of valides) {
      if (tags.has(e.tag) || (await tagPris(id, e.tag)))
        throw echec(
          409,
          'equipe-tag',
          `TAG déjà pris dans cet événement : ${e.tag}.`,
        );
      tags.add(e.tag);
    }
    const t = iso(maintenant());
    const pos = await base.premier(
      'SELECT MAX(position) AS p FROM club_evenement_equipes WHERE evenement_id = ?',
      [id],
    );
    let p = Number(pos?.p ?? -1);
    const ids = [];
    for (const e of valides) {
      const eid = nouvelId();
      await base.executer(
        'INSERT INTO club_evenement_equipes (id, evenement_id, nom, tag, ticket_id, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [eid, id, e.nom, e.tag, e.ticketId, ++p, t, t],
      );
      await ecrireMembres(eid, e.membres);
      ids.push(eid);
    }
    const discord = await auto_(evt, { equipeIds: ids });
    return lire(acteur, id, discord ? { discord } : {});
  }

  async function equipe(evenementId, equipeId) {
    if (typeof equipeId !== 'string' || !UUID.test(equipeId))
      throw echec(404, 'equipe-introuvable', 'Équipe introuvable.');
    const e = await base.premier(
      'SELECT * FROM club_evenement_equipes WHERE id = ? AND evenement_id = ?',
      [equipeId, evenementId],
    );
    if (!e) throw echec(404, 'equipe-introuvable', 'Équipe introuvable.');
    return e;
  }

  /** Modifie une équipe (nom, TAG, membres) ; rôle renommé, membres ajoutés / retirés mis à jour sur Discord. */
  async function modifierEquipe(acteur, id, equipeId, corps) {
    await exiger(acteur);
    const evt = await ligne(id);
    const e = await equipe(id, equipeId);
    const actuels =
      (await equipesDe(base, id)).find(x => x.id === equipeId)?.membres ?? [];
    const v = validerEquipe({
      nom: e.nom,
      tag: e.tag,
      ...corps,
      membres: corps?.membres ?? actuels,
    });
    if (await tagPris(id, v.tag, equipeId))
      throw echec(
        409,
        'equipe-tag',
        `TAG déjà pris dans cet événement : ${v.tag}.`,
      );
    const avant = new Map(
      actuels.filter(m => m.discordId).map(m => [m.discordId, m.roleStatut]),
    );
    const nouveaux = new Set(v.membres.map(m => m.discordId).filter(Boolean));
    const retirer = e.role_id
      ? [...avant]
          .filter(([did, st]) => st === 'attribue' && !nouveaux.has(did))
          .map(([discordId]) => ({ discordId, roleId: e.role_id }))
      : [];
    await base.executer(
      'UPDATE club_evenement_equipes SET nom = ?, tag = ?, maj_le = ? WHERE id = ?',
      [v.nom, v.tag, iso(maintenant()), equipeId],
    );
    await ecrireMembres(
      equipeId,
      v.membres.map(m => ({
        ...m,
        roleStatut: m.discordId ? avant.get(m.discordId) ?? null : null,
      })),
    );
    let discord = await auto_(evt, { equipeIds: [equipeId], retirer });
    // Rôles automatiques coupés : les membres retirés perdent quand même le rôle déjà donné.
    if (!discord && retirer.length) {
      const c = await discordCtx();
      if (!c.erreur)
        discord = {
          erreur: null,
          bilan: await synchroniser(c, evt, { equipeIds: [], retirer }),
        };
    }
    return lire(acteur, id, discord ? { discord } : {});
  }

  /** Retire une équipe : son rôle Discord et son salon vocal sont supprimés. */
  async function supprimerEquipe(acteur, id, equipeId) {
    await exiger(acteur);
    await ligne(id);
    const e = await equipe(id, equipeId);
    let discord = null;
    const salon = await base.premier(
      'SELECT salon_id FROM vocaux_salons WHERE equipe_id = ? LIMIT 1',
      [equipeId],
    );
    if (e.role_id || salon) {
      const c = await discordCtx();
      if (c.erreur) discord = { erreur: c.erreur, bilan: null };
      else
        discord = {
          erreur: null,
          suppression: await supprimerRoleEquipe(c, e),
        };
    }
    await base.executer(
      'DELETE FROM club_evenement_membres WHERE equipe_id = ?',
      [equipeId],
    );
    await base.executer('DELETE FROM club_evenement_equipes WHERE id = ?', [
      equipeId,
    ]);
    return lire(acteur, id, discord ? { discord } : {});
  }

  /**
   * Propositions d'équipes lues dans les tickets d'une catégorie (`categorieId`, sinon celle de l'événement) : rien
   * n'est enregistré. Membres présents ou non sur le serveur quand le bot peut le vérifier ; `deja` : ticket ou TAG
   * déjà dans l'événement.
   */
  async function importer(acteur, id, corps) {
    await exiger(acteur);
    const evt = await ligne(id);
    const categorieId = String(
      corps?.categorieId || evt.categorie_ticket_id || '',
    );
    const cat = categorieId
      ? await base.premier('SELECT id FROM tickets_categories WHERE id = ?', [
          categorieId,
        ])
      : null;
    if (!cat) throw echec(400, 'categories', 'Catégorie introuvable.');
    const d = await droitsTickets(base, acteur);
    if (!d.fondateur && !voitCategorie(d, categorieId))
      throw echec(
        403,
        'permission',
        'Vous n’avez pas la permission de faire cela.',
      );
    const tickets = await base.tous(
      'SELECT id, numero, statut, auteur_nom, reponses FROM tickets WHERE categorie_id = ? AND supprime_le IS NULL ORDER BY numero LIMIT 200',
      [categorieId],
    );
    const deja = await equipesDe(base, id);
    const c = await discordCtx();
    const presents = new Map();
    let resolutions = 0;
    const verifier = async did => {
      if (
        presents.has(did) ||
        c.erreur ||
        resolutions >= LIMITES_EQUIPES.resolutions
      )
        return presents.get(did);
      resolutions++;
      const r = await rest(
        fetchDiscord,
        jetonBot,
        'GET',
        `/guilds/${c.guildId}/members/${did}`,
      );
      const v = r.ok
        ? { present: true, nom: nomMembre(r.corps) }
        : r.statut === 404
        ? { present: false }
        : undefined;
      presents.set(did, v);
      return v;
    };
    // Sans Discord ID mais avec un pseudo (« @pseudo ») : membre du serveur au nom EXACT (pseudo, nom affiché, surnom).
    const rechercher = async nom => {
      if (!nom || c.erreur || resolutions >= LIMITES_EQUIPES.resolutions)
        return null;
      resolutions++;
      const r = await rest(
        fetchDiscord,
        jetonBot,
        'GET',
        `/guilds/${c.guildId}/members/search?query=${encodeURIComponent(
          nom.slice(0, 32),
        )}&limit=5`,
      );
      const exact = (r.ok && Array.isArray(r.corps) ? r.corps : []).filter(
        x =>
          !x?.user?.bot &&
          [x?.user?.username, x?.user?.global_name, x?.nick].some(
            v => v && v.toLowerCase() === nom.toLowerCase(),
          ),
      );
      return exact.length === 1
        ? { id: String(exact[0].user.id), nom: nomMembre(exact[0]) }
        : null;
    };
    const propositions = [];
    for (const tk of tickets) {
      const lu = lireReponsesInscription(jsonOu(tk.reponses, []));
      const membres = [];
      for (const m of lu.membres) {
        if (!m.discordId) {
          const trouve = await rechercher(m.nom);
          if (trouve) {
            membres.push({
              ...m,
              discordId: trouve.id,
              nom: m.nom || trouve.nom,
              present: true,
              trouveParNom: true,
            });
            continue;
          }
        }
        const v = m.discordId ? await verifier(m.discordId) : undefined;
        membres.push({
          ...m,
          nom: m.nom || v?.nom || '',
          present: v ? v.present : null,
        });
      }
      if (membres.every(x => x.discordId))
        lu.problemes = lu.problemes.filter(p => p !== 'sans_id');
      propositions.push({
        ticketId: tk.id,
        numero: Number(tk.numero),
        statut: tk.statut,
        auteur: tk.auteur_nom ?? '',
        nom: lu.nom,
        tag: lu.tag,
        membres,
        problemes: [
          ...lu.problemes,
          ...(membres.some(m => m.present === false) ? ['absents'] : []),
        ],
        deja: deja.some(
          e => e.ticketId === tk.id || (lu.tag && e.tag === lu.tag),
        ),
      });
    }
    return { categorieId, propositions };
  }

  /** « Resynchroniser les rôles » : tout ce qui manque (rôles, noms, attributions, position). */
  async function resynchroniser(acteur, id) {
    await exiger(acteur);
    const evt = await ligne(id);
    if (['termine', 'annule'].includes(evt.statut))
      throw echec(
        409,
        'evenement-fini',
        'L’événement est terminé ou annulé : ses rôles ne sont plus créés.',
      );
    const c = await exigerDiscord();
    const bilan = await synchroniser(
      c,
      { ...evt, roles_supprimes_le: null },
      {},
    );
    const staff = await synchroniserStaff(c, evt);
    return lire(acteur, id, { discord: { erreur: null, bilan, staff } });
  }

  async function supprimerRoles(acteur, id) {
    await exiger(acteur);
    await ligne(id);
    const c = await exigerDiscord();
    const r = await nettoyerEvenement(c, id);
    return lire(acteur, id, { nettoyage: r });
  }

  /** Rôles du serveur (hiérarchie, le plus haut d'abord) pour choisir le rôle repère. */
  async function rolesServeur(acteur) {
    await exiger(acteur);
    const c = await discordCtx();
    if (c.erreur) return { erreur: c.erreur, roles: [], positionBot: null };
    return rolesDuServeur(c);
  }

  return {
    lister,
    lire,
    creer,
    modifier,
    supprimer,
    ajouterEquipes,
    modifierEquipe,
    supprimerEquipe,
    importer,
    resynchroniser,
    candidatsStaff,
    ajouterStaff,
    retirerStaff,
    supprimerRoles,
    rolesServeur,
    exiger,
  };
}

/**
 * Routes (branchées par api.mjs, après l'authentification) :
 *   GET|POST            /evenements                      liste ; créer
 *   GET                 /evenements/roles-serveur        rôles du serveur Discord (repère de position)
 *   GET|PATCH|DELETE    /evenements/:id                  fiche ; modifier ; supprimer (hubs, salons, rôles aussi)
 *   POST                /evenements/:id/equipes          { equipes: [...] } ajout (rôles automatiques)
 *   PATCH|DELETE        /evenements/:id/equipes/:e       modifier ; retirer (rôle et salon supprimés)
 *   GET                 /evenements/staff-candidats?q=   comptes de l'app (Discord lié) et membres du serveur
 *   POST|DELETE         /evenements/:id/staff[/:s]       staff de l'événement (rôle staff donné / retiré)
 *   GET|POST            /evenements/:id/vocaux           hubs vocaux de l'événement ; ajouter (+ vocaux.configurer)
 *   PATCH|DELETE        /evenements/:id/vocaux/:hub      modifier ; retirer un hub (+ vocaux.configurer)
 *   POST                /evenements/:id/import           { categorieId } propositions lues dans les tickets
 *   POST                /evenements/:id/roles            resynchroniser les rôles (bilan)
 *   POST                /evenements/:id/roles/supprimer  supprimer les rôles et les salons des équipes
 */
export async function routesEvenements({
  ev,
  vc,
  acteur,
  chemin,
  methode: m,
  url,
  lireCorps,
  limite,
}) {
  if (chemin !== '/evenements' && !chemin.startsWith('/evenements/'))
    return undefined;
  const p = chemin
    .split('/')
    .slice(2)
    .map(s => {
      try {
        return decodeURIComponent(s);
      } catch {
        return '';
      }
    });
  if (p.length === 0) {
    if (m === 'GET') return ev.lister(acteur);
    if (m === 'POST') return ev.creer(acteur, await lireCorps());
    return undefined;
  }
  if (p.length === 1 && p[0] === 'staff-candidats' && m === 'GET') {
    await limite('tickets_discord', acteur.compte);
    return ev.candidatsStaff(acteur, url?.searchParams?.get('q') ?? '');
  }
  if (p.length === 1 && p[0] === 'roles-serveur' && m === 'GET') {
    await limite('tickets_discord', acteur.compte);
    return ev.rolesServeur(acteur);
  }
  const [id, quoi, x] = p;
  if (p.length === 1) {
    if (m === 'GET') return ev.lire(acteur, id);
    if (m === 'PATCH') return ev.modifier(acteur, id, await lireCorps());
    if (m === 'DELETE') return ev.supprimer(acteur, id);
  }
  if (quoi === 'equipes') {
    if (p.length === 2 && m === 'POST')
      return ev.ajouterEquipes(acteur, id, await lireCorps(256 * 1024));
    if (p.length === 3 && m === 'PATCH')
      return ev.modifierEquipe(acteur, id, x, await lireCorps());
    if (p.length === 3 && m === 'DELETE')
      return ev.supprimerEquipe(acteur, id, x);
  }
  if (quoi === 'staff') {
    if (p.length === 2 && m === 'POST') return ev.ajouterStaff(acteur, id, await lireCorps());
    if (p.length === 3 && m === 'DELETE') return ev.retirerStaff(acteur, id, x);
  }
  // Vocaux de l'événement : ses hubs, dans les réglages des salons vocaux (vocaux/service.mjs).
  if (quoi === 'vocaux' && vc) {
    if (p.length === 2 && m === 'GET') return vc.hubsEvenement(acteur, id);
    if (p.length === 2 && m === 'POST') return vc.ajouterHubEvenement(acteur, id, await lireCorps());
    if (p.length === 3 && m === 'PATCH') return vc.modifierHubEvenement(acteur, id, x, await lireCorps());
    if (p.length === 3 && m === 'DELETE') return vc.retirerHubEvenement(acteur, id, x);
  }
  if (p.length === 2 && quoi === 'import' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    return ev.importer(acteur, id, await lireCorps());
  }
  if (quoi === 'roles' && m === 'POST') {
    await limite('tickets_discord', acteur.compte);
    if (p.length === 2) return ev.resynchroniser(acteur, id);
    if (p.length === 3 && x === 'supprimer')
      return ev.supprimerRoles(acteur, id);
  }
  return undefined;
}

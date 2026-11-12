/**
 * Avis de tickets et alertes techniques (migration 0077, docs/esport/notifications.md « Alertes et avis ») : cinq
 * types de notifications PERSONNELLES (table `notifications`), chacun avec ses destinataires, sa catégorie, son
 * accès (relu à CHAQUE lecture : droits.mjs / centre.mjs) et son interrupteur « ne plus recevoir ce type » dans les
 * préférences (`types_masques`).
 *
 *  - `tk-avis`               : un auteur a noté un ticket fermé (1 à 5) : ceux qui traitent la catégorie (et le Fondateur),
 *                              sauf la personne qui a pris le ticket (elle reçoit `tk-note`). Catégorie « tickets » ;
 *  - `salon-match-alerte`    : salons de match d'un événement (équipe sans rôle Discord, staff introuvable, repère supprimé,
 *                              création refusée, catégorie pleine) : `evenements.gerer` et le Fondateur ;
 *  - `vocal-alerte`          : salons vocaux temporaires et accès passe-partout (création refusée, hiérarchie, bot) :
 *                              `vocaux.configurer` et le Fondateur ;
 *  - `role-evenement-alerte` : rôles Discord d'un événement (création, suppression, placement) : `evenements.gerer` et le Fondateur ;
 *  - `role-temp-alerte`      : rôles temporaires (/role-temp : retrait à l'échéance, hiérarchie) : `discord.manage` de la team et le Fondateur.
 *
 * Les alertes passent par le bus (événements `alerte.*`, SANS affichage dans le fil : règle « aucun ») : le module qui
 * détecte l'erreur appelle `signalerAlerte` (signaler.mjs), l'abonné `abonneAlertes` écrit les notifications.
 *
 * DÉDOUBLONNAGE : une même alerte (clé = type, cible, code) n'est notifiée qu'UNE fois par fenêtre de 6 h et par
 * destinataire ; les occurrences suivantes augmentent le compteur (`compteur` de la charge, affiché « ×3 ») sans
 * nouvelle notification. Au-delà de 6 h, une nouvelle notification repart de 1.
 *
 * Ce fichier n'importe pas evenements.mjs (c'est lui qui nous importe).
 */

import { jsonOu } from '../outils.mjs';
import { comptesDeCategorie } from '../tickets/acces.mjs';

/** Fenêtre de dédoublonnage : une notification par alerte, destinataire et fenêtre. */
export const FENETRE_ALERTE_MS = 6 * 3_600_000;

/** Zones de l'app où mène une alerte Discord (cible `alerte_discord`). */
export const ZONES_ALERTE = Object.freeze(['vocaux', 'evenement', 'role_temp']);

/**
 * Types personnels : catégorie et accès (clé d'accès comme regles.mjs : `club:` / `team:`, sinon `tickets`). `evenement` :
 * type d'événement du bus qui le porte (absent pour `tk-avis`, tiré de `ticket.note`).
 */
export const ALERTES = Object.freeze({
  'tk-avis': { categorie: 'tickets', acces: 'tickets', evenement: 'ticket.note' },
  'salon-match-alerte': { categorie: 'discord', acces: 'club:evenements.gerer', evenement: 'alerte.salon_match' },
  'vocal-alerte': { categorie: 'discord', acces: 'club:vocaux.configurer', evenement: 'alerte.vocal' },
  'role-evenement-alerte': { categorie: 'discord', acces: 'club:evenements.gerer', evenement: 'alerte.role_evenement' },
  'role-temp-alerte': { categorie: 'discord', acces: 'team:discord.manage', evenement: 'alerte.role_temp' },
});

/** Types que l'on peut couper un par un dans les préférences. */
export const TYPES_COUPABLES = Object.freeze(Object.keys(ALERTES));

/** Événements du bus des alertes (SANS avis : `ticket.note` existe déjà). */
export const TYPES_ALERTES = Object.freeze(['alerte.salon_match', 'alerte.vocal', 'alerte.role_evenement', 'alerte.role_temp']);

/** Zone de l'app où mène chaque type d'alerte Discord (cible `alerte_discord`, cibles.mjs). */
const ZONE_DU_TYPE = Object.freeze({ 'vocal-alerte': 'vocaux', 'role-evenement-alerte': 'evenement', 'role-temp-alerte': 'role_temp' });

const PAR_EVENEMENT = new Map(Object.entries(ALERTES).filter(([, a]) => a.evenement.startsWith('alerte.')).map(([type, a]) => [a.evenement, type]));

/** Comptes ayant une des permissions du club, et le Fondateur (s'il a un profil). */
async function comptesDuClub(base, permissions) {
  const lignes = await base.tous(`SELECT DISTINCT compte_id FROM permissions_club WHERE permission IN (${permissions.map(() => '?').join(', ')})`, permissions);
  const sortie = new Set(lignes.map(l => l.compte_id));
  if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) sortie.add('principal');
  return sortie;
}

/** Comptes d'une team avec la permission (Propriétaires compris), et le Fondateur. */
async function comptesDeTeam(base, teamId, permission) {
  if (!teamId) return new Set();
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = ?
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [permission, teamId],
  );
  const sortie = new Set(lignes.map(l => l.compte));
  for (const l of await base.tous("SELECT DISTINCT compte_id FROM permissions_club WHERE permission = 'teams.acces_total'", [])) sortie.add(l.compte_id);
  if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) sortie.add('principal');
  return sortie;
}

/** Destinataires d'une alerte (au moment où elle part ; l'accès est relu à chaque lecture). */
async function destinataires(base, type, ev) {
  switch (ALERTES[type].acces) {
    case 'club:evenements.gerer':
      return comptesDuClub(base, ['evenements.gerer']);
    case 'club:vocaux.configurer':
      return comptesDuClub(base, ['vocaux.configurer']);
    case 'team:discord.manage':
      return comptesDeTeam(base, ev.team_id, 'discord.manage');
    default:
      return new Set();
  }
}

/** Les comptes qui voient une catégorie de tickets : voir `comptesDeCategorie` (tickets/acces.mjs). */
export const destinatairesAvis = (base, categorieId) => comptesDeCategorie(base, categorieId);

/**
 * Écrit (ou met à jour) la notification d'une alerte pour un destinataire, avec le dédoublonnage de 6 h. Rend `true`
 * si c'est une nouvelle notification, `false` si seul le compteur a bougé (ou rien : événement déjà traité).
 */
export async function ecrireAlerte(base, { ev, compte, type, charge, cle, teamId = null, categorieId = null }) {
  const maintenant = Date.parse(ev.cree_le);
  const ligne = await base.premier('SELECT notification_id, premiere_le, derniere_le, compteur, evenement_id FROM notifs_alertes WHERE cle = ? AND compte_id = ?', [cle, compte]);
  // Événement déjà compté (nouvel essai de la distribution) : le dernier compté, ou un plus ancien.
  if (ligne && (ligne.evenement_id === ev.id || String(ligne.derniere_le) >= String(ev.cree_le))) return false;
  const dansLaFenetre = ligne && Number.isFinite(maintenant) && maintenant - Date.parse(ligne.premiere_le) < FENETRE_ALERTE_MS && maintenant >= Date.parse(ligne.premiere_le);
  if (dansLaFenetre) {
    const compteur = Number(ligne.compteur) + 1;
    const existante = await base.premier('SELECT charge FROM notifications WHERE id = ?', [ligne.notification_id]);
    if (existante) {
      await base.lot([
        { sql: 'UPDATE notifications SET charge = ? WHERE id = ?', params: [JSON.stringify({ ...jsonOu(existante.charge, {}), ...charge, compteur }), ligne.notification_id] },
        { sql: 'UPDATE notifs_alertes SET compteur = ?, derniere_le = ?, evenement_id = ? WHERE cle = ? AND compte_id = ?', params: [compteur, ev.cree_le, ev.id, cle, compte] },
      ]);
      return false;
    }
    // Notification purgée entre-temps : on repart d'une nouvelle.
  }
  const id = `${ev.id}:${compte}`;
  await base.lot([
    {
      sql: 'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le, categorie, evenement_id, ticket_categorie_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
      params: [id, compte, teamId, type, JSON.stringify({ ...charge, compteur: 1 }), ev.cree_le, ALERTES[type].categorie, ev.id, categorieId],
    },
    {
      sql: `INSERT INTO notifs_alertes (cle, compte_id, notification_id, premiere_le, derniere_le, compteur, evenement_id) VALUES (?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT (cle, compte_id) DO UPDATE SET notification_id = excluded.notification_id, premiere_le = excluded.premiere_le, derniere_le = excluded.derniere_le, compteur = 1, evenement_id = excluded.evenement_id`,
      params: [cle, compte, id, ev.cree_le, ev.cree_le, ev.id],
    },
  ]);
  return true;
}

/** Charge publique d'une alerte : codes et identifiants seulement (jamais de message ni de jeton). */
const champsAlerte = c => {
  const sortie = {};
  for (const k of ['code', 'zone', 'evenement', 'match', 'nom', 'statut', 'quoi', 'nombre']) {
    const v = c[k];
    if (typeof v === 'string') sortie[k] = v.slice(0, 120);
    else if (typeof v === 'number' || typeof v === 'boolean') sortie[k] = v;
  }
  return sortie;
};

/**
 * Abonné du bus : les événements `alerte.*` deviennent des notifications personnelles (avec dédoublonnage), et
 * `ticket.note` un avis (`tk-avis`) pour ceux qui traitent la catégorie.
 */
export async function abonneAlertes(base, ev) {
  const charge = jsonOu(ev.charge, {});
  if (ev.type === 'ticket.note') {
    const categorie = charge.categorie ?? null;
    if (!categorie || !ev.entite_id) return;
    const voient = await destinatairesAvis(base, categorie);
    const donnees = { numero: charge.numero ?? null, ticket: ev.entite_id, categorie, nom: charge.nomCategorie ?? null, note: charge.note ?? null };
    for (const compte of voient) {
      // La personne qui a pris le ticket a déjà `tk-note`.
      if (!compte || compte === charge.responsable) continue;
      await ecrireAlerte(base, { ev, compte, type: 'tk-avis', charge: donnees, cle: `tk-avis:${ev.entite_id}`, categorieId: categorie });
    }
    return;
  }
  const type = PAR_EVENEMENT.get(ev.type);
  if (!type) return;
  const cle = String(charge.cle ?? `${ev.type}:${ev.entite_id ?? ''}`).slice(0, 200);
  const donnees = { ...champsAlerte(charge), ...(ZONE_DU_TYPE[type] ? { zone: ZONE_DU_TYPE[type] } : {}) };
  for (const compte of await destinataires(base, type, ev)) {
    await ecrireAlerte(base, { ev, compte, type, charge: donnees, cle, teamId: ev.team_id ?? null });
  }
}

/** Types d'alertes que le lecteur (droits.mjs) peut recevoir aujourd'hui (les préférences : interrupteur par type). */
export function typesVisibles(droits) {
  return TYPES_COUPABLES.filter(type => {
    const acces = ALERTES[type].acces;
    if (droits.tout) return true;
    if (acces === 'tickets') return droits.tickets === null || (Array.isArray(droits.tickets) && droits.tickets.length > 0);
    if (acces.startsWith('club:')) return acces.slice(5).split('|').some(p => droits.club.has(p));
    if (acces.startsWith('team:')) return [...droits.parTeam.values()].some(s => acces.slice(5).split('|').some(p => s.has(p)));
    return false;
  });
}

/** Teams où le lecteur a la permission d'un type `team:` (`null` : toutes, Fondateur). */
export function teamsDeLAlerte(droits, type) {
  if (droits.tout) return null;
  const perms = ALERTES[type].acces.replace(/^team:/, '').split('|');
  return [...droits.parTeam].filter(([, s]) => perms.some(p => s.has(p))).map(([id]) => id);
}

/**
 * Condition SQL (alias `p`) retirant les alertes dont le lecteur n'a plus le droit : permission du club retirée,
 * team quittée ou `discord.manage` perdu. Chaque lecture la réévalue (un rôle retiré ferme aussitôt).
 */
export function filtreAlertes(droits) {
  if (droits.tout) return { sql: '', params: [] };
  const conditions = [];
  const params = [];
  for (const [type, a] of Object.entries(ALERTES)) {
    if (a.acces === 'tickets') continue; // catégorie du ticket : filtrePerso (ticket_categorie_id)
    if (a.acces.startsWith('club:')) {
      if (!a.acces.slice(5).split('|').some(perm => droits.club.has(perm))) {
        conditions.push('p.type <> ?');
        params.push(type);
      }
    } else {
      const teams = teamsDeLAlerte(droits, type);
      conditions.push(teams.length ? `(p.type <> ? OR p.team_id IN (${teams.map(() => '?').join(', ')}))` : 'p.type <> ?');
      params.push(type, ...teams);
    }
  }
  return { sql: conditions.join(' AND '), params };
}

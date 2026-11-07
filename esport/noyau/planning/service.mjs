/**
 * Logique métier du planning, des disponibilités et de la présence (phase 2).
 *
 * Même contrat que noyau/service.mjs : SQL standard, aucune dépendance au
 * runtime, et pour chaque route de team les contrôles dans l'ordre
 * authentification (api.mjs) → appartenance (`contexteTeam`) → module activé
 * → permission (`exiger`). Toute écriture ajoute son événement de domaine à
 * l'outbox dans le même lot atomique (journal, notifications, Discord plus tard).
 */

import { evenement } from '../evenements.mjs';
import { CLE_PROPRIETAIRE, autorise } from '../permissions.mjs';
import { aleatoire, echec, iso, jsonOu, nouvelId, sha256Hex, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { APPLIQUER_MAX, heatmap, plagesPropices, SEMAINES_MAX_AVANCE, TYPES_DISPO, PAS_AUTORISES } from './dispos.mjs';
import { calendrierIcs, LIBELLES_TYPES } from './ical.mjs';
import { LANGUE_DEFAUT, lireLangue, listeTextes, texte as T } from '../langues.mjs';
import { convocationDe, convocationDepuisListe, convoques, CONVOCATION_DEFAUT, estConvoque, groupeDe, normaliserConvocation, preparerConvocation } from './convocations.mjs';
import { RSVP, REELS, MARQUES_REELLES, compter, csv, lireMinutes, seriesAbsences, statistiques } from './presence.mjs';
import { DEPLACEMENT_MAX_MS, estOccurrence, lireRecurrence, occurrences, occurrencesBrutes, veilleLocale } from './recurrence.mjs';
import { ajouterJours, dateLocale, ecartJours, fuseauValide, instantMural, jourSemaine, lireDate, lireHeure, lundiDe, partiesLocales, texteDate, texteHeure } from './temps.mjs';

export const TYPES_EVENEMENT = ['scrim', 'match', 'training', 'meeting', 'tournament', 'other'];
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const MOTIF_JETON_ICAL = /^ical_[A-Za-z0-9_-]{43}$/;
const JOUR_MS = 86_400_000;
const DUREE_MAX_MS = 14 * JOUR_MS;
const PLAGE_MAX_JOURS = 100;
const MARGE_MS = DEPLACEMENT_MAX_MS + JOUR_MS;
export const REGLAGES_DEFAUT = { effectifMin: 5, rappelHeures: 24, debutSaison: '09-01' };
/** Début de saison « MM-JJ » (statistiques « Saison »). */
const MOTIF_SAISON = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Période des listes « À marquer » : les séances commencées des 30 derniers jours. */
const A_MARQUER_JOURS = 30;

const uuidOuNull = (v, quoi) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !MOTIF_UUID.test(v)) throw echec(400, quoi, 'Identifiant invalide.');
  return v;
};

/** Parties locales lisibles d'un instant. */
function local(fuseau, ms) {
  const l = partiesLocales(fuseau, ms);
  return { jour: texteDate(l), heure: texteHeure(l.heure * 60 + l.minute) };
}

/**
 * Créneau saisi : soit `date` (AAAA-MM-JJ) + `heureDebut` + `heureFin` (HH:MM,
 * heure murale dans `fuseau`, celui de la team par défaut ; fin ≤ début : le
 * lendemain), soit `debut` et `fin` en ISO. Rend `{ debut, fin, fuseau }` (ms).
 */
export function lireCreneau(corps, fuseauDefaut) {
  const fuseau = corps?.fuseau ?? fuseauDefaut;
  if (!fuseauValide(fuseau)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
  let debut;
  let fin;
  if (corps?.date !== undefined) {
    const d = lireDate(corps.date);
    const hd = lireHeure(corps.heureDebut);
    const hf = lireHeure(corps.heureFin);
    if (!d) throw echec(400, 'date', 'Date invalide (AAAA-MM-JJ).');
    if (hd === undefined || hf === undefined || hd >= 1440) throw echec(400, 'heure', 'Heures invalides (HH:MM).');
    debut = instantMural(fuseau, d, hd);
    fin = instantMural(fuseau, d, hf <= hd ? hf + 1440 : hf);
  } else {
    debut = Date.parse(corps?.debut);
    fin = Date.parse(corps?.fin);
    if (Number.isNaN(debut) || Number.isNaN(fin)) throw echec(400, 'date', 'Début et fin requis.');
  }
  if (fin <= debut) throw echec(400, 'duree', 'La fin doit suivre le début.');
  if (fin - debut > DUREE_MAX_MS) throw echec(400, 'duree', 'Un événement dure 14 jours au plus.');
  if (debut < Date.UTC(2000, 0, 1) || debut > Date.UTC(2100, 0, 1)) throw echec(400, 'date', 'Date hors limites.');
  return { debut, fin, fuseau };
}

/**
 * Services du planning sur une base. `noyau` : services du cœur
 * (servicesEsport : `contexteTeam`, `exiger`).
 */
export function servicesPlanning({ base, maintenant = () => Date.now(), noyau }) {
  const { contexteTeam, exiger } = noyau;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  // -------------------------------------------------------------- Lectures internes

  async function reglages(teamId) {
    const lignes = await base.tous("SELECT module, config FROM team_modules WHERE team_id = ? AND module IN ('availability', 'attendance')", [teamId]);
    const dispo = jsonOu(lignes.find(l => l.module === 'availability')?.config, {});
    const presence = jsonOu(lignes.find(l => l.module === 'attendance')?.config, {});
    return {
      effectifMin: Number.isInteger(dispo.effectifMin) ? dispo.effectifMin : REGLAGES_DEFAUT.effectifMin,
      rappelHeures: Number.isInteger(presence.rappelHeures) ? presence.rappelHeures : REGLAGES_DEFAUT.rappelHeures,
      debutSaison: typeof presence.debutSaison === 'string' && MOTIF_SAISON.test(presence.debutSaison) ? presence.debutSaison : REGLAGES_DEFAUT.debutSaison,
    };
  }

  /**
   * Membres de la team et leurs permissions (Propriétaire : toutes), avec ce
   * qu'il faut pour résoudre les convocations (rôle système, arrivée).
   * `tous` : aussi les suspendus (statistiques : leur historique reste).
   */
  async function membresActifs(teamId, { tous = false } = {}) {
    const lignes = await base.tous(
      `SELECT m.compte_id, m.statut, m.rejoint_le, r.cle_systeme, rp.permission, c.pseudo FROM membres m
         JOIN roles r ON r.id = m.role_id
         JOIN comptes c ON c.id = m.compte_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.team_id = ? AND (m.statut = 'actif' OR ? = 1)`,
      [teamId, tous ? 1 : 0],
    );
    const parCompte = new Map();
    for (const l of lignes) {
      if (!parCompte.has(l.compte_id)) {
        parCompte.set(l.compte_id, { compte: l.compte_id, pseudo: l.pseudo, statut: l.statut, cle: l.cle_systeme ?? null, rejointLe: l.rejoint_le, proprietaire: l.cle_systeme === CLE_PROPRIETAIRE, perms: new Set() });
      }
      if (l.permission) parCompte.get(l.compte_id).perms.add(l.permission);
    }
    const a = (m, p) => m.proprietaire || m.perms.has(p);
    return [...parCompte.values()].map(m => ({ ...m, a: p => a(m, p) })).sort((x, y) => x.pseudo.localeCompare(y.pseudo, 'fr'));
  }

  /** Convocation effective d'une occurrence : celle de la date (exception), sinon celle de la série. */
  const convocationOcc = (ev, o) => (o?.convocation ? (normaliserConvocation(o.convocation) ?? convocationDe(ev)) : convocationDe(ev));

  /**
   * Liste de présence d'une occurrence : ses CONVOQUÉS, et eux seuls (un
   * Propriétaire non coché n'y figure pas, même s'il a répondu).
   */
  function roster(membres, ev, o) {
    return convoques(convocationOcc(ev, o), membres, o?.fin);
  }

  /** L'acteur est-il convoqué à cette occurrence ? (`moi` : sa fiche de membre, ou rien.) */
  const convoqueMoi = (ev, o, moi) => Boolean(moi && estConvoque(convocationOcc(ev, o), moi, o.fin));

  async function evenementDeTeam(teamId, id) {
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    const ev = await base.premier('SELECT * FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!ev) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    return ev;
  }

  async function exceptionsDe(ids) {
    const parEv = new Map(ids.map(id => [id, new Map()]));
    for (const x of await lignesParIds(base, 'SELECT * FROM planning_exceptions WHERE evenement_id', ids)) parEv.get(x.evenement_id)?.set(x.occurrence, x);
    return parEv;
  }

  /** Occurrence existante (clé d'origine) et son exception éventuelle ; annulée → 404. */
  async function occurrenceDe(ev, cle) {
    const t = Date.parse(cle);
    if (Number.isNaN(t) || !estOccurrence(ev, new Date(t).toISOString())) throw echec(404, 'occurrence-introuvable', 'Occurrence introuvable.');
    const cleIso = new Date(t).toISOString();
    const x = await base.premier('SELECT * FROM planning_exceptions WHERE evenement_id = ? AND occurrence = ?', [ev.id, cleIso]);
    if (x && Number(x.annulee) === 1) throw echec(404, 'occurrence-introuvable', 'Cette occurrence est annulée.');
    const brute = occurrencesBrutes(ev, t, t + 1)[0];
    return {
      cle: cleIso,
      debut: x?.debut ? Date.parse(x.debut) : brute.debut,
      fin: x?.fin ? Date.parse(x.fin) : brute.fin,
      titre: x?.titre ?? ev.titre,
      convocation: x?.convocation ?? null,
      exception: x ?? null,
    };
  }

  /** Événements de la team dont une occurrence peut toucher [du, au[. */
  async function evenementsCandidats(teamId, du, au) {
    return base.tous(
      `SELECT * FROM planning_evenements
        WHERE team_id = ? AND supprime_le IS NULL AND debut < ?
          AND (fin > ? OR (recurrence IS NOT NULL AND (fin_serie IS NULL OR fin_serie >= ?)))
        ORDER BY debut`,
      [teamId, iso(au + MARGE_MS), iso(du - MARGE_MS), texteDate(dateLocale('UTC', du - MARGE_MS))],
    );
  }

  /** Occurrences effectives de la team sur [du, au[ : `[{ ev, o }]`, triées. */
  async function occurrencesTeam(teamId, du, au) {
    const evs = await evenementsCandidats(teamId, du, au);
    const exceptions = await exceptionsDe(evs.map(e => e.id));
    const sortie = [];
    for (const ev of evs) for (const o of occurrences(ev, du, au, exceptions.get(ev.id))) sortie.push({ ev, o });
    return sortie.sort((a, b) => a.o.debut - b.o.debut);
  }

  function lirePlage(params, fuseauDefaut) {
    const fuseau = params.fuseau || fuseauDefaut;
    if (!fuseauValide(fuseau)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
    let du;
    let au;
    if (params.debut || params.fin) {
      const d = lireDate(params.debut);
      const f = lireDate(params.fin);
      if (!d || !f) throw echec(400, 'plage', 'Plage de dates invalide (AAAA-MM-JJ).');
      du = instantMural(fuseau, d, 0);
      au = instantMural(fuseau, f, 0);
    } else {
      du = maintenant() - JOUR_MS;
      au = maintenant() + 30 * JOUR_MS;
    }
    if (au <= du || au - du > PLAGE_MAX_JOURS * JOUR_MS + 2 * 3_600_000) throw echec(400, 'plage', `Plage de 1 à ${PLAGE_MAX_JOURS} jours.`);
    return { du, au, fuseau };
  }

  /** Occurrence telle que l'app la voit. `membres` (facultatif) : pour rendre la liste des convoqués. */
  const occurrencePublique = (ev, o, fuseau, extra = {}, membres) => {
    const d = local(fuseau, o.debut);
    const f = local(fuseau, o.fin);
    const convocation = convocationOcc(ev, o);
    const liste = membres ? convoques(convocation, membres, o.fin).map(m => m.compte) : [];
    return {
      evenementId: ev.id,
      cle: o.cle,
      type: ev.type,
      titre: o.titre ?? ev.titre,
      description: o.description ?? ev.description,
      lieu: o.lieu ?? ev.lieu,
      debut: iso(o.debut),
      fin: iso(o.fin),
      jour: d.jour,
      heureDebut: d.heure,
      jourFin: f.jour,
      heureFin: f.heure,
      recurrent: Boolean(ev.recurrence),
      modifiee: Boolean(o.modifiee),
      adversaireId: ev.adversaire_id ?? null,
      reviewId: ev.review_id ?? null,
      convocation,
      convocationPropre: Boolean(o.convocation),
      // Comptes convoqués à CETTE occurrence (`concernes` : ancien nom, gardé pour les anciennes apps).
      convoques: liste,
      concernes: liste,
      ...extra,
    };
  };

  /** Ce que le joueur a annoncé avec sa réponse (retard prévu, motif d'absence). */
  const reponseDe = l => ({ retardPrevu: l?.retard_prevu === null || l?.retard_prevu === undefined ? null : Number(l.retard_prevu), motif: l?.motif_prevu ?? '' });

  const droits = ctx => ({
    creer: peut(ctx, 'planning.create'),
    modifier: peut(ctx, 'planning.update'),
    supprimer: peut(ctx, 'planning.delete'),
    rsvp: peut(ctx, 'attendance.rsvp_own'),
    marquer: peut(ctx, 'attendance.mark'),
    voirPresences: peut(ctx, 'attendance.view_all'),
    voirDispos: peut(ctx, 'availability.view_all'),
    saisirDispos: peut(ctx, 'availability.edit_own'),
    reglages: peut(ctx, 'team.manage'),
  });

  // -------------------------------------------------------------- Planning : lecture

  async function liste(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    const { du, au, fuseau } = lirePlage(params, ctx.team.fuseau);
    const types = params.types ? String(params.types).split(',').filter(t => TYPES_EVENEMENT.includes(t)) : [];
    // `membre=moi` : « Mes convocations » (filtre du planning).
    const membre = params.membre === 'moi' ? acteur.compte : params.membre && MOTIF_COMPTE.test(params.membre) ? params.membre : null;
    const membres = await membresActifs(teamId);
    const moi = membres.find(m => m.compte === acteur.compte);
    let toutes = await occurrencesTeam(teamId, du, au);
    if (types.length) toutes = toutes.filter(({ ev }) => types.includes(ev.type));
    if (membre) {
      const cible = membres.find(m => m.compte === membre);
      toutes = toutes.filter(({ ev, o }) => convoqueMoi(ev, o, cible));
    }
    const presenceActive = ctx.modules.has('attendance');
    const lignes = presenceActive
      ? await base.tous('SELECT evenement_id, occurrence, compte_id, rsvp, reel, retard_prevu, motif_prevu FROM presences WHERE team_id = ? AND occurrence >= ? AND occurrence < ?', [teamId, iso(du - MARGE_MS), iso(au + MARGE_MS)])
      : [];
    const voirTout = peut(ctx, 'attendance.view_all');
    const resultat = toutes.map(({ ev, o }) => {
      const convoquesOcc = new Set(roster(membres, ev, o).map(m => m.compte));
      // Réponses : celles des convoqués seulement.
      const miennes = lignes.filter(l => l.evenement_id === ev.id && l.occurrence === o.cle && convoquesOcc.has(l.compte_id));
      const ligneMoi = miennes.find(l => l.compte_id === acteur.compte);
      const compte = r => miennes.filter(l => l.rsvp === r).length;
      const convoque = convoqueMoi(ev, o, moi);
      return occurrencePublique(
        ev,
        o,
        fuseau,
        {
          concerneMoi: convoque,
          convoqueMoi: convoque,
          monRsvp: presenceActive && convoque ? (ligneMoi?.rsvp ?? 'sans_reponse') : null,
          maPresence: presenceActive && convoque ? (ligneMoi?.reel ?? 'inconnu') : null,
          maReponse: presenceActive && convoque ? reponseDe(ligneMoi) : null,
          reponses: presenceActive && voirTout ? { oui: compte('oui'), non: compte('non'), peut_etre: compte('peut_etre'), attendues: convoquesOcc.size } : null,
          termine: o.fin <= maintenant(),
        },
        membres,
      );
    });
    // Formulaire (staff) : qui peut être convoqué, et dans quel groupe (joueurs, staff, propriétaire).
    const convocables = peut(ctx, 'planning.create') || peut(ctx, 'planning.update') ? membres.map(m => ({ compte: m.compte, pseudo: m.pseudo, groupe: groupeDe(m) })) : null;
    return {
      fuseau,
      fuseauTeam: ctx.team.fuseau,
      du: iso(du),
      au: iso(au),
      occurrences: resultat,
      droits: droits(ctx),
      modules: { presence: presenceActive, dispos: ctx.modules.has('availability') },
      membres: convocables,
    };
  }

  async function detail(acteur, teamId, evId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    const ev = await evenementDeTeam(teamId, evId);
    const d = local(ev.fuseau, Date.parse(ev.debut));
    const f = local(ev.fuseau, Date.parse(ev.fin));
    return {
      id: ev.id,
      type: ev.type,
      titre: ev.titre,
      description: ev.description,
      lieu: ev.lieu,
      debut: ev.debut,
      fin: ev.fin,
      fuseau: ev.fuseau,
      date: d.jour,
      heureDebut: d.heure,
      heureFin: f.heure,
      recurrence: jsonOu(ev.recurrence, null),
      adversaireId: ev.adversaire_id ?? null,
      reviewId: ev.review_id ?? null,
      convocation: convocationDe(ev),
      concernes: convoques(convocationDe(ev), await membresActifs(teamId)).map(m => m.compte),
      creePar: ev.cree_par,
      creeLe: ev.cree_le,
      majLe: ev.maj_le,
      exceptions: (await base.tous('SELECT occurrence, annulee, titre, debut, fin, convocation FROM planning_exceptions WHERE evenement_id = ? ORDER BY occurrence', [ev.id])).map(x => ({
        occurrence: x.occurrence,
        annulee: Number(x.annulee) === 1,
        titre: x.titre ?? null,
        debut: x.debut ?? null,
        fin: x.fin ?? null,
        convocation: x.convocation ? normaliserConvocation(x.convocation) : null,
      })),
      droits: droits(ctx),
    };
  }

  // -------------------------------------------------------------- Planning : écriture

  /**
   * Convocation saisie (`convocation`, ou l'ancienne liste `concernes`) →
   * forme stockée (JSON), contrôlée contre les membres actifs de la team.
   * Personne de choisi : les joueurs (jamais les Propriétaires).
   */
  async function lireConvocation(teamId, corps) {
    let saisie;
    if (corps?.convocation !== undefined && corps.convocation !== null) saisie = corps.convocation;
    else if (Array.isArray(corps?.concernes)) {
      if (corps.concernes.length > 60) throw echec(400, 'concernes', 'Liste de membres illisible.');
      saisie = convocationDepuisListe(corps.concernes);
    } else if (corps?.concernes !== undefined && corps.concernes !== null) throw echec(400, 'concernes', 'Liste de membres illisible.');
    else saisie = CONVOCATION_DEFAUT;
    try {
      return preparerConvocation(saisie, await membresActifs(teamId));
    } catch (e) {
      throw echec(400, 'convocation', e.message);
    }
  }

  /** Comptes choisis nommément (ancienne colonne `concernes`, gardée pour les anciennes lectures). */
  const nominatifs = c => JSON.stringify([...new Set([...c.membres, ...c.proprietaires])].sort());

  /**
   * Saisie d'un événement. `interne.adversaireLibre` (module Tournois, jamais une route) : l'adversaire
   * doit être de la team, sans exiger `scouting.view` (le tournoi le montre à son roster).
   */
  async function lireSaisie(ctx, corps, existant, interne = {}) {
    const s = {};
    const champ = nom => corps?.[nom] !== undefined;
    if (!existant || champ('type')) {
      if (!TYPES_EVENEMENT.includes(corps?.type)) throw echec(400, 'type', 'Type d’événement inconnu.');
      s.type = corps.type;
    }
    if (!existant || champ('titre')) {
      s.titre = texteNettoye(corps?.titre, 80);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (champ('description')) s.description = texteLong(corps.description, 2000);
    if (champ('lieu')) s.lieu = texteNettoye(corps.lieu, 200);
    // Adversaire (scouting) et review : de la même team, et visibles par celui qui les lie (null efface toujours).
    if (champ('adversaireId')) {
      s.adversaire_id = uuidOuNull(corps.adversaireId, 'adversaire');
      if (s.adversaire_id && s.adversaire_id !== existant?.adversaire_id) {
        const ok = (interne.adversaireLibre || peut(ctx, 'scouting.view')) && (await base.premier('SELECT id FROM adversaires WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [s.adversaire_id, ctx.team.id]));
        if (!ok) throw echec(400, 'adversaire', 'Adversaire inconnu.');
      }
    }
    if (champ('reviewId')) {
      s.review_id = uuidOuNull(corps.reviewId, 'review');
      if (s.review_id && s.review_id !== existant?.review_id) {
        const ok = peut(ctx, 'video_review.view') && (await base.premier('SELECT id FROM reviews WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [s.review_id, ctx.team.id]));
        if (!ok) throw echec(400, 'review', 'Review inconnue.');
      }
    }
    if (!existant || champ('convocation') || champ('concernes')) {
      const c = await lireConvocation(ctx.team.id, corps);
      s.convocation = JSON.stringify(c);
      s.concernes = nominatifs(c);
    }
    const horaire = ['date', 'heureDebut', 'heureFin', 'debut', 'fin', 'fuseau'].some(champ);
    if (!existant || horaire) {
      const c = lireCreneau(
        corps?.date !== undefined || corps?.debut !== undefined ? corps : { ...corps, debut: existant?.debut, fin: existant?.fin },
        existant?.fuseau ?? ctx.team.fuseau,
      );
      s.debut = iso(c.debut);
      s.fin = iso(c.fin);
      s.fuseau = c.fuseau;
    }
    if (!existant || champ('recurrence') || horaire) {
      const fuseau = s.fuseau ?? existant.fuseau;
      const debut = Date.parse(s.debut ?? existant.debut);
      const brute = champ('recurrence') ? corps.recurrence : jsonOu(existant?.recurrence, null);
      try {
        const r = lireRecurrence(brute, jourSemaine(dateLocale(fuseau, debut)));
        s.recurrence = r ? JSON.stringify(r) : null;
        s.fin_serie = r?.jusqua ?? null;
      } catch (e) {
        throw echec(400, 'recurrence', e.message);
      }
    }
    return s;
  }

  /** Comptes convoqués (aujourd'hui) par une convocation stockée : destinataires des notifications. */
  async function comptesConvoques(teamId, convocation) {
    return convoques(normaliserConvocation(convocation) ?? CONVOCATION_DEFAUT, await membresActifs(teamId)).map(m => m.compte);
  }

  /**
   * Crée un événement. `interne` (module Tournois seulement, jamais depuis une route) :
   * `{ adversaireLibre, charge }` — `charge` complète celle de `event.created` (ex. `tournoiMatchId`).
   */
  async function creer(acteur, teamId, corps, interne = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.create');
    const s = await lireSaisie(ctx, corps, undefined, interne);
    const t = maintenant();
    const id = nouvelId();
    const convoquesListe = await comptesConvoques(teamId, s.convocation);
    await base.lot([
      {
        sql: `INSERT INTO planning_evenements (id, team_id, type, titre, description, debut, fin, fuseau, lieu, adversaire_id, review_id, recurrence, fin_serie, concernes, convocation, cree_par, cree_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, teamId, s.type, s.titre, s.description ?? '', s.debut, s.fin, s.fuseau, s.lieu ?? '', s.adversaire_id ?? null, s.review_id ?? null, s.recurrence, s.fin_serie, s.concernes ?? '[]', s.convocation, acteur.compte, iso(t), iso(t)],
      },
      evenement('event.created', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: id, charge: { ...(interne.charge ?? {}), titre: s.titre, type: s.type, debut: s.debut, recurrent: Boolean(s.recurrence), convoques: convoquesListe }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  /** Modifie toute la série (ou l'événement simple). Horaire ou règle changés : les exceptions de la série tombent. */
  async function modifier(acteur, teamId, evId, corps, interne = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.update');
    const ev = await evenementDeTeam(teamId, evId);
    const s = await lireSaisie(ctx, corps, ev, interne);
    const champs = Object.keys(s).filter(c => s[c] !== ev[c]);
    if (champs.length === 0) return detail(acteur, teamId, evId);
    const t = maintenant();
    const horaireChange = ['debut', 'fin', 'fuseau', 'recurrence'].some(c => champs.includes(c));
    const lot = [{ sql: `UPDATE planning_evenements SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...champs.map(c => s[c]), iso(t), evId] }];
    if (horaireChange) lot.push({ sql: 'DELETE FROM planning_exceptions WHERE evenement_id = ?', params: [evId] });
    lot.push(
      evenement('event.updated', {
        teamId,
        acteur: acteur.compte,
        entiteType: 'evenement',
        entiteId: evId,
        charge: { titre: s.titre ?? ev.titre, type: s.type ?? ev.type, debut: s.debut ?? ev.debut, champs, convoques: await comptesConvoques(teamId, s.convocation ?? JSON.stringify(convocationDe(ev))) },
        maintenant: t,
      }),
    );
    await base.lot(lot);
    return detail(acteur, teamId, evId);
  }

  /** Modifie UNE occurrence (titre, description, lieu, horaire) : exception de la série. */
  async function modifierOccurrence(acteur, teamId, evId, cle, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.update');
    const ev = await evenementDeTeam(teamId, evId);
    const o = await occurrenceDe(ev, cle);
    const x = o.exception ?? {};
    const titre = corps?.titre !== undefined ? texteNettoye(corps.titre, 80) : (x.titre ?? null);
    if (titre !== null && titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const description = corps?.description !== undefined ? texteLong(corps.description, 2000) : (x.description ?? null);
    const lieu = corps?.lieu !== undefined ? texteNettoye(corps.lieu, 200) : (x.lieu ?? null);
    let debut = x.debut ?? null;
    let fin = x.fin ?? null;
    // Convocation propre à cette date : `convocation` (objet), `null` pour reprendre celle de la série.
    let convocation = x.convocation ?? null;
    if (corps?.convocation === null) convocation = null;
    else if (corps?.convocation !== undefined || corps?.concernes !== undefined) convocation = JSON.stringify(await lireConvocation(teamId, corps));
    if (['date', 'heureDebut', 'heureFin', 'debut', 'fin'].some(c => corps?.[c] !== undefined)) {
      const c = lireCreneau(corps, ev.fuseau);
      if (Math.abs(c.debut - Date.parse(o.cle)) > DEPLACEMENT_MAX_MS) throw echec(400, 'deplacement', 'Une occurrence se déplace de 30 jours au plus.');
      debut = iso(c.debut);
      fin = iso(c.fin);
    }
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO planning_exceptions (evenement_id, occurrence, team_id, annulee, titre, description, debut, fin, lieu, convocation, maj_par, maj_le) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (evenement_id, occurrence) DO UPDATE SET annulee = 0, titre = excluded.titre, description = excluded.description, debut = excluded.debut, fin = excluded.fin, lieu = excluded.lieu, convocation = excluded.convocation, maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
        params: [evId, o.cle, teamId, titre, description, debut, fin, lieu, convocation, acteur.compte, iso(t)],
      },
      evenement('event.occurrence_updated', {
        teamId,
        acteur: acteur.compte,
        entiteType: 'evenement',
        entiteId: evId,
        charge: { titre: titre ?? ev.titre, type: ev.type, occurrence: o.cle, debut: debut ?? o.cle, convoques: await comptesConvoques(teamId, convocation ?? JSON.stringify(convocationDe(ev))) },
        maintenant: t,
      }),
    ]);
    return detail(acteur, teamId, evId);
  }

  /** Supprime : `portee` = serie (défaut) | occurrence | suivantes (cette occurrence et les suivantes). */
  async function supprimer(acteur, teamId, evId, { portee = 'serie', occurrence } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.delete');
    const ev = await evenementDeTeam(teamId, evId);
    const t = maintenant();
    const charge = { titre: ev.titre, type: ev.type, debut: ev.debut, convoques: await comptesConvoques(teamId, JSON.stringify(convocationDe(ev))) };
    if (portee !== 'serie' && ev.recurrence) {
      const o = await occurrenceDe(ev, occurrence);
      const premiere = occurrencesBrutes(ev, Date.parse(ev.debut) - 1, Date.parse(ev.debut) + 35 * JOUR_MS)[0];
      if (portee === 'occurrence') {
        await base.lot([
          {
            sql: `INSERT INTO planning_exceptions (evenement_id, occurrence, team_id, annulee, maj_par, maj_le) VALUES (?, ?, ?, 1, ?, ?)
                  ON CONFLICT (evenement_id, occurrence) DO UPDATE SET annulee = 1, maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
            params: [evId, o.cle, teamId, acteur.compte, iso(t)],
          },
          evenement('event.occurrence_cancelled', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: evId, charge: { ...charge, occurrence: o.cle, debut: iso(o.debut) }, maintenant: t }),
        ]);
        return { ok: true };
      }
      if (portee === 'suivantes' && premiere && premiere.cle !== o.cle) {
        const regle = { ...jsonOu(ev.recurrence, {}), jusqua: veilleLocale(ev.fuseau, Date.parse(o.cle)), nombre: null };
        await base.lot([
          { sql: 'UPDATE planning_evenements SET recurrence = ?, fin_serie = ?, maj_le = ? WHERE id = ?', params: [JSON.stringify(regle), regle.jusqua, iso(t), evId] },
          { sql: 'DELETE FROM planning_exceptions WHERE evenement_id = ? AND occurrence >= ?', params: [evId, o.cle] },
          evenement('event.occurrence_cancelled', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: evId, charge: { ...charge, occurrence: o.cle, suivantes: true, debut: iso(o.debut) }, maintenant: t }),
        ]);
        return { ok: true };
      }
    } else if (portee !== 'serie' && portee !== 'occurrence' && portee !== 'suivantes') {
      throw echec(400, 'portee', 'Portée inconnue.');
    }
    // Suppression logique : présences et historique restent (statistiques, journal).
    await base.lot([
      { sql: 'UPDATE planning_evenements SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), evId] },
      evenement('event.deleted', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: evId, charge, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Réglages

  async function lireReglages(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    if (!peut(ctx, 'planning.view') && !peut(ctx, 'availability.edit_own') && !peut(ctx, 'availability.view_all')) exiger(ctx, 'planning.view');
    return { ...(await reglages(teamId)), fuseau: ctx.team.fuseau, droits: droits(ctx) };
  }

  async function changerReglages(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'team.manage');
    const actuels = await reglages(teamId);
    const nouveaux = { ...actuels };
    if (corps?.effectifMin !== undefined) {
      const n = Number(corps.effectifMin);
      if (!Number.isInteger(n) || n < 1 || n > 30) throw echec(400, 'effectif', 'Effectif minimum : 1 à 30.');
      nouveaux.effectifMin = n;
    }
    if (corps?.rappelHeures !== undefined) {
      const n = Number(corps.rappelHeures);
      if (!Number.isInteger(n) || n < 0 || n > 168) throw echec(400, 'rappel', 'Rappel : 0 (désactivé) à 168 heures avant.');
      nouveaux.rappelHeures = n;
    }
    if (corps?.debutSaison !== undefined) {
      if (typeof corps.debutSaison !== 'string' || !MOTIF_SAISON.test(corps.debutSaison)) throw echec(400, 'saison', 'Début de saison : MM-JJ (ex. 09-01).');
      nouveaux.debutSaison = corps.debutSaison;
    }
    const t = maintenant();
    const config = async module => jsonOu((await base.premier('SELECT config FROM team_modules WHERE team_id = ? AND module = ?', [teamId, module]))?.config, {});
    const ecrire = (module, valeur) => ({
      sql: `INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, ?, 0, ?, ?)
            ON CONFLICT (team_id, module) DO UPDATE SET config = excluded.config, maj_le = excluded.maj_le`,
      params: [teamId, module, JSON.stringify(valeur), iso(t)],
    });
    await base.lot([
      ecrire('availability', { ...(await config('availability')), effectifMin: nouveaux.effectifMin }),
      ecrire('attendance', { ...(await config('attendance')), rappelHeures: nouveaux.rappelHeures, debutSaison: nouveaux.debutSaison }),
      evenement('availability.settings_changed', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: nouveaux, maintenant: t }),
    ]);
    return lireReglages(acteur, teamId);
  }

  // -------------------------------------------------------------- Accueil de la team

  async function accueil(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const t = maintenant();
    const a = await occurrencesTeam(teamId, t - 14 * JOUR_MS, t + 14 * JOUR_MS);
    const presenceActive = ctx.modules.has('attendance');
    const lignes = presenceActive ? await base.tous('SELECT evenement_id, occurrence, compte_id, rsvp, reel, retard_prevu, motif_prevu, hors_convocation FROM presences WHERE team_id = ? AND occurrence >= ?', [teamId, iso(t - 15 * JOUR_MS - MARGE_MS)]) : [];
    const de = (ev, o) => lignes.filter(l => l.evenement_id === ev.id && l.occurrence === o.cle);
    const membres = await membresActifs(teamId);
    const moi = membres.find(m => m.compte === acteur.compte);
    // « Mes prochains événements » : ceux où l'on est CONVOQUÉ (un Propriétaire non coché ne les voit qu'au planning).
    const prochains = a
      .filter(({ ev, o }) => o.fin > t && convoqueMoi(ev, o, moi))
      .slice(0, 6)
      .map(({ ev, o }) => {
        const ligne = de(ev, o).find(l => l.compte_id === acteur.compte);
        return occurrencePublique(ev, o, fuseau, { convoqueMoi: true, concerneMoi: true, monRsvp: presenceActive ? (ligne?.rsvp ?? 'sans_reponse') : null, maReponse: presenceActive ? reponseDe(ligne) : null });
      });
    const alertes = [];
    if (presenceActive && peut(ctx, 'attendance.rsvp_own')) {
      for (const { ev, o } of a) {
        if (o.debut <= t || o.debut > t + 7 * JOUR_MS || !convoqueMoi(ev, o, moi)) continue;
        const ligne = de(ev, o).find(l => l.compte_id === acteur.compte);
        if (!ligne || ligne.rsvp === 'sans_reponse') alertes.push({ genre: 'rsvp', ...occurrencePublique(ev, o, fuseau, { convoqueMoi: true, concerneMoi: true }) });
      }
    }
    if (presenceActive && (peut(ctx, 'attendance.mark') || peut(ctx, 'attendance.view_all'))) {
      for (const { ev, o } of a) {
        const deja = de(ev, o);
        // Attendus : les convoqués, eux seuls.
        const liste = roster(membres, ev, o);
        // À marquer : les séances COMMENCÉES (en cours comprises), comme la page Présence.
        if (o.debut <= t && peut(ctx, 'attendance.mark')) {
          const nonMarques = liste.filter(m => !deja.some(l => l.compte_id === m.compte && l.reel !== 'inconnu')).length;
          if (nonMarques > 0) alertes.push({ genre: 'a-marquer', nonMarques, ...occurrencePublique(ev, o, fuseau) });
        } else if (o.debut > t && o.debut <= t + 3 * JOUR_MS) {
          const sansReponse = liste.filter(m => m.a('attendance.rsvp_own') && !deja.some(l => l.compte_id === m.compte && l.rsvp !== 'sans_reponse')).length;
          if (sansReponse > 0) alertes.push({ genre: 'sans-reponse', sansReponse, ...occurrencePublique(ev, o, fuseau) });
        }
      }
    }
    return { fuseau, prochains, alertes: alertes.slice(0, 12), droits: droits(ctx), modules: { presence: presenceActive } };
  }

  // -------------------------------------------------------------- Présence

  /**
   * Réponse du joueur (RSVP) : Oui / Peut-être / Non, et en option ce qu'il
   * annonce : `retardPrevu` (minutes, « je serai en retard de X min ») ou
   * `motif` (« absent : motif »). Même chemin pour l'app et pour les boutons du
   * bot Discord (qui n'envoient que `rsvp`) : un champ absent garde sa valeur,
   * sauf incohérence — « Non » efface un retard annoncé, « Oui » ou
   * « Peut-être » effacent un motif d'absence.
   */
  async function repondre(acteur, teamId, evId, cle, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    exiger(ctx, 'attendance.rsvp_own');
    const ev = await evenementDeTeam(teamId, evId);
    if (!ctx.membre) throw echec(403, 'non-membre', 'Seuls les membres de la team répondent.');
    const o = await occurrenceDe(ev, cle);
    const moi = (await membresActifs(teamId)).find(m => m.compte === acteur.compte);
    if (!convoqueMoi(ev, o, moi)) throw echec(403, 'non-concerne', 'Vous n’êtes pas convoqué à cet événement.');
    if (o.fin <= maintenant()) throw echec(409, 'termine', 'Cet événement est terminé : la présence est marquée par le staff.');
    const rsvp = corps?.rsvp;
    if (!RSVP.includes(rsvp)) throw echec(400, 'rsvp', 'Réponse : oui, non ou peut-être.');
    const note = corps?.note !== undefined ? texteNettoye(corps.note, 200) : null;
    const avant = await base.premier('SELECT retard_prevu, motif_prevu FROM presences WHERE evenement_id = ? AND occurrence = ? AND compte_id = ?', [evId, o.cle, acteur.compte]);
    let retard = avant?.retard_prevu === null || avant?.retard_prevu === undefined ? null : Number(avant.retard_prevu);
    let motif = avant?.motif_prevu ?? '';
    if (corps?.retardPrevu !== undefined) {
      const n = lireMinutes(corps.retardPrevu);
      if (n === undefined) throw echec(400, 'retard', 'Retard annoncé : de 1 à 600 minutes.');
      retard = n;
    }
    if (corps?.motif !== undefined) motif = texteNettoye(corps.motif, 200);
    if (rsvp === 'non' || rsvp === 'sans_reponse') retard = null;
    if (rsvp !== 'non') motif = '';
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, rsvp, note, retard_prevu, motif_prevu, rsvp_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (evenement_id, occurrence, compte_id) DO UPDATE SET rsvp = excluded.rsvp, note = COALESCE(?, presences.note), retard_prevu = excluded.retard_prevu, motif_prevu = excluded.motif_prevu, rsvp_le = excluded.rsvp_le, maj_le = excluded.maj_le`,
        params: [evId, o.cle, acteur.compte, teamId, rsvp, note ?? '', retard, motif, iso(t), iso(t), note],
      },
      // Journal : la réponse et le retard annoncé, jamais le motif (donnée personnelle).
      evenement('attendance.rsvp', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: evId, charge: { titre: o.titre, occurrence: o.cle, rsvp, ...(retard ? { retardPrevu: retard } : {}) }, maintenant: t }),
    ]);
    return { ok: true, rsvp, retardPrevu: retard, motif };
  }

  /** Une ligne de la feuille d'appel. */
  const lignePublique = (l, compte, pseudo, hors) => ({
    compte,
    pseudo,
    horsConvocation: hors,
    rsvp: l?.rsvp ?? 'sans_reponse',
    retardPrevu: l?.retard_prevu === null || l?.retard_prevu === undefined ? null : Number(l.retard_prevu),
    motifPrevu: l?.motif_prevu ?? '',
    reel: l?.reel ?? 'inconnu',
    retardMinutes: l?.retard_minutes === null || l?.retard_minutes === undefined ? null : Number(l.retard_minutes),
    motif: l?.motif ?? '',
    note: l?.note ?? '',
    marqueLe: l?.marque_le ?? null,
  });

  /** Compteurs d'une séance : convoqués, réponses, présence réelle (les ajoutés sont à part). */
  function compteursSeance(lignes) {
    const conv = lignes.filter(l => !l.horsConvocation);
    const n = f => conv.filter(f).length;
    return {
      convoques: conv.length,
      oui: n(l => l.rsvp === 'oui'),
      peutEtre: n(l => l.rsvp === 'peut_etre'),
      non: n(l => l.rsvp === 'non'),
      sansReponse: n(l => l.rsvp === 'sans_reponse'),
      marques: n(l => l.reel !== 'inconnu'),
      nonMarques: n(l => l.reel === 'inconnu'),
      present: n(l => l.reel === 'present'),
      retard: n(l => l.reel === 'retard'),
      absent: n(l => l.reel === 'absent'),
      excuse: n(l => l.reel === 'excuse'),
      enPlus: lignes.filter(l => l.horsConvocation && (l.reel === 'present' || l.reel === 'retard')).length,
    };
  }

  /**
   * Vue « Présence » d'une séance : les CONVOQUÉS (et, à part, les non-convoqués
   * ajoutés par le staff), leur réponse, ce qu'ils ont annoncé, leur présence
   * réelle ; compteurs ; membres ajoutables (staff qui marque).
   */
  async function presenceOccurrence(acteur, teamId, evId, cle) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    if (!peut(ctx, 'attendance.view_all')) exiger(ctx, 'attendance.rsvp_own');
    const ev = await evenementDeTeam(teamId, evId);
    const o = await occurrenceDe(ev, cle);
    const brutes = await base.tous('SELECT * FROM presences WHERE evenement_id = ? AND occurrence = ?', [evId, o.cle]);
    const membres = await membresActifs(teamId);
    const liste = roster(membres, ev, o);
    const ids = new Set(liste.map(m => m.compte));
    const ajoutes = brutes.filter(l => Number(l.hors_convocation) === 1 && !ids.has(l.compte_id));
    const pseudos = await pseudosDe(base, ajoutes.map(l => l.compte_id));
    let lignes = [
      ...liste.map(m => lignePublique(brutes.find(x => x.compte_id === m.compte), m.compte, m.pseudo, false)),
      ...ajoutes.map(l => lignePublique(l, l.compte_id, pseudos[l.compte_id] ?? null, true)),
    ];
    if (!peut(ctx, 'attendance.view_all')) lignes = lignes.filter(l => l.compte === acteur.compte);
    const marquer = peut(ctx, 'attendance.mark');
    const t = maintenant();
    return {
      occurrence: occurrencePublique(ev, o, ctx.team.fuseau, {}, membres),
      lignes,
      compteurs: compteursSeance(lignes),
      // Non-convoqués qui peuvent être ajoutés (« venu sans être convoqué ») : membres actifs.
      ajoutables: marquer ? membres.filter(m => !ids.has(m.compte) && !ajoutes.some(a => a.compte_id === m.compte)).map(m => ({ compte: m.compte, pseudo: m.pseudo })) : [],
      commence: o.debut <= t,
      termine: o.fin <= t,
      droits: droits(ctx),
    };
  }

  /**
   * Marquage (staff), un appui = une requête. Corps :
   *  - `marques: [{ compte, reel, retardMinutes?, motif?, note?, horsConvocation? }]` ;
   *  - `toutPresent: true` : tous les convoqués PAS ENCORE marqués passent
   *    « présent » (les exceptions déjà saisies restent), puis on ajuste.
   * Un non-convoqué n'est accepté qu'avec `horsConvocation: true` (venu quand
   * même) ; le remettre « non marqué » le retire de la feuille. Les minutes ne
   * valent qu'avec « en retard », le motif qu'avec « absent » ou « excusé ».
   */
  async function marquer(acteur, teamId, evId, cle, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    exiger(ctx, 'attendance.mark');
    const ev = await evenementDeTeam(teamId, evId);
    const o = await occurrenceDe(ev, cle);
    const toutPresent = corps?.toutPresent === true;
    const marques = corps?.marques ?? [];
    if (!Array.isArray(marques) || marques.length > 60 || (marques.length === 0 && !toutPresent)) throw echec(400, 'marques', 'Liste de présences illisible.');
    const tousMembres = new Set((await base.tous('SELECT compte_id FROM membres WHERE team_id = ?', [teamId])).map(l => l.compte_id));
    const actifs = await membresActifs(teamId);
    const actifsIds = new Set(actifs.map(m => m.compte));
    // Seuls les convoqués de CETTE occurrence se marquent (un Propriétaire non coché n'est pas attendu).
    const convoquesOcc = roster(actifs, ev, o).map(m => m.compte);
    const estConv = new Set(convoquesOcc);
    const existantes = new Map((await base.tous('SELECT * FROM presences WHERE evenement_id = ? AND occurrence = ?', [evId, o.cle])).map(l => [l.compte_id, l]));
    const t = maintenant();
    const lot = [];
    const resume = [];
    const ecrire = (compte, reel, retard, motif, note, hors) =>
      lot.push({
        sql: `INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, reel, retard_minutes, motif, note, hors_convocation, marque_par, marque_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (evenement_id, occurrence, compte_id) DO UPDATE SET reel = excluded.reel, retard_minutes = excluded.retard_minutes, motif = excluded.motif, note = COALESCE(?, presences.note), hors_convocation = excluded.hors_convocation, marque_par = excluded.marque_par, marque_le = excluded.marque_le, maj_le = excluded.maj_le`,
        params: [evId, o.cle, compte, teamId, reel, retard, motif, note ?? '', hors ? 1 : 0, acteur.compte, iso(t), iso(t), note],
      });
    const vus = new Set();
    const absence = r => r === 'absent' || r === 'excuse';
    for (const m of marques) {
      if (typeof m?.compte !== 'string' || !tousMembres.has(m.compte)) throw echec(400, 'compte', 'Un des joueurs ne fait pas partie de la team.');
      if (!REELS.includes(m.reel)) throw echec(400, 'reel', 'Présence : présent, absent, excusé, en retard ou inconnu.');
      const avant = existantes.get(m.compte);
      const convoque = estConv.has(m.compte);
      const hors = !convoque && (m.horsConvocation === true || Number(avant?.hors_convocation) === 1);
      if (!convoque && !hors) throw echec(400, 'non-convoque', 'Ce membre n’est pas convoqué à cet événement : ajoutez-le comme « venu sans être convoqué ».');
      if (hors && !avant && !actifsIds.has(m.compte)) throw echec(400, 'compte', 'Seul un membre actif de la team peut être ajouté.');
      vus.add(m.compte);
      // Un non-convoqué remis à « non marqué » est retiré de la feuille d'appel.
      if (hors && m.reel === 'inconnu') {
        if (avant) lot.push({ sql: 'DELETE FROM presences WHERE evenement_id = ? AND occurrence = ? AND compte_id = ?', params: [evId, o.cle, m.compte] });
        resume.push({ compte: m.compte, reel: 'inconnu' });
        continue;
      }
      let retard = m.reel === 'retard' && avant?.reel === 'retard' && avant.retard_minutes !== null && avant.retard_minutes !== undefined ? Number(avant.retard_minutes) : null;
      if (m.retardMinutes !== undefined) {
        const n = lireMinutes(m.retardMinutes);
        if (n === undefined) throw echec(400, 'retard', 'Retard : de 1 à 600 minutes.');
        retard = m.reel === 'retard' ? n : null;
      }
      let motif = absence(m.reel) && absence(avant?.reel) ? (avant.motif ?? '') : '';
      if (m.motif !== undefined) motif = absence(m.reel) ? texteNettoye(m.motif, 200) : '';
      const note = m.note !== undefined ? texteNettoye(m.note, 200) : null;
      ecrire(m.compte, m.reel, retard, motif, note, hors);
      resume.push({ compte: m.compte, reel: m.reel });
    }
    if (toutPresent) {
      for (const c of convoquesOcc) {
        const avant = existantes.get(c);
        if (vus.has(c) || (avant && avant.reel !== 'inconnu')) continue;
        ecrire(c, 'present', null, '', null, false);
        resume.push({ compte: c, reel: 'present' });
      }
    }
    if (lot.length > 0) {
      lot.push(
        evenement('attendance.marked', {
          teamId,
          acteur: acteur.compte,
          entiteType: 'evenement',
          entiteId: evId,
          // Journal : qui et quoi, jamais le motif (donnée personnelle).
          charge: { titre: o.titre, occurrence: o.cle, marques: resume, ...(toutPresent ? { toutPresent: true } : {}) },
          maintenant: t,
        }),
      );
      await base.lot(lot);
    }
    return presenceOccurrence(acteur, teamId, evId, o.cle);
  }

  /**
   * Lignes de présence de la team sur une plage (clé d'occurrence dans
   * [du, au[), avec le type et le titre de l'événement : celles des
   * CONVOQUÉS. Un convoqué sans ligne à une séance déjà commencée reçoit une
   * ligne « sans réponse, non marqué » (il était attendu). Un non-convoqué
   * ajouté par le staff (`hors_convocation`) est rendu avec `hors: true`
   * (compté à part, jamais dans les taux) ; tout autre non-convoqué est
   * ignoré. Un ancien membre (parti de la team) garde ses présences marquées.
   */
  async function lignesPresence(teamId, du, au, { types, compte } = {}) {
    const conditions = ['p.team_id = ?', 'p.occurrence >= ?', 'p.occurrence < ?'];
    const params = [teamId, iso(du), iso(au)];
    if (compte) {
      conditions.push('p.compte_id = ?');
      params.push(compte);
    }
    const brutes = await base.tous(
      `SELECT p.*, e.type, e.titre, e.debut AS ev_debut, e.fin AS ev_fin, e.convocation AS ev_convocation, e.concernes AS ev_concernes,
              x.convocation AS x_convocation, x.fin AS x_fin, x.titre AS x_titre, c.pseudo, c.pseudo_cle
         FROM presences p
         JOIN planning_evenements e ON e.id = p.evenement_id
         LEFT JOIN planning_exceptions x ON x.evenement_id = p.evenement_id AND x.occurrence = p.occurrence
         LEFT JOIN comptes c ON c.id = p.compte_id
        WHERE ${conditions.join(' AND ')} ORDER BY p.occurrence, c.pseudo_cle`,
      params,
    );
    const membres = new Map((await membresActifs(teamId, { tous: true })).map(m => [m.compte, m]));
    const garde = [];
    for (const l of brutes) {
      if (types?.length && !types.includes(l.type)) continue;
      const m = membres.get(l.compte_id);
      const fin = l.x_fin ? Date.parse(l.x_fin) : Date.parse(l.occurrence) + (Date.parse(l.ev_fin) - Date.parse(l.ev_debut));
      const conv = (l.x_convocation && normaliserConvocation(l.x_convocation)) || convocationDe({ convocation: l.ev_convocation, concernes: l.ev_concernes });
      if (m && estConvoque(conv, m, fin)) garde.push({ ...l, hors: false });
      else if (Number(l.hors_convocation) === 1) {
        if (l.reel !== 'inconnu') garde.push({ ...l, hors: true });
      } else if (!m && l.reel !== 'inconnu') garde.push({ ...l, hors: false });
    }
    // Convoqués attendus sans ligne (séances commencées) : comptés « sans réponse, non marqué ».
    const presentes = new Set(garde.map(l => `${l.evenement_id}|${l.occurrence}|${l.compte_id}`));
    const actifs = [...membres.values()].filter(m => m.statut === 'actif' && (!compte || m.compte === compte));
    const t = maintenant();
    for (const { ev, o } of await occurrencesTeam(teamId, du, au)) {
      const cleMs = Date.parse(o.cle);
      if (cleMs < du || cleMs >= au || o.debut > t) continue;
      if (types?.length && !types.includes(ev.type)) continue;
      for (const m of roster(actifs, ev, o)) {
        if (presentes.has(`${ev.id}|${o.cle}|${m.compte}`)) continue;
        garde.push({ evenement_id: ev.id, occurrence: o.cle, compte_id: m.compte, team_id: teamId, rsvp: 'sans_reponse', reel: 'inconnu', note: '', motif: '', motif_prevu: '', retard_minutes: null, retard_prevu: null, hors: false, type: ev.type, titre: o.titre ?? ev.titre, pseudo: m.pseudo, pseudo_cle: m.pseudo.toLocaleLowerCase('fr') });
      }
    }
    return garde
      .map(l => ({ ...l, titre: l.x_titre ?? l.titre }))
      .sort((a, b) => a.occurrence.localeCompare(b.occurrence) || String(a.pseudo_cle ?? '').localeCompare(String(b.pseudo_cle ?? '')));
  }

  /** Ligne brute → ligne des statistiques pures. */
  const pourStats = l => ({
    compte: l.compte_id,
    type: l.type,
    debut: Date.parse(l.occurrence),
    rsvp: l.rsvp,
    reel: l.reel,
    retardMinutes: l.retard_minutes === null || l.retard_minutes === undefined ? null : Number(l.retard_minutes),
    hors: Boolean(l.hors),
  });

  /**
   * Période des statistiques : `debut` et `fin` (AAAA-MM-JJ, fin exclue), ou
   * `periode` = 7 | 30 | 90 (derniers jours, aujourd'hui compris) | saison
   * (depuis le début de saison de la team, `debutSaison` MM-JJ). Défaut : 90 jours.
   */
  function lirePeriode(params, fuseau, debutSaison = REGLAGES_DEFAUT.debutSaison) {
    const p = { ...params };
    const auj = dateLocale(fuseau, maintenant());
    if (!p.debut && !p.fin) {
      p.fin = texteDate(ajouterJours(auj, 1));
      if (p.periode === 'saison') {
        const [mm, jj] = debutSaison.split('-').map(Number);
        const annee = auj.mois * 100 + auj.jour >= mm * 100 + jj ? auj.annee : auj.annee - 1;
        p.debut = texteDate({ annee, mois: mm, jour: jj });
      } else {
        const jours = ['7', '30', '90'].includes(String(p.periode ?? '')) ? Number(p.periode) : 90;
        p.debut = texteDate(ajouterJours(auj, 1 - jours));
      }
    }
    const d = lireDate(p.debut);
    const f = lireDate(p.fin);
    if (!d || !f || ecartJours(d, f) < 1 || ecartJours(d, f) > 731) throw echec(400, 'plage', 'Période de 1 jour à 2 ans (AAAA-MM-JJ).');
    return { du: instantMural(fuseau, d, 0), au: instantMural(fuseau, f, 0), debut: texteDate(d), fin: texteDate(f) };
  }

  const lireTypes = params => (params.types ? String(params.types).split(',').filter(t => TYPES_EVENEMENT.includes(t)) : []);

  /**
   * Statistiques : par joueur (taux, ponctualité, retard moyen, séries
   * d'absences, tendance), par type, par mois ou semaine. Le staff
   * (`attendance.view_all`) voit la team, un joueur ses propres chiffres.
   */
  async function stats(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    const tout = peut(ctx, 'attendance.view_all');
    if (!tout) exiger(ctx, 'attendance.rsvp_own');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const { debutSaison } = await reglages(teamId);
    const { du, au, debut, fin } = lirePeriode(params, fuseau, debutSaison);
    const types = lireTypes(params);
    const lignes = await lignesPresence(teamId, du, au, { types, compte: tout ? null : acteur.compte });
    // Tendance : on compare les deux moitiés de la période ÉCOULÉE (le futur n'a rien de marqué).
    const milieu = du + (Math.min(au, maintenant()) - du) / 2;
    const s = statistiques(lignes.map(pourStats), { fuseau, granularite: params.granularite === 'semaine' ? 'semaine' : 'mois', milieu });
    const noms = {};
    for (const l of lignes) noms[l.compte_id] = l.pseudo ?? null;
    s.joueurs.sort((a, b) => (noms[a.compte] ?? '').localeCompare(noms[b.compte] ?? '', 'fr'));
    return { debut, fin, fuseau, debutSaison, tout, noms, ...s };
  }

  /**
   * « À marquer » (staff) : les séances COMMENCÉES (en cours comprises) des
   * 30 derniers jours dont la présence n'est pas complète (un convoqué au moins
   * non marqué), la plus récente d'abord, avec le nombre restant.
   */
  async function aMarquer(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    exiger(ctx, 'attendance.mark');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const t = maintenant();
    const occs = (await occurrencesTeam(teamId, t - A_MARQUER_JOURS * JOUR_MS, t + 1)).filter(({ o }) => o.debut <= t);
    const membres = await membresActifs(teamId);
    const lignes = await base.tous('SELECT evenement_id, occurrence, compte_id, reel FROM presences WHERE team_id = ? AND occurrence >= ?', [teamId, iso(t - A_MARQUER_JOURS * JOUR_MS - MARGE_MS)]);
    const seances = [];
    for (const { ev, o } of occs) {
      const liste = roster(membres, ev, o);
      if (liste.length === 0) continue;
      const marques = liste.filter(m => lignes.some(l => l.evenement_id === ev.id && l.occurrence === o.cle && l.compte_id === m.compte && l.reel !== 'inconnu')).length;
      if (marques >= liste.length) continue;
      seances.push(occurrencePublique(ev, o, fuseau, { convoquesTotal: liste.length, marques, restants: liste.length - marques, enCours: o.fin > t }));
    }
    seances.sort((a, b) => b.debut.localeCompare(a.debut));
    return { total: seances.length, jours: A_MARQUER_JOURS, seances };
  }

  /** Historique (staff) : une ligne par séance commencée de la période, avec ses compteurs et son taux. */
  async function historique(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    exiger(ctx, 'attendance.view_all');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const { debutSaison } = await reglages(teamId);
    const { du, au, debut, fin } = lirePeriode(params, fuseau, debutSaison);
    const lignes = await lignesPresence(teamId, du, au, { types: lireTypes(params) });
    const parSeance = new Map();
    for (const l of lignes) {
      const cle = `${l.evenement_id}|${l.occurrence}`;
      if (!parSeance.has(cle)) parSeance.set(cle, []);
      parSeance.get(cle).push(l);
    }
    const seances = [...parSeance.values()].map(ls => {
      const l = ls[0];
      const d = local(fuseau, Date.parse(l.occurrence));
      return { evenementId: l.evenement_id, cle: l.occurrence, titre: l.titre, type: l.type, jour: d.jour, heureDebut: d.heure, ...compter(ls.map(pourStats)) };
    });
    seances.sort((a, b) => b.cle.localeCompare(a.cle));
    return { debut, fin, fuseau, seances };
  }

  /**
   * Fiche de présence d'un joueur : compteurs, séries, historique séance par
   * séance (réponse, annonce, présence, retard, motif) et motifs. Le staff
   * (`attendance.view_all`) pour tout membre ; un joueur pour lui-même (`moi`).
   */
  async function fichePresence(acteur, teamId, compte, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    const cible = compte === 'moi' ? acteur.compte : compte;
    if (typeof cible !== 'string' || !MOTIF_COMPTE.test(cible)) throw echec(404, 'membre-introuvable', 'Membre introuvable.');
    if (cible !== acteur.compte || !peut(ctx, 'attendance.rsvp_own')) exiger(ctx, 'attendance.view_all');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const { debutSaison } = await reglages(teamId);
    const { du, au, debut, fin } = lirePeriode(params, fuseau, debutSaison);
    const lignes = await lignesPresence(teamId, du, au, { types: lireTypes(params), compte: cible });
    const pseudo = (await pseudosDe(base, [cible]))[cible] ?? null;
    const t = maintenant();
    const passees = lignes.filter(l => Date.parse(l.occurrence) <= t);
    const motifs = new Map();
    for (const l of passees) {
      const m = (l.motif || l.motif_prevu || '').trim();
      if (m && (l.reel === 'absent' || l.reel === 'excuse')) motifs.set(m, (motifs.get(m) ?? 0) + 1);
    }
    return {
      compte: cible,
      pseudo,
      debut,
      fin,
      fuseau,
      ...compter(passees.map(pourStats)),
      ...seriesAbsences(passees.map(pourStats)),
      historique: passees
        .slice()
        .reverse()
        .map(l => {
          const d = local(fuseau, Date.parse(l.occurrence));
          const lp = lignePublique(l, cible, pseudo, Boolean(l.hors));
          return { evenementId: l.evenement_id, cle: l.occurrence, titre: l.titre, type: l.type, jour: d.jour, heureDebut: d.heure, ...lp };
        }),
      motifs: [...motifs].map(([motif, n]) => ({ motif, n })).sort((a, b) => b.n - a.n),
    };
  }

  async function exportCsv(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'attendance.view_all');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const { debutSaison } = await reglages(teamId);
    const { du, au, debut, fin } = lirePeriode(params, fuseau, debutSaison);
    const lignes = await lignesPresence(teamId, du, au, { types: lireTypes(params) });
    const L = lireLangue(acteur.langue) ?? LANGUE_DEFAUT;
    const R = cle => (['oui', 'non', 'peut_etre', 'sans_reponse'].includes(cle) ? T(L, `csv.rsvp.${cle}`) : cle);
    const P = cle => (['present', 'absent', 'excuse', 'retard', 'inconnu'].includes(cle) ? T(L, `csv.reel.${cle}`) : cle);
    const typeLibelle = cle => (TYPES_EVENEMENT.includes(cle) ? T(L, cle === 'other' ? 'type.choix_autre' : `type.${cle}`) : cle);
    const num = v => (v === null || v === undefined ? '' : String(Number(v)));
    const contenu = csv(
      listeTextes(L, 'csv.presence.entetes'),
      lignes.map(l => {
        const d = local(fuseau, Date.parse(l.occurrence));
        return [
          d.jour,
          d.heure,
          l.titre,
          typeLibelle(l.type),
          l.pseudo ?? l.compte_id,
          T(L, l.hors ? 'csv.convoque.non' : 'csv.convoque.oui'),
          R(l.rsvp),
          num(l.retard_prevu),
          l.motif_prevu ?? '',
          P(l.reel),
          num(l.retard_minutes),
          l.motif ?? '',
          l.note ?? '',
        ];
      }),
    );
    return { nom: `presence-${ctx.team.slug}-${debut}-${fin}.csv`, type: 'text/csv; charset=utf-8', contenu };
  }

  // -------------------------------------------------------------- iCal

  async function icsTeam(ctx) {
    const t = maintenant();
    const toutes = await occurrencesTeam(ctx.team.id, t - 60 * JOUR_MS, t + 365 * JOUR_MS);
    return calendrierIcs({
      nom: `${ctx.team.nom} (Esport)`,
      fuseau: ctx.team.fuseau,
      maintenant: t,
      occurrences: toutes.map(({ ev, o }) => ({
        evenementId: ev.id,
        cle: o.cle,
        debut: o.debut,
        fin: o.fin,
        titre: o.titre ?? ev.titre,
        description: o.description ?? ev.description,
        lieu: o.lieu ?? ev.lieu,
        type: ev.type,
        majLe: ev.maj_le,
      })),
    });
  }

  async function exportIcs(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    return { nom: `planning-${ctx.team.slug}.ics`, type: 'text/calendar; charset=utf-8', contenu: await icsTeam(ctx) };
  }

  const jetonPublic = j => ({ id: j.id, libelle: j.libelle, creeLe: j.cree_le, dernierAcces: j.dernier_acces_le ?? null, revoque: Boolean(j.revoque_le) });

  async function jetonsIcal(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    const lignes = await base.tous('SELECT * FROM ical_jetons WHERE team_id = ? AND compte_id = ? ORDER BY cree_le DESC LIMIT 20', [teamId, acteur.compte]);
    return lignes.map(jetonPublic);
  }

  async function creerJetonIcal(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    const actifs = await base.premier('SELECT COUNT(*) AS n FROM ical_jetons WHERE team_id = ? AND compte_id = ? AND revoque_le IS NULL', [teamId, acteur.compte]);
    if (Number(actifs?.n ?? 0) >= 5) throw echec(409, 'trop-de-jetons', 'Cinq abonnements actifs au plus : révoquez-en un d’abord.');
    // Montré une seule fois ; seule l'empreinte est gardée.
    const jeton = `ical_${aleatoire(32)}`;
    const t = maintenant();
    const id = nouvelId();
    const libelle = texteNettoye(corps?.libelle, 60) || 'Calendrier';
    await base.lot([
      {
        sql: 'INSERT INTO ical_jetons (id, team_id, compte_id, super_admin, jeton_hash, libelle, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [id, teamId, acteur.compte, acteur.superAdmin ? 1 : 0, await sha256Hex(jeton), libelle, iso(t)],
      },
      evenement('ical.token_created', { teamId, acteur: acteur.compte, entiteType: 'ical', entiteId: id, charge: { libelle }, maintenant: t }),
    ]);
    return { jeton, chemin: `/ical/${jeton}.ics`, abonnement: jetonPublic({ id, libelle, cree_le: iso(t) }) };
  }

  async function revoquerJetonIcal(acteur, teamId, jetonId) {
    const ctx = await contexteTeam(acteur, teamId);
    // Ordre des contrôles : module avant tout (désactivé : 404 comme les autres routes du planning).
    if (!ctx.modules.has('planning')) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (typeof jetonId !== 'string' || !MOTIF_UUID.test(jetonId)) throw echec(404, 'jeton-introuvable', 'Abonnement introuvable.');
    const j = await base.premier('SELECT * FROM ical_jetons WHERE id = ? AND team_id = ?', [jetonId, teamId]);
    // Le sien, ou n'importe lequel pour qui gère les membres.
    if (!j || (j.compte_id !== acteur.compte && !peut(ctx, 'members.remove') && !acteur.superAdmin)) throw echec(404, 'jeton-introuvable', 'Abonnement introuvable.');
    if (j.revoque_le) return { ok: true };
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE ical_jetons SET revoque_le = ? WHERE id = ?', params: [iso(t), jetonId] },
      evenement('ical.token_revoked', { teamId, acteur: acteur.compte, entiteType: 'ical', entiteId: jetonId, charge: { libelle: j.libelle }, maintenant: t }),
    ]);
    return { ok: true };
  }

  /**
   * Abonnement public (`GET /ical/<jeton>.ics`, sans session) : le jeton doit
   * être actif ET son titulaire avoir encore accès au planning de la team
   * (membre actif, module activé, permission). Sinon 404, sans rien dire.
   */
  async function icsAbonnement(jeton) {
    const inconnu = () => echec(404, 'ical-inconnu', 'Calendrier introuvable.');
    if (typeof jeton !== 'string' || !MOTIF_JETON_ICAL.test(jeton)) throw inconnu();
    const j = await base.premier('SELECT * FROM ical_jetons WHERE jeton_hash = ?', [await sha256Hex(jeton)]);
    if (!j || j.revoque_le) throw inconnu();
    let ctx;
    try {
      ctx = await contexteTeam({ compte: j.compte_id, superAdmin: Number(j.super_admin) === 1 }, j.team_id);
      exiger(ctx, 'planning.view');
    } catch {
      throw inconnu();
    }
    await base.executer('UPDATE ical_jetons SET dernier_acces_le = ? WHERE id = ?', [iso(maintenant()), j.id]);
    return { nom: `planning-${ctx.team.slug}.ics`, type: 'text/calendar; charset=utf-8', contenu: await icsTeam(ctx) };
  }

  // -------------------------------------------------------------- Disponibilités

  const reglePublique = r => ({ id: r.id, jour: Number(r.jour), debut: r.debut, fin: r.fin, type: r.type, fuseau: r.fuseau });
  const exceptionPublique = (x, fuseau) => {
    const d = local(fuseau, Date.parse(x.debut));
    const f = local(fuseau, Date.parse(x.fin));
    return { id: x.id, debut: x.debut, fin: x.fin, type: x.type, note: x.note, jour: d.jour, heureDebut: d.heure, jourFin: f.jour, heureFin: f.heure };
  };

  /** Créneaux saisis (modèle ou semaine) : `[{ jour, debut, fin, type }]` validés, 60 au plus. */
  function lireRegles(regles) {
    if (!Array.isArray(regles) || regles.length > 60) throw echec(400, 'regles', 'Liste de créneaux illisible (60 au plus).');
    return regles.map(r => {
      const jour = Number(r?.jour);
      const debut = lireHeure(r?.debut);
      const fin = lireHeure(r?.fin);
      if (!Number.isInteger(jour) || jour < 1 || jour > 7) throw echec(400, 'jour', 'Jour : 1 (lundi) à 7 (dimanche).');
      if (debut === undefined || fin === undefined || debut >= 1440 || debut === fin) throw echec(400, 'heure', 'Créneau : heures HH:MM, début différent de la fin.');
      const type = r?.type ?? 'disponible';
      if (!TYPES_DISPO.includes(type)) throw echec(400, 'type', 'Type : disponible ou indisponible.');
      return { jour, debut: texteHeure(debut), fin: texteHeure(fin), type };
    });
  }

  /** Semaine personnalisée (ligne) → `{ semaine, regles (avec fuseau), version, ... }`. */
  const semainePublique = l => ({
    semaine: l.semaine,
    fuseau: l.fuseau,
    regles: jsonOu(l.regles, []).map(r => ({ jour: Number(r.jour), debut: r.debut, fin: r.fin, type: r.type, fuseau: l.fuseau })),
    version: Number(l.version),
    majLe: l.maj_le,
    majPar: l.maj_par ?? null,
  });
  const triRegles = l => [...l].sort((a, b) => a.jour - b.jour || a.debut.localeCompare(b.debut));
  /** Lundi de la semaine en cours dans le fuseau de la team. */
  const lundiCourant = ctx => texteDate(lundiDe(dateLocale(ctx.team.fuseau, maintenant())));

  async function mesDispos(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.edit_own');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const regles = await base.tous('SELECT * FROM dispo_regles WHERE team_id = ? AND compte_id = ? ORDER BY jour, debut', [teamId, acteur.compte]);
    const exceptions = await base.tous('SELECT * FROM dispo_exceptions WHERE team_id = ? AND compte_id = ? AND fin > ? ORDER BY debut', [teamId, acteur.compte, iso(maintenant() - JOUR_MS)]);
    // Semaine en cours (effective : personnalisée ou modèle) et semaines personnalisées à venir (bot, indicateurs).
    const courant = lundiCourant(ctx);
    const perso = (await base.tous('SELECT * FROM dispo_semaines WHERE team_id = ? AND compte_id = ? AND semaine >= ? ORDER BY semaine', [teamId, acteur.compte, courant])).map(semainePublique);
    const cette = perso.find(x => x.semaine === courant);
    return {
      fuseau,
      fuseauTeam: ctx.team.fuseau,
      regles: regles.map(reglePublique),
      exceptions: exceptions.map(x => exceptionPublique(x, fuseau)),
      semaine: { semaine: courant, personnalisee: Boolean(cette), regles: cette ? triRegles(cette.regles) : regles.map(reglePublique) },
      personnalisees: perso.map(x => x.semaine),
      droits: droits(ctx),
    };
  }

  async function remplacerRegles(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.edit_own');
    if (!ctx.membre) throw echec(403, 'non-membre', 'Seuls les membres de la team saisissent leurs disponibilités.');
    const fuseau = corps?.fuseau ?? ctx.team.fuseau;
    if (!fuseauValide(fuseau)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
    const propres = lireRegles(corps?.regles);
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM dispo_regles WHERE team_id = ? AND compte_id = ?', params: [teamId, acteur.compte] },
      ...propres.map(r => ({
        sql: 'INSERT INTO dispo_regles (id, team_id, compte_id, jour, debut, fin, type, fuseau, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [nouvelId(), teamId, acteur.compte, r.jour, r.debut, r.fin, r.type, fuseau, iso(t)],
      })),
      evenement('availability.updated', { teamId, acteur: acteur.compte, entiteType: 'dispos', entiteId: acteur.compte, charge: { regles: propres.length }, maintenant: t }),
    ]);
    return mesDispos(acteur, teamId, { fuseau });
  }

  async function ajouterException(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.edit_own');
    if (!ctx.membre) throw echec(403, 'non-membre', 'Seuls les membres de la team saisissent leurs disponibilités.');
    const c = lireCreneau(corps, ctx.team.fuseau);
    const type = corps?.type ?? 'indisponible';
    if (!TYPES_DISPO.includes(type)) throw echec(400, 'type', 'Type : disponible ou indisponible.');
    const n = await base.premier('SELECT COUNT(*) AS n FROM dispo_exceptions WHERE team_id = ? AND compte_id = ? AND fin > ?', [teamId, acteur.compte, iso(maintenant())]);
    if (Number(n?.n ?? 0) >= 200) throw echec(409, 'trop-d-exceptions', 'Deux cents exceptions à venir au plus.');
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      {
        sql: 'INSERT INTO dispo_exceptions (id, team_id, compte_id, debut, fin, type, note, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, teamId, acteur.compte, iso(c.debut), iso(c.fin), type, texteNettoye(corps?.note, 120), iso(t)],
      },
      evenement('availability.updated', { teamId, acteur: acteur.compte, entiteType: 'dispos', entiteId: acteur.compte, charge: { exception: type }, maintenant: t }),
    ]);
    return mesDispos(acteur, teamId, { fuseau: corps?.fuseau });
  }

  async function supprimerException(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.edit_own');
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'exception-introuvable', 'Exception introuvable.');
    const r = await base.executer('DELETE FROM dispo_exceptions WHERE id = ? AND team_id = ? AND compte_id = ?', [id, teamId, acteur.compte]);
    if (r.changements === 0) throw echec(404, 'exception-introuvable', 'Exception introuvable.');
    return mesDispos(acteur, teamId);
  }

  // -------------------------------------------------------------- Disponibilités semaine par semaine (migration 0062)

  /**
   * Qui est visé : `moi` (ou son propre compte) → availability.edit_own ; un autre membre → lecture des
   * disponibilités de la team ET planning.update (staff qui tient le planning). La cible doit être un membre
   * actif qui saisit ses disponibilités. Rend `{ ctx, cible: { compte, pseudo }, soi }`.
   */
  async function cibleSemaine(acteur, teamId, qui, { ecriture = false } = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    const soi = qui === undefined || qui === 'moi' || qui === acteur.compte;
    if (soi) {
      exiger(ctx, 'availability.edit_own');
      if (ecriture && !ctx.membre) throw echec(403, 'non-membre', 'Seuls les membres de la team saisissent leurs disponibilités.');
      return { ctx, soi, cible: { compte: acteur.compte, pseudo: null } };
    }
    exiger(ctx, 'availability.view_all');
    if (!peut(ctx, 'planning.update')) throw echec(403, 'dispos-autrui', 'Seul le staff qui gère le planning modifie les disponibilités d’un autre membre.');
    if (typeof qui !== 'string' || !MOTIF_COMPTE.test(qui)) throw echec(404, 'membre-introuvable', 'Membre introuvable.');
    const m = (await membresActifs(teamId)).find(x => x.compte === qui && x.a('availability.edit_own'));
    if (!m) throw echec(404, 'membre-introuvable', 'Membre introuvable.');
    return { ctx, soi, cible: { compte: m.compte, pseudo: m.pseudo } };
  }

  /** Lundi d'une semaine demandée (`AAAA-MM-JJ`, n'importe quel jour de la semaine) ; la semaine en cours par défaut. */
  function lireSemaine(ctx, texte) {
    if (texte === undefined || texte === '') return lundiCourant(ctx);
    const d = lireDate(texte);
    if (!d) throw echec(400, 'semaine', 'Semaine invalide (AAAA-MM-JJ).');
    return texteDate(lundiDe(d));
  }

  /** On ne réécrit ni une semaine finie, ni une semaine à plus d'un an. */
  function semaineModifiable(ctx, semaine) {
    const courant = lundiCourant(ctx);
    if (semaine < courant) return false;
    return ecartJours(lireDate(courant), lireDate(semaine)) <= SEMAINES_MAX_AVANCE * 7;
  }
  function exigerModifiable(ctx, semaine) {
    if (!semaineModifiable(ctx, semaine)) throw echec(400, 'semaine-hors-limites', `Seules la semaine en cours et les ${SEMAINES_MAX_AVANCE} suivantes se modifient.`);
  }

  async function modeleDe(teamId, compte) {
    return (await base.tous('SELECT * FROM dispo_regles WHERE team_id = ? AND compte_id = ? ORDER BY jour, debut', [teamId, compte])).map(reglePublique);
  }
  async function ligneSemaine(teamId, compte, semaine) {
    return base.premier('SELECT * FROM dispo_semaines WHERE team_id = ? AND compte_id = ? AND semaine = ?', [teamId, compte, semaine]);
  }
  /** Règles effectives d'une semaine : la semaine personnalisée, sinon le modèle. */
  async function effectiveDe(teamId, compte, semaine, modele) {
    const l = await ligneSemaine(teamId, compte, semaine);
    return l ? { personnalisee: true, ...semainePublique(l) } : { personnalisee: false, semaine, regles: modele, version: 0 };
  }

  function exigerVersion(corps, actuelle) {
    const v = corps?.versionAttendue;
    if (v !== undefined && v !== null && Number(v) !== Number(actuelle)) throw echec(409, 'version', 'Cette semaine a été modifiée entre-temps (autre appareil ou membre du staff) : rechargez-la.');
  }

  async function semaineDispos(acteur, teamId, qui, params = {}) {
    const { ctx, cible, soi } = await cibleSemaine(acteur, teamId, qui);
    const semaine = lireSemaine(ctx, params.semaine);
    const modele = await modeleDe(teamId, cible.compte);
    const eff = await effectiveDe(teamId, cible.compte, semaine, modele);
    const prec = await effectiveDe(teamId, cible.compte, texteDate(ajouterJours(lireDate(semaine), -7)), modele);
    const courant = lundiCourant(ctx);
    const depuis = semaine < courant ? semaine : courant;
    const perso = await base.tous('SELECT semaine FROM dispo_semaines WHERE team_id = ? AND compte_id = ? AND semaine >= ? ORDER BY semaine', [teamId, cible.compte, depuis]);
    const gereAutres = peut(ctx, 'availability.view_all') && peut(ctx, 'planning.update');
    const membres = gereAutres ? (await membresActifs(teamId)).filter(m => m.a('availability.edit_own')).map(m => ({ compte: m.compte, pseudo: m.pseudo })) : [];
    const majPar = eff.majPar ? (membres.find(m => m.compte === eff.majPar)?.pseudo ?? (await pseudosDe(base, [eff.majPar]))[eff.majPar] ?? null) : null;
    return {
      compte: cible.compte,
      pseudo: cible.pseudo ?? membres.find(m => m.compte === cible.compte)?.pseudo ?? null,
      soi,
      semaine,
      dimanche: texteDate(ajouterJours(lireDate(semaine), 6)),
      cetteSemaine: courant,
      personnalisee: eff.personnalisee,
      version: eff.version,
      fuseau: eff.personnalisee ? eff.fuseau : (modele[0]?.fuseau ?? ctx.team.fuseau),
      fuseauTeam: ctx.team.fuseau,
      regles: triRegles(eff.regles),
      modele,
      precedente: { semaine: prec.semaine, personnalisee: prec.personnalisee, regles: triRegles(prec.regles) },
      personnalisees: perso.map(l => l.semaine),
      majLe: eff.majLe ?? null,
      majPar,
      modifiable: semaineModifiable(ctx, semaine) && (soi ? Boolean(ctx.membre) : true),
      appliquerMax: APPLIQUER_MAX,
      membres,
      droits: droits(ctx),
    };
  }

  /** Écrit (ou remplace) la semaine personnalisée : lignes du lot. */
  function ecritureSemaine(teamId, compte, semaine, regles, fuseau, version, acteur, t) {
    const json = JSON.stringify(regles.map(r => ({ jour: r.jour, debut: r.debut, fin: r.fin, type: r.type })));
    return version
      ? { sql: 'UPDATE dispo_semaines SET regles = ?, fuseau = ?, version = ?, maj_le = ?, maj_par = ? WHERE team_id = ? AND compte_id = ? AND semaine = ? AND version = ?', params: [json, fuseau, version + 1, iso(t), acteur, teamId, compte, semaine, version] }
      : { sql: 'INSERT INTO dispo_semaines (team_id, compte_id, semaine, regles, fuseau, version, maj_le, maj_par) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', params: [teamId, compte, semaine, json, fuseau, iso(t), acteur] };
  }

  /** Lot d'écriture, refusé (409) si une autre écriture est passée entre la lecture et l'écriture. */
  async function lotSemaine(lignes) {
    let res;
    try {
      res = await base.lot(lignes);
    } catch (e) {
      if (/unique|primary|constraint/i.test(String(e?.message ?? e))) throw echec(409, 'version', 'Cette semaine a été modifiée entre-temps (autre appareil ou membre du staff) : rechargez-la.');
      throw e;
    }
    if (Array.isArray(res) && lignes.some((l, i) => l.sql.startsWith('UPDATE dispo_semaines') && res[i]?.changements === 0)) {
      throw echec(409, 'version', 'Cette semaine a été modifiée entre-temps (autre appareil ou membre du staff) : rechargez-la.');
    }
    return res;
  }

  /**
   * Personnalise une semaine : `regles` (liste, vide = indisponible toute la semaine) ou `copier` : « modele »
   * (copie du modèle, à retoucher) ou « precedente » (règles effectives de la semaine d'avant).
   * `versionAttendue` (facultatif) : 409 si la semaine a changé depuis la lecture (0 : pas encore personnalisée).
   */
  async function enregistrerSemaine(acteur, teamId, qui, semaineTexte, corps = {}) {
    const { ctx, cible } = await cibleSemaine(acteur, teamId, qui, { ecriture: true });
    const semaine = lireSemaine(ctx, semaineTexte);
    exigerModifiable(ctx, semaine);
    const modele = await modeleDe(teamId, cible.compte);
    const actuelle = await ligneSemaine(teamId, cible.compte, semaine);
    exigerVersion(corps, actuelle ? actuelle.version : 0);
    let regles;
    let fuseau;
    if (corps?.copier === 'modele') {
      regles = modele;
      fuseau = modele[0]?.fuseau ?? ctx.team.fuseau;
    } else if (corps?.copier === 'precedente') {
      const prec = await effectiveDe(teamId, cible.compte, texteDate(ajouterJours(lireDate(semaine), -7)), modele);
      regles = prec.regles;
      fuseau = prec.personnalisee ? prec.fuseau : (modele[0]?.fuseau ?? ctx.team.fuseau);
    } else if (corps?.copier !== undefined) {
      throw echec(400, 'copier', 'Copier : « modele » ou « precedente ».');
    } else {
      regles = lireRegles(corps?.regles);
      fuseau = corps?.fuseau ?? actuelle?.fuseau ?? modele[0]?.fuseau ?? ctx.team.fuseau;
    }
    if (!fuseauValide(fuseau)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
    const t = maintenant();
    await lotSemaine([
      ecritureSemaine(teamId, cible.compte, semaine, regles, fuseau, actuelle ? Number(actuelle.version) : 0, acteur.compte, t),
      evenement('availability.updated', { teamId, acteur: acteur.compte, entiteType: 'dispos', entiteId: cible.compte, charge: { semaine, regles: regles.length, ...(corps?.copier ? { copie: corps.copier } : {}) }, maintenant: t }),
    ]);
    return semaineDispos(acteur, teamId, qui, { semaine });
  }

  /** Revenir au modèle : la semaine personnalisée est effacée. */
  async function reinitialiserSemaine(acteur, teamId, qui, semaineTexte, params = {}) {
    const { ctx, cible } = await cibleSemaine(acteur, teamId, qui, { ecriture: true });
    const semaine = lireSemaine(ctx, semaineTexte);
    exigerModifiable(ctx, semaine);
    const actuelle = await ligneSemaine(teamId, cible.compte, semaine);
    exigerVersion({ versionAttendue: params.versionAttendue ?? params.version }, actuelle ? actuelle.version : 0);
    if (actuelle) {
      const t = maintenant();
      await base.lot([
        { sql: 'DELETE FROM dispo_semaines WHERE team_id = ? AND compte_id = ? AND semaine = ?', params: [teamId, cible.compte, semaine] },
        evenement('availability.updated', { teamId, acteur: acteur.compte, entiteType: 'dispos', entiteId: cible.compte, charge: { semaine, reinitialisee: true }, maintenant: t }),
      ]);
    }
    return semaineDispos(acteur, teamId, qui, { semaine });
  }

  /** « Appliquer aux N semaines suivantes » : les règles effectives de cette semaine, copiées sur les N suivantes. */
  async function appliquerSemaine(acteur, teamId, qui, semaineTexte, corps = {}) {
    const { ctx, cible } = await cibleSemaine(acteur, teamId, qui, { ecriture: true });
    const semaine = lireSemaine(ctx, semaineTexte);
    const n = Number(corps?.semaines);
    if (!Number.isInteger(n) || n < 1 || n > APPLIQUER_MAX) throw echec(400, 'semaines', `Nombre de semaines : 1 à ${APPLIQUER_MAX}.`);
    exigerModifiable(ctx, semaine);
    const derniere = texteDate(ajouterJours(lireDate(semaine), 7 * n));
    exigerModifiable(ctx, derniere);
    const modele = await modeleDe(teamId, cible.compte);
    const source = await effectiveDe(teamId, cible.compte, semaine, modele);
    const fuseau = source.personnalisee ? source.fuseau : (modele[0]?.fuseau ?? ctx.team.fuseau);
    const existantes = new Map((await base.tous('SELECT semaine, version FROM dispo_semaines WHERE team_id = ? AND compte_id = ? AND semaine > ? AND semaine <= ?', [teamId, cible.compte, semaine, derniere])).map(l => [l.semaine, Number(l.version)]));
    const t = maintenant();
    const lignes = [];
    for (let i = 1; i <= n; i++) {
      const s = texteDate(ajouterJours(lireDate(semaine), 7 * i));
      lignes.push(ecritureSemaine(teamId, cible.compte, s, source.regles, fuseau, existantes.get(s) ?? 0, acteur.compte, t));
    }
    lignes.push(evenement('availability.updated', { teamId, acteur: acteur.compte, entiteType: 'dispos', entiteId: cible.compte, charge: { semaine, appliquee: n }, maintenant: t }));
    await lotSemaine(lignes);
    return semaineDispos(acteur, teamId, qui, { semaine });
  }

  async function carte(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.view_all');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const pas = Number(params.pas ?? 60);
    if (!PAS_AUTORISES.includes(pas)) throw echec(400, 'pas', 'Pas : 30 ou 60 minutes.');
    const jour = params.semaine ? lireDate(params.semaine) : dateLocale(fuseau, maintenant());
    if (!jour) throw echec(400, 'semaine', 'Semaine invalide (AAAA-MM-JJ).');
    const lundi = lundiDe(jour);
    const du = instantMural(fuseau, lundi, 0) - JOUR_MS;
    const au = instantMural(fuseau, ajouterJours(lundi, 7), 0) + JOUR_MS;
    const membres = (await membresActifs(teamId)).filter(m => m.a('availability.edit_own'));
    const regles = await base.tous('SELECT * FROM dispo_regles WHERE team_id = ?', [teamId]);
    const exceptions = await base.tous('SELECT * FROM dispo_exceptions WHERE team_id = ? AND fin > ? AND debut < ?', [teamId, iso(du), iso(au)]);
    // Semaines personnalisées autour de la semaine affichée (le fuseau d'un membre peut décaler la semaine d'un jour).
    const semaines = await base.tous('SELECT * FROM dispo_semaines WHERE team_id = ? AND semaine >= ? AND semaine <= ?', [teamId, texteDate(ajouterJours(lundi, -14)), texteDate(ajouterJours(lundi, 14))]);
    const joueurs = membres.map(m => ({
      compte: m.compte,
      regles: regles.filter(r => r.compte_id === m.compte),
      semaines: semaines.filter(x => x.compte_id === m.compte).map(semainePublique),
      exceptions: exceptions.filter(x => x.compte_id === m.compte),
    }));
    const lundiTexte = texteDate(lundi);
    const { effectifMin } = await reglages(teamId);
    const h = heatmap({ lundi, fuseau, pas, joueurs, seuil: effectifMin });
    return {
      fuseau,
      fuseauTeam: ctx.team.fuseau,
      pas,
      seuil: effectifMin,
      total: membres.length,
      renseignes: joueurs.filter(j => j.regles.length + j.exceptions.length + j.semaines.length > 0).length,
      // Membres dont CETTE semaine est personnalisée (le reste suit le modèle).
      personnalisees: joueurs.filter(j => j.semaines.some(x => x.semaine === lundiTexte)).map(j => j.compte),
      noms: Object.fromEntries(membres.map(m => [m.compte, m.pseudo])),
      ...h,
      plages: plagesPropices(h).map(pl => ({ ...pl, heureDebut: local(fuseau, Date.parse(pl.debut)).heure, heureFin: local(fuseau, Date.parse(pl.fin)).heure })),
      droits: droits(ctx),
    };
  }

  return {
    liste,
    detail,
    creer,
    modifier,
    modifierOccurrence,
    supprimer,
    lireReglages,
    changerReglages,
    accueil,
    repondre,
    presenceOccurrence,
    marquer,
    stats,
    aMarquer,
    historique,
    fichePresence,
    exportCsv,
    exportIcs,
    jetonsIcal,
    creerJetonIcal,
    revoquerJetonIcal,
    icsAbonnement,
    mesDispos,
    remplacerRegles,
    ajouterException,
    supprimerException,
    semaineDispos,
    enregistrerSemaine,
    reinitialiserSemaine,
    appliquerSemaine,
    carte,
    // Pour le cron (rappels) :
    membresActifs,
    roster,
    reglages,
    occurrencesTeam,
  };
}

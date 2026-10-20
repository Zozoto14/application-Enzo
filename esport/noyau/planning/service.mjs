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
import { heatmap, plagesPropices, TYPES_DISPO, PAS_AUTORISES } from './dispos.mjs';
import { calendrierIcs, LIBELLES_TYPES } from './ical.mjs';
import { RSVP, REELS, csv, statistiques } from './presence.mjs';
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
export const REGLAGES_DEFAUT = { effectifMin: 5, rappelHeures: 24 };

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
    };
  }

  /** Membres actifs et leurs permissions (Propriétaire : toutes). */
  async function membresActifs(teamId) {
    const lignes = await base.tous(
      `SELECT m.compte_id, r.cle_systeme, rp.permission, c.pseudo FROM membres m
         JOIN roles r ON r.id = m.role_id
         JOIN comptes c ON c.id = m.compte_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.team_id = ? AND m.statut = 'actif'`,
      [teamId],
    );
    const parCompte = new Map();
    for (const l of lignes) {
      if (!parCompte.has(l.compte_id)) parCompte.set(l.compte_id, { compte: l.compte_id, pseudo: l.pseudo, proprietaire: l.cle_systeme === CLE_PROPRIETAIRE, perms: new Set() });
      if (l.permission) parCompte.get(l.compte_id).perms.add(l.permission);
    }
    const a = (m, p) => m.proprietaire || m.perms.has(p);
    return [...parCompte.values()].map(m => ({ ...m, a: p => a(m, p) })).sort((x, y) => x.pseudo.localeCompare(y.pseudo, 'fr'));
  }

  /**
   * Liste de présence d'une occurrence : les membres nommés par l'événement,
   * sinon les membres qui répondent (attendance.rsvp_own) sans marquer
   * (attendance.mark : le staff), plus quiconque a déjà une ligne.
   */
  function roster(membres, ev, dejaLa = []) {
    const liste = jsonOu(ev.concernes, []);
    const choisis = liste.length > 0 ? membres.filter(m => liste.includes(m.compte)) : membres.filter(m => m.a('attendance.rsvp_own') && !m.a('attendance.mark'));
    const comptes = new Set(choisis.map(m => m.compte));
    for (const c of dejaLa) {
      const m = membres.find(x => x.compte === c);
      if (m && !comptes.has(c)) {
        choisis.push(m);
        comptes.add(c);
      }
    }
    return choisis;
  }

  const estConcerne = (ev, compte) => {
    const liste = jsonOu(ev.concernes, []);
    return liste.length === 0 || liste.includes(compte);
  };

  async function evenementDeTeam(teamId, id) {
    if (typeof id !== 'string' || !MOTIF_UUID.test(id)) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    const ev = await base.premier('SELECT * FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!ev) throw echec(404, 'evenement-introuvable', 'Événement introuvable.');
    return ev;
  }

  async function exceptionsDe(ids) {
    const parEv = new Map(ids.map(id => [id, new Map()]));
    for (const id of ids) {
      for (const x of await base.tous('SELECT * FROM planning_exceptions WHERE evenement_id = ?', [id])) parEv.get(id).set(x.occurrence, x);
    }
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

  const occurrencePublique = (ev, o, fuseau, extra = {}) => {
    const d = local(fuseau, o.debut);
    const f = local(fuseau, o.fin);
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
      concernes: jsonOu(ev.concernes, []),
      ...extra,
    };
  };

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
    const membre = params.membre && MOTIF_COMPTE.test(params.membre) ? params.membre : null;
    let toutes = await occurrencesTeam(teamId, du, au);
    if (types.length) toutes = toutes.filter(({ ev }) => types.includes(ev.type));
    if (membre) toutes = toutes.filter(({ ev }) => estConcerne(ev, membre));
    const presenceActive = ctx.modules.has('attendance');
    const lignes = presenceActive
      ? await base.tous('SELECT evenement_id, occurrence, compte_id, rsvp, reel FROM presences WHERE team_id = ? AND occurrence >= ? AND occurrence < ?', [teamId, iso(du - MARGE_MS), iso(au + MARGE_MS)])
      : [];
    const voirTout = peut(ctx, 'attendance.view_all');
    const resultat = toutes.map(({ ev, o }) => {
      const miennes = lignes.filter(l => l.evenement_id === ev.id && l.occurrence === o.cle);
      const moi = miennes.find(l => l.compte_id === acteur.compte);
      const compte = r => miennes.filter(l => l.rsvp === r).length;
      return occurrencePublique(ev, o, fuseau, {
        concerneMoi: estConcerne(ev, acteur.compte),
        monRsvp: presenceActive ? (moi?.rsvp ?? 'sans_reponse') : null,
        maPresence: presenceActive ? (moi?.reel ?? 'inconnu') : null,
        reponses: presenceActive && voirTout ? { oui: compte('oui'), non: compte('non'), peut_etre: compte('peut_etre') } : null,
        termine: o.fin <= maintenant(),
      });
    });
    return { fuseau, fuseauTeam: ctx.team.fuseau, du: iso(du), au: iso(au), occurrences: resultat, droits: droits(ctx), modules: { presence: presenceActive, dispos: ctx.modules.has('availability') } };
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
      concernes: jsonOu(ev.concernes, []),
      creePar: ev.cree_par,
      creeLe: ev.cree_le,
      majLe: ev.maj_le,
      exceptions: (await base.tous('SELECT occurrence, annulee, titre, debut, fin FROM planning_exceptions WHERE evenement_id = ? ORDER BY occurrence', [ev.id])).map(x => ({
        occurrence: x.occurrence,
        annulee: Number(x.annulee) === 1,
        titre: x.titre ?? null,
        debut: x.debut ?? null,
        fin: x.fin ?? null,
      })),
      droits: droits(ctx),
    };
  }

  // -------------------------------------------------------------- Planning : écriture

  async function lireConcernes(teamId, valeur) {
    if (valeur === undefined || valeur === null) return [];
    if (!Array.isArray(valeur) || valeur.length > 50) throw echec(400, 'concernes', 'Liste de membres illisible.');
    const membres = new Set((await base.tous("SELECT compte_id FROM membres WHERE team_id = ? AND statut = 'actif'", [teamId])).map(l => l.compte_id));
    const liste = [...new Set(valeur)];
    if (!liste.every(c => typeof c === 'string' && membres.has(c))) throw echec(400, 'concernes', 'Un membre choisi ne fait pas partie de la team.');
    return liste.sort();
  }

  async function lireSaisie(ctx, corps, existant) {
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
    if (champ('adversaireId')) s.adversaire_id = uuidOuNull(corps.adversaireId, 'adversaire');
    if (champ('reviewId')) s.review_id = uuidOuNull(corps.reviewId, 'review');
    if (champ('concernes')) s.concernes = JSON.stringify(await lireConcernes(ctx.team.id, corps.concernes));
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

  async function creer(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.create');
    const s = await lireSaisie(ctx, corps);
    const t = maintenant();
    const id = nouvelId();
    const concernes = jsonOu(s.concernes, []);
    await base.lot([
      {
        sql: `INSERT INTO planning_evenements (id, team_id, type, titre, description, debut, fin, fuseau, lieu, adversaire_id, review_id, recurrence, fin_serie, concernes, cree_par, cree_le, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, teamId, s.type, s.titre, s.description ?? '', s.debut, s.fin, s.fuseau, s.lieu ?? '', s.adversaire_id ?? null, s.review_id ?? null, s.recurrence, s.fin_serie, s.concernes ?? '[]', acteur.compte, iso(t), iso(t)],
      },
      evenement('event.created', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: id, charge: { titre: s.titre, type: s.type, debut: s.debut, recurrent: Boolean(s.recurrence), concernes }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  /** Modifie toute la série (ou l'événement simple). Horaire ou règle changés : les exceptions de la série tombent. */
  async function modifier(acteur, teamId, evId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.update');
    const ev = await evenementDeTeam(teamId, evId);
    const s = await lireSaisie(ctx, corps, ev);
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
        charge: { titre: s.titre ?? ev.titre, type: s.type ?? ev.type, debut: s.debut ?? ev.debut, champs, concernes: jsonOu(s.concernes ?? ev.concernes, []) },
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
    if (['date', 'heureDebut', 'heureFin', 'debut', 'fin'].some(c => corps?.[c] !== undefined)) {
      const c = lireCreneau(corps, ev.fuseau);
      if (Math.abs(c.debut - Date.parse(o.cle)) > DEPLACEMENT_MAX_MS) throw echec(400, 'deplacement', 'Une occurrence se déplace de 30 jours au plus.');
      debut = iso(c.debut);
      fin = iso(c.fin);
    }
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO planning_exceptions (evenement_id, occurrence, team_id, annulee, titre, description, debut, fin, lieu, maj_par, maj_le) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (evenement_id, occurrence) DO UPDATE SET annulee = 0, titre = excluded.titre, description = excluded.description, debut = excluded.debut, fin = excluded.fin, lieu = excluded.lieu, maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
        params: [evId, o.cle, teamId, titre, description, debut, fin, lieu, acteur.compte, iso(t)],
      },
      evenement('event.occurrence_updated', {
        teamId,
        acteur: acteur.compte,
        entiteType: 'evenement',
        entiteId: evId,
        charge: { titre: titre ?? ev.titre, type: ev.type, occurrence: o.cle, debut: debut ?? o.cle, concernes: jsonOu(ev.concernes, []) },
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
    const charge = { titre: ev.titre, type: ev.type, debut: ev.debut, concernes: jsonOu(ev.concernes, []) };
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
    const t = maintenant();
    const config = async module => jsonOu((await base.premier('SELECT config FROM team_modules WHERE team_id = ? AND module = ?', [teamId, module]))?.config, {});
    const ecrire = (module, valeur) => ({
      sql: `INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, ?, 0, ?, ?)
            ON CONFLICT (team_id, module) DO UPDATE SET config = excluded.config, maj_le = excluded.maj_le`,
      params: [teamId, module, JSON.stringify(valeur), iso(t)],
    });
    await base.lot([
      ecrire('availability', { ...(await config('availability')), effectifMin: nouveaux.effectifMin }),
      ecrire('attendance', { ...(await config('attendance')), rappelHeures: nouveaux.rappelHeures }),
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
    const lignes = presenceActive ? await base.tous('SELECT evenement_id, occurrence, compte_id, rsvp, reel FROM presences WHERE team_id = ? AND occurrence >= ?', [teamId, iso(t - 15 * JOUR_MS - MARGE_MS)]) : [];
    const de = (ev, o) => lignes.filter(l => l.evenement_id === ev.id && l.occurrence === o.cle);
    const prochains = a
      .filter(({ ev, o }) => o.fin > t && estConcerne(ev, acteur.compte))
      .slice(0, 6)
      .map(({ ev, o }) => {
        const moi = de(ev, o).find(l => l.compte_id === acteur.compte);
        return occurrencePublique(ev, o, fuseau, { monRsvp: presenceActive ? (moi?.rsvp ?? 'sans_reponse') : null });
      });
    const alertes = [];
    if (presenceActive && peut(ctx, 'attendance.rsvp_own')) {
      for (const { ev, o } of a) {
        if (o.debut <= t || o.debut > t + 7 * JOUR_MS || !estConcerne(ev, acteur.compte)) continue;
        const moi = de(ev, o).find(l => l.compte_id === acteur.compte);
        if ((!moi || moi.rsvp === 'sans_reponse') && (jsonOu(ev.concernes, []).length > 0 || !peut(ctx, 'attendance.mark'))) {
          alertes.push({ genre: 'rsvp', ...occurrencePublique(ev, o, fuseau) });
        }
      }
    }
    if (presenceActive && (peut(ctx, 'attendance.mark') || peut(ctx, 'attendance.view_all'))) {
      const membres = await membresActifs(teamId);
      for (const { ev, o } of a) {
        const deja = de(ev, o);
        const liste = roster(membres, ev, deja.map(l => l.compte_id));
        if (o.fin <= t && peut(ctx, 'attendance.mark')) {
          const nonMarques = liste.filter(m => !deja.some(l => l.compte_id === m.compte && l.reel !== 'inconnu')).length;
          if (nonMarques > 0) alertes.push({ genre: 'a-marquer', nonMarques, ...occurrencePublique(ev, o, fuseau) });
        } else if (o.debut > t && o.debut <= t + 3 * JOUR_MS) {
          const sansReponse = liste.filter(m => !deja.some(l => l.compte_id === m.compte && l.rsvp !== 'sans_reponse')).length;
          if (sansReponse > 0) alertes.push({ genre: 'sans-reponse', sansReponse, ...occurrencePublique(ev, o, fuseau) });
        }
      }
    }
    return { fuseau, prochains, alertes: alertes.slice(0, 12), droits: droits(ctx), modules: { presence: presenceActive } };
  }

  // -------------------------------------------------------------- Présence

  async function repondre(acteur, teamId, evId, cle, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    exiger(ctx, 'attendance.rsvp_own');
    const ev = await evenementDeTeam(teamId, evId);
    if (!estConcerne(ev, acteur.compte)) throw echec(403, 'non-concerne', 'Cet événement ne vous concerne pas.');
    if (!ctx.membre) throw echec(403, 'non-membre', 'Seuls les membres de la team répondent.');
    const o = await occurrenceDe(ev, cle);
    if (o.fin <= maintenant()) throw echec(409, 'termine', 'Cet événement est terminé : la présence est marquée par le staff.');
    const rsvp = corps?.rsvp;
    if (!RSVP.includes(rsvp)) throw echec(400, 'rsvp', 'Réponse : oui, non ou peut-être.');
    const note = corps?.note !== undefined ? texteNettoye(corps.note, 200) : null;
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, rsvp, note, rsvp_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (evenement_id, occurrence, compte_id) DO UPDATE SET rsvp = excluded.rsvp, note = COALESCE(?, presences.note), rsvp_le = excluded.rsvp_le, maj_le = excluded.maj_le`,
        params: [evId, o.cle, acteur.compte, teamId, rsvp, note ?? '', iso(t), iso(t), note],
      },
      evenement('attendance.rsvp', { teamId, acteur: acteur.compte, entiteType: 'evenement', entiteId: evId, charge: { titre: o.titre, occurrence: o.cle, rsvp }, maintenant: t }),
    ]);
    return { ok: true, rsvp };
  }

  async function presenceOccurrence(acteur, teamId, evId, cle) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    if (!peut(ctx, 'attendance.view_all')) exiger(ctx, 'attendance.rsvp_own');
    const ev = await evenementDeTeam(teamId, evId);
    const o = await occurrenceDe(ev, cle);
    const lignes = await base.tous('SELECT * FROM presences WHERE evenement_id = ? AND occurrence = ?', [evId, o.cle]);
    const membres = await membresActifs(teamId);
    let liste = roster(membres, ev, lignes.map(l => l.compte_id));
    if (!peut(ctx, 'attendance.view_all')) liste = liste.filter(m => m.compte === acteur.compte);
    return {
      occurrence: occurrencePublique(ev, o, ctx.team.fuseau),
      lignes: liste.map(m => {
        const l = lignes.find(x => x.compte_id === m.compte);
        return { compte: m.compte, pseudo: m.pseudo, rsvp: l?.rsvp ?? 'sans_reponse', reel: l?.reel ?? 'inconnu', note: l?.note ?? '', marqueLe: l?.marque_le ?? null };
      }),
      droits: droits(ctx),
    };
  }

  async function marquer(acteur, teamId, evId, cle, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'planning.view');
    exiger(ctx, 'attendance.mark');
    const ev = await evenementDeTeam(teamId, evId);
    const o = await occurrenceDe(ev, cle);
    const marques = corps?.marques;
    if (!Array.isArray(marques) || marques.length === 0 || marques.length > 60) throw echec(400, 'marques', 'Liste de présences illisible.');
    const membres = new Set((await base.tous('SELECT compte_id FROM membres WHERE team_id = ?', [teamId])).map(l => l.compte_id));
    const t = maintenant();
    const lot = [];
    for (const m of marques) {
      if (typeof m?.compte !== 'string' || !membres.has(m.compte)) throw echec(400, 'compte', 'Un des joueurs ne fait pas partie de la team.');
      if (!REELS.includes(m.reel)) throw echec(400, 'reel', 'Présence : présent, absent, excusé, en retard ou inconnu.');
      const note = m.note !== undefined ? texteNettoye(m.note, 200) : null;
      lot.push({
        sql: `INSERT INTO presences (evenement_id, occurrence, compte_id, team_id, reel, note, marque_par, marque_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (evenement_id, occurrence, compte_id) DO UPDATE SET reel = excluded.reel, note = COALESCE(?, presences.note), marque_par = excluded.marque_par, marque_le = excluded.marque_le, maj_le = excluded.maj_le`,
        params: [evId, o.cle, m.compte, teamId, m.reel, note ?? '', acteur.compte, iso(t), iso(t), note],
      });
    }
    lot.push(
      evenement('attendance.marked', {
        teamId,
        acteur: acteur.compte,
        entiteType: 'evenement',
        entiteId: evId,
        charge: { titre: o.titre, occurrence: o.cle, marques: marques.map(m => ({ compte: m.compte, reel: m.reel })) },
        maintenant: t,
      }),
    );
    await base.lot(lot);
    return presenceOccurrence(acteur, teamId, evId, o.cle);
  }

  /** Lignes de présence de la team sur une plage, avec le type et le titre de l'événement. */
  async function lignesPresence(teamId, du, au, { types, compte } = {}) {
    const conditions = ['p.team_id = ?', 'p.occurrence >= ?', 'p.occurrence < ?'];
    const params = [teamId, iso(du), iso(au)];
    if (compte) {
      conditions.push('p.compte_id = ?');
      params.push(compte);
    }
    const lignes = await base.tous(
      `SELECT p.*, e.type, e.titre, c.pseudo FROM presences p
         JOIN planning_evenements e ON e.id = p.evenement_id
         LEFT JOIN comptes c ON c.id = p.compte_id
        WHERE ${conditions.join(' AND ')} ORDER BY p.occurrence, c.pseudo_cle`,
      params,
    );
    return types?.length ? lignes.filter(l => types.includes(l.type)) : lignes;
  }

  function lirePeriode(params, fuseau) {
    const p = { ...params };
    if (!p.debut && !p.fin) {
      const auj = dateLocale(fuseau, maintenant());
      p.debut = texteDate(ajouterJours(auj, -90));
      p.fin = texteDate(ajouterJours(auj, 1));
    }
    const d = lireDate(p.debut);
    const f = lireDate(p.fin);
    if (!d || !f || ecartJours(d, f) < 1 || ecartJours(d, f) > 731) throw echec(400, 'plage', 'Période de 1 jour à 2 ans (AAAA-MM-JJ).');
    return { du: instantMural(fuseau, d, 0), au: instantMural(fuseau, f, 0), debut: texteDate(d), fin: texteDate(f) };
  }

  async function stats(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    const tout = peut(ctx, 'attendance.view_all');
    if (!tout) exiger(ctx, 'attendance.rsvp_own');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const { du, au, debut, fin } = lirePeriode(params, fuseau);
    const types = params.types ? String(params.types).split(',').filter(t => TYPES_EVENEMENT.includes(t)) : [];
    const lignes = await lignesPresence(teamId, du, au, { types, compte: tout ? null : acteur.compte });
    const s = statistiques(
      lignes.map(l => ({ compte: l.compte_id, type: l.type, debut: Date.parse(l.occurrence), rsvp: l.rsvp, reel: l.reel })),
      { fuseau, granularite: params.granularite === 'semaine' ? 'semaine' : 'mois' },
    );
    const noms = {};
    for (const l of lignes) noms[l.compte_id] = l.pseudo ?? null;
    s.joueurs.sort((a, b) => (noms[a.compte] ?? '').localeCompare(noms[b.compte] ?? '', 'fr'));
    return { debut, fin, fuseau, tout, noms, ...s };
  }

  async function exportCsv(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'attendance.view_all');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const { du, au, debut, fin } = lirePeriode(params, fuseau);
    const lignes = await lignesPresence(teamId, du, au);
    const R = { oui: 'Oui', non: 'Non', peut_etre: 'Peut-être', sans_reponse: 'Sans réponse' };
    const P = { present: 'Présent', absent: 'Absent', excuse: 'Excusé', retard: 'En retard', inconnu: 'Non marqué' };
    const contenu = csv(
      ['Date', 'Heure', 'Événement', 'Type', 'Joueur', 'Réponse', 'Présence', 'Note'],
      lignes.map(l => {
        const d = local(fuseau, Date.parse(l.occurrence));
        return [d.jour, d.heure, l.titre, LIBELLES_TYPES[l.type] ?? l.type, l.pseudo ?? l.compte_id, R[l.rsvp] ?? l.rsvp, P[l.reel] ?? l.reel, l.note];
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

  async function mesDispos(acteur, teamId, params = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.edit_own');
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : ctx.team.fuseau;
    const regles = await base.tous('SELECT * FROM dispo_regles WHERE team_id = ? AND compte_id = ? ORDER BY jour, debut', [teamId, acteur.compte]);
    const exceptions = await base.tous('SELECT * FROM dispo_exceptions WHERE team_id = ? AND compte_id = ? AND fin > ? ORDER BY debut', [teamId, acteur.compte, iso(maintenant() - JOUR_MS)]);
    return { fuseau, fuseauTeam: ctx.team.fuseau, regles: regles.map(reglePublique), exceptions: exceptions.map(x => exceptionPublique(x, fuseau)), droits: droits(ctx) };
  }

  async function remplacerRegles(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'availability.edit_own');
    if (!ctx.membre) throw echec(403, 'non-membre', 'Seuls les membres de la team saisissent leurs disponibilités.');
    const fuseau = corps?.fuseau ?? ctx.team.fuseau;
    if (!fuseauValide(fuseau)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
    const regles = corps?.regles;
    if (!Array.isArray(regles) || regles.length > 60) throw echec(400, 'regles', 'Liste de créneaux illisible (60 au plus).');
    const propres = regles.map(r => {
      const jour = Number(r?.jour);
      const debut = lireHeure(r?.debut);
      const fin = lireHeure(r?.fin);
      if (!Number.isInteger(jour) || jour < 1 || jour > 7) throw echec(400, 'jour', 'Jour : 1 (lundi) à 7 (dimanche).');
      if (debut === undefined || fin === undefined || debut >= 1440 || debut === fin) throw echec(400, 'heure', 'Créneau : heures HH:MM, début différent de la fin.');
      const type = r?.type ?? 'disponible';
      if (!TYPES_DISPO.includes(type)) throw echec(400, 'type', 'Type : disponible ou indisponible.');
      return { jour, debut: texteHeure(debut), fin: texteHeure(fin), type };
    });
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
    const joueurs = membres.map(m => ({ compte: m.compte, regles: regles.filter(r => r.compte_id === m.compte), exceptions: exceptions.filter(x => x.compte_id === m.compte) }));
    const { effectifMin } = await reglages(teamId);
    const h = heatmap({ lundi, fuseau, pas, joueurs, seuil: effectifMin });
    return {
      fuseau,
      fuseauTeam: ctx.team.fuseau,
      pas,
      seuil: effectifMin,
      total: membres.length,
      renseignes: joueurs.filter(j => j.regles.length + j.exceptions.length > 0).length,
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
    carte,
    // Pour le cron (rappels) :
    membresActifs,
    roster,
    reglages,
    occurrencesTeam,
  };
}

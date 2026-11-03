/**
 * Réunions de l'équipe CM, « comme Teams » (migration 0039, docs/esport/cm-reunions.md) : agenda de l'équipe,
 * réponses des participants, disponibilités de chacun et statut du moment, « Trouver un créneau », rendez-vous
 * réservables, notes de réunion (confidentielles) et tâches de suivi, abonnement iCal.
 *
 * Droits (`droitsReunions`) :
 *  - `cm.reunions.voir` (toute l'équipe CM par défaut : Responsable et Correspondant CM) : voir l'agenda de l'équipe
 *    (réunions ; les rendez-vous restent à leurs deux personnes), les disponibilités et statuts de l'équipe, créer
 *    ses réunions, proposer et réserver des rendez-vous ;
 *  - `cm.reunions.gerer` (Responsable CM) : modifier et annuler toutes les réunions, en lire les notes ;
 *  - le Fondateur a tout ; un autre membre du club INVITÉ voit les réunions où il est invité, y répond et en lit
 *    les notes (rien d'autre).
 * Modifier, annuler : l'organisateur ou `cm.reunions.gerer`. Notes et tâches : l'organisateur, les participants et
 * `cm.reunions.gerer`. Les notes ne quittent jamais le serveur : aucun événement du bus, aucun MP, aucun iCal ne
 * les contient, et aucune IA ne les lit (règle de confidentialité du connecteur IA, tâche « reunions »).
 */

import { evenement } from '../../evenements.mjs';
import { aleatoire, echec, iso, jsonOu, nouvelId, sha256Hex, texteNettoye } from '../../outils.mjs';
import { pseudosDe } from '../../requetes.mjs';
import { NOTE_MAX, nettoyerNote } from '../../review/markdown.mjs';
import { heatmap } from '../../planning/dispos.mjs';
import { dateIcs, echapper, plier } from '../../planning/ical.mjs';
import { estOccurrence, lireRecurrence, occurrences } from '../../planning/recurrence.mjs';
import { dateLocale, fuseauValide, instantMural, jourSemaine, lireDate, lireHeure, lundiDe, partiesLocales, texteDate, texteHeure } from '../../planning/temps.mjs';
import { MOTIF_COMPTE, exigerUuid, permissionsClub } from '../commun.mjs';
import { DUREES_RAPPEL, JOUR_MS, LIEUX, MINUTE, REPONSES, STATUTS, TYPES_EXCEPTION, decouperPlage, exceptionsDispo, proposerCreneaux, statutEffectif } from './regles.mjs';

export const FUSEAU_DEFAUT = 'Europe/Paris';
const DUREE_MAX_MS = 12 * 3_600_000;
const PLAGE_MAX_JOURS = 62;
const PARTICIPANTS_MAX = 50;
const MOTIF_JETON = /^cmr_[A-Za-z0-9_-]{43}$/;
const MOTIF_LIEN = /^https:\/\/[^\s<>"'`\\]{1,2000}$/i;

/** Droits « réunions » d'un compte : `{ voir, gerer }` (rôles CM du club ou d'une team où il est actif, rôles du club). */
export async function droitsReunions(base, acteur) {
  if (acteur?.superAdmin) return { voir: true, gerer: true };
  if (!acteur?.compte) return { voir: false, gerer: false };
  const s = await permissionsClub(base, acteur.compte);
  const aff = await base.tous(
    `SELECT DISTINCT rp.permission FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id
       JOIN membres m ON m.team_id = a.portee AND m.compte_id = a.compte_id AND m.statut = 'actif'
      WHERE a.compte_id = ? AND a.portee <> 'club' AND rp.permission IN ('cm.reunions.voir', 'cm.reunions.gerer')`,
    [acteur.compte],
  );
  for (const l of aff) s.add(l.permission);
  const gerer = s.has('cm.reunions.gerer');
  return { voir: gerer || s.has('cm.reunions.voir'), gerer };
}

/** Comptes de l'équipe CM (qui ont `cm.reunions.voir` ou `gerer`), le Fondateur compris s'il a un profil. */
export async function comptesEquipeCm(base) {
  const lignes = await base.tous(
    `SELECT DISTINCT compte_id FROM permissions_club WHERE permission IN ('cm.reunions.voir', 'cm.reunions.gerer')
     UNION
     SELECT DISTINCT a.compte_id FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id
       JOIN membres m ON m.team_id = a.portee AND m.compte_id = a.compte_id AND m.statut = 'actif'
      WHERE a.portee <> 'club' AND rp.permission IN ('cm.reunions.voir', 'cm.reunions.gerer')`,
    [],
  );
  const s = new Set(lignes.map(l => l.compte_id));
  if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) s.add('principal');
  return s;
}

const local = (fuseau, ms) => {
  const l = partiesLocales(fuseau, ms);
  return { date: texteDate(l), heure: texteHeure(l.heure * 60 + l.minute) };
};

function lireFuseau(v, defaut = FUSEAU_DEFAUT) {
  if (v === undefined || v === null || v === '') return defaut;
  if (!fuseauValide(v)) throw echec(400, 'fuseau', 'Fuseau horaire invalide.');
  return v;
}

/** Créneau saisi : `date` + `heureDebut` + `heureFin` (heure murale du fuseau), ou `debut` / `fin` ISO. */
export function lireHoraire(corps, fuseauDefaut) {
  const fuseau = lireFuseau(corps?.fuseau, fuseauDefaut);
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
  if (fin - debut > DUREE_MAX_MS) throw echec(400, 'duree', 'Une réunion dure 12 heures au plus.');
  if (debut < Date.UTC(2000, 0, 1) || debut > Date.UTC(2100, 0, 1)) throw echec(400, 'date', 'Date hors limites.');
  return { debut, fin, fuseau };
}

/** Lieu saisi : `{ lieuGenre, lieu, lien }` (salon vocal Discord ou visio : lien https). */
function lireLieu(corps, actuel = {}) {
  const genre = corps?.lieuGenre ?? actuel.lieu_genre ?? 'aucun';
  if (!LIEUX.includes(genre)) throw echec(400, 'lieu', 'Lieu : aucun, discord, lien ou lieu.');
  const lieu = texteNettoye(corps?.lieu ?? (corps?.lieuGenre === undefined ? actuel.lieu : '') ?? '', 200);
  let lien = corps?.lien !== undefined ? String(corps.lien ?? '').trim() : (actuel.lien ?? '');
  if (genre === 'aucun' || genre === 'lieu') lien = '';
  if (lien && !MOTIF_LIEN.test(lien)) throw echec(400, 'lien', 'Lien de visio : adresse https://… sans espace.');
  if (genre === 'lien' && !lien) throw echec(400, 'lien', 'Indiquez le lien de la visio.');
  if (genre === 'discord' && lien && !/^https:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\//i.test(lien)) throw echec(400, 'lien', 'Salon vocal Discord : lien https://discord.com/channels/…');
  return { genre, lieu, lien: lien || null };
}

function lireRappel(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!DUREES_RAPPEL.includes(n)) throw echec(400, 'rappel', 'Rappel : 5, 10, 15, 30, 60, 120 ou 1440 minutes avant, ou aucun.');
  return n;
}

export function servicesReunionsCm({ base, maintenant = () => Date.now(), tableaux }) {
  async function ctx(acteur, { exigerVoir = false } = {}) {
    const d = await droitsReunions(base, acteur);
    if (exigerVoir && !d.voir) throw echec(404, 'route', 'Adresse inconnue.');
    return { acteur, ...d };
  }

  async function participantsDe(ids) {
    if (!ids.length) return new Map();
    const m = new Map(ids.map(id => [id, []]));
    for (let i = 0; i < ids.length; i += 80) {
      const paquet = ids.slice(i, i + 80);
      const lignes = await base.tous(`SELECT * FROM cm_reunion_participants WHERE reunion_id IN (${paquet.map(() => '?').join(', ')}) ORDER BY ajoute_le, compte_id`, paquet);
      for (const l of lignes) m.get(l.reunion_id)?.push(l);
    }
    return m;
  }

  async function exceptionsDe(ids) {
    const m = new Map();
    for (let i = 0; i < ids.length; i += 80) {
      const paquet = ids.slice(i, i + 80);
      if (!paquet.length) continue;
      for (const x of await base.tous(`SELECT * FROM cm_reunion_exceptions WHERE reunion_id IN (${paquet.map(() => '?').join(', ')})`, paquet)) {
        if (!m.has(x.reunion_id)) m.set(x.reunion_id, new Map());
        m.get(x.reunion_id).set(x.occurrence, { annulee: x.annulee });
      }
    }
    return m;
  }

  const estParticipant = (parts, compte) => parts.some(p => p.compte_id === compte);
  const peutVoir = (c, r, parts) => c.gerer || r.organisateur_id === c.acteur.compte || estParticipant(parts, c.acteur.compte) || (c.voir && r.genre === 'reunion');
  const peutModifier = (c, r) => c.gerer || r.organisateur_id === c.acteur.compte;
  const peutNotes = (c, r, parts) => c.gerer || r.organisateur_id === c.acteur.compte || estParticipant(parts, c.acteur.compte);

  async function reunionLigne(id) {
    exigerUuid(id, 'reunion');
    const r = await base.premier('SELECT * FROM cm_reunions WHERE id = ?', [id]);
    if (!r) throw echec(404, 'reunion-introuvable', 'Réunion introuvable.');
    return r;
  }

  /** Réunion visible par l'acteur (sinon 404 : on ne dit pas qu'elle existe). */
  async function reunionVisible(acteur, id) {
    const c = await ctx(acteur);
    const r = await reunionLigne(id);
    const parts = (await participantsDe([r.id])).get(r.id) ?? [];
    if (!peutVoir(c, r, parts)) throw echec(404, 'reunion-introuvable', 'Réunion introuvable.');
    return { c, r, parts };
  }

  /** Réunions actives (ou annulées) candidates sur [du, au[ : séries comprises. */
  async function candidates(du, au, { annulees = false } = {}) {
    const condition = annulees ? '' : "statut = 'active' AND";
    return base.tous(
      `SELECT * FROM cm_reunions WHERE ${condition} debut < ? AND (recurrence IS NOT NULL OR fin > ?) ORDER BY debut LIMIT 2000`,
      [iso(au), iso(du)],
    );
  }

  /** Occurrences `[{ r, o }]` sur [du, au[ (exceptions appliquées). */
  async function occurrencesDe(lignes, du, au) {
    const ex = await exceptionsDe(lignes.filter(r => r.recurrence).map(r => r.id));
    const sortie = [];
    for (const r of lignes) for (const o of occurrences(r, du, au, ex.get(r.id) ?? new Map())) sortie.push({ r, o });
    return sortie.sort((a, b) => a.o.debut - b.o.debut);
  }

  /** Réunions occupées d'un ensemble de comptes sur [du, au[ : Map compte → [{ s, e }] (réponses « refuse » exclues). */
  async function occupationsDe(comptes, du, au, { sauf } = {}) {
    const m = new Map(comptes.map(c => [c, []]));
    const lignes = (await candidates(du, au)).filter(r => r.id !== sauf);
    const parts = await participantsDe(lignes.map(r => r.id));
    for (const { r, o } of await occurrencesDe(lignes, du, au)) {
      for (const p of parts.get(r.id) ?? []) if (m.has(p.compte_id) && p.reponse !== 'refuse') m.get(p.compte_id).push({ s: o.debut, e: o.fin });
    }
    return m;
  }

  async function profilsDe(comptes) {
    const m = new Map();
    for (let i = 0; i < comptes.length; i += 80) {
      const paquet = comptes.slice(i, i + 80);
      if (!paquet.length) continue;
      for (const l of await base.tous(`SELECT * FROM cm_reunion_profils WHERE compte_id IN (${paquet.map(() => '?').join(', ')})`, paquet)) m.set(l.compte_id, l);
    }
    return m;
  }

  /** Disponibilités saisies : Map compte → { regles, exceptions } (exceptions qui touchent [du, au[). */
  async function disposDe(comptes, du, au) {
    const m = new Map(comptes.map(c => [c, { regles: [], exceptions: [] }]));
    for (let i = 0; i < comptes.length; i += 80) {
      const paquet = comptes.slice(i, i + 80);
      if (!paquet.length) continue;
      for (const r of await base.tous(`SELECT * FROM cm_dispo_regles WHERE compte_id IN (${paquet.map(() => '?').join(', ')}) ORDER BY jour, debut`, paquet)) m.get(r.compte_id).regles.push({ jour: Number(r.jour), debut: r.debut, fin: r.fin, type: r.type, fuseau: r.fuseau });
      for (const x of await base.tous(`SELECT * FROM cm_dispo_exceptions WHERE compte_id IN (${paquet.map(() => '?').join(', ')}) AND fin > ? AND debut < ? ORDER BY debut`, [...paquet, iso(du), iso(au)])) m.get(x.compte_id).exceptions.push({ id: x.id, debut: x.debut, fin: x.fin, type: x.type, note: x.note });
    }
    return m;
  }

  /** Vérifie et normalise une liste de comptes invités (profil Esport requis). */
  async function lireParticipants(liste, organisateur) {
    if (liste === undefined) return null;
    if (!Array.isArray(liste) || liste.some(c => typeof c !== 'string' || !MOTIF_COMPTE.test(c))) throw echec(400, 'participants', 'Participants illisibles.');
    const comptes = [...new Set(liste.filter(c => c !== organisateur))];
    if (comptes.length > PARTICIPANTS_MAX) throw echec(400, 'participants', '50 participants au plus.');
    if (comptes.length) {
      const connus = new Set((await base.tous(`SELECT id FROM comptes WHERE id IN (${comptes.map(() => '?').join(', ')})`, comptes)).map(l => l.id));
      if (comptes.some(c => !connus.has(c))) throw echec(400, 'participants', 'Un participant n’a pas encore de profil Esport.');
    }
    return comptes;
  }

  function reunionPublique(c, r, parts, { o, notes } = {}) {
    const moi = parts.find(p => p.compte_id === c.acteur.compte);
    const debut = o ? o.debut : Date.parse(r.debut);
    const fin = o ? o.fin : Date.parse(r.fin);
    return {
      id: r.id,
      genre: r.genre,
      titre: r.titre,
      cle: o ? o.cle : new Date(Date.parse(r.debut)).toISOString(),
      debut: iso(debut),
      fin: iso(fin),
      fuseau: r.fuseau,
      local: { ...local(r.fuseau, debut), heureFin: local(r.fuseau, fin).heure },
      recurrence: jsonOu(r.recurrence, null),
      lieuGenre: r.lieu_genre,
      lieu: r.lieu,
      lien: r.lien ?? null,
      rappelMinutes: r.rappel_minutes === null || r.rappel_minutes === undefined ? null : Number(r.rappel_minutes),
      organisateur: r.organisateur_id ?? null,
      statut: r.statut,
      motifAnnulation: r.motif_annulation ?? null,
      version: Number(r.version),
      participants: parts.map(p => ({ compte: p.compte_id, reponse: p.reponse, commentaire: p.commentaire, proposition: p.proposition_debut ? { debut: p.proposition_debut, fin: p.proposition_fin } : null, reponduLe: p.repondu_le ?? null })),
      maReponse: moi ? moi.reponse : null,
      droits: { modifier: peutModifier(c, r) && r.statut === 'active', notes: peutNotes(c, r, parts), repondre: Boolean(moi) && r.organisateur_id !== c.acteur.compte && r.statut === 'active' },
      ...(notes !== undefined ? { notes } : {}),
    };
  }

  function lirePlage(params, defautJours = 7) {
    const t = maintenant();
    const du = params.du ? Date.parse(params.du.length === 10 ? `${params.du}T00:00:00Z` : params.du) : t - JOUR_MS;
    const au = params.au ? Date.parse(params.au.length === 10 ? `${params.au}T23:59:59Z` : params.au) : du + defautJours * JOUR_MS;
    if (Number.isNaN(du) || Number.isNaN(au) || au <= du) throw echec(400, 'plage', 'Période invalide.');
    if (au - du > PLAGE_MAX_JOURS * JOUR_MS) throw echec(400, 'plage', '62 jours au plus.');
    return { du, au };
  }

  // -------------------------------------------------------------- Accueil, agenda

  /** `GET /cm/reunions/moi` : droits, profil, équipe CM (statut du moment) et invitations en attente. */
  async function moi(acteur) {
    const c = await ctx(acteur);
    const t = maintenant();
    const profil = (await profilsDe([acteur.compte])).get(acteur.compte) ?? null;
    const enAttente = await base.premier(
      "SELECT COUNT(*) AS n FROM cm_reunion_participants p JOIN cm_reunions r ON r.id = p.reunion_id WHERE p.compte_id = ? AND p.reponse = 'attente' AND r.statut = 'active' AND (r.recurrence IS NOT NULL OR r.fin > ?) AND r.organisateur_id <> p.compte_id",
      [acteur.compte, iso(t)],
    );
    const invite = Number(enAttente?.n ?? 0) > 0 || Boolean(await base.premier("SELECT p.reunion_id FROM cm_reunion_participants p JOIN cm_reunions r ON r.id = p.reunion_id WHERE p.compte_id = ? AND r.statut = 'active' AND (r.recurrence IS NOT NULL OR r.fin > ?) LIMIT 1", [acteur.compte, iso(t)]));
    return {
      droits: { voir: c.voir, gerer: c.gerer },
      invite,
      aRepondre: Number(enAttente?.n ?? 0),
      compte: acteur.compte,
      profil: { fuseau: profil?.fuseau ?? null, statut: profil?.statut ?? null, message: profil?.message ?? '', jusqua: profil?.statut_jusqua ?? null },
      equipe: c.voir ? await equipeAvecStatuts(t) : [],
    };
  }

  async function equipeAvecStatuts(t) {
    const comptes = [...(await comptesEquipeCm(base))];
    const noms = await pseudosDe(base, comptes);
    const profils = await profilsDe(comptes);
    const dispos = await disposDe(comptes, t - JOUR_MS, t + JOUR_MS);
    const occ = await occupationsDe(comptes, t - JOUR_MS, t + JOUR_MS);
    return comptes
      .map(compte => {
        const enReunion = (occ.get(compte) ?? []).some(i => i.s <= t && i.e > t);
        const s = statutEffectif({ profil: profils.get(compte), exceptions: dispos.get(compte)?.exceptions ?? [], enReunion }, t);
        return { compte, pseudo: noms[compte] ?? null, fuseau: profils.get(compte)?.fuseau ?? null, enReunion, ...s };
      })
      .sort((a, b) => String(a.pseudo ?? '').localeCompare(String(b.pseudo ?? ''), 'fr'));
  }

  /** `GET /cm/reunions?du&au` : occurrences visibles (agenda de l'équipe ; ses réunions pour un invité). */
  async function agenda(acteur, params = {}) {
    const c = await ctx(acteur);
    const { du, au } = lirePlage(params);
    const lignes = await candidates(du, au, { annulees: params.annulees === '1' });
    const parts = await participantsDe(lignes.map(r => r.id));
    const visibles = lignes.filter(r => peutVoir(c, r, parts.get(r.id) ?? []));
    // Une réunion annulée reste affichée (barrée) ; ses occurrences sont calculées comme si elle était active.
    const sortie = (await occurrencesDe(visibles, du, au)).map(({ r, o }) => reunionPublique(c, r, parts.get(r.id) ?? [], { o }));
    const comptes = new Set(sortie.flatMap(x => [x.organisateur, ...x.participants.map(p => p.compte)]).filter(Boolean));
    return { reunions: sortie, noms: await pseudosDe(base, [...comptes]), droits: { voir: c.voir, gerer: c.gerer } };
  }

  /** `GET /cm/reunions/:id` : la réunion, ses notes (si permis) et ses tâches de suivi. */
  async function detail(acteur, id) {
    const { c, r, parts } = await reunionVisible(acteur, id);
    let notes;
    if (peutNotes(c, r, parts)) {
      const n = await base.premier('SELECT * FROM cm_reunion_notes WHERE reunion_id = ?', [r.id]);
      const taches = await base.tous('SELECT * FROM cm_reunion_taches WHERE reunion_id = ? ORDER BY position, cree_le', [r.id]);
      notes = {
        ordreDuJour: n?.ordre_du_jour ?? '',
        compteRendu: n?.compte_rendu ?? '',
        majPar: n?.maj_par ?? null,
        majLe: n?.maj_le ?? null,
        taches: taches.map(tachePublique),
      };
    }
    const sortie = reunionPublique(c, r, parts, { notes });
    const comptes = [sortie.organisateur, ...sortie.participants.map(p => p.compte), notes?.majPar, ...(notes?.taches ?? []).map(x => x.assigneA)].filter(Boolean);
    let creneau = null;
    if (r.creneau_id) {
      const cr = await base.premier('SELECT c.*, o.titre FROM cm_rdv_creneaux c JOIN cm_rdv_offres o ON o.id = c.offre_id WHERE c.id = ?', [r.creneau_id]);
      if (cr) creneau = { id: cr.id, offreId: cr.offre_id, offre: cr.titre };
    }
    return { reunion: { ...sortie, creneau }, noms: await pseudosDe(base, comptes) };
  }

  const tachePublique = x => ({ id: x.id, texte: x.texte, assigneA: x.assigne_a ?? null, echeance: x.echeance ?? null, fait: Number(x.fait) === 1, carteId: x.carte_id ?? null });

  // -------------------------------------------------------------- Créer, modifier, annuler, répondre

  function chargeReunion(r, participants, extra = {}) {
    return { titre: r.titre, genre: r.genre, debut: r.debut, fin: r.fin, fuseau: r.fuseau, organisateur: r.organisateur_id ?? null, participants, ...extra };
  }

  /**
   * `POST /cm/reunions` : `{ titre, ordreDuJour, date, heureDebut, heureFin | debut, fin, fuseau, recurrence,
   * lieuGenre, lieu, lien, rappelMinutes, participants: [compte] }`. Toute l'équipe CM crée ses réunions.
   */
  async function creer(acteur, corps, interne = {}) {
    const c = await ctx(acteur, { exigerVoir: !interne.rdv });
    const titre = texteNettoye(corps?.titre, 140);
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const h = lireHoraire(corps, FUSEAU_DEFAUT);
    let recurrence;
    try {
      recurrence = lireRecurrence(corps?.recurrence, jourSemaine(dateLocale(h.fuseau, h.debut)));
    } catch (e) {
      throw echec(400, 'recurrence', e.message);
    }
    const lieu = lireLieu(corps);
    const rappel = lireRappel(corps?.rappelMinutes === undefined ? 15 : corps.rappelMinutes);
    const participants = (await lireParticipants(corps?.participants ?? [], acteur.compte)) ?? [];
    const ordreDuJour = nettoyerNote(corps?.ordreDuJour ?? '', NOTE_MAX);
    const t = maintenant();
    const id = nouvelId();
    const r = { id, genre: interne.rdv ? 'rdv' : 'reunion', titre, debut: iso(h.debut), fin: iso(h.fin), fuseau: h.fuseau, organisateur_id: acteur.compte };
    const lot = [
      {
        sql: `INSERT INTO cm_reunions (id, genre, titre, debut, fin, fuseau, recurrence, lieu_genre, lieu, lien, rappel_minutes, organisateur_id, creneau_id, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, r.genre, titre, r.debut, r.fin, h.fuseau, recurrence ? JSON.stringify(recurrence) : null, lieu.genre, lieu.lieu, lieu.lien, rappel, acteur.compte, interne.creneauId ?? null, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      { sql: "INSERT INTO cm_reunion_participants (reunion_id, compte_id, reponse, repondu_le, ajoute_le) VALUES (?, ?, 'accepte', ?, ?)", params: [id, acteur.compte, iso(t), iso(t)] },
      ...participants.map(p => ({ sql: "INSERT INTO cm_reunion_participants (reunion_id, compte_id, reponse, ajoute_le) VALUES (?, ?, ?, ?)", params: [id, p, interne.accepte?.includes(p) ? 'accepte' : 'attente', iso(t)] })),
      { sql: 'INSERT INTO cm_reunion_notes (reunion_id, ordre_du_jour, compte_rendu, maj_par, maj_le) VALUES (?, ?, ?, ?, ?)', params: [id, ordreDuJour, '', acteur.compte, iso(t)] },
    ];
    if (!interne.rdv) lot.push(evenement('cm.reunion_creee', { acteur: acteur.compte, entiteType: 'cm_reunion', entiteId: id, charge: chargeReunion(r, participants, { recurrente: Boolean(recurrence) }), maintenant: t }));
    if (interne.lot) lot.push(...interne.lot);
    await base.lot(lot);
    void c;
    return detail(acteur, id);
  }

  /** `PATCH /cm/reunions/:id` : modifier (organisateur ou gerer). Horaire changé : les réponses repartent « en attente ». */
  async function modifier(acteur, id, corps) {
    const { c, r, parts } = await reunionVisible(acteur, id);
    if (!peutModifier(c, r)) throw echec(403, 'permission', 'Seul l’organisateur (ou la Responsable CM) modifie cette réunion.');
    if (r.statut !== 'active') throw echec(409, 'reunion-annulee', 'Cette réunion est annulée.');
    if (corps?.version !== undefined && Number(corps.version) !== Number(r.version)) throw echec(409, 'version', 'La réunion a changé entre-temps : rechargez-la.');
    const t = maintenant();
    const changements = [];
    const titre = corps?.titre !== undefined ? texteNettoye(corps.titre, 140) : r.titre;
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    if (titre !== r.titre) changements.push('titre');
    let { debut, fin, fuseau } = r;
    const horaireSaisi = corps?.date !== undefined || corps?.debut !== undefined;
    if (horaireSaisi || corps?.fuseau !== undefined) {
      const h = lireHoraire(horaireSaisi ? corps : { ...corps, debut: r.debut, fin: r.fin }, r.fuseau);
      if (iso(h.debut) !== r.debut || iso(h.fin) !== r.fin) changements.push('horaire');
      [debut, fin, fuseau] = [iso(h.debut), iso(h.fin), h.fuseau];
    }
    let recurrence = r.recurrence;
    if (corps?.recurrence !== undefined) {
      try {
        const regle = lireRecurrence(corps.recurrence, jourSemaine(dateLocale(fuseau, Date.parse(debut))));
        recurrence = regle ? JSON.stringify(regle) : null;
      } catch (e) {
        throw echec(400, 'recurrence', e.message);
      }
      if (recurrence !== r.recurrence) changements.push('recurrence');
    }
    const lieu = corps?.lieuGenre !== undefined || corps?.lien !== undefined || corps?.lieu !== undefined ? lireLieu(corps, r) : { genre: r.lieu_genre, lieu: r.lieu, lien: r.lien ?? null };
    if (lieu.genre !== r.lieu_genre || lieu.lieu !== r.lieu || (lieu.lien ?? null) !== (r.lien ?? null)) changements.push('lieu');
    const rappel = corps?.rappelMinutes !== undefined ? lireRappel(corps.rappelMinutes) : r.rappel_minutes;
    const lot = [
      {
        sql: 'UPDATE cm_reunions SET titre = ?, debut = ?, fin = ?, fuseau = ?, recurrence = ?, lieu_genre = ?, lieu = ?, lien = ?, rappel_minutes = ?, version = version + 1, maj_par = ?, maj_le = ? WHERE id = ?',
        params: [titre, debut, fin, fuseau, recurrence, lieu.genre, lieu.lieu, lieu.lien, rappel, acteur.compte, iso(t), r.id],
      },
    ];
    // Participants : ajoutés (en attente) et retirés ; l'organisateur reste.
    const nouveaux = await lireParticipants(corps?.participants, r.organisateur_id);
    const actuels = parts.map(p => p.compte_id).filter(x => x !== r.organisateur_id);
    let ajoutes = [];
    let retires = [];
    if (nouveaux) {
      ajoutes = nouveaux.filter(x => !actuels.includes(x));
      retires = actuels.filter(x => !nouveaux.includes(x));
      for (const x of ajoutes) lot.push({ sql: "INSERT INTO cm_reunion_participants (reunion_id, compte_id, reponse, ajoute_le) VALUES (?, ?, 'attente', ?) ON CONFLICT DO NOTHING", params: [r.id, x, iso(t)] });
      for (const x of retires) lot.push({ sql: 'DELETE FROM cm_reunion_participants WHERE reunion_id = ? AND compte_id = ?', params: [r.id, x] });
      if (ajoutes.length || retires.length) changements.push('participants');
    }
    if (changements.includes('horaire') || changements.includes('recurrence')) {
      // Comme Outlook : un nouvel horaire redemande la réponse de chacun (sauf l'organisateur).
      lot.push({ sql: "UPDATE cm_reunion_participants SET reponse = 'attente', proposition_debut = NULL, proposition_fin = NULL, repondu_le = NULL WHERE reunion_id = ? AND compte_id <> ?", params: [r.id, r.organisateur_id ?? ''] });
      lot.push({ sql: 'DELETE FROM cm_reunion_rappels WHERE reunion_id = ?', params: [r.id] });
    }
    if (corps?.ordreDuJour !== undefined) {
      lot.push({ sql: 'UPDATE cm_reunion_notes SET ordre_du_jour = ?, maj_par = ?, maj_le = ? WHERE reunion_id = ?', params: [nettoyerNote(corps.ordreDuJour, NOTE_MAX), acteur.compte, iso(t), r.id] });
    }
    const restants = (nouveaux ?? actuels).filter(x => x !== acteur.compte);
    if (changements.length) {
      lot.push(evenement('cm.reunion_modifiee', { acteur: acteur.compte, entiteType: 'cm_reunion', entiteId: r.id, charge: chargeReunion({ ...r, titre, debut, fin, fuseau }, [...new Set([...restants, ...(r.organisateur_id && r.organisateur_id !== acteur.compte ? [r.organisateur_id] : [])])], { changements, ajoutes, retires }), maintenant: t }));
    }
    await base.lot(lot);
    return detail(acteur, r.id);
  }

  /** `POST /cm/reunions/:id/annuler { motif, occurrence? }` : la série entière, ou une seule occurrence d'une série. */
  async function annuler(acteur, id, corps) {
    const { c, r, parts } = await reunionVisible(acteur, id);
    const rdvReserve = r.genre === 'rdv' && estParticipant(parts, acteur.compte);
    if (!peutModifier(c, r) && !rdvReserve) throw echec(403, 'permission', 'Seul l’organisateur (ou la Responsable CM) annule cette réunion.');
    if (r.statut !== 'active') throw echec(409, 'reunion-annulee', 'Cette réunion est déjà annulée.');
    const motif = texteNettoye(corps?.motif ?? '', 500);
    const t = maintenant();
    const destinataires = parts.map(p => p.compte_id).filter(x => x !== acteur.compte);
    const lot = [];
    let occurrence = null;
    if (corps?.occurrence) {
      if (!r.recurrence) throw echec(400, 'occurrence', 'Cette réunion n’est pas récurrente.');
      if (!estOccurrence(r, corps.occurrence)) throw echec(404, 'occurrence-introuvable', 'Occurrence introuvable.');
      occurrence = new Date(Date.parse(corps.occurrence)).toISOString();
      lot.push({ sql: 'INSERT INTO cm_reunion_exceptions (reunion_id, occurrence, annulee, maj_par, maj_le) VALUES (?, ?, 1, ?, ?) ON CONFLICT (reunion_id, occurrence) DO UPDATE SET annulee = 1, maj_par = excluded.maj_par, maj_le = excluded.maj_le', params: [r.id, occurrence, acteur.compte, iso(t)] });
    } else {
      lot.push({ sql: "UPDATE cm_reunions SET statut = 'annulee', motif_annulation = ?, annule_par = ?, annule_le = ?, version = version + 1, maj_le = ? WHERE id = ?", params: [motif || null, acteur.compte, iso(t), iso(t), r.id] });
      // Rendez-vous annulé : le créneau redevient libre.
      if (r.creneau_id) lot.push({ sql: 'UPDATE cm_rdv_creneaux SET reserve_par = NULL, reserve_le = NULL, reunion_id = NULL WHERE id = ? AND reunion_id = ?', params: [r.creneau_id, r.id] }, { sql: 'UPDATE cm_reunions SET creneau_id = NULL WHERE id = ?', params: [r.id] });
    }
    lot.push(evenement('cm.reunion_annulee', { acteur: acteur.compte, entiteType: 'cm_reunion', entiteId: r.id, charge: chargeReunion(r, destinataires, { occurrence: occurrence ?? (r.recurrence ? null : r.debut), motif: motif || null, serie: !occurrence }), maintenant: t }));
    await base.lot(lot);
    return detail(acteur, r.id);
  }

  /** `PUT /cm/reunions/:id/reponse { reponse, commentaire, propositionDebut, propositionFin | date, heureDebut, heureFin }`. */
  async function repondre(acteur, id, corps) {
    const { r, parts } = await reunionVisible(acteur, id);
    const moi_ = parts.find(p => p.compte_id === acteur.compte);
    if (!moi_) throw echec(403, 'non-invite', 'Vous n’êtes pas invité à cette réunion.');
    if (r.statut !== 'active') throw echec(409, 'reunion-annulee', 'Cette réunion est annulée.');
    const reponse = corps?.reponse;
    if (!REPONSES.includes(reponse) || reponse === 'attente') throw echec(400, 'reponse', 'Réponse : accepte, peut_etre, refuse ou propose.');
    const commentaire = texteNettoye(corps?.commentaire ?? '', 500);
    let prop = { debut: null, fin: null };
    if (reponse === 'propose') {
      const h = lireHoraire(corps?.date !== undefined ? { ...corps, fuseau: corps.fuseau ?? r.fuseau } : { debut: corps?.propositionDebut, fin: corps?.propositionFin }, r.fuseau);
      prop = { debut: iso(h.debut), fin: iso(h.fin) };
    }
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_reunion_participants SET reponse = ?, commentaire = ?, proposition_debut = ?, proposition_fin = ?, repondu_le = ? WHERE reunion_id = ? AND compte_id = ?', params: [reponse, commentaire, prop.debut, prop.fin, iso(t), r.id, acteur.compte] },
      evenement('cm.reunion_reponse', { acteur: acteur.compte, entiteType: 'cm_reunion', entiteId: r.id, charge: { titre: r.titre, debut: r.debut, organisateur: r.organisateur_id ?? null, compte: acteur.compte, reponse, proposition: prop.debut ? prop : null }, maintenant: t }),
    ]);
    return detail(acteur, r.id);
  }

  // -------------------------------------------------------------- Notes et tâches (confidentielles)

  async function notesPermises(acteur, id) {
    const x = await reunionVisible(acteur, id);
    if (!peutNotes(x.c, x.r, x.parts)) throw echec(403, 'permission', 'Les notes sont réservées aux participants.');
    return x;
  }

  /** `PUT /cm/reunions/:id/notes { ordreDuJour?, compteRendu? }` (aucun événement : les notes ne sortent jamais). */
  async function ecrireNotes(acteur, id, corps) {
    const { r } = await notesPermises(acteur, id);
    const n = await base.premier('SELECT * FROM cm_reunion_notes WHERE reunion_id = ?', [r.id]);
    const ordre = corps?.ordreDuJour !== undefined ? nettoyerNote(corps.ordreDuJour, NOTE_MAX) : (n?.ordre_du_jour ?? '');
    const cr = corps?.compteRendu !== undefined ? nettoyerNote(corps.compteRendu, NOTE_MAX * 4) : (n?.compte_rendu ?? '');
    const t = maintenant();
    await base.executer(
      'INSERT INTO cm_reunion_notes (reunion_id, ordre_du_jour, compte_rendu, maj_par, maj_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT (reunion_id) DO UPDATE SET ordre_du_jour = excluded.ordre_du_jour, compte_rendu = excluded.compte_rendu, maj_par = excluded.maj_par, maj_le = excluded.maj_le',
      [r.id, ordre, cr, acteur.compte, iso(t)],
    );
    return detail(acteur, r.id);
  }

  async function lireAssigne(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !MOTIF_COMPTE.test(v) || !(await base.premier('SELECT id FROM comptes WHERE id = ?', [v]))) throw echec(400, 'assigne', 'Compte inconnu.');
    return v;
  }

  async function ajouterTache(acteur, id, corps) {
    const { r } = await notesPermises(acteur, id);
    const texte = texteNettoye(corps?.texte, 300);
    if (texte.length < 2) throw echec(400, 'texte', 'Tâche : 2 caractères au moins.');
    const n = await base.premier('SELECT COUNT(*) AS n, MAX(position) AS p FROM cm_reunion_taches WHERE reunion_id = ?', [r.id]);
    if (Number(n?.n ?? 0) >= 100) throw echec(409, 'trop-de-taches', '100 tâches au plus par réunion.');
    const echeance = corps?.echeance ? lireDate(corps.echeance) : null;
    if (corps?.echeance && !echeance) throw echec(400, 'echeance', 'Échéance : AAAA-MM-JJ.');
    const t = maintenant();
    await base.executer('INSERT INTO cm_reunion_taches (id, reunion_id, texte, assigne_a, echeance, fait, position, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)', [nouvelId(), r.id, texte, await lireAssigne(corps?.assigneA), echeance ? texteDate(echeance) : null, Number(n?.p ?? 0) + 1, acteur.compte, iso(t), iso(t)]);
    return detail(acteur, r.id);
  }

  async function tacheLigne(acteur, tacheId) {
    exigerUuid(tacheId, 'tache');
    const x = await base.premier('SELECT * FROM cm_reunion_taches WHERE id = ?', [tacheId]);
    if (!x) throw echec(404, 'tache-introuvable', 'Tâche introuvable.');
    await notesPermises(acteur, x.reunion_id);
    return x;
  }

  async function modifierTache(acteur, tacheId, corps) {
    const x = await tacheLigne(acteur, tacheId);
    const texte = corps?.texte !== undefined ? texteNettoye(corps.texte, 300) : x.texte;
    if (texte.length < 2) throw echec(400, 'texte', 'Tâche : 2 caractères au moins.');
    const fait = corps?.fait !== undefined ? (corps.fait ? 1 : 0) : Number(x.fait);
    const assigne = corps?.assigneA !== undefined ? await lireAssigne(corps.assigneA) : (x.assigne_a ?? null);
    await base.executer('UPDATE cm_reunion_taches SET texte = ?, fait = ?, assigne_a = ?, maj_le = ? WHERE id = ?', [texte, fait, assigne, iso(maintenant()), x.id]);
    return detail(acteur, x.reunion_id);
  }

  async function supprimerTache(acteur, tacheId) {
    const x = await tacheLigne(acteur, tacheId);
    await base.executer('DELETE FROM cm_reunion_taches WHERE id = ?', [x.id]);
    return detail(acteur, x.reunion_id);
  }

  /**
   * `POST /cm/reunions/taches/:id/carte { tableauId, listeId? }` : la tâche devient une carte d'un tableau CM (il faut
   * `cm.editer` sur ce tableau : contrôlé par le service des tableaux). La carte ne reprend QUE le texte de la tâche
   * (jamais le compte rendu).
   */
  async function tacheVersCarte(acteur, tacheId, corps) {
    const x = await tacheLigne(acteur, tacheId);
    if (x.carte_id) throw echec(409, 'deja-carte', 'Cette tâche a déjà sa carte.');
    if (!tableaux) throw echec(503, 'tableaux', 'Tableaux indisponibles.');
    const r = await reunionLigne(x.reunion_id);
    let listeId = corps?.listeId;
    if (!listeId && typeof corps?.tableauId === 'string') {
      // Par défaut : la liste « Idées » du tableau, sinon sa première liste ouverte.
      const l = (await base.premier("SELECT id FROM cm_listes WHERE tableau_id = ? AND cle = 'idees' AND archive_le IS NULL", [corps.tableauId])) ?? (await base.premier('SELECT id FROM cm_listes WHERE tableau_id = ? AND archive_le IS NULL ORDER BY position LIMIT 1', [corps.tableauId]));
      listeId = l?.id;
    }
    const carte = await tableaux.creerCarte(acteur, corps?.tableauId, { titre: x.texte, listeId, description: `Tâche de suivi de la réunion « ${r.titre} ».` });
    const carteId = carte?.carte?.id ?? carte?.id;
    if (carteId && x.assigne_a) {
      try {
        await tableaux.modifierCarte(acteur, carteId, { membres: [x.assigne_a] });
      } catch {
        // La personne n'a pas accès au tableau : la carte reste sans membre.
      }
    }
    await base.executer('UPDATE cm_reunion_taches SET carte_id = ?, maj_le = ? WHERE id = ?', [carteId ?? null, iso(maintenant()), x.id]);
    return { ...(await detail(acteur, x.reunion_id)), carte: { id: carteId ?? null, tableauId: corps?.tableauId } };
  }

  // -------------------------------------------------------------- Disponibilités, statut

  async function mesDispos(acteur, params = {}) {
    await ctx(acteur, { exigerVoir: true });
    const t = maintenant();
    const profil = (await profilsDe([acteur.compte])).get(acteur.compte);
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : (profil?.fuseau ?? FUSEAU_DEFAUT);
    const d = (await disposDe([acteur.compte], t - JOUR_MS, t + 400 * JOUR_MS)).get(acteur.compte);
    return {
      fuseau,
      regles: d.regles,
      exceptions: d.exceptions.map(x => ({ ...x, local: { debut: local(fuseau, Date.parse(x.debut)), fin: local(fuseau, Date.parse(x.fin)) } })),
    };
  }

  /** `PUT /cm/reunions/dispos/moi/regles { regles: [{ jour, debut, fin, type }], fuseau }` : remplace mes créneaux hebdo. */
  async function remplacerRegles(acteur, corps) {
    await ctx(acteur, { exigerVoir: true });
    const fuseau = lireFuseau(corps?.fuseau);
    const regles = Array.isArray(corps?.regles) ? corps.regles : null;
    if (!regles || regles.length > 70) throw echec(400, 'regles', 'Créneaux illisibles (70 au plus).');
    const propres = regles.map(r => {
      const jour = Number(r?.jour);
      if (!Number.isInteger(jour) || jour < 1 || jour > 7) throw echec(400, 'jour', 'Jour : 1 (lundi) à 7 (dimanche).');
      if (lireHeure(r?.debut) === undefined || lireHeure(r?.fin) === undefined) throw echec(400, 'heure', 'Heures invalides (HH:MM).');
      const type = r?.type ?? 'disponible';
      if (!['disponible', 'indisponible'].includes(type)) throw echec(400, 'type', 'Type : disponible ou indisponible.');
      return { jour, debut: r.debut, fin: r.fin, type };
    });
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_dispo_regles WHERE compte_id = ?', params: [acteur.compte] },
      ...propres.map(r => ({ sql: 'INSERT INTO cm_dispo_regles (id, compte_id, jour, debut, fin, type, fuseau, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), acteur.compte, r.jour, r.debut, r.fin, r.type, fuseau, iso(t)] })),
      { sql: 'INSERT INTO cm_reunion_profils (compte_id, fuseau, maj_le) VALUES (?, ?, ?) ON CONFLICT (compte_id) DO UPDATE SET fuseau = excluded.fuseau, maj_le = excluded.maj_le', params: [acteur.compte, fuseau, iso(t)] },
    ]);
    return mesDispos(acteur, { fuseau });
  }

  /** `POST /cm/reunions/dispos/moi/exceptions { type: absence|conge|disponible, debut, fin | date…, note }`. */
  async function ajouterException(acteur, corps) {
    await ctx(acteur, { exigerVoir: true });
    const type = corps?.type ?? 'absence';
    if (!TYPES_EXCEPTION.includes(type)) throw echec(400, 'type', 'Type : absence, conge ou disponible.');
    let debut;
    let fin;
    if (corps?.jourDebut !== undefined) {
      // Journées entières (congés) : du jour de début 00:00 au lendemain du jour de fin, dans le fuseau.
      const fuseau = lireFuseau(corps?.fuseau);
      const a = lireDate(corps.jourDebut);
      const b = lireDate(corps.jourFin ?? corps.jourDebut);
      if (!a || !b) throw echec(400, 'date', 'Dates invalides (AAAA-MM-JJ).');
      debut = instantMural(fuseau, a, 0);
      fin = instantMural(fuseau, b, 1440);
      if (fin <= debut) throw echec(400, 'duree', 'La fin doit suivre le début.');
      if (fin - debut > 366 * JOUR_MS) throw echec(400, 'duree', 'Une absence dure un an au plus.');
    } else {
      const h = lireHoraire(corps, FUSEAU_DEFAUT);
      [debut, fin] = [h.debut, h.fin];
    }
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_dispo_exceptions WHERE compte_id = ? AND fin > ?', [acteur.compte, iso(maintenant())]);
    if (Number(n?.n ?? 0) >= 100) throw echec(409, 'trop-d-exceptions', '100 exceptions à venir au plus.');
    await base.executer('INSERT INTO cm_dispo_exceptions (id, compte_id, debut, fin, type, note, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [nouvelId(), acteur.compte, iso(debut), iso(fin), type, texteNettoye(corps?.note ?? '', 200), iso(maintenant())]);
    return mesDispos(acteur, { fuseau: corps?.fuseau });
  }

  async function supprimerException(acteur, id) {
    await ctx(acteur, { exigerVoir: true });
    exigerUuid(id, 'exception');
    const r = await base.executer('DELETE FROM cm_dispo_exceptions WHERE id = ? AND compte_id = ?', [id, acteur.compte]);
    if (r.changements !== 1) throw echec(404, 'exception-introuvable', 'Exception introuvable.');
    return mesDispos(acteur);
  }

  /** `PUT /cm/reunions/statut { statut|null, message, jusqua, fuseau }` : statut du moment, visible par l'équipe. */
  async function changerStatut(acteur, corps) {
    await ctx(acteur, { exigerVoir: true });
    const statut = corps?.statut ?? null;
    if (statut !== null && !STATUTS.includes(statut)) throw echec(400, 'statut', 'Statut : disponible, occupe, absent ou ne_pas_deranger.');
    const message = texteNettoye(corps?.message ?? '', 140);
    let jusqua = null;
    if (corps?.jusqua) {
      const j = Date.parse(corps.jusqua);
      if (Number.isNaN(j) || j <= maintenant()) throw echec(400, 'jusqua', 'Fin du statut : un instant à venir.');
      jusqua = iso(j);
    }
    const profil = (await profilsDe([acteur.compte])).get(acteur.compte);
    const fuseau = corps?.fuseau !== undefined ? lireFuseau(corps.fuseau) : (profil?.fuseau ?? null);
    const t = maintenant();
    await base.executer(
      'INSERT INTO cm_reunion_profils (compte_id, fuseau, statut, message, statut_jusqua, maj_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (compte_id) DO UPDATE SET fuseau = excluded.fuseau, statut = excluded.statut, message = excluded.message, statut_jusqua = excluded.statut_jusqua, maj_le = excluded.maj_le',
      [acteur.compte, fuseau, statut, statut ? message : '', statut ? jusqua : null, iso(t)],
    );
    return moi(acteur);
  }

  /**
   * `GET /cm/reunions/equipe/grille?semaine&fuseau&pas` : disponibilités de l'équipe superposées (heatmap créneaux ×
   * jours : nombre de membres libres), réunions existantes déduites.
   */
  async function grilleEquipe(acteur, params = {}) {
    await ctx(acteur, { exigerVoir: true });
    const fuseau = fuseauValide(params.fuseau) ? params.fuseau : FUSEAU_DEFAUT;
    const pas = Number(params.pas) === 30 ? 30 : 60;
    const ref = lireDate(params.semaine) ?? dateLocale(fuseau, maintenant());
    const lundi = lundiDe(ref);
    const du = instantMural(fuseau, lundi, 0);
    const au = instantMural(fuseau, lundi, 7 * 1440);
    const comptes = [...(await comptesEquipeCm(base))];
    const d = await disposDe(comptes, du - JOUR_MS, au + JOUR_MS);
    const occ = await occupationsDe(comptes, du, au);
    const joueurs = comptes.map(compte => ({
      compte,
      regles: d.get(compte).regles,
      exceptions: [...exceptionsDispo(d.get(compte).exceptions), ...(occ.get(compte) ?? []).map(i => ({ debut: iso(i.s), fin: iso(i.e), type: 'indisponible' }))],
    }));
    const carte = heatmap({ lundi, fuseau, pas, joueurs, seuil: Math.max(1, comptes.length) });
    return { ...carte, fuseau, pas, total: comptes.length, noms: await pseudosDe(base, comptes), sansCreneaux: comptes.filter(c => !d.get(c).regles.length) };
  }

  /**
   * `POST /cm/reunions/creneaux { participants, duree, du, au, fuseau, heureMin, heureMax, sauf }` : « Trouver un
   * créneau » : meilleurs créneaux (tous libres d'abord), avec qui est libre / occupé / absent pour chacun.
   */
  async function trouverCreneaux(acteur, corps) {
    await ctx(acteur, { exigerVoir: true });
    const comptes = [...new Set([acteur.compte, ...((await lireParticipants(corps?.participants ?? [], acteur.compte)) ?? [])])];
    const duree = Number(corps?.duree ?? 30);
    if (!Number.isInteger(duree) || duree < 15 || duree > 480) throw echec(400, 'duree', 'Durée : 15 à 480 minutes.');
    const fuseau = lireFuseau(corps?.fuseau);
    const t = maintenant();
    const debutJour = corps?.du ? lireDate(corps.du) : dateLocale(fuseau, t);
    if (!debutJour) throw echec(400, 'date', 'Date invalide (AAAA-MM-JJ).');
    const jours = Math.min(Math.max(Number(corps?.jours ?? 7), 1), 21);
    const du = instantMural(fuseau, debutJour, 0);
    const au = instantMural(fuseau, debutJour, jours * 1440);
    const heureMin = corps?.heureMin !== undefined ? lireHeure(corps.heureMin) : 8 * 60;
    const heureMax = corps?.heureMax !== undefined ? lireHeure(corps.heureMax) : 22 * 60;
    if (heureMin === undefined || heureMax === undefined || heureMax <= heureMin) throw echec(400, 'heure', 'Plage horaire invalide.');
    const sauf = corps?.sauf ? exigerUuid(corps.sauf, 'reunion') : undefined;
    const d = await disposDe(comptes, du - JOUR_MS, au + JOUR_MS);
    const occ = await occupationsDe(comptes, du, au, { sauf });
    const profils = await profilsDe(comptes);
    const participants = comptes.map(compte => ({ compte, fuseau: profils.get(compte)?.fuseau ?? FUSEAU_DEFAUT, regles: d.get(compte).regles, exceptions: d.get(compte).exceptions, occupes: occ.get(compte) ?? [] }));
    const propositions = proposerCreneaux({ participants, du, au, duree, pas: 30, fuseau, heureMin, heureMax, max: Number(corps?.max) > 0 ? Math.min(Number(corps.max), 20) : 8, maintenant: t });
    return {
      propositions: propositions.map(p => ({ ...p, local: { ...local(fuseau, Date.parse(p.debut)), heureFin: local(fuseau, Date.parse(p.fin)).heure } })),
      participants: participants.map(p => ({ compte: p.compte, fuseau: p.fuseau, sansCreneaux: !p.regles.length })),
      noms: await pseudosDe(base, comptes),
      fuseau,
    };
  }

  /** `GET /cm/reunions/comptes?q` : comptes à inviter (équipe CM d'abord, puis tout le club). */
  async function comptes(acteur, { q = '' } = {}) {
    await ctx(acteur, { exigerVoir: true });
    const equipe = await comptesEquipeCm(base);
    const motif = `%${String(q).toLocaleLowerCase('fr').replace(/[%_\\]/g, '').slice(0, 40)}%`;
    const lignes = await base.tous('SELECT id, pseudo FROM comptes WHERE pseudo_cle LIKE ? ORDER BY pseudo_cle LIMIT 200', [motif]);
    return { comptes: lignes.map(l => ({ compte: l.id, pseudo: l.pseudo, equipe: equipe.has(l.id) })).sort((a, b) => Number(b.equipe) - Number(a.equipe)) };
  }

  // -------------------------------------------------------------- Rendez-vous

  const offrePublique = (o, creneaux, noms) => ({
    id: o.id,
    proprietaire: o.proprietaire_id ?? null,
    proprietairePseudo: noms[o.proprietaire_id] ?? null,
    titre: o.titre,
    description: o.description,
    dureeMinutes: Number(o.duree_minutes),
    fuseau: o.fuseau,
    lieuGenre: o.lieu_genre,
    lieu: o.lieu,
    lien: o.lien ?? null,
    ouverte: Number(o.ouverte) === 1,
    creneaux: creneaux.map(c => ({ id: c.id, debut: c.debut, fin: c.fin, reserve: Boolean(c.reserve_par), reservePar: c.reserve_par ?? null, reunionId: c.reunion_id ?? null, local: { ...local(o.fuseau, Date.parse(c.debut)), heureFin: local(o.fuseau, Date.parse(c.fin)).heure } })),
  });

  /** `GET /cm/reunions/rdv` : offres ouvertes (créneaux à venir), les miennes en entier. */
  async function rdv(acteur) {
    const c = await ctx(acteur, { exigerVoir: true });
    const t = maintenant();
    const offres = await base.tous('SELECT * FROM cm_rdv_offres WHERE ouverte = 1 OR proprietaire_id = ? ORDER BY cree_le DESC LIMIT 100', [acteur.compte]);
    const noms = await pseudosDe(base, offres.map(o => o.proprietaire_id).filter(Boolean));
    const sortie = [];
    for (const o of offres) {
      const mienne = o.proprietaire_id === acteur.compte || c.gerer;
      const creneaux = await base.tous('SELECT * FROM cm_rdv_creneaux WHERE offre_id = ? AND fin > ? ORDER BY debut LIMIT 200', [o.id, iso(t)]);
      // Les autres ne voient que les créneaux libres (et ceux qu'ils ont réservés), jamais qui a réservé quoi.
      const visibles = mienne ? creneaux : creneaux.filter(x => !x.reserve_par || x.reserve_par === acteur.compte).map(x => (x.reserve_par === acteur.compte ? x : { ...x, reserve_par: null, reunion_id: null }));
      sortie.push({ ...offrePublique(o, visibles, noms), mienne: o.proprietaire_id === acteur.compte });
    }
    const reserveurs = sortie.flatMap(o => o.creneaux.map(x => x.reservePar)).filter(Boolean);
    return { offres: sortie, noms: { ...noms, ...(await pseudosDe(base, reserveurs)) } };
  }

  /**
   * `POST /cm/reunions/rdv { titre, description, dureeMinutes, fuseau, lieuGenre, lieu, lien, plages: [{ date,
   * heureDebut, heureFin }] }` : propose des créneaux de rendez-vous (chaque plage est découpée en créneaux).
   */
  async function creerOffre(acteur, corps) {
    await ctx(acteur, { exigerVoir: true });
    const titre = texteNettoye(corps?.titre, 140);
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const duree = Number(corps?.dureeMinutes ?? 30);
    if (!Number.isInteger(duree) || duree < 10 || duree > 240) throw echec(400, 'duree', 'Durée d’un rendez-vous : 10 à 240 minutes.');
    const fuseau = lireFuseau(corps?.fuseau);
    const lieu = lireLieu(corps);
    const plages = Array.isArray(corps?.plages) ? corps.plages : [];
    if (!plages.length || plages.length > 30) throw echec(400, 'plages', 'Indiquez de 1 à 30 plages.');
    const t = maintenant();
    const creneaux = [];
    for (const p of plages) {
      const h = lireHoraire({ ...p, fuseau }, fuseau);
      for (const x of decouperPlage(h.debut, h.fin, duree)) if (x.debut > t && !creneaux.some(y => y.debut === x.debut)) creneaux.push(x);
    }
    if (!creneaux.length) throw echec(400, 'plages', 'Aucun créneau à venir dans ces plages.');
    if (creneaux.length > 200) throw echec(400, 'plages', '200 créneaux au plus.');
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO cm_rdv_offres (id, proprietaire_id, titre, description, duree_minutes, fuseau, lieu_genre, lieu, lien, ouverte, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', params: [id, acteur.compte, titre, texteNettoye(corps?.description ?? '', 1000), duree, fuseau, lieu.genre, lieu.lieu, lieu.lien, iso(t), iso(t)] },
      ...creneaux.sort((a, b) => a.debut - b.debut).map(x => ({ sql: 'INSERT INTO cm_rdv_creneaux (id, offre_id, debut, fin) VALUES (?, ?, ?, ?)', params: [nouvelId(), id, iso(x.debut), iso(x.fin)] })),
    ]);
    return rdv(acteur);
  }

  async function offreLigne(acteur, id) {
    const c = await ctx(acteur, { exigerVoir: true });
    exigerUuid(id, 'offre');
    const o = await base.premier('SELECT * FROM cm_rdv_offres WHERE id = ?', [id]);
    if (!o) throw echec(404, 'offre-introuvable', 'Rendez-vous introuvable.');
    if (o.proprietaire_id !== acteur.compte && !c.gerer) throw echec(403, 'permission', 'Seule la personne qui propose ces rendez-vous les modifie.');
    return o;
  }

  async function modifierOffre(acteur, id, corps) {
    const o = await offreLigne(acteur, id);
    await base.executer('UPDATE cm_rdv_offres SET ouverte = ?, maj_le = ? WHERE id = ?', [corps?.ouverte === false ? 0 : 1, iso(maintenant()), o.id]);
    return rdv(acteur);
  }

  /** `DELETE /cm/reunions/rdv/:id` : retire l'offre et ses créneaux libres (les rendez-vous réservés restent). */
  async function supprimerOffre(acteur, id) {
    const o = await offreLigne(acteur, id);
    const reserves = await base.premier('SELECT COUNT(*) AS n FROM cm_rdv_creneaux WHERE offre_id = ? AND reserve_par IS NOT NULL', [o.id]);
    if (Number(reserves?.n ?? 0) > 0) {
      await base.lot([
        { sql: 'DELETE FROM cm_rdv_creneaux WHERE offre_id = ? AND reserve_par IS NULL', params: [o.id] },
        { sql: 'UPDATE cm_rdv_offres SET ouverte = 0, maj_le = ? WHERE id = ?', params: [iso(maintenant()), o.id] },
      ]);
    } else await base.executer('DELETE FROM cm_rdv_offres WHERE id = ?', [o.id]);
    return rdv(acteur);
  }

  /**
   * `POST /cm/reunions/rdv/creneaux/:id/reserver { note }` : réserve un créneau. JAMAIS de double réservation : le
   * créneau n'est pris que par un UPDATE conditionnel (`reserve_par IS NULL`) ; le perdant reçoit 409.
   */
  async function reserver(acteur, creneauId, corps) {
    await ctx(acteur, { exigerVoir: true });
    exigerUuid(creneauId, 'creneau');
    const cr = await base.premier('SELECT c.*, o.proprietaire_id, o.titre, o.description, o.fuseau, o.lieu_genre, o.lieu, o.lien, o.ouverte FROM cm_rdv_creneaux c JOIN cm_rdv_offres o ON o.id = c.offre_id WHERE c.id = ?', [creneauId]);
    if (!cr || Number(cr.ouverte) !== 1) throw echec(404, 'creneau-introuvable', 'Créneau introuvable.');
    if (cr.proprietaire_id === acteur.compte) throw echec(409, 'propre-creneau', 'Vous ne pouvez pas réserver votre propre créneau.');
    const t = maintenant();
    if (Date.parse(cr.debut) <= t) throw echec(409, 'creneau-passe', 'Ce créneau est passé.');
    const pris = await base.executer('UPDATE cm_rdv_creneaux SET reserve_par = ?, reserve_le = ? WHERE id = ? AND reserve_par IS NULL', [acteur.compte, iso(t), cr.id]);
    if (pris.changements !== 1) throw echec(409, 'creneau-reserve', 'Ce créneau vient d’être réservé par quelqu’un d’autre.');
    try {
      const note = texteNettoye(corps?.note ?? '', 500);
      // La réunion appartient à la personne qui propose (organisatrice) ; la personne qui réserve a déjà accepté.
      const proprietaire = { compte: cr.proprietaire_id, superAdmin: false };
      const d = await creer(
        proprietaire,
        { titre: cr.titre, debut: cr.debut, fin: cr.fin, fuseau: cr.fuseau, lieuGenre: cr.lieu_genre, lieu: cr.lieu, lien: cr.lien ?? undefined, participants: [acteur.compte], ordreDuJour: note, rappelMinutes: 15 },
        {
          rdv: true,
          creneauId: cr.id,
          accepte: [acteur.compte],
          lot: [evenement('cm.rdv_reserve', { acteur: acteur.compte, entiteType: 'cm_rdv_creneau', entiteId: cr.id, charge: { titre: cr.titre, debut: cr.debut, fin: cr.fin, fuseau: cr.fuseau, proprietaire: cr.proprietaire_id, compte: acteur.compte, offre: cr.offre_id }, maintenant: t })],
        },
      );
      await base.executer('UPDATE cm_rdv_creneaux SET reunion_id = ? WHERE id = ?', [d.reunion.id, cr.id]);
      return detail(acteur, d.reunion.id);
    } catch (e) {
      await base.executer('UPDATE cm_rdv_creneaux SET reserve_par = NULL, reserve_le = NULL WHERE id = ? AND reserve_par = ?', [cr.id, acteur.compte]);
      throw e;
    }
  }

  // -------------------------------------------------------------- iCal

  async function icsDe(acteur, nom) {
    const c = await ctx(acteur);
    const t = maintenant();
    const du = t - 30 * JOUR_MS;
    const au = t + 120 * JOUR_MS;
    const lignes = await candidates(du, au);
    const parts = await participantsDe(lignes.map(r => r.id));
    // L'abonnement de chacun : SES réunions (organisées ou invitées, sauf refusées), jamais les notes.
    const miennes = lignes.filter(r => (parts.get(r.id) ?? []).some(p => p.compte_id === acteur.compte && p.reponse !== 'refuse') && peutVoir(c, r, parts.get(r.id) ?? []));
    const occ = await occurrencesDe(miennes, du, au);
    const sorties = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AppliBourse//Esport reunions CM//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${echapper(nom)}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ];
    for (const { r, o } of occ) {
      const lieu = r.lieu_genre === 'lien' || r.lieu_genre === 'discord' ? (r.lien ?? r.lieu) : r.lieu;
      sorties.push(
        'BEGIN:VEVENT',
        `UID:cm-${r.id}-${dateIcs(Date.parse(o.cle))}@esport.applibourse`,
        `DTSTAMP:${dateIcs(t)}`,
        `DTSTART:${dateIcs(o.debut)}`,
        `DTEND:${dateIcs(o.fin)}`,
        `SUMMARY:${echapper(r.titre)}`,
        ...(lieu ? [`LOCATION:${echapper(lieu)}`] : []),
        ...(r.lien ? [`URL:${echapper(r.lien)}`] : []),
        `LAST-MODIFIED:${dateIcs(Date.parse(r.maj_le))}`,
        'END:VEVENT',
      );
    }
    sorties.push('END:VCALENDAR');
    return `${sorties.map(plier).join('\r\n')}\r\n`;
  }

  async function exportIcs(acteur) {
    return { nom: 'reunions-cm.ics', type: 'text/calendar; charset=utf-8', contenu: await icsDe(acteur, 'Réunions CM') };
  }

  const jetonPublic = j => ({ id: j.id, libelle: j.libelle, creeLe: j.cree_le, dernierAcces: j.dernier_acces_le ?? null, revoque: Boolean(j.revoque_le) });

  async function jetonsIcal(acteur) {
    await ctx(acteur);
    return { abonnements: (await base.tous('SELECT * FROM cm_reunion_ical WHERE compte_id = ? ORDER BY cree_le DESC LIMIT 20', [acteur.compte])).map(jetonPublic) };
  }

  async function creerJetonIcal(acteur, corps) {
    await ctx(acteur);
    const actifs = await base.premier('SELECT COUNT(*) AS n FROM cm_reunion_ical WHERE compte_id = ? AND revoque_le IS NULL', [acteur.compte]);
    if (Number(actifs?.n ?? 0) >= 5) throw echec(409, 'trop-de-jetons', 'Cinq abonnements actifs au plus : révoquez-en un d’abord.');
    const jeton = `cmr_${aleatoire(32)}`;
    const id = nouvelId();
    const libelle = texteNettoye(corps?.libelle ?? '', 60);
    const t = maintenant();
    await base.executer('INSERT INTO cm_reunion_ical (id, compte_id, super_admin, jeton_hash, libelle, cree_le) VALUES (?, ?, ?, ?, ?, ?)', [id, acteur.compte, acteur.superAdmin ? 1 : 0, await sha256Hex(jeton), libelle, iso(t)]);
    return { jeton, chemin: `/cm-reunions/ical/${jeton}.ics`, abonnement: jetonPublic({ id, libelle, cree_le: iso(t) }) };
  }

  async function revoquerJetonIcal(acteur, id) {
    await ctx(acteur);
    exigerUuid(id, 'jeton');
    const r = await base.executer('UPDATE cm_reunion_ical SET revoque_le = ? WHERE id = ? AND compte_id = ? AND revoque_le IS NULL', [iso(maintenant()), id, acteur.compte]);
    if (r.changements !== 1) throw echec(404, 'jeton-introuvable', 'Abonnement introuvable.');
    return jetonsIcal(acteur);
  }

  /** `GET /cm-reunions/ical/<jeton>.ics` (sans session) : jeton actif ; 404 sans rien dire sinon. */
  async function icsAbonnement(jeton) {
    const inconnu = () => echec(404, 'ical-inconnu', 'Calendrier introuvable.');
    if (typeof jeton !== 'string' || !MOTIF_JETON.test(jeton)) throw inconnu();
    const j = await base.premier('SELECT * FROM cm_reunion_ical WHERE jeton_hash = ?', [await sha256Hex(jeton)]);
    if (!j || j.revoque_le) throw inconnu();
    await base.executer('UPDATE cm_reunion_ical SET dernier_acces_le = ? WHERE id = ?', [iso(maintenant()), j.id]);
    return { nom: 'reunions-cm.ics', type: 'text/calendar; charset=utf-8', contenu: await icsDe({ compte: j.compte_id, superAdmin: Number(j.super_admin) === 1 }, 'Réunions CM') };
  }

  return {
    moi,
    agenda,
    detail,
    creer,
    modifier,
    annuler,
    repondre,
    ecrireNotes,
    ajouterTache,
    modifierTache,
    supprimerTache,
    tacheVersCarte,
    mesDispos,
    remplacerRegles,
    ajouterException,
    supprimerException,
    changerStatut,
    grilleEquipe,
    trouverCreneaux,
    comptes,
    rdv,
    creerOffre,
    modifierOffre,
    supprimerOffre,
    reserver,
    exportIcs,
    jetonsIcal,
    creerJetonIcal,
    revoquerJetonIcal,
    icsAbonnement,
    // Lectures internes (rappels).
    occurrencesDe,
    participantsDe,
    candidates,
  };
}

export { MINUTE };

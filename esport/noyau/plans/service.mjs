/**
 * Plans de match (migration 0083, module `plans_match`) : la préparation d'un match pour toute la team.
 *
 *  - Un plan appartient à une team ; il peut être lié à un événement du planning (match, scrim, tournoi : une
 *    occurrence précise), à une fiche de scouting, à un match de tournoi, puis à son résultat et à l'événement
 *    « Review » de son debrief.
 *  - Contenu (JSON validé ici, 96 Ko au plus) : veto ordonné (ban / pick / decider, replis, notes), une section par
 *    map (composition, strats ordonnées par side et type de round prises dans les strats et le playbook, lineups
 *    clés, conditions de victoire, tendances adverses, calls, notes), checklist d'avant-match, notes générales.
 *  - Statuts : brouillon (staff seulement) → prêt (toute la team le lit et est notifiée) → joué.
 *  - Modèles (staff), duplication, corbeille de 30 jours.
 *
 * Droits : `plans.voir` (lire les plans prêts et joués), `plans.editer` (tout). Contrôles, dans l'ordre :
 * appartenance (contexteTeam) → module `plans_match` activé (sinon 404) → permission (sinon 403).
 *
 * Contenu TACTIQUE : jamais envoyé à une IA externe (ia/confidentialite.mjs) ; les événements émis ne portent que le
 * titre, l'adversaire et la date (l'annonce Discord facultative « plan prêt » n'a donc rien de tactique à montrer).
 */

import { evenement } from '../evenements.mjs';
import { autorise } from '../permissions.mjs';
import { estOccurrence } from '../planning/recurrence.mjs';
import { dateLocale, lireDate, partiesLocales, texteDate, texteHeure } from '../planning/temps.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { distincts, lignesParIds, pseudosDe } from '../requetes.mjs';
import { modeleDuJeu } from '../strats/modeles.mjs';

export const MODULE_PLANS = 'plans_match';
export const STATUTS_PLAN = ['brouillon', 'pret', 'joue'];
export const FORMATS_PLAN = ['', 'bo1', 'bo3', 'bo5'];
export const ACTIONS_VETO = ['ban', 'pick', 'decider'];
export const CAMPS_VETO = ['nous', 'eux'];
export const TYPES_ROUND = ['pistol', 'eco', 'force', 'bonus', 'defaut', 'execution', 'retake', 'autre'];
/** Événements du planning auxquels un plan se lie. */
export const TYPES_EVENEMENT_PLAN = ['match', 'scrim', 'tournament'];
export const TAILLE_MAX_CONTENU = 96 * 1024;
export const DUREE_CORBEILLE_PLANS_MS = 30 * 86_400_000;
export const LIMITES_PLAN = Object.freeze({ veto: 14, replis: 3, cartes: 9, compo: 8, strats: 30, lineups: 20, checklist: 30, reserve: 6 });
const PLANS_MAX = 500;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MOTIF_ID_COURT = /^[a-z0-9]{4,16}$/;
const MOTIF_SIDE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
const MOTIF_COMPTE = /^[A-Za-z0-9_-]{3,64}$/;

const estUuid = v => typeof v === 'string' && MOTIF_UUID.test(v);
const uuidOuNull = (v, quoi) => {
  if (v === null || v === undefined || v === '') return null;
  if (!estUuid(v)) throw echec(400, quoi, 'Identifiant illisible.');
  return v;
};
const liste = (v, max, quoi) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw echec(400, quoi, `Liste illisible ou trop longue (${max} au plus).`);
  return v;
};
const reference = (v, quoi, obligatoire = false) => {
  if (v === null || v === undefined || v === '') {
    if (obligatoire) throw echec(400, quoi, 'Choix requis.');
    return null;
  }
  if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, quoi, 'Choix illisible.');
  const nom = texteNettoye(v.nom, 60);
  const cle = typeof v.cle === 'string' && MOTIF_REFERENCE.test(v.cle) ? v.cle : null;
  if (!cle && !nom) {
    if (obligatoire) throw echec(400, quoi, 'Choix requis.');
    return null;
  }
  return { cle, nom: nom || cle };
};

/** Identifiants courts des éléments d'une liste : gardés s'ils sont valides et uniques, sinon recréés. */
function avecIds(elements) {
  const vus = new Set();
  return elements.map(e => {
    let id = typeof e.id === 'string' && MOTIF_ID_COURT.test(e.id) && !vus.has(e.id) ? e.id : nouvelId().replace(/-/g, '').slice(0, 12);
    while (vus.has(id)) id = nouvelId().replace(/-/g, '').slice(0, 12);
    vus.add(id);
    return { ...e, id };
  });
}

/**
 * Contenu d'un plan, validé et normalisé (pur, testé). Les références (strats, entrées du playbook, lineups,
 * membres) sont seulement vérifiées dans leur forme ici ; leur existence dans la team l'est par le service.
 */
export function lireContenu(brut) {
  const c = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {};
  const veto = avecIds(
    liste(c.veto, LIMITES_PLAN.veto, 'veto').map(v => {
      if (!ACTIONS_VETO.includes(v?.action)) throw echec(400, 'veto', 'Action de veto : ban, pick ou decider.');
      if (!CAMPS_VETO.includes(v?.camp)) throw echec(400, 'veto', 'Camp du veto : nous ou eux.');
      return { id: v.id, action: v.action, camp: v.camp, carte: reference(v.carte, 'veto'), replis: liste(v.replis, LIMITES_PLAN.replis, 'veto').map(r => reference(r, 'veto')).filter(Boolean), note: texteNettoye(v.note, 200) };
    }),
  );
  const cartes = avecIds(
    liste(c.cartes, LIMITES_PLAN.cartes, 'cartes').map(k => {
      const compo = avecIds(
        liste(k?.compo, LIMITES_PLAN.compo, 'compo').map(l => {
          const membre = l?.membre === null || l?.membre === undefined || l?.membre === '' ? null : l.membre;
          if (membre !== null && (typeof membre !== 'string' || !MOTIF_COMPTE.test(membre))) throw echec(400, 'compo', 'Joueur illisible.');
          return {
            id: l?.id,
            membre,
            nom: texteNettoye(l?.nom, 40),
            personnage: reference(l?.personnage, 'compo'),
            role: texteNettoye(l?.role, 30),
            arme: texteNettoye(l?.arme, 40),
            specialisation: texteNettoye(l?.specialisation, 40),
            gadgets: liste(l?.gadgets, 3, 'compo').map(g => texteNettoye(g, 40)),
            reserve: liste(l?.reserve, LIMITES_PLAN.reserve, 'compo').map(g => texteNettoye(g, 40)).filter(Boolean),
            note: texteNettoye(l?.note, 200),
          };
        }),
      );
      const strats = avecIds(
        liste(k?.strats, LIMITES_PLAN.strats, 'strats').map(s => {
          if (!TYPES_ROUND.includes(s?.type)) throw echec(400, 'strats', 'Type de round inconnu.');
          const side = s?.side === undefined || s?.side === null ? '' : s.side;
          if (side !== '' && (typeof side !== 'string' || !MOTIF_SIDE.test(side))) throw echec(400, 'strats', 'Side illisible.');
          const strat = uuidOuNull(s?.strat, 'strats');
          const playbook = strat ? null : uuidOuNull(s?.playbook, 'strats');
          const titre = texteNettoye(s?.titre, 80);
          if (!strat && !playbook && titre.length < 1) throw echec(400, 'strats', 'Une strat prévue a besoin d’une strat, d’une entrée du playbook ou d’un titre.');
          return { id: s?.id, side, type: s.type, strat, playbook, titre, note: texteNettoye(s?.note, 300) };
        }),
      );
      const lineups = distincts(liste(k?.lineups, LIMITES_PLAN.lineups, 'lineups').map(x => (typeof x === 'string' ? x : x?.id)));
      if (lineups.some(x => !estUuid(x))) throw echec(400, 'lineups', 'Lineup illisible.');
      const mode = k?.mode === undefined || k?.mode === null ? '' : k.mode;
      if (mode !== '' && (typeof mode !== 'string' || !MOTIF_SIDE.test(mode))) throw echec(400, 'cartes', 'Mode illisible.');
      return { id: k?.id, carte: reference(k?.carte, 'cartes', true), mode, compo, strats, lineups, conditions: texteLong(k?.conditions, 1500), tendances: texteLong(k?.tendances, 1500), calls: texteLong(k?.calls, 1500), notes: texteLong(k?.notes, 1500) };
    }),
  );
  const checklist = avecIds(liste(c.checklist, LIMITES_PLAN.checklist, 'checklist').map(e => ({ id: e?.id, texte: texteNettoye(e?.texte, 120) })).filter(e => e.texte));
  const contenu = { veto, cartes, checklist, notes: texteLong(c.notes, 4000) };
  if (JSON.stringify(contenu).length > TAILLE_MAX_CONTENU) throw echec(413, 'plan-trop-gros', 'Plan trop volumineux : raccourcissez les notes.');
  return contenu;
}

const contenuDe = ligne => {
  const c = jsonOu(ligne.contenu, {});
  return { veto: Array.isArray(c?.veto) ? c.veto : [], cartes: Array.isArray(c?.cartes) ? c.cartes : [], checklist: Array.isArray(c?.checklist) ? c.checklist : [], notes: typeof c?.notes === 'string' ? c.notes : '' };
};
const cochesDe = ligne => {
  const l = jsonOu(ligne.coches, []);
  return Array.isArray(l) ? l.filter(x => typeof x === 'string') : [];
};

export function servicesPlans({ base, maintenant = () => Date.now(), socle, strats, planning }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_PLANS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }
  const introuvable = () => echec(404, 'plan-introuvable', 'Plan de match introuvable.');
  /** Un lecteur sans `plans.editer` ne voit ni les brouillons ni les modèles. */
  const lisible = (ctx, p) => peut(ctx, 'plans.editer') || (p.statut !== 'brouillon' && Number(p.est_modele) !== 1);

  async function planDeTeam(ctx, id, { supprime = false } = {}) {
    if (!estUuid(id)) throw introuvable();
    const p = await base.premier(`SELECT * FROM plans_match WHERE id = ? AND team_id = ? AND supprime_le IS ${supprime ? 'NOT ' : ''}NULL`, [id, ctx.team.id]);
    if (!p || !lisible(ctx, p)) throw introuvable();
    return p;
  }

  // -------------------------------------------------------------- Liens (événement, adversaire, tournoi, résultat)

  /** Occurrence d'un événement du planning : début effectif (exception comprise), jour et heure dans le fuseau de la team. */
  function occurrencePublique(ev, cle, exception, fuseau) {
    const debut = exception?.debut ?? (ev.recurrence ? cle : ev.debut);
    const t = Date.parse(debut);
    const l = partiesLocales(fuseau, t);
    return { id: ev.id, occurrence: cle, titre: exception?.titre ?? ev.titre, type: ev.type, debut: iso(t), jour: texteDate(dateLocale(fuseau, t)), heure: texteHeure(l.heure * 60 + l.minute), adversaireId: ev.adversaire_id ?? null };
  }

  /** Événements liés des plans donnés, relus au planning (déplacés, renommés ou supprimés depuis). */
  async function evenementsDe(ctx, plans) {
    const ids = distincts(plans.map(p => p.evenement_id));
    const sortie = new Map();
    if (!ids.length) return sortie;
    const evs = new Map((await lignesParIds(base, 'SELECT * FROM planning_evenements WHERE supprime_le IS NULL AND team_id = ? AND id', ids, { paramsAvant: [ctx.team.id] })).map(e => [e.id, e]));
    const exceptions = await lignesParIds(base, 'SELECT * FROM planning_exceptions WHERE evenement_id', ids);
    for (const p of plans) {
      const ev = p.evenement_id ? evs.get(p.evenement_id) : null;
      if (!ev || !p.occurrence) continue;
      const x = exceptions.find(e => e.evenement_id === ev.id && e.occurrence === p.occurrence);
      if (x && Number(x.annulee) === 1) continue;
      if (ev.recurrence ? !estOccurrence(ev, p.occurrence) : false) continue;
      const o = occurrencePublique(ev, p.occurrence, x, ctx.team.fuseau);
      sortie.set(p.id, { id: o.id, occurrence: o.occurrence, titre: o.titre, type: o.type, debut: o.debut, heure: o.heure, jour: o.jour });
    }
    return sortie;
  }

  /** Lit et vérifie le lien vers une occurrence du planning : `{ evenement_id, occurrence, date_match, debut_match, adversaire }`. */
  async function lireEvenement(ctx, evenementId, occurrence) {
    if (!estUuid(evenementId)) throw echec(400, 'evenement', 'Événement inconnu.');
    const ev = await base.premier('SELECT * FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [evenementId, ctx.team.id]);
    if (!ev || !TYPES_EVENEMENT_PLAN.includes(ev.type)) throw echec(400, 'evenement', 'Événement inconnu (match, scrim ou tournoi du planning).');
    let cle = ev.debut;
    if (ev.recurrence) {
      const t = Date.parse(occurrence);
      if (Number.isNaN(t) || !estOccurrence(ev, iso(t))) throw echec(400, 'occurrence', 'Date de l’événement inconnue.');
      cle = iso(t);
    } else if (occurrence && !Number.isNaN(Date.parse(occurrence))) cle = iso(Date.parse(occurrence));
    const x = await base.premier('SELECT * FROM planning_exceptions WHERE evenement_id = ? AND occurrence = ?', [ev.id, cle]);
    if (x && Number(x.annulee) === 1) throw echec(400, 'occurrence', 'Cette date de l’événement est annulée.');
    const o = occurrencePublique(ev, cle, x, ctx.team.fuseau);
    return { evenement_id: ev.id, occurrence: cle, date_match: o.jour, debut_match: o.debut, adversaire: ev.adversaire_id ?? null, titre: o.titre };
  }

  async function adversaireDe(ctx, id) {
    const a = await base.premier('SELECT id, nom FROM adversaires WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, ctx.team.id]);
    if (!a) throw echec(400, 'adversaire', 'Adversaire inconnu.');
    return a;
  }

  /** Références du contenu : membres actifs, strats visibles, entrées du playbook et lineups de la team (titres recopiés). */
  async function verifierReferences(ctx, contenu, ancien) {
    const teamId = ctx.team.id;
    const dejaLa = (genre, id) => (ancien?.cartes ?? []).some(k => (genre === 'lineup' ? (k.lineups ?? []).includes(id) : genre === 'membre' ? (k.compo ?? []).some(l => l.membre === id) : (k.strats ?? []).some(s => s[genre] === id)));
    const membres = distincts(contenu.cartes.flatMap(k => k.compo.map(l => l.membre)));
    if (membres.length) {
      const actifs = new Set((await lignesParIds(base, "SELECT compte_id FROM membres WHERE statut = 'actif' AND team_id = ? AND compte_id", membres, { paramsAvant: [teamId] })).map(m => m.compte_id));
      // Un ancien membre déjà dans le plan y reste (son nom s'affiche tel quel) ; on n'en ajoute pas de nouveau.
      if (membres.some(m => !actifs.has(m) && !dejaLa('membre', m))) throw echec(400, 'compo', 'Un joueur de la composition n’est pas membre de la team.');
    }
    const idsStrats = distincts(contenu.cartes.flatMap(k => k.strats.map(s => s.strat)));
    const lignesStrats = idsStrats.length ? await lignesParIds(base, 'SELECT id, titre, visibilite, cree_par FROM strats WHERE supprime_le IS NULL AND team_id = ? AND id', idsStrats, { paramsAvant: [teamId] }) : [];
    const parStrat = new Map(lignesStrats.map(s => [s.id, s]));
    const idsPlaybook = distincts(contenu.cartes.flatMap(k => k.strats.map(s => s.playbook)));
    const parPlaybook = new Map((idsPlaybook.length ? await lignesParIds(base, 'SELECT id, titre FROM playbook_entrees WHERE supprime_le IS NULL AND team_id = ? AND id', idsPlaybook, { paramsAvant: [teamId] }) : []).map(e => [e.id, e]));
    for (const k of contenu.cartes) {
      for (const s of k.strats) {
        if (s.strat) {
          const ligne = parStrat.get(s.strat);
          if (ligne && (strats?.visible?.(ctx, ligne) ?? true)) s.titre = ligne.titre;
          else if (!dejaLa('strat', s.strat)) throw echec(400, 'strats', 'Strat inconnue.');
        } else if (s.playbook) {
          const ligne = parPlaybook.get(s.playbook);
          if (ligne) s.titre = ligne.titre;
          else if (!dejaLa('playbook', s.playbook)) throw echec(400, 'strats', 'Entrée du playbook inconnue.');
        }
        if (!s.titre) s.titre = '?';
      }
    }
    const idsLineups = distincts(contenu.cartes.flatMap(k => k.lineups));
    if (idsLineups.length) {
      const connus = new Set((await lignesParIds(base, 'SELECT id FROM lineups WHERE supprime_le IS NULL AND team_id = ? AND id', idsLineups, { paramsAvant: [teamId] })).map(l => l.id));
      if (idsLineups.some(id => !connus.has(id) && !dejaLa('lineup', id))) throw echec(400, 'lineups', 'Lineup inconnu.');
    }
    return contenu;
  }

  // -------------------------------------------------------------- Formes publiques

  async function resumes(ctx, lignes) {
    const pseudos = await pseudosDe(base, lignes.map(p => p.cree_par));
    const evs = await evenementsDe(ctx, lignes);
    return lignes.map(p => {
      const contenu = contenuDe(p);
      const coches = new Set(cochesDe(p));
      const ev = evs.get(p.id) ?? null;
      return {
        id: p.id,
        titre: p.titre,
        statut: p.statut,
        estModele: Number(p.est_modele) === 1,
        dateMatch: ev?.jour ?? p.date_match ?? null,
        debut: ev?.debut ?? (p.evenement_id ? null : (p.debut_match ?? null)),
        adversaire: p.adversaire_id || p.adversaire_nom ? { id: p.adversaire_id ?? null, nom: p.adversaire_nom } : null,
        format: p.format,
        cartes: contenu.cartes.map(k => k.carte?.nom ?? '').filter(Boolean),
        evenement: ev ? { id: ev.id, occurrence: ev.occurrence, titre: ev.titre, type: ev.type, debut: ev.debut, heure: ev.heure } : null,
        checklist: { faits: contenu.checklist.filter(e => coches.has(e.id)).length, total: contenu.checklist.length },
        creePar: { compte: p.cree_par ?? null, pseudo: p.cree_par ? (pseudos[p.cree_par] ?? null) : null },
        majLe: p.maj_le,
      };
    });
  }

  async function planPublic(ctx, p) {
    const [resume] = await resumes(ctx, [p]);
    const teamId = ctx.team.id;
    const contenu = contenuDe(p);
    const membres = distincts(contenu.cartes.flatMap(k => (k.compo ?? []).map(l => l.membre)));
    const pseudos = await pseudosDe(base, membres);
    const idsStrats = distincts(contenu.cartes.flatMap(k => (k.strats ?? []).map(s => s.strat)));
    const voitStrats = ctx.modules.has('strat_editor') && peut(ctx, 'strats.view');
    const stratsVues = new Map((idsStrats.length ? await lignesParIds(base, 'SELECT id, titre, visibilite, cree_par FROM strats WHERE supprime_le IS NULL AND team_id = ? AND id', idsStrats, { paramsAvant: [teamId] }) : []).map(s => [s.id, s]));
    const idsLineups = distincts(contenu.cartes.flatMap(k => k.lineups ?? []));
    const voitLineups = ctx.modules.has('lineups') && peut(ctx, 'lineups.voir');
    const lineups = new Map((idsLineups.length ? await lignesParIds(base, 'SELECT id, titre, personnage_nom, capacite_nom, zone_nom FROM lineups WHERE supprime_le IS NULL AND team_id = ? AND id', idsLineups, { paramsAvant: [teamId] }) : []).map(l => [l.id, l]));
    const cartes = contenu.cartes.map(k => ({
      id: k.id,
      carte: k.carte,
      mode: k.mode ?? '',
      compo: (k.compo ?? []).map(l => ({ ...l, pseudo: l.membre ? (pseudos[l.membre] ?? null) : null, moi: Boolean(l.membre) && l.membre === ctx.acteur.compte })),
      strats: (k.strats ?? []).map(s => {
        const ligne = s.strat ? stratsVues.get(s.strat) : null;
        return { ...s, titre: ligne?.titre ?? s.titre, ouvrable: Boolean(ligne && voitStrats && (strats?.visible?.(ctx, ligne) ?? true)) };
      }),
      // Un lineup supprimé depuis disparaît de la lecture (il reste dans le contenu tant que le plan n'est pas réenregistré).
      lineups: (k.lineups ?? []).flatMap(id => {
        const l = lineups.get(id);
        return l ? [{ id, titre: l.titre, personnage: l.personnage_nom || null, capacite: l.capacite_nom || null, zone: l.zone_nom || null, ouvrable: voitLineups }] : [];
      }),
      conditions: k.conditions ?? '',
      tendances: k.tendances ?? '',
      calls: k.calls ?? '',
      notes: k.notes ?? '',
    }));
    // Fiche de scouting : lue seulement par qui a le droit de la voir (le nom de l'adversaire, lui, fait partie du plan).
    let scouting = null;
    if (p.adversaire_id && ctx.modules.has('scouting') && peut(ctx, 'scouting.view')) {
      const a = await base.premier('SELECT id, nom, notes FROM adversaires WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [p.adversaire_id, teamId]);
      if (a) {
        const tendances = await base.tous('SELECT map, side, notes, taux_victoire FROM adversaire_tendances WHERE adversaire_id = ? AND team_id = ? ORDER BY LOWER(map), side, cree_le LIMIT 60', [a.id, teamId]);
        scouting = { nom: a.nom, notes: a.notes ?? '', tendances: tendances.map(x => ({ map: x.map, side: x.side, notes: x.notes ?? '', tauxVictoire: x.taux_victoire ?? null })) };
      }
    }
    let tournoiMatch = null;
    if (p.tournoi_match_id) {
      const m = await base.premier('SELECT m.id, m.tour, t.nom FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.id = ? AND m.team_id = ? AND m.supprime_le IS NULL', [p.tournoi_match_id, teamId]);
      if (m) tournoiMatch = { id: m.id, tournoi: m.nom, tour: m.tour ?? '' };
    }
    let resultat = null;
    if (p.resultat_id && ctx.modules.has('resultats') && peut(ctx, 'resultats.voir')) {
      const r = await base.premier('SELECT id, date_match, issue, manches_nous, manches_eux, visibilite FROM resultats WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [p.resultat_id, teamId]);
      if (r && (r.visibilite === 'team' || peut(ctx, 'resultats.saisir'))) resultat = { id: r.id, date: String(r.date_match).slice(0, 10), issue: r.issue ?? null, score: scoreDe(r) };
    }
    let debrief = null;
    if (p.debrief_evenement_id) {
      const e = await base.premier('SELECT id, debut FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [p.debrief_evenement_id, teamId]);
      if (e) debrief = { id: e.id, debut: e.debut };
    }
    return {
      ...resume,
      jeu: p.jeu,
      modele: p.modele,
      contenu: { veto: contenu.veto, cartes, checklist: contenu.checklist, notes: contenu.notes },
      coches: cochesDe(p).filter(id => contenu.checklist.some(e => e.id === id)),
      tournoiMatch,
      resultat,
      debrief,
      scouting,
      pretLe: p.pret_le ?? null,
      moi: { editer: peut(ctx, 'plans.editer'), debrief: peut(ctx, 'plans.editer') && ctx.modules.has('planning') && peut(ctx, 'planning.create') },
    };
  }
  const scoreDe = r => (r.manches_nous === null || r.manches_nous === undefined || r.manches_eux === null || r.manches_eux === undefined ? '' : `${r.manches_nous}-${r.manches_eux}`);

  const charge = p => ({ titre: p.titre, adversaire: p.adversaire_nom || null, date: p.date_match ?? null, ...(Number(p.est_modele) === 1 ? { modele: true } : {}) });

  // -------------------------------------------------------------- Lectures

  async function lister(acteur, teamId, q = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.voir');
    const lignes = (await base.tous('SELECT * FROM plans_match WHERE team_id = ? AND supprime_le IS NULL ORDER BY maj_le DESC LIMIT ?', [teamId, PLANS_MAX])).filter(p => lisible(ctx, p));
    const tous = await resumes(ctx, lignes);
    let plans = tous.filter(p => !p.estModele);
    if (q.statut && STATUTS_PLAN.includes(q.statut)) plans = plans.filter(p => p.statut === q.statut);
    if (q.adversaire) plans = plans.filter(p => p.adversaire?.id === q.adversaire);
    return { plans, modeles: tous.filter(p => p.estModele), droits: { editer: peut(ctx, 'plans.editer') } };
  }

  /** Plan d'une occurrence du planning (bouton « Plan de match » d'un événement). */
  async function pourEvenement(acteur, teamId, evenementId, occurrence) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.voir');
    const droits = { editer: peut(ctx, 'plans.editer') };
    if (!estUuid(evenementId)) return { plan: null, droits };
    const t = Date.parse(occurrence ?? '');
    const lignes = (await base.tous('SELECT * FROM plans_match WHERE team_id = ? AND evenement_id = ? AND est_modele = 0 AND supprime_le IS NULL ORDER BY cree_le', [teamId, evenementId])).filter(p => lisible(ctx, p));
    const p = lignes.find(x => !Number.isNaN(t) && x.occurrence === iso(t)) ?? (Number.isNaN(t) ? lignes[0] : undefined);
    return { plan: p ? (await resumes(ctx, [p]))[0] : null, droits };
  }

  /** Prochain plan lié à un événement à venir (ou commencé depuis moins de 4 heures) : carte de l'accueil de la team. */
  async function prochain(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.voir');
    const lignes = (await base.tous("SELECT * FROM plans_match WHERE team_id = ? AND est_modele = 0 AND evenement_id IS NOT NULL AND statut <> 'joue' AND supprime_le IS NULL LIMIT ?", [teamId, PLANS_MAX])).filter(p => lisible(ctx, p));
    const seuil = iso(maintenant() - 4 * 3_600_000);
    const candidats = (await resumes(ctx, lignes)).filter(p => p.evenement && p.evenement.debut >= seuil).sort((a, b) => (a.evenement.debut < b.evenement.debut ? -1 : 1));
    return { plan: candidats[0] ?? null };
  }

  async function detail(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.voir');
    return { plan: await planPublic(ctx, await planDeTeam(ctx, id)) };
  }

  /** Ce que l'éditeur peut lier, chaque liste selon les droits du lecteur. */
  async function liens(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const t = maintenant();
    const sortie = { evenements: [], adversaires: [], matchs: [], resultats: [], membres: [], strats: [], playbook: [], lineups: [] };
    if (ctx.modules.has('planning') && peut(ctx, 'planning.view') && planning?.occurrencesTeam) {
      const occ = await planning.occurrencesTeam(teamId, t - 86_400_000, t + 60 * 86_400_000);
      sortie.evenements = occ
        .filter(({ ev }) => TYPES_EVENEMENT_PLAN.includes(ev.type))
        .slice(0, 80)
        .map(({ ev, o }) => {
          const l = partiesLocales(ctx.team.fuseau, o.debut);
          return { id: ev.id, occurrence: o.cle, titre: o.titre ?? ev.titre, type: ev.type, debut: iso(o.debut), jour: texteDate(dateLocale(ctx.team.fuseau, o.debut)), heure: texteHeure(l.heure * 60 + l.minute), adversaireId: ev.adversaire_id ?? null };
        });
    }
    // Les noms des adversaires servent à nommer le plan ; leurs notes de scouting restent à qui peut les lire.
    sortie.adversaires = (await base.tous('SELECT id, nom FROM adversaires WHERE team_id = ? AND supprime_le IS NULL ORDER BY LOWER(nom) LIMIT 300', [teamId])).map(a => ({ id: a.id, nom: a.nom }));
    if (ctx.modules.has('tournois') && peut(ctx, 'tournois.voir')) {
      const ms = await base.tous("SELECT m.id, m.tour, m.debut, m.evenement_id, t.nom FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND m.statut = 'a_jouer' ORDER BY m.debut LIMIT 60", [teamId]);
      sortie.matchs = ms.map(m => ({ id: m.id, tournoi: m.nom, tour: m.tour ?? '', debut: m.debut ?? null, evenementId: m.evenement_id ?? null }));
    }
    if (ctx.modules.has('resultats') && peut(ctx, 'resultats.voir')) {
      const rs = await base.tous('SELECT r.id, r.date_match, r.issue, r.manches_nous, r.manches_eux, r.evenement_id, r.visibilite, a.nom FROM resultats r LEFT JOIN adversaires a ON a.id = r.adversaire_id WHERE r.team_id = ? AND r.supprime_le IS NULL ORDER BY r.date_match DESC LIMIT 40', [teamId]);
      sortie.resultats = rs.filter(r => r.visibilite === 'team' || peut(ctx, 'resultats.saisir')).map(r => ({ id: r.id, date: String(r.date_match).slice(0, 10), adversaire: r.nom ?? '', issue: r.issue ?? null, score: scoreDe(r), evenementId: r.evenement_id ?? null }));
    }
    const ms = await base.tous("SELECT compte_id FROM membres WHERE team_id = ? AND statut = 'actif' LIMIT 200", [teamId]);
    const pseudos = await pseudosDe(base, ms.map(m => m.compte_id));
    sortie.membres = ms.map(m => ({ compte: m.compte_id, pseudo: pseudos[m.compte_id] ?? m.compte_id })).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
    if (ctx.modules.has('strat_editor') && peut(ctx, 'strats.view')) {
      const ss = await base.tous('SELECT id, titre, carte_nom, side, visibilite, cree_par FROM strats WHERE team_id = ? AND supprime_le IS NULL ORDER BY carte_nom, titre LIMIT 500', [teamId]);
      sortie.strats = ss.filter(s => strats?.visible?.(ctx, s) ?? true).map(s => ({ id: s.id, titre: s.titre, carte: s.carte_nom ?? '', side: s.side ?? '' }));
    }
    if (ctx.modules.has('playbook') && peut(ctx, 'playbook.view')) {
      const es = await base.tous("SELECT id, titre, carte_nom, side FROM playbook_entrees WHERE team_id = ? AND supprime_le IS NULL AND statut <> 'archivee' ORDER BY carte_nom, titre LIMIT 500", [teamId]);
      sortie.playbook = es.map(e => ({ id: e.id, titre: e.titre, carte: e.carte_nom ?? null, side: e.side ?? null }));
    }
    if (ctx.modules.has('lineups') && peut(ctx, 'lineups.voir')) {
      const ls = await base.tous('SELECT id, titre, carte_nom, personnage_nom, capacite_nom FROM lineups WHERE team_id = ? AND supprime_le IS NULL ORDER BY carte_nom, titre LIMIT 1000', [teamId]);
      sortie.lineups = ls.map(l => ({ id: l.id, titre: l.titre, carte: l.carte_nom, personnage: l.personnage_nom || null, capacite: l.capacite_nom || null }));
    }
    return sortie;
  }

  // -------------------------------------------------------------- Écritures

  /** Champs d'en-tête et liens d'une saisie : colonnes à écrire (seuls les champs présents). */
  async function lireSaisie(ctx, corps, existant) {
    const s = {};
    const champ = nom => corps?.[nom] !== undefined;
    if (!existant || champ('titre')) {
      s.titre = texteNettoye(corps?.titre, 80);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (champ('format')) {
      if (!FORMATS_PLAN.includes(corps.format)) throw echec(400, 'format', 'Format : bo1, bo3, bo5 ou vide.');
      s.format = corps.format;
    }
    if (champ('evenementId')) {
      if (corps.evenementId === null || corps.evenementId === '') Object.assign(s, { evenement_id: null, occurrence: null, debut_match: null });
      else if (corps.evenementId !== existant?.evenement_id || (champ('occurrence') && corps.occurrence !== existant?.occurrence)) {
        if (!ctx.modules.has('planning') || !peut(ctx, 'planning.view')) throw echec(400, 'evenement', 'Événement inconnu.');
        const e = await lireEvenement(ctx, corps.evenementId, corps.occurrence);
        const double = await base.premier('SELECT id FROM plans_match WHERE team_id = ? AND evenement_id = ? AND occurrence = ? AND est_modele = 0 AND supprime_le IS NULL AND id <> ?', [ctx.team.id, e.evenement_id, e.occurrence, existant?.id ?? '']);
        if (double) throw echec(409, 'plan-existe', 'Cet événement a déjà un plan de match.');
        Object.assign(s, { evenement_id: e.evenement_id, occurrence: e.occurrence, date_match: e.date_match, debut_match: e.debut_match });
        // L'adversaire de l'événement devient celui du plan, s'il n'en a pas encore.
        if (e.adversaire && !champ('adversaireId') && !existant?.adversaire_id) corps = { ...corps, adversaireId: e.adversaire };
        s._evenementTitre = e.titre;
      }
    }
    if (champ('date') && !(s.evenement_id ?? (champ('evenementId') ? null : existant?.evenement_id))) {
      if (corps.date === null || corps.date === '') s.date_match = null;
      else {
        const d = lireDate(corps.date);
        if (!d) throw echec(400, 'date', 'Date illisible (AAAA-MM-JJ).');
        s.date_match = texteDate(d);
      }
    }
    if (corps?.adversaireId !== undefined) {
      const id = uuidOuNull(corps.adversaireId, 'adversaire');
      if (id && id !== existant?.adversaire_id) {
        const a = await adversaireDe(ctx, id);
        Object.assign(s, { adversaire_id: a.id, adversaire_nom: a.nom });
      } else if (!id) s.adversaire_id = null;
    }
    if (champ('adversaireNom') && !(s.adversaire_id ?? (corps?.adversaireId !== undefined ? null : existant?.adversaire_id))) s.adversaire_nom = texteNettoye(corps.adversaireNom, 60);
    if (champ('tournoiMatchId')) {
      s.tournoi_match_id = uuidOuNull(corps.tournoiMatchId, 'tournoi-match');
      if (s.tournoi_match_id && s.tournoi_match_id !== existant?.tournoi_match_id && !(await base.premier('SELECT id FROM tournoi_matchs WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [s.tournoi_match_id, ctx.team.id]))) throw echec(400, 'tournoi-match', 'Match de tournoi inconnu.');
    }
    if (champ('resultatId')) {
      s.resultat_id = uuidOuNull(corps.resultatId, 'resultat');
      if (s.resultat_id && s.resultat_id !== existant?.resultat_id && !(await base.premier('SELECT id FROM resultats WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [s.resultat_id, ctx.team.id]))) throw echec(400, 'resultat', 'Résultat inconnu.');
    }
    if (champ('contenu')) s.contenu = JSON.stringify(await verifierReferences(ctx, lireContenu(corps.contenu), existant ? contenuDe(existant) : null));
    if (champ('statut')) {
      if (!STATUTS_PLAN.includes(corps.statut)) throw echec(400, 'statut', 'Statut : brouillon, pret ou joue.');
      s.statut = corps.statut;
    }
    return s;
  }

  async function inserer(ctx, valeurs, { evenements = [] } = {}) {
    const t = maintenant();
    const id = nouvelId();
    const jeu = ctx.team.jeu;
    const ligne = {
      id,
      team_id: ctx.team.id,
      jeu,
      modele: valeurs.modele ?? (await modeleDeTeam(jeu)),
      titre: valeurs.titre,
      statut: 'brouillon',
      est_modele: valeurs.est_modele ?? 0,
      date_match: valeurs.date_match ?? null,
      debut_match: valeurs.debut_match ?? null,
      evenement_id: valeurs.evenement_id ?? null,
      occurrence: valeurs.occurrence ?? null,
      adversaire_id: valeurs.adversaire_id ?? null,
      adversaire_nom: valeurs.adversaire_nom ?? '',
      tournoi_match_id: valeurs.tournoi_match_id ?? null,
      format: valeurs.format ?? '',
      contenu: valeurs.contenu ?? JSON.stringify(lireContenu({})),
      coches: '[]',
      cree_par: ctx.acteur.compte,
      cree_le: iso(t),
      maj_par: ctx.acteur.compte,
      maj_le: iso(t),
    };
    const colonnes = Object.keys(ligne);
    await base.lot([
      { sql: `INSERT INTO plans_match (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: colonnes.map(n => ligne[n]) },
      evenement('plan_match.created', { teamId: ctx.team.id, acteur: ctx.acteur.compte, entiteType: 'plan_match', entiteId: id, charge: charge(ligne), maintenant: t }),
      ...evenements,
    ]);
    return id;
  }

  async function modeleDeTeam(jeu) {
    const j = await base.premier('SELECT modele_strat FROM jeux WHERE cle = ?', [jeu]);
    return modeleDuJeu(j?.modele_strat, jeu);
  }

  async function creer(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    let source = null;
    if (corps?.depuis !== undefined && corps.depuis !== null) source = await planDeTeam(ctx, corps.depuis);
    const saisie = { ...corps };
    // Sans titre : celui de l'événement lié, du modèle, ou un titre neutre.
    const provisoire = !texteNettoye(saisie.titre, 80);
    if (provisoire) saisie.titre = source?.titre ?? 'Plan de match';
    const s = await lireSaisie(ctx, saisie, undefined);
    if (provisoire && s.adversaire_nom) s.titre = texteNettoye(`Plan contre ${s.adversaire_nom}`, 80);
    else if (provisoire && s._evenementTitre) s.titre = texteNettoye(s._evenementTitre, 80);
    if (source) {
      s.contenu ??= source.contenu;
      s.format ??= source.format;
      s.modele = source.modele;
      if (Number(source.est_modele) !== 1) {
        s.adversaire_id ??= source.adversaire_id;
        s.adversaire_nom ??= source.adversaire_nom;
      }
    }
    delete s.statut;
    const id = await inserer(ctx, s);
    return { plan: await planPublic(ctx, await planDeTeam(ctx, id)) };
  }

  async function modifier(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const p = await planDeTeam(ctx, id);
    const s = await lireSaisie(ctx, corps, p);
    delete s._evenementTitre;
    if (s.statut && Number(p.est_modele) === 1) delete s.statut;
    const champs = Object.keys(s).filter(c => s[c] !== p[c]);
    if (champs.length === 0) return { plan: await planPublic(ctx, p) };
    const t = maintenant();
    const versPret = champs.includes('statut') && s.statut === 'pret';
    const versJoue = champs.includes('statut') && s.statut === 'joue';
    const suite = { ...p, ...s };
    const colonnes = [...champs.map(c => `${c} = ?`), 'maj_par = ?', 'maj_le = ?', ...(versPret ? ['pret_le = ?', 'pret_par = ?'] : [])];
    const params = [...champs.map(c => s[c]), acteur.compte, iso(t), ...(versPret ? [iso(t), acteur.compte] : [])];
    const lot = [{ sql: `UPDATE plans_match SET ${colonnes.join(', ')} WHERE id = ?`, params: [...params, id] }];
    const autres = champs.filter(c => c !== 'statut');
    if (autres.length || (champs.includes('statut') && !versPret && !versJoue)) lot.push(evenement('plan_match.updated', { teamId, acteur: acteur.compte, entiteType: 'plan_match', entiteId: id, charge: { ...charge(suite), champs }, maintenant: t }));
    if (versPret) lot.push(evenement('plan_match.ready', { teamId, acteur: acteur.compte, entiteType: 'plan_match', entiteId: id, charge: charge(suite), maintenant: t }));
    if (versJoue) lot.push(evenement('plan_match.played', { teamId, acteur: acteur.compte, entiteType: 'plan_match', entiteId: id, charge: charge(suite), maintenant: t }));
    await base.lot(lot);
    return { plan: await planPublic(ctx, await planDeTeam(ctx, id)) };
  }

  /** Cases cochées de la checklist (gardées avec le plan ; sans verrou : chaque appui remplace la liste). */
  async function cocher(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const p = await planDeTeam(ctx, id);
    const connus = new Set(contenuDe(p).checklist.map(e => e.id));
    if (!Array.isArray(corps?.coches)) throw echec(400, 'coches', 'Liste de cases illisible.');
    const coches = distincts(corps.coches).filter(x => connus.has(x));
    await base.executer('UPDATE plans_match SET coches = ? WHERE id = ?', [JSON.stringify(coches), id]);
    return { plan: await planPublic(ctx, await planDeTeam(ctx, id)) };
  }

  /** Copie d'un plan (brouillon, sans événement ni résultat), ou modèle réutilisable (sans adversaire). */
  async function dupliquer(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const p = await planDeTeam(ctx, id);
    const enModele = corps?.modele === true;
    const titre = texteNettoye(corps?.titre, 80) || p.titre;
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const copie = await inserer(ctx, { titre, modele: p.modele, est_modele: enModele ? 1 : 0, format: p.format, contenu: p.contenu, adversaire_id: enModele ? null : p.adversaire_id, adversaire_nom: enModele ? '' : p.adversaire_nom });
    return { plan: await planPublic(ctx, await planDeTeam(ctx, copie)) };
  }

  /** Debrief : crée un événement « Review » au planning (droits du planning appliqués) et le lie au plan. */
  async function debrief(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const p = await planDeTeam(ctx, id);
    if (Number(p.est_modele) === 1) throw echec(400, 'modele', 'Un modèle n’a pas de debrief.');
    if (!planning?.creer) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (p.debrief_evenement_id && (await base.premier('SELECT id FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [p.debrief_evenement_id, teamId]))) throw echec(409, 'debrief-existe', 'Le debrief de ce plan est déjà au planning.');
    const titre = texteNettoye(`Debrief : ${p.adversaire_nom || p.titre}`, 80);
    const ev = await planning.creer(acteur, teamId, { type: 'review', titre, date: corps?.date, heureDebut: corps?.heureDebut, heureFin: corps?.heureFin });
    const evId = ev?.evenement?.id ?? ev?.id;
    await base.executer('UPDATE plans_match SET debrief_evenement_id = ? WHERE id = ?', [evId, id]);
    return { plan: await planPublic(ctx, await planDeTeam(ctx, id)) };
  }

  // -------------------------------------------------------------- Corbeille (30 jours)

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const p = await planDeTeam(ctx, id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE plans_match SET supprime_le = ?, supprime_par = ? WHERE id = ?', params: [iso(t), acteur.compte, id] },
      evenement('plan_match.deleted', { teamId, acteur: acteur.compte, entiteType: 'plan_match', entiteId: id, charge: charge(p), maintenant: t }),
    ]);
    return { ok: true };
  }

  async function corbeille(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const lignes = await base.tous('SELECT id, titre, supprime_le, supprime_par FROM plans_match WHERE team_id = ? AND supprime_le IS NOT NULL AND supprime_le >= ? ORDER BY supprime_le DESC LIMIT 200', [teamId, iso(maintenant() - DUREE_CORBEILLE_PLANS_MS)]);
    const pseudos = await pseudosDe(base, lignes.map(l => l.supprime_par));
    return { plans: lignes.map(l => ({ id: l.id, titre: l.titre, supprimeLe: l.supprime_le, supprimePar: l.supprime_par ? { compte: l.supprime_par, pseudo: pseudos[l.supprime_par] ?? null } : null })) };
  }

  async function restaurer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'plans.editer');
    const p = await planDeTeam(ctx, id, { supprime: true });
    if (p.supprime_le < iso(maintenant() - DUREE_CORBEILLE_PLANS_MS)) throw introuvable();
    const t = maintenant();
    // Un autre plan a pu prendre l'événement entre-temps : le plan restauré revient sans ce lien.
    const pris = p.evenement_id && (await base.premier('SELECT id FROM plans_match WHERE team_id = ? AND evenement_id = ? AND occurrence = ? AND est_modele = 0 AND supprime_le IS NULL', [teamId, p.evenement_id, p.occurrence]));
    await base.lot([
      { sql: `UPDATE plans_match SET supprime_le = NULL, supprime_par = NULL${pris ? ', evenement_id = NULL, occurrence = NULL, debut_match = NULL' : ''} WHERE id = ?`, params: [id] },
      evenement('plan_match.restored', { teamId, acteur: acteur.compte, entiteType: 'plan_match', entiteId: id, charge: charge(p), maintenant: t }),
    ]);
    return { plan: await planPublic(ctx, await planDeTeam(ctx, id)) };
  }

  return { liste: lister, pourEvenement, prochain, detail, liens, creer, modifier, cocher, dupliquer, debrief, supprimer, corbeille, restaurer };
}

/** Cron : efface définitivement les plans à la corbeille depuis plus de 30 jours. Rend leur nombre. */
export async function purgerCorbeillePlans(base, { maintenant = Date.now(), duree = DUREE_CORBEILLE_PLANS_MS, limite = 200 } = {}) {
  const lignes = await base.tous('SELECT id FROM plans_match WHERE supprime_le IS NOT NULL AND supprime_le < ? LIMIT ?', [iso(maintenant - duree), limite]);
  for (const l of lignes) await base.executer('DELETE FROM plans_match WHERE id = ?', [l.id]);
  return lignes.length;
}

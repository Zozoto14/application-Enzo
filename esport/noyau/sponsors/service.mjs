/**
 * Sponsors & partenaires (rubrique de l'espace CM, migration 0024). Voir docs/esport/sponsors.md.
 *
 *  - pipeline des prospects (étapes éditables, Kanban), fiche : contacts, échanges, prochaine action, pièces ;
 *  - conversion d'un prospect en partenaire (un clic), raison de la perte ;
 *  - partenaires : fiche, contrats (numéraire, dotation en nature, renouvellement), contreparties (obligations
 *    par période ; les posts CM publiés qui cochent « mention sponsor » comptent), pièces, logo ;
 *  - tableau de bord ; import CSV (colonnes mappables) et export CSV (formules neutralisées) ;
 *  - RGPD des contacts (export et effacement par adresse e-mail).
 *
 * Droits : commun.mjs (`sponsors.voir` pour lire, `sponsors.gerer` pour écrire ; 404 sans `sponsors.voir`).
 * Les événements `sponsors.*` n'ont jamais de team (jamais dans le journal d'une team) et ne portent que des
 * noms d'entreprises (ni adresse, ni téléphone, ni montant).
 */

import { evenement } from '../evenements.mjs';
import { cheminSigne } from '../fichiers.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { lienSur } from '../review/markdown.mjs';
import { MOTIF_COMPTE, MOTIF_UUID, porteesDe, positionEntre } from '../cm/commun.mjs';
import { DUREE_LIEN_CM_MS, lireInstantCm } from '../cm/tableaux.mjs';
import { PORTEE_SPONSORS, comptesSponsors, contexteSponsors, droitsSponsors } from './commun.mjs';
import {
  CHAMPS_IMPORT,
  CsvInvalide,
  FREQUENCES,
  FUSEAU_SPONSORS,
  ajouterJours,
  correspondanceProposee,
  ecartJours,
  ecrireCsv,
  etatPeriode,
  jourDans,
  jourValide,
  lireCsv,
  lireMontant,
  periodeDe,
  periodesEntre,
  sansAccentsMinuscules,
} from './regles.mjs';

export const TAILLES = Object.freeze(['', 'independant', 'tpe', 'pme', 'eti', 'grande']);
export const PRIORITES = Object.freeze(['basse', 'normale', 'haute']);
export const NIVEAUX = Object.freeze(['principal', 'officiel', 'partenaire', 'fournisseur', 'media']);
export const GENRES_ECHANGE = Object.freeze(['appel', 'email', 'reunion', 'note']);
export const GENRES_OBLIGATION = Object.freeze(['posts', 'affiche', 'stream', 'maillot', 'evenement', 'autre']);
export const CATEGORIES_PIECE = Object.freeze(['deck', 'proposition', 'contrat', 'logo', 'facture', 'autre']);
export const RENOUVELLEMENTS = Object.freeze(['manuel', 'tacite', 'aucun']);
export const STATUTS_CONTRAT = Object.freeze(['brouillon', 'actif', 'termine', 'resilie']);
/** Contrats « bientôt expirés » du tableau de bord : fin dans les 60 jours. */
export const JOURS_EXPIRATION = 60;
const MAX_PROSPECTS = 5000;
const MAX_ETAPES = 20;
const MAX_CONTACTS = 30;
const MAX_PIECES = 50;
const MAX_ECHANGES_FICHE = 300;
const MAX_IMPORT_OCTETS = 1024 * 1024;
const MOTIF_TELEPHONE = /^[+0-9 ().\-/]{3,30}$/;
const MOTIF_EMAIL = /^[^\s<>@"']{1,64}@[^\s<>@"']{1,190}\.[A-Za-z]{2,}$/;
const MOTIF_RESEAU = /^(@[\w.-]{1,60}|https:\/\/[^\s<>"'`\\]{3,200})$/;

const exigerUuid = (v, quoi) => {
  if (typeof v !== 'string' || !MOTIF_UUID.test(v)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return v;
};
const choix = (v, liste, code, repli) => {
  if (v === undefined) return repli;
  if (!liste.includes(v)) throw echec(400, code, 'Valeur inconnue.');
  return v;
};
const montant = (v, code = 'montant') => {
  const c = lireMontant(v);
  if (c === undefined) throw echec(400, code, 'Montant illisible (en euros, ex. 1500 ou 1 500,50).');
  return c;
};
const jour = (v, code = 'date', { facultatif = false } = {}) => {
  if ((v === undefined || v === null || v === '') && facultatif) return null;
  if (!jourValide(v)) throw echec(400, code, 'Date invalide (AAAA-MM-JJ).');
  return v;
};
const nomObligatoire = (v, max = 120) => {
  const n = texteNettoye(v, max);
  if (n.length < 1) throw echec(400, 'nom', 'Nom obligatoire.');
  return n;
};
function lireSite(v) {
  if (v === undefined || v === null || v === '') return '';
  const t = String(v).trim();
  if (t.length > 300 || !/^https:\/\//i.test(t) || !lienSur(t)) throw echec(400, 'site', 'Adresse du site : https://…');
  return t;
}
function lireEmail(v) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (t.length > 254 || !MOTIF_EMAIL.test(t)) throw echec(400, 'email', 'Adresse e-mail invalide.');
  return t;
}
function lireTelephone(v) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (!MOTIF_TELEPHONE.test(t)) throw echec(400, 'telephone', 'Téléphone invalide.');
  return t;
}
function lireReseaux(v) {
  if (v === undefined || v === null) return [];
  const liste = Array.isArray(v) ? v : String(v).split(/[\s,;|]+/);
  const sortie = [];
  for (const brut of liste) {
    const t = String(brut ?? '').trim();
    if (!t) continue;
    if (!MOTIF_RESEAU.test(t)) throw echec(400, 'reseaux', 'Réseaux : un pseudo (@nom) ou une adresse https://…');
    if (!sortie.includes(t)) sortie.push(t);
  }
  if (sortie.length > 5) throw echec(400, 'reseaux', '5 réseaux au plus.');
  return sortie;
}
function lireInteret(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw echec(400, 'interet', 'Intérêt : 0 à 3.');
  return n;
}

/** Instruction INSERT : colonnes = clés de `valeurs` (fixées par le code), valeurs liées. */
function ajout(table, valeurs) {
  const colonnes = Object.keys(valeurs);
  return { sql: `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: colonnes.map(c => valeurs[c]) };
}

/** Instruction UPDATE d'une ligne (par `id`) : colonnes = clés de `valeurs` (fixées par le code), `extra` : suite fixe du SET. */
function maj(table, valeurs, id, extra = '', paramsExtra = []) {
  const cols = Object.keys(valeurs);
  return { sql: `UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')}${extra} WHERE id = ?`, params: [...cols.map(c => valeurs[c]), ...paramsExtra, id] };
}

export function servicesSponsors({ base, maintenant = () => Date.now(), medias, cleSession, stockage }) {
  const aujourdhui = () => jourDans(maintenant(), FUSEAU_SPONSORS);
  const ctxVoir = acteur => contexteSponsors(base, acteur);
  const ctxGerer = acteur => contexteSponsors(base, acteur, { gerer: true });

  // ---------------------------------------------------------------- Lectures communes

  async function etapesLignes({ archives = true } = {}) {
    return base.tous(`SELECT * FROM sp_etapes ${archives ? '' : 'WHERE archive_le IS NULL'} ORDER BY position, id`, []);
  }
  const etapePublique = e => ({ id: e.id, cle: e.cle ?? null, nom: e.nom ?? null, issue: e.issue, couleur: e.couleur, position: Number(e.position), archive: Boolean(e.archive_le) });

  async function etapeLigne(id) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) throw echec(400, 'etape', 'Étape inconnue.');
    const e = await base.premier('SELECT * FROM sp_etapes WHERE id = ?', [id]);
    if (!e) throw echec(400, 'etape', 'Étape inconnue.');
    return e;
  }

  async function prospectLigne(id) {
    exigerUuid(id, 'prospect');
    const p = await base.premier('SELECT * FROM sp_prospects WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!p) throw echec(404, 'prospect-introuvable', 'Prospect introuvable.');
    return p;
  }

  async function partenaireLigne(id) {
    exigerUuid(id, 'partenaire');
    const p = await base.premier('SELECT * FROM sp_partenaires WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!p) throw echec(404, 'partenaire-introuvable', 'Partenaire introuvable.');
    return p;
  }

  /** Teams concernées saisies : identifiants de teams existantes (20 au plus). */
  async function lireTeams(v) {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > 20 || v.some(t => typeof t !== 'string' || !MOTIF_UUID.test(t))) throw echec(400, 'teams', 'Teams illisibles.');
    const ids = [...new Set(v)];
    const existantes = await lignesParIds(base, 'SELECT id FROM teams WHERE supprimee_le IS NULL AND id', ids);
    if (existantes.length !== ids.length) throw echec(400, 'teams', 'Team inconnue.');
    return ids;
  }

  /** Responsable saisi : un compte qui voit la rubrique (sinon 400), ou null. */
  async function lireResponsable(v) {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !MOTIF_COMPTE.test(v)) throw echec(400, 'responsable', 'Responsable inconnu.');
    const droits = await droitsSponsors(base, { compte: v, superAdmin: v === 'principal' });
    if (!droits.has('sponsors.voir')) throw echec(400, 'responsable', 'Ce compte ne voit pas la rubrique Sponsors.');
    return v;
  }

  async function nomsTeams(ids) {
    return new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE supprimee_le IS NULL AND id', ids)).map(t => [t.id, t.nom]));
  }

  const ev = (type, acteur, entiteType, entiteId, charge, t) => evenement(type, { teamId: null, acteur: acteur?.compte ?? null, entiteType, entiteId, charge, maintenant: t });

  // ---------------------------------------------------------------- Moi, comptes, mentions

  /** Droits de l'acteur sur la rubrique (navigation). */
  async function moi(acteur) {
    const s = await droitsSponsors(base, acteur);
    return { voir: s.has('sponsors.voir'), gerer: s.has('sponsors.gerer') };
  }

  /** Comptes qui voient la rubrique (choix d'un responsable). */
  async function comptes(acteur) {
    await ctxVoir(acteur);
    const ids = [...(await comptesSponsors(base, 'sponsors.voir'))];
    const noms = await pseudosDe(base, ids);
    return { comptes: ids.map(id => ({ compte: id, pseudo: noms[id] ?? null })).sort((a, b) => String(a.pseudo ?? '').localeCompare(String(b.pseudo ?? ''), 'fr')) };
  }

  /**
   * Partenaires actifs qu'une carte post CM peut mentionner (« mention sponsor ») : nom et niveau seulement.
   * Ouvert à qui voit la rubrique ou prépare des contenus (cm.editer, club ou team).
   */
  async function mentionnables(acteur) {
    const s = await droitsSponsors(base, acteur);
    if (!s.has('sponsors.voir')) {
      const portees = await porteesDe(base, acteur);
      const editeur = portees.club.has('cm.editer') || [...portees.teams.values()].some(p => p.has('cm.editer'));
      if (!editeur) throw echec(404, 'route', 'Adresse inconnue.');
    }
    const lignes = await base.tous("SELECT id, nom, niveau FROM sp_partenaires WHERE supprime_le IS NULL AND statut = 'actif' ORDER BY nom LIMIT 500", []);
    return { partenaires: lignes.map(l => ({ id: l.id, nom: l.nom, niveau: l.niveau })) };
  }

  // ---------------------------------------------------------------- Étapes

  async function etapes(acteur) {
    const ctx = await ctxVoir(acteur);
    return { etapes: (await etapesLignes()).map(etapePublique), gerer: ctx.gerer };
  }

  async function creerEtape(acteur, corps) {
    await ctxGerer(acteur);
    const nom = nomObligatoire(corps?.nom, 60);
    const toutes = await etapesLignes({ archives: false });
    if (toutes.length >= MAX_ETAPES) throw echec(409, 'trop-d-etapes', `${MAX_ETAPES} étapes au plus.`);
    const couleur = /^#[0-9a-fA-F]{6}$/.test(corps?.couleur ?? '') ? corps.couleur.toLowerCase() : '#8b8b9a';
    // Une nouvelle étape « ouverte » se range après la dernière étape ouverte (avant Signé / Perdu).
    const ouvertes = toutes.filter(e => e.issue === 'ouverte');
    const fermees = toutes.filter(e => e.issue !== 'ouverte');
    const position = positionEntre(ouvertes.length ? Number(ouvertes.at(-1).position) : null, fermees.length ? Number(fermees[0].position) : null);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: "INSERT INTO sp_etapes (id, cle, nom, issue, couleur, position, cree_le, maj_le) VALUES (?, NULL, ?, 'ouverte', ?, ?, ?, ?)", params: [id, nom, couleur, position, iso(t), iso(t)] },
      ev('sponsors.etapes_modifiees', acteur, 'sp_etape', id, { nom }, t),
    ]);
    return etapes(acteur);
  }

  /** Renommer (null : nom par défaut d'une étape système), couleur, archiver (étape vide, personnalisée), déplacer (`index` parmi les étapes ouvertes). */
  async function modifierEtape(acteur, id, corps) {
    await ctxGerer(acteur);
    const e = await etapeLigne(id);
    const t = maintenant();
    const lot = [];
    if (corps?.nom !== undefined) {
      const nom = corps.nom === null ? null : texteNettoye(corps.nom, 60);
      if (nom === null && !e.cle) throw echec(400, 'nom', 'Nom obligatoire.');
      if (nom !== null && nom.length < 1) throw echec(400, 'nom', 'Nom obligatoire.');
      lot.push({ sql: 'UPDATE sp_etapes SET nom = ?, maj_le = ? WHERE id = ?', params: [nom, iso(t), e.id] });
    }
    if (corps?.couleur !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(corps.couleur)) throw echec(400, 'couleur', 'Couleur : #RRGGBB.');
      lot.push({ sql: 'UPDATE sp_etapes SET couleur = ?, maj_le = ? WHERE id = ?', params: [corps.couleur.toLowerCase(), iso(t), e.id] });
    }
    if (corps?.archive !== undefined) {
      if (corps.archive) {
        if (e.issue !== 'ouverte' || e.cle === 'a_contacter') throw echec(409, 'etape-systeme', 'Cette étape ne s’archive pas.');
        const n = await base.premier('SELECT COUNT(*) AS n FROM sp_prospects WHERE etape_id = ? AND supprime_le IS NULL', [e.id]);
        if (Number(n?.n ?? 0) > 0) throw echec(409, 'etape-non-vide', 'Déplacez d’abord les prospects de cette étape.');
      }
      lot.push({ sql: 'UPDATE sp_etapes SET archive_le = ?, maj_le = ? WHERE id = ?', params: [corps.archive ? iso(t) : null, iso(t), e.id] });
    }
    if (corps?.index !== undefined) {
      if (e.issue !== 'ouverte') throw echec(409, 'etape-systeme', 'Signé et Perdu restent en dernier.');
      const ouvertes = (await etapesLignes({ archives: false })).filter(x => x.issue === 'ouverte' && x.id !== e.id);
      const fermees = (await etapesLignes({ archives: false })).filter(x => x.issue !== 'ouverte');
      const index = Math.max(0, Math.min(ouvertes.length, Number.isInteger(corps.index) ? corps.index : ouvertes.length));
      const avant = index > 0 ? Number(ouvertes[index - 1].position) : null;
      const apres = index < ouvertes.length ? Number(ouvertes[index].position) : fermees.length ? Number(fermees[0].position) : null;
      lot.push({ sql: 'UPDATE sp_etapes SET position = ?, maj_le = ? WHERE id = ?', params: [positionEntre(avant, apres), iso(t), e.id] });
    }
    if (!lot.length) return etapes(acteur);
    lot.push(ev('sponsors.etapes_modifiees', acteur, 'sp_etape', e.id, { nom: e.nom ?? e.cle }, t));
    await base.lot(lot);
    return etapes(acteur);
  }

  // ---------------------------------------------------------------- Prospects

  function resumeProspect(p, etapesParId, contacts, aujourd) {
    const etape = etapesParId.get(p.etape_id);
    const action = p.prochaine_action_le ?? null;
    return {
      id: p.id,
      nom: p.nom,
      secteur: p.secteur,
      taille: p.taille,
      source: p.source,
      interet: Number(p.interet),
      priorite: p.priorite,
      valeurEstimee: Number(p.valeur_estimee),
      etapeId: p.etape_id,
      issue: etape?.issue ?? 'ouverte',
      position: Number(p.position),
      responsable: p.responsable_id ?? null,
      teams: jsonOu(p.teams, []),
      prochaineAction: p.prochaine_action,
      prochaineActionLe: action,
      actionEnRetard: Boolean(action && etape?.issue === 'ouverte' && jourDans(Date.parse(action)) < aujourd),
      contact: contacts?.get(p.id) ?? null,
      partenaireId: p.partenaire_id ?? null,
      raisonPerte: p.raison_perte ?? null,
      version: Number(p.version),
      majLe: p.maj_le,
    };
  }

  /** `GET /sponsors/pipeline` : étapes et prospects (filtres : texte, responsable, priorité, team). */
  async function pipeline(acteur, { q, responsable, priorite, team } = {}) {
    const ctx = await ctxVoir(acteur);
    const lignes = await base.tous('SELECT * FROM sp_prospects WHERE supprime_le IS NULL ORDER BY position, cree_le LIMIT ?', [MAX_PROSPECTS]);
    const etapesListe = await etapesLignes();
    const parId = new Map(etapesListe.map(e => [e.id, e]));
    const principaux = await base.tous('SELECT prospect_id, nom, role FROM sp_contacts WHERE prospect_id IS NOT NULL ORDER BY principal DESC, cree_le', []);
    const contacts = new Map();
    for (const c of principaux) if (!contacts.has(c.prospect_id)) contacts.set(c.prospect_id, { nom: c.nom, role: c.role });
    const aujourd = aujourdhui();
    const filtre = typeof q === 'string' && q.trim() ? sansAccentsMinuscules(q).slice(0, 80) : '';
    const liste = lignes
      .map(p => resumeProspect(p, parId, contacts, aujourd))
      .filter(p => !filtre || sansAccentsMinuscules(`${p.nom} ${p.secteur} ${p.source} ${p.contact?.nom ?? ''}`).includes(filtre))
      .filter(p => !responsable || p.responsable === responsable)
      .filter(p => !priorite || p.priorite === priorite)
      .filter(p => !team || p.teams.includes(team));
    const noms = await pseudosDe(base, liste.map(p => p.responsable).filter(Boolean));
    const teams = await nomsTeams(liste.flatMap(p => p.teams));
    return { etapes: etapesListe.map(etapePublique), prospects: liste, noms, teams: Object.fromEntries(teams), gerer: ctx.gerer };
  }

  async function lireChampsProspect(corps, { creation }) {
    const champs = {};
    if (creation || corps?.nom !== undefined) champs.nom = nomObligatoire(corps?.nom);
    if (corps?.site !== undefined) champs.site = lireSite(corps.site);
    if (corps?.secteur !== undefined) champs.secteur = texteNettoye(corps.secteur, 80);
    if (corps?.taille !== undefined) champs.taille = choix(corps.taille ?? '', TAILLES, 'taille');
    if (corps?.source !== undefined) champs.source = texteNettoye(corps.source, 120);
    if (corps?.interet !== undefined) champs.interet = lireInteret(corps.interet);
    if (corps?.priorite !== undefined) champs.priorite = choix(corps.priorite, PRIORITES, 'priorite');
    if (corps?.valeurEstimee !== undefined) champs.valeur_estimee = montant(corps.valeurEstimee, 'valeur');
    if (corps?.notes !== undefined) champs.notes = texteLong(corps.notes, 8000);
    if (corps?.teams !== undefined) champs.teams = JSON.stringify(await lireTeams(corps.teams));
    if (corps?.responsable !== undefined) champs.responsable_id = await lireResponsable(corps.responsable);
    if (corps?.prochaineAction !== undefined) champs.prochaine_action = texteNettoye(corps.prochaineAction, 200);
    if (corps?.prochaineActionLe !== undefined) {
      champs.prochaine_action_le = lireInstantCm(corps.prochaineActionLe, FUSEAU_SPONSORS, 'prochaine-action');
      champs.rappel_envoye_le = null;
    }
    return champs;
  }

  async function creerProspect(acteur, corps) {
    await ctxGerer(acteur);
    const n = await base.premier('SELECT COUNT(*) AS n FROM sp_prospects WHERE supprime_le IS NULL', []);
    if (Number(n?.n ?? 0) >= MAX_PROSPECTS) throw echec(409, 'trop-de-prospects', `${MAX_PROSPECTS} prospects au plus.`);
    const champs = await lireChampsProspect(corps, { creation: true });
    const etapesListe = await etapesLignes({ archives: false });
    const etape = corps?.etapeId ? await etapeLigne(corps.etapeId) : etapesListe[0];
    if (!etape || etape.archive_le) throw echec(400, 'etape', 'Étape inconnue.');
    if (etape.issue !== 'ouverte') throw echec(400, 'etape', 'Un nouveau prospect commence dans une étape ouverte.');
    const t = maintenant();
    const id = nouvelId();
    const position = await positionFin(etape.id);
    const colonnes = { nom: '', site: '', secteur: '', taille: '', source: '', interet: 0, priorite: 'normale', valeur_estimee: 0, notes: '', teams: '[]', responsable_id: acteur.compte ?? null, prochaine_action: '', prochaine_action_le: null, rappel_envoye_le: null, ...champs };
    const lot = [
      ajout('sp_prospects', { id, ...colonnes, etape_id: etape.id, position, cree_par: acteur.compte, cree_le: iso(t), maj_par: acteur.compte, maj_le: iso(t) }),
      ev('sponsors.prospect_cree', acteur, 'sp_prospect', id, { titre: colonnes.nom }, t),
    ];
    if (corps?.contact && typeof corps.contact === 'object') lot.push(instructionContact({ ...corps.contact, principal: true }, { prospectId: id }, t));
    if (colonnes.responsable_id && colonnes.responsable_id !== acteur.compte) lot.push(ev('sponsors.responsable', acteur, 'sp_prospect', id, { titre: colonnes.nom, compte: colonnes.responsable_id, genre: 'prospect' }, t));
    await base.lot(lot);
    return prospect(acteur, id);
  }

  async function positionFin(etapeId) {
    const l = await base.premier('SELECT MAX(position) AS p FROM sp_prospects WHERE etape_id = ? AND supprime_le IS NULL', [etapeId]);
    return l?.p === null || l?.p === undefined ? 1024 : Number(l.p) + 1024;
  }

  /** `GET /sponsors/prospects/:id` : la fiche complète. */
  async function prospect(acteur, id) {
    const ctx = await ctxVoir(acteur);
    const p = await prospectLigne(id);
    const etapesListe = await etapesLignes();
    const parId = new Map(etapesListe.map(e => [e.id, e]));
    const contacts = await base.tous('SELECT * FROM sp_contacts WHERE prospect_id = ? ORDER BY principal DESC, cree_le', [p.id]);
    const echanges = await base.tous('SELECT * FROM sp_echanges WHERE prospect_id = ? AND supprime_le IS NULL ORDER BY date DESC, cree_le DESC LIMIT ?', [p.id, MAX_ECHANGES_FICHE]);
    const pieces = await piecesDe(true, p.id);
    const resume = resumeProspect(p, parId, null, aujourdhui());
    const noms = await pseudosDe(base, [p.responsable_id, p.cree_par, ...echanges.map(e => e.auteur_id)].filter(Boolean));
    const teams = await nomsTeams(resume.teams);
    return {
      prospect: {
        ...resume,
        site: p.site,
        notes: p.notes,
        perduLe: p.perdu_le ?? null,
        signeLe: p.signe_le ?? null,
        creePar: p.cree_par ?? null,
        creeLe: p.cree_le,
      },
      etapes: etapesListe.map(etapePublique),
      contacts: contacts.map(contactPublic),
      echanges: echanges.map(echangePublic),
      pieces,
      noms,
      teams: Object.fromEntries(teams),
      gerer: ctx.gerer,
    };
  }

  async function modifierProspect(acteur, id, corps) {
    await ctxGerer(acteur);
    const p = await prospectLigne(id);
    if (corps?.versionAttendue !== undefined && Number(corps.versionAttendue) !== Number(p.version)) throw echec(409, 'version', 'Ce prospect a changé entre-temps : rechargez la fiche.');
    const champs = await lireChampsProspect(corps, { creation: false });
    if (corps?.raisonPerte !== undefined && p.perdu_le) champs.raison_perte = texteNettoye(corps.raisonPerte, 300) || p.raison_perte;
    const cles = Object.keys(champs);
    if (!cles.length) return prospect(acteur, id);
    const t = maintenant();
    const lot = [
      maj('sp_prospects', champs, p.id, ', version = version + 1, maj_par = ?, maj_le = ?', [acteur.compte, iso(t)]),
      ev('sponsors.prospect_modifie', acteur, 'sp_prospect', p.id, { titre: champs.nom ?? p.nom, champs: cles }, t),
    ];
    if (champs.responsable_id && champs.responsable_id !== p.responsable_id && champs.responsable_id !== acteur.compte) lot.push(ev('sponsors.responsable', acteur, 'sp_prospect', p.id, { titre: champs.nom ?? p.nom, compte: champs.responsable_id, genre: 'prospect' }, t));
    await base.lot(lot);
    return prospect(acteur, id);
  }

  /**
   * `POST /sponsors/prospects/:id/deplacer` `{ etapeId, index?, raisonPerte? }` : change d'étape (Kanban). Vers
   * une étape « perdue » : raison obligatoire. Vers « gagnée » : date de signature (la conversion en partenaire
   * reste un clic à part, proposé par l'app).
   */
  async function deplacerProspect(acteur, id, corps) {
    await ctxGerer(acteur);
    const p = await prospectLigne(id);
    const etape = await etapeLigne(corps?.etapeId);
    if (etape.archive_le) throw echec(400, 'etape', 'Étape archivée.');
    const autres = await base.tous('SELECT id, position FROM sp_prospects WHERE etape_id = ? AND supprime_le IS NULL AND id <> ? ORDER BY position, cree_le', [etape.id, p.id]);
    const index = Math.max(0, Math.min(autres.length, Number.isInteger(corps?.index) ? corps.index : autres.length));
    const position = positionEntre(index > 0 ? Number(autres[index - 1].position) : null, index < autres.length ? Number(autres[index].position) : null);
    const t = maintenant();
    const champs = { etape_id: etape.id, position };
    if (etape.issue === 'perdue') {
      const raison = texteNettoye(corps?.raisonPerte, 300);
      if (p.etape_id !== etape.id && raison.length < 2) throw echec(400, 'raison-perte', 'Indiquez la raison de la perte.');
      if (raison) champs.raison_perte = raison;
      if (!p.perdu_le) champs.perdu_le = iso(t);
    } else {
      champs.raison_perte = null;
      champs.perdu_le = null;
    }
    if (etape.issue === 'gagnee') {
      if (!p.signe_le) champs.signe_le = iso(t);
    } else if (!p.partenaire_id) champs.signe_le = null;
    const cles = Object.keys(champs);
    const lot = [maj('sp_prospects', champs, p.id, ', version = version + 1, maj_par = ?, maj_le = ?', [acteur.compte, iso(t)])];
    if (p.etape_id !== etape.id) lot.push(ev('sponsors.prospect_deplace', acteur, 'sp_prospect', p.id, { titre: p.nom, etape: etape.cle ?? etape.nom, issue: etape.issue }, t));
    await base.lot(lot);
    return { ok: true, etapeId: etape.id, issue: etape.issue, convertible: etape.issue === 'gagnee' && !p.partenaire_id };
  }

  /** Supprime un prospect et ses données (contacts, échanges, pièces et fichiers) : rien n'est gardé. */
  async function supprimerProspect(acteur, id) {
    await ctxGerer(acteur);
    const p = await prospectLigne(id);
    const t = maintenant();
    const pieces = await base.tous('SELECT fichier_id FROM sp_pieces WHERE prospect_id = ? AND partenaire_id IS NULL AND fichier_id IS NOT NULL', [p.id]);
    await base.lot([
      { sql: 'DELETE FROM sp_contacts WHERE prospect_id = ? AND partenaire_id IS NULL', params: [p.id] },
      { sql: 'UPDATE sp_contacts SET prospect_id = NULL WHERE prospect_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_echanges WHERE prospect_id = ? AND partenaire_id IS NULL', params: [p.id] },
      { sql: 'UPDATE sp_echanges SET prospect_id = NULL WHERE prospect_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_pieces WHERE prospect_id = ? AND partenaire_id IS NULL', params: [p.id] },
      { sql: 'UPDATE sp_pieces SET prospect_id = NULL WHERE prospect_id = ?', params: [p.id] },
      { sql: 'UPDATE sp_partenaires SET prospect_id = NULL WHERE prospect_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_prospects WHERE id = ?', params: [p.id] },
      ev('sponsors.prospect_supprime', acteur, 'sp_prospect', p.id, { titre: p.nom }, t),
    ]);
    for (const x of pieces) await effacerFichierSiOrphelin(x.fichier_id, t);
    return { ok: true };
  }

  /**
   * `POST /sponsors/prospects/:id/convertir` `{ niveau? }` : crée le partenaire depuis le prospect (nom, site,
   * secteur, teams, notes, responsable) ; contacts, échanges et pièces lui sont rattachés (ils restent visibles
   * depuis le prospect), et le prospect passe à l'étape « gagnée ». Un prospect ne se convertit qu'une fois.
   */
  async function convertir(acteur, id, corps) {
    await ctxGerer(acteur);
    const p = await prospectLigne(id);
    if (p.partenaire_id) {
      const e = echec(409, 'deja-converti', 'Ce prospect est déjà un partenaire.');
      e.details = { partenaireId: p.partenaire_id };
      throw e;
    }
    const niveau = choix(corps?.niveau, NIVEAUX, 'niveau', 'partenaire');
    const gagnee = (await etapesLignes()).find(e => e.issue === 'gagnee');
    const t = maintenant();
    const partenaireId = nouvelId();
    const position = gagnee && gagnee.id !== p.etape_id ? await positionFin(gagnee.id) : Number(p.position);
    await base.lot([
      {
        sql: `INSERT INTO sp_partenaires (id, nom, site, secteur, niveau, statut, teams, notes, responsable_id, prospect_id, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, 'actif', ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [partenaireId, p.nom, p.site, p.secteur, niveau, p.teams, p.notes, p.responsable_id ?? null, p.id, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      { sql: 'UPDATE sp_contacts SET partenaire_id = ? WHERE prospect_id = ? AND partenaire_id IS NULL', params: [partenaireId, p.id] },
      { sql: 'UPDATE sp_echanges SET partenaire_id = ? WHERE prospect_id = ? AND partenaire_id IS NULL', params: [partenaireId, p.id] },
      { sql: 'UPDATE sp_pieces SET partenaire_id = ? WHERE prospect_id = ? AND partenaire_id IS NULL', params: [partenaireId, p.id] },
      {
        sql: 'UPDATE sp_prospects SET partenaire_id = ?, etape_id = ?, position = ?, signe_le = ?, perdu_le = NULL, raison_perte = NULL, version = version + 1, maj_par = ?, maj_le = ? WHERE id = ?',
        params: [partenaireId, gagnee?.id ?? p.etape_id, position, p.signe_le ?? iso(t), acteur.compte, iso(t), p.id],
      },
      ev('sponsors.prospect_converti', acteur, 'sp_prospect', p.id, { titre: p.nom, partenaire: partenaireId }, t),
    ]);
    return { partenaireId };
  }

  // ---------------------------------------------------------------- Contacts

  function instructionContact(corps, { prospectId = null, partenaireId = null }, t, id = nouvelId()) {
    const nom = nomObligatoire(corps?.nom, 120);
    return {
      sql: 'INSERT INTO sp_contacts (id, prospect_id, partenaire_id, nom, role, email, telephone, reseaux, principal, notes, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [id, prospectId, partenaireId, nom, texteNettoye(corps?.role, 80), lireEmail(corps?.email), lireTelephone(corps?.telephone), JSON.stringify(lireReseaux(corps?.reseaux)), corps?.principal ? 1 : 0, texteLong(corps?.notes, 2000), iso(t), iso(t)],
    };
  }
  const contactPublic = c => ({ id: c.id, nom: c.nom, role: c.role, email: c.email, telephone: c.telephone, reseaux: jsonOu(c.reseaux, []), principal: Number(c.principal) === 1, notes: c.notes, prospectId: c.prospect_id ?? null, partenaireId: c.partenaire_id ?? null });

  /** Cible d'un contact, d'un échange ou d'une pièce : un prospect ou un partenaire existant. */
  async function cibleDe(corps) {
    if (corps?.prospectId) return { prospectId: (await prospectLigne(corps.prospectId)).id, partenaireId: null };
    if (corps?.partenaireId) return { prospectId: null, partenaireId: (await partenaireLigne(corps.partenaireId)).id };
    throw echec(400, 'cible', 'Prospect ou partenaire attendu.');
  }

  async function ajouterContact(acteur, corps) {
    await ctxGerer(acteur);
    const cible = await cibleDe(corps);
    const estProspect = Boolean(cible.prospectId);
    const n = await base.premier(`SELECT COUNT(*) AS n FROM sp_contacts WHERE ${estProspect ? 'prospect_id' : 'partenaire_id'} = ?`, [cible.prospectId ?? cible.partenaireId]);
    if (Number(n?.n ?? 0) >= MAX_CONTACTS) throw echec(409, 'trop-de-contacts', `${MAX_CONTACTS} contacts au plus.`);
    const t = maintenant();
    const id = nouvelId();
    const lot = [];
    if (corps?.principal) lot.push({ sql: `UPDATE sp_contacts SET principal = 0 WHERE ${estProspect ? 'prospect_id' : 'partenaire_id'} = ?`, params: [cible.prospectId ?? cible.partenaireId] });
    lot.push(instructionContact(corps, cible, t, id));
    await base.lot(lot);
    return { contact: contactPublic(await base.premier('SELECT * FROM sp_contacts WHERE id = ?', [id])) };
  }

  async function contactLigne(id) {
    exigerUuid(id, 'contact');
    const c = await base.premier('SELECT * FROM sp_contacts WHERE id = ?', [id]);
    if (!c) throw echec(404, 'contact-introuvable', 'Contact introuvable.');
    return c;
  }

  async function modifierContact(acteur, id, corps) {
    await ctxGerer(acteur);
    const c = await contactLigne(id);
    const champs = {};
    if (corps?.nom !== undefined) champs.nom = nomObligatoire(corps.nom, 120);
    if (corps?.role !== undefined) champs.role = texteNettoye(corps.role, 80);
    if (corps?.email !== undefined) champs.email = lireEmail(corps.email);
    if (corps?.telephone !== undefined) champs.telephone = lireTelephone(corps.telephone);
    if (corps?.reseaux !== undefined) champs.reseaux = JSON.stringify(lireReseaux(corps.reseaux));
    if (corps?.notes !== undefined) champs.notes = texteLong(corps.notes, 2000);
    if (corps?.principal !== undefined) champs.principal = corps.principal ? 1 : 0;
    const t = maintenant();
    const lot = [];
    if (corps?.principal) {
      if (c.prospect_id) lot.push({ sql: 'UPDATE sp_contacts SET principal = 0 WHERE prospect_id = ?', params: [c.prospect_id] });
      if (c.partenaire_id) lot.push({ sql: 'UPDATE sp_contacts SET principal = 0 WHERE partenaire_id = ?', params: [c.partenaire_id] });
    }
    const cles = Object.keys(champs);
    if (cles.length) lot.push(maj('sp_contacts', champs, c.id, ', maj_le = ?', [iso(t)]));
    if (lot.length) await base.lot(lot);
    return { contact: contactPublic(await contactLigne(c.id)) };
  }

  async function supprimerContact(acteur, id) {
    await ctxGerer(acteur);
    const c = await contactLigne(id);
    await base.lot([
      { sql: 'UPDATE sp_echanges SET contact_id = NULL WHERE contact_id = ?', params: [c.id] },
      { sql: 'DELETE FROM sp_contacts WHERE id = ?', params: [c.id] },
    ]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Échanges

  const echangePublic = e => ({ id: e.id, genre: e.genre, date: e.date, resume: e.resume, contactId: e.contact_id ?? null, auteur: e.auteur_id ?? null, prospectId: e.prospect_id ?? null, partenaireId: e.partenaire_id ?? null });

  /**
   * `POST /sponsors/echanges` `{ prospectId|partenaireId, genre, date?, resume, contactId?, prochaineAction?,
   * prochaineActionLe? }` : note un échange (date : maintenant par défaut) et, pour un prospect, la prochaine
   * action en même temps.
   */
  async function ajouterEchange(acteur, corps) {
    await ctxGerer(acteur);
    const cible = await cibleDe(corps);
    const genre = choix(corps?.genre, GENRES_ECHANGE, 'genre');
    if (!genre) throw echec(400, 'genre', 'Type d’échange : appel, e-mail, réunion ou note.');
    const t = maintenant();
    const date = corps?.date ? lireInstantCm(corps.date, FUSEAU_SPONSORS, 'date') : iso(t);
    const resume = texteLong(corps?.resume, 4000);
    if (!resume) throw echec(400, 'resume', 'Résumé de l’échange obligatoire.');
    let contactId = null;
    if (corps?.contactId) {
      const c = await contactLigne(corps.contactId);
      if ((cible.prospectId && c.prospect_id !== cible.prospectId) || (cible.partenaireId && c.partenaire_id !== cible.partenaireId)) throw echec(400, 'contact', 'Ce contact n’est pas celui de la fiche.');
      contactId = c.id;
    }
    const id = nouvelId();
    const lot = [
      {
        sql: 'INSERT INTO sp_echanges (id, prospect_id, partenaire_id, contact_id, genre, date, resume, auteur_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, cible.prospectId, cible.partenaireId, contactId, genre, date, resume, acteur.compte, iso(t), iso(t)],
      },
    ];
    if (cible.prospectId && (corps?.prochaineAction !== undefined || corps?.prochaineActionLe !== undefined)) {
      const champs = await lireChampsProspect({ prochaineAction: corps.prochaineAction, prochaineActionLe: corps.prochaineActionLe }, { creation: false });
      const cles = Object.keys(champs);
      if (cles.length) lot.push(maj('sp_prospects', champs, cible.prospectId, ', version = version + 1, maj_par = ?, maj_le = ?', [acteur.compte, iso(t)]));
    }
    await base.lot(lot);
    return { echange: echangePublic(await base.premier('SELECT * FROM sp_echanges WHERE id = ?', [id])) };
  }

  async function supprimerEchange(acteur, id) {
    await ctxGerer(acteur);
    exigerUuid(id, 'echange');
    const e = await base.premier('SELECT id FROM sp_echanges WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!e) throw echec(404, 'echange-introuvable', 'Échange introuvable.');
    await base.executer('DELETE FROM sp_echanges WHERE id = ?', [e.id]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Pièces jointes

  async function piecesDe(estProspect, id) {
    const pieces = await base.tous(`SELECT * FROM sp_pieces WHERE ${estProspect ? 'prospect_id' : 'partenaire_id'} = ? AND supprime_le IS NULL ORDER BY cree_le, id`, [id]);
    const fichiers = new Map((await lignesParIds(base, 'SELECT * FROM cm_fichiers WHERE id', pieces.map(p => p.fichier_id))).map(f => [f.id, f]));
    return pieces.map(p => {
      const f = p.fichier_id ? fichiers.get(p.fichier_id) : null;
      return { id: p.id, genre: p.genre, categorie: p.categorie, nom: p.nom, url: p.genre === 'lien' ? p.url : null, contratId: p.contrat_id ?? null, fichier: f && !f.supprime_le ? { id: f.id, type: f.type_mime, taille: Number(f.taille) } : null, creeLe: p.cree_le };
    });
  }

  /** Contexte d'envoi d'un fichier (portée « sponsors », table cm_fichiers). */
  const contexteEnvoi = acteur => ({ acteur, team: { id: null }, portee: PORTEE_SPONSORS });

  async function ajouterPiece(acteur, corps) {
    await ctxGerer(acteur);
    let cible;
    let contratId = null;
    if (corps?.contratId) {
      exigerUuid(corps.contratId, 'contrat');
      const c = await base.premier('SELECT id, partenaire_id FROM sp_contrats WHERE id = ? AND supprime_le IS NULL', [corps.contratId]);
      if (!c) throw echec(404, 'contrat-introuvable', 'Contrat introuvable.');
      cible = { prospectId: null, partenaireId: (await partenaireLigne(c.partenaire_id)).id };
      contratId = c.id;
    } else cible = await cibleDe(corps);
    const estProspect = Boolean(cible.prospectId);
    const n = await base.premier(`SELECT COUNT(*) AS n FROM sp_pieces WHERE ${estProspect ? 'prospect_id' : 'partenaire_id'} = ? AND supprime_le IS NULL`, [cible.prospectId ?? cible.partenaireId]);
    if (Number(n?.n ?? 0) >= MAX_PIECES) throw echec(409, 'trop-de-pieces', `${MAX_PIECES} pièces jointes au plus.`);
    const categorie = choix(corps?.categorie, CATEGORIES_PIECE, 'categorie', 'autre');
    const t = maintenant();
    const id = nouvelId();
    const lot = [];
    if (corps?.genre === 'lien') {
      const url = String(corps?.url ?? '').trim();
      if (url.length > 2000 || !/^https:\/\//i.test(url) || !lienSur(url)) throw echec(400, 'lien', 'Adresse invalide : https://… sans espace.');
      lot.push({ sql: "INSERT INTO sp_pieces (id, prospect_id, partenaire_id, contrat_id, genre, categorie, nom, url, cree_par, cree_le) VALUES (?, ?, ?, ?, 'lien', ?, ?, ?, ?, ?)", params: [id, cible.prospectId, cible.partenaireId, contratId, categorie, texteNettoye(corps?.nom, 140) || url.slice(0, 140), url, acteur.compte, iso(t)] });
    } else if (corps?.genre === 'fichier') {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const r = await medias.preparerRattachement(contexteEnvoi(acteur), corps?.envoi, 'cm', { entiteType: 'sp_piece', entiteId: id });
      lot.push(...r.instructions, { sql: "INSERT INTO sp_pieces (id, prospect_id, partenaire_id, contrat_id, genre, categorie, nom, fichier_id, cree_par, cree_le) VALUES (?, ?, ?, ?, 'fichier', ?, ?, ?, ?, ?)", params: [id, cible.prospectId, cible.partenaireId, contratId, categorie, texteNettoye(corps?.nom, 140) || r.envoi.nom_original, r.fichierId, acteur.compte, iso(t)] });
    } else throw echec(400, 'genre', 'Pièce jointe : lien ou fichier.');
    await base.lot(lot);
    return { pieces: await piecesDe(estProspect, cible.prospectId ?? cible.partenaireId) };
  }

  async function pieceLigne(id) {
    exigerUuid(id, 'piece');
    const p = await base.premier('SELECT * FROM sp_pieces WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!p) throw echec(404, 'piece-introuvable', 'Pièce jointe introuvable.');
    return p;
  }

  /** Efface les octets d'un fichier de la rubrique s'il n'est plus utilisé par aucune pièce. */
  async function effacerFichierSiOrphelin(fichierId, t) {
    if (!fichierId) return;
    const n = await base.premier('SELECT COUNT(*) AS n FROM sp_pieces WHERE fichier_id = ? AND supprime_le IS NULL', [fichierId]);
    if (Number(n?.n ?? 0) > 0) return;
    const f = await base.premier("SELECT * FROM cm_fichiers WHERE id = ? AND portee = 'sponsors' AND supprime_le IS NULL", [fichierId]);
    if (!f) return;
    if (stockage) await stockage.supprimer(f.cle_stockage).catch(() => undefined);
    await base.executer('UPDATE cm_fichiers SET supprime_le = ? WHERE id = ?', [iso(t), f.id]);
  }

  async function supprimerPiece(acteur, id) {
    await ctxGerer(acteur);
    const p = await pieceLigne(id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE sp_pieces SET supprime_le = ? WHERE id = ?', params: [iso(t), p.id] },
      { sql: 'UPDATE sp_partenaires SET logo_piece_id = NULL WHERE logo_piece_id = ?', params: [p.id] },
    ]);
    await effacerFichierSiOrphelin(p.fichier_id, t);
    return { ok: true };
  }

  /** Lien signé (2 h) vers le fichier d'une pièce (lecture : sponsors.voir). */
  async function lienPiece(acteur, id, corps) {
    await ctxVoir(acteur);
    const p = await pieceLigne(id);
    if (p.genre !== 'fichier' || !p.fichier_id) throw echec(400, 'piece-lien', 'Cette pièce jointe est un lien.');
    const f = await base.premier('SELECT id FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [p.fichier_id]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable (supprimé ?).');
    return cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, telecharger: corps?.telecharger === true, genre: 'cm' });
  }

  // ---------------------------------------------------------------- Partenaires

  async function contratsDe(ids) {
    return lignesParIds(base, 'SELECT * FROM sp_contrats WHERE supprime_le IS NULL AND partenaire_id', ids, { apres: 'ORDER BY debut' });
  }

  const contratPublic = (c, aujourd) => ({
    id: c.id,
    partenaireId: c.partenaire_id,
    intitule: c.intitule,
    debut: c.debut,
    fin: c.fin,
    montant: Number(c.montant),
    dotation: c.dotation,
    valeurDotation: Number(c.valeur_dotation),
    renouvellement: c.renouvellement,
    preavisJours: Number(c.preavis_jours),
    statut: c.statut,
    notes: c.notes,
    joursRestants: ecartJours(aujourd, c.fin),
    enCours: c.statut === 'actif' && c.debut <= aujourd && c.fin >= aujourd,
  });

  /**
   * Avancement des obligations (`lignes`) : périodes passées et courante (12 dernières), quantité faite
   * (saisie à la main + posts CM publiés qui mentionnent le partenaire, pour le comptage « cartes »).
   */
  async function avancement(lignes, aujourd, { historique = 12 } = {}) {
    if (!lignes.length) return new Map();
    const suivis = await lignesParIds(base, 'SELECT * FROM sp_suivi WHERE obligation_id', lignes.map(o => o.id));
    const parObligation = new Map();
    for (const s of suivis) {
      if (!parObligation.has(s.obligation_id)) parObligation.set(s.obligation_id, new Map());
      parObligation.get(s.obligation_id).set(s.periode, s);
    }
    const cartes = await cartesMentionnant([...new Set(lignes.filter(o => o.comptage === 'cartes').map(o => o.partenaire_id))]);
    const sortie = new Map();
    for (const o of lignes) {
      const periodes = periodesEntre(o.frequence, o.debut, o.fin ?? null, aujourd, historique).map(p => {
        const s = parObligation.get(o.id)?.get(p.cle);
        const parCartes = o.comptage === 'cartes' ? (cartes.get(o.partenaire_id) ?? []).filter(c => c.jour >= p.debut && c.jour <= p.fin) : [];
        const manuel = Number(s?.fait ?? 0);
        const fait = manuel + parCartes.length;
        return { cle: p.cle, debut: p.debut, fin: p.fin, manuel, cartes: parCartes.map(c => ({ id: c.id, titre: c.titre, tableauId: c.tableauId, jour: c.jour })), fait, quantite: Number(o.quantite), note: s?.note ?? '', etat: etatPeriode({ fait, quantite: Number(o.quantite), fin: p.fin }, aujourd) };
      });
      const courante = periodes.find(p => p.debut <= aujourd && p.fin >= aujourd) ?? null;
      sortie.set(o.id, { periodes, courante, enRetard: periodes.filter(p => p.etat === 'en_retard').length });
    }
    return sortie;
  }

  /** Posts CM publiés qui cochent « mention sponsor » : `Map<partenaireId, [{ id, titre, tableauId, jour }]>`. */
  async function cartesMentionnant(partenaires) {
    const sortie = new Map(partenaires.map(p => [p, []]));
    if (!partenaires.length) return sortie;
    const lignes = await base.tous(
      "SELECT id, tableau_id, titre, liens, publie_le FROM cm_cartes WHERE post = 1 AND statut = 'publie' AND supprime_le IS NULL AND publie_le IS NOT NULL AND liens LIKE ? LIMIT 20000",
      ['%"sponsors"%'],
    );
    for (const c of lignes) {
      const ids = jsonOu(c.liens, {}).sponsors;
      if (!Array.isArray(ids)) continue;
      for (const p of ids) if (sortie.has(p)) sortie.get(p).push({ id: c.id, titre: c.titre, tableauId: c.tableau_id, jour: jourDans(Date.parse(c.publie_le)) });
    }
    return sortie;
  }

  const obligationPublique = (o, av) => ({
    id: o.id,
    partenaireId: o.partenaire_id,
    contratId: o.contrat_id ?? null,
    intitule: o.intitule,
    genre: o.genre,
    comptage: o.comptage,
    frequence: o.frequence,
    quantite: Number(o.quantite),
    debut: o.debut,
    fin: o.fin ?? null,
    rappelJours: Number(o.rappel_jours),
    responsable: o.responsable_id ?? null,
    notes: o.notes,
    archive: Boolean(o.archive_le),
    periodes: av?.periodes ?? [],
    courante: av?.courante ?? null,
    enRetard: av?.enRetard ?? 0,
  });

  /** `GET /sponsors/partenaires` : liste (niveau, teams, contrat en cours, obligations en retard). */
  async function partenaires(acteur, { statut } = {}) {
    const ctx = await ctxVoir(acteur);
    const filtre = statut === 'termine' || statut === 'actif';
    const lignes = await base.tous(`SELECT * FROM sp_partenaires WHERE supprime_le IS NULL ${filtre ? 'AND statut = ?' : ''} ORDER BY nom LIMIT 2000`, filtre ? [statut] : []);
    const aujourd = aujourdhui();
    const contrats = await contratsDe(lignes.map(p => p.id));
    const obligations = await lignesParIds(base, 'SELECT * FROM sp_obligations WHERE supprime_le IS NULL AND archive_le IS NULL AND partenaire_id', lignes.map(p => p.id));
    const av = await avancement(obligations, aujourd, { historique: 6 });
    const teams = await nomsTeams(lignes.flatMap(p => jsonOu(p.teams, [])));
    return {
      partenaires: lignes.map(p => {
        const siens = contrats.filter(c => c.partenaire_id === p.id).map(c => contratPublic(c, aujourd));
        const enCours = siens.find(c => c.enCours) ?? siens.filter(c => c.statut === 'actif').at(-1) ?? null;
        const obs = obligations.filter(o => o.partenaire_id === p.id);
        return {
          id: p.id,
          nom: p.nom,
          niveau: p.niveau,
          statut: p.statut,
          secteur: p.secteur,
          teams: jsonOu(p.teams, []),
          logoPieceId: p.logo_piece_id ?? null,
          contrat: enCours,
          obligations: obs.length,
          obligationsEnRetard: obs.reduce((n, o) => n + (av.get(o.id)?.enRetard ?? 0), 0),
          responsable: p.responsable_id ?? null,
        };
      }),
      teams: Object.fromEntries(teams),
      noms: await pseudosDe(base, lignes.map(p => p.responsable_id).filter(Boolean)),
      gerer: ctx.gerer,
    };
  }

  /** `GET /sponsors/partenaires/:id` : la fiche (contrats, obligations et avancement, contacts, échanges, pièces). */
  async function partenaire(acteur, id) {
    const ctx = await ctxVoir(acteur);
    const p = await partenaireLigne(id);
    const aujourd = aujourdhui();
    const contrats = (await contratsDe([p.id])).map(c => contratPublic(c, aujourd));
    const obligations = await base.tous('SELECT * FROM sp_obligations WHERE partenaire_id = ? AND supprime_le IS NULL ORDER BY archive_le IS NOT NULL, cree_le', [p.id]);
    const av = await avancement(obligations, aujourd);
    const contacts = await base.tous('SELECT * FROM sp_contacts WHERE partenaire_id = ? ORDER BY principal DESC, cree_le', [p.id]);
    const echanges = await base.tous('SELECT * FROM sp_echanges WHERE partenaire_id = ? AND supprime_le IS NULL ORDER BY date DESC, cree_le DESC LIMIT ?', [p.id, MAX_ECHANGES_FICHE]);
    const teams = await nomsTeams(jsonOu(p.teams, []));
    const noms = await pseudosDe(base, [p.responsable_id, p.cree_par, ...echanges.map(e => e.auteur_id), ...obligations.map(o => o.responsable_id)].filter(Boolean));
    return {
      partenaire: {
        id: p.id,
        nom: p.nom,
        site: p.site,
        secteur: p.secteur,
        niveau: p.niveau,
        statut: p.statut,
        teams: jsonOu(p.teams, []),
        logoPieceId: p.logo_piece_id ?? null,
        notes: p.notes,
        responsable: p.responsable_id ?? null,
        prospectId: p.prospect_id ?? null,
        version: Number(p.version),
        creeLe: p.cree_le,
      },
      contrats,
      obligations: obligations.map(o => obligationPublique(o, av.get(o.id))),
      contacts: contacts.map(contactPublic),
      echanges: echanges.map(echangePublic),
      pieces: await piecesDe(false, p.id),
      noms,
      teams: Object.fromEntries(teams),
      gerer: ctx.gerer,
    };
  }

  async function lireChampsPartenaire(corps, { creation, partenaireId }) {
    const champs = {};
    if (creation || corps?.nom !== undefined) champs.nom = nomObligatoire(corps?.nom);
    if (corps?.site !== undefined) champs.site = lireSite(corps.site);
    if (corps?.secteur !== undefined) champs.secteur = texteNettoye(corps.secteur, 80);
    if (corps?.niveau !== undefined) champs.niveau = choix(corps.niveau, NIVEAUX, 'niveau');
    if (corps?.statut !== undefined) champs.statut = choix(corps.statut, ['actif', 'termine'], 'statut');
    if (corps?.notes !== undefined) champs.notes = texteLong(corps.notes, 8000);
    if (corps?.teams !== undefined) champs.teams = JSON.stringify(await lireTeams(corps.teams));
    if (corps?.responsable !== undefined) champs.responsable_id = await lireResponsable(corps.responsable);
    if (corps?.logoPieceId !== undefined) {
      if (corps.logoPieceId === null) champs.logo_piece_id = null;
      else {
        const piece = await pieceLigne(corps.logoPieceId);
        const f = piece.fichier_id ? await base.premier('SELECT type_mime FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [piece.fichier_id]) : null;
        if (piece.partenaire_id !== partenaireId || !f || !/^image\//.test(f.type_mime)) throw echec(400, 'logo', 'Le logo est une image jointe à la fiche.');
        champs.logo_piece_id = piece.id;
      }
    }
    return champs;
  }

  async function creerPartenaire(acteur, corps) {
    await ctxGerer(acteur);
    const champs = await lireChampsPartenaire(corps, { creation: true, partenaireId: null });
    delete champs.logo_piece_id;
    const t = maintenant();
    const id = nouvelId();
    const colonnes = { site: '', secteur: '', niveau: 'partenaire', statut: 'actif', notes: '', teams: '[]', responsable_id: null, ...champs };
    await base.lot([
      ajout('sp_partenaires', { id, ...colonnes, cree_par: acteur.compte, cree_le: iso(t), maj_par: acteur.compte, maj_le: iso(t) }),
      ev('sponsors.partenaire_cree', acteur, 'sp_partenaire', id, { titre: colonnes.nom }, t),
    ]);
    return partenaire(acteur, id);
  }

  async function modifierPartenaire(acteur, id, corps) {
    await ctxGerer(acteur);
    const p = await partenaireLigne(id);
    if (corps?.versionAttendue !== undefined && Number(corps.versionAttendue) !== Number(p.version)) throw echec(409, 'version', 'Cette fiche a changé entre-temps : rechargez-la.');
    const champs = await lireChampsPartenaire(corps, { creation: false, partenaireId: p.id });
    const cles = Object.keys(champs);
    if (!cles.length) return partenaire(acteur, id);
    const t = maintenant();
    const lot = [
      maj('sp_partenaires', champs, p.id, ', version = version + 1, maj_par = ?, maj_le = ?', [acteur.compte, iso(t)]),
      ev('sponsors.partenaire_modifie', acteur, 'sp_partenaire', p.id, { titre: champs.nom ?? p.nom, champs: cles }, t),
    ];
    if (champs.responsable_id && champs.responsable_id !== p.responsable_id && champs.responsable_id !== acteur.compte) lot.push(ev('sponsors.responsable', acteur, 'sp_partenaire', p.id, { titre: champs.nom ?? p.nom, compte: champs.responsable_id, genre: 'partenaire' }, t));
    await base.lot(lot);
    return partenaire(acteur, id);
  }

  /** Supprime un partenaire et ses données (contrats, obligations, contacts, échanges, pièces et fichiers). */
  async function supprimerPartenaire(acteur, id) {
    await ctxGerer(acteur);
    const p = await partenaireLigne(id);
    const t = maintenant();
    const fichiers = await base.tous('SELECT fichier_id FROM sp_pieces WHERE partenaire_id = ? AND fichier_id IS NOT NULL', [p.id]);
    await base.lot([
      { sql: 'DELETE FROM sp_suivi WHERE obligation_id IN (SELECT id FROM sp_obligations WHERE partenaire_id = ?)', params: [p.id] },
      { sql: 'DELETE FROM sp_obligations WHERE partenaire_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_contrats WHERE partenaire_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_contacts WHERE partenaire_id = ? AND prospect_id IS NULL', params: [p.id] },
      { sql: 'UPDATE sp_contacts SET partenaire_id = NULL WHERE partenaire_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_echanges WHERE partenaire_id = ? AND prospect_id IS NULL', params: [p.id] },
      { sql: 'UPDATE sp_echanges SET partenaire_id = NULL WHERE partenaire_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_pieces WHERE partenaire_id = ? AND prospect_id IS NULL', params: [p.id] },
      { sql: 'UPDATE sp_pieces SET partenaire_id = NULL, contrat_id = NULL WHERE partenaire_id = ?', params: [p.id] },
      { sql: 'UPDATE sp_prospects SET partenaire_id = NULL WHERE partenaire_id = ?', params: [p.id] },
      { sql: 'DELETE FROM sp_partenaires WHERE id = ?', params: [p.id] },
      ev('sponsors.partenaire_supprime', acteur, 'sp_partenaire', p.id, { titre: p.nom }, t),
    ]);
    for (const f of fichiers) await effacerFichierSiOrphelin(f.fichier_id, t);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Contrats

  function lireChampsContrat(corps, existant) {
    const champs = {};
    if (corps?.intitule !== undefined) champs.intitule = texteNettoye(corps.intitule, 120);
    if (!existant || corps?.debut !== undefined) champs.debut = jour(corps?.debut, 'debut');
    if (!existant || corps?.fin !== undefined) champs.fin = jour(corps?.fin, 'fin');
    if (corps?.montant !== undefined) champs.montant = montant(corps.montant);
    if (corps?.dotation !== undefined) champs.dotation = texteLong(corps.dotation, 2000);
    if (corps?.valeurDotation !== undefined) champs.valeur_dotation = montant(corps.valeurDotation, 'valeur-dotation');
    if (corps?.renouvellement !== undefined) champs.renouvellement = choix(corps.renouvellement, RENOUVELLEMENTS, 'renouvellement');
    if (corps?.preavisJours !== undefined) {
      const n = Number(corps.preavisJours);
      if (!Number.isInteger(n) || n < 0 || n > 365) throw echec(400, 'preavis', 'Préavis : 0 à 365 jours.');
      champs.preavis_jours = n;
    }
    if (corps?.statut !== undefined) champs.statut = choix(corps.statut, STATUTS_CONTRAT, 'statut');
    if (corps?.notes !== undefined) champs.notes = texteLong(corps.notes, 4000);
    const debut = champs.debut ?? existant?.debut;
    const fin = champs.fin ?? existant?.fin;
    if (fin < debut) throw echec(400, 'fin', 'La fin du contrat précède son début.');
    if (existant && (champs.fin !== undefined || champs.preavis_jours !== undefined || champs.statut !== undefined)) champs.rappel_fin_le = null;
    return champs;
  }

  async function contratLigne(id) {
    exigerUuid(id, 'contrat');
    const c = await base.premier('SELECT * FROM sp_contrats WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!c) throw echec(404, 'contrat-introuvable', 'Contrat introuvable.');
    return c;
  }

  async function creerContrat(acteur, partenaireId, corps) {
    await ctxGerer(acteur);
    const p = await partenaireLigne(partenaireId);
    const champs = { intitule: '', montant: 0, dotation: '', valeur_dotation: 0, renouvellement: 'manuel', preavis_jours: 30, statut: 'actif', notes: '', ...lireChampsContrat(corps, null) };
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      ajout('sp_contrats', { id, partenaire_id: p.id, ...champs, cree_par: acteur.compte, cree_le: iso(t), maj_le: iso(t) }),
      ev('sponsors.contrat_enregistre', acteur, 'sp_contrat', id, { titre: p.nom, debut: champs.debut, fin: champs.fin }, t),
    ]);
    return partenaire(acteur, p.id);
  }

  async function modifierContrat(acteur, id, corps) {
    await ctxGerer(acteur);
    const c = await contratLigne(id);
    const champs = lireChampsContrat(corps, c);
    const cles = Object.keys(champs);
    const p = await partenaireLigne(c.partenaire_id);
    if (cles.length) {
      const t = maintenant();
      await base.lot([
        maj('sp_contrats', champs, c.id, ', maj_le = ?', [iso(t)]),
        ev('sponsors.contrat_enregistre', acteur, 'sp_contrat', c.id, { titre: p.nom, debut: champs.debut ?? c.debut, fin: champs.fin ?? c.fin }, t),
      ]);
    }
    return partenaire(acteur, p.id);
  }

  async function supprimerContrat(acteur, id) {
    await ctxGerer(acteur);
    const c = await contratLigne(id);
    const p = await partenaireLigne(c.partenaire_id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE sp_contrats SET supprime_le = ? WHERE id = ?', params: [iso(t), c.id] },
      { sql: 'UPDATE sp_obligations SET contrat_id = NULL WHERE contrat_id = ?', params: [c.id] },
      { sql: 'UPDATE sp_pieces SET contrat_id = NULL WHERE contrat_id = ?', params: [c.id] },
      ev('sponsors.contrat_supprime', acteur, 'sp_contrat', c.id, { titre: p.nom }, t),
    ]);
    return partenaire(acteur, p.id);
  }

  // ---------------------------------------------------------------- Obligations

  async function lireChampsObligation(corps, existant, partenaireId) {
    const champs = {};
    if (!existant || corps?.intitule !== undefined) champs.intitule = nomObligatoire(corps?.intitule, 160);
    if (corps?.genre !== undefined) champs.genre = choix(corps.genre, GENRES_OBLIGATION, 'genre');
    if (corps?.comptage !== undefined) champs.comptage = choix(corps.comptage, ['manuel', 'cartes'], 'comptage');
    if (corps?.frequence !== undefined) champs.frequence = choix(corps.frequence, FREQUENCES, 'frequence');
    if (corps?.quantite !== undefined) {
      const n = Number(corps.quantite);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw echec(400, 'quantite', 'Quantité : 1 à 1000 par période.');
      champs.quantite = n;
    }
    if (corps?.rappelJours !== undefined) {
      const n = Number(corps.rappelJours);
      if (!Number.isInteger(n) || n < 0 || n > 90) throw echec(400, 'rappel', 'Rappel : 0 à 90 jours avant l’échéance.');
      champs.rappel_jours = n;
    }
    if (corps?.responsable !== undefined) champs.responsable_id = await lireResponsable(corps.responsable);
    if (corps?.notes !== undefined) champs.notes = texteLong(corps.notes, 2000);
    if (corps?.archive !== undefined) champs.archive_le = corps.archive ? iso(maintenant()) : null;
    let contrat = null;
    if (corps?.contratId !== undefined) {
      if (corps.contratId === null) champs.contrat_id = null;
      else {
        contrat = await contratLigne(corps.contratId);
        if (contrat.partenaire_id !== partenaireId) throw echec(400, 'contrat', 'Ce contrat est celui d’un autre partenaire.');
        champs.contrat_id = contrat.id;
      }
    }
    // Bornes : saisies, sinon celles du contrat lié (création), sinon aujourd'hui.
    if (corps?.debut !== undefined) champs.debut = jour(corps.debut, 'debut');
    else if (!existant) champs.debut = contrat?.debut ?? aujourdhui();
    if (corps?.fin !== undefined) champs.fin = jour(corps.fin, 'fin', { facultatif: true });
    else if (!existant) champs.fin = contrat?.fin ?? null;
    const debut = champs.debut ?? existant?.debut;
    const fin = champs.fin !== undefined ? champs.fin : existant?.fin;
    if (fin && fin < debut) throw echec(400, 'fin', 'La fin précède le début.');
    return champs;
  }

  async function obligationLigne(id) {
    exigerUuid(id, 'obligation');
    const o = await base.premier('SELECT * FROM sp_obligations WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!o) throw echec(404, 'obligation-introuvable', 'Contrepartie introuvable.');
    return o;
  }

  async function creerObligation(acteur, partenaireId, corps) {
    await ctxGerer(acteur);
    const p = await partenaireLigne(partenaireId);
    const champs = { genre: 'autre', comptage: 'manuel', frequence: 'mensuelle', quantite: 1, rappel_jours: 7, responsable_id: null, notes: '', contrat_id: null, ...(await lireChampsObligation(corps, null, p.id)) };
    delete champs.archive_le;
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      ajout('sp_obligations', { id, partenaire_id: p.id, ...champs, cree_par: acteur.compte, cree_le: iso(t), maj_le: iso(t) }),
      ev('sponsors.obligation_enregistree', acteur, 'sp_obligation', id, { titre: p.nom, intitule: champs.intitule }, t),
    ]);
    return partenaire(acteur, p.id);
  }

  async function modifierObligation(acteur, id, corps) {
    await ctxGerer(acteur);
    const o = await obligationLigne(id);
    const champs = await lireChampsObligation(corps, o, o.partenaire_id);
    const cles = Object.keys(champs);
    const p = await partenaireLigne(o.partenaire_id);
    if (cles.length) {
      const t = maintenant();
      await base.lot([
        maj('sp_obligations', champs, o.id, ', maj_le = ?', [iso(t)]),
        ev('sponsors.obligation_enregistree', acteur, 'sp_obligation', o.id, { titre: p.nom, intitule: champs.intitule ?? o.intitule }, t),
      ]);
    }
    return partenaire(acteur, p.id);
  }

  async function supprimerObligation(acteur, id) {
    await ctxGerer(acteur);
    const o = await obligationLigne(id);
    const p = await partenaireLigne(o.partenaire_id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE sp_obligations SET supprime_le = ? WHERE id = ?', params: [iso(t), o.id] },
      ev('sponsors.obligation_supprimee', acteur, 'sp_obligation', o.id, { titre: p.nom, intitule: o.intitule }, t),
    ]);
    return partenaire(acteur, p.id);
  }

  /** `PUT /sponsors/obligations/:id/suivi` `{ periode, fait, note? }` : avancement saisi à la main pour une période. */
  async function suivre(acteur, id, corps) {
    await ctxGerer(acteur);
    const o = await obligationLigne(id);
    const aujourd = aujourdhui();
    const connues = periodesEntre(o.frequence, o.debut, o.fin ?? null, o.fin && o.fin > aujourd ? o.fin : aujourd, 400).map(p => p.cle);
    if (typeof corps?.periode !== 'string' || !connues.includes(corps.periode)) throw echec(400, 'periode', 'Période inconnue pour cette contrepartie.');
    const fait = Number(corps?.fait);
    if (!Number.isInteger(fait) || fait < 0 || fait > 1000) throw echec(400, 'fait', 'Quantité faite : 0 à 1000.');
    const t = maintenant();
    const p = await partenaireLigne(o.partenaire_id);
    await base.lot([
      {
        sql: `INSERT INTO sp_suivi (id, obligation_id, periode, fait, note, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (obligation_id, periode) DO UPDATE SET fait = excluded.fait, note = excluded.note, maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
        params: [nouvelId(), o.id, corps.periode, fait, texteNettoye(corps?.note, 300), acteur.compte, iso(t)],
      },
      ev('sponsors.obligation_suivie', acteur, 'sp_obligation', o.id, { titre: p.nom, intitule: o.intitule, periode: corps.periode, fait }, t),
    ]);
    return partenaire(acteur, p.id);
  }

  // ---------------------------------------------------------------- Tableau de bord

  /**
   * `GET /sponsors/tableau-de-bord?annee` : pipeline (nombre et valeur par étape), conversion (12 derniers mois),
   * revenus et dotations par mois de l'année (contrats répartis au prorata des jours), obligations en retard,
   * contrats bientôt expirés (60 jours), prochaines actions (en retard et 7 jours).
   */
  async function tableauDeBord(acteur, { annee } = {}) {
    await ctxVoir(acteur);
    const aujourd = aujourdhui();
    const an = /^\d{4}$/.test(String(annee ?? '')) && Number(annee) >= 2000 && Number(annee) <= 2100 ? Number(annee) : Number(aujourd.slice(0, 4));
    const etapesListe = await etapesLignes();
    const prospects = await base.tous('SELECT id, nom, etape_id, valeur_estimee, prochaine_action, prochaine_action_le, perdu_le, signe_le, cree_le, responsable_id FROM sp_prospects WHERE supprime_le IS NULL', []);
    const pipelineEtapes = etapesListe
      .filter(e => !e.archive_le || prospects.some(p => p.etape_id === e.id))
      .map(e => {
        const siens = prospects.filter(p => p.etape_id === e.id);
        return { ...etapePublique(e), n: siens.length, valeur: siens.reduce((s, p) => s + Number(p.valeur_estimee), 0) };
      });
    const issue = new Map(etapesListe.map(e => [e.id, e.issue]));
    const ouverts = prospects.filter(p => issue.get(p.etape_id) === 'ouverte');
    const depuis = ajouterJours(aujourd, -365);
    const signes = prospects.filter(p => p.signe_le && jourDans(Date.parse(p.signe_le)) >= depuis).length;
    const perdus = prospects.filter(p => issue.get(p.etape_id) === 'perdue' && p.perdu_le && jourDans(Date.parse(p.perdu_le)) >= depuis).length;

    const contrats = await base.tous("SELECT c.*, p.nom AS partenaire_nom FROM sp_contrats c JOIN sp_partenaires p ON p.id = c.partenaire_id AND p.supprime_le IS NULL WHERE c.supprime_le IS NULL AND c.statut IN ('actif', 'termine')", []);
    const mois = Array.from({ length: 12 }, (_, i) => {
      const debut = `${an}-${String(i + 1).padStart(2, '0')}-01`;
      return { mois: debut.slice(0, 7), debut, fin: periodeDe('mensuelle', debut).fin, numeraire: 0, nature: 0 };
    });
    for (const c of contrats) {
      const total = ecartJours(c.debut, c.fin) + 1;
      if (total <= 0) continue;
      for (const m of mois) {
        const d = m.debut > c.debut ? m.debut : c.debut;
        const f = m.fin < c.fin ? m.fin : c.fin;
        if (f < d) continue;
        const part = (ecartJours(d, f) + 1) / total;
        m.numeraire += Number(c.montant) * part;
        m.nature += Number(c.valeur_dotation) * part;
      }
    }
    for (const m of mois) {
      m.numeraire = Math.round(m.numeraire);
      m.nature = Math.round(m.nature);
    }

    const obligations = await base.tous("SELECT o.*, p.nom AS partenaire_nom FROM sp_obligations o JOIN sp_partenaires p ON p.id = o.partenaire_id AND p.supprime_le IS NULL AND p.statut = 'actif' WHERE o.supprime_le IS NULL AND o.archive_le IS NULL", []);
    const av = await avancement(obligations, aujourd, { historique: 12 });
    const enRetard = [];
    const aFaire = [];
    for (const o of obligations) {
      const a = av.get(o.id);
      for (const p of a?.periodes ?? []) if (p.etat === 'en_retard') enRetard.push({ obligationId: o.id, partenaire: { id: o.partenaire_id, nom: o.partenaire_nom }, intitule: o.intitule, periode: p.cle, fin: p.fin, fait: p.fait, quantite: p.quantite });
      if (a?.courante && a.courante.etat === 'a_faire') aFaire.push({ obligationId: o.id, partenaire: { id: o.partenaire_id, nom: o.partenaire_nom }, intitule: o.intitule, periode: a.courante.cle, fin: a.courante.fin, fait: a.courante.fait, quantite: a.courante.quantite, joursRestants: ecartJours(aujourd, a.courante.fin) });
    }
    enRetard.sort((x, y) => x.fin.localeCompare(y.fin));
    aFaire.sort((x, y) => x.fin.localeCompare(y.fin));

    const limite = ajouterJours(aujourd, JOURS_EXPIRATION);
    const expirant = contrats
      .filter(c => c.statut === 'actif' && c.fin <= limite)
      .map(c => ({ contratId: c.id, partenaire: { id: c.partenaire_id, nom: c.partenaire_nom }, intitule: c.intitule, fin: c.fin, joursRestants: ecartJours(aujourd, c.fin), renouvellement: c.renouvellement }))
      .sort((x, y) => x.fin.localeCompare(y.fin));

    const dans7 = ajouterJours(aujourd, 7);
    const actions = ouverts
      .filter(p => p.prochaine_action_le && jourDans(Date.parse(p.prochaine_action_le)) <= dans7)
      .map(p => ({ prospectId: p.id, nom: p.nom, prochaineAction: p.prochaine_action, prochaineActionLe: p.prochaine_action_le, enRetard: jourDans(Date.parse(p.prochaine_action_le)) < aujourd, responsable: p.responsable_id ?? null }))
      .sort((x, y) => x.prochaineActionLe.localeCompare(y.prochaineActionLe));
    const actifs = await base.premier("SELECT COUNT(*) AS n FROM sp_partenaires WHERE supprime_le IS NULL AND statut = 'actif'", []);
    return {
      aujourdhui: aujourd,
      pipeline: { etapes: pipelineEtapes, ouverts: ouverts.length, valeurOuverte: ouverts.reduce((s, p) => s + Number(p.valeur_estimee), 0) },
      conversion: { signes, perdus, taux: signes + perdus ? Math.round((signes / (signes + perdus)) * 1000) / 10 : null, depuis },
      revenus: { annee: an, mois: mois.map(({ mois: m, numeraire, nature }) => ({ mois: m, numeraire, nature })), numeraire: mois.reduce((s, m) => s + m.numeraire, 0), nature: mois.reduce((s, m) => s + m.nature, 0) },
      partenairesActifs: Number(actifs?.n ?? 0),
      obligationsEnRetard: enRetard.slice(0, 100),
      obligationsAFaire: aFaire.slice(0, 50),
      contratsExpirant: expirant,
      actions: actions.slice(0, 50),
      noms: await pseudosDe(base, actions.map(a => a.responsable).filter(Boolean)),
    };
  }

  // ---------------------------------------------------------------- Import / export CSV

  function lireContenuCsv(corps) {
    const contenu = corps?.contenu;
    if (typeof contenu !== 'string' || !contenu.trim()) throw echec(400, 'csv-vide', 'Fichier CSV vide.');
    if (contenu.length > MAX_IMPORT_OCTETS) throw echec(413, 'trop-gros', 'Fichier trop volumineux (1 Mo au plus).');
    try {
      return lireCsv(contenu);
    } catch (e) {
      if (e instanceof CsvInvalide) {
        const err = echec(400, 'csv-invalide', 'Fichier CSV illisible.');
        err.details = { raison: e.code, ligne: e.ligne };
        throw err;
      }
      throw e;
    }
  }

  /** `POST /sponsors/import/apercu` `{ contenu }` : en-têtes, exemples, correspondance proposée. */
  async function apercuImport(acteur, corps) {
    await ctxGerer(acteur);
    const { lignes, separateur } = lireContenuCsv(corps);
    const [entetes = [], ...donnees] = lignes;
    return {
      separateur,
      entetes: entetes.map(e => texteNettoye(e, 80)),
      exemples: donnees.slice(0, 5).map(l => entetes.map((_, i) => texteNettoye(l[i] ?? '', 120))),
      lignes: donnees.length,
      correspondance: correspondanceProposee(entetes),
      champs: [...CHAMPS_IMPORT],
    };
  }

  /**
   * `POST /sponsors/import` `{ contenu, correspondance: { index: champ }, etapeId? }` : crée les prospects (et
   * leur contact principal). Une ligne illisible est écartée avec sa raison ; un nom déjà présent (sans
   * accents ni casse) est un doublon, écarté. Tout est créé en un lot (rien de partiel en cas d'erreur).
   */
  async function importer(acteur, corps) {
    await ctxGerer(acteur);
    const { lignes, numeros } = lireContenuCsv(corps);
    const correspondance = corps?.correspondance;
    if (!correspondance || typeof correspondance !== 'object' || Array.isArray(correspondance)) throw echec(400, 'correspondance', 'Correspondance des colonnes illisible.');
    const colonnes = {};
    for (const [index, champ] of Object.entries(correspondance)) {
      if (champ === null || champ === '') continue;
      if (!/^\d{1,2}$/.test(index) || !CHAMPS_IMPORT.includes(champ)) throw echec(400, 'correspondance', 'Correspondance des colonnes illisible.');
      if (Object.values(colonnes).includes(champ)) throw echec(400, 'correspondance', `Colonne en double : ${champ}.`);
      colonnes[Number(index)] = champ;
    }
    if (!Object.values(colonnes).includes('nom')) throw echec(400, 'correspondance', 'Indiquez la colonne du nom (entreprise ou marque).');
    const etapesListe = await etapesLignes({ archives: false });
    const parNom = new Map();
    for (const e of etapesListe) {
      if (e.cle) parNom.set(sansAccentsMinuscules(e.cle.replace(/_/g, ' ')), e);
      if (e.nom) parNom.set(sansAccentsMinuscules(e.nom), e);
    }
    const etapeDefaut = corps?.etapeId ? await etapeLigne(corps.etapeId) : etapesListe[0];
    if (!etapeDefaut || etapeDefaut.issue !== 'ouverte') throw echec(400, 'etape', 'Étape de départ : une étape ouverte.');
    const existants = new Set((await base.tous('SELECT nom FROM sp_prospects WHERE supprime_le IS NULL', [])).map(p => sansAccentsMinuscules(p.nom)));
    const total = await base.premier('SELECT COUNT(*) AS n FROM sp_prospects WHERE supprime_le IS NULL', []);
    let place = MAX_PROSPECTS - Number(total?.n ?? 0);
    const t = maintenant();
    const bilan = { crees: 0, doublons: [], invalides: [] };
    const lot = [];
    const positions = new Map();
    for (let i = 1; i < lignes.length; i++) {
      const ligne = lignes[i];
      const numero = numeros[i];
      const v = {};
      for (const [index, champ] of Object.entries(colonnes)) v[champ] = String(ligne[Number(index)] ?? '').trim();
      try {
        const nom = nomObligatoire(v.nom);
        const cle = sansAccentsMinuscules(nom);
        if (existants.has(cle)) {
          bilan.doublons.push({ ligne: numero, nom });
          continue;
        }
        if (place <= 0) throw echec(409, 'trop-de-prospects', 'Plafond de prospects atteint.');
        const taille = v.taille ? TAILLES.find(x => x && sansAccentsMinuscules(v.taille).startsWith(x)) : '';
        if (v.taille && taille === undefined) throw echec(400, 'taille', 'Valeur inconnue.');
        const priorite = v.priorite ? { basse: 'basse', low: 'basse', normale: 'normale', normal: 'normale', moyenne: 'normale', haute: 'haute', high: 'haute' }[sansAccentsMinuscules(v.priorite)] : 'normale';
        if (!priorite) throw echec(400, 'priorite', 'Valeur inconnue.');
        const interet = v.interet ? { 0: 0, 1: 1, 2: 2, 3: 3, faible: 1, low: 1, moyen: 2, medium: 2, fort: 3, high: 3 }[sansAccentsMinuscules(v.interet)] : 0;
        if (interet === undefined) throw echec(400, 'interet', 'Valeur inconnue.');
        const etape = v.etape ? parNom.get(sansAccentsMinuscules(v.etape)) : etapeDefaut;
        if (!etape || etape.issue !== 'ouverte') throw echec(400, 'etape', 'Étape inconnue.');
        const id = nouvelId();
        const position = (positions.get(etape.id) ?? (await positionFin(etape.id))) + 0;
        positions.set(etape.id, position + 1024);
        lot.push({
          sql: `INSERT INTO sp_prospects (id, nom, site, secteur, taille, source, interet, priorite, valeur_estimee, etape_id, position, notes, prochaine_action, teams, cree_par, cree_le, maj_par, maj_le)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
          params: [id, nom, lireSite(v.site && !/^[a-z]+:\/\//i.test(v.site) ? `https://${v.site}` : v.site), texteNettoye(v.secteur, 80), taille, texteNettoye(v.source, 120), interet, priorite, montant(v.valeur, 'valeur'), etape.id, position, texteLong(v.notes, 8000), texteNettoye(v.prochaine_action, 200), acteur.compte, iso(t), acteur.compte, iso(t)],
        });
        if (v.contact_nom || v.contact_email || v.contact_telephone) {
          lot.push(instructionContact({ nom: v.contact_nom || v.contact_email || v.contact_telephone, role: v.contact_role, email: v.contact_email, telephone: v.contact_telephone, reseaux: v.contact_reseaux, principal: true }, { prospectId: id }, t));
        }
        existants.add(cle);
        place--;
        bilan.crees++;
      } catch (e) {
        if (e?.code === 'trop-de-prospects') {
          bilan.invalides.push({ ligne: numero, code: e.code });
          break;
        }
        bilan.invalides.push({ ligne: numero, code: typeof e?.code === 'string' ? e.code : 'ligne' });
      }
    }
    if (lot.length) {
      lot.push(ev('sponsors.import', acteur, 'sp_import', null, { crees: bilan.crees, doublons: bilan.doublons.length, invalides: bilan.invalides.length }, t));
      for (let i = 0; i < lot.length; i += 400) await base.lot(lot.slice(i, i + 400));
    }
    return { ...bilan, doublons: bilan.doublons.slice(0, 200), invalides: bilan.invalides.slice(0, 200), nDoublons: bilan.doublons.length, nInvalides: bilan.invalides.length };
  }

  const euros = c => (Number(c) / 100).toFixed(2);

  /** `GET /sponsors/export/prospects.csv` : un prospect par ligne, contact principal (formules neutralisées). */
  async function exporterProspects(acteur) {
    await ctxGerer(acteur);
    const lignes = await base.tous('SELECT * FROM sp_prospects WHERE supprime_le IS NULL ORDER BY nom LIMIT ?', [MAX_PROSPECTS]);
    const etapesListe = new Map((await etapesLignes()).map(e => [e.id, e]));
    const contacts = await base.tous('SELECT * FROM sp_contacts WHERE prospect_id IS NOT NULL ORDER BY principal DESC, cree_le', []);
    const premier = new Map();
    for (const c of contacts) if (!premier.has(c.prospect_id)) premier.set(c.prospect_id, c);
    const noms = await pseudosDe(base, lignes.map(p => p.responsable_id).filter(Boolean));
    const t = maintenant();
    await base.lot([ev('sponsors.export', acteur, 'sp_export', null, { genre: 'prospects', n: lignes.length }, t)]);
    const contenu = ecrireCsv(
      ['nom', 'site', 'secteur', 'taille', 'source', 'interet', 'priorite', 'valeur', 'etape', 'responsable', 'prochaine_action', 'prochaine_action_le', 'raison_perte', 'contact_nom', 'contact_role', 'contact_email', 'contact_telephone', 'contact_reseaux', 'notes', 'cree_le'],
      lignes.map(p => {
        const e = etapesListe.get(p.etape_id);
        const c = premier.get(p.id);
        return [p.nom, p.site, p.secteur, p.taille, p.source, p.interet, p.priorite, euros(p.valeur_estimee), e?.nom ?? e?.cle ?? '', p.responsable_id ? (noms[p.responsable_id] ?? '') : '', p.prochaine_action, p.prochaine_action_le ?? '', p.raison_perte ?? '', c?.nom ?? '', c?.role ?? '', c?.email ?? '', c?.telephone ?? '', jsonOu(c?.reseaux, []).join(' '), p.notes, p.cree_le];
      }),
    );
    return { nom: `prospects-${jourDans(t)}.csv`, type: 'text/csv; charset=utf-8', contenu };
  }

  /** `GET /sponsors/export/partenaires.csv` : un partenaire par ligne, contrat en cours, contreparties. */
  async function exporterPartenaires(acteur) {
    await ctxGerer(acteur);
    const lignes = await base.tous('SELECT * FROM sp_partenaires WHERE supprime_le IS NULL ORDER BY nom LIMIT 2000', []);
    const aujourd = aujourdhui();
    const contrats = await contratsDe(lignes.map(p => p.id));
    const obligations = await lignesParIds(base, 'SELECT partenaire_id, intitule, quantite, frequence FROM sp_obligations WHERE supprime_le IS NULL AND archive_le IS NULL AND partenaire_id', lignes.map(p => p.id));
    const teams = await nomsTeams(lignes.flatMap(p => jsonOu(p.teams, [])));
    const t = maintenant();
    await base.lot([ev('sponsors.export', acteur, 'sp_export', null, { genre: 'partenaires', n: lignes.length }, t)]);
    const contenu = ecrireCsv(
      ['nom', 'niveau', 'statut', 'secteur', 'site', 'teams', 'contrat_debut', 'contrat_fin', 'montant', 'dotation', 'valeur_dotation', 'renouvellement', 'contreparties', 'notes'],
      lignes.map(p => {
        const siens = contrats.filter(c => c.partenaire_id === p.id);
        const c = siens.find(x => x.statut === 'actif' && x.debut <= aujourd && x.fin >= aujourd) ?? siens.at(-1);
        return [
          p.nom,
          p.niveau,
          p.statut,
          p.secteur,
          p.site,
          jsonOu(p.teams, []).map(id => teams.get(id) ?? '').filter(Boolean).join(' | '),
          c?.debut ?? '',
          c?.fin ?? '',
          c ? euros(c.montant) : '',
          c?.dotation ?? '',
          c ? euros(c.valeur_dotation) : '',
          c?.renouvellement ?? '',
          obligations.filter(o => o.partenaire_id === p.id).map(o => `${o.intitule} (${o.quantite}/${o.frequence})`).join(' | '),
          p.notes,
        ];
      }),
    );
    return { nom: `partenaires-${jourDans(t)}.csv`, type: 'text/csv; charset=utf-8', contenu };
  }

  // ---------------------------------------------------------------- RGPD des contacts

  async function contactsParEmail(email) {
    const adresse = lireEmail(email);
    if (!adresse) throw echec(400, 'email', 'Adresse e-mail invalide.');
    const cle = adresse.toLowerCase();
    // Comparaison sans casse faite ici (pas de LOWER propre à un moteur) ; la colonne est indexée pour le préfiltre.
    const candidats = await base.tous('SELECT * FROM sp_contacts WHERE email <> ?', ['']);
    return candidats.filter(c => c.email.toLowerCase() === cle);
  }

  /** `POST /sponsors/rgpd/export` `{ email }` : tout ce que la rubrique garde sur cette personne. */
  async function rgpdExport(acteur, corps) {
    await ctxGerer(acteur);
    const contacts = await contactsParEmail(corps?.email);
    const echanges = await lignesParIds(base, 'SELECT * FROM sp_echanges WHERE supprime_le IS NULL AND contact_id', contacts.map(c => c.id), { apres: 'ORDER BY date' });
    const prospects = new Map((await lignesParIds(base, 'SELECT id, nom FROM sp_prospects WHERE id', contacts.map(c => c.prospect_id))).map(p => [p.id, p.nom]));
    const partenaires = new Map((await lignesParIds(base, 'SELECT id, nom FROM sp_partenaires WHERE id', contacts.map(c => c.partenaire_id))).map(p => [p.id, p.nom]));
    const t = maintenant();
    await base.lot([ev('sponsors.rgpd_contact', acteur, 'sp_contact', null, { action: 'export', n: contacts.length }, t)]);
    return {
      exporteLe: iso(t),
      contacts: contacts.map(c => ({
        nom: c.nom,
        role: c.role,
        email: c.email,
        telephone: c.telephone,
        reseaux: jsonOu(c.reseaux, []),
        notes: c.notes,
        prospect: c.prospect_id ? (prospects.get(c.prospect_id) ?? null) : null,
        partenaire: c.partenaire_id ? (partenaires.get(c.partenaire_id) ?? null) : null,
        creeLe: c.cree_le,
        echanges: echanges.filter(e => e.contact_id === c.id).map(e => ({ genre: e.genre, date: e.date, resume: e.resume })),
      })),
    };
  }

  /** `POST /sponsors/rgpd/effacer` `{ email }` : efface ces contacts et les échanges qui les concernent. */
  async function rgpdEffacer(acteur, corps) {
    await ctxGerer(acteur);
    const contacts = await contactsParEmail(corps?.email);
    const ids = contacts.map(c => c.id);
    const t = maintenant();
    const lot = [];
    for (const id of ids) lot.push({ sql: 'DELETE FROM sp_echanges WHERE contact_id = ?', params: [id] }, { sql: 'DELETE FROM sp_contacts WHERE id = ?', params: [id] });
    lot.push(ev('sponsors.rgpd_contact', acteur, 'sp_contact', null, { action: 'effacement', n: ids.length }, t));
    await base.lot(lot);
    return { effaces: ids.length };
  }

  // ---------------------------------------------------------------- Journal

  async function journal(acteur, { avant } = {}) {
    await ctxGerer(acteur);
    const pagine = typeof avant === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(avant);
    const lignes = await base.tous(`SELECT * FROM journal WHERE action LIKE 'sponsors.%' ${pagine ? 'AND cree_le < ?' : ''} ORDER BY cree_le DESC, id LIMIT 100`, pagine ? [avant] : []);
    const noms = await pseudosDe(base, lignes.flatMap(l => [l.acteur_id, jsonOu(l.meta, {}).compte]).filter(Boolean));
    return { entrees: lignes.map(l => ({ id: l.id, acteur: l.acteur_id ?? null, action: l.action, entite: l.entite_type ?? null, entiteId: l.entite_id ?? null, meta: jsonOu(l.meta, {}), date: l.cree_le })), noms };
  }

  return {
    exigerGerer: ctxGerer,
    moi,
    comptes,
    mentionnables,
    etapes,
    creerEtape,
    modifierEtape,
    pipeline,
    creerProspect,
    prospect,
    modifierProspect,
    deplacerProspect,
    supprimerProspect,
    convertir,
    ajouterContact,
    modifierContact,
    supprimerContact,
    ajouterEchange,
    supprimerEchange,
    ajouterPiece,
    supprimerPiece,
    lienPiece,
    partenaires,
    partenaire,
    creerPartenaire,
    modifierPartenaire,
    supprimerPartenaire,
    creerContrat,
    modifierContrat,
    supprimerContrat,
    creerObligation,
    modifierObligation,
    supprimerObligation,
    suivre,
    tableauDeBord,
    apercuImport,
    importer,
    exporterProspects,
    exporterPartenaires,
    rgpdExport,
    rgpdEffacer,
    journal,
    avancement,
  };
}

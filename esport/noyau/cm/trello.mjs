/**
 * Lecture d'un export JSON de Trello (Menu ⋯ › Imprimer, exporter et partager › Exporter au format JSON).
 * PUR : aucune base, AUCUNE requête réseau vers Trello. Le fichier est une donnée NON FIABLE :
 *  - structure vérifiée strictement (types, identifiants Trello de 24 caractères hexadécimaux, références
 *    entre listes, cartes, étiquettes et checklists) ; un fichier mal formé est refusé avec le chemin fautif ;
 *  - volumes bornés (listes, cartes, éléments, commentaires…) et textes tronqués ;
 *  - Markdown des descriptions et commentaires nettoyé (review/markdown.mjs : HTML neutralisé, liens http(s)
 *    seulement, pas d'image) ; adresses des pièces jointes : https seulement, sinon ignorées ;
 *  - champs inconnus ignorés ; rien n'est exécuté ni chargé.
 * Les fichiers DÉPOSÉS sur Trello restent des LIENS vers Trello (il faut être connecté à Trello pour les
 * ouvrir) : l'import ne les télécharge pas.
 */

import { texteNettoye } from '../outils.mjs';
import { NOTE_MAX, lienSur, nettoyerNote } from '../review/markdown.mjs';

export const TAILLE_MAX_TRELLO = 15 * 1024 * 1024;
export const LIMITES_TRELLO = Object.freeze({ listes: 300, cartes: 5000, etiquettes: 200, checklists: 5000, elements: 20000, commentaires: 20000, pieces: 10000, membres: 500, actions: 100000 });
const MOTIF_ID = /^[0-9a-f]{24}$/;

/** Couleurs des étiquettes de Trello → couleurs de l'app. */
export const COULEURS_TRELLO = Object.freeze({
  green: '#4bce97', green_dark: '#1f845a', green_light: '#baf3db',
  yellow: '#e2b203', yellow_dark: '#946f00', yellow_light: '#f8e6a0',
  orange: '#faa53d', orange_dark: '#c25100', orange_light: '#fedec8',
  red: '#f87462', red_dark: '#c9372c', red_light: '#ffd5d2',
  purple: '#9f8fef', purple_dark: '#6e5dc6', purple_light: '#dfd8fd',
  blue: '#579dff', blue_dark: '#0c66e4', blue_light: '#cce0ff',
  sky: '#6cc3e0', sky_dark: '#227d9b', sky_light: '#c6edfb',
  lime: '#94c748', lime_dark: '#5b7f24', lime_light: '#d3f1a7',
  pink: '#e774bb', pink_dark: '#ae4787', pink_light: '#fdd0ec',
  black: '#8590a2', black_dark: '#626f86', black_light: '#dcdfe4',
});
const COULEUR_DEFAUT = '#8590a2';

export class TrelloInvalide extends Error {
  constructor(chemin, raison) {
    super(`${chemin} : ${raison}`);
    this.chemin = chemin;
    this.raison = raison;
  }
}

const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const tableau = (v, chemin, max) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new TrelloInvalide(chemin, 'liste attendue');
  if (v.length > max) throw new TrelloInvalide(chemin, `trop d’éléments (${max} au plus)`);
  return v;
};
const id = (v, chemin) => {
  if (typeof v !== 'string' || !MOTIF_ID.test(v)) throw new TrelloInvalide(chemin, 'identifiant Trello invalide');
  return v;
};
const idFacultatif = (v, chemin) => (v === undefined || v === null || v === '' ? null : id(v, chemin));
const nombre = (v, repli = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : repli);
const booleen = v => v === true;
const date = v => {
  if (typeof v !== 'string' || v.length > 40) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && ms > Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) ? new Date(ms).toISOString() : null;
};
const couleur = v => (typeof v === 'string' && COULEURS_TRELLO[v]) || null;
const urlSure = v => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t.length <= 2000 && /^https:\/\//i.test(t) && lienSur(t) ? t : null;
};

/**
 * Analyse un export Trello. Rend un modèle normalisé `{ tableau, listes, etiquettes, cartes, checklists,
 * commentaires, membres, avertissements }` ; lève `TrelloInvalide` (avec le chemin) si le fichier n'est pas un
 * export de tableau Trello lisible. `avecArchivees` : garder les listes et cartes archivées (`closed`).
 */
export function lireExportTrello(brut, { avecArchivees = false } = {}) {
  if (!estObjet(brut)) throw new TrelloInvalide('(racine)', 'objet JSON attendu');
  const tableauId = id(brut.id, 'id');
  if (typeof brut.name !== 'string' || !brut.name.trim()) throw new TrelloInvalide('name', 'nom du tableau absent');
  if (brut.lists === undefined || brut.cards === undefined) throw new TrelloInvalide('lists', 'ce fichier n’est pas un export de tableau Trello (listes et cartes absentes)');
  const avertissements = [];

  const membres = tableau(brut.members, 'members', LIMITES_TRELLO.membres)
    .filter(estObjet)
    .map((m, i) => ({ id: id(m.id, `members[${i}].id`), nom: texteNettoye(m.fullName ?? m.username ?? '', 80), identifiant: texteNettoye(m.username ?? '', 60) }));
  const membresConnus = new Set(membres.map(m => m.id));

  const etiquettes = tableau(brut.labels, 'labels', LIMITES_TRELLO.etiquettes).map((e, i) => {
    if (!estObjet(e)) throw new TrelloInvalide(`labels[${i}]`, 'objet attendu');
    return { trelloId: id(e.id, `labels[${i}].id`), nom: texteNettoye(e.name ?? '', 40), couleur: couleur(e.color) ?? COULEUR_DEFAUT };
  });
  const etiquettesConnues = new Set(etiquettes.map(e => e.trelloId));

  const toutesListes = tableau(brut.lists, 'lists', LIMITES_TRELLO.listes).map((l, i) => {
    if (!estObjet(l)) throw new TrelloInvalide(`lists[${i}]`, 'objet attendu');
    return { trelloId: id(l.id, `lists[${i}].id`), nom: texteNettoye(l.name ?? '', 80) || '—', position: nombre(l.pos, i * 1024), archivee: booleen(l.closed) };
  });
  const listes = toutesListes.filter(l => avecArchivees || !l.archivee);
  const listesGardees = new Set(listes.map(l => l.trelloId));
  const listesConnues = new Set(toutesListes.map(l => l.trelloId));
  const nbListesArchivees = toutesListes.filter(l => l.archivee).length;

  let nbPieces = 0;
  let piecesIgnorees = 0;
  let cartesArchivees = 0;
  const cartes = [];
  for (const [i, c] of tableau(brut.cards, 'cards', LIMITES_TRELLO.cartes).entries()) {
    if (!estObjet(c)) throw new TrelloInvalide(`cards[${i}]`, 'objet attendu');
    const trelloId = id(c.id, `cards[${i}].id`);
    const listeId = id(c.idList, `cards[${i}].idList`);
    if (!listesConnues.has(listeId)) throw new TrelloInvalide(`cards[${i}].idList`, 'liste inconnue');
    if (booleen(c.closed)) cartesArchivees++;
    if (!listesGardees.has(listeId) || (booleen(c.closed) && !avecArchivees)) continue;
    const pieces = [];
    for (const [j, p] of tableau(c.attachments, `cards[${i}].attachments`, 200).entries()) {
      if (!estObjet(p)) throw new TrelloInvalide(`cards[${i}].attachments[${j}]`, 'objet attendu');
      const url = urlSure(p.url);
      if (!url) {
        piecesIgnorees++;
        continue;
      }
      nbPieces++;
      pieces.push({ trelloId: id(p.id, `cards[${i}].attachments[${j}].id`), nom: texteNettoye(p.name ?? '', 140) || url.slice(0, 140), url, depose: booleen(p.isUpload) });
    }
    const couv = estObjet(c.cover) ? c.cover : null;
    const couverture = couv && couleur(couv.color) ? { couleur: couleur(couv.color) } : couv?.idAttachment && pieces.some(p => p.trelloId === couv.idAttachment) ? { pieceTrelloId: couv.idAttachment } : null;
    cartes.push({
      trelloId,
      listeTrelloId: listeId,
      titre: texteNettoye(c.name ?? '', 200) || '—',
      description: nettoyerNote(typeof c.desc === 'string' ? c.desc : '', NOTE_MAX),
      position: nombre(c.pos, i * 1024),
      echeance: date(c.due),
      echeanceFaite: booleen(c.dueComplete),
      archivee: booleen(c.closed),
      etiquettes: tableau(c.idLabels, `cards[${i}].idLabels`, 100).map((e, j) => id(e, `cards[${i}].idLabels[${j}]`)).filter(e => etiquettesConnues.has(e)),
      membres: tableau(c.idMembers, `cards[${i}].idMembers`, 100).map((m, j) => id(m, `cards[${i}].idMembers[${j}]`)).filter(m => membresConnus.has(m)),
      pieces,
      couverture,
    });
  }
  if (nbPieces > LIMITES_TRELLO.pieces) throw new TrelloInvalide('cards[].attachments', `trop de pièces jointes (${LIMITES_TRELLO.pieces} au plus)`);
  const cartesGardees = new Set(cartes.map(c => c.trelloId));

  const checklists = [];
  let nbElements = 0;
  for (const [i, k] of tableau(brut.checklists, 'checklists', LIMITES_TRELLO.checklists).entries()) {
    if (!estObjet(k)) throw new TrelloInvalide(`checklists[${i}]`, 'objet attendu');
    const carte = id(k.idCard, `checklists[${i}].idCard`);
    const elements = tableau(k.checkItems, `checklists[${i}].checkItems`, 500).map((e, j) => {
      if (!estObjet(e)) throw new TrelloInvalide(`checklists[${i}].checkItems[${j}]`, 'objet attendu');
      return { trelloId: id(e.id, `checklists[${i}].checkItems[${j}].id`), texte: texteNettoye(e.name ?? '', 300) || '—', fait: e.state === 'complete', position: nombre(e.pos, j * 1024) };
    });
    nbElements += elements.length;
    if (!cartesGardees.has(carte)) continue;
    checklists.push({ trelloId: id(k.id, `checklists[${i}].id`), carteTrelloId: carte, nom: texteNettoye(k.name ?? '', 80) || 'Checklist', position: nombre(k.pos, i * 1024), elements });
  }
  if (nbElements > LIMITES_TRELLO.elements) throw new TrelloInvalide('checklists[].checkItems', `trop d’éléments de checklist (${LIMITES_TRELLO.elements} au plus)`);

  const commentaires = [];
  for (const [i, a] of tableau(brut.actions, 'actions', LIMITES_TRELLO.actions).entries()) {
    if (!estObjet(a) || a.type !== 'commentCard') continue;
    const carte = estObjet(a.data) && estObjet(a.data.card) ? a.data.card.id : undefined;
    const cid = idFacultatif(carte, `actions[${i}].data.card.id`);
    if (!cid || !cartesGardees.has(cid)) continue;
    const texte = nettoyerNote(typeof a.data.text === 'string' ? a.data.text : '', 4000);
    if (!texte.trim()) continue;
    const auteur = idFacultatif(a.idMemberCreator, `actions[${i}].idMemberCreator`);
    const nomAuteur = estObjet(a.memberCreator) ? texteNettoye(a.memberCreator.fullName ?? a.memberCreator.username ?? '', 80) : '';
    commentaires.push({ trelloId: id(a.id, `actions[${i}].id`), carteTrelloId: cid, auteurTrelloId: auteur, auteurNom: nomAuteur || membres.find(m => m.id === auteur)?.nom || null, texte, date: date(a.date) });
    if (commentaires.length > LIMITES_TRELLO.commentaires) throw new TrelloInvalide('actions', `trop de commentaires (${LIMITES_TRELLO.commentaires} au plus)`);
  }
  if (Array.isArray(brut.actions) && brut.actions.length >= 1000 && commentaires.length === 0) avertissements.push('actions-limitees');
  if (piecesIgnorees) avertissements.push('pieces-ignorees');

  return {
    tableau: { trelloId: tableauId, nom: texteNettoye(brut.name, 80), description: nettoyerNote(typeof brut.desc === 'string' ? brut.desc : '', 1000) },
    listes,
    etiquettes,
    cartes,
    checklists,
    commentaires,
    membres,
    archivees: { listes: nbListesArchivees, cartes: cartesArchivees },
    piecesIgnorees,
    avertissements,
  };
}

/** Résumé chiffré d'un modèle (écran d'aperçu). */
export function bilanTrello(m) {
  return {
    listes: m.listes.length,
    cartes: m.cartes.length,
    etiquettes: m.etiquettes.length,
    checklists: m.checklists.length,
    elements: m.checklists.reduce((n, k) => n + k.elements.length, 0),
    commentaires: m.commentaires.length,
    pieces: m.cartes.reduce((n, c) => n + c.pieces.length, 0),
    piecesDeposees: m.cartes.reduce((n, c) => n + c.pieces.filter(p => p.depose).length, 0),
    echeances: m.cartes.filter(c => c.echeance).length,
    couvertures: m.cartes.filter(c => c.couverture).length,
  };
}

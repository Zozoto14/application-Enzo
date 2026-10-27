/**
 * Visuels CM : modèle de données d'un visuel (document par format), de la charte graphique, et leur
 * validation. Fonctions PURES (aucune base, aucun réseau), testées sous Node. Le miroir côté app est
 * src/esport/cm/visuels/document.ts (lecture tolérante d'un document reçu, rendu Konva).
 *
 * Un document = un format (carré 1080×1080, portrait 4:5 1080×1350, story 9:16 1080×1920, paysage 16:9
 * 1920×1080), un fond, des effets (null : ceux de la charte) et des CALQUES (dessinés dans l'ordre) :
 *
 *   commun   { id, type, nom, x, y, l, h, rotation, opacite, verrouille, masque, si, ombre, contour, lueur }
 *   texte    { texte: { fr, en }, police, taille, graisse, italique, couleur, align, valign, interligne,
 *              espacement, majuscules, ajuster, glitch }       champs dynamiques « {adversaire} », « {score} »…
 *   image    { source: { fichier: uuid } | { champ: 'logo_team'… } | { asset: 'map:ascent' }, ajustement, rayon, filtre }
 *   forme    { forme: rect|ellipse|ligne|losange|hexagone|chanfrein, remplissage, rayon, coupe }
 *   logo     { cible: club|team|adversaire }                    logo de la charte, sinon monogramme
 *   liste    { source: manches|classement|roster|programme|parcours, ligne: { fr, en }, police, taille,
 *              couleur, align, pas, max, surligne }              une ligne par élément (« {carte} {score} »)
 *
 * Couleurs : « #rrggbb », « #rrggbbaa » ou un jeton de la charte (« charte:primaire ») ; polices : celles
 * embarquées dans l'app ou un jeton (« charte:titre ») : changer la charte change tous les modèles qui
 * l'utilisent. Sécurité : AUCUNE adresse d'image (ni http, ni data:) : une image est un fichier CM déposé,
 * un asset du jeu (cartes et agents, résolus par l'app) ou un champ de données (logo de la team…).
 * Rien n'est interprété comme du HTML : le texte est dessiné tel quel dans un canevas.
 */

import { echec, texteLong, texteNettoye } from '../../outils.mjs';
import { MOTIF_UUID } from '../commun.mjs';

export const FORMATS = Object.freeze({
  carre: { largeur: 1080, hauteur: 1080, ratio: '1:1' },
  portrait: { largeur: 1080, hauteur: 1350, ratio: '4:5' },
  story: { largeur: 1080, hauteur: 1920, ratio: '9:16' },
  paysage: { largeur: 1920, hauteur: 1080, ratio: '16:9' },
});
export const CLES_FORMATS = Object.freeze(Object.keys(FORMATS));
export const LANGUES_VISUEL = Object.freeze(['fr', 'en']);

/** Genres de visuels (un modèle par défaut chacun, dans l'app). */
export const TYPES_VISUEL = Object.freeze(['annonce', 'jour_match', 'lineup', 'resultat', 'classement', 'mvp', 'recrue', 'depart', 'programme', 'banniere', 'libre']);

export const TYPES_CALQUES = Object.freeze(['texte', 'image', 'forme', 'logo', 'liste']);
export const FORMES = Object.freeze(['rect', 'ellipse', 'ligne', 'losange', 'hexagone', 'chanfrein']);
export const SOURCES_LISTE = Object.freeze(['manches', 'classement', 'roster', 'programme', 'parcours']);
export const CHAMPS_IMAGE = Object.freeze(['logo_club', 'logo_team', 'logo_adversaire', 'map_1', 'map_2', 'map_3', 'map_4', 'map_5', 'agent_mvp']);
export const CIBLES_LOGO = Object.freeze(['club', 'team', 'adversaire']);

/** Polices embarquées (licence SIL OFL, servies par l'app, jamais par un service externe). */
export const POLICES = Object.freeze(['Orbitron', 'Chakra Petch', 'Share Tech Mono', 'Manrope']);
export const ROLES_POLICES = Object.freeze(['titre', 'sousTitre', 'texte', 'chiffres']);
export const CLES_COULEURS = Object.freeze(['fond', 'fond2', 'primaire', 'secondaire', 'accent', 'texte', 'attenue', 'victoire', 'defaite']);

export const MAX_CALQUES = 120;
export const TAILLE_MAX_DOCUMENT = 256 * 1024;
export const TEXTE_MAX = 600;

/** Charte par défaut : thème cyberpunk (néon cyan et magenta sur nuit violette, scanlines, grain). */
export const CHARTE_DEFAUT = Object.freeze({
  nom: 'Cyberpunk',
  club: '',
  couleurs: { fond: '#07060f', fond2: '#1b0b33', primaire: '#00f0ff', secondaire: '#ff2bd6', accent: '#f5ff3b', texte: '#f2f4ff', attenue: '#9a9cc4', victoire: '#3dff8b', defaite: '#ff3b5c' },
  polices: { titre: 'Orbitron', sousTitre: 'Chakra Petch', texte: 'Manrope', chiffres: 'Orbitron' },
  effets: { neon: 0.8, glitch: true, scanlines: 0.35, grain: 0.25 },
  logos: { club: null, teams: {} },
});

export class DocumentInvalide extends Error {
  constructor(chemin, raison) {
    super(`${chemin} : ${raison}`);
    this.chemin = chemin;
    this.raison = raison;
  }
}

/** Erreur HTTP 400 `document-invalide` (détails : chemin, raison). */
export function erreurDocument(e, code = 'document-invalide') {
  if (!(e instanceof DocumentInvalide)) return e;
  const err = echec(400, code, `Visuel invalide (${e.chemin} : ${e.raison}).`);
  err.details = { chemin: e.chemin, raison: e.raison };
  return err;
}

const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const MOTIF_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MOTIF_COULEUR_HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const MOTIF_SI = /^!?(serie|classement|champ:[a-z0-9_]{1,30})$/;
const MOTIF_ASSET = /^(map|agent):[a-z0-9][a-z0-9-]{0,39}$/;

function nombre(v, chemin, min, max, defaut) {
  if (v === undefined || v === null) {
    if (defaut === undefined) throw new DocumentInvalide(chemin, 'nombre');
    return defaut;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new DocumentInvalide(chemin, 'nombre');
  return Math.round(v * 100) / 100;
}

function booleen(v, chemin) {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') throw new DocumentInvalide(chemin, 'booleen');
  return v;
}

function parmi(v, liste, chemin, defaut) {
  if ((v === undefined || v === null) && defaut !== undefined) return defaut;
  if (!liste.includes(v)) throw new DocumentInvalide(chemin, 'valeur');
  return v;
}

export function couleur(v, chemin) {
  if (typeof v === 'string' && MOTIF_COULEUR_HEX.test(v)) return v.toLowerCase();
  if (typeof v === 'string' && v.startsWith('charte:') && CLES_COULEURS.includes(v.slice(7))) return v;
  throw new DocumentInvalide(chemin, 'couleur');
}

function police(v, chemin) {
  if (v === undefined || v === null) return 'charte:texte';
  if (typeof v === 'string' && v.startsWith('charte:') && ROLES_POLICES.includes(v.slice(7))) return v;
  if (POLICES.includes(v)) return v;
  throw new DocumentInvalide(chemin, 'police');
}

export function remplissage(v, chemin, { facultatif = false } = {}) {
  if (v === undefined || v === null) {
    if (facultatif) return null;
    throw new DocumentInvalide(chemin, 'remplissage');
  }
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'remplissage');
  if (v.type === 'uni') return { type: 'uni', couleur: couleur(v.couleur, `${chemin}.couleur`) };
  if (v.type === 'degrade') {
    if (!Array.isArray(v.couleurs) || v.couleurs.length < 2 || v.couleurs.length > 4) throw new DocumentInvalide(`${chemin}.couleurs`, 'degrade');
    return { type: 'degrade', couleurs: v.couleurs.map((c, i) => couleur(c, `${chemin}.couleurs.${i}`)), angle: nombre(v.angle, `${chemin}.angle`, -360, 360, 90), radial: booleen(v.radial, `${chemin}.radial`) };
  }
  throw new DocumentInvalide(`${chemin}.type`, 'remplissage');
}

/** Texte bilingue d'un calque : { fr, en } (multiligne, contrôles retirés, borné). */
function bilingue(v, chemin) {
  if (typeof v === 'string') {
    const t = texteLong(v, TEXTE_MAX);
    return { fr: t, en: t };
  }
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'texte');
  const lire = (x, c) => {
    if (x === undefined || x === null) return '';
    if (typeof x !== 'string' || x.length > TEXTE_MAX * 2) throw new DocumentInvalide(c, 'texte');
    return texteLong(x, TEXTE_MAX);
  };
  return { fr: lire(v.fr, `${chemin}.fr`), en: lire(v.en, `${chemin}.en`) };
}

function ombre(v, chemin) {
  if (v === undefined || v === null) return null;
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'ombre');
  return { couleur: couleur(v.couleur ?? '#000000', `${chemin}.couleur`), flou: nombre(v.flou, `${chemin}.flou`, 0, 200, 20), dx: nombre(v.dx, `${chemin}.dx`, -500, 500, 0), dy: nombre(v.dy, `${chemin}.dy`, -500, 500, 8), opacite: nombre(v.opacite, `${chemin}.opacite`, 0, 1, 0.6) };
}

function contour(v, chemin) {
  if (v === undefined || v === null) return null;
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'contour');
  return { couleur: couleur(v.couleur ?? 'charte:primaire', `${chemin}.couleur`), epaisseur: nombre(v.epaisseur, `${chemin}.epaisseur`, 0, 50, 2) };
}

function lueur(v, chemin) {
  if (v === undefined || v === null) return null;
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'lueur');
  return { couleur: couleur(v.couleur ?? 'charte:primaire', `${chemin}.couleur`), force: nombre(v.force, `${chemin}.force`, 0, 100, 30) };
}

function sourceImage(v, chemin) {
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'source');
  const cles = Object.keys(v);
  if (cles.length !== 1) throw new DocumentInvalide(chemin, 'source');
  if (typeof v.fichier === 'string') {
    if (!MOTIF_UUID.test(v.fichier)) throw new DocumentInvalide(`${chemin}.fichier`, 'source');
    return { fichier: v.fichier };
  }
  if (typeof v.champ === 'string') return { champ: parmi(v.champ, CHAMPS_IMAGE, `${chemin}.champ`) };
  if (typeof v.asset === 'string') {
    if (!MOTIF_ASSET.test(v.asset)) throw new DocumentInvalide(`${chemin}.asset`, 'source');
    return { asset: v.asset };
  }
  // Toute autre forme (url, src, data:…) est refusée : jamais d'image externe dans le canevas.
  throw new DocumentInvalide(chemin, 'source');
}

function calque(v, chemin, ids) {
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'calque');
  const type = parmi(v.type, TYPES_CALQUES, `${chemin}.type`);
  if (typeof v.id !== 'string' || !MOTIF_ID.test(v.id)) throw new DocumentInvalide(`${chemin}.id`, 'id');
  if (ids.has(v.id)) throw new DocumentInvalide(`${chemin}.id`, 'id-en-double');
  ids.add(v.id);
  if (v.si !== undefined && v.si !== null && (typeof v.si !== 'string' || !MOTIF_SI.test(v.si))) throw new DocumentInvalide(`${chemin}.si`, 'condition');
  const commun = {
    id: v.id,
    type,
    nom: texteNettoye(v.nom, 60),
    x: nombre(v.x, `${chemin}.x`, -10000, 10000, 0),
    y: nombre(v.y, `${chemin}.y`, -10000, 10000, 0),
    l: nombre(v.l, `${chemin}.l`, 1, 10000, 100),
    h: nombre(v.h, `${chemin}.h`, 1, 10000, 100),
    rotation: nombre(v.rotation, `${chemin}.rotation`, -360, 360, 0),
    opacite: nombre(v.opacite, `${chemin}.opacite`, 0, 1, 1),
    verrouille: booleen(v.verrouille, `${chemin}.verrouille`),
    masque: booleen(v.masque, `${chemin}.masque`),
    si: v.si || null,
    ombre: ombre(v.ombre, `${chemin}.ombre`),
    contour: contour(v.contour, `${chemin}.contour`),
    lueur: lueur(v.lueur, `${chemin}.lueur`),
  };
  switch (type) {
    case 'texte':
      return {
        ...commun,
        texte: bilingue(v.texte, `${chemin}.texte`),
        police: police(v.police, `${chemin}.police`),
        taille: nombre(v.taille, `${chemin}.taille`, 4, 800, 48),
        graisse: parmi(v.graisse ?? 400, [300, 400, 500, 600, 700, 800, 900], `${chemin}.graisse`),
        italique: booleen(v.italique, `${chemin}.italique`),
        couleur: remplissage(v.couleur ?? { type: 'uni', couleur: 'charte:texte' }, `${chemin}.couleur`),
        align: parmi(v.align, ['gauche', 'centre', 'droite'], `${chemin}.align`, 'gauche'),
        valign: parmi(v.valign, ['haut', 'milieu', 'bas'], `${chemin}.valign`, 'haut'),
        interligne: nombre(v.interligne, `${chemin}.interligne`, 0.5, 3, 1.1),
        espacement: nombre(v.espacement, `${chemin}.espacement`, -20, 100, 0),
        majuscules: booleen(v.majuscules, `${chemin}.majuscules`),
        ajuster: booleen(v.ajuster, `${chemin}.ajuster`),
        glitch: booleen(v.glitch, `${chemin}.glitch`),
      };
    case 'image':
      return { ...commun, source: sourceImage(v.source, `${chemin}.source`), ajustement: parmi(v.ajustement, ['couvrir', 'contenir'], `${chemin}.ajustement`, 'couvrir'), rayon: nombre(v.rayon, `${chemin}.rayon`, 0, 5000, 0), filtre: parmi(v.filtre, ['normal', 'gris', 'duotone'], `${chemin}.filtre`, 'normal') };
    case 'forme':
      return { ...commun, forme: parmi(v.forme, FORMES, `${chemin}.forme`, 'rect'), remplissage: remplissage(v.remplissage, `${chemin}.remplissage`, { facultatif: true }), rayon: nombre(v.rayon, `${chemin}.rayon`, 0, 5000, 0), coupe: nombre(v.coupe, `${chemin}.coupe`, 0, 2000, 0) };
    case 'logo':
      return { ...commun, cible: parmi(v.cible, CIBLES_LOGO, `${chemin}.cible`, 'team') };
    case 'liste':
      return {
        ...commun,
        source: parmi(v.source, SOURCES_LISTE, `${chemin}.source`),
        ligne: bilingue(v.ligne, `${chemin}.ligne`),
        police: police(v.police, `${chemin}.police`),
        taille: nombre(v.taille, `${chemin}.taille`, 4, 400, 36),
        graisse: parmi(v.graisse ?? 600, [300, 400, 500, 600, 700, 800, 900], `${chemin}.graisse`),
        couleur: remplissage(v.couleur ?? { type: 'uni', couleur: 'charte:texte' }, `${chemin}.couleur`),
        align: parmi(v.align, ['gauche', 'centre', 'droite'], `${chemin}.align`, 'gauche'),
        pas: nombre(v.pas, `${chemin}.pas`, 4, 1000, 60),
        max: nombre(v.max, `${chemin}.max`, 1, 30, 8),
        majuscules: booleen(v.majuscules, `${chemin}.majuscules`),
        surligne: v.surligne === undefined || v.surligne === null ? null : couleur(v.surligne, `${chemin}.surligne`),
      };
    default:
      throw new DocumentInvalide(`${chemin}.type`, 'valeur');
  }
}

function effets(v, chemin) {
  if (v === undefined || v === null) return null;
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'effets');
  return { scanlines: nombre(v.scanlines, `${chemin}.scanlines`, 0, 1, 0), grain: nombre(v.grain, `${chemin}.grain`, 0, 1, 0), vignette: nombre(v.vignette, `${chemin}.vignette`, 0, 1, 0) };
}

/** Valide un document (un format). Lève DocumentInvalide (chemin, raison). */
export function lireDocument(v, chemin = 'document') {
  if (!estObjet(v)) throw new DocumentInvalide(chemin, 'objet');
  if (Buffer.byteLength(JSON.stringify(v), 'utf8') > TAILLE_MAX_DOCUMENT) throw new DocumentInvalide(chemin, 'trop-gros');
  const format = parmi(v.format, CLES_FORMATS, `${chemin}.format`);
  if (!Array.isArray(v.calques)) throw new DocumentInvalide(`${chemin}.calques`, 'liste');
  if (v.calques.length > MAX_CALQUES) throw new DocumentInvalide(`${chemin}.calques`, 'trop-de-calques');
  const ids = new Set();
  return {
    v: 1,
    format,
    fond: remplissage(v.fond, `${chemin}.fond`, { facultatif: true }),
    effets: effets(v.effets, `${chemin}.effets`),
    calques: v.calques.map((c, i) => calque(c, `${chemin}.calques.${i}`, ids)),
  };
}

/** Documents d'un modèle : { carre?, portrait?, story?, paysage? } (un au moins ; le format de chacun est sa clé). */
export function lireDocuments(v) {
  if (!estObjet(v)) throw new DocumentInvalide('documents', 'objet');
  const sortie = {};
  for (const [cle, doc] of Object.entries(v)) {
    if (!CLES_FORMATS.includes(cle)) throw new DocumentInvalide(`documents.${String(cle).slice(0, 20)}`, 'format');
    const d = lireDocument(doc, `documents.${cle}`);
    if (d.format !== cle) throw new DocumentInvalide(`documents.${cle}.format`, 'format');
    sortie[cle] = d;
  }
  if (!Object.keys(sortie).length) throw new DocumentInvalide('documents', 'vide');
  if (Buffer.byteLength(JSON.stringify(sortie), 'utf8') > TAILLE_MAX_DOCUMENT * 2) throw new DocumentInvalide('documents', 'trop-gros');
  return sortie;
}

/**
 * Charte saisie : palette (9 couleurs « #rrggbb »), polices (rôle → police embarquée), effets (0 à 1, glitch
 * oui / non), logos (fichiers CM : vérifiés par le service). Valeurs absentes : celles de la charte par défaut.
 */
export function lireCharte(v, actuelle = CHARTE_DEFAUT) {
  if (!estObjet(v)) throw new DocumentInvalide('charte', 'objet');
  const base = { ...CHARTE_DEFAUT, ...actuelle };
  const couleurs = { ...CHARTE_DEFAUT.couleurs, ...(base.couleurs ?? {}) };
  if (v.couleurs !== undefined) {
    if (!estObjet(v.couleurs)) throw new DocumentInvalide('charte.couleurs', 'objet');
    for (const [k, c] of Object.entries(v.couleurs)) {
      if (!CLES_COULEURS.includes(k)) throw new DocumentInvalide(`charte.couleurs.${String(k).slice(0, 20)}`, 'cle');
      if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) throw new DocumentInvalide(`charte.couleurs.${k}`, 'couleur');
      couleurs[k] = c.toLowerCase();
    }
  }
  const polices = { ...CHARTE_DEFAUT.polices, ...(base.polices ?? {}) };
  if (v.polices !== undefined) {
    if (!estObjet(v.polices)) throw new DocumentInvalide('charte.polices', 'objet');
    for (const [k, p] of Object.entries(v.polices)) {
      if (!ROLES_POLICES.includes(k)) throw new DocumentInvalide(`charte.polices.${String(k).slice(0, 20)}`, 'cle');
      if (!POLICES.includes(p)) throw new DocumentInvalide(`charte.polices.${k}`, 'police');
      polices[k] = p;
    }
  }
  const eff = { ...CHARTE_DEFAUT.effets, ...(base.effets ?? {}) };
  if (v.effets !== undefined) {
    if (!estObjet(v.effets)) throw new DocumentInvalide('charte.effets', 'objet');
    for (const k of ['neon', 'scanlines', 'grain']) if (v.effets[k] !== undefined) eff[k] = nombre(v.effets[k], `charte.effets.${k}`, 0, 1);
    if (v.effets.glitch !== undefined) eff.glitch = booleen(v.effets.glitch, 'charte.effets.glitch');
  }
  const logos = { club: base.logos?.club ?? null, teams: { ...(base.logos?.teams ?? {}) } };
  if (v.logos !== undefined) {
    if (!estObjet(v.logos)) throw new DocumentInvalide('charte.logos', 'objet');
    if (v.logos.club !== undefined) {
      if (v.logos.club !== null && (typeof v.logos.club !== 'string' || !MOTIF_UUID.test(v.logos.club))) throw new DocumentInvalide('charte.logos.club', 'fichier');
      logos.club = v.logos.club;
    }
    if (v.logos.teams !== undefined) {
      if (!estObjet(v.logos.teams) || Object.keys(v.logos.teams).length > 200) throw new DocumentInvalide('charte.logos.teams', 'objet');
      for (const [team, f] of Object.entries(v.logos.teams)) {
        if (!MOTIF_UUID.test(team)) throw new DocumentInvalide('charte.logos.teams', 'team');
        if (f === null) delete logos.teams[team];
        else if (typeof f !== 'string' || !MOTIF_UUID.test(f)) throw new DocumentInvalide(`charte.logos.teams.${team}`, 'fichier');
        else logos.teams[team] = f;
      }
    }
  }
  const nom = v.nom === undefined ? (base.nom ?? CHARTE_DEFAUT.nom) : texteNettoye(v.nom, 60) || CHARTE_DEFAUT.nom;
  if (v.club !== undefined && typeof v.club !== 'string') throw new DocumentInvalide('charte.club', 'texte');
  const club = v.club === undefined ? (base.club ?? '') : texteNettoye(v.club, 60);
  return { nom, club, couleurs, polices, effets: eff, logos };
}

/** Fichiers CM référencés par un document (images importées). */
export function fichiersDuDocument(doc) {
  return [...new Set((doc?.calques ?? []).filter(c => c.type === 'image' && c.source?.fichier).map(c => c.source.fichier))];
}

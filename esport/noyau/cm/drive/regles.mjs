/**
 * Drive de la section CM : règles PURES (testées sans base) — réglages lus dans l'environnement, noms de
 * fichiers et de dossiers assainis, extension cohérente avec le type reconnu par les octets, genres,
 * étiquettes, clé de recherche, dossiers par défaut.
 */

import { lireTaille } from '../../medias/tailles.mjs';
import { FORMATS } from '../../medias/formats.mjs';

const Gio = 1024 * 1024 * 1024;
const Mio = 1024 * 1024;

export const QUOTA_DEFAUT = 20 * Gio;
export const FICHIER_MAX_DEFAUT = 2 * Gio;
export const ZIP_MAX_DEFAUT = 2 * Gio;
/** Un ZIP sans ZIP64 : moins de 4 Gio en tout et moins de 65 535 entrées. */
export const ZIP_MAX_ABSOLU = 4 * Gio - 64 * Mio;
export const ZIP_ENTREES_MAX = 2000;
/** Seuil de l'alerte d'espace (part du quota). */
export const SEUIL_ALERTE = 0.8;
/** Une alerte d'espace au plus par semaine. */
export const DELAI_ALERTE_MS = 7 * 86_400_000;
/** Durée de la corbeille : le cron efface définitivement au-delà. */
export const DUREE_CORBEILLE_MS = 30 * 86_400_000;
export const VERSIONS_MAX = 30;
export const PROFONDEUR_MAX = 12;
export const DOSSIERS_MAX = 5000;
export const FICHIERS_LISTE_MAX = 3000;
export const TAGS_MAX = 12;
/** Vignette d'une image dans la grille : lien vers l'image elle-même, si elle n'est pas trop lourde. */
export const VIGNETTE_TAILLE_MAX = 8 * Mio;
export const DUREE_LIEN_DRIVE_MS = 2 * 3600 * 1000;
export const NOM_MAX = 140;

/**
 * Réglages du Drive : ESPORT_DRIVE_QUOTA (espace total, « 20G » par défaut), ESPORT_DRIVE_FICHIER_MAX (un
 * fichier, « 2G »), ESPORT_DRIVE_ZIP_MAX (téléchargement d'un dossier en ZIP, « 2G », moins de 4 Gio).
 */
export function configDrive(env = {}) {
  return {
    quota: lireTaille(env.ESPORT_DRIVE_QUOTA, QUOTA_DEFAUT),
    fichierMax: lireTaille(env.ESPORT_DRIVE_FICHIER_MAX, FICHIER_MAX_DEFAUT),
    zipMax: Math.min(ZIP_MAX_ABSOLU, lireTaille(env.ESPORT_DRIVE_ZIP_MAX, ZIP_MAX_DEFAUT)),
  };
}

/** Dossiers créés d'office (nom traduit par l'app tant qu'il n'est pas renommé). « depot » : dépôt des joueurs. */
export const DOSSIERS_DEFAUT = Object.freeze({
  club: ['logos', 'photos', 'clips', 'visuels', 'sponsors', 'bruts'],
  team: ['logos', 'photos', 'clips', 'visuels', 'bruts', 'depot'],
});
export const CLES_DOSSIERS = Object.freeze(['logos', 'photos', 'clips', 'visuels', 'sponsors', 'bruts', 'depot', 'ressources']);
/**
 * Dossier système « Ressources » du Drive du club (migration 0051) : les fichiers envoyés depuis DATA › Ressources. Créé
 * au premier envoi, RESTREINT (gestionnaires du Drive seulement) et chaque fichier n'y est visible que de ceux qui voient
 * sa ressource (`cm_drive_fichiers.ressource_id`). Il ne se rouvre pas à tous, ne se déplace pas et ne se supprime pas.
 */
export const CLE_DOSSIER_RESSOURCES = 'ressources';
/** Nom d'un dossier par défaut dans les fichiers ZIP et les journaux (l'app, elle, traduit). */
export const NOMS_DOSSIERS_DEFAUT = Object.freeze({ logos: 'Logos', photos: 'Photos joueurs', clips: 'Clips', visuels: 'Visuels', sponsors: 'Sponsors', bruts: 'Bruts', depot: 'Dépôt joueurs', ressources: 'Ressources' });

export const GENRES = Object.freeze(['image', 'video', 'audio', 'document', 'archive', 'police', 'creation', 'texte']);

/** Genre d'un fichier d'après le format reconnu (formats.mjs). */
export const genreDe = format => FORMATS[format]?.genre ?? 'document';

/**
 * Extensions acceptées pour chaque format : un nom dont l'extension ne correspond pas reçoit l'extension du
 * format (« script.bat » reconnu comme texte devient « script.bat.txt ») — un fichier téléchargé n'est jamais
 * lancé comme un programme par le système de celui qui l'ouvre.
 */
export const EXTENSIONS = Object.freeze({
  pdf: ['pdf', 'ai'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg', 'jfif', 'jpe'],
  gif: ['gif'],
  webp: ['webp'],
  svg: ['svg'],
  tiff: ['tif', 'tiff'],
  heic: ['heic', 'heif'],
  avif: ['avif'],
  psd: ['psd', 'psb'],
  zip: ['zip', 'xd', 'sketch', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'procreate', 'cbz', 'aep'],
  '7z': ['7z'],
  rar: ['rar'],
  gzip: ['gz', 'tgz'],
  mp4: ['mp4', 'm4v'],
  mov: ['mov', 'qt'],
  webm: ['webm'],
  mkv: ['mkv'],
  m4a: ['m4a', 'm4b'],
  mp3: ['mp3'],
  aac: ['aac'],
  wav: ['wav'],
  ogg: ['ogg', 'oga', 'opus'],
  flac: ['flac'],
  ttf: ['ttf', 'ttc'],
  otf: ['otf'],
  woff: ['woff'],
  woff2: ['woff2'],
  texte: ['txt', 'csv', 'tsv', 'md', 'json', 'srt', 'vtt', 'log', 'xml', 'yml', 'yaml', 'css'],
});

const NOMS_RESERVES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// Contrôles, retours à la ligne, marques bidirectionnelles (« gpj.exe » affiché « exe.jpg »), largeurs nulles.
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/**
 * Nom de fichier ou de dossier sûr et lisible : NFC, sans caractère de contrôle ni marque bidirectionnelle,
 * sans séparateur de chemin ni caractère interdit sous Windows, sans point ni espace aux extrémités, jamais
 * « . », « .. » ni un nom réservé de Windows, 140 caractères au plus (extension gardée). `repli` si vide.
 */
export function assainirNom(brut, repli = 'fichier') {
  let nom = String(brut ?? '').normalize('NFC').replace(INVISIBLES, '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  nom = nom.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!nom) nom = repli;
  if (NOMS_RESERVES.test(nom)) nom = `_${nom}`;
  if ([...nom].length > NOM_MAX) {
    const point = nom.lastIndexOf('.');
    const ext = point > 0 && nom.length - point <= 12 ? nom.slice(point) : '';
    nom = [...nom.slice(0, ext ? point : nom.length)].slice(0, NOM_MAX - ext.length).join('').trimEnd() + ext;
  }
  return nom;
}

/** Extension (minuscules, sans le point) d'un nom, ou ''. */
export const extensionDe = nom => {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(nom ?? ''));
  return m ? m[1].toLowerCase() : '';
};

/** Nom assaini dont l'extension correspond au format reconnu (ajoutée sinon). */
export function nomPourFormat(brut, format) {
  const nom = assainirNom(brut);
  const permises = EXTENSIONS[format];
  if (!permises) return nom;
  if (permises.includes(extensionDe(nom))) return nom;
  return assainirNom(`${nom}.${FORMATS[format]?.extension ?? permises[0]}`);
}

/** Clé de recherche : minuscules, sans accents ni ponctuation superflue. */
export function cleRecherche(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Étiquettes saisies : texte court (minuscules, lettres, chiffres, tirets), 12 au plus, sans doublon. */
export function lireTags(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const sortie = [];
  for (const brut of v) {
    if (typeof brut !== 'string') return null;
    const t = brut.normalize('NFC').toLocaleLowerCase('fr').replace(INVISIBLES, '').replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    if (t && !sortie.includes(t)) sortie.push(t);
  }
  return sortie.length > TAGS_MAX ? null : sortie;
}

/** Nom unique dans un ensemble (ZIP, copie) : « logo.png », « logo (2).png »… */
export function nomUnique(nom, pris) {
  if (!pris.has(nom.toLowerCase())) {
    pris.add(nom.toLowerCase());
    return nom;
  }
  const point = nom.lastIndexOf('.');
  const [radical, ext] = point > 0 ? [nom.slice(0, point), nom.slice(point)] : [nom, ''];
  for (let i = 2; ; i++) {
    const essai = `${radical} (${i})${ext}`;
    if (!pris.has(essai.toLowerCase())) {
      pris.add(essai.toLowerCase());
      return essai;
    }
  }
}

/** Dimensions d'un PSD (en-tête : hauteur puis largeur, 32 bits gros-boutistes). */
export function dimensionsPsd(o) {
  if (!o || o.length < 26 || String.fromCharCode(o[0], o[1], o[2], o[3]) !== '8BPS') return null;
  const u32 = i => ((o[i] << 24) >>> 0) + ((o[i + 1] << 16) | (o[i + 2] << 8) | o[i + 3]);
  return { largeur: u32(18), hauteur: u32(14) };
}

/** Dimensions déclarées d'un SVG (attributs width / height, ou viewBox), sinon null. */
export function dimensionsSvg(texte) {
  const m = /<svg\b[^>]*>/i.exec(String(texte ?? '').slice(0, 64 * 1024));
  if (!m) return null;
  const attr = n => new RegExp(`\\s${n}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, 'i').exec(m[0])?.[1];
  const l = Number(attr('width'));
  const h = Number(attr('height'));
  if (l > 0 && h > 0) return { largeur: Math.round(l), hauteur: Math.round(h) };
  const vb = /\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(m[0]);
  if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return { largeur: Math.round(Number(vb[1])), hauteur: Math.round(Number(vb[2])) };
  return null;
}

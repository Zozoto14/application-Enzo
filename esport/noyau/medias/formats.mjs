/**
 * Reconnaissance des fichiers vidéo et audio par leurs OCTETS (jamais par le nom ni le type annoncé),
 * et lecture légère des métadonnées d'un MP4 / MOV (atomes `moov` : durée, codecs) ou d'un WebM / MKV
 * (identifiants de codec). Fonctions PURES, sans dépendance : aucune conversion sur le serveur.
 *
 *  - Vidéo (review et réunions) : MP4, MOV, WebM, MKV.
 *  - Audio (réunions seulement) : M4A, MP3, AAC (ADTS), WAV, OGG / Opus, FLAC.
 *  - Documents (module Ressources seulement) : PDF, images (PNG, JPEG, GIF, WebP), archives (ZIP, 7z,
 *    RAR). Jamais de SVG ni de HTML (ils pourraient porter du script).
 *
 * Avertissement « peu compatible avec iPhone » : conteneur MKV, ou codec vidéo connu autre que H.264.
 */

const ascii = (o, debut, n) => String.fromCharCode(...o.subarray(debut, debut + n));
const u32 = (o, i) => ((o[i] << 24) | (o[i + 1] << 16) | (o[i + 2] << 8) | o[i + 3]) >>> 0;
const u64 = (o, i) => u32(o, i) * 0x100000000 + u32(o, i + 4);

export const FORMATS = {
  mp4: { genre: 'video', mime: 'video/mp4', extension: 'mp4', nom: 'MP4' },
  mov: { genre: 'video', mime: 'video/quicktime', extension: 'mov', nom: 'MOV' },
  webm: { genre: 'video', mime: 'video/webm', extension: 'webm', nom: 'WebM' },
  mkv: { genre: 'video', mime: 'video/x-matroska', extension: 'mkv', nom: 'MKV' },
  m4a: { genre: 'audio', mime: 'audio/mp4', extension: 'm4a', nom: 'M4A' },
  mp3: { genre: 'audio', mime: 'audio/mpeg', extension: 'mp3', nom: 'MP3' },
  aac: { genre: 'audio', mime: 'audio/aac', extension: 'aac', nom: 'AAC' },
  wav: { genre: 'audio', mime: 'audio/wav', extension: 'wav', nom: 'WAV' },
  ogg: { genre: 'audio', mime: 'audio/ogg', extension: 'ogg', nom: 'OGG' },
  flac: { genre: 'audio', mime: 'audio/flac', extension: 'flac', nom: 'FLAC' },
  pdf: { genre: 'document', mime: 'application/pdf', extension: 'pdf', nom: 'PDF' },
  png: { genre: 'image', mime: 'image/png', extension: 'png', nom: 'PNG' },
  jpeg: { genre: 'image', mime: 'image/jpeg', extension: 'jpg', nom: 'JPEG' },
  gif: { genre: 'image', mime: 'image/gif', extension: 'gif', nom: 'GIF' },
  webp: { genre: 'image', mime: 'image/webp', extension: 'webp', nom: 'WebP' },
  zip: { genre: 'archive', mime: 'application/zip', extension: 'zip', nom: 'ZIP' },
  '7z': { genre: 'archive', mime: 'application/x-7z-compressed', extension: '7z', nom: '7z' },
  rar: { genre: 'archive', mime: 'application/vnd.rar', extension: 'rar', nom: 'RAR' },
  // Drive de la section CM (migration 0027) seulement : reconnus par `analyserDebut(…, { etendu: true })`.
  gzip: { genre: 'archive', mime: 'application/gzip', extension: 'gz', nom: 'GZIP' },
  svg: { genre: 'image', mime: 'image/svg+xml', extension: 'svg', nom: 'SVG' },
  tiff: { genre: 'image', mime: 'image/tiff', extension: 'tif', nom: 'TIFF' },
  heic: { genre: 'image', mime: 'image/heic', extension: 'heic', nom: 'HEIC' },
  avif: { genre: 'image', mime: 'image/avif', extension: 'avif', nom: 'AVIF' },
  psd: { genre: 'creation', mime: 'image/vnd.adobe.photoshop', extension: 'psd', nom: 'PSD' },
  ttf: { genre: 'police', mime: 'font/ttf', extension: 'ttf', nom: 'TTF' },
  otf: { genre: 'police', mime: 'font/otf', extension: 'otf', nom: 'OTF' },
  woff: { genre: 'police', mime: 'font/woff', extension: 'woff', nom: 'WOFF' },
  woff2: { genre: 'police', mime: 'font/woff2', extension: 'woff2', nom: 'WOFF2' },
  texte: { genre: 'texte', mime: 'text/plain; charset=utf-8', extension: 'txt', nom: 'Texte' },
};

/** Formats acceptés selon l'usage. */
export const FORMATS_PERMIS = {
  review: ['mp4', 'mov', 'webm', 'mkv'],
  reunion: ['mp4', 'mov', 'webm', 'mkv', 'm4a', 'mp3', 'aac', 'wav', 'ogg', 'flac'],
  ressource: ['pdf', 'png', 'jpeg', 'gif', 'webp', 'zip', '7z', 'rar', 'mp4', 'mov', 'webm', 'mkv'],
  // Section CM : visuels, vidéos (clips), PDF et archives.
  cm: ['pdf', 'png', 'jpeg', 'gif', 'webp', 'zip', '7z', 'rar', 'mp4', 'mov', 'webm', 'mkv'],
  // Drive CM : tous les types courants (images, vidéos, audio, PDF, polices, archives, fichiers de création, texte).
  // Jamais de HTML ni d'exécutable ; le SVG est servi sans exécution de script (lecture.mjs).
  drive: ['pdf', 'png', 'jpeg', 'gif', 'webp', 'svg', 'tiff', 'heic', 'avif', 'psd', 'zip', '7z', 'rar', 'gzip', 'mp4', 'mov', 'webm', 'mkv', 'm4a', 'mp3', 'aac', 'wav', 'ogg', 'flac', 'ttf', 'otf', 'woff', 'woff2', 'texte'],
};

/** Marques `ftyp` des images HEIF / AVIF (sinon prises pour un MP4). */
const MARQUES_HEIF = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
const MARQUES_AVIF = new Set(['avif', 'avis']);

/** Texte (UTF-8, sinon Latin-1) sans octet de contrôle binaire (la fin d'un morceau peut couper un caractère). */
function texteUtf8(o) {
  const n = Math.min(o.length, 64 * 1024);
  if (n === 0) return null;
  for (let i = 0; i < n; i++) {
    const x = o[i];
    if (x === 0 || (x < 0x20 && x !== 0x09 && x !== 0x0a && x !== 0x0d && x !== 0x0c)) return null;
  }
  // Retire au plus 3 octets d'un caractère coupé à la fin, puis décodage strict.
  let fin = n;
  if (n < o.length) {
    let k = n - 1;
    while (k > n - 4 && k >= 0 && (o[k] & 0xc0) === 0x80) k--;
    if (k >= 0 && o[k] >= 0xc0) fin = k;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(o.subarray(0, fin));
  } catch {
    // Texte d'un ancien encodage (CSV exporté en Windows-1252…) : accepté, lu tel quel.
    return new TextDecoder('latin1').decode(o.subarray(0, n));
  }
}

/**
 * Formats supplémentaires du Drive (aucun autre usage ne les accepte) : SVG, TIFF, HEIC / AVIF, PSD, polices,
 * GZIP, texte brut. Une page HTML n'est jamais acceptée, même en « texte ».
 */
export function reconnaitreEtendu(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets ?? []);
  if (o.length >= 12 && ascii(o, 4, 4) === 'ftyp') {
    const marque = ascii(o, 8, 4);
    if (MARQUES_AVIF.has(marque)) return 'avif';
    if (MARQUES_HEIF.has(marque)) return 'heic';
  }
  const base = reconnaitre(o);
  if (base) return base;
  if (o.length < 4) return null;
  const premiers = ascii(o, 0, 4);
  if (premiers === '8BPS') return 'psd';
  if ((premiers === 'II*\u0000') || (o[0] === 0x4d && o[1] === 0x4d && o[2] === 0x00 && o[3] === 0x2a)) return 'tiff';
  if (premiers === 'wOFF') return 'woff';
  if (premiers === 'wOF2') return 'woff2';
  if (premiers === 'OTTO') return 'otf';
  if ((o[0] === 0x00 && o[1] === 0x01 && o[2] === 0x00 && o[3] === 0x00) || premiers === 'true') return 'ttf';
  if (o[0] === 0x1f && o[1] === 0x8b && o[2] === 0x08) return 'gzip';
  const texte = texteUtf8(o);
  if (texte === null) return null;
  const debut = texte.replace(/^\uFEFF/, '').trimStart().slice(0, 4096).toLowerCase();
  const tout = texte.slice(0, 64 * 1024).toLowerCase();
  // Une page HTML (même cachée dans un SVG) n'est jamais acceptée. Un <script> de SVG l'est : le SVG est servi
  // inerte (politique « sandbox », lecture.mjs) et une balise <img> n'exécute jamais rien.
  if (/<!doctype\s+html|<html[\s>]|<iframe[\s>]|<body[\s>]|<frameset[\s>]/.test(tout)) return null;
  if ((debut.startsWith('<?xml') || debut.startsWith('<svg') || debut.startsWith('<!--') || debut.startsWith('<!doctype svg')) && /<svg[\s>]/.test(tout)) return 'svg';
  if (debut.startsWith('<') || /<script[\s>]/.test(debut)) return null;
  return 'texte';
}

const MARQUES_AUDIO = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ']);
const ATOMES_QUICKTIME = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/** Conteneur reconnu d'après les premiers octets (au moins 12 ; 64 conseillés), ou null. */
export function reconnaitre(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets ?? []);
  if (o.length < 12) return null;
  const quatre = ascii(o, 4, 4);
  if (quatre === 'ftyp') {
    const marque = ascii(o, 8, 4);
    if (marque === 'qt  ') return 'mov';
    if (MARQUES_AUDIO.has(marque)) return 'm4a';
    return 'mp4';
  }
  if (ATOMES_QUICKTIME.has(quatre) && u32(o, 0) >= 8) return 'mov';
  if (o[0] === 0x1a && o[1] === 0x45 && o[2] === 0xdf && o[3] === 0xa3) {
    // En-tête EBML : le DocType (élément 0x4282) dit « webm » ou « matroska ».
    const debut = ascii(o, 0, Math.min(o.length, 96));
    if (debut.includes('webm')) return 'webm';
    if (debut.includes('matroska')) return 'mkv';
    return null;
  }
  const premiers = ascii(o, 0, 4);
  // Documents, images et archives (module Ressources).
  if (premiers === '%PDF') return 'pdf';
  if (o[0] === 0x89 && ascii(o, 1, 3) === 'PNG' && o[4] === 0x0d && o[5] === 0x0a) return 'png';
  if (o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff) return 'jpeg';
  if (ascii(o, 0, 6) === 'GIF87a' || ascii(o, 0, 6) === 'GIF89a') return 'gif';
  if (premiers === 'RIFF' && ascii(o, 8, 4) === 'WEBP') return 'webp';
  if (premiers === 'PK\u0003\u0004' || premiers === 'PK\u0005\u0006') return 'zip';
  if (o[0] === 0x37 && o[1] === 0x7a && o[2] === 0xbc && o[3] === 0xaf && o[4] === 0x27 && o[5] === 0x1c) return '7z';
  if (ascii(o, 0, 6) === 'Rar!\u001a\u0007') return 'rar';
  if (premiers === 'RIFF' && ascii(o, 8, 4) === 'WAVE') return 'wav';
  if (premiers === 'OggS') return 'ogg';
  if (premiers === 'fLaC') return 'flac';
  if (ascii(o, 0, 3) === 'ID3') return 'mp3';
  if (o[0] === 0xff && (o[1] & 0xe0) === 0xe0) {
    // Synchro de trame : couche 00 = AAC (ADTS), sinon MPEG audio (MP3).
    if ((o[1] & 0x06) === 0) return (o[1] & 0x10) === 0x10 ? 'aac' : null;
    return (o[1] & 0x18) !== 0x08 && (o[2] & 0xf0) !== 0xf0 ? 'mp3' : null;
  }
  return null;
}

const CODECS_MP4 = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', av01: 'av1', vp09: 'vp9', vp08: 'vp8', mp4v: 'mpeg4', 'mp4a': 'aac', 'Opus': 'opus', 'ac-3': 'ac3', 'ec-3': 'eac3', alac: 'alac', '.mp3': 'mp3', fLaC: 'flac' };

/** Boîtes ISO-BMFF d'un tampon : [{ type, debut (contenu), fin }]. */
function boites(o, debut, fin) {
  const sortie = [];
  let i = debut;
  while (i + 8 <= fin) {
    let taille = u32(o, i);
    const type = ascii(o, i + 4, 4);
    let entete = 8;
    if (taille === 1) {
      if (i + 16 > fin) break;
      taille = u64(o, i + 8);
      entete = 16;
    } else if (taille === 0) taille = fin - i;
    if (taille < entete || i + taille > fin) {
      sortie.push({ type, debut: i + entete, fin, tronquee: true });
      break;
    }
    sortie.push({ type, debut: i + entete, fin: i + taille });
    i += taille;
  }
  return sortie;
}

/** Lit un `moov` complet : durée (s) et codecs des pistes vidéo / audio. */
function lireMoov(o, debut, fin) {
  const infos = {};
  for (const b of boites(o, debut, fin)) {
    if (b.type === 'mvhd' && !b.tronquee) {
      const version = o[b.debut];
      const echelle = version === 1 ? u32(o, b.debut + 20) : u32(o, b.debut + 12);
      const duree = version === 1 ? u64(o, b.debut + 24) : u32(o, b.debut + 16);
      if (echelle > 0) infos.duree = Math.round((duree / echelle) * 10) / 10;
    }
    if (b.type !== 'trak' || b.tronquee) continue;
    const mdia = boites(o, b.debut, b.fin).find(x => x.type === 'mdia');
    if (!mdia) continue;
    const dans = boites(o, mdia.debut, mdia.fin);
    const hdlr = dans.find(x => x.type === 'hdlr');
    const genre = hdlr ? ascii(o, hdlr.debut + 8, 4) : '';
    const minf = dans.find(x => x.type === 'minf');
    const stbl = minf ? boites(o, minf.debut, minf.fin).find(x => x.type === 'stbl') : undefined;
    const stsd = stbl ? boites(o, stbl.debut, stbl.fin).find(x => x.type === 'stsd') : undefined;
    if (!stsd || stsd.debut + 16 > stsd.fin) continue;
    // stsd : version/drapeaux (4), nombre d'entrées (4), puis la première entrée : taille (4), type (4).
    const fourcc = ascii(o, stsd.debut + 12, 4);
    const codec = CODECS_MP4[fourcc] ?? fourcc.trim();
    if (genre === 'vide' && !infos.codecVideo) infos.codecVideo = codec;
    if (genre === 'soun' && !infos.codecAudio) infos.codecAudio = codec;
  }
  return infos;
}

/** Cherche un `moov` dans les premiers octets d'un MP4 / MOV (boîtes de premier niveau). */
function moovAuDebut(o) {
  for (const b of boites(o, 0, o.length)) {
    if (b.type === 'moov') return b.tronquee ? { tronque: true } : lireMoov(o, b.debut, b.fin);
    if (b.tronquee) return null;
  }
  return null;
}

/** Cherche un `moov` complet dans la FIN du fichier (MP4 non « faststart »). */
function moovALaFin(o) {
  for (let i = o.length - 8; i >= 4; i--) {
    if (o[i] !== 0x6d || ascii(o, i, 4) !== 'moov') continue;
    const taille = u32(o, i - 4);
    if (taille >= 8 && i - 4 + taille <= o.length) return lireMoov(o, i + 4, i - 4 + taille);
  }
  return null;
}

const CODECS_MATROSKA = [
  ['V_MPEG4/ISO/AVC', 'h264'],
  ['V_MPEGH/ISO/HEVC', 'hevc'],
  ['V_AV1', 'av1'],
  ['V_VP9', 'vp9'],
  ['V_VP8', 'vp8'],
  ['A_OPUS', 'opus'],
  ['A_VORBIS', 'vorbis'],
  ['A_AAC', 'aac'],
];

/**
 * Analyse du début d'un fichier (premier morceau) : `{ format, genre, mime, codecVideo?, codecAudio?,
 * duree?, moovAuDebut? }`, ou null si ce n'est ni une vidéo ni un audio reconnu.
 */
export function analyserDebut(octets, { etendu = false } = {}) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets ?? []);
  const format = etendu ? reconnaitreEtendu(o) : reconnaitre(o);
  if (!format) return null;
  const sortie = { format, genre: FORMATS[format].genre, mime: FORMATS[format].mime };
  if (format === 'mp4' || format === 'mov' || format === 'm4a') {
    const moov = moovAuDebut(o);
    if (moov && !moov.tronque) Object.assign(sortie, moov, { moovAuDebut: true });
    else sortie.moovAuDebut = false;
  }
  if (format === 'webm' || format === 'mkv') {
    const texte = ascii(o, 0, Math.min(o.length, 64 * 1024));
    for (const [id, codec] of CODECS_MATROSKA) {
      if (!texte.includes(id)) continue;
      if (id.startsWith('V_') && !sortie.codecVideo) sortie.codecVideo = codec;
      if (id.startsWith('A_') && !sortie.codecAudio) sortie.codecAudio = codec;
    }
  }
  return sortie;
}

/** Complète l'analyse avec la fin du fichier (le `moov` d'un MP4 enregistré sans « faststart »). */
export function completerAvecFin(analyse, octetsFin) {
  if (!analyse || analyse.moovAuDebut !== false) return analyse;
  const moov = moovALaFin(octetsFin instanceof Uint8Array ? octetsFin : new Uint8Array(octetsFin ?? []));
  return moov ? { ...analyse, ...moov } : analyse;
}

/** Le format est-il peu compatible avec l'iPhone (Safari) ? */
export function peuCompatibleIphone(analyse) {
  if (!analyse) return false;
  if (analyse.format === 'mkv') return true;
  return analyse.genre === 'video' && Boolean(analyse.codecVideo) && analyse.codecVideo !== 'h264';
}

/** Résumé public (renvoyé à l'app). */
export function analysePublique(analyse) {
  if (!analyse) return null;
  return {
    format: analyse.format,
    nomFormat: FORMATS[analyse.format]?.nom ?? analyse.format,
    genre: analyse.genre,
    mime: analyse.mime,
    codecVideo: analyse.codecVideo ?? null,
    codecAudio: analyse.codecAudio ?? null,
    duree: Number.isFinite(analyse.duree) ? analyse.duree : null,
    peuCompatibleIphone: peuCompatibleIphone(analyse),
  };
}

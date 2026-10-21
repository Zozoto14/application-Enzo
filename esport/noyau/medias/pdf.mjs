/**
 * PDF de transcription d'une réunion, écrit À LA MAIN (aucune dépendance) : A4, polices standard
 * Helvetica et Helvetica-Bold (rien à embarquer), encodage WinAnsi (français et anglais : accents,
 * guillemets « », apostrophes typographiques, œ, €). Un caractère hors de cet encodage est remplacé
 * par sa lettre de base (ā → a) ou par « ? ».
 *
 * Contenu : en-tête sur chaque page (team, titre, page n / N), titre, fiche (team, type, date, durée,
 * langue, moteur), pré-résumé automatique s'il existe, puis la transcription horodatée
 * (« 00:01:23 » en gras, texte à la ligne avec retrait), pied de page (« à relire »).
 *
 * `misePage()` (pure, testée) découpe le document en pages et en lignes ; `pdfTranscription()` écrit
 * les octets du PDF.
 */

import { dureeLisible, timecode } from './transcription.mjs';

const A4 = { largeur: 595.28, hauteur: 841.89 };
const MARGES = { gauche: 56, droite: 56, haut: 70, bas: 60 };
const LARGEUR_UTILE = A4.largeur - MARGES.gauche - MARGES.droite;
const COLONNE_TEMPS = 64;

// Largeurs Helvetica / Helvetica-Bold (1/1000 em) des caractères 32 à 126.
// prettier-ignore
const LARGEURS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const LARGEURS_GRAS = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Caractères WinAnsi hors Latin-1 (0x80 à 0x9F) : code et largeur. */
const SPECIAUX = {
  '€': [0x80, 556], '‚': [0x82, 222], 'ƒ': [0x83, 556], '„': [0x84, 333], '…': [0x85, 1000], '†': [0x86, 556], '‡': [0x87, 556],
  'ˆ': [0x88, 333], '‰': [0x89, 1000], 'Š': [0x8a, 667], '‹': [0x8b, 333], 'Œ': [0x8c, 1000], 'Ž': [0x8e, 611], '‘': [0x91, 222],
  '’': [0x92, 222], '“': [0x93, 333], '”': [0x94, 333], '•': [0x95, 350], '–': [0x96, 556], '—': [0x97, 1000], '˜': [0x98, 333],
  '™': [0x99, 1000], 'š': [0x9a, 500], '›': [0x9b, 333], 'œ': [0x9c, 944], 'ž': [0x9e, 500], 'Ÿ': [0x9f, 667],
};
const REMPLACEMENTS = { ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-', '‐': '-', '−': '-', '′': "'", '­': '' };

/** Un caractère → [code WinAnsi, largeur normale, largeur grasse]. */
function glyphe(c) {
  const r = REMPLACEMENTS[c];
  if (r !== undefined) c = r || ' ';
  const n = c.codePointAt(0);
  if (n >= 32 && n <= 126) return [n, LARGEURS[n - 32], LARGEURS_GRAS[n - 32]];
  const s = SPECIAUX[c];
  if (s) return [s[0], s[1], s[1]];
  if (n >= 0xa0 && n <= 0xff) {
    // Latin-1 : même code en WinAnsi ; largeur de la lettre de base (é → e), sinon 556.
    const base = c.normalize('NFD')[0];
    const b = base.codePointAt(0);
    const l = b >= 32 && b <= 126 && base !== c ? [LARGEURS[b - 32], LARGEURS_GRAS[b - 32]] : n === 0xa0 ? [278, 278] : n === 0xab || n === 0xbb ? [556, 556] : n === 0xb0 ? [400, 400] : [556, 611];
    return [n, l[0], l[1]];
  }
  const base = c.normalize('NFD')[0];
  const b = base?.codePointAt(0) ?? 63;
  if (b >= 32 && b <= 126) return [b, LARGEURS[b - 32], LARGEURS_GRAS[b - 32]];
  return [63, 556, 611];
}

/** Largeur d'un texte (points). */
export function largeurTexte(texte, taille, gras = false) {
  let l = 0;
  for (const c of String(texte)) l += glyphe(c)[gras ? 2 : 1];
  return (l * taille) / 1000;
}

/** Coupe un texte en lignes de `largeur` points au plus (mots trop longs coupés). */
export function couperLignes(texte, largeur, taille, gras = false) {
  const lignes = [];
  for (const paragraphe of String(texte ?? '').split('\n')) {
    let ligne = '';
    for (const mot of paragraphe.split(/\s+/).filter(Boolean)) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (largeurTexte(essai, taille, gras) <= largeur) {
        ligne = essai;
        continue;
      }
      if (ligne) lignes.push(ligne);
      ligne = '';
      let reste = mot;
      while (largeurTexte(reste, taille, gras) > largeur) {
        let i = reste.length - 1;
        while (i > 1 && largeurTexte(reste.slice(0, i), taille, gras) > largeur) i--;
        lignes.push(reste.slice(0, i));
        reste = reste.slice(i);
      }
      ligne = reste;
    }
    lignes.push(ligne);
  }
  return lignes;
}

const LIBELLES = {
  fr: {
    entete: 'Transcription',
    team: 'Team',
    type: 'Type',
    date: 'Date',
    duree: 'Durée',
    langue: 'Langue',
    moteur: 'Transcrit par',
    genere: 'Généré le',
    preResume: 'Pré-résumé automatique (phrases clés, à vérifier)',
    transcription: 'Transcription horodatée',
    vide: 'Aucune parole reconnue.',
    pied: 'Transcription automatique : peut contenir des erreurs, à relire.',
    page: 'page',
    langues: { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais', nl: 'néerlandais', auto: 'détectée' },
  },
  en: {
    entete: 'Transcript',
    team: 'Team',
    type: 'Type',
    date: 'Date',
    duree: 'Duration',
    langue: 'Language',
    moteur: 'Transcribed by',
    genere: 'Generated on',
    preResume: 'Automatic pre-summary (key sentences, to be checked)',
    transcription: 'Timestamped transcript',
    vide: 'No speech recognised.',
    pied: 'Automatic transcript: may contain mistakes, please proofread.',
    page: 'page',
    langues: { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', auto: 'detected' },
  },
};

const dateLisible = (texte, langue) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texte ?? ''));
  if (!m) return String(texte ?? '');
  return langue === 'en' ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}/${m[2]}/${m[1]}`;
};

/**
 * Mise en page : rend `{ pages: [[{ x, y, taille, gras, gris, texte } | { trait: [x1, y1, x2, y2] }]], libelles }`.
 * `infos` : `{ titre, team, type, date (AAAA-MM-JJ), duree (s), langue, moteur, genereLe (ISO), langueDoc }`.
 */
export function misePage({ titre, team, type, date, duree, langue, moteur, genereLe, langueDoc = 'fr' }, segments, resume = []) {
  const L = LIBELLES[langueDoc] ?? LIBELLES.fr;
  const pages = [];
  let page;
  let y;
  const nouvellePage = () => {
    page = [];
    pages.push(page);
    y = A4.hauteur - MARGES.haut;
  };
  const place = h => {
    if (y - h < MARGES.bas) nouvellePage();
  };
  const ecrire = (texte, { x = MARGES.gauche, taille = 10, gras = false, gris = false, interligne = 1.35, largeur = LARGEUR_UTILE } = {}) => {
    for (const l of couperLignes(texte, largeur, taille, gras)) {
      place(taille * interligne);
      y -= taille * interligne;
      page.push({ x, y, taille, gras, gris, texte: l });
    }
  };
  nouvellePage();
  ecrire(titre || L.entete, { taille: 20, gras: true, interligne: 1.25 });
  y -= 8;
  const fiche = [
    [L.team, team],
    [L.type, type],
    [L.date, dateLisible(date, langueDoc)],
    [L.duree, duree ? dureeLisible(duree, langueDoc) : '—'],
    [L.langue, L.langues[langue] ?? langue ?? '—'],
    [L.moteur, moteur || '—'],
    [L.genere, dateLisible(genereLe, langueDoc)],
  ];
  for (const [nom, valeur] of fiche) {
    place(14);
    y -= 14;
    page.push({ x: MARGES.gauche, y, taille: 10, gras: true, gris: true, texte: `${nom} :` });
    for (const [i, l] of couperLignes(String(valeur ?? '—'), LARGEUR_UTILE - 100, 10).entries()) {
      if (i > 0) {
        place(14);
        y -= 14;
      }
      page.push({ x: MARGES.gauche + 100, y, taille: 10, gras: false, gris: false, texte: l });
    }
  }
  y -= 10;
  page.push({ trait: [MARGES.gauche, y, A4.largeur - MARGES.droite, y] });
  y -= 8;
  if (resume.length) {
    ecrire(L.preResume, { taille: 13, gras: true });
    y -= 2;
    for (const r of resume) ecrire(`• [${timecode(r.debut)}] ${r.texte}`, { x: MARGES.gauche + 8, largeur: LARGEUR_UTILE - 8 });
    y -= 10;
  }
  ecrire(L.transcription, { taille: 13, gras: true });
  y -= 4;
  if (segments.length === 0) ecrire(L.vide, { gris: true });
  for (const [debut, , texte] of segments) {
    const lignes = couperLignes(texte, LARGEUR_UTILE - COLONNE_TEMPS, 10);
    // Garde le timecode et la première ligne ensemble.
    place(14);
    lignes.forEach((l, i) => {
      place(13.5);
      y -= 13.5;
      if (i === 0) page.push({ x: MARGES.gauche, y, taille: 9.5, gras: true, gris: true, texte: timecode(debut) });
      page.push({ x: MARGES.gauche + COLONNE_TEMPS, y, taille: 10, gras: false, gris: false, texte: l });
    });
    y -= 4;
  }
  return { pages, libelles: L };
}

// ------------------------------------------------------------------ Écriture du PDF

/** Texte → chaîne littérale PDF (WinAnsi), parenthèses et barres obliques échappées, octets hauts en octal. */
function litteral(texte) {
  let s = '(';
  for (const c of String(texte)) {
    const [n] = glyphe(c);
    if (n === 0x28 || n === 0x29 || n === 0x5c) s += `\\${String.fromCharCode(n)}`;
    else if (n < 32 || n > 126) s += `\\${n.toString(8).padStart(3, '0')}`;
    else s += String.fromCharCode(n);
  }
  return `${s})`;
}

/** Texte → chaîne hexadécimale UTF-16BE (métadonnées : titre avec accents). */
function hexUtf16(texte) {
  let h = 'FEFF';
  for (let i = 0; i < texte.length; i++) h += texte.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${h}>`;
}

const nombre = n => (Math.round(n * 100) / 100).toString();
const tronquer = (texte, largeur, taille, gras) => {
  if (largeurTexte(texte, taille, gras) <= largeur) return texte;
  let t = texte;
  while (t.length > 1 && largeurTexte(`${t}…`, taille, gras) > largeur) t = t.slice(0, -1);
  return `${t}…`;
};

/** Octets du PDF (Uint8Array). Mêmes arguments que `misePage`. */
export function pdfTranscription(infos, segments, resume = []) {
  const { pages, libelles: L } = misePage(infos, segments, resume);
  const objets = [];
  const ajouterObjet = corps => {
    objets.push(corps);
    return objets.length;
  };
  // 1 catalogue, 2 arbre des pages, 3 et 4 polices ; puis, par page : contenu et page.
  ajouterObjet('<< /Type /Catalog /Pages 2 0 R >>');
  ajouterObjet('');
  ajouterObjet('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  ajouterObjet('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const enTete = tronquer(`${L.entete} · ${infos.team ?? ''} · ${infos.titre ?? ''}`, LARGEUR_UTILE - 70, 8.5, false);
  const refsPages = [];
  pages.forEach((elements, i) => {
    const ops = [];
    // En-tête et pied de page.
    ops.push('0.45 g', `BT /F1 8.5 Tf ${nombre(MARGES.gauche)} ${nombre(A4.hauteur - 40)} Td ${litteral(enTete)} Tj ET`);
    const numero = `${L.page} ${i + 1} / ${pages.length}`;
    ops.push(`BT /F1 8.5 Tf ${nombre(A4.largeur - MARGES.droite - largeurTexte(numero, 8.5))} ${nombre(A4.hauteur - 40)} Td ${litteral(numero)} Tj ET`);
    ops.push('0.8 G 0.5 w', `${nombre(MARGES.gauche)} ${nombre(A4.hauteur - 47)} m ${nombre(A4.largeur - MARGES.droite)} ${nombre(A4.hauteur - 47)} l S`);
    ops.push(`BT /F1 8 Tf ${nombre(MARGES.gauche)} ${nombre(32)} Td ${litteral(L.pied)} Tj ET`);
    for (const e of elements) {
      if (e.trait) {
        ops.push('0.75 G 0.8 w', `${e.trait.map(nombre).slice(0, 2).join(' ')} m ${e.trait.map(nombre).slice(2).join(' ')} l S`);
        continue;
      }
      ops.push(e.gris ? '0.35 g' : '0 g', `BT /${e.gras ? 'F2' : 'F1'} ${nombre(e.taille)} Tf ${nombre(e.x)} ${nombre(e.y)} Td ${litteral(e.texte)} Tj ET`);
    }
    const flux = ops.join('\n');
    const contenu = ajouterObjet(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
    refsPages.push(ajouterObjet(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.largeur} ${A4.hauteur}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contenu} 0 R >>`));
  });
  objets[1] = `<< /Type /Pages /Kids [${refsPages.map(r => `${r} 0 R`).join(' ')}] /Count ${refsPages.length} >>`;
  const d = String(infos.genereLe ?? '').replace(/[-:T]/g, '').slice(0, 14);
  const info = ajouterObjet(`<< /Title ${hexUtf16(`${L.entete} - ${infos.titre ?? ''}`)} /Producer (AppDashboard Esport) /Creator (AppDashboard Esport)${/^\d{14}$/.test(d) ? ` /CreationDate (D:${d}Z)` : ''} >>`);
  let sortie = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const positions = [];
  objets.forEach((corps, i) => {
    positions.push(sortie.length);
    sortie += `${i + 1} 0 obj\n${corps}\nendobj\n`;
  });
  const xref = sortie.length;
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  sortie += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const octets = new Uint8Array(sortie.length);
  for (let i = 0; i < sortie.length; i++) octets[i] = sortie.charCodeAt(i) & 0xff;
  return octets;
}

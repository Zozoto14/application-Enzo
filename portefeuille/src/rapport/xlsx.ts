/**
 * Écriture d'un classeur Excel (.xlsx), sans dépendance.
 *
 * Un .xlsx est une archive ZIP de quelques fichiers XML. On l'écrit ici en
 * mode « stocké » (sans compression) : Excel, LibreOffice et Numbers
 * l'ouvrent sans broncher, et il n'y a rien à installer.
 *
 * Les nombres restent des nombres (on peut trier, sommer, faire un
 * graphique), avec un format d'affichage : euros, pourcentage, date.
 */

export type FormatCellule = 'texte' | 'euro' | 'nombre' | 'pourcent' | 'date';

export interface ColonneFeuille {
  titre: string;
  format?: FormatCellule;
  /** Largeur en caractères. */
  largeur?: number;
}

export type ValeurCellule = string | number | null | undefined;

export interface Feuille {
  nom: string;
  colonnes: readonly ColonneFeuille[];
  lignes: ReadonlyArray<readonly ValeurCellule[]>;
}

// ------------------------------------------------------------------ ZIP

const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(octets: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < octets.length; i++) crc = TABLE_CRC[(crc ^ octets[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 sans TextEncoder, absent de certains moteurs embarqués. */
export function utf8(texte: string): Uint8Array {
  const octets: number[] = [];
  for (const caractere of texte) {
    const code = caractere.codePointAt(0)!;
    if (code < 0x80) octets.push(code);
    else if (code < 0x800) octets.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) octets.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else octets.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(octets);
}

export function zipStocke(fichiers: ReadonlyArray<{ nom: string; contenu: Uint8Array }>): Uint8Array {
  const morceaux: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let decalage = 0;
  for (const fichier of fichiers) {
    const nom = utf8(fichier.nom);
    const crc = crc32(fichier.contenu);
    const taille = fichier.contenu.length;
    const entete = new Uint8Array(30 + nom.length);
    const vue = new DataView(entete.buffer);
    vue.setUint32(0, 0x04034b50, true);
    vue.setUint16(4, 20, true);
    vue.setUint16(6, 0x0800, true); // noms en UTF-8
    vue.setUint16(8, 0, true); // stocké
    vue.setUint32(14, crc, true);
    vue.setUint32(18, taille, true);
    vue.setUint32(22, taille, true);
    vue.setUint16(26, nom.length, true);
    entete.set(nom, 30);
    morceaux.push(entete, fichier.contenu);

    const repertoire = new Uint8Array(46 + nom.length);
    const vueRep = new DataView(repertoire.buffer);
    vueRep.setUint32(0, 0x02014b50, true);
    vueRep.setUint16(4, 20, true);
    vueRep.setUint16(6, 20, true);
    vueRep.setUint16(8, 0x0800, true);
    vueRep.setUint32(16, crc, true);
    vueRep.setUint32(20, taille, true);
    vueRep.setUint32(24, taille, true);
    vueRep.setUint16(28, nom.length, true);
    vueRep.setUint32(42, decalage, true);
    repertoire.set(nom, 46);
    central.push(repertoire);
    decalage += entete.length + taille;
  }
  const tailleCentral = central.reduce((total, morceau) => total + morceau.length, 0);
  const fin = new Uint8Array(22);
  const vueFin = new DataView(fin.buffer);
  vueFin.setUint32(0, 0x06054b50, true);
  vueFin.setUint16(8, fichiers.length, true);
  vueFin.setUint16(10, fichiers.length, true);
  vueFin.setUint32(12, tailleCentral, true);
  vueFin.setUint32(16, decalage, true);

  const total = decalage + tailleCentral + fin.length;
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const morceau of [...morceaux, ...central, fin]) {
    sortie.set(morceau, position);
    position += morceau.length;
  }
  return sortie;
}

// ----------------------------------------------------------------- XLSX

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caractères de contrôle interdits en XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function colonneLettre(index: number): string {
  let lettres = '';
  let n = index + 1;
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettres = String.fromCharCode(65 + reste) + lettres;
    n = Math.floor((n - 1) / 26);
  }
  return lettres;
}

/** « 2026-09-26 » devient le numéro de jour d'Excel. */
export function dateExcel(iso: string): number | undefined {
  const temps = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(temps) ? undefined : temps / 86_400_000 + 25569;
}

const STYLES: Record<FormatCellule, number> = { texte: 0, euro: 2, date: 3, nombre: 4, pourcent: 5 };

function cellule(valeur: ValeurCellule, reference: string, format: FormatCellule): string {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  if (format === 'date' && typeof valeur === 'string') {
    const numero = dateExcel(valeur);
    if (numero !== undefined) return `<c r="${reference}" s="${STYLES.date}"><v>${numero}</v></c>`;
  }
  if (typeof valeur === 'number' && Number.isFinite(valeur)) {
    return `<c r="${reference}" s="${STYLES[format === 'texte' ? 'nombre' : format]}"><v>${valeur}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${echapper(String(valeur))}</t></is></c>`;
}

function feuilleXml(feuille: Feuille): string {
  const largeurs = feuille.colonnes
    .map((colonne, index) => `<col min="${index + 1}" max="${index + 1}" width="${colonne.largeur ?? Math.max(10, colonne.titre.length + 2)}" customWidth="1"/>`)
    .join('');
  const entete = `<row r="1">${feuille.colonnes
    .map((colonne, index) => `<c r="${colonneLettre(index)}1" s="1" t="inlineStr"><is><t>${echapper(colonne.titre)}</t></is></c>`)
    .join('')}</row>`;
  const lignes = feuille.lignes
    .map(
      (ligne, rang) =>
        `<row r="${rang + 2}">${ligne
          .map((valeur, index) => cellule(valeur, `${colonneLettre(index)}${rang + 2}`, feuille.colonnes[index]?.format ?? 'texte'))
          .join('')}</row>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    // Ligne d'en-tête figée : elle reste visible en faisant défiler.
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${largeurs}</cols><sheetData>${entete}${lignes}</sheetData>` +
    (feuille.lignes.length > 0
      ? `<autoFilter ref="A1:${colonneLettre(feuille.colonnes.length - 1)}${feuille.lignes.length + 1}"/>`
      : '') +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
  '<numFmt numFmtId="166" formatCode="0.00&quot; %&quot;"/>' +
  '</numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Nom de feuille valide pour Excel : 31 caractères, sans []:*?/\. */
function nomFeuille(nom: string): string {
  return nom.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Feuille';
}

export function creerClasseur(feuilles: readonly Feuille[]): Uint8Array {
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    feuilles
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>';
  const racine =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const classeur =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    feuilles.map((feuille, index) => `<sheet name="${echapper(nomFeuille(feuille.nom))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('') +
    '</sheets>' +
    (feuilles.some(feuille => feuille.lignes.length > 0)
      ? `<definedNames>${feuilles
          .map((feuille, index) =>
            feuille.lignes.length > 0
              ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${echapper(nomFeuille(feuille.nom)).replace(/'/g, "''")}'!$A$1:$${colonneLettre(feuille.colonnes.length - 1)}$${feuille.lignes.length + 1}</definedName>`
              : '',
          )
          .join('')}</definedNames>`
      : '') +
    '</workbook>';
  const liens =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    feuilles
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${feuilles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  return zipStocke([
    { nom: '[Content_Types].xml', contenu: utf8(types) },
    { nom: '_rels/.rels', contenu: utf8(racine) },
    { nom: 'xl/workbook.xml', contenu: utf8(classeur) },
    { nom: 'xl/_rels/workbook.xml.rels', contenu: utf8(liens) },
    { nom: 'xl/styles.xml', contenu: utf8(STYLES_XML) },
    ...feuilles.map((feuille, index) => ({ nom: `xl/worksheets/sheet${index + 1}.xml`, contenu: utf8(feuilleXml(feuille)) })),
  ]);
}

/**
 * Lecture de fichiers CSV.
 *
 * Écrit à la main plutôt que tiré d'une bibliothèque : les relevés bancaires
 * français cumulent point-virgule comme séparateur, BOM UTF-8 en tête,
 * guillemets autour des libellés contenant des virgules, et lignes d'en-tête
 * parasites. Une dépendance de plus ne réglerait pas ces cas particuliers.
 */

export interface LigneCsv {
  /** Numéro de ligne dans le fichier d'origine, pour situer une erreur. */
  numero: number;
  champs: Record<string, string>;
  /** Ligne brute, réaffichée dans le rapport d'import en cas de problème. */
  brut: string;
}

export interface FichierCsv {
  entetes: string[];
  lignes: LigneCsv[];
  delimiteur: string;
}

const DELIMITEURS_CANDIDATS = [';', ',', '\t', '|'];

/** Retire le BOM UTF-8, que Excel ajoute systématiquement à ses exports. */
function retirerBom(contenu: string): string {
  return contenu.charCodeAt(0) === 0xfeff ? contenu.slice(1) : contenu;
}

/**
 * Devine le séparateur en prenant celui qui découpe le plus régulièrement les
 * premières lignes. Un séparateur correct donne le même nombre de colonnes
 * partout ; un mauvais donne un découpage erratique.
 */
export function detecterDelimiteur(contenu: string): string {
  const lignes = retirerBom(contenu)
    .split(/\r?\n/)
    .filter(ligne => ligne.trim() !== '')
    .slice(0, 10);

  if (lignes.length === 0) {
    return ';';
  }

  let meilleur = ';';
  let meilleurScore = -1;

  for (const candidat of DELIMITEURS_CANDIDATS) {
    const comptes = lignes.map(ligne => decouper(ligne, candidat).length);
    const colonnes = comptes[0];
    if (colonnes < 2) {
      continue;
    }
    const regulier = comptes.every(nombre => nombre === colonnes);
    const score = regulier ? colonnes * 10 : colonnes;
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleur = candidat;
    }
  }
  return meilleur;
}

/** Découpe une ligne en respectant les guillemets et les doublements ("" = "). */
export function decouper(ligne: string, delimiteur: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let entreGuillemets = false;

  for (let i = 0; i < ligne.length; i++) {
    const caractere = ligne[i];

    if (entreGuillemets) {
      if (caractere === '"') {
        if (ligne[i + 1] === '"') {
          courant += '"';
          i++;
        } else {
          entreGuillemets = false;
        }
      } else {
        courant += caractere;
      }
      continue;
    }

    if (caractere === '"') {
      entreGuillemets = true;
    } else if (caractere === delimiteur) {
      champs.push(courant.trim());
      courant = '';
    } else {
      courant += caractere;
    }
  }
  champs.push(courant.trim());
  return champs;
}

export interface OptionsLecture {
  delimiteur?: string;
  /** Nombre de lignes à ignorer avant l'en-tête (bandeaux d'export bancaire). */
  lignesIgnorees?: number;
}

export function lireCsv(contenu: string, options: OptionsLecture = {}): FichierCsv {
  const texte = retirerBom(contenu);
  const delimiteur = options.delimiteur ?? detecterDelimiteur(texte);
  const ignorees = options.lignesIgnorees ?? 0;

  const toutes = texte.split(/\r?\n/);
  const numerotees = toutes
    .map((brut, index) => ({ brut, numero: index + 1 }))
    .slice(ignorees)
    .filter(({ brut }) => brut.trim() !== '');

  if (numerotees.length === 0) {
    return { entetes: [], lignes: [], delimiteur };
  }

  const [enteteBrute, ...reste] = numerotees;
  const entetes = decouper(enteteBrute.brut, delimiteur).map(entete =>
    entete.trim(),
  );

  const lignes = reste.map(({ brut, numero }) => {
    const valeurs = decouper(brut, delimiteur);
    const champs: Record<string, string> = {};
    entetes.forEach((entete, index) => {
      champs[entete] = valeurs[index] ?? '';
    });
    return { numero, champs, brut };
  });

  return { entetes, lignes, delimiteur };
}

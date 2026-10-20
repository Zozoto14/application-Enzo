/**
 * Garde-fou : aucune chaîne française « en dur » ne doit rester dans le code de l'Esport.
 *
 * Le test lit tous les fichiers de src/esport (hors tests, hors dictionnaires `i18n/`, hors données de
 * démonstration `faux.ts`) et repère, dans le code :
 *  - le texte JSX, les littéraux de chaîne et les morceaux de gabarits qui contiennent une lettre accentuée
 *    ou un mot français courant (« pour », « dans », « aucun »…) ;
 * Les textes traduits (`tr('cle')`), les clés techniques (testID, comparaisons, `case`, imports, types…) sont
 * ignorés. Une exception légitime se déclare dans EXCEPTIONS (avec la raison).
 */

import ts from 'typescript';

// Le tsconfig du projet n'inclut pas les types Node : on les déclare a minima.
declare const __dirname: string;
const { readdirSync, readFileSync, statSync } = require('fs');
const { join, relative } = require('path');

const RACINE: string = join(__dirname, '..');

/** Chaînes françaises voulues : [fichier (extrait), texte contenu, raison]. */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['i18n/', '', 'dictionnaires et utilitaires de langue'],
  ['strats/assets.ts', 'Contrôleur', 'rôles des agents du jeu (données de repli, traduites à l’affichage par nomPoste)'],
  ['strats/assets.ts', 'Initiateur', 'idem'],
  ['strats/assets.ts', 'Sentinelle', 'idem'],
  ['strats/assets.ts', 'Duelliste', 'idem'],
  ['strats/assets.ts', 'Grenade', 'emplacement de capacité du jeu (clé stable)'],
  ['strats/assets.ts', 'Legal Jibber Jabber', 'mention légale imposée par Riot Games (anglais)'],
  ['i18n/', 'Français', 'nom de la langue, écrit dans sa langue'],
];

const MOTS_FRANCAIS = new Set(
  (
    'le la les un une des du de et ou pour dans sur avec sans par est sont pas vous votre vos nous notre ce cette ces qui que au aux en ' +
    'aucun aucune toutes tout favoris brouillons oui non déjà où mais chez depuis jusqu entre tous'
  ).split(' '),
);
/** Mots qui sont aussi des identifiants ou de l'anglais : on ne les cherche que dans une phrase de plusieurs mots. */
const MOTS_AMBIGUS = new Set(['de', 'en', 'on', 'a', 'par', 'sur', 'ou', 'et', 'tout', 'non', 'oui', 'tous', 'entre', 'pas']);

function fichiers(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier) as string[]) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiers(chemin));
    else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.|\.d\.ts$|faux\.ts$/.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

/** Attributs JSX qui portent un texte lu par l'utilisateur. */
const ATTRIBUTS_AFFICHES = new Set(['libelle', 'titre', 'texte', 'sous', 'placeholder', 'label', 'accessibilityLabel', 'accessibilityHint', 'title', 'description', 'detail']);
/** Noms propres et sigles identiques dans toutes les langues. */
const MARQUES = new Set(['Discord', 'Esport', 'PDF', 'Riot', 'Playbook', 'Scouting', 'Review', 'Strats', 'Jett, Raze']);

/** Exemples de saisie identiques dans toutes les langues : adresses, fuseaux IANA, Riot ID. */
const EXEMPLE_TECHNIQUE = /^(https?:\/\/|[A-Z][a-z]+\/[A-Z][a-z_]+$|[A-Za-z]+#[A-Z]+$)/;

const ACCENT = /[àâäçéèêëîïôöùûüœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒ]/;

/** Une seule « unité » technique (identifiant, code, URL, CSS) : jamais du texte affiché. */
const TECHNIQUE = /^[\w.#:/@%=&?+*-]+$/;
/** Mots français isolés qui s'affichent tels quels (les autres chaînes d'un seul mot sont des identifiants). */
const MOTS_AFFICHES = new Set(['aucun', 'favoris', 'brouillons', 'archivées', 'validées']);

function ressembleAuFrancais(texte: string): boolean {
  if (ACCENT.test(texte)) return true;
  const brut = texte.trim();
  if (TECHNIQUE.test(brut) || /sans-serif|system-ui|[{};]/.test(brut)) return MOTS_AFFICHES.has(brut.toLowerCase());
  const mots = texte.toLowerCase().match(/[a-zàâäçéèêëîïôöùûüœ]+/g) ?? [];
  if (mots.length === 0) return false;
  const phrase = mots.length >= 3 || /\s/.test(texte.trim());
  return mots.some(m => MOTS_FRANCAIS.has(m) && (phrase || !MOTS_AMBIGUS.has(m)));
}

const ATTRIBUTS_TECHNIQUES = new Set(['testID', 'key', 'style', 'accessibilityRole', 'role', 'name', 'type', 'id', 'href', 'src', 'source', 'color', 'rel', 'target', 'keyboardType', 'autoComplete', 'autoCapitalize']);

function ignore(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  for (let a: ts.Node | undefined = p; a; a = a.parent) if (ts.isTypeNode(a) || ts.isInterfaceDeclaration(a) || ts.isTypeAliasDeclaration(a)) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && ['===', '!==', '==', '!='].includes(p.operatorToken.getText())) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === n) return true;
  if (ts.isJsxAttribute(p) && ATTRIBUTS_TECHNIQUES.has(p.name.getText())) return true;
  if (ts.isCallExpression(p)) {
    const appel = p.expression.getText();
    // tr('cle'), trn('cle', n), traduire(…), trOu('cle.dyn', …) : ce sont des clés, pas du texte.
    if (/^(tr|trn|trOu|traduire|traduireNombre|require|console\.\w+)$/.test(appel)) return true;
    // Appels sur des chaînes techniques (ids, normalisation, comparaisons de texte).
    if (/\.(includes|startsWith|endsWith|indexOf|split|test|match|add|has|get|set|delete|replace|replaceAll|localeCompare|normalize|toLocaleLowerCase|padStart|padEnd|querySelector|getItem|setItem|removeItem)$/.test(appel) && p.arguments[0] === n) return true;
  }
  if (ts.isNewExpression(p) && /^(RegExp|Date|Set|Map|URL|Intl\.\w+)$/.test(p.expression.getText())) return true;
  return false;
}

function exception(fichier: string, texte: string): boolean {
  return EXCEPTIONS.some(([f, t]) => fichier.includes(f) && texte.includes(t));
}

describe('aucune chaîne française en dur dans l’Esport', () => {
  it('le code de src/esport ne contient que des textes passés par tr()', () => {
    const trouves: string[] = [];
    for (const chemin of fichiers(RACINE)) {
      const fichier = relative(RACINE, chemin).replace(/\\/g, '/');
      const source = readFileSync(chemin, 'utf8');
      const sf = ts.createSourceFile(chemin, source, ts.ScriptTarget.Latest, true, chemin.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const signaler = (n: ts.Node, texte: string) => {
        if (!ressembleAuFrancais(texte) || exception(fichier, texte)) return;
        trouves.push(`${fichier}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${JSON.stringify(texte.trim().slice(0, 90))}`);
      };
      const visite = (n: ts.Node) => {
        // Attribut d'affichage écrit en dur (libelle="De", titre="Au") : toujours un texte à traduire.
        if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRIBUTS_AFFICHES.has(n.name.getText()) && /[A-Za-zÀ-ÿ]{2}/.test(n.initializer.text) && !MARQUES.has(n.initializer.text) && !EXEMPLE_TECHNIQUE.test(n.initializer.text)) {
          trouves.push(`${fichier}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.name.getText()}=${JSON.stringify(n.initializer.text)}`);
        }
        if (ts.isJsxText(n)) signaler(n, n.text);
        else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !ignore(n)) signaler(n, n.text);
        else if (ts.isTemplateExpression(n) && !ignore(n)) {
          // Les morceaux fixes d'un gabarit (hors expressions) ; les expressions sont visitées à part.
          signaler(n, [n.head.text, ...n.templateSpans.map(s => s.literal.text)].join('#'));
        }
        ts.forEachChild(n, visite);
      };
      visite(sf);
    }
    expect(trouves).toEqual([]);
  });
});

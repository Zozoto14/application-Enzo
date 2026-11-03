/**
 * Garde-fou : aucun emoji EN COULEUR dans le code de l'interface (src/, bureau/, App.tsx).
 *
 * L'interface n'utilise que des icônes monochromes (src/ui/icones : `Icone`, `Glyphe`) ou des symboles texte
 * (✓ ✕ ← → ⌂ ◆…). Est refusé : tout caractère emoji Extended_Pictographic qui n'est pas suivi du sélecteur texte
 * U+FE0E (🔔, ✨, ⚙ sans sélecteur, ⚙️…) et tout indicateur régional (drapeaux 🇫🇷). Les symboles qui ne sont
 * jamais des emojis (★ ✎ ☐ ⌂ ◆ ▦) restent permis.
 *
 * Restent permis, volontairement (contenus, pas l'interface) :
 *  - les fichiers de `EXCLUSIONS` ci-dessous (contenus du devblog, messages Discord, rendus « comme sur Discord ») ;
 *  - une ligne marquée `emoji-autorise` (ou celle qui suit ce marqueur), avec la raison : liste d'emojis proposés à
 *    l'utilisateur, valeur par défaut d'un champ que l'utilisateur choisit… ;
 *  - les commentaires (lignes qui commencent par //, /* ou *), les tests et les fixtures.
 *
 * Lancer seul : `npm run emojis:verifier`.
 */

export {};
declare const __dirname: string;
const { readdirSync, readFileSync, statSync } = require('fs');
const { join, relative, sep } = require('path');

const RACINE = join(__dirname, '..', '..', '..');

/** Fichiers entiers laissés tels quels, et pourquoi. */
const EXCLUSIONS: Record<string, string> = {
  'src/hub/devblog/entrees.ts': 'textes du devblog « Quoi de neuf » (contenu rédigé, emoji de chaque section)',
  'src/esport/devblog/rendu.ts': 'message du devblog envoyé sur Discord (DA du devblog Discord)',
  'src/esport/ui/devblog/Contenu.tsx': 'aperçu « comme sur Discord » du devblog',
};

const DOSSIERS = ['src', 'bureau'];
const FICHIERS = ['App.tsx'];
const IGNORES = new Set(['node_modules', 'dist', '__fixtures__', '__tests__', '__mocks__', 'paquet']);
const EXTENSIONS = /\.(tsx?|mjs|cjs|jsx?|html|css)$/;

/** Le sélecteur texte compte écrit tel quel ou en échappement (« \\uFE0E ») dans une chaîne. */
const EMOJI_EN_COULEUR = /(?=\p{Extended_Pictographic})\p{Emoji}(?!\uFE0E|\\u\{?[fF][eE]0[eE])|\p{Regional_Indicator}/u;

function parcourir(dossier: string, sortie: string[]) {
  for (const nom of readdirSync(dossier)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) parcourir(chemin, sortie);
    else if (EXTENSIONS.test(nom) && !/\.test\.|\.spec\./.test(nom)) sortie.push(chemin);
  }
  return sortie;
}

/** Emojis en couleur d'un texte de code : « fichier:ligne: extrait ». */
function emojisEnCouleur(fichier: string, source: string): string[] {
  const trouves: string[] = [];
  const lignes = source.split('\n');
  lignes.forEach((ligne, i) => {
    const t = ligne.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (ligne.includes('emoji-autorise') || (i > 0 && lignes[i - 1].includes('emoji-autorise'))) return;
    const m = EMOJI_EN_COULEUR.exec(ligne);
    if (m) trouves.push(`${fichier}:${i + 1}: « ${m[0]} » dans ${t.slice(0, 120)}`);
  });
  return trouves;
}

describe('Interface sans emoji en couleur', () => {
  it('reconnaît les emojis en couleur et laisse passer les symboles texte', () => {
    expect(emojisEnCouleur('x', "titre: '🔔 Rappels'")).toHaveLength(1);
    expect(emojisEnCouleur('x', "titre: '🇫🇷 Français'")).toHaveLength(1);
    expect(emojisEnCouleur('x', "glyphe: '⚙️'")).toHaveLength(1);
    expect(emojisEnCouleur('x', "glyphe: '⚙'")).toHaveLength(1);
    expect(emojisEnCouleur('x', "glyphe: '⚙\\uFE0E'")).toHaveLength(0);
    expect(emojisEnCouleur('x', "glyphe: '★ ✎ ☐ ⌂ ◆ ✓ ✕ ← →'")).toHaveLength(0);
    expect(emojisEnCouleur('x', "// la pastille 🔔 du hub")).toHaveLength(0);
    expect(emojisEnCouleur('x', "const EMOJIS = ['👍']; // emoji-autorise : choix de l'utilisateur")).toHaveLength(0);
  });

  it('aucun emoji en couleur dans src/, bureau/ et App.tsx (hors contenus listés)', () => {
    const fichiers = [...DOSSIERS.flatMap(d => parcourir(join(RACINE, d), [])), ...FICHIERS.map(f => join(RACINE, f))];
    const trouves = fichiers.flatMap(chemin => {
      const rel = relative(RACINE, chemin).split(sep).join('/');
      return EXCLUSIONS[rel] ? [] : emojisEnCouleur(rel, readFileSync(chemin, 'utf8'));
    });
    expect(trouves).toEqual([]);
  });
});

/**
 * Build du bureau : la meme interface React Native, rendue par un navigateur.
 *
 * Deux reglages font tout le travail :
 *
 *  - `react-native` est redirige vers `react-native-web`, qui traduit les
 *    composants et les styles en DOM. L'interface n'a pas une ligne a changer.
 *  - `.web.ts` passe avant `.ts` dans la resolution : c'est ainsi que les
 *    adaptateurs de plateforme — base de donnees, fichiers, notifications —
 *    se substituent sans que le code metier connaisse leur existence.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ici = chemin => fileURLToPath(new URL(chemin, import.meta.url));

/** Version affichée dans les Paramètres du hub : paquet + commit compilé. */
function versionApp() {
  const paquet = JSON.parse(readFileSync(ici('./package.json'), 'utf8')).version;
  let commit = '';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ici('.'), encoding: 'utf8' }).trim();
  } catch {
    // Pas de git (archive) : la version du paquet suffit.
  }
  return commit ? `${paquet} (${commit})` : paquet;
}

/**
 * Version du build : commit (complet) + date. Publiée dans version.json (servi sans cache) : l'app compare la
 * sienne à celle du site pour proposer « Nouvelle version disponible » (src/hub/maj/version.ts), et le serveur
 * Esport la lit dans public_html pour la page « Mises à jour » (docs/mises-a-jour.md).
 */
const BUILD = (() => {
  let commit = process.env.GITHUB_SHA || '';
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ici('.'), encoding: 'utf8' }).trim();
    } catch {
      commit = '';
    }
  }
  const date = new Date();
  // id : même forme qu'avant (« <commit court>-<date en base 36> ») : les onglets déjà ouverts le comparent tel quel.
  return { id: `${commit ? commit.slice(0, 7) : 'sans-git'}-${date.getTime().toString(36)}`, commit: commit || null, date: date.toISOString() };
})();
const ID_BUILD = BUILD.id;

/** Publie version.json à la racine du build : l'app compare son __BUILD_ID__ à celui du serveur. */
const publierVersion = () => ({
  name: 'publier-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) + '\n' });
  },
});

export default defineConfig({
  root: 'bureau',
  // Chemins relatifs : l'application livree charge ses fichiers depuis le
  // disque (file://), ou une racine absolue ne resoudrait rien.
  base: './',
  plugins: [react(), publierVersion()],
  define: {
    // Attendu par react-native-web et par plusieurs modules du noyau.
    global: 'globalThis',
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    __VERSION_APP__: JSON.stringify(versionApp()),
    __BUILD_ID__: JSON.stringify(ID_BUILD),
    __BUILD_COMMIT__: JSON.stringify(BUILD.commit ?? ''),
    __BUILD_DATE__: JSON.stringify(BUILD.date),
  },
  resolve: {
    alias: [
      // Les imports profonds d'abord : certaines bibliotheques declarent
      // leurs composants natifs par ces utilitaires, y compris dans le code
      // charge par un navigateur. Il n'y a rien de natif a enregistrer ici.
      {
        find: /^react-native\/Libraries\/Utilities\/codegenNativeComponent$/,
        replacement: ici('./bureau/cales/codegenNativeComponent.js'),
      },
      {
        find: /^react-native\/Libraries\/Utilities\/codegenNativeCommands$/,
        replacement: ici('./bureau/cales/codegenNativeCommands.js'),
      },
      // Le fournisseur de zones sures s'appuie sur un module natif : sans
      // lui il ne rend rien, ecran blanc et sans erreur. Une fenetre de
      // bureau n'a de toute facon ni encoche ni barre d'accueil.
      {
        find: /^react-native-safe-area-context$/,
        replacement: ici('./bureau/cales/safe-area.tsx'),
      },
      // Puis la redirection principale, en chemin absolu et sur le nom exact :
      // une correspondance par prefixe casserait les imports profonds.
      { find: /^react-native$/, replacement: ici('./node_modules/react-native-web') },
    ],
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  optimizeDeps: {
    esbuildOptions: { resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.js'] },
  },
});

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

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ici = chemin => fileURLToPath(new URL(chemin, import.meta.url));

export default defineConfig({
  root: 'bureau',
  // Chemins relatifs : l'application livree charge ses fichiers depuis le
  // disque (file://), ou une racine absolue ne resoudrait rien.
  base: './',
  plugins: [react()],
  define: {
    // Attendu par react-native-web et par plusieurs modules du noyau.
    global: 'globalThis',
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
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

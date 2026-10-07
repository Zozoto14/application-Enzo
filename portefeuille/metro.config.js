const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * Le hub vit hors du portefeuille (`../hub/src`) et s'importe par l'alias
 * `@hub` (comme dans tsconfig.json, vite.config.mjs et jest.config.js) :
 *  - `watchFolders` laisse Metro lire et surveiller ../hub ;
 *  - `resolveRequest` traduit `@hub` et `@hub/...` en chemins de fichiers ;
 *  - `nodeModulesPaths` : le hub n'a pas de node_modules, ses imports de
 *    react et react-native se resolvent dans ceux du portefeuille.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const HUB = path.resolve(__dirname, '../hub');
const SOURCES_HUB = path.join(HUB, 'src');

const config = {
  watchFolders: [HUB],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === '@hub' || moduleName.startsWith('@hub/')) {
        const chemin = path.join(SOURCES_HUB, moduleName.slice('@hub'.length));
        return context.resolveRequest(context, chemin, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

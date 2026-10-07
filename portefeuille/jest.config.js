const path = require('path');

/** Code du hub, hors du portefeuille : `hub/src`, importé par l'alias `@hub`. */
const HUB = path.resolve(__dirname, '../hub/src');

module.exports = {
  preset: '@react-native/jest-preset',
  // Les tests du hub vivent avec lui, dans hub/src.
  roots: ['<rootDir>', HUB],
  moduleNameMapper: {
    '^@hub$': `${HUB}/index.ts`,
    '^@hub/(.*)$': `${HUB}/$1`,
  },
  // Le hub n'a pas de node_modules : react, react-native... se resolvent
  // dans ceux du portefeuille.
  // (babel-jest part de rootDir : babel.config.js s'applique aussi au hub.)
  moduleDirectories: ['node_modules', path.resolve(__dirname, 'node_modules')],
  // @noble/hashes et @noble/ciphers sont publiés en modules ES. Jest les lit
  // depuis node_modules, que le preset exclut de la transformation par
  // defaut : sans cette exception, leurs `export` provoquent une erreur de
  // syntaxe. Metro, lui, les gere nativement cote application.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@noble)/)',
  ],
};

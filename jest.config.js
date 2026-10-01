module.exports = {
  preset: '@react-native/jest-preset',
  // Mode d'affichage « large » par défaut dans les tests (voir jest.setup.js).
  setupFiles: ['./jest.setup.js'],
  // @noble/hashes et @noble/ciphers sont publiés en modules ES. Jest les lit
  // depuis node_modules, que le preset exclut de la transformation par
  // defaut : sans cette exception, leurs `export` provoquent une erreur de
  // syntaxe. Metro, lui, les gere nativement cote application.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@noble)/)',
  ],
};

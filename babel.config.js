module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // htmlparser2 (moteur Tsuzuku) publie un build ES avec « export * as x from »,
  // que Metro selectionne pour un import ; le preset RN ne le transforme pas.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};

/**
 * Cale pour `codegenNativeComponent`.
 *
 * Plusieurs bibliotheques React Native declarent leurs composants natifs par
 * cet utilitaire, y compris dans le code qu'un navigateur charge. Sur le
 * bureau il n'y a aucun composant natif a enregistrer : la cale rend un
 * composant inerte plutot que de faire echouer la construction.
 */

module.exports = function codegenNativeComponent() {
  return function ComposantNatifAbsent() {
    return null;
  };
};
module.exports.default = module.exports;

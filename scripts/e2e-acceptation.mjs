/**
 * Aide des scripts de bout en bout : à la première connexion de chaque compte, l'application demande
 * d'accepter les documents légaux (écran `acceptation-juridique`). Les scénarios qui ne testent pas ce
 * point l'acceptent automatiquement : la case puis « Continuer » sont cliquées dès que l'écran apparaît.
 * (Le scénario qui le teste, e2e-support-verrou.mjs, n'utilise pas cette aide.)
 */
const SCRIPT = `
(() => {
  const essayer = () => {
    const case_ = document.querySelector('[data-testid="acceptation-case"]');
    const suite = document.querySelector('[data-testid="acceptation-continuer"]');
    if (!case_ || !suite) return;
    if (case_.getAttribute('aria-checked') !== 'true') case_.click();
    else suite.click();
  };
  new MutationObserver(essayer).observe(document, { childList: true, subtree: true, attributes: true });
  setInterval(essayer, 400);
})();
`;

export async function nouveauContexte(navigateur, options) {
  const contexte = await navigateur.newContext(options);
  await contexte.addInitScript(SCRIPT);
  return contexte;
}

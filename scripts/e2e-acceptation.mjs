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
  const contexte = await navigateur.newContext({ locale: 'fr-FR', ...options });
  await contexte.addInitScript(SCRIPT);
  return contexte;
}

/**
 * Les apps réservées (Administration, Abonnements…) sont sur la page « Administration » du hub :
 * onglet en haut sur le bureau, entrée « Admin » de la barre basse sur téléphone.
 */
export const ONGLET_ADMINISTRATION = '[data-testid="hub-page-administration"], [data-testid="barre-basse-administration"]';

export async function allerPageAdministration(page, delai = 30_000) {
  const onglet = page.locator(ONGLET_ADMINISTRATION).first();
  await onglet.waitFor({ timeout: delai });
  await onglet.click();
}

export const ONGLET_APPLICATIONS = '[data-testid="hub-page-publique"], [data-testid="barre-basse-accueil"]';

export async function allerPageApplications(page, delai = 30_000) {
  // Sans page réservée (ami), le hub n'a qu'une page : pas d'onglet à cliquer.
  const onglet = page.locator(ONGLET_APPLICATIONS).first();
  if (await onglet.waitFor({ timeout: Math.min(delai, 3_000) }).then(() => true, () => false)) await onglet.click();
}

/** Tuile d'une app du hub (bureau ou téléphone). */
export const tuileApp = (page, id) => page.locator(`[data-testid="cellule-${id}"], [data-testid="tuile-${id}"]`);

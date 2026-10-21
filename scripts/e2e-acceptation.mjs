/**
 * Aide des scripts de bout en bout : à la première connexion de chaque compte, l'application demande
 * d'accepter les documents légaux (écran `acceptation-juridique`). Les scénarios qui ne testent pas ce
 * point l'acceptent automatiquement : la case puis « Continuer » sont cliquées dès que l'écran apparaît.
 * (Le scénario qui le teste, e2e-support-verrou.mjs, n'utilise pas cette aide.)
 */
export const SCRIPT_PC = `
(() => {
  // PC simulé (relais version 9 : plus de code de liaison dans l'app) : un lien de test \`#liaison=AB1.…\` tient lieu
  // du fichier relais-local.json du PC (jeton maître) ou d'un navigateur déjà relié avant la mise à jour.
  try {
    const m = /liaison=(AB1\\.[A-Za-z0-9_-]+)/.exec(decodeURIComponent(location.hash));
    if (m) {
      const code = m[1];
      const brut = JSON.parse(atob(code.slice(4).replace(/-/g, '+').replace(/_/g, '/')));
      const liaisons = JSON.parse(localStorage.getItem('applibourse.liaisons') || '{"comptes":{}}');
      liaisons.comptes = liaisons.comptes || {};
      if (/^p1\\./.test(brut.j)) liaisons.comptes[brut.j.split('.')[1]] = code;
      else {
        liaisons.maitre = code;
        localStorage.setItem('applibourse.liaison', code);
        // Comme relais-local.json, le jeton maître du PC ne disparaît jamais (« créer un coffre » vide le stockage).
        sessionStorage.setItem('e2e.pc', code);
      }
      localStorage.setItem('applibourse.liaisons', JSON.stringify(liaisons));
      history.replaceState(null, '', location.pathname + location.search);
    }
    const pc = sessionStorage.getItem('e2e.pc');
    if (pc) {
      setInterval(() => {
        if (localStorage.getItem('applibourse.liaison') !== pc) {
          localStorage.setItem('applibourse.liaison', pc);
          const l = JSON.parse(localStorage.getItem('applibourse.liaisons') || '{"comptes":{}}');
          l.maitre = pc;
          localStorage.setItem('applibourse.liaisons', JSON.stringify(l));
        }
      }, 250);
    }
  } catch (e) {
    // Lien de test illisible : rien.
  }
})();
`;

const SCRIPT = `
(() => {
  /* PC simulé : voir SCRIPT_PC */
  const essayer = () => {
    // Migration du Fondateur vers la connexion par identifiant (relais version 9) : reportée (« Plus tard »)
    // dans les scénarios qui ne la testent pas (e2e-synchro-serveur.mjs la garde : e2e.migration = garder).
    const plusTard = document.querySelector('[data-testid="fondateur-plus-tard"]');
    if (plusTard && localStorage.getItem('e2e.migration') !== 'garder' && !document.querySelector('[data-testid="fondateur-connexion-faite"]')) plusTard.click();
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
  await contexte.addInitScript(SCRIPT_PC);
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

/**
 * PC simulé (relais version 9) : le vrai PC trouve le relais et son jeton maître dans relais-local.json
 * (processus principal d'Electron). Dans un navigateur de test, on les pose dans le stockage local comme
 * le ferait un navigateur déjà relié, puis on recharge : l'app se configure seule au déverrouillage.
 */
export async function relierCommePc(page, code) {
  await page.evaluate(c => {
    const liaisons = JSON.parse(localStorage.getItem('applibourse.liaisons') || '{"comptes":{}}');
    liaisons.maitre = c;
    localStorage.setItem('applibourse.liaisons', JSON.stringify(liaisons));
    localStorage.setItem('applibourse.liaison', c);
  }, code);
  await page.reload();
}

/**
 * Relais version 9 : plus de « code de connexion au site » pour un ami. Juste après « Créer » dans
 * l'Administration, le panneau montre le lien d'invitation : on le lit ici (avant « Terminé »).
 */
export async function lienInvitationDuPanneau(page) {
  await page.locator('[data-testid="admin-invitation"], [data-testid="admin-invitation-erreur"], [data-testid="admin-invitation-indisponible"]').first().waitFor({ timeout: 90_000 });
  return (await page.getByTestId('admin-invitation-lien').first().innerText({ timeout: 10_000 })).trim();
}

/** L'ami ouvre son invitation sur un appareil neuf et choisit son mot de passe ; rend quand son hub est affiché. */
export async function accepterInvitationAmi(page, lien, site, motDePasse = 'Une phrase d’ami 2026 !') {
  await page.goto(lien.replace(/^https?:\/\/[^/]+\//, site));
  await page.getByTestId('invitation-mdp').waitFor({ timeout: 90_000 });
  await page.getByTestId('invitation-mdp').fill(motDePasse);
  await page.getByTestId('invitation-mdp-confirmation').fill(motDePasse);
  await page.getByTestId('invitation-valider').click();
  await page.getByTestId('hub').waitFor({ timeout: 120_000 });
  return motDePasse;
}

/**
 * Code d'un navigateur DÉJÀ relié au compte d'un ami avant la version 9 (plus de « code de connexion au site »
 * dans l'app) : le test le calcule comme le faisait le PC (jeton de profil = HMAC du jeton maître).
 */
export async function codeAmiDejaRelie(relais, jetonMaitre, id) {
  const { createHmac } = await import('node:crypto');
  const jeton = `p1.${id}.${createHmac('sha256', jetonMaitre).update(`applibourse-profil-v1|${id}`).digest('hex')}`;
  return 'AB1.' + Buffer.from(JSON.stringify({ r: relais, j: jeton })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Identifiant opaque d'un compte, lu sur sa ligne dans l'Administration (onglet Utilisateurs ouvert). */
export async function idCompteAdmin(page, nom) {
  const ligne = await page.locator('[data-testid^="admin-ligne-"]').filter({ hasText: nom }).first().getAttribute('data-testid');
  return ligne.replace('admin-ligne-', '');
}

/** Reporte (« Plus tard ») la migration du Fondateur vers la connexion par identifiant, pour les scénarios qui ne la testent pas. */
export const SCRIPT_REPORTER_MIGRATION = `setInterval(() => document.querySelector('[data-testid="fondateur-plus-tard"]')?.click(), 400);`;

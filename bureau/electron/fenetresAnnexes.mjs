/**
 * Fenêtres annexes (« Ouvrir dans une nouvelle fenêtre ») : la règle
 * d'ouverture, sans Electron, pour être testée seule.
 *
 * L'interface ouvre `about:blank` sous un nom réservé
 * (`appdashboard-annexe-<app>-<jeton>`) puis y écrit sa propre page : la
 * fenêtre reste dans la même origine et le même processus de rendu que la
 * fenêtre principale, et partage sa session ouverte (aucun second
 * déverrouillage, un seul écrivain sur le disque). Tout le reste est refusé,
 * comme avant : aucune autre adresse ne s'ouvre dans une fenêtre qui porte le
 * préchargement ; les pages web et `mailto:` partent vers le système.
 *
 * Les annexes reçoivent EXACTEMENT les mêmes préférences de sécurité que la
 * fenêtre principale (isolation, bac à sable, pas de Node) et le même
 * préchargement : le même pont limité, rien de plus.
 */

export const MOTIF_ANNEXE = /^appdashboard-annexe-[a-z0-9][a-z0-9-]{0,39}-[a-z0-9]{10,24}$/;

/** Nombre maximal de fenêtres annexes ouvertes en même temps. */
export const MAX_ANNEXES = 8;

/**
 * Que faire d'une demande d'ouverture de fenêtre venue de l'interface ?
 *  - `annexe` : fenêtre annexe autorisée ;
 *  - `externe` : à ouvrir dans le navigateur ou la messagerie du système ;
 *  - `refus` : rien.
 */
export function decisionOuverture({ url, frameName }, annexesOuvertes = 0) {
  const adresse = String(url ?? '');
  const nom = String(frameName ?? '');
  if (adresse === 'about:blank' && MOTIF_ANNEXE.test(nom)) {
    return annexesOuvertes < MAX_ANNEXES ? 'annexe' : 'refus';
  }
  if (/^https?:\/\//i.test(adresse) || /^mailto:[^\s]+$/i.test(adresse)) {
    return 'externe';
  }
  return 'refus';
}

/** Taille d'une annexe : celle demandée par l'interface, bornée. */
export function tailleAnnexe(demande = {}) {
  const nombre = (valeur, defaut) => (Number.isFinite(Number(valeur)) && Number(valeur) > 0 ? Math.round(Number(valeur)) : defaut);
  return {
    width: Math.min(4000, Math.max(720, nombre(demande.width, 1200))),
    height: Math.min(3000, Math.max(560, nombre(demande.height, 860))),
  };
}

/**
 * Options de la fenêtre annexe, à partir de celles de la fenêtre principale.
 * `principales` : les `webPreferences` de la fenêtre principale (préchargement compris).
 */
export function optionsAnnexe({ principales, icone, demande = {} }) {
  const { width, height } = tailleAnnexe(demande);
  const options = {
    width,
    height,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'AppDashboard',
    icon: icone,
    show: true,
    webPreferences: {
      preload: principales.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (Number.isFinite(Number(demande.x)) && Number.isFinite(Number(demande.y))) {
    options.x = Math.round(Number(demande.x));
    options.y = Math.round(Number(demande.y));
  }
  return options;
}

/** Lit la chaîne de `window.open` (« width=1200,height=800,left=10,top=20 »). */
export function lireFonctionnalites(texte) {
  const demande = {};
  for (const morceau of String(texte ?? '').split(',')) {
    const [cle, valeur] = morceau.split('=').map(partie => partie?.trim().toLowerCase());
    const nombre = Number(valeur);
    if (!Number.isFinite(nombre)) continue;
    if (cle === 'width') demande.width = nombre;
    else if (cle === 'height') demande.height = nombre;
    else if (cle === 'left') demande.x = nombre;
    else if (cle === 'top') demande.y = nombre;
  }
  return demande;
}

/**
 * Processus principal de l'application de bureau.
 *
 * C'est le seul endroit qui touche au disque, et c'est voulu : la fenêtre qui
 * affiche l'interface n'a aucun accès au système de fichiers.
 *
 * ## Les trois règles qui tiennent la sécurité
 *
 * **Le rendu est isolé.** `contextIsolation` et `sandbox` actifs,
 * `nodeIntegration` désactivée. Même si une dépendance de l'interface était
 * compromise, elle n'aurait ni `require`, ni `fs`, ni processus.
 *
 * **Le rendu ne nomme jamais un chemin.** Il demande « le portefeuille » ou
 * « le coffre » ; c'est ici qu'un nom logique devient un chemin réel, choisi
 * dans une liste fermée. Sans cela, un `../../` suffirait à lire ou écraser
 * n'importe quel fichier du disque.
 *
 * **Rien ne navigue ailleurs.** Toute tentative d'ouvrir une autre adresse
 * dans la fenêtre est refusée, et les liens externes partent dans le
 * navigateur du système — jamais dans une fenêtre qui porte le préchargement.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { git, preparerInterface, recupererCode } from './interface.mjs';
import { synthetiser, VOIX_NATURELLES } from './voix.mjs';
import { MOTIF_PROFIL, changementPermis, extensionPermise, fichierAutorise, fichierDeProfil } from './portee.mjs';
import { fluxMedia, pageArticle, yahooJson, yahooScreener } from './reseau.mjs';
import { creerListeLecteurs, requeteTsuzuku } from './tsuzuku.mjs';
import { brancherClaudeOffice } from './claudeOfficeIpc.mjs';
import { decisionOuverture, lireFonctionnalites, optionsAnnexe } from './fenetresAnnexes.mjs';
import { readFile, writeFile, mkdir, rename, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));

// Le nom affiché est « AppDashboard », mais les données restent dans l'ancien
// dossier utilisateur « AppliBourse » : renommer le produit ne doit ni les
// perdre ni casser les mises à jour. À fixer avant tout accès à userData.
app.setPath('userData', join(app.getPath('appData'), 'AppliBourse'));

/** Adresse du serveur de développement, absente dans l'application livrée. */
const DEV = process.env.APPLIBOURSE_DEV;

/**
 * Fichiers que le rendu peut demander, par nom logique.
 *
 * Liste fermée : tout nom absent d'ici est refusé. C'est ce qui empêche le
 * rendu de désigner un chemin arbitraire.
 */
const FICHIERS = {
  portefeuille: 'portefeuille.ab',
  coffre: 'coffre.json',
  profils: 'profils.json',
  // Caches de synchronisation du démarrage : enveloppes chiffrées seulement (voir src/sync/relais/caches.ts).
  'synchro-entrant': 'synchro-entrant.json',
  'synchro-sortant': 'synchro-sortant.json',
};

/**
 * Portée du profil ouvert (isolation des comptes, défense en profondeur).
 *
 *  - `undefined` : aucun compte ouvert (écran de connexion, ou interface
 *    antérieure qui ne déclare pas de profil) — rien d'ouvert, rien à cacher ;
 *  - `principal` : l'administrateur, qui gère aussi les fichiers des amis ;
 *  - l'identifiant d'un ami : SES fichiers, et la liste des profils.
 *
 * Quitter la portée d'un ami (`profil:fermer`) recharge la fenêtre : l'état en
 * mémoire du compte (clés, base, caches) disparaît avec la page. La vraie
 * barrière reste cryptographique — chaque coffre est scellé par sa propre
 * clé — ; cette portée empêche en plus qu'un compte ami demande, même par
 * erreur, le fichier d'un autre.
 */
let portee;
/** Comptes que le gestionnaire ouvert a demandé à atteindre (création, régénération). Vidée à chaque changement de compte. */
let etendues = [];


function cheminDe(nom) {
  if (!fichierAutorise(String(nom), portee, etendues)) {
    throw new Error(`Fichier d’un autre compte refusé : ${nom}`);
  }
  const fichier = Object.hasOwn(FICHIERS, nom) ? FICHIERS[nom] : fichierDeProfil(nom);
  if (!fichier) {
    throw new Error(`Fichier inconnu : ${nom}`);
  }
  return join(app.getPath('userData'), 'donnees', fichier);
}

/**
 * Écriture atomique : on écrit à côté, puis on renomme.
 *
 * Un plantage au milieu d'une écriture directe laisserait un portefeuille
 * tronqué — donc indéchiffrable, donc perdu. Le renommage, lui, est atomique
 * sur les systèmes de fichiers usuels.
 */
async function ecrireAtomique(chemin, octets) {
  await mkdir(dirname(chemin), { recursive: true });
  const provisoire = `${chemin}.nouveau`;
  await writeFile(provisoire, octets);
  await rename(provisoire, chemin);
}

function installerPasserelle() {
  ipcMain.handle('fichier:lire', async (_evenement, nom) => {
    const chemin = cheminDe(nom);
    if (!existsSync(chemin)) {
      return undefined;
    }
    const contenu = await readFile(chemin);
    // Un Buffer ne traverse pas proprement la frontiere : on rend des octets.
    return new Uint8Array(contenu);
  });

  ipcMain.handle('fichier:ecrire', async (_evenement, nom, octets) => {
    await ecrireAtomique(cheminDe(nom), Buffer.from(octets));
  });

  ipcMain.handle('profil:ouvrir', async (_evenement, id) => {
    const propre = String(id);
    if (!MOTIF_PROFIL.test(propre)) throw new Error('Profil invalide.');
    // Seul l'administrateur passe directement à un autre compte (accès par séquestre).
    if (!changementPermis(portee, propre, etendues)) {
      throw new Error('Changez de compte avant d’en ouvrir un autre.');
    }
    portee = propre;
    etendues = [];
    return true;
  });

  ipcMain.handle('profil:etendre', async (_evenement, id) => {
    const propre = String(id);
    if (!extensionPermise(portee, propre, etendues)) throw new Error('Portée non étendue : réservé à un gestionnaire ouvert.');
    if (!etendues.includes(propre)) etendues.push(propre);
    return true;
  });

  ipcMain.handle('profil:fermer', async evenement => {
    const avant = portee;
    portee = undefined;
    etendues = [];
    // Rechargement : plus rien du compte précédent ne reste dans la page.
    if (avant !== undefined) setTimeout(() => evenement.sender.reload(), 0);
    return true;
  });

  ipcMain.handle('fichier:existe', async (_evenement, nom) => existsSync(cheminDe(nom)));

  ipcMain.handle('fichier:dossier', async () => join(app.getPath('userData'), 'donnees'));

  // Sauvegardes : un dossier visible dans Documents, que l'on peut copier,
  // synchroniser (OneDrive) ou emporter. La fenêtre ne donne qu'un nom de
  // fichier, vérifié ici : impossible de sortir du dossier.
  // Chaque ami a son sous-dossier : il ne liste ni ne lit les sauvegardes des autres.
  const dossierSauvegardes = () =>
    portee && portee !== 'principal'
      ? join(app.getPath('documents'), 'AppliBourse Sauvegardes', `profil-${portee}`)
      : join(app.getPath('documents'), 'AppliBourse Sauvegardes');
  const cheminSauvegarde = nom => {
    const propre = String(nom);
    if (!/^[A-Za-z0-9._-]+\.sauvegarde\.json$/.test(propre)) {
      throw new Error('Nom de sauvegarde refusé.');
    }
    return join(dossierSauvegardes(), propre);
  };
  ipcMain.handle('sauvegardes:dossier', async () => {
    await mkdir(dossierSauvegardes(), { recursive: true });
    return dossierSauvegardes();
  });
  ipcMain.handle('sauvegardes:lister', async () => {
    await mkdir(dossierSauvegardes(), { recursive: true });
    return (await readdir(dossierSauvegardes())).filter(nom => nom.endsWith('.sauvegarde.json'));
  });
  ipcMain.handle('sauvegardes:existe', async (_evenement, nom) => existsSync(cheminSauvegarde(nom)));
  ipcMain.handle('sauvegardes:lire', async (_evenement, nom) => readFile(cheminSauvegarde(nom), 'utf8'));
  ipcMain.handle('sauvegardes:ecrire', async (_evenement, nom, contenu) => {
    await mkdir(dossierSauvegardes(), { recursive: true });
    await ecrireAtomique(cheminSauvegarde(nom), Buffer.from(String(contenu), 'utf8'));
  });
  ipcMain.handle('sauvegardes:supprimer', async (_evenement, nom) => rm(cheminSauvegarde(nom), { force: true }));
  ipcMain.handle('sauvegardes:ouvrir-dossier', async () => {
    await mkdir(dossierSauvegardes(), { recursive: true });
    return (await shell.openPath(dossierSauvegardes())) === '';
  });

  ipcMain.handle('systeme:theme', async (_evenement, sombre) => {
    nativeTheme.themeSource = sombre ? 'dark' : 'light';
    return true;
  });

  ipcMain.handle('systeme:notifier', async (_evenement, titre, corps, destination, options) => {
    if (!Notification.isSupported()) {
      return false;
    }
    const notification = new Notification({
      title: String(titre),
      body: String(corps),
      // Le logo d'AppDashboard à côté du texte, plutôt qu'une notification anonyme.
      icon: join(ici, '..', 'icone', 'icone-256.png'),
      // Tâches : « son » coupé dans ses réglages de notifications.
      silent: Boolean(options && options.silencieux === true),
    });
    // Un clic sur la notification ramène la fenêtre au premier plan.
    // Le clic ouvre la fenêtre sur la bonne page : la destination est
    // renvoyée à l'interface, qui navigue (après déverrouillage si besoin).
    const cible = typeof destination === 'string' ? destination.slice(0, 120) : '';
    notification.on('click', () => {
      const fenetre = montrerFenetre();
      if (cible) fenetre.webContents.send('notification:ouvrir', cible);
    });
    notification.show();
    return true;
  });

  // Ouverture au démarrage de Windows : sans elle, AppDashboard fermée ne
  // peut envoyer aucun briefing.
  ipcMain.handle('systeme:demarrage', async (_evenement, activer) => {
    if (typeof activer === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: activer, args: ['--demarrage'] });
    }
    return app.getLoginItemSettings({ args: ['--demarrage'] }).openAtLogin;
  });

  // Infobulle de l'icône : la valeur du portefeuille, ou « verrouillée ».
  ipcMain.handle('systeme:infobulle', async (_evenement, texte) => {
    plateau?.setToolTip(String(texte).slice(0, 120));
    return true;
  });

  ipcMain.handle('systeme:plateau', async (_evenement, activer) => {
    if (typeof activer === 'boolean') {
      resterDansPlateau = activer;
      await ecrireReglagesBureau({ ...(await lireReglagesBureau()), resterDansPlateau: activer });
    }
    return resterDansPlateau;
  });

  ipcMain.handle('systeme:ouvrir', async (_evenement, url) => {
    // Seules les adresses web partent au navigateur : un `file:` ou un
    // protocole applicatif ouvrirait autre chose qu'une page.
    const propre = String(url);
    if (!/^https?:\/\//i.test(propre)) {
      return false;
    }
    await shell.openExternal(propre);
    return true;
  });

  ipcMain.handle('systeme:enregistrer-sous', async (_evenement, nomPropose, contenu) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: String(nomPropose),
    });
    if (canceled || !filePath) {
      return false;
    }
    await writeFile(filePath, Buffer.from(contenu));
    return true;
  });

  ipcMain.handle('maj:verifier', async () => verifierMiseAJour());

  ipcMain.handle('maj:installer', async () => lancerMiseAJour());
  ipcMain.handle('maj:chercher', async () => chercherMiseAJour());
  ipcMain.handle('maj:redemarrer', async () => installerPuisRedemarrer());
  ipcMain.handle('relais:config', async () => lireRelaisLocal());

  ipcMain.handle('yahoo:json', async (_evenement, url) => yahooJson(String(url)));

  ipcMain.handle('yahoo:screener', async (_evenement, corps) => yahooScreener(corps));
  ipcMain.handle('medias:flux', async (_evenement, url) => fluxMedia(String(url)));
  ipcMain.handle('medias:page', async (_evenement, url) => pageArticle(String(url)));

  // Tsuzuku : le moteur tourne dans la fenêtre, le réseau passe ici (garde anti-SSRF refaite
  // dans tsuzuku.mjs, redirections rendues au moteur, aucun cookie). Les lecteurs (iframe) ne
  // sont affichables que pour les sites que l'interface a déclarés et que la garde accepte.
  ipcMain.handle('tsuzuku:requete', async (_evenement, requete) => requeteTsuzuku(requete));
  ipcMain.handle('tsuzuku:lecteur', async (_evenement, url) => lecteursTsuzuku.autoriser(url));

  // Claude Office (app du hub) : état du serveur local, hooks de Claude Code sur confirmation native.
  brancherClaudeOffice({
    ipcMain, dialog, BrowserWindow, shell,
    fichierReglages: () => join(app.getPath('userData'), 'claude-office.json'),
    ecrire: ecrireAtomique,
    racineProjet: async () => (await lireVersionBuild())?.dossierSource ?? join(ici, '..', '..'),
  });

  ipcMain.handle('voix:liste', async () => VOIX_NATURELLES);
  ipcMain.handle('voix:synthetiser', async (_evenement, texte, voix, vitesse) =>
    synthetiser(String(texte), String(voix), Number(vitesse) || 1),
  );
}

// ----------------------------------------------------------- Yahoo Finance
//
// Les données fondamentales de Yahoo exigent un cookie de session et un
// jeton (« crumb ») que la fenêtre ne peut pas obtenir : le navigateur
// bloque ces appels entre origines. Le processus principal les fait à sa
// place, sur une liste fermée d'adresses — la fenêtre ne peut pas s'en
// servir pour joindre autre chose. Le code est dans reseau.mjs, partagé
// avec le relais Cloudflare.

// ------------------------------------------------------ Relais Cloudflare
//
// scripts/deployer-relais.mjs écrit relais/relais-local.json dans le dossier
// du projet : adresse du relais, jeton, adresse du site. La fenêtre le lit
// pour se relier sans rien saisir, et afficher le QR code de l'iPhone.

async function lireRelaisLocal() {
  const version = await lireVersionBuild();
  const dossier = version?.dossierSource ?? join(ici, '..', '..');
  try {
    const local = JSON.parse(await readFile(join(dossier, 'relais', 'relais-local.json'), 'utf8'));
    return typeof local.relais === 'string' && typeof local.jeton === 'string'
      ? { relais: local.relais, jeton: local.jeton, site: typeof local.site === 'string' ? local.site : undefined }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Après une mise à jour du code, republie le site de secours en fond, pour
 * qu'il reste au niveau de l'application. Silencieux : un échec (pas de
 * connexion, session Cloudflare expirée) laisse simplement l'ancien site.
 */
async function republierSiteEnFond() {
  const version = await lireVersionBuild();
  const dossier = version?.dossierSource;
  if (!dossier || !(await lireRelaisLocal())?.site) {
    return;
  }
  const enfant = spawn('npm', ['run', 'relais:site'], {
    cwd: dossier,
    shell: process.platform === 'win32',
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  });
  enfant.on('error', () => undefined);
  enfant.unref();
}

// ------------------------------------------------------------ Mises à jour
//
// L'application ne télécharge rien elle-même. Elle connaît le commit qui l'a
// produite et le dossier du projet (gravés par scripts/version-build.mjs) ;
// elle demande à git ce que GitHub a de plus récent, avec les identifiants
// déjà configurés sur le PC — le dépôt est privé, une requête anonyme ne
// verrait rien.

/** Informations gravées à la compilation, absentes en développement. */
async function lireVersionBuild() {
  try {
    return JSON.parse(await readFile(join(ici, 'version-build.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Page d'attente, le temps de récupérer et recompiler l'interface. */
const PAGE_ATTENTE = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;color:#a1a1aa;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">' +
    '<div style="text-align:center"><div style="color:#f4f4f5;font-size:20px;font-weight:700;margin-bottom:8px">AppDashboard</div>Recherche de mises à jour…</div></body>',
)}`;

/** Ce qui s'est passé au lancement, pour le bandeau. */
let lancement = { appliquees: [], moteurPerime: false, nouveautesMoteur: [], erreur: undefined };

async function verifierMiseAJour() {
  if (lancement.moteurPerime) {
    return { etat: 'disponible', nouveautes: lancement.nouveautesMoteur, commit: '' };
  }
  if (lancement.appliquees.length > 0) {
    return { etat: 'appliquee', nouveautes: lancement.appliquees };
  }
  if (lancement.erreur) {
    return { etat: 'erreur', motif: lancement.erreur };
  }
  return { etat: 'a-jour', commit: '' };
}

/**
 * Vérification à la demande, application ouverte : GitHub a-t-il du
 * nouveau depuis le code en service ? Rien n'est appliqué ici.
 */
async function chercherMiseAJour() {
  const version = await lireVersionBuild();
  const dossier = version?.dossierSource;
  if (!dossier || !existsSync(dossier)) {
    return { etat: 'erreur', motif: 'Dossier du projet introuvable : les mises à jour se font par réinstallation.' };
  }
  try {
    await git(dossier, ['fetch', '--quiet', 'origin', 'main'], 30_000);
    // Comparé à la version affichée : une relance a pu récupérer le code sans le charger.
    const local = commitAuLancement ?? (await git(dossier, ['rev-parse', 'HEAD']));
    const distant = await git(dossier, ['rev-parse', 'origin/main']);
    if (local === distant) {
      return { etat: 'a-jour', commit: local.slice(0, 7) };
    }
    const nouveautes = (await git(dossier, ['log', '--format=%s', `${local}..origin/main`])).split('\n').filter(Boolean);
    return { etat: 'disponible', commit: distant.slice(0, 7), nouveautes, echecPrecedent: lancement.erreur };
  } catch (erreur) {
    return { etat: 'erreur', motif: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

/**
 * Appliquer : redémarrer. Au lancement, le lanceur récupère le code et
 * reconstruit l'interface — le même chemin, éprouvé, que chaque matin.
 */
function redemarrerPourMettreAJour({ discret = false } = {}) {
  quitterVraiment = true;
  const args = process.argv.slice(1).filter(argument => argument !== '--demarrage');
  // En fond (fenêtre cachée), l'application revient réduite, comme au démarrage de Windows.
  app.relaunch({ args: discret ? [...args, '--demarrage'] : args });
  // Fermeture normale d'abord, pour que la fenêtre enregistre la base ; puis on force.
  app.quit();
  setTimeout(() => app.exit(0), 5_000);
  return true;
}

/**
 * « Installer et redémarrer » : le code est récupéré ici, fenêtre ouverte,
 * pour que l'échec éventuel s'affiche au lieu de se perdre au redémarrage.
 */
async function installerPuisRedemarrer() {
  const dossier = (await lireVersionBuild())?.dossierSource;
  if (dossier && existsSync(dossier)) {
    try {
      await recupererCode(dossier);
    } catch (erreur) {
      return { ok: false, motif: erreur instanceof Error ? erreur.message : String(erreur) };
    }
  }
  redemarrerPourMettreAJour();
  return { ok: true };
}

// ----------------------------------------- Mises à jour, application ouverte
//
// AppDashboard démarre avec Windows (souvent avant qu'internet soit prêt) et
// reste ensuite près de l'horloge : elle n'est presque jamais « relancée ».
// Sans ce qui suit, les mises à jour, appliquées seulement au lancement,
// n'arriveraient plus. Donc :
//  - relancer l'application alors qu'elle tourne déjà vérifie et, s'il y a du
//    nouveau, redémarre sur la nouvelle version ;
//  - toutes les heures, une vérification en fond : fenêtre cachée, on
//    redémarre discrètement ; fenêtre affichée, une notification propose.

let commitAuLancement;
let derniereProposee;
const INTERVALLE_MAJ_FOND = 60 * 60_000;

async function retenirCommitAuLancement() {
  const dossier = (await lireVersionBuild())?.dossierSource;
  if (dossier && existsSync(dossier)) {
    commitAuLancement = await git(dossier, ['rev-parse', 'HEAD']).catch(() => undefined);
  }
}

/** Vrai si GitHub, ou le dossier du projet, a plus récent que la version affichée. */
async function nouvelleVersionDisponible() {
  const dossier = (await lireVersionBuild())?.dossierSource;
  if (!dossier || !existsSync(dossier) || !commitAuLancement) {
    return undefined;
  }
  await git(dossier, ['fetch', '--quiet', 'origin', 'main'], 30_000);
  const tete = await git(dossier, ['rev-parse', 'HEAD']);
  const distant = await git(dossier, ['rev-parse', 'origin/main']);
  // Une relance a pu récupérer le code sans que cette instance le charge.
  return distant !== commitAuLancement || tete !== commitAuLancement ? distant : undefined;
}

async function verifierEnFond(raison) {
  let disponible;
  try {
    disponible = await nouvelleVersionDisponible();
  } catch {
    return; // Hors ligne : on réessaiera.
  }
  if (!disponible) {
    return;
  }
  const fenetre = principaleVivante();
  const visible = fenetre && fenetre.isVisible() && !fenetre.isMinimized();
  // Mise à jour suspendue par un fichier modifié sur ce PC : redémarrer n'y
  // changerait rien et recommencerait toutes les heures. Le bandeau le dit.
  // (Une simple absence de réseau au démarrage, elle, se rattrape ainsi.)
  if (/modifi/i.test(lancement?.erreur ?? '')) {
    return;
  }
  if (raison === 'relance') {
    redemarrerPourMettreAJour();
  } else if (!visible) {
    redemarrerPourMettreAJour({ discret: true });
  } else if (derniereProposee !== disponible && Notification.isSupported()) {
    derniereProposee = disponible;
    const notification = new Notification({
      title: '🆕 Nouvelle version d’AppDashboard',
      body: 'Cliquez pour l’installer : l’application redémarre en une minute, vos données restent là.',
    });
    notification.on('click', () => redemarrerPourMettreAJour());
    notification.show();
  }
}

function surveillerMisesAJour() {
  // Premier essai deux minutes après le démarrage : le temps qu'internet arrive.
  setTimeout(() => void verifierEnFond('minuterie'), 2 * 60_000);
  setInterval(() => void verifierEnFond('minuterie'), INTERVALLE_MAJ_FOND);
}

async function lancerMiseAJour() {
  const version = await lireVersionBuild();
  if (!version?.dossierSource || !existsSync(version.dossierSource)) {
    return false;
  }

  // Une fenêtre PowerShell visible : la compilation prend quelques minutes
  // et l'utilisateur doit voir qu'elle avance, ou pourquoi elle échoue.
  const enfant = spawn(
    'cmd.exe',
    // Fenêtre réduite : la réinstallation est silencieuse et relance l'appli.
    ['/c', 'start', '/min', 'AppDashboard - mise a jour', 'powershell', '-Command', 'npm run maj-pc'],
    { cwd: version.dossierSource, detached: true, stdio: 'ignore' },
  );
  enfant.unref();

  // L'installeur remplacera l'application : elle doit être fermée d'ici là.
  setTimeout(() => app.quit(), 1500);
  return true;
}

// ------------------------------------------------ Zone de notification
//
// Fermer la fenêtre ne quitte pas : AppDashboard reste près de l'horloge,
// pour que briefings et alertes continuent de partir. « Quitter » dans le
// menu de l'icône arrête vraiment. Le choix se règle dans l'écran Alertes.

let quitterVraiment = false;
let plateau;
let avertiDuPlateau = false;
const FICHIER_BUREAU = () => join(app.getPath('userData'), 'reglages-bureau.json');

async function lireReglagesBureau() {
  try {
    return JSON.parse(await readFile(FICHIER_BUREAU(), 'utf8'));
  } catch {
    return {};
  }
}

async function ecrireReglagesBureau(reglages) {
  await ecrireAtomique(FICHIER_BUREAU(), Buffer.from(JSON.stringify(reglages), 'utf8'));
}

let resterDansPlateau = true;

/**
 * La fenêtre principale. Les fenêtres annexes (« Ouvrir dans une nouvelle
 * fenêtre », voir fenetresAnnexes.mjs) n'en sont jamais : l'icône, les
 * notifications et une seconde instance ramènent toujours celle-ci.
 */
let fenetrePrincipale;
/** Fenêtres annexes ouvertes. */
const annexes = new Set();

function principaleVivante() {
  return fenetrePrincipale && !fenetrePrincipale.isDestroyed() ? fenetrePrincipale : undefined;
}

function montrerFenetre() {
  const fenetre = principaleVivante() ?? creerFenetre();
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
  return fenetre;
}

function creerPlateau() {
  if (plateau) return;
  const image = nativeImage.createFromPath(join(ici, '..', 'icone', process.platform === 'win32' ? 'icone-32.png' : 'icone-16.png'));
  plateau = new Tray(image);
  plateau.setToolTip('AppDashboard');
  plateau.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir AppDashboard', click: montrerFenetre },
      {
        label: 'Vérifier les mises à jour',
        // Ouvre les Paramètres, où se trouve la vérification.
        click: () => montrerFenetre().webContents.send('notification:ouvrir', 'reglages'),
      },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          quitterVraiment = true;
          app.quit();
        },
      },
    ]),
  );
  plateau.on('click', montrerFenetre);
}

/** Sites de lecteur que la fenêtre peut afficher en sous-cadre (voir tsuzuku.mjs). */
const lecteursTsuzuku = creerListeLecteurs();
let filtreSousCadresPose = false;

/** Mêmes gardes que la fenêtre principale : aucune navigation, aucun sous-cadre non déclaré, liens vers le système. */
function protegerAnnexe(enfant) {
  annexes.add(enfant);
  enfant.on('closed', () => annexes.delete(enfant));
  enfant.webContents.on('will-navigate', evenement => evenement.preventDefault());
  enfant.webContents.on('will-frame-navigate', evenement => {
    if (!evenement.isMainFrame && !lecteursTsuzuku.sousCadreAutorise(evenement.url)) {
      evenement.preventDefault();
    }
  });
  // Une annexe n'ouvre pas d'autre fenêtre : seulement des liens, vers le système.
  enfant.webContents.setWindowOpenHandler(({ url }) => {
    if (decisionOuverture({ url, frameName: '' }) === 'externe') {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

function creerFenetre() {
  const fenetre = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    title: 'AppDashboard',
    // L'executable porte deja l'icone ; celle-ci sert a la fenetre et a la
    // barre des taches pendant le developpement.
    icon: join(ici, '..', 'icone', 'icone-256.png'),
    webPreferences: {
      preload: join(ici, 'prechargement.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // La fenetre ne s'affiche qu'une fois peinte : sinon on voit un rectangle
  // blanc puis le theme sombre, ce qui pique les yeux le soir.
  // Lancée au démarrage de Windows, elle attend discrètement près de l'horloge.
  const auDemarrage = process.argv.includes('--demarrage');
  fenetre.once('ready-to-show', () => {
    if (auDemarrage) {
      // Au démarrage de Windows : ouverte mais réduite dans la barre des
      // tâches, sans voler la main à ce que vous ouvrez en même temps.
      fenetre.showInactive();
      fenetre.minimize();
    } else {
      fenetre.show();
    }
  });

  fenetre.on('close', evenement => {
    if (quitterVraiment || !resterDansPlateau || !plateau) return;
    evenement.preventDefault();
    fenetre.hide();
    if (!avertiDuPlateau && Notification.isSupported()) {
      avertiDuPlateau = true;
      new Notification({
        title: 'AppDashboard reste disponible',
        body: 'Elle continue près de l’horloge pour vos briefings et alertes. Clic droit sur l’icône › Quitter pour l’arrêter.',
        icon: join(ici, '..', 'icone', 'icone-256.png'),
      }).show();
    }
  });

  // Aucune navigation hors de l'application, et aucune fenetre fille : les
  // deux porteraient le prechargement.
  fenetre.webContents.on('will-navigate', (evenement, url) => {
    const attendu = DEV ?? 'file://';
    if (!url.startsWith(attendu) && !url.startsWith('data:text/html')) {
      evenement.preventDefault();
    }
  });
  // Sous-cadres (lecteurs de Tsuzuku) : seulement les sites déclarés, y compris après redirection.
  if (!filtreSousCadresPose) {
    filtreSousCadresPose = true;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, rappel) => {
      rappel({ cancel: details.resourceType === 'subFrame' && !lecteursTsuzuku.sousCadreAutorise(details.url) });
    });
  }
  fenetre.webContents.on('will-frame-navigate', evenement => {
    if (!evenement.isMainFrame && !lecteursTsuzuku.sousCadreAutorise(evenement.url)) {
      evenement.preventDefault();
    }
  });
  fenetre.webContents.setWindowOpenHandler(({ url, frameName, features }) => {
    const decision = decisionOuverture({ url, frameName }, annexes.size);
    if (decision === 'annexe') {
      // « Ouvrir dans une nouvelle fenêtre » : même préchargement, mêmes protections (voir fenetresAnnexes.mjs).
      return {
        action: 'allow',
        overrideBrowserWindowOptions: optionsAnnexe({
          principales: { preload: join(ici, 'prechargement.cjs') },
          icone: join(ici, '..', 'icone', 'icone-256.png'),
          demande: lireFonctionnalites(features),
        }),
      };
    }
    // Pages web vers le navigateur ; `mailto:` (bouton « Écrire » de Prospects) vers la messagerie.
    if (decision === 'externe') {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  fenetre.webContents.on('did-create-window', enfant => protegerAnnexe(enfant));
  // Fenêtre principale fermée pour de bon (ou rechargée) : ses annexes, qui vivent de sa session, se ferment.
  fenetre.on('closed', () => {
    for (const annexe of [...annexes]) {
      if (!annexe.isDestroyed()) annexe.close();
    }
  });

  fenetrePrincipale = fenetre;
  if (DEV) {
    void fenetre.loadURL(DEV);
  } else {
    // Page d'attente tout de suite, puis l'interface une fois à jour.
    void fenetre.loadURL(PAGE_ATTENTE);
    void lireVersionBuild()
      .then(version => preparerInterface({
        embarquee: globalThis.interfaceEmbarquee ?? join(ici, '..', 'dist', 'index.html'),
        version,
      }))
      .then(resultat => {
        // Le lanceur a peut-être déjà récupéré du code : on l'ajoute au bilan.
        lancement = {
          ...resultat.lancement,
          appliquees: [...(globalThis.miseAJourAuLancement ?? []), ...resultat.lancement.appliquees],
          erreur: resultat.lancement.erreur ?? globalThis.erreurAuLancement,
        };
        if (lancement.appliquees?.length) {
          void republierSiteEnFond();
        }
        // La version réellement affichée : c'est à elle qu'on compare ensuite.
        void retenirCommitAuLancement();
        return fenetre.loadFile(resultat.chemin);
      });
  }

  return fenetre;
}

// Une seule instance : deux fenetres sur la meme base se reecriraient l'une
// l'autre, et la derniere a ecrire gagnerait en silence.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    montrerFenetre();
    // Relancer, c'est vouloir la dernière version : on vérifie tout de suite.
    void verifierEnFond('relance');
  });
  app.on('before-quit', () => {
    quitterVraiment = true;
  });

  void app.whenReady().then(() => {
    // Pas de menu « File, Edit, View » : il n'a rien à offrir ici. Les
    // raccourcis d'édition (copier, coller) restent gérés par la fenêtre.
    Menu.setApplicationMenu(null);
    // Sans identifiant d'application, Windows n'affiche pas les notifications
    // d'une application installée par NSIS. Même valeur que build.appId.
    if (process.platform === 'win32') {
      app.setAppUserModelId('fr.applibourse.bureau');
    }
    // Barre de titre de Windows en sombre, assortie à l'interface.
    nativeTheme.themeSource = 'dark';
    installerPasserelle();
    void lireReglagesBureau().then(async reglages => {
      resterDansPlateau = reglages.resterDansPlateau !== false;
      // Démarrage avec Windows activé d'office, une seule fois : ensuite,
      // c'est le réglage de l'écran Alertes qui décide.
      if (app.isPackaged && !reglages.demarrageInitialise) {
        app.setLoginItemSettings({ openAtLogin: true, args: ['--demarrage'] });
        await ecrireReglagesBureau({ ...reglages, demarrageInitialise: true });
      }
    });
    creerPlateau();
    creerFenetre();
    if (!DEV) {
      surveillerMisesAJour();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        creerFenetre();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

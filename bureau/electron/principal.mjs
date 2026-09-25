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

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from 'electron';
import { spawn } from 'node:child_process';
import { preparerInterface } from './interface.mjs';
import { synthetiser, VOIX_NATURELLES } from './voix.mjs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));

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
};

function cheminDe(nom) {
  const fichier = FICHIERS[nom];
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

  ipcMain.handle('fichier:existe', async (_evenement, nom) => existsSync(cheminDe(nom)));

  ipcMain.handle('fichier:dossier', async () => join(app.getPath('userData'), 'donnees'));

  ipcMain.handle('systeme:notifier', async (_evenement, titre, corps) => {
    if (!Notification.isSupported()) {
      return false;
    }
    const notification = new Notification({ title: String(titre), body: String(corps) });
    // Un clic sur la notification ramène la fenêtre au premier plan.
    notification.on('click', () => {
      const fenetre = BrowserWindow.getAllWindows()[0];
      if (fenetre) {
        if (fenetre.isMinimized()) fenetre.restore();
        fenetre.show();
        fenetre.focus();
      }
    });
    notification.show();
    return true;
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

  ipcMain.handle('yahoo:json', async (_evenement, url) => yahooJson(String(url)));

  ipcMain.handle('medias:flux', async (_evenement, url) => fluxMedia(String(url)));

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
// servir pour joindre autre chose.

const CHEMINS_YAHOO = [
  '/v10/finance/quoteSummary/',
  '/ws/fundamentals-timeseries/v1/finance/timeseries/',
  '/v8/finance/chart/',
  '/v1/finance/search',
];
const AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

let sessionYahoo;

async function ouvrirSessionYahoo() {
  // Le cookie vient de n'importe quelle page du domaine ; fc.yahoo.com le
  // pose même en répondant 404.
  const reponse = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': AGENT }, redirect: 'manual' });
  const cookies = (reponse.headers.getSetCookie?.() ?? [reponse.headers.get('set-cookie') ?? ''])
    .map(ligne => ligne.split(';')[0])
    .filter(Boolean)
    .join('; ');
  const jeton = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': AGENT, Cookie: cookies },
  });
  const crumb = (await jeton.text()).trim();
  if (!jeton.ok || !crumb || crumb.includes('<')) {
    throw new Error(`Jeton Yahoo refusé (${jeton.status}).`);
  }
  return { cookies, crumb };
}

/**
 * Flux RSS de la revue de presse. Liste fermée, la même que
 * src/podcast/medias.ts : le rendu ne peut pas faire télécharger autre chose.
 */
const FLUX_MEDIAS = new Set([
  'https://services.lesechos.fr/rss/les-echos-finance-marches.xml',
  'https://services.lesechos.fr/rss/les-echos-economie.xml',
  'https://www.lemonde.fr/economie/rss_full.xml',
  'https://www.lefigaro.fr/rss/figaro_economie.xml',
  'https://www.francetvinfo.fr/economie.rss',
  'https://www.bfmtv.com/rss/economie/',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
]);
const TAILLE_MAX_FLUX = 3 * 1024 * 1024;

/** Recherche d'actualités par valeur : seule la requête varie. */
function rechercheActualitesAutorisee(adresse) {
  try {
    const url = new URL(adresse);
    return (
      url.origin === 'https://news.google.com' &&
      url.pathname === '/rss/search' &&
      adresse.length < 400 &&
      [...url.searchParams.keys()].every(cle => ['q', 'hl', 'gl', 'ceid'].includes(cle))
    );
  } catch {
    return false;
  }
}

async function fluxMedia(adresse) {
  if (!FLUX_MEDIAS.has(adresse) && !rechercheActualitesAutorisee(adresse)) {
    throw new Error('Flux non autorisé.');
  }
  const reponse = await fetch(adresse, {
    headers: { 'User-Agent': AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!reponse.ok) {
    throw new Error(`Le flux a répondu ${reponse.status}.`);
  }
  const texte = await reponse.text();
  return texte.length > TAILLE_MAX_FLUX ? texte.slice(0, TAILLE_MAX_FLUX) : texte;
}

async function yahooJson(adresse) {
  const url = new URL(adresse);
  if (
    url.protocol !== 'https:' ||
    !/^query[12]\.finance\.yahoo\.com$/.test(url.hostname) ||
    !CHEMINS_YAHOO.some(chemin => url.pathname.startsWith(chemin))
  ) {
    throw new Error(`Adresse non autorisée : ${url.hostname}${url.pathname}`);
  }

  for (let essai = 0; essai < 2; essai++) {
    if (!sessionYahoo) {
      sessionYahoo = await ouvrirSessionYahoo();
    }
    url.searchParams.set('crumb', sessionYahoo.crumb);
    const reponse = await fetch(url, {
      headers: { 'User-Agent': AGENT, Cookie: sessionYahoo.cookies, Accept: 'application/json' },
    });
    if (reponse.status === 401 || reponse.status === 403) {
      // Jeton expiré : on en redemande un, une fois.
      sessionYahoo = undefined;
      continue;
    }
    if (!reponse.ok) {
      throw new Error(`Yahoo a répondu ${reponse.status}.`);
    }
    return await reponse.json();
  }
  throw new Error('Yahoo refuse l’accès, même avec un nouveau jeton.');
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
    '<div style="text-align:center"><div style="color:#f4f4f5;font-size:20px;font-weight:700;margin-bottom:8px">AppliBourse</div>Recherche de mises à jour…</div></body>',
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
    ['/c', 'start', '/min', 'AppliBourse - mise a jour', 'powershell', '-Command', 'npm run maj-pc'],
    { cwd: version.dossierSource, detached: true, stdio: 'ignore' },
  );
  enfant.unref();

  // L'installeur remplacera l'application : elle doit être fermée d'ici là.
  setTimeout(() => app.quit(), 1500);
  return true;
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
    title: 'AppliBourse',
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
  fenetre.once('ready-to-show', () => fenetre.show());

  // Aucune navigation hors de l'application, et aucune fenetre fille : les
  // deux porteraient le prechargement.
  fenetre.webContents.on('will-navigate', (evenement, url) => {
    const attendu = DEV ?? 'file://';
    if (!url.startsWith(attendu) && !url.startsWith('data:text/html')) {
      evenement.preventDefault();
    }
  });
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

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
    const [existante] = BrowserWindow.getAllWindows();
    if (existante) {
      if (existante.isMinimized()) {
        existante.restore();
      }
      existante.focus();
    }
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
    creerFenetre();

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

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

import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
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
    new Notification({ title: String(titre), body: String(corps) }).show();
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
}

function creerFenetre() {
  const fenetre = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#101319',
    show: false,
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
    if (!url.startsWith(attendu)) {
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
    void fenetre.loadFile(join(ici, '..', 'dist', 'index.html'));
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

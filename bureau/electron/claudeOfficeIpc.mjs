/**
 * Pont de Claude Office (processus principal) : ce que l'écran Claude Office
 * du hub peut demander sur le PC.
 *
 * Règles de sécurité :
 *  - la fenêtre ne donne JAMAIS de chemin : le dossier de Claude Office est
 *    choisi dans une boîte de dialogue native (ou trouvé à côté du projet) et
 *    gardé ici, dans `claude-office.json` des données de l'application ;
 *  - l'adresse du serveur est limitée à cette machine (127.0.0.1, localhost) ;
 *  - les hooks ne s'écrivent qu'après une confirmation NATIVE qui montre
 *    exactement le fichier et les changements : un rendu compromis ne peut
 *    pas la contourner, et rien ne s'installe tout seul ;
 *  - l'interface de Claude Office s'ouvre dans une fenêtre à part, sans
 *    préchargement (aucun accès au pont), bornée à son adresse.
 *
 * Les modules Electron sont injectés : ce fichier ne les importe pas.
 */

import { readFile } from 'node:fs/promises';
import {
  adresseLocale, appliquerHooks, decrirePlan, dossierValide, lireReglagesOffice, planifierHooks, sonderServeur, trouverDossier,
} from './claudeOffice.mjs';

/** Aperçu sans le texte complet des réglages (il peut contenir des secrets d'autres outils). */
function resume(plan) {
  return {
    fichier: plan.fichier,
    existe: plan.existe,
    commande: plan.commande,
    change: plan.change,
    ajouts: plan.ajouts.map(a => a.evenement),
    retraits: plan.retraits.map(r => r.evenement),
    description: decrirePlan(plan),
  };
}

export function brancherClaudeOffice({ ipcMain, dialog, BrowserWindow, shell, fichierReglages, ecrire, racineProjet }) {
  const lire = async () => lireReglagesOffice(await readFile(fichierReglages(), 'utf8').catch(() => '{}'));
  const enregistrer = async reglages => ecrire(fichierReglages(), Buffer.from(JSON.stringify(reglages), 'utf8'));
  const dossierDe = async reglages => trouverDossier({ enregistre: reglages.dossier, racineProjet: await racineProjet() });

  ipcMain.handle('claude-office:etat', async () => {
    const reglages = await lire();
    const dossier = await dossierDe(reglages);
    let hooks;
    if (dossier) {
      try {
        hooks = planifierHooks({ dossier }).change ? 'absents' : 'installes';
      } catch {
        hooks = 'illisibles';
      }
    }
    return { url: reglages.url, dossier: dossier ?? null, hooks: hooks ?? 'inconnus', serveur: await sonderServeur(reglages.url) };
  });

  ipcMain.handle('claude-office:choisir-dossier', async evenement => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(evenement.sender), {
      title: 'Dossier de Claude Office',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths[0]) {
      return { ok: false };
    }
    if (!dossierValide(filePaths[0])) {
      return { ok: false, erreur: 'Ce dossier ne contient pas Claude Office (hooks/agent-tracker.mjs).' };
    }
    await enregistrer({ ...(await lire()), dossier: filePaths[0] });
    return { ok: true, dossier: filePaths[0] };
  });

  ipcMain.handle('claude-office:regler-url', async (_evenement, url) => {
    try {
      const propre = adresseLocale(url);
      await enregistrer({ ...(await lire()), url: propre });
      return { ok: true, url: propre };
    } catch (erreur) {
      return { ok: false, erreur: erreur.message };
    }
  });

  ipcMain.handle('claude-office:apercu-hooks', async (_evenement, desinstaller) => {
    try {
      const dossier = await dossierDe(await lire());
      return { ok: true, plan: resume(planifierHooks({ dossier, desinstaller: desinstaller === true })) };
    } catch (erreur) {
      return { ok: false, erreur: erreur.message };
    }
  });

  ipcMain.handle('claude-office:installer-hooks', async (evenement, desinstaller) => {
    try {
      const dossier = await dossierDe(await lire());
      // Le plan est recalculé ICI : la fenêtre ne choisit ni le fichier ni la commande.
      const plan = planifierHooks({ dossier, desinstaller: desinstaller === true });
      if (!plan.change) {
        return { ok: true, ecrit: false, plan: resume(plan) };
      }
      const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(evenement.sender), {
        type: 'warning',
        title: 'Claude Office',
        message: desinstaller ? 'Retirer les hooks de Claude Office des réglages de Claude Code ?' : 'Installer les hooks de Claude Office dans les réglages de Claude Code ?',
        detail: decrirePlan(plan),
        buttons: ['Annuler', desinstaller ? 'Retirer' : 'Modifier settings.json'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response !== 1) {
        return { ok: false, annule: true };
      }
      const { sauvegarde } = appliquerHooks(plan);
      return { ok: true, ecrit: true, sauvegarde, plan: resume(plan) };
    } catch (erreur) {
      return { ok: false, erreur: erreur.message };
    }
  });

  ipcMain.handle('claude-office:ouvrir', async () => {
    const { url } = await lire();
    const origine = adresseLocale(url);
    const fenetre = new BrowserWindow({
      width: 1400,
      height: 880,
      title: 'Claude Office',
      autoHideMenuBar: true,
      backgroundColor: '#0a0a0f',
      // Pas de préchargement : cette fenêtre n'a aucun accès au pont d'AppDashboard.
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    fenetre.webContents.on('will-navigate', (ev, cible) => {
      if (!String(cible).startsWith(`${origine}/`) && cible !== origine) ev.preventDefault();
    });
    fenetre.webContents.setWindowOpenHandler(({ url: cible }) => {
      if (/^https?:\/\//i.test(cible) && !String(cible).startsWith(origine)) void shell.openExternal(cible);
      return { action: 'deny' };
    });
    await fenetre.loadURL(origine);
    return true;
  });
}

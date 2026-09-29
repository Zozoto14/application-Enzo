/**
 * Point d'entrée de l'application installée : un lanceur qui ne change pas.
 *
 * Tout le reste — le processus principal, le préchargement, l'interface — est
 * chargé depuis le dossier du projet, après avoir récupéré le code de
 * GitHub. Une modification du moteur s'applique donc au lancement suivant,
 * comme une modification d'écran, sans réinstaller.
 *
 * Ce fichier, lui, est figé dans l'exécutable : il doit rester minuscule et
 * ne dépendre de rien qui puisse évoluer. En cas de problème — dossier
 * déplacé, code illisible — il retombe sur le moteur embarqué.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recupererCode } from './interface.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

async function dossierDuProjet() {
  if (process.env.APPLIBOURSE_DEV) {
    return undefined;
  }
  try {
    const version = JSON.parse(await readFile(join(ici, 'version-build.json'), 'utf8'));
    const principal = join(version.dossierSource ?? '', 'bureau', 'electron', 'principal.mjs');
    return version.dossierSource && existsSync(principal) ? version.dossierSource : undefined;
  } catch {
    return undefined;
  }
}

// L'interface embarquée reste le dernier recours, même si le moteur vient du projet.
globalThis.interfaceEmbarquee = join(ici, '..', 'dist', 'index.html');

const dossier = await dossierDuProjet();
let charge = false;

if (dossier) {
  try {
    // Le code d'abord, pour charger le moteur le plus récent. Les titres des
    // nouveautés sont transmis au moteur, qui les affichera.
    globalThis.miseAJourAuLancement = await recupererCode(dossier);
  } catch (erreur) {
    globalThis.erreurAuLancement = erreur instanceof Error ? erreur.message : String(erreur);
  }
  try {
    await import(pathToFileURL(join(dossier, 'bureau', 'electron', 'principal.mjs')).href);
    charge = true;
  } catch (erreur) {
    console.error('Moteur du projet illisible, retour au moteur embarqué :', erreur);
  }
}

if (!charge) {
  await import('./principal.mjs');
}

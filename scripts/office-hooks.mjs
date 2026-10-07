#!/usr/bin/env node
/**
 * `npm run office:hooks` : branche Claude Office sur Claude Code, sans surprise.
 *
 * Remplace `node hooks/install-hooks.mjs` de Claude Office (qui écrit tout de
 * suite dans ~/.claude/settings.json ET ~/.gemini/settings.json) par :
 *   1. un aperçu exact de ce qui changera ;
 *   2. une confirmation (taper « oui ») ;
 *   3. une sauvegarde horodatée, puis l'écriture.
 * Relancer ne change rien si tout est déjà en place.
 *
 * Usage (depuis le dossier du projet) :
 *   npm run office:hooks -- --dossier "C:\chemin\vers\Claude Office"
 *   npm run office:hooks -- --a-blanc        aperçu seul (alias --dry-run)
 *   npm run office:hooks -- --desinstaller   retire les hooks de Claude Office
 *   npm run office:hooks -- --gemini         Gemini CLI au lieu de Claude Code
 *   npm run office:hooks -- --settings <fichier>  autre fichier de réglages
 *   npm run office:hooks -- --oui            sans question (déconseillé)
 *
 * Le dossier peut aussi venir de CLAUDE_OFFICE_DIR ; à défaut, il est cherché
 * à côté du projet (« Claude Office », « claude-office »…).
 */

import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appliquerHooks, decrirePlan, planifierHooks, trouverDossier } from '../bureau/electron/claudeOffice.mjs';

const racineProjet = join(dirname(fileURLToPath(import.meta.url)), '..');

export function lireArguments(argv) {
  const options = { aBlanc: false, desinstaller: false, oui: false, cible: 'claude', dossier: undefined, fichier: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--a-blanc' || a === '--dry-run') options.aBlanc = true;
    else if (a === '--desinstaller' || a === '--uninstall') options.desinstaller = true;
    else if (a === '--oui' || a === '--yes') options.oui = true;
    else if (a === '--gemini') options.cible = 'gemini';
    else if (a === '--dossier') options.dossier = argv[++i];
    else if (a.startsWith('--dossier=')) options.dossier = a.slice('--dossier='.length);
    else if (a === '--settings') options.fichier = argv[++i];
    else if (a === '--aide' || a === '--help' || a === '-h') options.aide = true;
    else throw new Error(`Option inconnue : ${a} (voir --aide)`);
  }
  return options;
}

async function principal() {
  const options = lireArguments(process.argv.slice(2));
  if (options.aide) {
    console.log('npm run office:hooks -- [--dossier "<Claude Office>"] [--a-blanc] [--desinstaller] [--gemini] [--settings <fichier>] [--oui]');
    return 0;
  }
  const dossier = trouverDossier({ argument: options.dossier, racineProjet });
  if (options.dossier && !dossier) {
    throw new Error(`Claude Office introuvable dans « ${options.dossier} » (il faut hooks/agent-tracker.mjs).`);
  }
  if (dossier) console.log(`Claude Office : ${dossier}`);
  const plan = planifierHooks({ dossier, cible: options.cible, desinstaller: options.desinstaller, fichier: options.fichier });
  console.log(decrirePlan(plan));
  if (!plan.change) return 0;
  if (options.aBlanc) {
    console.log('\nÀ blanc : rien n’a été écrit. Relancez sans --a-blanc pour appliquer.');
    return 0;
  }
  if (!options.oui) {
    if (!process.stdin.isTTY) {
      throw new Error('Confirmation impossible sans terminal : relancez dans un terminal, ou avec --oui.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const reponse = (await rl.question(`\nÉcrire ces changements dans ${plan.fichier} ? Tapez « oui » pour confirmer : `)).trim().toLowerCase();
    rl.close();
    if (reponse !== 'oui' && reponse !== 'o') {
      console.log('Annulé : rien n’a été modifié.');
      return 1;
    }
  }
  const resultat = appliquerHooks(plan);
  if (resultat.sauvegarde) console.log(`Sauvegarde : ${resultat.sauvegarde}`);
  console.log(`${options.desinstaller ? 'Hooks retirés de' : 'Hooks installés dans'} ${plan.fichier}. Redémarrez Claude Code pour qu’il les lise.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  principal().then(
    code => process.exit(code),
    erreur => {
      console.error(`Erreur : ${erreur.message}`);
      process.exit(2);
    },
  );
}

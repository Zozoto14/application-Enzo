/**
 * Claude Office, côté PC : hooks de Claude Code et serveur local.
 *
 * Claude Office (https://github.com/W17ANT/agent-office, fourche
 * Zozoto14/Claude-Office-Multi) est un bureau en pixel art qui montre les
 * agents de Claude Code au travail. Il tourne À PART, sur le PC : un serveur
 * Express + WebSocket sur 127.0.0.1:3334, une interface React, et un « hook »
 * de Claude Code (`hooks/agent-tracker.mjs`) qui lui envoie les événements.
 *
 * Ce module reprend la logique de son `hooks/install-hooks.mjs` (même format
 * d'entrée, mêmes événements) en la rendant sûre :
 *
 *  - **aperçu d'abord** : `planifierHooks` calcule le fichier résultant sans
 *    rien écrire ; l'écriture (`appliquerHooks`) est une étape séparée, que
 *    l'utilisateur confirme (ligne de commande ou boîte de dialogue native) ;
 *  - **sauvegarde horodatée** du fichier avant chaque écriture (l'original
 *    écrasait toujours la même `settings.json.office-backup`) ;
 *  - **idempotent** : déjà installé à l'identique → rien n'est écrit ;
 *  - **refus si le fichier a changé** entre l'aperçu et l'écriture, ou s'il
 *    n'est pas du JSON valide (rien n'est écrasé) ;
 *  - écriture atomique (fichier voisin puis renommage) ;
 *  - Claude Code seul par défaut ; Gemini CLI seulement sur demande ;
 *  - seules les entrées dont la commande lance `agent-tracker.mjs`/`.sh`
 *    sont remplacées ou retirées ; les autres hooks ne sont jamais touchés ;
 *  - aucun chemin en dur : le dossier de Claude Office est donné (argument,
 *    variable `CLAUDE_OFFICE_DIR`, réglage du PC) ou cherché à côté du projet.
 *
 * Aucune dépendance à Electron : utilisé par le processus principal
 * (`principal.mjs`) et par `npm run office:hooks` (`scripts/office-hooks.mjs`),
 * testé seul (`claudeOffice.test.mjs`).
 *
 * D'après Claude Office, Copyright (c) 2026 W17ANT, licence MIT
 * (texte complet : docs/claude-office-LICENSE.txt).
 */

import { existsSync, readFileSync, renameSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EVENEMENTS_HISTORIQUE } from './officeHistorique.mjs';

/** Adresse du serveur de Claude Office par défaut (son `server/index.js`). */
export const URL_DEFAUT = 'http://127.0.0.1:3334';

/** Événements écoutés, repris de `hooks/install-hooks.mjs` de Claude Office. */
export const EVENEMENTS = {
  claude: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd', 'Stop', 'SubagentStop'],
  gemini: ['BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'SessionStart', 'SessionEnd'],
};

/** Script appelé par le hook, relatif au dossier de Claude Office. */
export const TRACKER = join('hooks', 'agent-tracker.mjs');

/** Une commande de hook posée par Claude Office (version .mjs ou ancienne .sh). */
export function estCommandeOffice(commande) {
  return /agent-tracker\.(mjs|sh)\b/.test(String(commande ?? ''));
}

/** Barres obliques partout : la commande reste lisible et identique d'un système à l'autre. */
const barres = chemin => String(chemin).split('\\').join('/');

/** Commande posée dans `settings.json`, au même format que l'original. */
export function commandeHook(dossier, cible = 'claude') {
  return `node "${barres(resolve(dossier, TRACKER))}" ${cible}`;
}

/** Fichier de réglages visé : `CLAUDE_CONFIG_DIR` s'il est donné (Claude Code le respecte), sinon le dossier personnel. */
export function fichierReglages(cible = 'claude', env = process.env, maison = homedir()) {
  if (cible === 'claude' && env.CLAUDE_CONFIG_DIR) {
    return join(env.CLAUDE_CONFIG_DIR, 'settings.json');
  }
  return join(maison, cible === 'gemini' ? '.gemini' : '.claude', 'settings.json');
}

/** Le dossier contient-il bien Claude Office (son script de hook) ? */
export function dossierValide(dossier) {
  return typeof dossier === 'string' && dossier.trim() !== '' && existsSync(resolve(dossier, TRACKER));
}

/**
 * Dossier de Claude Office : le premier valide parmi l'argument, la variable
 * `CLAUDE_OFFICE_DIR`, le réglage enregistré, puis quelques emplacements
 * usuels autour du projet (« Claude Office » dans le dossier du projet ou à
 * côté). Rien n'est imposé : sans dossier valide, on le dit.
 */
export function trouverDossier({ argument, env = process.env, enregistre, racineProjet } = {}) {
  const candidats = [argument, env.CLAUDE_OFFICE_DIR, enregistre];
  if (racineProjet) {
    for (const nom of ['Claude Office', 'claude-office', 'Claude-Office-Multi', 'Claude-Office']) {
      candidats.push(join(racineProjet, nom), join(racineProjet, '..', nom));
    }
  }
  const valide = candidats.find(dossierValide);
  return valide ? resolve(valide) : undefined;
}

/** Sans le BOM qu'ajoutent certains éditeurs Windows. */
const sansBom = texte => (texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte);

/** Lit le JSON des réglages ; lève (sans rien écrire) s'il est illisible. */
export function lireJson(texte, fichier = 'settings.json') {
  if (texte === undefined || texte === null || sansBom(texte).trim() === '') {
    return {};
  }
  let json;
  try {
    json = JSON.parse(sansBom(texte));
  } catch (erreur) {
    throw new Error(`${fichier} n’est pas du JSON valide (${erreur.message}) : corrigez-le d’abord, rien n’a été modifié.`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`${fichier} ne contient pas un objet JSON : rien n’a été modifié.`);
  }
  return json;
}

/**
 * Fusion pure : rend une copie des réglages avec (ou sans) le hook de Claude
 * Office sur chaque événement, et la liste des changements.
 */
export function fusionnerHooks(reglages, { commande, cible = 'claude', desinstaller = false, evenements = EVENEMENTS[cible], estNotre = estCommandeOffice }) {
  const json = structuredClone(reglages);
  const ajouts = [];
  const retraits = [];
  const hooks = json.hooks && typeof json.hooks === 'object' && !Array.isArray(json.hooks) ? json.hooks : {};
  // À la désinstallation, on retire aussi d'un événement qui n'est plus dans la liste.
  const tous = desinstaller ? [...new Set([...evenements, ...Object.keys(hooks)])] : evenements;
  for (const evenement of tous) {
    const groupes = Array.isArray(hooks[evenement]) ? hooks[evenement] : [];
    const office = groupes.flatMap(g => (Array.isArray(g?.hooks) ? g.hooks : []).filter(h => estNotre(h?.command)));
    const dejaBon =
      !desinstaller &&
      office.length === 1 &&
      office[0].command === commande &&
      groupes.some(g => g?.matcher === '*' && g.hooks?.length === 1 && g.hooks[0] === office[0]);
    if (dejaBon) {
      continue;
    }
    for (const h of office) {
      retraits.push({ evenement, commande: String(h.command) });
    }
    const restants = groupes
      .map(g => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter(h => !estNotre(h?.command)) } : g))
      .filter(g => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
    if (!desinstaller) {
      restants.push({ matcher: '*', hooks: [{ type: 'command', command: commande }] });
      ajouts.push({ evenement, commande });
    }
    if (restants.length) {
      hooks[evenement] = restants;
    } else if (evenement in hooks) {
      delete hooks[evenement];
    }
  }
  if (Object.keys(hooks).length || json.hooks !== undefined) {
    json.hooks = hooks;
  }
  if (cible === 'gemini' && !desinstaller && json.hooksConfig?.enabled !== true) {
    json.hooksConfig = { ...(json.hooksConfig ?? {}), enabled: true };
  }
  return { json, ajouts, retraits };
}

/**
 * Aperçu, sans rien écrire : ce que deviendrait le fichier de réglages.
 * `change` faux = déjà dans l'état voulu (idempotence).
 */
export function planifierHooks({ dossier, cible = 'claude', desinstaller = false, fichier, lire = f => (existsSync(f) ? readFileSync(f, 'utf8') : undefined) }) {
  if (!EVENEMENTS[cible]) {
    throw new Error(`Cible inconnue : ${cible} (claude ou gemini).`);
  }
  if (!desinstaller && !dossierValide(dossier)) {
    throw new Error(
      dossier
        ? `Claude Office introuvable dans « ${dossier} » (il faut ${barres(TRACKER)}).`
        : 'Dossier de Claude Office inconnu : donnez-le avec --dossier "<chemin>" ou CLAUDE_OFFICE_DIR.',
    );
  }
  const cheminFichier = fichier ?? fichierReglages(cible);
  const avantTexte = lire(cheminFichier);
  const avant = lireJson(avantTexte, cheminFichier);
  const commande = dossier ? commandeHook(dossier, cible) : '';
  const { json, ajouts, retraits } = fusionnerHooks(avant, { commande, cible, desinstaller });
  const change = JSON.stringify(json) !== JSON.stringify(avant);
  return {
    cible,
    desinstaller,
    fichier: cheminFichier,
    existe: avantTexte !== undefined,
    commande,
    ajouts,
    retraits,
    change,
    avantTexte: avantTexte ?? null,
    apresTexte: `${JSON.stringify(json, null, 2)}\n`,
  };
}

/** Texte lisible d'un aperçu (ligne de commande et boîte de confirmation). */
export function decrirePlan(plan) {
  const lignes = [`Fichier : ${plan.fichier}${plan.existe ? '' : ' (sera créé)'}`];
  if (!plan.change) {
    lignes.push(plan.desinstaller ? 'Aucun hook Claude Office à retirer : rien à faire.' : 'Hooks déjà installés à l’identique : rien à faire.');
    return lignes.join('\n');
  }
  for (const partie of plan.parties ?? [plan]) {
    if (plan.parties) lignes.push(`[${partie.titre}]`);
    if (partie.commande) {
      lignes.push(`Commande lancée par Claude Code à chaque événement : ${partie.commande}`);
    }
    for (const r of partie.retraits) {
      lignes.push(`  - ${r.evenement} : retire ${r.commande}`);
    }
    for (const a of partie.ajouts) {
      lignes.push(`  + ${a.evenement} : ajoute (matcher "*")`);
    }
  }
  if (plan.cible === 'gemini' && !plan.desinstaller) {
    lignes.push('  + hooksConfig.enabled = true');
  }
  lignes.push(plan.existe ? 'Une copie de sauvegarde horodatée sera faite avant l’écriture.' : '');
  return lignes.filter(Boolean).join('\n');
}

/** Horodatage sans caractère interdit dans un nom de fichier Windows. */
export const horodatage = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');

/**
 * Écrit le plan, après l'avoir confirmé. Refuse si le fichier a changé depuis
 * l'aperçu. Sauvegarde d'abord (copie horodatée), puis écriture atomique.
 */
export function appliquerHooks(plan, { maintenant = new Date() } = {}) {
  if (!plan.change) {
    return { ecrit: false, sauvegarde: null };
  }
  const actuel = existsSync(plan.fichier) ? readFileSync(plan.fichier, 'utf8') : null;
  if (actuel !== plan.avantTexte) {
    throw new Error(`${plan.fichier} a changé depuis l’aperçu : relancez l’aperçu, rien n’a été modifié.`);
  }
  mkdirSync(dirname(plan.fichier), { recursive: true });
  let sauvegarde = null;
  if (actuel !== null) {
    sauvegarde = `${plan.fichier}.claude-office-${horodatage(maintenant)}.bak`;
    copyFileSync(plan.fichier, sauvegarde);
  }
  if (plan.apresTexte !== plan.avantTexte) {
    const provisoire = `${plan.fichier}.claude-office-nouveau`;
    writeFileSync(provisoire, plan.apresTexte);
    renameSync(provisoire, plan.fichier);
  }
  return { ecrit: true, sauvegarde };
}

// ------------------------------------------------------------ serveur local

const HOTES_LOCAUX = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Adresse du serveur de Claude Office, normalisée — ou une erreur. Seulement
 * http(s) sur cette machine (127.0.0.1, localhost, ::1), sans identifiants :
 * le processus principal ne doit pas servir à joindre autre chose.
 */
export function adresseLocale(texte) {
  let url;
  try {
    url = new URL(String(texte ?? '').trim());
  } catch {
    throw new Error('Adresse invalide : par exemple http://127.0.0.1:3334');
  }
  if (!/^https?:$/.test(url.protocol) || !HOTES_LOCAUX.has(url.hostname) || url.username || url.password) {
    throw new Error('Claude Office tourne sur ce PC : l’adresse doit être http://127.0.0.1:<port> ou http://localhost:<port>.');
  }
  return url.origin;
}

/** Interroge `/health` du serveur ; ne lève jamais. */
export async function sonderServeur(adresse, { delaiMs = 1500, recuperer = fetch } = {}) {
  let origine;
  try {
    origine = adresseLocale(adresse);
  } catch (erreur) {
    return { joignable: false, erreur: erreur.message };
  }
  try {
    const reponse = await recuperer(`${origine}/health`, { signal: AbortSignal.timeout(delaiMs) });
    if (!reponse.ok) {
      return { joignable: false, erreur: `Réponse ${reponse.status}` };
    }
    const corps = await reponse.json().catch(() => ({}));
    return {
      joignable: corps?.status === 'ok',
      agents: Number.isFinite(corps?.agents) ? corps.agents : undefined,
      clients: Number.isFinite(corps?.clients) ? corps.clients : undefined,
    };
  } catch {
    return { joignable: false, erreur: 'Serveur injoignable' };
  }
}

/** Réglages du PC (dossier, adresse), lus de façon tolérante. */
export function lireReglagesOffice(texte) {
  try {
    const o = JSON.parse(texte ?? '{}');
    let url = URL_DEFAUT;
    try {
      url = adresseLocale(o.url);
    } catch {
      // Valeur absente ou retouchée : l'adresse par défaut.
    }
    return { dossier: typeof o.dossier === 'string' && o.dossier ? o.dossier : undefined, url };
  } catch {
    return { dossier: undefined, url: URL_DEFAUT };
  }
}

// ------------------------------------------------------------ hooks d'historique

/** Script du hook d'historique local, relatif au dossier d'AppDashboard. */
export const SCRIPT_HISTORIQUE = join('scripts', 'office-historique-hook.mjs');
export { EVENEMENTS_HISTORIQUE };
export const estCommandeHistorique = commande => /office-historique-hook\.mjs\b/.test(String(commande ?? ''));
export const commandeHistorique = racineProjet => `node "${barres(resolve(racineProjet, SCRIPT_HISTORIQUE))}"`;

/** Plan d'un hook (autre que Claude Office) sur des réglages déjà lus. */
function planSur({ fichier, avantTexte, commande, desinstaller, evenements, estNotre, titre }) {
  const avant = lireJson(avantTexte, fichier);
  const { json, ajouts, retraits } = fusionnerHooks(avant, { commande, desinstaller, evenements, estNotre });
  const change = JSON.stringify(json) !== JSON.stringify(avant);
  return { titre, cible: 'claude', desinstaller, fichier, existe: avantTexte !== undefined && avantTexte !== null, commande: desinstaller ? '' : commande, ajouts, retraits, change, avantTexte: avantTexte ?? null, apresTexte: change ? `${JSON.stringify(json, null, 2)}\n` : avantTexte ?? `${JSON.stringify(json, null, 2)}\n` };
}

const lireSiExiste = f => (existsSync(f) ? readFileSync(f, 'utf8') : undefined);

/** Hook d'historique local (journal sur ce PC), dans les réglages de Claude Code de l'utilisateur. */
export function planifierHistorique({ racineProjet, desinstaller = false, fichier, lire = lireSiExiste }) {
  const script = racineProjet ? resolve(racineProjet, SCRIPT_HISTORIQUE) : undefined;
  if (!desinstaller && !(script && existsSync(script))) {
    throw new Error('Script du hook d’historique introuvable (scripts/office-historique-hook.mjs) : lancez depuis le dossier d’AppDashboard.');
  }
  const chemin = fichier ?? fichierReglages('claude');
  return planSur({
    fichier: chemin, avantTexte: lire(chemin), commande: script ? commandeHistorique(racineProjet) : '', desinstaller,
    evenements: EVENEMENTS_HISTORIQUE, estNotre: estCommandeHistorique, titre: 'Historique (journal local)',
  });
}

/**
 * Plusieurs plans sur le MÊME fichier, appliqués l'un après l'autre : une
 * seule sauvegarde, une seule écriture. `fabriques` reçoit le texte courant.
 */
export function enchainerPlans(fichier, fabriques, { lire = lireSiExiste } = {}) {
  const avantTexte = lire(fichier);
  let courant = avantTexte;
  const parties = [];
  for (const fabrique of fabriques) {
    const plan = fabrique(() => courant);
    parties.push(plan);
    if (plan.change) courant = plan.apresTexte;
  }
  const change = parties.some(p => p.change);
  return {
    cible: 'claude',
    desinstaller: parties.every(p => p.desinstaller),
    fichier,
    existe: avantTexte !== undefined,
    commande: parties.map(p => p.commande).filter(Boolean).join(' ; '),
    ajouts: parties.flatMap(p => p.ajouts),
    retraits: parties.flatMap(p => p.retraits),
    parties: parties.filter(p => p.change),
    change,
    avantTexte: avantTexte ?? null,
    apresTexte: courant ?? '{}\n',
  };
}

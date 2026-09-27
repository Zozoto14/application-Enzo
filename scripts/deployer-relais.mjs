#!/usr/bin/env node
/**
 * Installe (ou met à jour) le relais Cloudflare et le site de secours.
 *
 *   npm run relais:deployer      tout : relais + site (à lancer une fois)
 *   npm run relais:site          seulement le site (après une mise à jour)
 *
 * Ce que fait le script, sur un compte Cloudflare gratuit :
 *  1. connexion à Cloudflare (le navigateur s'ouvre la première fois) ;
 *  2. création de la boîte aux lettres (un espace KV) ;
 *  3. déploiement du relais (relais/worker.mjs) et tirage de son jeton ;
 *  4. compilation du site et publication sur Cloudflare Pages ;
 *  5. écriture de relais/relais-local.json, que l'application du PC lit
 *     pour se relier toute seule et afficher le QR code de l'iPhone.
 *
 * Rien de ce qui est créé ici n'est envoyé sur GitHub : relais-local.json et
 * wrangler.local.toml sont ignorés par git. Relancer le script ne recrée
 * rien : il reprend la boîte, le jeton et le site déjà en place.
 */

import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dossierRelais = resolve(racine, 'relais');
const fichierLocal = resolve(dossierRelais, 'relais-local.json');
const configLocale = resolve(dossierRelais, 'wrangler.local.toml');
// Chemin passé à wrangler : relatif au projet (dossier courant), et donc sans
// les espaces du chemin complet (« Agent IA », « Logiciel de … ») que le
// shell de Windows couperait en plusieurs arguments.
const CONFIG_WRANGLER = 'relais/wrangler.local.toml';
const siteSeulement = process.argv.includes('--site');
const WRANGLER = ['--yes', 'wrangler@4'];

const lireLocal = () => (existsSync(fichierLocal) ? JSON.parse(readFileSync(fichierLocal, 'utf8')) : {});
const ecrireLocal = donnees => writeFileSync(fichierLocal, `${JSON.stringify(donnees, null, 2)}\n`);

/** Lance une commande, affiche sa sortie et la renvoie. */
function lancer(commande, args, { entree, silencieux = false, tolerer = false } = {}) {
  return new Promise((resoudre, rejeter) => {
    const enfant = spawn(commande, args, {
      cwd: racine,
      shell: process.platform === 'win32',
      stdio: [entree === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    });
    let sortie = '';
    const collecter = flux => chunk => {
      sortie += chunk;
      if (!silencieux) flux.write(chunk);
    };
    enfant.stdout.on('data', collecter(process.stdout));
    enfant.stderr.on('data', collecter(process.stderr));
    if (entree !== undefined) {
      enfant.stdin.end(entree);
    }
    enfant.on('close', code =>
      code === 0 || tolerer ? resoudre(sortie) : rejeter(new Error(`${commande} ${args.join(' ')} a échoué (${code}).`)),
    );
  });
}

const wrangler = (args, options) => lancer('npx', [...WRANGLER, ...args], options);

function etape(texte) {
  console.log(`\n━━ ${texte}`);
}

async function connexion() {
  etape('Connexion à Cloudflare');
  const qui = await wrangler(['whoami'], { silencieux: true, tolerer: true });
  if (/not authenticated|You are not/i.test(qui) || !/@|account/i.test(qui)) {
    console.log('Le navigateur va s’ouvrir : connectez-vous à Cloudflare et acceptez.');
    await wrangler(['login']);
  } else {
    console.log('Déjà connecté.');
  }
}

async function deployerRelais(local) {
  etape('Boîte aux lettres');
  if (!local.kv) {
    const sortie = await wrangler(['kv', 'namespace', 'create', 'applibourse-boite']);
    const id = /id\s*=\s*"([0-9a-f]{32})"/.exec(sortie)?.[1] ?? /"id":\s*"([0-9a-f]{32})"/.exec(sortie)?.[1];
    if (!id) {
      throw new Error('Identifiant de la boîte introuvable dans la réponse de Cloudflare.');
    }
    local.kv = id;
    ecrireLocal(local);
  } else {
    console.log('Déjà créée.');
  }
  const modele = readFileSync(resolve(dossierRelais, 'wrangler.toml'), 'utf8');
  writeFileSync(configLocale, modele.replace('A_REMPLIR_PAR_LE_SCRIPT', local.kv));

  etape('Relais');
  const sortie = await wrangler(['deploy', '--config', CONFIG_WRANGLER]);
  const adresse = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(sortie)?.[0];
  if (adresse) {
    local.relais = adresse;
  }
  if (!local.relais) {
    throw new Error('Adresse du relais introuvable. Sur dash.cloudflare.com › Workers, activez le sous-domaine workers.dev puis relancez.');
  }
  if (!local.jeton) {
    local.jeton = randomBytes(24).toString('base64url');
    etape('Jeton du relais');
    await wrangler(['secret', 'put', 'JETON', '--config', CONFIG_WRANGLER], { entree: `${local.jeton}\n` });
  }
  ecrireLocal(local);
}

async function publierSite(local) {
  etape('Compilation du site de secours');
  await lancer('npx', ['vite', 'build', '--outDir', '../site-dist', '--emptyOutDir']);

  await joindreMiseAJourIphone(local);

  etape('Publication du site');
  if (!local.projetPages) {
    local.projetPages = `applibourse-${randomBytes(3).toString('hex')}`;
    const creation = await wrangler(['pages', 'project', 'create', local.projetPages, '--production-branch', 'main'], {
      tolerer: true,
    });
    const adresse = /https:\/\/[a-z0-9-]+\.pages\.dev/.exec(creation)?.[0];
    if (adresse) {
      local.site = adresse;
    }
    ecrireLocal(local);
  }
  const sortie = await wrangler([
    'pages', 'deploy', 'site-dist', '--project-name', local.projetPages, '--branch', 'main', '--commit-dirty=true',
  ]);
  if (!local.site) {
    // L'adresse de production est celle du déploiement, sans son préfixe.
    const deploiement = /https:\/\/[a-z0-9]+\.([a-z0-9-]+\.pages\.dev)/.exec(sortie);
    if (deploiement) {
      local.site = `https://${deploiement[1]}`;
    }
  }
  ecrireLocal(local);
}

/**
 * Paquet JavaScript signé pour l'app iPhone, publié avec le site : l'app le
 * télécharge seule et n'a besoin d'AltStore que pour le code natif. Refait
 * seulement quand le code a changé ; sans clé de signature, on passe.
 */
async function joindreMiseAJourIphone(local) {
  if (!existsSync(resolve(racine, 'cle-maj-privee.txt'))) {
    console.log('\n(Pas de clé de signature des mises à jour : l’app iPhone ne se mettra à jour que par AltStore.)');
    return;
  }
  const git = args => execFileSync('git', args, { cwd: racine, encoding: 'utf8' }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (commit !== local.majCommit || !existsSync(resolve(racine, 'maj', 'main.jsbundle'))) {
    etape('Mise à jour de l’app iPhone');
    const notes = git(['log', '-1', '--format=%s']).replace(/"/g, '');
    await lancer('node', ['scripts/publier-maj.mjs', '--notes', process.platform === 'win32' ? `"${notes}"` : notes]);
    local.majCommit = commit;
    ecrireLocal(local);
  }
  mkdirSync(resolve(racine, 'site-dist', 'maj'), { recursive: true });
  for (const nom of ['main.jsbundle', 'manifeste.json']) {
    copyFileSync(resolve(racine, 'maj', nom), resolve(racine, 'site-dist', 'maj', nom));
  }
}

try {
  const local = lireLocal();
  await connexion();
  if (!siteSeulement) {
    await deployerRelais(local);
  }
  await publierSite(local);

  etape('Terminé');
  console.log(`Relais : ${local.relais ?? '?'}`);
  console.log(`Site de secours : ${local.site ?? '?'}`);
  console.log('\nOuvrez AppliBourse sur le PC › Paramètres › Synchronisation : le relais est reconnu tout seul.');
  console.log('Choisissez le mot de passe de synchronisation, puis scannez le QR code avec l’iPhone.');
} catch (erreur) {
  console.error(`\n✖ ${erreur instanceof Error ? erreur.message : erreur}`);
  process.exit(1);
}

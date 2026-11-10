/**
 * Journal des serveurs Node dans un fichier à eux : ~/logs/relais.log et ~/logs/esport.log.
 *
 * Pourquoi : chez o2switch (cPanel récent, CloudLinux), « Setup Node.js App » n'a plus de champ « Passenger log
 * file » et la sortie de Passenger n'arrive nulle part de lisible. Chaque serveur recopie donc lui-même, dès son
 * démarrage, console.log / info / warn / error (et les erreurs non rattrapées) dans son fichier :
 *
 *   2026-11-10T12:00:00.123Z INFO  [relais] démarrage : version abc1234, Node 22.12.0, pid 4242, …
 *
 * Lire : `tail -n 50 ~/logs/relais.log` (Terminal de cPanel). Réglages (relais.env / esport.env) :
 *   JOURNAL_FICHIER=/chemin/vers/fichier.log   autre emplacement
 *   JOURNAL_DESACTIVE=1                        ne rien écrire (la console reste inchangée)
 * Rotation par taille : 5 Mo par fichier, 3 fichiers (relais.log, relais.log.1, relais.log.2).
 *
 * Aucun secret au journal : chaque ligne passe par `masquerJournal` (valeurs des variables sensibles de
 * l'environnement, jetons, URL de base de données, webhooks Discord, adresses e-mail masquées « l***@e***.fr »).
 * Écriture synchrone (appendFileSync) : la dernière ligne avant un plantage est bien écrite ; le débit des journaux
 * d'un serveur reste faible. Une erreur d'écriture (disque plein, droits) ne casse jamais le serveur.
 */

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';

export const TAILLE_MAX_JOURNAL = 5 * 1024 * 1024;
export const FICHIERS_JOURNAL = 3;

/** Variables dont la VALEUR ne doit jamais apparaître (comparaison exacte, en plus des motifs). */
const NOM_SENSIBLE = /PASS|TOKEN|JETON|SECRET|CLE|KEY|DATABASE_URL|WEBHOOK|SESSION|PRIVATE|AUTH/i;

/** Valeurs sensibles de l'environnement (6 caractères au moins), des plus longues aux plus courtes. */
export function valeursSensibles(env = process.env) {
  return [
    ...new Set(
      Object.entries(env)
        .filter(([k, v]) => NOM_SENSIBLE.test(k) && typeof v === 'string' && v.length >= 6 && !/^(true|false|oui|non|production|development|\d+)$/i.test(v) && !/(_SOCK|_DIR|_DOSSIER|_FICHIER|_FILE|_PATH)$/.test(k))
        .map(([, v]) => v),
    ),
  ].sort((a, b) => b.length - a.length);
}

const MOTIFS_JOURNAL = [
  // Webhooks Discord (le jeton est dans l'URL).
  [/(discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/)[A-Za-z0-9_-]+/gi, '$1***'],
  // Jetons de bot Discord (trois morceaux en base 64 séparés par des points).
  [/\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g, '***'],
  // Jetons de profil du relais (p1.…).
  [/\bp1\.[A-Za-z0-9._~+/=-]{10,}/g, 'p1.***'],
  // Adresses e-mail : première lettre et domaine de premier niveau seulement.
  [/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9.-]*\.([A-Za-z]{2,24})\b/g, '$1***@$2***.$3'],
  // Identifiants dans une URL, URL de base de données, en-têtes d'autorisation, jetons GitHub.
  [/(https?:\/\/)[^\s/@]+@/gi, '$1***@'],
  [/\b(postgres(?:ql)?|mysql|redis):\/\/\S+/gi, '$1://***'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, '$1***'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, '$1 ***'],
  // « NOM_SENSIBLE=valeur » ou « mot de passe : valeur ».
  [/\b([A-Z0-9_]*(?:PASS|TOKEN|JETON|SECRET|CLE_|_KEY|API_KEY|DATABASE_URL)[A-Z0-9_]*)\s*[=:]\s*\S+/g, '$1=***'],
  [/\b(mot de passe|password|passwd)\s*[=:]\s*\S+/gi, '$1=***'],
  // Longues suites aléatoires sans « / » ni « . » (clés), sauf les commits de 40 caractères : les chemins restent lisibles.
  [/\b(?![0-9a-f]{40}\b)[A-Za-z0-9+_=-]{48,}/g, '***'],
];

/** Une ligne prête pour le fichier : secrets connus et motifs masqués. */
export function masquerJournal(texte, secrets = []) {
  let l = String(texte);
  for (const s of secrets) if (s && l.includes(s)) l = l.split(s).join('***');
  for (const [motif, remplacement] of MOTIFS_JOURNAL) l = l.replace(motif, remplacement);
  return l;
}

const NIVEAUX = { log: 'INFO ', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

/**
 * Écrivain de fichier avec rotation par taille. Rend { ecrire(niveau, texte), fichier } ; ne lève jamais.
 */
export function creerFichierJournal({ fichier, tailleMax = TAILLE_MAX_JOURNAL, fichiers = FICHIERS_JOURNAL, secrets = [], maintenant = Date.now } = {}) {
  let taille;
  let enPanne = false;
  const tourner = () => {
    for (let i = fichiers - 1; i >= 1; i--) {
      const de = i === 1 ? fichier : `${fichier}.${i - 1}`;
      try {
        if (i === fichiers - 1) rmSync(`${fichier}.${i}`, { force: true });
        renameSync(de, `${fichier}.${i}`);
      } catch {
        // fichier absent : rien à décaler
      }
    }
    taille = 0;
  };
  return {
    fichier,
    ecrire(niveau, texte) {
      if (enPanne) return;
      try {
        if (taille === undefined) {
          mkdirSync(dirname(fichier), { recursive: true });
          try {
            taille = statSync(fichier).size;
          } catch {
            taille = 0;
          }
        }
        const ligne = `${new Date(maintenant()).toISOString()} ${NIVEAUX[niveau] ?? 'INFO '} ${masquerJournal(texte, secrets)}\n`;
        const octets = Buffer.byteLength(ligne);
        if (taille > 0 && taille + octets > tailleMax) tourner();
        appendFileSync(fichier, ligne, { mode: 0o600 });
        taille += octets;
      } catch {
        // Disque plein, droits : le serveur continue (la console reste).
        enPanne = true;
      }
    },
  };
}

/** Fichier du journal d'une app : JOURNAL_FICHIER, sinon ~/logs/<app>.log. */
export const fichierJournalParDefaut = (app, env = process.env) => (env.JOURNAL_FICHIER || '').trim() || join(env.HOME || homedir(), 'logs', `${app}.log`);

/**
 * Recopie la console (et les erreurs non rattrapées) dans le fichier de l'app. À appeler une fois, au démarrage,
 * APRÈS la lecture de relais.env / esport.env (réglages et valeurs à masquer). Rend `{ fichier, ecrire, retirer }`,
 * ou null si JOURNAL_DESACTIVE=1. `cible` (console) et `processus` (process) : injectables (tests).
 */
export function installerJournal({ app, env = process.env, cible = console, processus = process, ...options } = {}) {
  if (/^(1|oui|true|yes)$/i.test(String(env.JOURNAL_DESACTIVE ?? '').trim())) return null;
  const f = creerFichierJournal({ fichier: fichierJournalParDefaut(app, env), secrets: valeursSensibles(env), ...options });
  const originaux = {};
  for (const niveau of Object.keys(NIVEAUX)) {
    originaux[niveau] = cible[niveau];
    cible[niveau] = (...args) => {
      originaux[niveau]?.apply(cible, args);
      f.ecrire(niveau, format(...args));
    };
  }
  // « Monitor » : noté sans changer le comportement de Node (le processus s'arrête comme avant ; Passenger relance).
  const surException = (e, origine) => f.ecrire('error', `[${app}] erreur non rattrapée (${origine ?? 'exception'}) : ${format(e)}`);
  // Promesse rejetée sans gestionnaire : notée, et le serveur continue (un seul envoi raté ne coupe pas tout le monde).
  const surRejet = raison => f.ecrire('error', `[${app}] promesse rejetée non gérée : ${format(raison)}`);
  const surSortie = code => f.ecrire(code ? 'error' : 'log', `[${app}] arrêt du processus (code ${code})`);
  const surSignal = signal => {
    f.ecrire('log', `[${app}] signal ${signal} reçu : arrêt`);
    processus.exit?.(0);
  };
  processus.on('uncaughtExceptionMonitor', surException);
  processus.on('unhandledRejection', surRejet);
  processus.on('exit', surSortie);
  processus.on('SIGTERM', surSignal);
  processus.on('SIGINT', surSignal);
  return {
    fichier: f.fichier,
    ecrire: f.ecrire,
    retirer() {
      for (const [niveau, fn] of Object.entries(originaux)) cible[niveau] = fn;
      processus.off('uncaughtExceptionMonitor', surException);
      processus.off('unhandledRejection', surRejet);
      processus.off('exit', surSortie);
      processus.off('SIGTERM', surSignal);
      processus.off('SIGINT', surSignal);
    },
  };
}

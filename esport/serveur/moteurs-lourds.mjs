/**
 * Coordination des MOTEURS LOURDS du compte : whisper.cpp (transcription) et llama-server (IA locale).
 *
 * L'IA locale tient déjà un verrou de compte (~/.appdashboard/ia-locale/etat/serveur.json, gestionnaire.mjs) :
 * un seul moteur d'IA à la fois, BAIL horodaté (battement), propriétaire décrit (espace de pid, démarrage).
 * Quand la mémoire du compte ne permet pas les deux moteurs ensemble (TRANSCRIPTION_EXCLUSIF=auto, voir
 * `besoinExclusif`), la transcription prend CE MÊME verrou, au même format (rôle « transcription », sans port
 * ni clé), le temps de chaque bloc d'audio : c'est la FILE D'ATTENTE COMMUNE. Le gestionnaire de l'IA locale
 * attend son tour (l'app répond « IA locale occupée » au-delà de quelques secondes, le processus de fond de
 * l'IA attend), et réciproquement. Entre deux blocs, le verrou est rendu : une demande de l'IA passe.
 *
 * Le nettoyage des orphelins du gestionnaire reste sûr : un verrou de transcription n'a ni port ni moteur
 * lancé avec la clé de l'IA ; il est seulement retiré quand son bail a expiré (processus mort).
 */

import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cheminsIaLocale } from './ia-locale/installation.mjs';
import { BATTEMENT_MS, nettoyerOrphelinIaLocale, verrouActif } from './ia-locale/gestionnaire.mjs';
import { descriptionProcessus, limitesMemoire, noterIaLocale } from './ia-locale/processus.mjs';

const MIO = 1024 * 1024;
const attendre = ms => new Promise(ok => setTimeout(ok, ms));

/**
 * Faut-il que whisper.cpp et l'IA locale ne tournent JAMAIS en même temps ? `exclusif` : « oui », « non » ou
 * « auto » : oui si la mémoire du compte (TRANSCRIPTION_RAM_COMPTE, sinon la limite lisible d'ici) est inconnue,
 * ou si les deux moteurs plus une marge de 1,5 Go dépassent 85 % de cette mémoire.
 */
export function besoinExclusif({ exclusif = 'auto', ramCompte = null, memoireWhisperMo = 2000, memoireIaMo = 6144, limite = undefined } = {}) {
  if (exclusif === 'oui') return true;
  if (exclusif === 'non') return false;
  const total = ramCompte ?? (limite === undefined ? limitesMemoire().limiteOctets : limite);
  if (!total) return true;
  return (memoireWhisperMo + memoireIaMo + 1536) * MIO > total * 0.85;
}

const lire = chemin => {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
};

function ecrireAtomique(chemin, contenu) {
  const tmp = `${chemin}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, contenu, { mode: 0o600 });
  renameSync(tmp, chemin);
}

/**
 * Prend le verrou de compte des moteurs lourds (celui de l'IA locale) pour la transcription. Attend au plus
 * `attenteMs` qu'il se libère (l'IA locale s'arrête après 1 à 5 min sans requête). Rend `{ liberer(), noterPid(pid) }`
 * ou null si le verrou est resté tenu (le travail sera repris plus tard, sans essai compté).
 */
export async function prendreJetonLourd({ dossierIa, role = 'transcription', attenteMs = 10 * 60_000, maintenant = () => Date.now(), dormir = attendre, journal = null, systeme = {} } = {}) {
  const c = cheminsIaLocale(dossierIa);
  mkdirSync(c.etat, { recursive: true, mode: 0o700 });
  const jeton = randomBytes(8).toString('hex');
  const ici = descriptionProcessus();
  const iso = () => new Date(maintenant()).toISOString();
  const limite = maintenant() + attenteMs;
  let note = false;
  for (;;) {
    try {
      const fd = openSync(c.verrouServeur, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ proprietaire: process.pid, role, ns: ici.ns, boot: ici.boot, debutProprietaire: ici.debut, jeton, pid: null, port: null, demarreLe: iso(), majLe: iso() }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
    const v = lire(c.verrouServeur);
    if (!verrouActif(v, maintenant(), systeme)) {
      // Bail expiré : verrou retiré (moteur orphelin arrêté s'il est identifié) ; sinon (moteur encore en
      // marche hors de portée, propriétaire suspendu) on attend comme pour un verrou tenu.
      const n = await nettoyerOrphelinIaLocale({ dossier: c.dossier, maintenant: maintenant(), journal, role, systeme });
      if (n.nettoye || n.raison === 'aucun' || n.raison === 'remplace') continue;
    }
    if (!note) {
      note = true;
      noterIaLocale(journal, `transcription : moteur d’IA occupé (${v?.role ?? 'autre processus'}), attente de son arrêt (file commune).`, role);
    }
    if (maintenant() >= limite) return null;
    await dormir(2000);
  }
  const maj = patch => {
    const v = lire(c.verrouServeur);
    if (v?.jeton !== jeton) return;
    ecrireAtomique(c.verrouServeur, JSON.stringify({ ...v, ...patch, majLe: iso() }));
  };
  const battement = setInterval(() => {
    try {
      maj({});
    } catch {
      // Disque plein : le battement suivant réessaiera.
    }
  }, Math.min(BATTEMENT_MS, 30_000));
  battement.unref?.();
  return {
    noterPid: pid => maj({ moteurTranscription: pid ?? null }),
    liberer() {
      clearInterval(battement);
      if (lire(c.verrouServeur)?.jeton === jeton) rmSync(c.verrouServeur, { force: true });
    },
  };
}

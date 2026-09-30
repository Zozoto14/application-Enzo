/**
 * Fichiers d'un compte d'ami sur le relais : `coffre-<id>` et
 * `portefeuille-<id>`, tels qu'ils sont sur le disque — le coffre ne contient
 * que des enveloppes, le portefeuille est scellé par la clé maîtresse de
 * l'ami. Rien n'est déchiffré ni rechiffré en route : l'administrateur ne
 * lit pas plus le portefeuille d'un ami sur le relais que sur son PC.
 *
 * Fusion au niveau du fichier, « dernier gagnant » : on retient l'empreinte
 * et la date du dernier échange. Un fichier changé ici part ; un fichier plus
 * récent là-bas arrive, sauf si celui d'ici a changé après lui. Faute de
 * suivi (premier échange sur cet appareil), c'est le relais qui l'emporte :
 * un navigateur qu'on relie reprend ce qui existe.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { chargeEnOctets, octetsEnCharge, type Espaces } from './espaces';
import { DATE_INCONNUE } from './fusionLww';

export interface EtatFichier {
  /** Empreinte du contenu au dernier échange. */
  h?: string;
  /** Date du dépôt échangé (celle du relais). */
  date?: string;
  /** Premier constat d'un changement ici, pas encore parti. */
  changeLe?: string;
}
export type EtatFichiers = Record<string, EtatFichier>;

export interface StockageOctets {
  lire(nom: string): Promise<Uint8Array | undefined>;
  ecrire(nom: string, octets: Uint8Array): Promise<void>;
}

export const empreinteOctets = (octets: Uint8Array): string => bytesToHex(sha256(octets)).slice(0, 32);

export interface OptionsFichier {
  espaces: Espaces;
  /** Espace du compte (`p/<id>/`). */
  compte: string;
  /** Nom de l'objet dans l'espace : `coffre` ou `portefeuille`. */
  objet: 'coffre' | 'portefeuille';
  /** Nom du fichier local (`coffre-<id>`…). */
  fichier: string;
  stockage: StockageOctets;
  etat: EtatFichiers;
  maintenant: string;
  /** Date du dépôt distant (liste de l'espace), si on la connaît déjà. */
  dateDistante?: string | null;
  /** Faux pour un fichier ouvert ici (session en cours) : on n'écrase pas ce qui est en mémoire. */
  tirer?: boolean;
  /** Faux pour ne jamais envoyer (lecture seule). */
  pousser?: boolean;
}

export interface IssueFichier {
  etat: EtatFichiers;
  recu: boolean;
  envoye: boolean;
}

export async function synchroniserFichier(o: OptionsFichier): Promise<IssueFichier> {
  const { espaces, compte, objet, fichier, stockage, maintenant } = o;
  const etat = { ...o.etat };
  const suivi: EtatFichier = { ...(etat[fichier] ?? {}) };
  const local = await stockage.lire(fichier);
  const present = local && local.length > 0 ? local : undefined;
  const hLocal = present ? empreinteOctets(present) : undefined;
  if (hLocal && hLocal !== suivi.h && !suivi.changeLe) {
    suivi.changeLe = suivi.h === undefined ? DATE_INCONNUE : maintenant;
  }
  const changeIci = hLocal !== undefined && hLocal !== suivi.h;
  if (!changeIci) delete suivi.changeLe;
  let dateDistante = o.dateDistante;
  if (dateDistante === undefined) {
    dateDistante = (await espaces.lister(compte))[objet]?.date ?? null;
  }
  const nouveauLaBas = Boolean(dateDistante) && dateDistante! > (suivi.date ?? '');

  if (nouveauLaBas && o.tirer !== false && (!changeIci || (suivi.changeLe ?? DATE_INCONNUE) < dateDistante!)) {
    const recu = await espaces.lire(compte, objet);
    if (recu) {
      const octets = chargeEnOctets(recu.charge);
      if (octets.length > 0 && empreinteOctets(octets) !== hLocal) {
        await stockage.ecrire(fichier, octets);
      }
      etat[fichier] = { h: empreinteOctets(octets), date: recu.date };
      return { etat, recu: true, envoye: false };
    }
  }
  if (changeIci && present && o.pousser !== false) {
    // Toujours postérieure au dépôt distant : sinon les autres appareils ne la verraient pas plus récente.
    let date = maintenant;
    if (dateDistante && date <= dateDistante) date = new Date(Date.parse(dateDistante) + 1).toISOString();
    await espaces.deposer(compte, objet, octetsEnCharge(present), date);
    etat[fichier] = { h: hLocal, date };
    return { etat, recu: false, envoye: true };
  }
  etat[fichier] = suivi;
  return { etat, recu: false, envoye: false };
}

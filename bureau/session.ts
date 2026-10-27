/**
 * Construction de la session, sur le bureau.
 *
 * Pendant de `src/app/fabrique.ts`, qui fait le même travail avec op-sqlite
 * sur l'appareil. Les deux séparent la même chose :
 *
 *  - le **coffre**, en clair, qui ne contient que des enveloppes ;
 *  - le **portefeuille**, scellé par la clé maîtresse.
 *
 * Le coffre ne peut pas vivre dans le fichier scellé : il faut le lire pour
 * obtenir la clé qui l'ouvre. Il n'est pas secret pour autant — ses
 * enveloppes sont inexploitables sans le mot de passe ni un code de
 * récupération.
 *
 * ## Le point délicat : synchrone contre asynchrone
 *
 * `Session` lit et écrit le coffre **de façon synchrone**, et ouvre la base
 * de même. Or sur un bureau, tout accès disque est asynchrone.
 *
 * La sortie tient en une phrase : **on charge tout avant**. sql.js est
 * initialisé, le coffre et le fichier scellé sont lus, puis la session
 * travaille en mémoire. Le descellement, lui, est synchrone — c'est du calcul.
 * Les écritures repartent vers le disque en arrière-plan.
 */

import { ErreurBaseIllisible, Session, type OptionsOuvertureBase } from '../src/session/session';
import type { Coffre } from '../src/securite/coffre';
import type { ParametresKdf } from '../src/securite/kdf';
import { ErreurScelleCle, descellerOctets, scellerOctets } from '../src/securite/scelle';
import type { StockageCoffre } from '../src/session/stockage-coffre';
import { ouvrirBaseSqlJs, type FabriqueSqlJs, type PiloteMemoire } from '../src/db/pilotes/sqljs';
import type { PiloteSqlite, ValeurSql } from '../src/db/pilote';
import type { NomFichier, Stockage } from './stockage';
import { ID_PRINCIPAL, fichiersDuProfil } from '../src/profils/profils';

/** Délai avant d'écrire sur le disque après une modification. */
export const DELAI_ECRITURE = 400;

const encodeur = new TextEncoder();
const decodeur = new TextDecoder();

/** Convertit une clé hexadécimale en octets. */
function octetsDepuisHexa(hexa: string): Uint8Array {
  const octets = new Uint8Array(hexa.length / 2);
  for (let index = 0; index < octets.length; index++) {
    octets[index] = Number.parseInt(hexa.slice(index * 2, index * 2 + 2), 16);
  }
  return octets;
}

export interface SessionBureau {
  session: Session;
  /** Où les données sont rangées, à afficher à l'utilisateur. */
  emplacement: string;
  /** Vrai quand les fichiers vivent réellement sur le disque. */
  surDisque: boolean;
  /** Force l'écriture de ce qui reste en attente. */
  vider(): Promise<void>;
}

export interface OptionsSessionBureau {
  fabrique: FabriqueSqlJs;
  stockage: Stockage;
  /** Signale une écriture impossible : silencieuse, elle perdrait des données. */
  surErreur?(erreur: unknown): void;
  delaiEcriture?: number;
  /** Profil à ouvrir ; le principal par défaut. */
  profil?: string;
  /**
   * Appelé juste avant d'ouvrir la base, donc après un mot de passe et un
   * code justes : lève pour refuser l'ouverture (compte désactivé, expiré).
   * Seul le titulaire apprend ainsi l'état de son compte.
   */
  verifierOuverture?(): void;
  /** Coffres du même compte publiés ailleurs (relais), essayés si le coffre local refuse le mot de passe. */
  coffresAlternatifs?(): readonly Coffre[];
  /** Paramètres de dérivation des coffres créés ici (tests). */
  kdf?: ParametresKdf;
  /**
   * Autres copies scellées du portefeuille de ce compte (celle du relais, quand celle d'ici a
   * changé depuis le dernier échange), essayées si celle d'ici ne s'ouvre pas avec la clé du
   * coffre : adoptée seulement si ELLE s'ouvre (même clé, donc authentique).
   */
  portefeuillesAlternatifs?(): ReadonlyArray<Uint8Array | undefined>;
}

function memesOctets(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((octet, index) => octet === b[index]);
}

/**
 * Prépare la session : lit ce qu'il faut, puis rend une session synchrone.
 *
 * À appeler une fois au démarrage, avant d'afficher quoi que ce soit.
 */
export async function ouvrirSessionBureau(
  options: OptionsSessionBureau,
): Promise<SessionBureau> {
  const { fabrique, stockage } = options;
  const delai = options.delaiEcriture ?? DELAI_ECRITURE;
  const signaler = options.surErreur ?? (() => undefined);

  const fichiers = fichiersDuProfil(options.profil ?? ID_PRINCIPAL) as { coffre: NomFichier; portefeuille: NomFichier };
  const coffreBrut = await stockage.lire(fichiers.coffre);
  let scelle = await stockage.lire(fichiers.portefeuille);
  const emplacement = await stockage.emplacement();

  // --- Coffre : lu maintenant, tenu en memoire, reecrit a chaque changement.

  let coffre: Coffre | undefined;
  if (coffreBrut && coffreBrut.length > 0) {
    try {
      coffre = JSON.parse(decodeur.decode(coffreBrut)) as Coffre;
    } catch {
      // Un coffre illisible n'est pas un coffre absent : ecraser ici
      // detruirait les enveloppes, donc l'acces au portefeuille.
      throw new Error(
        'Le coffre de clés est illisible. Restaurez une sauvegarde plutôt que de continuer : le recréer rendrait le portefeuille définitivement inaccessible.',
      );
    }
  }

  const stockageCoffre: StockageCoffre = {
    lire: () => coffre,
    ecrire: nouveau => {
      coffre = nouveau;
      void stockage
        .ecrire(fichiers.coffre, encodeur.encode(JSON.stringify(nouveau)))
        .catch(signaler);
    },
    effacer: () => {
      coffre = undefined;
      void stockage.ecrire(fichiers.coffre, new Uint8Array(0)).catch(signaler);
    },
  };

  // --- Portefeuille : descelle a l'ouverture, rescelle a chaque ecriture.

  let enAttente: ReturnType<typeof setTimeout> | undefined;
  let dernierPilote: PiloteMemoire | undefined;
  let derniereCle: Uint8Array | undefined;
  const nomEcarte = `ecarte-${fichiers.portefeuille}` as NomFichier;

  // Écritures du portefeuille, dans l'ordre : la copie mise de côté est sur le disque AVANT que
  // le fichier qu'elle sauve ne soit remplacé.
  let fileEcritures: Promise<void> = Promise.resolve();
  const enchainer = (action: () => Promise<void>): Promise<void> => {
    const suite = fileEcritures.then(action);
    fileEcritures = suite.catch(signaler);
    return suite;
  };

  const ecrire = (): Promise<void> => {
    if (!dernierPilote || !derniereCle) {
      return fileEcritures;
    }
    let nouveau: Uint8Array;
    try {
      nouveau = scellerOctets(derniereCle, dernierPilote.exporter());
    } catch (erreur) {
      signaler(erreur);
      return Promise.reject(erreur);
    }
    // Garde aussi la copie en mémoire à jour : un reverrouillage suivi d'un
    // déverrouillage, sans recharger la page, rouvre ce qui vient d'être écrit
    // (et non l'état lu au démarrage, qui ferait perdre les modifications).
    scelle = nouveau;
    return enchainer(() => stockage.ecrire(fichiers.portefeuille, nouveau));
  };

  const planifier = () => {
    if (enAttente) {
      clearTimeout(enAttente);
    }
    enAttente = setTimeout(() => {
      enAttente = undefined;
      void ecrire().catch(() => undefined);
    }, delai);
  };

  /**
   * Base de cet appareil scellée par une AUTRE clé que celle du coffre (compte recréé pendant
   * que cet appareil gardait l'ancienne base) : une autre copie du même compte (celle du
   * serveur) est essayée ; à défaut, et seulement sur demande (`repartir`), une base neuve,
   * remplie ensuite par la synchronisation. L'ancienne copie est toujours mise de côté.
   */
  const descellerOuReprendre = (cle: Uint8Array, repartir: boolean): Uint8Array | undefined => {
    if (!scelle || scelle.length === 0) return undefined;
    try {
      return descellerOctets(cle, scelle);
    } catch (erreur) {
      if (!(erreur instanceof ErreurScelleCle)) throw erreur;
    }
    const illisible = scelle;
    let reprise: { scelle: Uint8Array; octets: Uint8Array } | undefined;
    for (const autre of options.portefeuillesAlternatifs?.() ?? []) {
      if (!autre || autre.length === 0 || memesOctets(autre, illisible)) continue;
      try {
        reprise = { scelle: autre, octets: descellerOctets(cle, autre) };
        break;
      } catch {
        // Copie scellée elle aussi par une autre clé, ou abîmée : la suivante.
      }
    }
    if (!reprise && !repartir) throw new ErreurBaseIllisible();
    void enchainer(() => stockage.ecrire(nomEcarte, illisible)).catch(() => undefined);
    if (!reprise) {
      scelle = undefined;
      return undefined;
    }
    const adoptee = reprise.scelle;
    scelle = adoptee;
    void enchainer(() => stockage.ecrire(fichiers.portefeuille, adoptee)).catch(() => undefined);
    return reprise.octets;
  };

  const ouvrirBase = (cleHexadecimale: string, ouverture?: OptionsOuvertureBase): PiloteSqlite => {
    options.verifierOuverture?.();
    const cle = octetsDepuisHexa(cleHexadecimale);
    let octets: Uint8Array | undefined;
    try {
      octets = descellerOuReprendre(cle, Boolean(ouverture?.repartir));
    } catch (erreur) {
      cle.fill(0);
      throw erreur;
    }
    const pilote = ouvrirBaseSqlJs(fabrique, octets);

    dernierPilote = pilote;
    derniereCle = cle;

    // Chaque ecriture replanifie un enregistrement : c'est ce qui evite de
    // resceller la base entiere a chaque touche frappee, tout en gardant le
    // disque a jour a moins d'une seconde pres.
    return {
      executer(sql: string, parametres?: readonly ValeurSql[]) {
        pilote.executer(sql, parametres);
        planifier();
      },
      lire: (sql, parametres) => pilote.lire(sql, parametres),
      transaction(action) {
        const resultat = pilote.transaction(action);
        planifier();
        return resultat;
      },
      fermer() {
        // Écriture encore en attente (verrouillage moins de `delai` après une modification) :
        // scellée tout de suite, base encore ouverte. Sans cela elle était perdue — et un
        // compte créé puis verrouillé aussitôt (creerAccesAmi) ne laissait aucune base sur le
        // disque, si bien que l'ancienne, scellée par une autre clé, restait sur le relais.
        if (enAttente) {
          clearTimeout(enAttente);
          enAttente = undefined;
          void ecrire().catch(() => undefined);
        }
        pilote.fermer();
        dernierPilote = undefined;
        derniereCle = undefined;
        cle.fill(0);
      },
    };
  };

  const reinitialiserBase = () => {
    scelle = undefined;
    dernierPilote = undefined;
    derniereCle = undefined;
    if (enAttente) {
      clearTimeout(enAttente);
      enAttente = undefined;
    }
    void enchainer(() => stockage.ecrire(fichiers.portefeuille, new Uint8Array(0))).catch(() => undefined);
  };

  return {
    session: new Session({ stockage: stockageCoffre, ouvrirBase, reinitialiserBase, profil: options.profil ?? ID_PRINCIPAL, coffresAlternatifs: options.coffresAlternatifs, ...(options.kdf ? { kdf: options.kdf } : {}) }),
    emplacement,
    surDisque: stockage.surDisque,
    async vider() {
      if (enAttente) {
        clearTimeout(enAttente);
        enAttente = undefined;
      }
      await ecrire();
      await fileEcritures;
    },
  };
}

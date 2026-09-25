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

import { Session } from '../src/session/session';
import type { Coffre } from '../src/securite/coffre';
import { descellerOctets, scellerOctets } from '../src/securite/scelle';
import type { StockageCoffre } from '../src/session/stockage-coffre';
import { ouvrirBaseSqlJs, type FabriqueSqlJs, type PiloteMemoire } from '../src/db/pilotes/sqljs';
import type { PiloteSqlite, ValeurSql } from '../src/db/pilote';
import type { Stockage } from './stockage';

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

  const coffreBrut = await stockage.lire('coffre');
  const scelle = await stockage.lire('portefeuille');
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
        .ecrire('coffre', encodeur.encode(JSON.stringify(nouveau)))
        .catch(signaler);
    },
    effacer: () => {
      coffre = undefined;
      void stockage.ecrire('coffre', new Uint8Array(0)).catch(signaler);
    },
  };

  // --- Portefeuille : descelle a l'ouverture, rescelle a chaque ecriture.

  let enAttente: ReturnType<typeof setTimeout> | undefined;
  let dernierPilote: PiloteMemoire | undefined;
  let derniereCle: Uint8Array | undefined;

  const ecrire = async () => {
    if (!dernierPilote || !derniereCle) {
      return;
    }
    const octets = dernierPilote.exporter();
    await stockage.ecrire('portefeuille', scellerOctets(derniereCle, octets));
  };

  const planifier = () => {
    if (enAttente) {
      clearTimeout(enAttente);
    }
    enAttente = setTimeout(() => {
      enAttente = undefined;
      void ecrire().catch(signaler);
    }, delai);
  };

  const ouvrirBase = (cleHexadecimale: string): PiloteSqlite => {
    const cle = octetsDepuisHexa(cleHexadecimale);
    const octets = scelle && scelle.length > 0 ? descellerOctets(cle, scelle) : undefined;
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
        pilote.fermer();
        dernierPilote = undefined;
        derniereCle = undefined;
      },
    };
  };

  return {
    session: new Session({ stockage: stockageCoffre, ouvrirBase }),
    emplacement,
    surDisque: stockage.surDisque,
    async vider() {
      if (enAttente) {
        clearTimeout(enAttente);
        enAttente = undefined;
      }
      await ecrire();
    },
  };
}

/**
 * Stockage des fichiers de l'application de bureau.
 *
 * Deux implantations derrière le même contrat :
 *
 *  - **Electron**, qui passe par le pont de préchargement. L'interface nomme
 *    un fichier logique, le processus principal décide du chemin réel.
 *  - **Navigateur**, qui range dans IndexedDB. Elle ne sert qu'au
 *    développement — `npm run bureau` — pour travailler l'interface sans
 *    relancer une application à chaque fois.
 *
 * Le second n'est pas un mode dégradé qu'on livrerait : un onglet de
 * navigateur n'offre pas les garanties d'un fichier sur disque, et l'écran
 * d'accueil le dit.
 */

/** Fichiers logiques ; ceux d'un profil d'ami portent son identifiant. */
export type NomFichier = 'portefeuille' | 'coffre' | 'profils' | `portefeuille-${string}` | `coffre-${string}`;

export interface Stockage {
  lire(nom: NomFichier): Promise<Uint8Array | undefined>;
  ecrire(nom: NomFichier, octets: Uint8Array): Promise<void>;
  /** Vrai quand les fichiers vivent réellement sur le disque. */
  surDisque: boolean;
  /** Où les données sont rangées, pour le dire à l'utilisateur. */
  emplacement(): Promise<string>;
}

interface PontBureau {
  bureau: true;
  /** Absent des versions compilées avant l'isolation des comptes. */
  profil?: {
    ouvrir(id: string): Promise<boolean>;
    fermer(): Promise<boolean>;
  };
  fichiers: {
    lire(nom: string): Promise<Uint8Array | undefined>;
    ecrire(nom: string, octets: Uint8Array): Promise<void>;
    existe(nom: string): Promise<boolean>;
    dossier(): Promise<string>;
    enregistrerSous(nom: string, contenu: Uint8Array): Promise<boolean>;
  };
  systeme: {
    notifier(titre: string, corps: string): Promise<boolean>;
    ouvrir(url: string): Promise<boolean>;
  };
  yahoo?: {
    json(url: string): Promise<unknown>;
  };
  medias?: {
    flux(url: string): Promise<string>;
  };
  voix?: {
    liste(): Promise<Array<{ id: string; nom: string; langue: string }>>;
    synthetiser(texte: string, voix: string, vitesse: number): Promise<Uint8Array>;
  };
  /** Absent des versions compilées avant l'arrivée des mises à jour. */
  maj?: {
    verifier(): Promise<EtatMiseAJourBureau>;
    installer(): Promise<boolean>;
  };
}

/** Réponse du processus principal à « y a-t-il plus récent sur GitHub ? ». */
export type EtatMiseAJourBureau =
  | { etat: 'inconnue' }
  | { etat: 'a-jour'; commit: string }
  | { etat: 'disponible'; commit: string; nouveautes: string[] }
  /** Nouveautés récupérées et appliquées toutes seules à ce lancement. */
  | { etat: 'appliquee'; nouveautes: string[] }
  | { etat: 'erreur'; motif: string };

/** Pont exposé par le préchargement, absent dans un navigateur ordinaire. */
export function pont(): PontBureau | undefined {
  const global = globalThis as { applibourse?: PontBureau };
  return global.applibourse?.bureau ? global.applibourse : undefined;
}

export function stockageElectron(passerelle: PontBureau): Stockage {
  return {
    surDisque: true,
    lire: nom => passerelle.fichiers.lire(nom),
    ecrire: (nom, octets) => passerelle.fichiers.ecrire(nom, octets),
    emplacement: () => passerelle.fichiers.dossier(),
  };
}

// ------------------------------------------------------- Repli navigateur

const BASE_INDEXEDDB = 'applibourse';
const MAGASIN = 'fichiers';

function ouvrirIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(BASE_INDEXEDDB, 1);
    demande.onupgradeneeded = () => {
      demande.result.createObjectStore(MAGASIN);
    };
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(demande.error);
  });
}

function transiger<T>(
  base: IDBDatabase,
  mode: IDBTransactionMode,
  action: (magasin: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    const transaction = base.transaction(MAGASIN, mode);
    const demande = action(transaction.objectStore(MAGASIN));
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(demande.error);
  });
}

export function stockageNavigateur(): Stockage {
  return {
    surDisque: false,

    async lire(nom) {
      const base = await ouvrirIndexedDb();
      try {
        const valeur = await transiger<unknown>(base, 'readonly', magasin =>
          magasin.get(nom) as IDBRequest<unknown>,
        );
        return valeur instanceof Uint8Array ? valeur : undefined;
      } finally {
        base.close();
      }
    },

    async ecrire(nom, octets) {
      const base = await ouvrirIndexedDb();
      try {
        await transiger(base, 'readwrite', magasin =>
          magasin.put(octets, nom) as IDBRequest<IDBValidKey>,
        );
      } finally {
        base.close();
      }
    },

    async emplacement() {
      return 'Stockage du navigateur (développement)';
    },
  };
}

/** Choisit l'implantation disponible. */
export function stockageCourant(): Stockage {
  const passerelle = pont();
  return passerelle ? stockageElectron(passerelle) : stockageNavigateur();
}

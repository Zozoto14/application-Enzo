/**
 * Accès au système de fichiers.
 *
 * Une seule abstraction pour les deux usages qui en ont besoin : les mises à
 * jour et les sauvegardes. Injectée partout, elle permet de tout éprouver en
 * mémoire sur le PC, et de brancher react-native-fs sur l'appareil sans que
 * le code appelant change.
 *
 * Toutes les opérations sont asynchrones, parce que le module natif l'est.
 */

export interface SystemeFichiers {
  /** Dossier Documents de l'application. */
  dossierDocuments: string;
  existe(chemin: string): Promise<boolean>;
  lireBinaire(chemin: string): Promise<Uint8Array>;
  lireTexte(chemin: string): Promise<string>;
  ecrireBinaire(chemin: string, contenu: Uint8Array): Promise<void>;
  ecrireTexte(chemin: string, contenu: string): Promise<void>;
  supprimer(chemin: string): Promise<void>;
  creerDossier(chemin: string): Promise<void>;
  /** Noms des fichiers d'un dossier, vide s'il n'existe pas. */
  lister(chemin: string): Promise<string[]>;
}

const ALPHABET_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Conversions base64 sans dépendance.
 * `atob` et `Buffer` ne sont pas garantis dans le moteur JavaScript embarqué,
 * et un fichier mal décodé ferait échouer une vérification d'empreinte sans
 * que la cause soit lisible.
 */
export function base64DepuisOctets(octets: Uint8Array): string {
  let sortie = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i];
    const b = octets[i + 1];
    const c = octets[i + 2];
    sortie += ALPHABET_B64[a >> 2];
    sortie += ALPHABET_B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    sortie += b === undefined ? '=' : ALPHABET_B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    sortie += c === undefined ? '=' : ALPHABET_B64[c & 63];
  }
  return sortie;
}

export function octetsDepuisBase64(texte: string): Uint8Array {
  const propre = texte.replace(/[^A-Za-z0-9+/]/g, '');
  const octets: number[] = [];
  for (let i = 0; i < propre.length; i += 4) {
    const valeurs = [0, 1, 2, 3].map(decalage =>
      ALPHABET_B64.indexOf(propre[i + decalage]),
    );
    octets.push((valeurs[0] << 2) | (valeurs[1] >> 4));
    if (valeurs[2] !== -1) {
      octets.push(((valeurs[1] & 15) << 4) | (valeurs[2] >> 2));
    }
    if (valeurs[3] !== -1) {
      octets.push(((valeurs[2] & 3) << 6) | valeurs[3]);
    }
  }
  return Uint8Array.from(octets);
}

/** Système en mémoire, pour les tests. */
export function systemeMemoire(dossierDocuments = '/Documents'): SystemeFichiers & {
  contenu: Map<string, Uint8Array | string>;
} {
  const contenu = new Map<string, Uint8Array | string>();

  return {
    contenu,
    dossierDocuments,
    existe: async chemin => contenu.has(chemin),
    lireBinaire: async chemin => contenu.get(chemin) as Uint8Array,
    lireTexte: async chemin => contenu.get(chemin) as string,
    ecrireBinaire: async (chemin, octets) => void contenu.set(chemin, octets),
    ecrireTexte: async (chemin, texte) => void contenu.set(chemin, texte),
    supprimer: async chemin => void contenu.delete(chemin),
    creerDossier: async () => undefined,
    lister: async chemin => {
      const prefixe = chemin.endsWith('/') ? chemin : `${chemin}/`;
      return [...contenu.keys()]
        .filter(cle => cle.startsWith(prefixe))
        .map(cle => cle.slice(prefixe.length))
        .filter(nom => !nom.includes('/'));
    },
  };
}

/**
 * Adapte react-native-fs, s'il est présent dans le binaire.
 * Renvoie `undefined` sinon : l'interface doit pouvoir dire que la
 * fonctionnalité est indisponible plutôt que de planter.
 */
export function systemeDepuisRnfs(moduleFs: unknown): SystemeFichiers | undefined {
  if (!moduleFs || typeof moduleFs !== 'object') {
    return undefined;
  }

  const fs = moduleFs as Record<string, any>;
  if (typeof fs.DocumentDirectoryPath !== 'string') {
    return undefined;
  }

  return {
    dossierDocuments: fs.DocumentDirectoryPath,
    existe: chemin => fs.exists(chemin),
    lireTexte: chemin => fs.readFile(chemin, 'utf8'),
    lireBinaire: async chemin =>
      octetsDepuisBase64((await fs.readFile(chemin, 'base64')) as string),
    ecrireTexte: (chemin, contenu) => fs.writeFile(chemin, contenu, 'utf8'),
    ecrireBinaire: (chemin, contenu) =>
      fs.writeFile(chemin, base64DepuisOctets(contenu), 'base64'),
    supprimer: chemin => fs.unlink(chemin),
    creerDossier: chemin => fs.mkdir(chemin),
    lister: async chemin => {
      if (!(await fs.exists(chemin))) {
        return [];
      }
      const entrees = (await fs.readDir(chemin)) as Array<{ name: string }>;
      return entrees.map(entree => entree.name);
    },
  };
}

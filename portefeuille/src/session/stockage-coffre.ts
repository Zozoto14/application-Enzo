/**
 * Stockage du coffre de clés.
 *
 * Le coffre n'est pas secret : ses enveloppes sont inexploitables sans le mot
 * de passe ni un code de récupération. Il se range donc dans un simple fichier,
 * sans Trousseau ni chiffrement supplémentaire — et c'est heureux, puisqu'il
 * doit être lisible *avant* tout déverrouillage.
 *
 * L'interface est injectée pour que les tests s'exécutent en mémoire, et pour
 * que le passage à un fichier réel côté application ne touche pas à la logique
 * de session.
 */

import type { Coffre } from '../securite/coffre';

export interface StockageCoffre {
  lire(): Coffre | undefined;
  ecrire(coffre: Coffre): void;
  effacer(): void;
}

/** Stockage en mémoire, pour les tests. */
export function stockageMemoire(initial?: Coffre): StockageCoffre {
  let contenu = initial;
  return {
    lire: () => contenu,
    ecrire: coffre => {
      // Copie profonde : un test qui modifie l'objet rendu ne doit pas
      // corrompre ce qui est « sur le disque ».
      contenu = JSON.parse(JSON.stringify(coffre));
    },
    effacer: () => {
      contenu = undefined;
    },
  };
}

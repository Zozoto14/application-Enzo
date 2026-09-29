/**
 * Espace local du profil ouvert : tout ce qui vit hors du coffre chiffré
 * (stockage du navigateur, état gardé en mémoire par des modules) est
 * rangé sous le profil courant, et remis à zéro quand on change de compte.
 *
 *  - `cleLocale` : clé de `localStorage` propre au profil. Le principal garde
 *    les clés historiques (rien ne se perd à la mise à jour) ; un ami a les
 *    siennes, suffixées de son identifiant. Un profil ne lit donc jamais
 *    le planning, la voix, la liaison ou le thème mémorisés par un autre ;
 *  - `surChangementDeCompte` : les modules qui gardent un état en mémoire
 *    (relais actif, lecture en cours, mode discret…) s'y inscrivent, et
 *    `changerDEspace` les vide tous avant d'ouvrir un autre compte.
 */

/** Même valeur que `ID_PRINCIPAL` (profils.ts) ; sans import, pour rester sans dépendance. */
const ID_PRINCIPAL = 'principal';

let profilActif = ID_PRINCIPAL;
const remises = new Set<() => void>();

export function profilCourant(): string {
  return profilActif;
}

/** Clé de stockage local propre au profil ouvert. */
export function cleLocale(cle: string, profil: string = profilActif): string {
  return profil === ID_PRINCIPAL ? cle : `${cle}@${profil}`;
}

/** Inscrit une remise à zéro, appelée à chaque changement de compte. Rend de quoi se désinscrire. */
export function surChangementDeCompte(remettre: () => void): () => void {
  remises.add(remettre);
  return () => remises.delete(remettre);
}

/**
 * Passe à l'espace d'un autre profil : toutes les remises à zéro inscrites
 * sont appelées (une remise qui échoue n'empêche pas les autres).
 */
export function changerDEspace(profil: string): void {
  for (const remettre of [...remises]) {
    try {
      remettre();
    } catch {
      // Chaque module se remet seul ; on continue avec les autres.
    }
  }
  profilActif = profil;
}

type StockageTexte = { getItem(cle: string): string | null; setItem(cle: string, valeur: string): void; removeItem?(cle: string): void };

/** `localStorage` vu du profil ouvert : mêmes méthodes, clés propres au profil. */
export function stockageDuProfil(brut: StockageTexte | undefined): StockageTexte | undefined {
  if (!brut) {
    return undefined;
  }
  return {
    getItem: cle => brut.getItem(cleLocale(cle)),
    setItem: (cle, valeur) => brut.setItem(cleLocale(cle), valeur),
    removeItem: cle => brut.removeItem?.(cleLocale(cle)),
  };
}

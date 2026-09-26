/**
 * Où mène un clic sur une notification.
 *
 * Chaque notification porte une destination : un écran de la barre
 * latérale (« tableau », « objectifs »…), ou une valeur précise —
 * « titre:<id> » pour une valeur connue, « symbole:<ticker> » pour une fiche.
 * On la déduit de l'identifiant quand l'expéditeur ne la donne pas.
 */

export function destinationDe(identifiant: string): string {
  if (identifiant.startsWith('alerte-')) {
    // alerte-<titreId>-haut|bas-<date>
    const titreId = identifiant.slice('alerte-'.length).replace(/-(haut|bas)-\d{4}-\d{2}-\d{2}$/, '');
    return titreId ? `titre:${titreId}` : 'notifications';
  }
  if (identifiant.startsWith('carnet-')) return 'carnet';
  if (identifiant.startsWith('versement-')) return 'objectifs';
  if (identifiant.startsWith('evt-')) return 'watchlist';
  if (identifiant.startsWith('podcast')) return 'podcast';
  // Briefings, forte séance, rappel verrouillé : le portefeuille.
  return 'tableau';
}

export type DestinationOuverte =
  | { genre: 'ecran'; cle: string }
  | { genre: 'titre'; titreId: string }
  | { genre: 'symbole'; symbole: string };

/** Lit une destination reçue du processus principal ; inconnue : le portefeuille. */
export function lireDestination(brute: unknown, ecransConnus: ReadonlySet<string>): DestinationOuverte {
  const texte = typeof brute === 'string' ? brute.trim().slice(0, 120) : '';
  if (texte.startsWith('titre:') && texte.length > 6) return { genre: 'titre', titreId: texte.slice(6) };
  if (texte.startsWith('symbole:') && texte.length > 8) return { genre: 'symbole', symbole: texte.slice(8) };
  return { genre: 'ecran', cle: ecransConnus.has(texte) ? texte : 'tableau' };
}

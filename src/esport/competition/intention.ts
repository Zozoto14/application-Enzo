/**
 * Passage d'une intention d'un écran à l'autre dans la même team (le Tournoi demande « saisir le
 * résultat de ce match », l'accueil « ouvrir ce tournoi »). L'écran visé la prend à son ouverture.
 */

export type Intention = { genre: 'resultat-match'; teamId: string; matchId: string } | { genre: 'tournoi'; teamId: string; id: string } | { genre: 'resultat'; teamId: string; id: string };

let enAttente: Intention | null = null;

export function demander(i: Intention): void {
  enAttente = i;
}

/** L'intention en attente pour cette team et ce genre (et l'oublie). */
export function prendre<G extends Intention['genre']>(teamId: string, genre: G): Extract<Intention, { genre: G }> | null {
  const i = enAttente;
  if (!i || i.teamId !== teamId || i.genre !== genre) return null;
  enAttente = null;
  return i as Extract<Intention, { genre: G }>;
}

/**
 * Données pré-remplies des modèles de strat (pures, testées) : capacités des agents de Valorant et modèle
 * The Finals, fusionnés dans un profil SANS rien écraser (ce que le Fondateur a déjà saisi reste).
 */

import type { CapaciteJeu, DonneesJeu } from '../api';
import { capacitesTheFinals, modeleTheFinals } from './thefinals';
import { capacitesValorant } from './valorant';

export { capacitesTheFinals, capacitesValorant, modeleTheFinals };

/** Capacités pré-remplies d'un personnage selon le modèle de strat (Valorant : agent ; The Finals : classe). */
export function capacitesPrereplies(modele: string | undefined, personnage: { cle: string; classe?: string | null }): CapaciteJeu[] {
  if (modele === 'valorant') return capacitesValorant(personnage.cle);
  if (modele === 'thefinals') return capacitesTheFinals(personnage.classe ?? personnage.cle);
  return [];
}

/** Ajoute les capacités pré-remplies aux personnages qui n'en ont pas. Rend les données et le nombre de personnages complétés. */
export function preremplirCapacites(d: DonneesJeu, modele: string | undefined): { donnees: DonneesJeu; n: number } {
  let n = 0;
  const personnages = d.personnages.map(p => {
    if (p.capacites?.length) return p;
    const capacites = capacitesPrereplies(modele, p);
    if (capacites.length === 0) return p;
    n++;
    return { ...p, capacites };
  });
  return { donnees: n ? { ...d, personnages } : d, n };
}

/** Fusionne le modèle The Finals : formats, modes, maps, classes, personnages absents ; étages et capacités manquants. */
export function fusionnerTheFinals(d: DonneesJeu, etages: string[]): { donnees: DonneesJeu; ajouts: number } {
  const m = modeleTheFinals(etages);
  let ajouts = 0;
  const fusion = <T extends { cle: string }>(existants: T[], modele: T[], completer?: (e: T, x: T) => T): T[] => {
    const parCle = new Map(modele.map(x => [x.cle, x]));
    const sortie = existants.map(e => {
      const x = parCle.get(e.cle);
      return x && completer ? completer(e, x) : e;
    });
    for (const x of modele) {
      if (existants.some(e => e.cle === x.cle)) continue;
      sortie.push(x);
      ajouts++;
    }
    return sortie;
  };
  const donnees: DonneesJeu = {
    ...d,
    formats: fusion(d.formats, m.formats),
    modes: fusion(d.modes, m.modes),
    cartes: fusion(d.cartes, m.cartes, (e, x) => (e.niveaux?.length || !x.niveaux?.length ? e : (ajouts++, { ...e, niveaux: x.niveaux }))),
    classes: fusion(d.classes, m.classes),
    personnages: fusion(d.personnages, m.personnages, (e, x) => (e.capacites?.length ? e : (ajouts++, { ...e, capacites: x.capacites, classe: e.classe ?? x.classe }))),
    roster: d.roster ?? m.roster,
  };
  return { donnees, ajouts };
}

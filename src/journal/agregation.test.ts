/**
 * Agrégation des événements d'un jour : dédoublonnage, tri, compteurs, fait marquant.
 */

import { COMPTEURS, agreger, choisirMarquant, ordonner, poidsDe, rythmeDe } from './agregation';
import { JOUR, ev, journeeRemplie } from './__fixtures__/outils';

describe('agrégation des événements', () => {
  it('compte chaque famille sur une journée remplie', () => {
    const r = agreger(JOUR, journeeRemplie());
    expect(r.compteurs).toMatchObject({
      [COMPTEURS.tachesTerminees]: 3,
      [COMPTEURS.tachesCreees]: 1,
      [COMPTEURS.sessions]: 1,
      [COMPTEURS.minutesOffice]: 95,
      [COMPTEURS.episodes]: 3,
      [COMPTEURS.series]: 1,
      [COMPTEURS.operations]: 1,
      [COMPTEURS.achats]: 1,
      [COMPTEURS.ventes]: 0,
      [COMPTEURS.paiements]: 1,
      [COMPTEURS.encaisse]: 45,
      [COMPTEURS.relances]: 1,
      [COMPTEURS.decisions]: 1,
      [COMPTEURS.variation]: 1.25,
    });
    expect(r.parFamille.taches).toHaveLength(4);
    expect(r.parFamille.meteo).toHaveLength(1);
  });

  it('ne compte qu’une fois un fait relu (même source, même identifiant) et ignore les autres jours', () => {
    const e = ev({ id: 'x', famille: 'taches', genre: 'tache-terminee', titre: 'A' });
    const r = agreger(JOUR, [e, { ...e }, ev({ id: 'x', source: 'autre', famille: 'taches', genre: 'tache-terminee', titre: 'A' }), ev({ id: 'y', jour: '2026-10-12', famille: 'taches', genre: 'tache-terminee', titre: 'Hier' })]);
    // Deux sources différentes avec le même identifiant : deux faits ; le doublon exact de la même source : un seul.
    expect(r.evenements).toHaveLength(2);
    expect(r.compteurs[COMPTEURS.tachesTerminees]).toBe(2);
  });

  it('trie par heure, les faits sans heure en dernier', () => {
    const liste = ordonner(
      [ev({ id: '1', famille: 'autre', genre: 'autre', titre: 'Sans heure' }), ev({ id: '2', famille: 'autre', genre: 'autre', titre: 'Tard', heure: '20:00' }), ev({ id: '3', famille: 'autre', genre: 'autre', titre: 'Tôt', heure: '08:15' })],
      JOUR,
    );
    expect(liste.map(e => e.titre)).toEqual(['Tôt', 'Tard', 'Sans heure']);
  });

  it('le fait marquant est le plus important : une décision pèse plus qu’une tâche', () => {
    const m = agreger(JOUR, journeeRemplie()).marquant;
    expect(m?.famille).toBe('decisions');
    expect(m?.evenement?.id).toBe('d1');
  });

  it('une grosse variation l’emporte sur le reste', () => {
    const liste = [ev({ id: 'v', famille: 'portefeuille', genre: 'variation-portefeuille', titre: 'v', pourcentage: -4.2 }), ev({ id: 'd', famille: 'decisions', genre: 'decision', titre: 'd' })];
    expect(agreger(JOUR, liste).marquant?.evenement?.id).toBe('v');
  });

  it('trois tâches ou plus, ou un marathon d’épisodes, font une série marquante', () => {
    const taches = ['a', 'b', 'c', 'd'].map(id => ev({ id, famille: 'taches', genre: 'tache-terminee', titre: id }));
    expect(agreger(JOUR, taches).marquant).toMatchObject({ type: 'taches', n: 4 });
    const eps = [1, 2, 3, 4].map(n => ev({ id: `e${n}`, famille: 'tsuzuku', genre: 'episode-vu', titre: 'Série', groupe: 'Série', nombre: n }));
    expect(agreger(JOUR, eps).marquant).toMatchObject({ type: 'marathon', n: 4, groupe: 'Série' });
  });

  it('la météo seule ne fait pas de fait marquant ; une journée vide non plus', () => {
    expect(agreger(JOUR, [ev({ id: 'm', famille: 'meteo', genre: 'meteo', titre: 'Pluie' })]).marquant).toBeUndefined();
    expect(agreger(JOUR, []).marquant).toBeUndefined();
    expect(choisirMarquant([], {})).toBeUndefined();
  });

  it('poids : celui de la source l’emporte, borné à 0–100', () => {
    expect(poidsDe(ev({ id: 'p', famille: 'autre', genre: 'autre', titre: 'p', poids: 250 }))).toBe(100);
    expect(poidsDe(ev({ id: 'p', famille: 'autre', genre: 'autre', titre: 'p', poids: -3 }))).toBe(0);
    expect(poidsDe(ev({ id: 'p', famille: 'portefeuille', genre: 'variation-portefeuille', titre: 'p', pourcentage: 100 }))).toBe(95);
  });

  it('rythme : calme, normal, dense (la météo ne compte pas)', () => {
    expect(rythmeDe(agreger(JOUR, []))).toBe('calme');
    expect(rythmeDe(agreger(JOUR, [ev({ id: 'm', famille: 'meteo', genre: 'meteo', titre: 'm' })]))).toBe('calme');
    expect(rythmeDe(agreger(JOUR, journeeRemplie()))).toBe('dense');
    const quatre = ['a', 'b', 'c', 'd'].map(id => ev({ id, famille: 'taches', genre: 'tache-creee', titre: id }));
    expect(rythmeDe(agreger(JOUR, quatre))).toBe('normal');
  });
});

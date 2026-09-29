import { ajouterHistorique, historiqueDepuisJson } from './historiqueRecherche';

describe('historique des recherches', () => {
  it('met la dernière recherche en tête sans doublon', () => {
    let liste = ajouterHistorique([], { texte: 'nvidia', quand: '2026-09-26' });
    liste = ajouterHistorique(liste, { texte: 'NVIDIA Corporation', symbole: 'NVDA', nom: 'NVIDIA Corporation', quand: '2026-09-26' });
    liste = ajouterHistorique(liste, { texte: ' NVIDIA ', quand: '2026-09-27' });
    expect(liste.map(entree => entree.texte)).toEqual(['NVIDIA', 'NVIDIA Corporation']);
    liste = ajouterHistorique(liste, { texte: 'Nvidia Corp', symbole: 'nvda', quand: '2026-09-28' });
    expect(liste).toHaveLength(2);
    expect(liste[0].symbole).toBe('nvda');
  });

  it('garde au plus la taille demandée et ignore un terme vide', () => {
    let liste = ajouterHistorique([], { texte: '   ', quand: '2026-09-26' });
    expect(liste).toEqual([]);
    for (let i = 0; i < 20; i++) liste = ajouterHistorique(liste, { texte: `t${i}`, quand: '2026-09-26' }, 5);
    expect(liste.map(entree => entree.texte)).toEqual(['t19', 't18', 't17', 't16', 't15']);
  });

  it('relit un historique enregistré, même abîmé', () => {
    expect(historiqueDepuisJson(undefined)).toEqual([]);
    expect(historiqueDepuisJson('{pas du json')).toEqual([]);
    expect(historiqueDepuisJson('[{"texte":"asml","quand":"2026-09-26"},{"x":1},null]')).toEqual([
      { texte: 'asml', quand: '2026-09-26' },
    ]);
  });
});

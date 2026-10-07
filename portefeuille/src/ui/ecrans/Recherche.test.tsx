import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Recherche } from './Recherche';
import { oublierTheses } from '../theses';
import type { ResultatTheses } from '../../fondamentaux/theses';

const NVIDIA = { symbole: 'NVDA', nom: 'NVIDIA Corporation', place: 'NMS', devise: 'USD', type: 'EQUITY', paris: false };

const resultat: ResultatTheses = {
  theses: [
    {
      titre: 'Nvidia : la puce n’est que le début',
      resume: 'Les marges restent énormes.',
      source: 'Seeking Alpha',
      auteur: 'Julien M.',
      date: '2026-09-14',
      lien: 'https://seekingalpha.com/article/1',
      langue: 'en',
      genre: 'analyse',
      ton: 'optimiste',
      valeur: 'NVIDIA Corporation',
    },
    {
      titre: 'Le maillon faible de l’IA',
      resume: '',
      source: 'Reddit · r/vosfinances',
      auteur: '/u/marc',
      date: '2026-08-27',
      langue: 'fr',
      genre: 'discussion',
      ton: 'prudent',
      valeur: 'NVIDIA Corporation',
    },
  ],
  actualites: [
    { titre: 'Nvidia annonce ses résultats', resume: '', source: 'Les Echos', date: '2026-09-20', langue: 'fr' },
  ],
  echecs: 1,
  sources: 5,
};

describe('écran Recherche', () => {
  beforeEach(oublierTheses);

  it('cherche, puis affiche thèses et actualités de la valeur choisie', async () => {
    const surveiller = jest.fn();
    const charger = jest.fn(async () => resultat);
    await render(
      <Recherche
        onRechercher={async () => [NVIDIA]}
        surveilles={new Set()}
        onSurveiller={surveiller}
        onOuvrirFiche={() => {}}
        chargerTheses={charger}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('champ-recherche-action'), 'nvidia');
    await fireEvent.press(screen.getByTestId('bouton-rechercher-action'));

    expect(await screen.findByText('Nvidia : la puce n’est que le début')).toBeTruthy();
    expect(charger).toHaveBeenCalledWith({ nom: 'NVIDIA Corporation', symbole: 'NVDA' });
    expect(screen.getByText('Julien M.')).toBeTruthy();
    expect(screen.getByText('↗ plutôt optimiste')).toBeTruthy();
    expect(screen.getByText('↘ plutôt prudent')).toBeTruthy();
    expect(screen.getByText(/1 source sur 5 n’a pas répondu/)).toBeTruthy();

    // Filtre : seulement les avis de particuliers.
    await fireEvent.press(screen.getByTestId('filtre-theses-discussion'));
    expect(screen.queryByText('Nvidia : la puce n’est que le début')).toBeNull();
    expect(screen.getByText('Le maillon faible de l’IA')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('onglet-recherche-actualites'));
    expect(await screen.findByText('Nvidia annonce ses résultats')).toBeTruthy();
    // Le cache évite de tout recharger en changeant d'onglet.
    expect(charger).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('surveiller-NVDA'));
    expect(surveiller).toHaveBeenCalledWith(NVIDIA);
  });

  it('dit quand rien n’est trouvé', async () => {
    await render(
      <Recherche onRechercher={async () => []} surveilles={new Set()} onSurveiller={() => {}} onOuvrirFiche={() => {}} />,
    );
    await fireEvent.changeText(screen.getByTestId('champ-recherche-action'), 'zzzz');
    await fireEvent.press(screen.getByTestId('bouton-rechercher-action'));
    expect(await screen.findByText(/Aucun résultat pour « zzzz »/)).toBeTruthy();
  });
});

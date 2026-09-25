import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { construireEpisode } from '../../podcast/episode';
import { Podcast } from './Podcast';

const episode = construireEpisode({
  aujourdhui: '2026-09-25',
  valeurTotale: 1260,
  totalReturn: 60,
  totalReturnPct: 5,
  seance: { montant: 60, pourcentage: 5 },
  lignes: [{ nom: 'Stellantis', variationJour: -20, latentPct: -20, poids: 13 }],
  valeurs: [],
  indices: [{ nom: 'CAC 40', seancePct: 1 }],
  actualitesMarche: [],
});

describe('écran Podcast', () => {
  it('propose de préparer un épisode quand il n’y en a pas', async () => {
    const onGenerer = jest.fn();
    await render(<Podcast onGenerer={onGenerer} />);
    await fireEvent.press(screen.getByTestId('bouton-generer-podcast'));
    expect(onGenerer).toHaveBeenCalledTimes(1);
  });

  it('affiche les chapitres et la transcription', async () => {
    await render(<Podcast episode={episode} onGenerer={() => {}} />);
    expect(screen.getByText(episode.titre)).toBeTruthy();
    for (const chapitre of episode.chapitres) {
      expect(screen.getAllByText(chapitre.titre).length).toBeGreaterThan(0);
    }
    // Hors ordinateur, pas de voix : le texte reste lisible.
    expect(screen.getByText(/disponible sur l’ordinateur/)).toBeTruthy();
  });

  it('montre la préparation en cours', async () => {
    await render(<Podcast chargement etape="Tour des marchés…" onGenerer={() => {}} />);
    expect(screen.getByText('Tour des marchés…')).toBeTruthy();
  });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Watchlist } from './Watchlist';
import type { LigneSurveillee, VueWatchlist } from '../vues/watchlist';
import { construireFiche } from '../vues/fiche';
import { COMPTES_EXEMPLE, RESUME_EXEMPLE, historiqueExemple } from '../../fondamentaux/exemples';
import { lireComptes, lireCoursEtDividendes, lireFiche } from '../../fondamentaux/yahoo';

const ligne = (partiel: Partial<LigneSurveillee>): LigneSurveillee => ({
  titreId: 'x',
  nom: 'X',
  ticker: 'X',
  tendance: 'neutre',
  depuis: 'Suivie depuis le 01/09/2026.',
  seuilHaut: '',
  seuilBas: '',
  detenue: false,
  seuilAtteint: false,
  ...partiel,
});

const vue: VueWatchlist = {
  lignes: [
    ligne({ titreId: 'asml', nom: 'ASML Holding', ticker: 'ASML', cours: '1 522,60 €', ecartPourcent: '+1,40 %', ecartPct: 1.4, tendance: 'hausse' }),
    ligne({ titreId: 'nvda', nom: 'NVIDIA Corporation', ticker: 'NVDA', cours: '225,07 $', ecartPourcent: '+20,78 %', ecartPct: 20.78, tendance: 'hausse', seuilAtteint: true }),
  ],
  candidats: [],
  aucuneSurveillance: false,
};

const fiche = construireFiche(
  lireFiche('EXA.PA', RESUME_EXEMPLE),
  lireComptes(COMPTES_EXEMPLE),
  lireCoursEtDividendes(historiqueExemple()),
);

const base = {
  vue,
  onAjouter: () => {},
  onRetirer: jest.fn(),
  onChangerSeuil: () => {},
};

describe('Watchlist façon Baggr', () => {
  it('trie par écart, ouvre la meilleure valeur et montre son graphique et son prix juste', async () => {
    const chargerFiche = jest.fn(async () => fiche);
    await render(<Watchlist {...base} chargerFiche={chargerFiche} />);

    expect(screen.getByText('2 valeurs suivies, hors portefeuille.')).toBeTruthy();
    // NVIDIA, la plus forte hausse depuis l'ajout, est en tête et affichée.
    expect(chargerFiche).toHaveBeenCalledWith('NVDA');
    expect(await screen.findByText('PRIX JUSTE')).toBeTruthy();
    expect(screen.getByText('Votre suivi')).toBeTruthy();
    expect(screen.getByText('Seuil franchi')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('ligne-watchlist-asml'));
    expect(chargerFiche).toHaveBeenCalledWith('ASML');
  });

  it('présente toutes les valeurs dans l’onglet Tableau', async () => {
    await render(<Watchlist {...base} />);
    await fireEvent.press(screen.getByTestId('onglet-surveillance-tableau'));
    expect(screen.getByTestId('tableau-watchlist')).toBeTruthy();
    expect(screen.getByText(/\+20,78 %/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ne plus surveiller ASML Holding'));
    expect(base.onRetirer).toHaveBeenCalledWith('asml');
  });

  it('explique où lire les thèses sans l’application de bureau', async () => {
    await render(<Watchlist {...base} />);
    await fireEvent.press(screen.getByTestId('onglet-surveillance-theses'));
    expect(screen.getByText('Thèses — Watchlist')).toBeTruthy();
    expect(screen.getByText(/application de bureau/)).toBeTruthy();
  });
});

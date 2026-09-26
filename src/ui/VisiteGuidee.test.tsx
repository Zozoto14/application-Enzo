import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ETAPES_VISITE, VERSION_VISITE, VisiteGuidee, etapesDejaVues, etapesNouvelles, marquerVues, type EtapeVisite } from './VisiteGuidee';

describe('étapes vues de la visite', () => {
  it('ne repropose rien après la visite de la version précédente', () => {
    expect(etapesNouvelles(ETAPES_VISITE, VERSION_VISITE)).toEqual([]);
  });

  it('propose tout la première fois', () => {
    expect(etapesNouvelles(ETAPES_VISITE, undefined)).toHaveLength(ETAPES_VISITE.length);
    expect(etapesNouvelles(ETAPES_VISITE, 'pas du json')).toHaveLength(ETAPES_VISITE.length);
  });

  it('ne montre que les nouveautés jamais vues', () => {
    const avecNouvelle: EtapeVisite[] = [...ETAPES_VISITE, { id: 'nouvelle', emoji: '✨', titre: 'Nouvelle', texte: '…', destination: 'carnet' }];
    expect(etapesNouvelles(avecNouvelle, VERSION_VISITE).map(etape => etape.id)).toEqual(['nouvelle']);
  });

  it("ne rouvre pas la visite pour la seule introduction", () => {
    const vues = marquerVues(undefined, ETAPES_VISITE.filter(etape => etape.id !== 'intro').map(etape => etape.id));
    expect(etapesNouvelles(ETAPES_VISITE, vues)).toEqual([]);
  });

  it('cumule les étapes vues', () => {
    const brute = marquerVues(marquerVues(undefined, ['screener']), ['carnet', 'screener']);
    expect([...etapesDejaVues(brute)].sort()).toEqual(['carnet', 'screener']);
  });
});

describe('VisiteGuidee', () => {
  const etapes: EtapeVisite[] = [
    { id: 'a', emoji: '1', titre: 'Première', texte: '…', destination: 'tableau', onglet: 'impots' },
    { id: 'b', emoji: '2', titre: 'Seconde', texte: '…', destination: 'carnet' },
  ];

  it('ouvre la page, se replie en bandeau, puis reprend', async () => {
    const onNaviguer = jest.fn();
    const onVue = jest.fn();
    const onTerminer = jest.fn();
    await render(<VisiteGuidee visible etapes={etapes} onNaviguer={onNaviguer} onVue={onVue} onTerminer={onTerminer} />);
    expect(onVue).toHaveBeenCalledWith('a');
    expect(screen.getByText(/ouvrir la page pour voir/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('visite-voir'));
    expect(onNaviguer).toHaveBeenCalledWith('tableau', 'impots');
    expect(screen.getByTestId('visite-bandeau')).toBeTruthy();
    expect(onTerminer).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('visite-continuer'));
    expect(screen.getByText('Seconde')).toBeTruthy();
    expect(onVue).toHaveBeenCalledWith('b');

    await fireEvent.press(screen.getByTestId('visite-voir'));
    await fireEvent.press(screen.getByTestId('visite-continuer'));
    expect(onTerminer).toHaveBeenCalledTimes(1);
  });
});

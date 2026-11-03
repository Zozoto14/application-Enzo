import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { IndicateurSynchro } from './IndicateurSynchro';
import { themeHub } from './themes';

const theme = themeHub('nuit');

describe('IndicateurSynchro', () => {
  it('affiche pictogramme et texte, et le bouton « Synchroniser maintenant » dans la version détaillée', async () => {
    const onSynchroniser = jest.fn();
    await render(
      <IndicateurSynchro
        theme={theme}
        detaille
        synchro={{
          vue: { enCours: false, enLigne: false, enAttente: { cles: ['a', 'b', 'c'], essais: 1 } },
          onSynchroniser,
        }}
      />,
    );
    expect(screen.getByTestId('synchro-libelle').props.children).toBe('3 éléments en attente (hors ligne)');
    expect(screen.getByText('⧗', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('synchro-indicateur').props.accessibilityLabel).toContain('3 éléments en attente');
    await fireEvent.press(screen.getByTestId('synchro-maintenant'));
    expect(onSynchroniser).toHaveBeenCalledTimes(1);
  });

  it('pastille compacte : pas de bouton', async () => {
    await render(<IndicateurSynchro theme={theme} synchro={{ vue: { enCours: true }, onSynchroniser: jest.fn() }} />);
    expect(screen.getByTestId('synchro-libelle').props.children).toBe('Synchronisation…');
    expect(screen.queryByTestId('synchro-maintenant')).toBeNull();
  });
});

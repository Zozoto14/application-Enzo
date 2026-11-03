/**
 * Barre latérale de l'Esport : réduction en colonne d'icônes, préférence mémorisée par appareil,
 * raccourci Ctrl+B, réduction automatique sur fenêtre étroite.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { CLE_BARRE_REDUITE, CadreEsport } from './ui/CadreEsport';
import { Grille } from './ui/design';

const theme = themeHub('nuit');
type Touche = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; target: unknown; preventDefault(): void };
let ecouteurs: Array<(e: Touche) => void> = [];
const memoire = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
const origine = { add: g.addEventListener, rem: g.removeEventListener, ls: g.localStorage };

beforeEach(() => {
  memoire.clear();
  ecouteurs = [];
  g.addEventListener = (t: string, f: (e: Touche) => void) => {
    if (t === 'keydown') ecouteurs.push(f);
  };
  g.removeEventListener = (t: string, f: (e: Touche) => void) => {
    ecouteurs = ecouteurs.filter(x => x !== f);
  };
  g.localStorage = { getItem: (c: string) => memoire.get(c) ?? null, setItem: (c: string, v: string) => void memoire.set(c, v) };
});
afterEach(() => {
  g.addEventListener = origine.add;
  g.removeEventListener = origine.rem;
  g.localStorage = origine.ls;
});

const monter = () =>
  render(
    <CadreEsport theme={theme} large onglet="dashboard" onOnglet={() => undefined} pseudo="Léa">
      <Text>contenu</Text>
    </CadreEsport>,
  );
const touche = (extra: Partial<Touche> = {}): Touche => ({ key: 'b', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: jest.fn(), ...extra });

describe('barre latérale réductible', () => {
  it('bascule au bouton, annonce aria-expanded et mémorise le choix', async () => {
    memoire.set(CLE_BARRE_REDUITE, '0');
    await monter();
    const bouton = screen.getByTestId('esport-barre-bascule');
    expect(bouton.props.accessibilityState.expanded).toBe(true);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    await fireEvent.press(bouton);
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(false);
    expect(screen.queryByText('Dashboard')).toBeNull(); // libellés masqués
    expect(screen.getByTestId('esport-nav-dashboard').props.accessibilityLabel).toBeTruthy(); // nom accessible conservé
    expect(memoire.get(CLE_BARRE_REDUITE)).toBe('1');
    await fireEvent.press(screen.getByTestId('esport-barre-bascule'));
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(memoire.get(CLE_BARRE_REDUITE)).toBe('0');
  });

  it('relit la préférence mémorisée au montage', async () => {
    memoire.set(CLE_BARRE_REDUITE, '1');
    await monter();
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(false);
  });

  it('Ctrl+B (et ⌘B) bascule ; ignoré dans un champ de saisie ; Alt/Maj ignorés', async () => {
    memoire.set(CLE_BARRE_REDUITE, '0');
    await monter();
    const e = touche();
    await act(async () => ecouteurs.forEach(f => f(e)));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(false);
    await act(async () => ecouteurs.forEach(f => f(touche({ ctrlKey: false, metaKey: true }))));
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(true);
    await act(async () => ecouteurs.forEach(f => f(touche({ target: { tagName: 'TEXTAREA' } }))));
    await act(async () => ecouteurs.forEach(f => f(touche({ shiftKey: true }))));
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(true);
  });

  it('sans choix mémorisé, fenêtre étroite : réduite d’office ; un stockage qui échoue ne casse rien', async () => {
    g.localStorage = {
      getItem: () => {
        throw new Error('bloqué');
      },
      setItem: () => {
        throw new Error('bloqué');
      },
    };
    await monter();
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(false);
    await fireEvent.press(screen.getByTestId('esport-barre-bascule'));
    expect(screen.getByTestId('esport-barre-bascule').props.accessibilityState.expanded).toBe(true);
  });
});

describe('Grille', () => {
  it('plafonne la largeur des cartes', async () => {
    await render(
      <Grille min={200} testID="g">
        <Text>a</Text>
      </Grille>,
    );
    const item = screen.getByTestId('g').children[0] as unknown as { props: { style: { maxWidth: number } } };
    expect(item.props.style.maxWidth).toBe(320);
  });
});

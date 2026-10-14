/**
 * Verrouillage des apps sensibles, onglet par onglet : l'activité faite dans
 * un autre onglet ne garde pas ouvert un onglet masqué ; verrouiller l'un ne
 * verrouille pas l'autre.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ID_PRINCIPAL, type Profil } from '../../profils/profils';
import { Administration } from '../Administration';
import { AppAbonnements } from '../abonnements/AppAbonnements';
import { REGISTRE } from '../registre';
import { themeHub } from '../themes';
import type { ContexteHub, ServicesAdmin } from '../types';
import type { ControleProfils } from '../../ui/ecrans/CarteProfils';
import { PanneauOnglet } from './PanneauOnglet';

const theme = themeHub('nuit');
const fondateur: Profil = { id: ID_PRINCIPAL, nom: 'Enzo', admin: true, creeLe: '' };
const lea: Profil = { id: 'leaaaa0001', nom: 'Léa', admin: false, creeLe: '', apps: [], actif: true };

function contexte(): ContexteHub {
  const valeurs = new Map<string, string>();
  const stockage: ServicesAdmin['stockage'] = { lire: cle => valeurs.get(cle), ecrire: (cle, valeur) => void valeurs.set(cle, valeur) };
  const profils = {
    actuel: fondateur,
    tous: [fondateur, lea],
    onChanger: () => undefined,
    onAjouter: async () => undefined,
    onSupprimer: async () => undefined,
    onRenommer: async () => undefined,
    onCreerCompte: async () => ({}),
    onModifierProfils: async () => undefined,
  } as unknown as ControleProfils;
  return { profil: fondateur, profils, admin: { stockage, verifierIdentite: () => undefined, etatCoffre: () => undefined } };
}

const PLEIN = { gauche: 0, largeur: 1 };

function Onglets({ affiche, ctx }: { affiche: 'admin' | 'abo'; ctx: ContexteHub }) {
  const scene = React.useRef(null);
  return (
    <>
      <PanneauOnglet scene={scene} placement={affiche === 'admin' ? PLEIN : undefined} testID="panneau-admin">
        <Administration contexte={ctx} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
      </PanneauOnglet>
      <PanneauOnglet scene={scene} placement={affiche === 'abo' ? PLEIN : undefined} testID="panneau-abo">
        <AppAbonnements contexte={ctx} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
      </PanneauOnglet>
    </>
  );
}

async function avancer(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(Date.parse('2026-10-14T09:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('verrouillage par onglet des apps sensibles', () => {
  it('l’activité dans l’Administration ne garde pas ouvert l’onglet Abonnements masqué', async () => {
    const ctx = contexte();
    const vue = await render(<Onglets affiche="abo" ctx={ctx} />);
    expect(screen.getByTestId('app-abonnements')).toBeTruthy();
    // On passe à l'Administration ; Abonnements reste ouvert, masqué.
    await vue.rerender(<Onglets affiche="admin" ctx={ctx} />);
    // Sept minutes d'activité dans l'Administration (délai : 5 min).
    for (let minute = 0; minute < 7; minute++) {
      await fireEvent(screen.getByTestId('app-administration'), 'touchStart');
      await avancer(60_000);
    }
    expect(screen.getByTestId('app-administration')).toBeTruthy();
    expect(screen.queryByTestId('admin-verrouille')).toBeNull();
    // Retour sur Abonnements : verrouillé dès la première image.
    await vue.rerender(<Onglets affiche="abo" ctx={ctx} />);
    expect(screen.getByTestId('abonnements-verrouille')).toBeTruthy();
    expect(screen.queryByTestId('app-abonnements')).toBeNull();
    // Et l'Administration, elle, n'a pas été verrouillée pour autant.
    await vue.rerender(<Onglets affiche="admin" ctx={ctx} />);
    expect(screen.getByTestId('app-administration')).toBeTruthy();
  });

  it('déverrouiller une app sensible ne déverrouille pas l’autre', async () => {
    const ctx = contexte();
    const vue = await render(<Onglets affiche="admin" ctx={ctx} />);
    // L'Administration, laissée sans activité, se verrouille ; Abonnements, masqué, ne compte pas d'activité non plus.
    await avancer(6 * 60_000);
    expect(screen.getByTestId('admin-verrouille')).toBeTruthy();
    await vue.rerender(<Onglets affiche="abo" ctx={ctx} />);
    expect(screen.getByTestId('abonnements-verrouille')).toBeTruthy();
    // On déverrouille Abonnements (mot de passe + code)…
    await fireEvent.changeText(screen.getByTestId('admin-identite-mdp'), 'mot-de-passe');
    await fireEvent.changeText(screen.getByTestId('admin-identite-code'), '123456');
    await fireEvent.press(screen.getByTestId('admin-identite-valider'));
    await avancer(50);
    await avancer(50);
    expect(screen.getByTestId('app-abonnements')).toBeTruthy();
    // … l'Administration, elle, reste verrouillée.
    await vue.rerender(<Onglets affiche="admin" ctx={ctx} />);
    expect(screen.getByTestId('admin-verrouille')).toBeTruthy();
    expect(screen.queryByTestId('app-administration')).toBeNull();
  });
});

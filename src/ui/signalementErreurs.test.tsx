/**
 * Erreur d'affichage attrapée par une GardeErreur : signalée (statistiques d'usage, ~/logs/esport.log), y compris
 * quand elle survient avant l'ouverture de l'Esport (mise en attente, 5 au plus).
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { GardeErreur } from './GardeErreur';
import { ATTENTE_MAX, definirSignaleur, signalerErreur } from './signalementErreurs';

function Casse(): React.ReactElement {
  throw new TypeError('lecture de undefined');
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  definirSignaleur(undefined);
  jest.restoreAllMocks();
});

it('la GardeErreur signale l’erreur avec l’écran concerné, et affiche toujours « Affichage impossible »', async () => {
  const recus: string[] = [];
  definirSignaleur(m => recus.push(m));
  await render(
    <GardeErreur quoi="Tâches">
      <Casse />
    </GardeErreur>,
  );
  expect(screen.getByTestId('garde-erreur')).toBeTruthy();
  expect(recus).toEqual(['[Tâches] TypeError: lecture de undefined']);
});

it('sans destinataire : les dernières erreurs attendent, puis sont remises à l’inscription', () => {
  definirSignaleur(undefined);
  for (let i = 0; i < ATTENTE_MAX + 2; i++) signalerErreur(new Error(`e${i}`), 'hub');
  const recus: string[] = [];
  definirSignaleur(m => recus.push(m));
  expect(recus).toHaveLength(ATTENTE_MAX);
  expect(recus[0]).toBe('[hub] Error: e2');
  signalerErreur('direct');
  expect(recus.at(-1)).toBe('direct');
});

it('un destinataire qui lève ne casse rien', () => {
  definirSignaleur(() => {
    throw new Error('réseau');
  });
  expect(() => signalerErreur(new Error('x'))).not.toThrow();
});

/**
 * Chargement à la demande (src/ui/differe.tsx) : une seconde tentative si l'import échoue (réseau instable), puis
 * l'erreur remonte à la GardeErreur, qui reconnaît un morceau périmé (« Recharger ») ou propose « Réessayer », et
 * « Réessayer » redemande vraiment le module (React.lazy garde sinon l'échec en mémoire).
 */

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { differe, importerAvecReessai } from './differe';
import { GardeErreur } from './GardeErreur';
import { reinitialiserVersion } from './versionPerimee';

const Ecran = ({ nom }: { nom: string }) => <Text testID="ecran">{`Bonjour ${nom}`}</Text>;
const erreurChunk = () => new TypeError('Failed to fetch dynamically imported module: https://appdashboard.fr/assets/Taches-x1.js');

beforeEach(() => {
  reinitialiserVersion();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('importerAvecReessai', () => {
  it('rend le module du premier coup sans attendre', async () => {
    const charger = jest.fn(async () => 'module');
    await expect(importerAvecReessai(charger, 0)).resolves.toBe('module');
    expect(charger).toHaveBeenCalledTimes(1);
  });
  it('retente une fois après un échec (Wi-Fi qui décroche)', async () => {
    const charger = jest.fn().mockRejectedValueOnce(erreurChunk()).mockResolvedValueOnce('module');
    await expect(importerAvecReessai(charger, 0)).resolves.toBe('module');
    expect(charger).toHaveBeenCalledTimes(2);
  });
  it('remonte l’erreur après deux échecs (pas de boucle)', async () => {
    const charger = jest.fn().mockRejectedValue(erreurChunk());
    await expect(importerAvecReessai(charger, 0)).rejects.toThrow(/dynamically imported module/);
    expect(charger).toHaveBeenCalledTimes(2);
  });
});

describe('differe', () => {
  it('affiche l’attente puis l’écran, avec ses props', async () => {
    let livrer: (c: typeof Ecran) => void = () => undefined;
    const Differe = differe(() => new Promise<typeof Ecran>(ok => (livrer = ok)));
    await render(<Differe nom="Enzo" />);
    expect(screen.getByLabelText('Chargement')).toBeTruthy();
    await act(async () => livrer(Ecran));
    expect(await screen.findByText('Bonjour Enzo')).toBeTruthy();
  });

  it('n’importe le module qu’une fois, même préchargé puis affiché deux fois', async () => {
    const charger = jest.fn(async () => Ecran);
    const Differe = differe(charger);
    await Differe.precharger();
    await render(
      <>
        <Differe nom="A" />
        <Differe nom="B" />
      </>,
    );
    expect(await screen.findByText('Bonjour B')).toBeTruthy();
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it('morceau périmé : la GardeErreur affiche « Recharger » au lieu du message technique', async () => {
    const Differe = differe<{ nom: string }>(() => Promise.reject(erreurChunk()), { pauseReessaiMs: 0 });
    await render(
      <GardeErreur quoi="Tâches">
        <Differe nom="X" />
      </GardeErreur>,
    );
    expect(await screen.findByTestId('garde-erreur-version')).toBeTruthy();
    expect(screen.queryByTestId('garde-erreur-message')).toBeNull();
  });

  it('autre échec : « Réessayer » redemande le module et l’écran s’affiche', async () => {
    let tentatives = 0;
    const Differe = differe(
      async () => {
        tentatives++;
        if (tentatives <= 2) throw new Error('serveur indisponible');
        return Ecran;
      },
      { pauseReessaiMs: 0 },
    );
    await render(
      <GardeErreur quoi="Tâches">
        <Differe nom="Enzo" />
      </GardeErreur>,
    );
    expect(await screen.findByTestId('garde-erreur')).toBeTruthy();
    expect(tentatives).toBe(2);
    await act(async () => {
      fireEvent.press(screen.getByTestId('garde-erreur-reessayer'));
    });
    expect(await screen.findByText('Bonjour Enzo')).toBeTruthy();
    expect(tentatives).toBe(3);
  });

  it('précharger ne lève jamais (hors ligne)', async () => {
    const Differe = differe(() => Promise.reject(new Error('hors ligne')), { pauseReessaiMs: 0 });
    await expect(Differe.precharger()).resolves.toBeUndefined();
  });
});

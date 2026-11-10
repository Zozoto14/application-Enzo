/**
 * Administration › Utilisateurs, comptes dont le prénom manque (docs/diagnostic-comptes.md) : nom de
 * repli (pseudo Esport, e-mail masqué), jamais d'avatar « ( », réparation à partir du journal et de
 * l'Esport, invitation bloquée tant que le prénom manque ; diagnostic de connexion et « Débloquer ».
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ID_PRINCIPAL, NOM_INCONNU, type Profil } from '../../../profils/profils';
import { Administration } from '../../Administration';
import { REGISTRE } from '../../registre';
import { themeHub } from '../../themes';
import type { ContexteHub, ServicesAdmin } from '../../types';
import type { ControleProfils } from '../../../ui/ecrans/CarteProfils';
import { avecEvenement, chargerDonnees, enregistrerDonnees } from '../donnees';
import type { DiagnosticConnexion } from '../diagnostic';

jest.mock('../../../esport/synchroAdmin', () => ({
  ...jest.requireActual('../../../esport/synchroAdmin'),
  pseudosEsport: jest.fn(async () => ({ kai0000001: 'Kaizen' })),
}));

const theme = themeHub('nuit');
const MAINTENANT = Date.parse('2026-11-10T10:00:00Z');
const fondateur: Profil = { id: ID_PRINCIPAL, nom: 'Moi', admin: true, creeLe: '' };
const inconnu = (id: string): Profil => ({ id, nom: NOM_INCONNU, nomInconnu: true, admin: false, creeLe: '2026-10-01', apps: ['esport'], actif: true, derniereConnexion: '2026-11-10T09:00:00Z' });
const kai = inconnu('kai0000001');
const lyra = inconnu('lyr0000002');
const rook = inconnu('roo0000003');

function contexte(options: Partial<ControleProfils> = {}) {
  const valeurs = new Map<string, string>();
  const stockage: ServicesAdmin['stockage'] = { lire: cle => valeurs.get(cle), ecrire: (cle, valeur) => void valeurs.set(cle, valeur) };
  let donnees = chargerDonnees(stockage);
  donnees = { ...donnees, contacts: { lyr0000002: { email: 'lyra.martin@gmail.com' } } as never };
  donnees = avecEvenement(donnees, { type: 'invitation', cible: 'roo0000003', nomCible: 'Rook', action: 'Invitation de Rook transmise' }, MAINTENANT - 86_400_000);
  enregistrerDonnees(stockage, donnees);
  const reparations: Array<Readonly<Record<string, readonly string[]>>> = [];
  const profils = {
    actuel: fondateur,
    tous: [fondateur, kai, lyra, rook],
    onChanger: () => undefined,
    onAjouter: async () => undefined,
    onSupprimer: async () => undefined,
    onRenommer: async () => undefined,
    onModifierProfils: async () => undefined,
    onReparerNoms: async (c: Readonly<Record<string, readonly string[]>>) => {
      reparations.push(c);
      return { repares: { kai0000001: 'Kaizen', roo0000003: 'Rook' }, restants: ['lyr0000002'] };
    },
    ...options,
  } as unknown as ControleProfils;
  const ctx: ContexteHub = { profil: fondateur, profils, admin: { stockage, verifierIdentite: () => undefined, etatCoffre: () => undefined }, maintenant: MAINTENANT };
  return { ctx, reparations };
}

const rendre = async (ctx: ContexteHub) => {
  await render(<Administration contexte={ctx} theme={theme} registre={REGISTRE} onRetour={() => undefined} />);
  await fireEvent.press(screen.getByTestId('admin-onglet-utilisateurs'));
  await act(async () => undefined);
};

describe('Administration : prénoms perdus', () => {
  it('repli lisible : pseudo Esport, puis e-mail masqué, puis identifiant ; jamais « ( » en avatar', async () => {
    const { ctx } = contexte();
    await rendre(ctx);
    expect(screen.getByTestId('admin-nom-kai0000001').props.children).toBe('Kaizen');
    expect(screen.getByTestId('admin-nom-lyr0000002').props.children).toBe('l•••n@g•••l.com');
    expect(screen.getByTestId('admin-nom-roo0000003').props.children).toBe('Compte roo000');
    for (const id of ['kai0000001', 'lyr0000002', 'roo0000003']) expect(screen.getByTestId(`admin-initiale-${id}`).props.children).not.toBe('(');
    expect(screen.getByTestId('admin-initiale-kai0000001').props.children).toBe('K');
    expect(screen.getByTestId('admin-noms-inconnus')).toBeTruthy();
    // L'adresse complète n'apparaît nulle part.
    expect(screen.queryByText(/lyra\.martin@gmail\.com/)).toBeNull();
  });

  it('« Réparer les prénoms » : candidats du journal et de l’Esport, bilan clair', async () => {
    const { ctx, reparations } = contexte();
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-reparer-noms'));
    await waitFor(() => expect(reparations).toHaveLength(1));
    expect(reparations[0]).toEqual({ kai0000001: ['Kaizen'], roo0000003: ['Rook'] });
    expect(await screen.findByText(/2 prénoms retrouvés et vérifiés\. Reste 1 à saisir/)).toBeTruthy();
  });

  it('fiche : diagnostic de connexion (cause, tentatives sans secret) et « Débloquer »', async () => {
    const diag: DiagnosticConnexion = {
      tentatives: [
        { le: '2026-11-10T09:58:00.000Z', issue: 'verrouille', ip: '203.0.113.x' },
        { le: '2026-11-10T09:57:00.000Z', issue: 'mauvais-mot-de-passe', ip: '203.0.113.x' },
        { le: '2026-11-09T18:00:00.000Z', issue: 'succes', ip: '198.51.100.x' },
      ],
      verrou: { echecs: 6, jusqua: MAINTENANT + 60_000 },
      adresses: [],
      inconnus: [],
      revoque: false,
      heure: MAINTENANT,
    };
    const debloquer = jest.fn(async () => 1);
    const { ctx } = contexte({ diagnosticConnexion: async () => diag, onDebloquerConnexion: debloquer, onRevoquerConnexion: async () => undefined, etatConnexion: async () => ({ revoque: false }) });
    await rendre(ctx);
    await fireEvent.press(screen.getByTestId('admin-ligne-kai0000001'));
    await act(async () => undefined);
    expect(screen.getByTestId('admin-fiche-nom-inconnu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('admin-diagnostic-voir'));
    await act(async () => undefined);
    expect(screen.getByTestId('admin-diagnostic-cause').props.children).toMatch(/Bloqué en ce moment/);
    expect(screen.getByTestId('admin-diagnostic-tentative-1').props.children.join('')).toMatch(/Mauvais mot de passe · connexion 203\.0\.113\.x/);
    await fireEvent.press(screen.getByTestId('admin-diagnostic-debloquer'));
    await waitFor(() => expect(debloquer).toHaveBeenCalledWith('kai0000001'));
  });
});

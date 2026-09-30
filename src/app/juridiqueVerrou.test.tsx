/**
 * Démarrage à froid : le thème et les préférences d'affichage sont ceux du
 * dernier lancement dès la première image, avant même le déverrouillage, puis
 * réconciliés avec le profil sans repasser par un thème par défaut.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { doitAccepter, lireAcceptations, versionJuridique } from '../juridique/modele';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { codeTotp } from '../securite/totp';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import * as theme from '../ui/theme';
import { CLE_VERROU_AUTO_ESSAI_MS } from '../securite/verrouAuto';
import { App } from './App';

const KDF_RAPIDE: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';
const INSTANT = 1_700_000_000_000;

/** `preparer` écrit dans la base à chaque ouverture (en test, chaque déverrouillage repart d'une base neuve). */
function creerSession(preparer?: (depot: DepotParametres) => void) {
  return new Session({
    stockage: stockageMemoire(),
    ouvrirBase: () => {
      const base = ouvrirBaseNode();
      migrer(base);
      preparer?.(new DepotParametres(base));
      return base;
    },
    horloge: () => INSTANT,
    alea: aleatoireDeterministe(1),
    kdf: KDF_RAPIDE,
  });
}

function stockageLocal(initial: Record<string, string>) {
  const valeurs = new Map(Object.entries(initial));
  return {
    valeurs,
    getItem: (cle: string) => valeurs.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
  };
}

async function deverrouiller(secretTotp: string) {
  await fireEvent.changeText(screen.getByLabelText('Mot de passe'), MOT_DE_PASSE);
  await fireEvent.changeText(screen.getByLabelText("Code d'authentification"), codeTotp(secretTotp, INSTANT));
  await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
  await laisserTravailler();
  await laisserTravailler();
}

async function laisserTravailler() {
  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
}


let local: ReturnType<typeof stockageLocal>;

beforeEach(() => {
  jest.useFakeTimers();
  local = stockageLocal({});
  (globalThis as { localStorage?: unknown }).localStorage = local;
  theme.relireThemeMemorise();
});
afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  theme.relireThemeMemorise();
  theme.definirTheme('nuit');
});

describe('documents légaux et verrouillage automatique dans l’application', () => {
  it('l’écran de connexion propose les quatre documents, lisibles sans être connecté', async () => {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();
    await render(<App session={session} hub />);
    for (const id of ['conditions', 'confidentialite', 'cookies', 'mentions']) expect(screen.getByTestId(`lien-juridique-${id}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lien-juridique-cookies'));
    expect(screen.getByText('Cookies et stockage local')).toBeTruthy();
    expect(screen.getByTestId('juridique-avertissement')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('juridique-fermer'));
    await fireEvent.press(screen.getByTestId('juridique-fermer'));
    expect(screen.getByTestId('bouton-deverrouiller')).toBeTruthy();
  });

  it('première connexion : acceptation exigée (avec date et version journalisées), puis le hub', async () => {
    const session = creerSession();
    const { secretTotp } = session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();
    await render(<App session={session} hub />);
    await deverrouiller(secretTotp);
    expect(screen.getByTestId('acceptation-juridique')).toBeTruthy();
    expect(screen.queryByTestId('hub')).toBeNull();
    await fireEvent.press(screen.getByTestId('acceptation-continuer'));
    expect(screen.getByTestId('acceptation-juridique')).toBeTruthy(); // case non cochée
    await fireEvent.press(screen.getByTestId('acceptation-case'));
    await fireEvent.press(screen.getByTestId('acceptation-continuer'));
    await laisserTravailler();
    expect(screen.queryByTestId('acceptation-juridique')).toBeNull();
    expect(screen.getByTestId('hub')).toBeTruthy();
    const acceptations = lireAcceptations(new DepotParametres(session.base()).lire(PARAMETRES.acceptationsJuridiques));
    expect(acceptations).toHaveLength(1);
    expect(doitAccepter(acceptations, versionJuridique(undefined))).toBe(false);
    expect(acceptations[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('une version différente des documents redemande l’acceptation', async () => {
    const session = creerSession(depot => depot.ecrire(PARAMETRES.acceptationsJuridiques, JSON.stringify([{ version: '0.9', date: '2026-01-01T00:00:00Z' }])));
    const { secretTotp } = session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();
    await render(<App session={session} hub />);
    await deverrouiller(secretTotp);
    expect(screen.getByText('Nos documents ont changé')).toBeTruthy();
  });

  it('se verrouille seul après le délai (essai court) et le dit sur l’écran de connexion', async () => {
    local.valeurs.set(CLE_VERROU_AUTO_ESSAI_MS, '1000');
    const session = creerSession(depot => depot.ecrire(PARAMETRES.acceptationsJuridiques, JSON.stringify([{ version: versionJuridique(undefined), date: '2026-01-01T00:00:00Z' }])));
    const { secretTotp } = session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();
    await render(<App session={session} hub />);
    await deverrouiller(secretTotp);
    expect(screen.getByTestId('hub')).toBeTruthy();
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    }
    expect(screen.queryByTestId('hub')).toBeNull();
    expect(screen.getByTestId('bouton-deverrouiller')).toBeTruthy();
    expect(screen.getByTestId('message-deverrouillage').props.children).toContain('inactivité');
    expect(session.statut()).toBe('verrouille');
  });
});

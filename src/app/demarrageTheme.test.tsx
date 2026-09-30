/**
 * Démarrage à froid : le thème et les préférences d'affichage sont ceux du
 * dernier lancement dès la première image, avant même le déverrouillage, puis
 * réconciliés avec le profil sans repasser par un thème par défaut.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DepotParametres, PARAMETRES } from '../db/depots';
import { versionJuridique } from '../juridique/modele';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { CLE_PREFS, CLE_THEME } from '../hub/personnalisation';
import { CLE_CACHE_AFFICHAGE, CLE_CACHE_THEME } from '../hub/themeUnique';
import { codeTotp } from '../securite/totp';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import * as theme from '../ui/theme';
import { App } from './App';

const KDF_RAPIDE: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';
const IVOIRE_FOND = '#F6F3EC';
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

/** Tous les fonds « backgroundColor » présents dans l'arbre rendu. */
const fondsRendus = () => new Set(JSON.stringify(screen.toJSON()).match(/"backgroundColor":"#[0-9A-Fa-f]{6}"/g) ?? []);

let local: ReturnType<typeof stockageLocal>;
let themesVus: string[];

beforeEach(() => {
  jest.useFakeTimers();
  themesVus = [];
  const reel = theme.palettePour;
  jest.spyOn(theme, 'palettePour').mockImplementation((sombre?: boolean) => {
    // Chaque image qui lit une palette note le thème qui la fournit : aucun ne doit être un thème par défaut.
    themesVus.push(theme.themeCourant());
    return reel(sombre);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  theme.relireThemeMemorise();
  theme.definirTheme('nuit');
});

describe('lancement à froid avec le thème « Ivoire » mémorisé', () => {
  it('l’écran de connexion est déjà en Ivoire, avant tout déverrouillage', async () => {
    local = stockageLocal({ [CLE_CACHE_THEME]: 'ivoire' });
    (globalThis as { localStorage?: unknown }).localStorage = local;
    theme.relireThemeMemorise();
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();

    await render(<App session={session} />);

    expect(screen.getByTestId('bouton-deverrouiller')).toBeTruthy();
    expect(theme.themeCourant()).toBe('ivoire');
    expect(fondsRendus().has(`"backgroundColor":"${IVOIRE_FOND}"`)).toBe(true);
    expect(new Set(themesVus)).toEqual(new Set(['ivoire']));
  });

  it('reste en Ivoire au déverrouillage, sans image intermédiaire dans un autre thème', async () => {
    local = stockageLocal({ [CLE_CACHE_THEME]: 'ivoire' });
    (globalThis as { localStorage?: unknown }).localStorage = local;
    theme.relireThemeMemorise();
    const session = creerSession(depot => depot.ecrire(CLE_THEME, 'ivoire'));
    const { secretTotp } = session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();

    await render(<App session={session} />);
    await deverrouiller(secretTotp);

    expect(screen.queryByTestId('bouton-deverrouiller')).toBeNull();
    expect(theme.themeCourant()).toBe('ivoire');
    expect(new Set(themesVus)).toEqual(new Set(['ivoire']));
  });

  it('applique aussitôt le thème du profil quand il diffère du cache, et le mémorise', async () => {
    local = stockageLocal({ [CLE_CACHE_THEME]: 'ivoire' });
    (globalThis as { localStorage?: unknown }).localStorage = local;
    theme.relireThemeMemorise();
    // Un autre appareil a changé le thème : la base du profil fait foi après déverrouillage.
    const session = creerSession(depot => depot.ecrire(CLE_THEME, 'terminal'));
    const { secretTotp } = session.initialiser({ motDePasse: MOT_DE_PASSE });
    session.verrouiller();

    await render(<App session={session} />);
    expect(theme.themeCourant()).toBe('ivoire');
    await deverrouiller(secretTotp);

    expect(theme.themeCourant()).toBe('terminal');
    expect(local.valeurs.get(CLE_CACHE_THEME)).toBe('terminal');
  });
});

describe('thème unique et migration au déverrouillage', () => {
  it('le portefeuille adopte l’ancien thème quand le hub n’en a pas encore', async () => {
    local = stockageLocal({});
    (globalThis as { localStorage?: unknown }).localStorage = local;
    theme.relireThemeMemorise();
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    new DepotParametres(session.base()).ecrire(PARAMETRES.theme, 'sauge');

    await render(<App session={session} />);
    await laisserTravailler();

    expect(new DepotParametres(session.base()).lire(CLE_THEME)).toBe('sauge');
    expect(theme.themeCourant()).toBe('sauge');
    expect(theme.palettePour().fond).toBe('#EEF2EC');
  });

  it('le hub garde ses préférences d’affichage dès la première image', async () => {
    local = stockageLocal({ [CLE_CACHE_THEME]: 'nuit', [CLE_CACHE_AFFICHAGE]: '{"densite":"compact","disposition":"liste"}' });
    (globalThis as { localStorage?: unknown }).localStorage = local;
    theme.relireThemeMemorise();
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    new DepotParametres(session.base()).ecrire(PARAMETRES.acceptationsJuridiques, JSON.stringify([{ version: versionJuridique(undefined), date: '2026-10-06T10:00:00.000Z' }]));
    new DepotParametres(session.base()).ecrire(CLE_PREFS, '{"version":1,"ordre":[],"tailles":{},"masquees":[],"epinglees":[],"densite":"compact","disposition":"liste"}');

    await render(<App session={session} hub />);
    await laisserTravailler();

    expect(screen.queryByTestId('hub')).toBeTruthy();
    // La disposition « liste » est en place (tuiles en liste : largeur pleine).
    expect(local.valeurs.get(CLE_CACHE_AFFICHAGE)).toContain('"liste"');
  });
});

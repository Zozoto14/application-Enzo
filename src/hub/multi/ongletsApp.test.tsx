import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DepotParametres, PARAMETRES } from '../../db/depots';
import { versionJuridique } from '../../juridique/modele';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { codeTotp } from '../../securite/totp';
import { aleatoireDeterministe } from '../../securite/aleatoire';
import type { ParametresKdf } from '../../securite/kdf';
import { Session } from '../../session/session';
import { stockageMemoire } from '../../session/stockage-coffre';
import * as theme from '../../ui/theme';
import { App } from '../../app/App';
import { ModeAffichageForce } from '../../ui/mobile/useMobile';
import type { ContexteAnnexe } from './fenetres';

const KDF_RAPIDE: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';
const INSTANT = 1_700_000_000_000;

function creerSession() {
  return new Session({
    stockage: stockageMemoire(),
    ouvrirBase: () => {
      const base = ouvrirBaseNode();
      migrer(base);
      new DepotParametres(base).ecrire(PARAMETRES.acceptationsJuridiques, JSON.stringify([{ version: versionJuridique(undefined), date: '2026-01-01T00:00:00Z' }]));
      return base;
    },
    horloge: () => INSTANT,
    alea: aleatoireDeterministe(1),
    kdf: KDF_RAPIDE,
  });
}

async function laisserTravailler() {
  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
}

async function ouvrirLeHub(telephone = false) {
  const session = creerSession();
  const { secretTotp } = session.initialiser({ motDePasse: MOT_DE_PASSE });
  session.verrouiller();
  await render(telephone ? <ModeAffichageForce mode="telephone"><App session={session} hub /></ModeAffichageForce> : <App session={session} hub />);
  await fireEvent.changeText(screen.getByLabelText('Mot de passe'), MOT_DE_PASSE);
  await fireEvent.changeText(screen.getByLabelText("Code d'authentification"), codeTotp(secretTotp, INSTANT));
  await fireEvent.press(screen.getByTestId('bouton-deverrouiller'));
  await laisserTravailler();
  await laisserTravailler();
  return session;
}

function stockageLocal(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return { valeurs, getItem: (cle: string) => valeurs.get(cle) ?? null, setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur), removeItem: (cle: string) => void valeurs.delete(cle) };
}
let local: ReturnType<typeof stockageLocal>;
const g = globalThis as { localStorage?: unknown; location?: unknown; history?: unknown };

beforeEach(() => {
  jest.useFakeTimers();
  local = stockageLocal();
  g.localStorage = local;
  theme.relireThemeMemorise();
});
afterEach(() => {
  jest.useRealTimers();
  delete g.localStorage;
  delete g.location;
  delete g.history;
  theme.relireThemeMemorise();
  theme.definirTheme('nuit');
});

const presser = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
  await laisserTravailler();
};

describe('onglets d’apps dans l’hôte', () => {
  it('ouvrir, garder l’état en revenant, ouvrir en arrière-plan, fermer, mémoriser', async () => {
    await ouvrirLeHub();
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.queryByTestId('onglets-barre')).toBeNull();

    // Une tuile ouvre l'app dans un onglet.
    await presser('tuile-taches');
    expect(screen.getByTestId('app-taches')).toBeTruthy();
    expect(screen.getByTestId('onglets-app-taches')).toBeTruthy();
    // Un état non enregistré dans l'app : une recherche en cours.
    await presser('taches-demo');
    await fireEvent.changeText(screen.getByTestId('taches-recherche'), 'Atelier');

    // Retour au hub par la barre : l'app reste ouverte.
    await presser('onglets-hub');
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.getByTestId('tuile-taches-ouverte')).toBeTruthy();

    // Appui long sur une tuile : nouvel onglet, sans quitter le hub.
    await fireEvent(screen.getByTestId('tuile-tsuzuku'), 'longPress');
    await laisserTravailler();
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.getByTestId('onglets-app-tsuzuku')).toBeTruthy();
    expect(screen.getByTestId('onglets-annonce').props.children).toContain('Tsuzuku ouverte dans un nouvel onglet');

    // De retour sur Tâches : la saisie est toujours là.
    await presser('onglets-app-taches-ouvrir');
    expect(screen.getByTestId('taches-recherche').props.value).toBe('Atelier');

    // Fermer l'onglet affiché : son voisin prend la place.
    await presser('onglets-app-taches-fermer');
    expect(screen.queryByTestId('onglets-app-taches')).toBeNull();
    expect(screen.getByTestId('onglets-app-tsuzuku')).toBeTruthy();

    // Mémoire de l'appareil : la liste des onglets.
    expect(JSON.parse(local.valeurs.get('applibourse.onglets') ?? '{}').ouverts).toEqual(['tsuzuku']);
  });

  it('au redémarrage : onglets restaurés sur le hub, droits revérifiés', async () => {
    local.valeurs.set('applibourse.onglets', JSON.stringify({ v: 1, ouverts: ['taches', 'administration', '../x'], ratio: 0.5 }));
    await ouvrirLeHub();
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.getByTestId('onglets-app-taches')).toBeTruthy();
    // L'Administration n'est pas ouverte à ce compte (appareil sans profils) : pas d'onglet.
    expect(screen.queryByTestId('onglets-app-administration')).toBeNull();
    // Rien ne s'ouvre seul : l'app n'est montée qu'une fois choisie.
    expect(screen.queryByTestId('app-taches')).toBeNull();
    await presser('onglets-app-taches-ouvrir');
    expect(screen.getByTestId('app-taches')).toBeTruthy();
  });

  it('lien profond : l’app s’ouvre directement après le déverrouillage, puis le lien s’efface', async () => {
    const remplacer = jest.fn();
    g.history = { replaceState: remplacer };
    g.location = { hash: '#/app/taches', href: 'https://site.exemple/#/app/taches' };
    await ouvrirLeHub();
    expect(screen.getByTestId('app-taches')).toBeTruthy();
    expect(remplacer).toHaveBeenCalledWith(null, '', 'https://site.exemple/');
  });

  it('lien profond vers une app interdite : on reste sur le hub, avec un avis', async () => {
    g.history = { replaceState: jest.fn() };
    g.location = { hash: '#/app/administration', href: 'https://site.exemple/#/app/administration' };
    await ouvrirLeHub();
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.getByTestId('avis-onglets')).toBeTruthy();
    expect(screen.queryByTestId('onglets-app-administration')).toBeNull();
  });

  it('« ← Hub » revient à la page d’origine de l’app', async () => {
    await ouvrirLeHub();
    await presser('tuile-taches');
    await presser('retour-hub');
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(screen.getByTestId('hub-grille-publique')).toBeTruthy();
  });

  it('téléphone : pas de côte à côte ni de barre, un sélecteur compact dans l’en-tête', async () => {
    await ouvrirLeHub(true);
    expect(screen.queryByTestId('onglets-mobile-ouvrir')).toBeNull();
    await presser('tuile-taches');
    expect(screen.queryByTestId('onglets-barre')).toBeNull();
    await presser('onglets-mobile-ouvrir');
    expect(screen.getByTestId('onglets-mobile-taches')).toBeTruthy();
    await presser('onglets-mobile-hub');
    expect(screen.getByTestId('hub')).toBeTruthy();
    // Sur l'accueil aussi, le sélecteur ramène à l'app ouverte.
    await presser('onglets-mobile-ouvrir');
    await presser('onglets-mobile-taches');
    expect(screen.getByTestId('app-taches')).toBeTruthy();
  });
});

describe('fenêtre annexe (app de bureau)', () => {
  it('une seule app, sur la session partagée (pas de second déverrouillage) ; « ← Hub » rend la main à la fenêtre principale', async () => {
    const session = creerSession();
    session.initialiser({ motDePasse: MOT_DE_PASSE });
    const verrouiller = jest.fn();
    const revenir = jest.fn();
    const annexe: ContexteAnnexe = {
      version: 1,
      app: 'taches',
      session,
      profils: () => undefined,
      verrouiller,
      activite: jest.fn(),
      lecture: jest.fn(),
      ecrire: action => action(),
      ecouter: () => () => undefined,
      revenir,
      fermee: jest.fn(),
    };
    await render(<App session={session} hub annexe={annexe} />);
    await laisserTravailler();
    expect(screen.getByTestId('app-taches')).toBeTruthy();
    expect(screen.queryByTestId('hub')).toBeNull();
    expect(screen.queryByTestId('onglets-barre')).toBeNull();
    await presser('retour-hub');
    expect(revenir).toHaveBeenCalled();
    expect(session.statut()).toBe('deverrouille');
  });
});


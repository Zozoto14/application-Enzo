/**
 * Devblog (docs/esport/devblog.md) : fenêtre « Nouveautés » à l'entrée dans l'app (dans la langue du compte,
 * « J'ai compris » marque vu en base, « Voir tous les devblogs »), historique depuis le Dashboard, éditeur
 * (aperçu Discord découpé, IA), publication Discord ; rendu local identique à celui du serveur.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { oublierSessions, type ClientEsport } from './client';
import { Esport, fabrique } from './ui/RacineEsport';
import { definirLangue } from './i18n';
import type { ContenuDevblog, EntreeDevblog } from './devblog/api';
import { decouperDiscord, texteDiscord } from './devblog/rendu';
import { PageDevblog } from './ui/devblog/PageDevblog';
// Rendu du serveur (référence) : l'aperçu local doit être identique.
import * as serveur from '../../esport/noyau/devblog/regles.mjs';
import * as premier from '../../esport/noyau/devblog/premier.mjs';

const theme = themeHub('nuit');
const relaisReel = fabrique.relais;
const clientReel = fabrique.client;

afterEach(() => {
  fabrique.relais = relaisReel;
  fabrique.client = clientReel;
  oublierSessions();
  definirLangue('fr');
});

const FR: ContenuDevblog = {
  titre: 'Nouvelle Mise à Jour !',
  intro: 'Salut à tous ! Voici ce qui change :',
  sections: [{ emoji: '📊', titre: 'Nouvelles Fonctionnalités', puces: [{ nom: 'Page Statistiques', description: 'Un meilleur suivi global.' }] }],
  conclusion: 'Merci pour vos retours ! 🚀',
};
const EN: ContenuDevblog = {
  titre: 'New Update!',
  intro: 'Hi everyone! Here’s what’s new:',
  sections: [{ emoji: '📊', titre: 'New Features', puces: [{ nom: 'Statistics page', description: 'Better overall tracking.' }] }],
  conclusion: 'Thanks for your feedback! 🚀',
};
const ENTREE: EntreeDevblog = { id: 'devblog-1', statut: 'publie', date: '2026-10-30', version: null, fr: FR, en: EN, publieLe: '2026-10-30T10:00:00.000Z' };

function fauxClient(requete: jest.Mock, moi: Record<string, unknown> = {}): ClientEsport {
  const compte = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false, ...moi };
  return {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => compte,
    moi: async () => compte,
    teams: async () => [],
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ teams: [], attente: 0, nouveaux: 0 }),
    requete,
  } as unknown as ClientEsport;
}

function serveurFaux({ nouveaute = ENTREE as EntreeDevblog | null, gestion = false } = {}) {
  return jest.fn(async (chemin: string, methode = 'GET', corps?: unknown) => {
    if (chemin === '/devblog/nouveautes') return { entree: nouveaute };
    if (chemin === '/devblog' && methode === 'GET') return { entrees: [ENTREE], gestion };
    if (/^\/devblog\/[^/]+\/vu$/.test(chemin)) return { ok: true };
    if (chemin === '/devblog/ia/traduire') return { en: { ...EN, titre: 'Translated!' }, moteur: 'api2', corps };
    if (chemin === '/devblog/salons') return { salons: [{ cle: 'salon:s1', genre: 'club', nom: 'annonces', detail: 'webhook …abcd', invalide: false }], defaut: ['salon:s1'], salonBot: null };
    if (/\/discord\?here=/.test(chemin)) return { apercu: { en: ['EN 1'], fr: ['FR 1'] }, pretAPublier: true, publications: [] };
    if (/\/discord$/.test(chemin) && methode === 'POST') return { apercu: { en: ['EN 1'], fr: ['FR 1'] }, pretAPublier: true, publications: [], resultats: [{ cible: 'salon:s1', etat: 'publication' }] };
    if (/^\/cm\//.test(chemin)) throw new Error('pas de CM');
    return { ok: true };
  });
}

async function monter(client: ClientEsport, mode: 'large' | 'telephone' = 'large') {
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: `p1.lea12345.${'a'.repeat(64)}` });
  fabrique.client = () => client;
  return render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{ profil: { id: 'lea12345', nom: 'Léa', admin: false, creeLe: '', apps: ['esport'] } }} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

describe('fenêtre Nouveautés', () => {
  it('à l’entrée : le dernier devblog non vu, dans la DA ; « J’ai compris » le marque vu (serveur) et ferme', async () => {
    const requete = serveurFaux();
    await monter(fauxClient(requete));
    expect(await screen.findByTestId('esport-nouveautes')).toBeTruthy();
    expect(screen.getByText('🚀 Nouvelle Mise à Jour ! 🛠️')).toBeTruthy();
    expect(screen.getByText('📊  Nouvelles Fonctionnalités')).toBeTruthy();
    expect(screen.getByText('Page Statistiques : ')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-nouveautes-compris'));
    });
    expect(requete).toHaveBeenCalledWith('/devblog/devblog-1/vu', 'POST', {});
    expect(screen.queryByTestId('esport-nouveautes')).toBeNull();
  });

  it('dans la langue du compte (anglais) ; rien quand tout est vu ; ancien serveur : rien, sans plantage', async () => {
    await monter(fauxClient(serveurFaux(), { langue: 'en' }));
    expect(await screen.findByTestId('esport-nouveautes')).toBeTruthy();
    expect(screen.getByText('🚀 New Update! 🛠️')).toBeTruthy();
    expect(screen.getByText('Statistics page: ')).toBeTruthy();
    expect(screen.getByText('Got it')).toBeTruthy();
    await screen.unmount();
    definirLangue('fr');
    await monter(fauxClient(serveurFaux({ nouveaute: null })));
    await screen.findByTestId('esport-dashboard');
    expect(screen.queryByTestId('esport-nouveautes')).toBeNull();
    await screen.unmount();
    const ancien = jest.fn(async () => {
      throw new Error('Adresse inconnue.');
    });
    await monter(fauxClient(ancien));
    await screen.findByTestId('esport-dashboard');
    expect(screen.queryByTestId('esport-nouveautes')).toBeNull();
  });

  it('« Voir tous les devblogs » : historique (marqué vu) ; le Dashboard y mène aussi, sans nouvelle entrée de barre du bas', async () => {
    const requete = serveurFaux();
    await monter(fauxClient(requete), 'telephone');
    await screen.findByTestId('esport-nouveautes');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-nouveautes-tous'));
    });
    expect(requete).toHaveBeenCalledWith('/devblog/devblog-1/vu', 'POST', {});
    expect(await screen.findByTestId('esport-devblog')).toBeTruthy();
    expect(screen.getByTestId('esport-devblog-devblog-1')).toBeTruthy();
    expect(screen.queryByTestId('esport-devblog-nouveau')).toBeNull();
    // Barre du bas inchangée (Dashboard · Teams · Membres).
    expect(screen.queryByTestId('esport-nav-devblog')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-devblog-retour'));
    });
    const bouton = await screen.findByTestId('esport-dashboard-devblog');
    await act(async () => {
      fireEvent.press(bouton);
    });
    expect(await screen.findByTestId('esport-devblog')).toBeTruthy();
  });
});

describe('éditeur du devblog', () => {
  it('gestion : brouillons, éditeur, aperçu Discord en direct, IA pour l’anglais, publication Discord', async () => {
    const requete = serveurFaux({ gestion: true });
    const client = fauxClient(requete, { superAdmin: true, peutGererDevblog: true });
    await render(<PageDevblog theme={theme} client={client} large />);
    const modifier = await screen.findByTestId('esport-devblog-devblog-1-modifier');
    await act(async () => {
      fireEvent.press(modifier);
    });
    expect(screen.getByTestId('esport-devblog-editeur')).toBeTruthy();
    expect(screen.getByTestId('esport-devblog-apercu-discord-en-0')).toBeTruthy();
    expect(screen.getByTestId('esport-devblog-apercu-discord-fr-0')).toBeTruthy();
    // Modification en direct : l'aperçu suit.
    await fireEvent.changeText(screen.getByTestId('esport-devblog-fr-section-0-puce-0-nom'), 'Statistiques');
    expect(screen.getByTestId('esport-devblog-modifie')).toBeTruthy();
    // Version anglaise par l'IA.
    await fireEvent.press(screen.getByTestId('esport-devblog-langue-en'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-devblog-ia'));
    });
    expect(requete).toHaveBeenCalledWith('/devblog/ia/traduire', 'POST', { fr: expect.objectContaining({ titre: 'Nouvelle Mise à Jour !' }) });
    expect(screen.getByDisplayValue('Translated!')).toBeTruthy();
    // Publication Discord : désactivée tant que des modifications ne sont pas enregistrées.
    expect(screen.getByTestId('esport-devblog-discord-publier').props.accessibilityState.disabled).toBe(true);
  });

  it('publication Discord : salons cochés par défaut, @here coché, aperçu, résultat', async () => {
    const requete = serveurFaux({ gestion: true });
    const client = fauxClient(requete, { superAdmin: true });
    await render(<PageDevblog theme={theme} client={client} large />);
    const modifier = await screen.findByTestId('esport-devblog-devblog-1-modifier');
    await act(async () => {
      fireEvent.press(modifier);
    });
    await waitFor(() => expect(screen.getByTestId('esport-devblog-salon-salon-s1').props.accessibilityState.checked).toBe(true));
    expect(screen.getByTestId('esport-devblog-here').props.accessibilityState.checked).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-devblog-discord-publier'));
    });
    expect(requete).toHaveBeenCalledWith('/devblog/devblog-1/discord', 'POST', { cibles: ['salon:s1'], mentionHere: true });
    expect(await screen.findByTestId('esport-devblog-discord-avis')).toBeTruthy();
  });
});

describe('rendu Discord de l’app', () => {
  it('identique au serveur (DA, découpage) pour le premier devblog', () => {
    for (const [langue, contenu] of [['fr', premier.PREMIER_DEVBLOG_FR], ['en', premier.PREMIER_DEVBLOG_EN]] as const) {
      const local = decouperDiscord(texteDiscord(contenu, langue, { here: langue === 'en' }));
      const ref = serveur.decouperDiscord(serveur.texteDiscord({ date: '2026-10-30', version: '', contenu }, langue, { here: langue === 'en' }));
      expect(local).toEqual(ref);
    }
  });
});

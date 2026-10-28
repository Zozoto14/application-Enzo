/**
 * Suppression des strats (interface) : poubelle visible sur chaque carte (pas seulement dans un menu), droits,
 * confirmation qui nomme la strat, toast « Annuler », sélection multiple, corbeille de 30 jours, bouton dans
 * la vue de la strat, retrait d'une entrée du playbook annulable, anglais.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from './client';
import { definirLangue } from './i18n';
import type { EntreePlaybook, Strat, StratCorbeille } from './strats/api';
import { assetsRepli } from './strats/assets';
import { documentVide } from './strats/document';
import { PageTeam } from './ui/PageTeam';
import { fournirAssets } from './ui/strats/commun';

const theme = themeHub('nuit');
const TOUS = ['activity_log', 'strat_editor', 'playbook'];
const JOUEUR = ['members.view', 'strats.view', 'playbook.view'];
const COACH = [...JOUEUR, 'strats.create', 'strats.update', 'strats.delete', 'strats.share', 'playbook.manage'];

const detail = (permissions: string[]): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: TOUS.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#16a34a', cle: 'coach' }, permissions, superAdmin: false },
});

const strat = (id: string, titre: string, supprimer = true): Strat => ({
  id,
  jeu: 'valorant',
  titre,
  carte: { cle: 'ascent', nom: 'Ascent' },
  side: 'attaque',
  type: 'execute',
  tags: [],
  notes: '',
  visibilite: 'team',
  revision: 1,
  versionDocument: 2,
  miniature: null,
  origine: null,
  creePar: { compte: 'zed12345', pseudo: 'Zed' },
  majPar: { compte: 'zed12345', pseudo: 'Zed' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T09:00:00.000Z',
  moi: { modifier: true, supprimer, partager: true },
});

const entree: EntreePlaybook = {
  id: 'p1',
  jeu: 'valorant',
  titre: 'Anti-éco',
  carte: null,
  side: null,
  type: 'eco',
  tags: [],
  description: 'Stack B.',
  favori: false,
  statut: 'brouillon',
  strat: null,
  miniature: null,
  validePar: null,
  valideLe: null,
  creePar: { compte: 'zed12345', pseudo: 'Zed' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T09:00:00.000Z',
};

function fauxClient(requete: jest.Mock, d: DetailTeam): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => d,
      moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      requete,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}

async function monter(requete: jest.Mock, d: DetailTeam, section: 'module:playbook' | 'module:strat_editor' = 'module:strat_editor') {
  return await render(
    <ModeAffichageForce mode="large">
      <PageTeam theme={theme} client={fauxClient(requete, d)} teamId="t1" large sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
}

beforeEach(() => fournirAssets(assetsRepli(0)));
afterEach(() => definirLangue('fr'));
afterAll(() => fournirAssets(undefined));

/** Serveur simulé : la liste évolue avec les suppressions et restaurations. */
function serveur(initiales: Strat[]) {
  let actives = [...initiales];
  const corbeille: StratCorbeille[] = [];
  const requete = jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
    if (chemin === '/teams/t1/strats/corbeille') return { strats: corbeille };
    if (chemin === '/teams/t1/strats/supprimer' && methode === 'POST') {
      const ids = (corps as { ids: string[] }).ids;
      actives = actives.filter(s => !ids.includes(s.id));
      return { ok: true, supprimees: ids, echecs: [] };
    }
    const m = /^\/teams\/t1\/strats\/(s\d)(\/restaurer)?$/.exec(chemin);
    if (m && methode === 'DELETE') {
      actives = actives.filter(s => s.id !== m[1]);
      return { ok: true };
    }
    if (m && m[2] && methode === 'POST') return strat(m[1], 'Restaurée');
    if (m && !methode) return { ...strat(m[1], initiales.find(s => s.id === m[1])?.titre ?? '?'), donnees: documentVide({ cle: 'ascent', nom: 'Ascent', image: null }) };
    if (chemin.startsWith('/teams/t1/strats')) return { strats: actives };
    if (chemin.startsWith('/teams/t1/playbook') && methode === 'DELETE') return { ok: true };
    if (chemin === '/teams/t1/playbook/p1/restaurer') return entree;
    if (chemin.startsWith('/teams/t1/playbook')) return { entrees: [entree], cartes: [], tags: [], total: 1, gerer: true };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  });
  return { requete, corbeille };
}

describe('suppression d’une strat', () => {
  it('Coach : poubelle visible sur la carte (hors menu), confirmation qui nomme la strat, toast puis « Annuler » restaure', async () => {
    const { requete } = serveur([strat('s1', 'Exécution A'), strat('s2', 'Retake B')]);
    await monter(requete, detail(COACH));
    const poubelle = await screen.findByTestId('esport-strat-supprimer-s1');
    expect(poubelle.props.accessibilityLabel).toBe('Supprimer la strat « Exécution A »');
    expect(screen.getByTestId('esport-strat-supprimer-s2')).toBeTruthy();
    await fireEvent.press(poubelle);
    expect(screen.getByTestId('esport-strat-supprimer-s1-confirmation-titre').props.children).toBe('Supprimer « Exécution A » ?');
    expect(screen.queryByTestId('esport-strat-supprimer-s2-confirmation')).toBeNull();
    // Annuler la confirmation : rien n'est envoyé.
    await fireEvent.press(screen.getByTestId('esport-strat-supprimer-s1-confirmation-annuler'));
    expect(requete).not.toHaveBeenCalledWith('/teams/t1/strats/s1', 'DELETE');
    await fireEvent.press(screen.getByTestId('esport-strat-supprimer-s1'));
    await fireEvent.press(screen.getByTestId('esport-strat-supprimer-s1-confirmation-confirmer'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/strats/s1', 'DELETE'));
    expect((await screen.findByTestId('esport-toast-texte')).props.children).toBe('Strat « Exécution A » supprimée');
    await waitFor(() => expect(screen.queryByTestId('esport-strat-s1')).toBeNull());
    expect(screen.getByTestId('esport-strat-s2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-toast-annuler'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/strats/s1/restaurer', 'POST', {}));
    expect((await screen.findByTestId('esport-toast-texte')).props.children).toBe('Strat restaurée.');
  });

  it('Joueur (ou strat qu’on ne peut pas supprimer) : ni poubelle, ni sélection, ni corbeille', async () => {
    const { requete } = serveur([strat('s1', 'Exécution A', false)]);
    await monter(requete, detail(JOUEUR));
    expect(await screen.findByTestId('esport-strat-s1')).toBeTruthy();
    expect(screen.queryByTestId('esport-strat-supprimer-s1')).toBeNull();
    expect(screen.queryByTestId('esport-strats-selection')).toBeNull();
    expect(screen.queryByTestId('esport-strats-corbeille-ouvrir')).toBeNull();
  });

  it('sélection multiple : tout sélectionner, confirmation avec les noms, une seule requête', async () => {
    const { requete } = serveur([strat('s1', 'Exécution A'), strat('s2', 'Retake B'), strat('s3', 'Eco C', false)]);
    await monter(requete, detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-strats-selection'));
    // La poubelle individuelle cède la place aux cases ; la strat non supprimable n'a pas de case.
    expect(screen.queryByTestId('esport-strat-supprimer-s1')).toBeNull();
    expect(screen.queryByTestId('esport-strat-case-s3')).toBeNull();
    expect(screen.getByTestId('esport-strats-selection-supprimer').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-strat-case-s1'));
    expect(screen.getByTestId('esport-strats-selection-compte').props.children).toBe('1 strat sélectionnée');
    await fireEvent.press(screen.getByTestId('esport-strats-selection-tout'));
    expect(screen.getByTestId('esport-strats-selection-compte').props.children).toBe('2 strats sélectionnées');
    await fireEvent.press(screen.getByTestId('esport-strats-selection-supprimer'));
    expect(screen.getByTestId('esport-strats-selection-confirmation-titre').props.children).toBe('Supprimer ces 2 strats ?');
    expect(String(screen.getByTestId('esport-strats-selection-confirmation-noms').props.children)).toContain('Exécution A');
    await fireEvent.press(screen.getByTestId('esport-strats-selection-confirmation-confirmer'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/strats/supprimer', 'POST', { ids: ['s1', 's2'] }));
    expect((await screen.findByTestId('esport-toast-texte')).props.children).toBe('2 strats supprimées');
    await waitFor(() => expect(screen.queryByTestId('esport-strat-s1')).toBeNull());
    expect(screen.getByTestId('esport-strat-s3')).toBeTruthy();
    expect(screen.queryByTestId('esport-strats-selection-barre')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-toast-annuler'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/strats/s2/restaurer', 'POST', {}));
  });

  it('corbeille : liste avec la date d’effacement, restauration d’une strat', async () => {
    const { requete, corbeille } = serveur([strat('s1', 'Exécution A')]);
    corbeille.push({ id: 's9', titre: 'Vieille strat', carte: { cle: 'bind', nom: 'Bind' }, side: 'defense', type: 'retake', visibilite: 'team', miniature: null, supprimeLe: '2026-10-20T09:00:00.000Z', supprimePar: { compte: 'zed12345', pseudo: 'Zed' }, expireLe: '2026-11-19T09:00:00.000Z' });
    await monter(requete, detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-strats-corbeille-ouvrir'));
    expect(await screen.findByTestId('esport-corbeille-s9')).toBeTruthy();
    expect(screen.getByText(/Supprimée par Zed/)).toBeTruthy();
    expect(screen.getByText(/effacée définitivement le/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-corbeille-s9-restaurer'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/strats/s9/restaurer', 'POST', {}));
    expect((await screen.findByTestId('esport-toast-texte')).props.children).toBe('Strat « Vieille strat » restaurée.');
    await fireEvent.press(screen.getByTestId('esport-strats-corbeille-retour'));
    expect(await screen.findByTestId('esport-strat-s1')).toBeTruthy();
  });

  it('vue de la strat : bouton « Supprimer », confirmation, retour à la liste avec le toast', async () => {
    const { requete } = serveur([strat('s1', 'Exécution A')]);
    await monter(requete, detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-strat-ouvrir-s1'));
    await fireEvent.press(await screen.findByTestId('esport-strat-lecture-supprimer'));
    expect(screen.getByTestId('esport-strat-lecture-supprimer-confirmation-titre').props.children).toBe('Supprimer « Exécution A » ?');
    await fireEvent.press(screen.getByTestId('esport-strat-lecture-supprimer-confirmation-confirmer'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/strats/s1', 'DELETE'));
    expect(await screen.findByTestId('esport-strats')).toBeTruthy();
    expect((await screen.findByTestId('esport-toast-texte')).props.children).toBe('Strat « Exécution A » supprimée');
  });

  it('anglais : confirmation, toast et sélection', async () => {
    definirLangue('en');
    const { requete } = serveur([strat('s1', 'Exec A')]);
    await monter(requete, detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-strat-supprimer-s1'));
    expect(screen.getByTestId('esport-strat-supprimer-s1-confirmation-titre').props.children).toBe('Delete “Exec A”?');
    await fireEvent.press(screen.getByTestId('esport-strat-supprimer-s1-confirmation-confirmer'));
    expect((await screen.findByTestId('esport-toast-texte')).props.children).toBe('Strat “Exec A” deleted');
    expect(screen.getByText('Undo')).toBeTruthy();
  });
});

describe('retrait d’une entrée du playbook', () => {
  it('bouton visible, confirmation, toast « Annuler » qui restaure l’entrée', async () => {
    const { requete } = serveur([]);
    await monter(requete, detail(COACH), 'module:playbook');
    await fireEvent.press(await screen.findByTestId('esport-playbook-supprimer-p1'));
    await fireEvent.press(screen.getByTestId('esport-playbook-supprimer-p1-confirmer'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/playbook/p1', 'DELETE'));
    expect((await screen.findByTestId('esport-playbook-toast-texte')).props.children).toBe('Entrée « Anti-éco » retirée du playbook');
    await fireEvent.press(screen.getByTestId('esport-playbook-toast-annuler'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/playbook/p1/restaurer', 'POST', {}));
    expect((await screen.findByTestId('esport-playbook-toast-texte')).props.children).toBe('Entrée « Anti-éco » remise dans le playbook.');
  });
});

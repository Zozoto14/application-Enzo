/**
 * Esport, phase 6 (interface) : onglets Strats et Playbook selon les
 * permissions, playbook (grille, filtres combinés, statuts, droits), liste
 * des strats, lecture seule native (miniature et notes), libellés, 8 thèmes.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { THEMES_HUB, themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from './client';
import { phraseJournal, phraseNotification } from './libelles';
import type { EntreePlaybook, Strat } from './strats/api';
import { assetsRepli } from './strats/assets';
import { documentVide } from './strats/document';
import { lireTags } from './strats/libelles';
import { PageTeam, entreesBarre } from './ui/PageTeam';
import { fournirAssets } from './ui/strats/commun';
import { choisirDans } from '../ui/selecteurs/deplier';

const theme = themeHub('nuit');
const TOUS = ['activity_log', 'strat_editor', 'playbook'];

const detail = (permissions: string[], modules = TOUS): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
});
const JOUEUR = ['members.view', 'strats.view', 'playbook.view'];
const COACH = [...JOUEUR, 'strats.create', 'strats.update', 'strats.delete', 'strats.share', 'playbook.manage'];

const strat = (champs: Partial<Strat> = {}): Strat => ({
  id: 's1',
  jeu: 'valorant',
  titre: 'Exécution A',
  carte: { cle: 'ascent', nom: 'Ascent' },
  side: 'attaque',
  type: 'execute',
  tags: ['A'],
  notes: 'Strat de référence',
  visibilite: 'team',
  revision: 3,
  versionDocument: 2,
  miniature: { url: 'https://esport.test/fichiers/f1?sig=x', expire: '2026-10-20T11:00:00.000Z' },
  origine: null,
  creePar: { compte: 'zed12345', pseudo: 'Zed' },
  majPar: { compte: 'zed12345', pseudo: 'Zed' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T09:00:00.000Z',
  moi: { modifier: false, supprimer: false, partager: false },
  ...champs,
});

const entree = (champs: Partial<EntreePlaybook> = {}): EntreePlaybook => ({
  id: 'p1',
  jeu: 'valorant',
  titre: 'Exécution A',
  carte: { cle: 'ascent', nom: 'Ascent' },
  side: 'attaque',
  type: 'execute',
  tags: ['A'],
  description: 'Notre exécution principale.',
  favori: true,
  statut: 'validee',
  strat: { id: 's1', titre: 'Exécution A', ouvrable: true },
  miniature: { url: 'https://esport.test/fichiers/f1?sig=x', expire: '' },
  validePar: { compte: 'zed12345', pseudo: 'Zed' },
  valideLe: '2026-10-20T09:00:00.000Z',
  creePar: { compte: 'zed12345', pseudo: 'Zed' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T09:00:00.000Z',
  ...champs,
});

let detailCourant: DetailTeam;

function fauxClient(requete: jest.Mock): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detailCourant,
      moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      requete,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}

async function monter(client: ClientEsport, d: DetailTeam, section: 'module:playbook' | 'module:strat_editor', t = theme) {
  detailCourant = d;
  return await render(
    <ModeAffichageForce mode="large">
      <PageTeam theme={t} client={client} teamId="t1" large sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
}

beforeEach(() => fournirAssets(assetsRepli(0)));
afterAll(() => fournirAssets(undefined));

describe('navigation', () => {
  it('Strats et Playbook n’apparaissent que si le module est activé ET que le rôle peut les voir', () => {
    expect(entreesBarre(detail(JOUEUR)).map(e => e.id)).toEqual(expect.arrayContaining(['module:strat_editor', 'module:playbook']));
    // Remplaçant : playbook seul.
    const remplacant = entreesBarre(detail(['members.view', 'playbook.view'])).map(e => e.id);
    expect(remplacant).toContain('module:playbook');
    expect(remplacant).not.toContain('module:strat_editor');
    expect(entreesBarre(detail(JOUEUR, ['activity_log'])).map(e => e.id)).not.toContain('module:playbook');
    expect(entreesBarre(detail(JOUEUR)).find(e => e.id === 'module:strat_editor')?.bientot).toBe(false);
  });

  it('libellés : journal, notification, tags', () => {
    const e = (action: string, meta: Record<string, unknown>) => phraseJournal({ id: 'x', action, acteur: 'zed12345', entiteType: null, entiteId: null, meta, date: '' }, { zed12345: 'Zed' });
    expect(e('strat.created', { titre: 'Exec A', carte: 'Ascent' })).toBe('Zed a créé la strat « Exec A » (Ascent)');
    expect(e('strat.updated', { titre: 'Exec A', revision: 4 })).toBe('Zed a enregistré la strat « Exec A » (version 4)');
    expect(e('playbook.validated', { titre: 'Exec A' })).toBe('Zed a validé « Exec A » dans le playbook');
    expect(e('strat.share_revoked', { titre: 'Exec A' })).toContain('révoqué');
    const n = phraseNotification({ id: 'n', type: 'playbook-valide', team: { id: 't1', nom: 'Faucons' }, charge: { titre: 'Exec A', carte: 'Ascent' }, lue: false, date: '' }, {});
    expect(n).toBe('Nouvelle entrée validée au playbook de Faucons : « Exec A » (Ascent)');
    expect(lireTags(' A, exec ,a, , Rapide ')).toEqual(['A', 'exec', 'Rapide']);
  });
});

describe('playbook', () => {
  const donnees = (gerer: boolean, entrees = [entree(), entree({ id: 'p2', titre: 'Anti-éco', description: 'Stack B, pas de peek.', strat: null, miniature: null, carte: null, side: null, type: 'eco', statut: 'brouillon', favori: false, tags: [] })]) => ({
    entrees,
    cartes: [{ cle: 'ascent', nom: 'Ascent' }],
    tags: ['A'],
    total: 3,
    gerer,
  });

  it('Joueur : grille avec miniature et entrée textuelle, filtres combinés envoyés au serveur, aucun bouton de gestion', async () => {
    const requete = jest.fn(async (chemin: string) => {
      if (chemin.startsWith('/teams/t1/playbook')) return donnees(false);
      throw new Error(`inattendu : ${chemin}`);
    });
    await monter(fauxClient(requete), detail(JOUEUR), 'module:playbook');
    expect(await screen.findByTestId('esport-playbook-entree-p1')).toBeTruthy();
    expect(screen.getByTestId('esport-playbook-entree-p2')).toBeTruthy();
    expect(screen.getAllByTestId('esport-playbook-miniature')).toHaveLength(1);
    expect(screen.getByText('Notre exécution principale.')).toBeTruthy();
    expect(screen.getByTestId('esport-playbook-compte').props.children).toBe('2 entrées sur 3');
    expect(screen.queryByTestId('esport-playbook-nouvelle')).toBeNull();
    expect(screen.queryByTestId('esport-playbook-valider-p2')).toBeNull();
    expect(screen.getByTestId('esport-mention-riot')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-playbook-filtre-statut-validee'));
    await fireEvent.press(screen.getByTestId('esport-playbook-filtre-side-attaque'));
    await fireEvent.press(screen.getByTestId('esport-playbook-filtre-favoris-1'));
    await waitFor(() => expect(requete).toHaveBeenLastCalledWith('/teams/t1/playbook?statut=validee&side=attaque&favoris=1'));
    await fireEvent.changeText(screen.getByTestId('esport-playbook-recherche'), 'exec');
    await waitFor(() => expect(String(requete.mock.calls.at(-1)?.[0])).toContain('q=exec'));
  });

  it('Coach : valider, favori, archiver passent par l’API', async () => {
    const requete = jest.fn(async (chemin: string, methode?: string) => {
      if (methode === 'PATCH') return entree();
      if (chemin.startsWith('/teams/t1/playbook')) return donnees(true);
      throw new Error(`inattendu : ${chemin}`);
    });
    await monter(fauxClient(requete), detail(COACH), 'module:playbook');
    await fireEvent.press(await screen.findByTestId('esport-playbook-valider-p2'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/playbook/p2', 'PATCH', { statut: 'validee' }));
    await fireEvent.press(screen.getByTestId('esport-playbook-favori-p2'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/playbook/p2', 'PATCH', { favori: true }));
    await fireEvent.press(screen.getByTestId('esport-playbook-archiver-p1'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/playbook/p1', 'PATCH', { statut: 'archivee' }));
    expect(screen.getByTestId('esport-playbook-nouvelle')).toBeTruthy();
  });

  it('s’affiche dans les 8 thèmes', async () => {
    for (const t of THEMES_HUB) {
      const requete = jest.fn(async () => donnees(true));
      const { unmount } = await monter(fauxClient(requete), detail(COACH), 'module:playbook', t);
      expect(await screen.findByTestId('esport-playbook-entree-p1')).toBeTruthy();
      await unmount();
    }
  });
});

describe('strats', () => {
  it('liste filtrée, puis ouverture : sur iOS (natif), miniature et notes des étapes en lecture seule', async () => {
    const doc = documentVide({ cle: 'ascent', nom: 'Ascent', image: null });
    doc.etapes[0] = { ...doc.etapes[0], titre: 'Mise en place', note: 'Tout le monde A lobby' };
    doc.etapes.push({ id: 'e2', titre: 'Entrée', note: '', objets: [] });
    const requete = jest.fn(async (chemin: string) => {
      if (chemin === '/teams/t1/strats/s1') return { ...strat(), donnees: doc };
      if (chemin.startsWith('/teams/t1/strats')) return { strats: [strat()] };
      throw new Error(`inattendu : ${chemin}`);
    });
    await monter(fauxClient(requete), detail(JOUEUR), 'module:strat_editor');
    expect(await screen.findByTestId('esport-strat-s1')).toBeTruthy();
    expect(screen.queryByTestId('esport-strats-nouvelle')).toBeNull();
    expect(screen.queryByTestId('esport-strat-lien-s1')).toBeNull();
    // Joueur : aucune action secondaire (dupliquer, playbook, lien, supprimer) : pas de menu « ⋯ ».
    expect(screen.queryByTestId('esport-strat-actions-s1')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-strats-filtre-carte-ascent'));
    await waitFor(() => expect(requete).toHaveBeenLastCalledWith('/teams/t1/strats?carte=ascent'));
    await fireEvent.press(screen.getByTestId('esport-strat-ouvrir-s1'));
    expect(await screen.findByTestId('esport-strat-lecture')).toBeTruthy();
    expect(await screen.findByTestId('esport-strat-lecture-miniature')).toBeTruthy();
    expect(screen.getAllByTestId('esport-strat-lecture-etape')).toHaveLength(2);
    expect(screen.getByText('Tout le monde A lobby')).toBeTruthy();
    expect(screen.getByText(/Lecture seule sur iPhone et iPad/)).toBeTruthy();
    expect(screen.getByTestId('esport-mention-riot')).toBeTruthy();
  });

  it('Coach : création (carte du repli, side, type), partage par lien affiché une fois', async () => {
    const requete = jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
      if (chemin === '/teams/t1/strats' && methode === 'POST') return strat({ id: 's9', titre: (corps as { titre: string }).titre });
      if (chemin === '/teams/t1/strats/s9') return { ...strat({ id: 's9' }), donnees: documentVide({ cle: 'bind', nom: 'Bind', image: null }) };
      if (chemin === '/teams/t1/strats/s1/partages' && methode === 'POST') return { id: 'l1', libelle: 'Lien de lecture', creeLe: '', expireLe: null, revoque: false, dernierAcces: null, jeton: 'sp1.x', url: 'https://esport.test/partage/strats/sp1.x' };
      if (chemin === '/teams/t1/strats/s1/partages') return { partages: [] };
      if (chemin.startsWith('/teams/t1/strats')) return { strats: [strat({ moi: { modifier: true, supprimer: true, partager: true } })] };
      throw new Error(`inattendu : ${chemin}`);
    });
    await monter(fauxClient(requete), detail(COACH), 'module:strat_editor');
    // Actions secondaires de la carte : dans le menu « ⋯ ».
    await fireEvent.press(await screen.findByTestId('esport-strat-actions-s1'));
    await fireEvent.press(await screen.findByTestId('esport-strat-lien-s1'));
    await fireEvent.press(await screen.findByTestId('esport-strat-partage-creer'));
    expect((await screen.findByTestId('esport-strat-partage-url')).props.children).toBe('https://esport.test/partage/strats/sp1.x');
    await fireEvent.press(screen.getByTestId('esport-strats-nouvelle'));
    await fireEvent.changeText(await screen.findByTestId('esport-strats-titre'), 'Retake B');
    await choisirDans('esport-strats-carte', 'bind');
    await fireEvent.press(screen.getByTestId('esport-strats-side-defense'));
    await fireEvent.press(screen.getByTestId('esport-strats-type-retake'));
    await fireEvent.press(screen.getByTestId('esport-strats-creer'));
    await waitFor(() =>
      expect(requete).toHaveBeenCalledWith('/teams/t1/strats', 'POST', { titre: 'Retake B', type: 'retake', carte: { cle: 'bind', nom: 'Bind', image: null }, side: 'defense', tags: [], visibilite: 'team' }),
    );
    expect(await screen.findByTestId('esport-strat-lecture')).toBeTruthy();
  });
});

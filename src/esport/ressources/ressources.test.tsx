/**
 * Ressources côté app : place dans la section « Jeu », fil (catégories, nouveautés, filtres), publier un
 * lien avec son aperçu, proposer (joueur), détail (réactions, commentaire, « Ouvrir en review
 * vidéo »), file de validation (staff), gestion des catégories, publication multi-teams, phrases du
 * journal et des notifications.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam, type Notification } from '../client';
import { phraseJournal, phraseNotification } from '../libelles';
import { fauxPlanning } from '../planning/faux';
import { fauxReviewScouting } from '../review/faux';
import { PageTeam, sectionsTeam } from '../ui/PageTeam';
import { PublierMulti } from '../ui/ressources/PublierMulti';
import type { CanalRessources, DetailRessource, Ressource } from './api';
import { nomCategorie } from './libelles';

const theme = themeHub('nuit');
const STAFF = ['members.view', 'planning.view', 'video_review.view', 'video_review.create', 'resources.view', 'resources.post', 'resources.manage'];
const JOUEUR = ['members.view', 'planning.view', 'video_review.view', 'resources.view'];
const ID_LIEN = '11111111-1111-4111-8111-111111111111';
const ID_VIDEO = '22222222-2222-4222-8222-222222222222';
const ID_PROP = '33333333-3333-4333-8333-333333333333';
const CATS = [
  { id: 'c1', nom: 'Guides', cleDefaut: 'guides', position: 0, n: 1 },
  { id: 'c2', nom: 'Vidéos pros', cleDefaut: 'videos_pros', position: 1, n: 1 },
  { id: 'c3', nom: 'Routines', cleDefaut: null, position: 2, n: 0 },
];

function detail(permissions: string[], modules = ['activity_log', 'planning', 'video_review', 'resources']): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
    membres: 3,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#2563eb', cle: 'coach' }, permissions, superAdmin: false },
  };
}

function ressource(id: string, champs: Partial<Ressource>): Ressource {
  return {
    id,
    genre: 'lien',
    titre: 'Ressource',
    description: '',
    url: null,
    videoId: null,
    fichier: null,
    apercu: null,
    tags: [],
    carte: null,
    agent: null,
    niveau: null,
    visibilite: 'team',
    statut: 'publiee',
    motifRefus: null,
    epingle: false,
    favori: false,
    categorie: CATS[0],
    auteur: { compte: 'zed12345', pseudo: 'Zed' },
    validePar: null,
    multiTeams: false,
    reviewId: null,
    reactions: [],
    commentaires: 0,
    nouveau: false,
    creeLe: '2026-10-20T10:00:00.000Z',
    majLe: '2026-10-20T10:00:00.000Z',
    publieLe: '2026-10-20T10:00:00.000Z',
    moi: { modifier: false, supprimer: false, epingler: false, valider: false },
    ...champs,
  };
}

async function monter(permissions: string[], { proposer = false, mode = 'large' as 'large' | 'telephone' } = {}) {
  const f = fauxPlanning(permissions);
  const fr = fauxReviewScouting(permissions);
  const staff = permissions.includes('resources.post');
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const lien = ressource(ID_LIEN, { titre: 'Lineups Viper', url: 'https://blitz.gg/viper', apercu: { titre: 'Viper', description: 'Les lineups B', image: 'https://blitz.gg/v.png', site: 'blitz.gg' }, tags: ['viper'], nouveau: true, reactions: [{ emoji: '👍', n: 2, moi: false }] });
  const video = ressource(ID_VIDEO, { genre: 'youtube', titre: 'VOD TenZ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', categorie: CATS[1], epingle: true });
  const prop = ressource(ID_PROP, { genre: 'note', titre: 'Crosshair', description: '0;P;c;5', statut: 'proposee', auteur: { compte: 'lea12345', pseudo: 'Léa' }, publieLe: null, moi: { modifier: true, supprimer: true, epingler: true, valider: true } });
  const enDetail = (r: Ressource): DetailRessource => ({ ...r, listeCommentaires: [{ id: 'k1', texte: 'Merci !', auteur: { compte: 'kai12345', pseudo: 'Kai' }, creeLe: '2026-10-20T11:00:00.000Z', supprimable: false }] });
  const requete = async <T,>(chemin: string, methode = 'GET', corps?: unknown): Promise<T> => {
    const c = chemin.split('?')[0];
    if (!c.includes('/ressources') && c.includes('/review')) return fr.requete<T>(chemin, methode, corps);
    if (!c.includes('/ressources')) return f.requete<T>(chemin, methode, corps);
    appels.push({ chemin, methode, corps });
    if (/\/ressources$/.test(c) && methode === 'GET') {
      const file = chemin.includes('file=1');
      return {
        ressources: file ? [prop] : [video, lien],
        categories: CATS,
        sansCategorie: 0,
        tags: ['viper'],
        cartes: [],
        agents: [],
        auteurs: [{ compte: 'zed12345', pseudo: 'Zed' }],
        total: 2,
        nouveaux: 1,
        derniereVisite: '2026-10-19T10:00:00.000Z',
        file: staff ? 1 : 0,
        mesPropositions: 0,
        emojis: ['👍', '🔥', '❤️', '😂', '🤯', '👀'],
        moi: { poster: staff, gerer: staff, staff, proposer: !staff && proposer, discord: false, propositionsOuvertes: proposer },
      } satisfies CanalRessources as T;
    }
    if (/\/ressources\/vu$/.test(c)) return { vuLe: '' } as T;
    if (/\/ressources\/apercu$/.test(c)) return { url: 'https://blitz.gg/raze', titre: 'Raze : guide', description: 'Tout sur Raze', image: null, site: 'blitz.gg' } as T;
    if (/\/ressources$/.test(c) && methode === 'POST') return enDetail(ressource('44444444-4444-4444-8444-444444444444', { ...(corps as Partial<Ressource>), statut: staff ? 'publiee' : 'proposee' })) as T;
    if (c.endsWith(`/${ID_LIEN}`)) return enDetail(lien) as T;
    if (c.endsWith(`/${ID_VIDEO}`)) return enDetail(video) as T;
    if (c.endsWith(`/${ID_PROP}`)) return enDetail(prop) as T;
    if (/\/ressources\/[0-9a-f-]{36}$/.test(c)) return enDetail({ ...lien, id: c.slice(-36), titre: 'Raze : guide' }) as T;
    if (c.endsWith('/reactions')) return { reactions: [{ emoji: '👍', n: 3, moi: true }] } as T;
    if (c.endsWith('/commentaires')) return enDetail(lien) as T;
    if (c.endsWith('/review')) return { reviewId: 'rv1', cree: true } as T;
    if (c.endsWith('/valider')) return enDetail({ ...prop, statut: 'publiee' }) as T;
    if (/\/categories$/.test(c)) return { id: 'c4', nom: (corps as { nom: string }).nom, cleDefaut: null, position: 3 } as T;
    if (/\/categories\/ordre$/.test(c)) return { categories: (corps as { ids: string[] }).ids.map((id, position) => ({ ...CATS.find(x => x.id === id)!, position })) } as T;
    return { ok: true } as T;
  };
  const client = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'c', superAdmin: false, profil: { pseudo: 'Zed', riotId: null, discord: null }, peutCreerTeam: false }),
    requete,
  } as unknown as ClientEsport;
  await render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={theme} client={client} teamId="t1" large={mode === 'large'} sectionInitiale="module:resources" onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
  return { appels };
}

describe('ressources', () => {
  it('section « Jeu » : le canal pour tous les membres, seulement si le module est activé', () => {
    const jeu = (p: string[], modules?: string[]) => sectionsTeam(detail(p, modules)).find(g => g.id === 'jeu')?.entrees.map(e => e.id) ?? [];
    expect(jeu(JOUEUR)).toContain('module:resources');
    expect(jeu(STAFF)).toContain('module:resources');
    expect(jeu(JOUEUR, ['planning', 'video_review'])).not.toContain('module:resources');
    expect(CATALOGUE.presets.find(p => p.cle === 'valorant_complet')?.modules).toContain('resources');
  });

  it('staff : fil (épinglée, nouveau, catégories), canal marqué vu, publier un lien avec son aperçu', async () => {
    const { appels } = await monter(STAFF);
    expect(await screen.findByTestId('esport-ressources')).toBeTruthy();
    expect(await screen.findByTestId(`esport-ressource-${ID_VIDEO}`)).toBeTruthy();
    expect(screen.getByTestId('esport-ressources-nouveaux')).toBeTruthy();
    expect(screen.getByTestId(`esport-ressource-${ID_LIEN}-nouveau`)).toBeTruthy();
    expect(screen.getByText('Vidéos pros · 1')).toBeTruthy();
    expect(screen.getByText('Routines · 0')).toBeTruthy();
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/ressources/vu') && a.methode === 'POST')).toBe(true));
    // Filtre par catégorie : la requête porte le filtre.
    await fireEvent.press(screen.getByTestId('esport-ressources-cat-c2'));
    await waitFor(() => expect(appels.some(a => a.chemin.includes('categorie=c2'))).toBe(true));
    // Nouvelle ressource : lien, aperçu récupéré par le serveur, staff seulement.
    await fireEvent.press(screen.getByTestId('esport-ressources-nouvelle'));
    expect(await screen.findByTestId('esport-ressource-form')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-ressource-url'), 'https://blitz.gg/raze');
    await fireEvent.press(screen.getByTestId('esport-ressource-apercu-recuperer'));
    expect(await screen.findByTestId('esport-ressource-apercu-carte')).toBeTruthy();
    expect(screen.getByTestId('esport-ressource-titre').props.value).toBe('Raze : guide');
    await fireEvent.press(screen.getByTestId('esport-ressource-categorie-c3'));
    await fireEvent.changeText(screen.getByTestId('esport-ressource-tags'), 'raze, entry');
    await fireEvent.press(screen.getByTestId('esport-ressource-visibilite-staff'));
    await fireEvent.press(screen.getByTestId('esport-ressource-publier'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && /\/ressources$/.test(a.chemin))).toBe(true));
    expect(appels.find(a => a.methode === 'POST' && /\/ressources$/.test(a.chemin))?.corps).toMatchObject({ genre: 'lien', url: 'https://blitz.gg/raze', titre: 'Raze : guide', categorieId: 'c3', tags: ['raze', 'entry'], visibilite: 'staff' });
  });

  it('détail : réagir, commenter, « Ouvrir en review vidéo » ; file de validation du staff', async () => {
    const { appels } = await monter(STAFF);
    await fireEvent.press(await screen.findByTestId(`esport-ressource-${ID_LIEN}`));
    expect(await screen.findByTestId('esport-ressource-detail')).toBeTruthy();
    expect(await screen.findByTestId('esport-ressource-apercu')).toBeTruthy();
    expect(screen.getByText('Merci !')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-ressource-reagir-0'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/reactions'))).toBe(true));
    expect(appels.find(a => a.chemin.endsWith('/reactions'))?.corps).toEqual({ emoji: '👍', actif: true });
    expect((await screen.findByTestId('esport-ressource-reagir-0-n')).props.children).toBe(3);
    await fireEvent.changeText(screen.getByTestId('esport-ressource-commentaire'), 'Top');
    await fireEvent.press(screen.getByTestId('esport-ressource-commenter'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/commentaires') && a.methode === 'POST')).toBe(true));
    await fireEvent.press(screen.getByTestId('esport-ressource-detail-fermer'));
    // File de validation.
    await fireEvent.press(await screen.findByTestId('esport-ressources-onglet-file'));
    await fireEvent.press(await screen.findByTestId(`esport-ressource-${ID_PROP}`));
    await fireEvent.press(await screen.findByTestId('esport-ressource-valider'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith(`/${ID_PROP}/valider`))).toBe(true));
    await fireEvent.press(screen.getByTestId('esport-ressource-detail-fermer'));
    await fireEvent.press(await screen.findByTestId('esport-ressources-onglet-fil'));
    // Vidéo : lecteur (natif ici) et « Ouvrir en review vidéo » qui mène à la review créée.
    await fireEvent.press(screen.getByTestId(`esport-ressource-${ID_VIDEO}`));
    expect(await screen.findByTestId('esport-lecteur-natif')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-ressource-ouvrir-review'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith(`/${ID_VIDEO}/review`))).toBe(true));
    expect(await screen.findByTestId('esport-contenu-module-video_review')).toBeTruthy();
  });

  it('gestion des catégories : créer, réordonner (staff)', async () => {
    const { appels } = await monter(STAFF);
    await screen.findByTestId(`esport-ressource-${ID_VIDEO}`);
    await fireEvent.press(screen.getByTestId('esport-menu'));
    await fireEvent.press(await screen.findByTestId('esport-ressources-categories'));
    expect(await screen.findByTestId('esport-ressources-categories-volet')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-categorie-nouvelle'), 'Pépites');
    await fireEvent.press(screen.getByTestId('esport-categorie-ajouter'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && a.chemin.endsWith('/categories'))).toBe(true));
    await fireEvent.press(screen.getByTestId('esport-categorie-c2-monter'));
    await waitFor(() => expect(appels.find(a => a.chemin.endsWith('/categories/ordre'))?.corps).toEqual({ ids: ['c2', 'c1', 'c3', 'c4'] }));
  });

  it('joueur : lecture seule sans propositions', async () => {
    await monter(JOUEUR);
    expect(await screen.findByTestId(`esport-ressource-${ID_LIEN}`)).toBeTruthy();
    expect(screen.queryByTestId('esport-ressources-nouvelle')).toBeNull();
    expect(screen.queryByTestId('esport-ressources-onglet-file')).toBeNull();
  });

  it('joueur : « Proposer » quand la team l’ouvre (iPhone), jamais « staff seulement »', async () => {
    const { appels } = await monter(JOUEUR, { proposer: true, mode: 'telephone' });
    await fireEvent.press(await screen.findByTestId('esport-ressources-nouvelle'));
    expect(await screen.findByTestId('esport-ressource-form')).toBeTruthy();
    expect(screen.queryByTestId('esport-ressource-visibilite-staff')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-ressource-genre-note'));
    await fireEvent.changeText(screen.getByTestId('esport-ressource-titre'), 'Ma routine');
    await fireEvent.changeText(screen.getByTestId('esport-ressource-description'), 'Aimlab 20 min');
    await fireEvent.press(screen.getByTestId('esport-ressource-publier'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST' && /\/ressources$/.test(a.chemin))).toBe(true));
    expect(appels.find(a => a.methode === 'POST' && /\/ressources$/.test(a.chemin))?.corps).not.toHaveProperty('visibilite');
  });

  it('publication multi-teams : teams cochées, catégorie par défaut, un seul appel', async () => {
    const appels: Array<{ chemin: string; corps?: unknown }> = [];
    const client = {
      requete: async <T,>(chemin: string, _methode = 'GET', corps?: unknown): Promise<T> => {
        appels.push({ chemin, corps });
        if (chemin === '/ressources/teams') return { teams: [{ id: 'ta', nom: 'Alpha', slug: 'alpha', categories: [] }, { id: 'tb', nom: 'Bravo', slug: 'bravo', categories: [] }] } as T;
        return { groupe: 'g', ressources: [{ teamId: 'ta', team: 'Alpha', id: 'x' }, { teamId: 'tb', team: 'Bravo', id: 'y' }] } as T;
      },
    } as unknown as ClientEsport;
    await render(<PublierMulti theme={theme} client={client} onFermer={() => undefined} />);
    await fireEvent.press(await screen.findByTestId('esport-ressources-multi-toutes'));
    await fireEvent.press(screen.getByTestId('esport-ressources-multi-genre-youtube'));
    await fireEvent.changeText(screen.getByTestId('esport-ressources-multi-url'), 'https://youtu.be/dQw4w9WgXcQ');
    await fireEvent.changeText(screen.getByTestId('esport-ressources-multi-titre'), 'Masterclass Sova');
    await fireEvent.press(screen.getByTestId('esport-ressources-multi-categorie-videos_pros'));
    await fireEvent.press(screen.getByTestId('esport-ressources-multi-publier'));
    await waitFor(() => expect(appels.some(a => a.chemin === '/ressources/multi')).toBe(true));
    expect(appels.find(a => a.chemin === '/ressources/multi')?.corps).toMatchObject({ teams: ['ta', 'tb'], genre: 'youtube', titre: 'Masterclass Sova', categorie: { cleDefaut: 'videos_pros' } });
    expect(await screen.findByText('Publiée dans 2 teams : Alpha, Bravo')).toBeTruthy();
  });

  it('journal, notifications et catégories par défaut traduites', () => {
    const e = (action: string, meta: Record<string, unknown>) => ({ id: '1', action, acteur: 'zed12345', entiteType: 'ressource', entiteId: 'r', meta, date: '' });
    const noms = { zed12345: 'Zed' };
    expect(phraseJournal(e('resource.created', { titre: 'Lineups' }), noms)).toBe('Zed a publié la ressource « Lineups »');
    expect(phraseJournal(e('resource.validated', { titre: 'Astuce' }), noms)).toBe('Zed a validé la ressource « Astuce »');
    expect(phraseJournal(e('resource_category.updated', { de: 'Guides', nom: 'Tutos' }), noms)).toBe('Zed a renommé la catégorie « Guides » en « Tutos »');
    const n = (type: string, charge: Record<string, unknown>) => ({ id: 'n', type, charge, team: { id: 't1', nom: 'Faucons' }, lue: false, date: '' }) as unknown as Notification;
    expect(phraseNotification(n('ressource-refusee', { titre: 'Guide', motif: 'Doublon' }), {})).toBe('Faucons : votre proposition « Guide » est refusée (Doublon)');
    expect(nomCategorie({ nom: 'Aim et entraînement', cleDefaut: 'aim' })).toBe('Aim et entraînement');
    expect(nomCategorie({ nom: 'Pépites', cleDefaut: null })).toBe('Pépites');
    expect(nomCategorie(null)).toBe('Sans catégorie');
  });
});

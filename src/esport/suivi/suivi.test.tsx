/**
 * Suivi joueurs côté app : section Équipe pour le staff (jamais pour un
 * joueur), liste des fiches, fiche (résumé, filtres, note épinglée et
 * partagée), nouvelle note (catégorie, ton, étiquettes, partage), notes
 * partagées sur l'accueil du joueur, phrases du journal sans contenu.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from '../client';
import { phraseJournal } from '../libelles';
import { fauxPlanning } from '../planning/faux';
import { PageTeam, sectionsTeam, type SectionTeam } from '../ui/PageTeam';
import type { FicheJoueur, NoteJoueur } from './api';

const theme = themeHub('nuit');
const COACH = ['members.view', 'planning.view', 'attendance.view_all', 'attendance.mark', 'attendance.rsvp_own', 'goals_tasks.view', 'player_notes.view', 'player_notes.write', 'player_notes.delete'];
const JOUEUR = ['members.view', 'planning.view', 'attendance.rsvp_own', 'goals_tasks.view'];

function detail(permissions: string[]): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['activity_log', 'planning', 'attendance', 'goals_tasks', 'player_notes'].includes(m.cle) })),
    membres: 3,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#2563eb', cle: 'coach' }, permissions, superAdmin: false },
  };
}

const NOTE: NoteJoueur = {
  id: 'n1n1n1n1-0000-4000-8000-000000000001',
  joueur: 'lea12345',
  auteur: { compte: 'zed12345', pseudo: 'Zed' },
  categorie: 'performance',
  ton: 'positif',
  contenu: 'Très bon **entry** sur Ascent.',
  tags: ['entry'],
  lien: null,
  date: '2026-10-18',
  epinglee: true,
  partagee: false,
  auteurMasque: false,
  creeLe: '',
  majLe: '',
  peutModifier: true,
  peutSupprimer: true,
};

async function monter(permissions: string[], section: SectionTeam, mode: 'large' | 'telephone' = 'large') {
  const f = fauxPlanning(permissions);
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <T,>(chemin: string, methode = 'GET', corps?: unknown): Promise<T> => {
    const c = chemin.split('?')[0];
    if (!c.includes('/suivi')) return f.requete<T>(chemin, methode, corps);
    appels.push({ chemin, methode, corps });
    if (/\/suivi$/.test(c)) {
      return {
        joueurs: [
          { compte: 'lea12345', pseudo: 'Léa', poste: 'Duelliste', role: { nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, groupe: 'joueurs', statut: 'actif', notes: 1, derniere: '2026-10-18', partagees: 0 },
          { compte: 'ana12345', pseudo: 'Ana', poste: null, role: { nom: 'Analyste', couleur: '#0891b2', cle: 'analyste' }, groupe: 'staff', statut: 'actif', notes: 0, derniere: null, partagees: 0 },
        ],
        droits: { ecrire: true, supprimer: true },
      } as T;
    }
    if (/\/suivi\/moi$/.test(c)) return { notes: [{ id: 'p1p1p1p1-0000-4000-8000-000000000001', categorie: 'objectif', ton: 'neutre', contenu: 'Prendre la parole en début de round.', tags: [], date: '2026-10-19', auteur: null, partageeLe: '' }] } as T;
    if (/\/suivi\/lea12345$/.test(c)) {
      return {
        joueur: { compte: 'lea12345', pseudo: 'Léa', poste: 'Duelliste', role: { nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, statut: 'actif', ancien: false },
        resume: { presence: { taux: 0.8, ponctualite: 1, marques: 5, nonMarques: 0, present: 4, retard: 0, absent: 1, excuse: 0, serie: 0, retardMoyen: null }, taches: { ouvertes: 2, enRetard: 1, faites: 3 }, objectifs: [{ id: 'o1', titre: 'Annonces de contact', statut: 'actif', dateCible: null }], total: 1, partagees: 0, dernieres: [NOTE] },
        notes: chemin.includes('categorie=mental') ? [] : [NOTE],
        etiquettes: ['entry'],
        droits: { ecrire: true, supprimer: true },
      } satisfies FicheJoueur as T;
    }
    return NOTE as T;
  };
  const c = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'c', superAdmin: false, profil: { pseudo: 'Zed', riotId: null, discord: null }, peutCreerTeam: false }),
    stats: async () => ({ periode: { du: '', au: '', fuseau: 'Europe/Paris' }, membres: { actifs: 3, suspendus: 0 }, presence: null, taches: null, resumes: null, activite: null }),
    taches: async () => ({ taches: [] }),
    resumesTeam: async () => [],
    requete,
  } as unknown as ClientEsport;
  await render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={theme} client={c} teamId="t1" large={mode === 'large'} sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
  return { appels };
}

describe('suivi joueurs', () => {
  it('section Équipe : le staff a « Suivi joueurs », un joueur jamais', () => {
    const equipe = (p: string[]) => sectionsTeam(detail(p)).find(g => g.id === 'equipe')?.entrees.map(e => e.id) ?? [];
    expect(equipe(COACH)).toContain('module:player_notes');
    expect(equipe(JOUEUR)).not.toContain('module:player_notes');
  });

  it('staff : fiches, résumé, filtres, nouvelle note partagée avec le joueur', async () => {
    const { appels } = await monter(COACH, 'module:player_notes');
    expect(await screen.findByTestId('esport-suivi')).toBeTruthy();
    expect(screen.getByTestId('esport-suivi-joueur-ana12345')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-suivi-joueur-lea12345'));
    expect(await screen.findByTestId('esport-suivi-fiche')).toBeTruthy();
    // Résumé : présence, tâches, objectifs individuels.
    expect(screen.getByTestId('esport-suivi-resume-presence').props.children).toBe('80 %');
    expect(screen.getByTestId('esport-suivi-objectifs')).toBeTruthy();
    expect(screen.getByTestId('esport-suivi-note-n1n1n1n1-contenu')).toBeTruthy();
    // Filtre par catégorie : la requête porte le filtre.
    await fireEvent.press(screen.getByTestId('esport-suivi-filtres'));
    await fireEvent.press(screen.getByTestId('esport-suivi-filtre-categorie-mental'));
    await waitFor(() => expect(appels.some(a => a.chemin.includes('categorie=mental'))).toBe(true));
    expect(await screen.findByTestId('esport-suivi-notes-vide')).toBeTruthy();
    // Nouvelle note : privée par défaut ; on la partage, sans son nom.
    await fireEvent.press(screen.getByTestId('esport-suivi-nouvelle'));
    await fireEvent.changeText(await screen.findByTestId('esport-suivi-contenu'), 'Comms tardives en retake.');
    await fireEvent.press(screen.getByTestId('esport-suivi-categorie-communication'));
    await fireEvent.press(screen.getByTestId('esport-suivi-ton-a_travailler'));
    await fireEvent.changeText(screen.getByTestId('esport-suivi-tags'), 'comms, retake');
    expect(screen.queryByTestId('esport-suivi-masque')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-suivi-partagee'));
    await fireEvent.press(await screen.findByTestId('esport-suivi-masque'));
    await fireEvent.press(screen.getByTestId('esport-suivi-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'POST')).toBe(true));
    const post = appels.find(a => a.methode === 'POST')!;
    expect(post.chemin).toBe('/teams/t1/suivi/lea12345/notes');
    expect(post.corps).toMatchObject({ contenu: 'Comms tardives en retake.', categorie: 'communication', ton: 'a_travailler', tags: ['comms', 'retake'], partagee: true, auteurMasque: true, epinglee: false, lien: null });
  });

  it('joueur : les notes partagées sur l’accueil, en lecture, sans l’auteur masqué', async () => {
    await monter(JOUEUR, 'accueil', 'telephone');
    expect(await screen.findByTestId('esport-mes-notes')).toBeTruthy();
    expect(screen.getByText('par le staff')).toBeTruthy();
    expect(screen.queryByTestId('esport-suivi-nouvelle')).toBeNull();
  });

  it('journal : « note ajoutée sur X », jamais le contenu', () => {
    const e = { id: '1', action: 'player_note.created', acteur: 'zed12345', entiteType: 'note_joueur', entiteId: 'n', meta: { compte: 'lea12345' }, date: '' };
    expect(phraseJournal(e, { zed12345: 'Zed', lea12345: 'Léa' })).toBe('Zed a ajouté une note sur Léa');
    expect(phraseJournal({ ...e, action: 'player_note.shared', meta: { compte: 'lea12345', partagee: true } }, { zed12345: 'Zed', lea12345: 'Léa' })).toBe('Zed a partagé une note avec Léa');
  });
});

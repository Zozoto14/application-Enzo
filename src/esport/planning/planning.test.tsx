/**
 * Planning côté app : dates et libellés (purs), écrans Planning,
 * Disponibilités, Présence et accueil de la team (droits respectés, RSVP en un
 * appui sur téléphone, marquage, proposition d'événement depuis la heatmap,
 * export CSV), dans les 8 thèmes.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { THEMES_HUB, themeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from '../client';
import { phraseJournal, phraseNotification } from '../libelles';
import { PageTeam, type SectionTeam } from '../ui/PageTeam';
import { fauxPlanning } from './faux';
import { ajouterJours, dateLongue, grilleMois, jourSemaine, lundiDe, moisVoisin, nomMois, pourcentage, resumeRecurrence, typeEvenement } from './libelles';

const theme = themeHub('nuit');
const COACH = ['members.view', 'planning.view', 'planning.create', 'planning.update', 'planning.delete', 'availability.view_all', 'availability.edit_own', 'attendance.view_all', 'attendance.mark', 'attendance.rsvp_own'];
const JOUEUR = ['members.view', 'planning.view', 'availability.view_all', 'availability.edit_own', 'attendance.rsvp_own'];

function detail(permissions: string[]): DetailTeam {
  return {
    team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['activity_log', 'planning', 'availability', 'attendance'].includes(m.cle) })),
    membres: 3,
    moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#2563eb', cle: 'coach' }, permissions, superAdmin: false },
  };
}

function client(permissions: string[]) {
  const f = fauxPlanning(permissions);
  const c = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    membres: async () => [
      { id: 'm2', compte: 'lea12345', pseudo: 'Léa', riotId: null, discord: null, posteJeu: null, statut: 'actif', rejointLe: '', role: { id: 'r', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, moi: false },
    ],
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'c', superAdmin: false, profil: { pseudo: 'Zed', riotId: null, discord: null }, peutCreerTeam: false }),
    requete: f.requete,
  } as unknown as ClientEsport;
  return { client: c, appels: f.appels };
}

async function monter(permissions: string[], section: SectionTeam, mode: 'large' | 'telephone' = 'large', t = theme, onExporter?: (n: string, c: string, ty?: string) => Promise<boolean>) {
  const c = client(permissions);
  const r = await render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={t} client={c.client} teamId="t1" large={mode === 'large'} sectionInitiale={section} onQuitter={() => undefined} onExporter={onExporter} />
    </ModeAffichageForce>,
  );
  return { ...c, ...r };
}

describe('planning : dates et libellés', () => {
  it('grille du mois (6 semaines du lundi), semaines, mois voisins', () => {
    const g = grilleMois('2026-10-15');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-09-28');
    expect(g[41]).toBe('2026-11-08');
    expect(lundiDe('2026-10-25')).toBe('2026-10-19');
    expect(jourSemaine('2026-10-25')).toBe(7);
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(moisVoisin('2026-01-31', 1)).toBe('2026-02-01');
    expect(moisVoisin('2026-01-15', -1)).toBe('2025-12-01');
    expect(nomMois('2026-10-01')).toBe('octobre 2026');
    expect(dateLongue('2026-10-20')).toBe('mardi 20 octobre');
  });

  it('récurrence, pourcentages, types et phrases du journal et des notifications', () => {
    expect(resumeRecurrence(null)).toBe('Une seule fois');
    expect(resumeRecurrence({ freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: '2026-12-20', nombre: null })).toBe('Chaque semaine : mardi, jeudi · jusqu’au 20/12/2026');
    expect(resumeRecurrence({ freq: 'hebdo', intervalle: 2, jours: [7], jusqua: null, nombre: 8 })).toBe('Toutes les 2 semaines : dimanche · 8 fois');
    expect(pourcentage(2 / 3)).toBe('67 %');
    expect(pourcentage(null)).toBe('—');
    expect(typeEvenement('scrim').nom).toBe('Scrim');
    expect(typeEvenement('inconnu').cle).toBe('other');
    const e = (action: string, meta: Record<string, unknown>) => ({ id: '1', action, acteur: 'c', entiteType: null, entiteId: null, meta, date: '' });
    expect(phraseJournal(e('event.created', { titre: 'Scrim vs Zeta', type: 'scrim', recurrent: false }), { c: 'Zed' })).toBe('Zed a créé « Scrim vs Zeta » (Scrim)');
    expect(phraseJournal(e('attendance.rsvp', { titre: 'Entraînement', rsvp: 'peut_etre' }), { c: 'Léa' })).toBe('Léa a répondu « Peut-être » pour « Entraînement »');
    expect(phraseJournal(e('attendance.reminder', { titre: 'Match', compte: 'k' }), { k: 'Kai' })).toBe('Rappel de réponse envoyé à Kai pour « Match »');
    const n = { id: 'n', type: 'rappel-rsvp', team: { id: 't', nom: 'Faucons' }, charge: { titre: 'Match' }, lue: false, date: '' };
    expect(phraseNotification(n, {})).toBe('Serez-vous là ? Match · Faucons');
  });
});

describe('écran Planning', () => {
  it('Coach : création d’un événement récurrent (corps envoyé au serveur)', async () => {
    const { appels } = await monter(COACH, 'module:planning');
    await fireEvent.press(await screen.findByTestId('esport-planning-nouveau'));
    await fireEvent.press(screen.getByTestId('esport-formulaire-type-scrim'));
    await fireEvent.changeText(screen.getByTestId('esport-formulaire-titre'), 'Scrim du mardi');
    await fireEvent.changeText(screen.getByTestId('esport-formulaire-date'), '2026-10-20');
    await fireEvent.changeText(screen.getByTestId('esport-formulaire-debut'), '21:00');
    await fireEvent.changeText(screen.getByTestId('esport-formulaire-fin'), '23:00');
    await fireEvent.press(screen.getByTestId('esport-formulaire-repeter'));
    await fireEvent.press(screen.getByTestId('esport-formulaire-jour-4'));
    await fireEvent.press(screen.getByTestId('esport-formulaire-enregistrer'));
    await screen.findByTestId('esport-planning');
    const post = appels.find(a => a.methode === 'POST');
    expect(post?.chemin).toBe('/teams/t1/planning');
    expect(post?.corps).toMatchObject({ type: 'scrim', titre: 'Scrim du mardi', date: '2026-10-20', heureDebut: '21:00', heureFin: '23:00', fuseau: 'Europe/Paris', recurrence: { freq: 'hebdo', intervalle: 1, jours: [2, 4], jusqua: null } });
  });

  it('Joueur sur téléphone : pas de bouton de création ; RSVP en un appui', async () => {
    const { appels } = await monter(JOUEUR, 'module:planning', 'telephone');
    await screen.findByTestId('esport-planning-liste');
    expect(screen.queryByTestId('esport-planning-nouveau')).toBeNull();
    await fireEvent.press(await screen.findByTestId('esport-occ-e1e1e1e1-2026-10-20-rsvp-oui'));
    await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && a.chemin.endsWith('/rsvp'))).toBe(true));
    const put = appels.find(a => a.chemin.endsWith('/rsvp'))!;
    expect(put.chemin).toBe(`/teams/t1/planning/e1e1e1e1-0000-4000-8000-000000000001/occurrences/${encodeURIComponent('2026-10-20T18:00:00.000Z')}/rsvp`);
    expect(put.corps).toEqual({ rsvp: 'oui' });
    // Le détail : pas d'actions de gestion pour un Joueur.
    await fireEvent.press(screen.getByTestId('esport-occ-e1e1e1e1-2026-10-20-ouvrir'));
    await screen.findByTestId('esport-evenement');
    expect(screen.queryByTestId('esport-evenement-actions')).toBeNull();
    expect(screen.queryByTestId('esport-presence-liste')).toBeNull();
  });

  it('Coach : marquer la présence depuis le détail d’une occurrence', async () => {
    const { appels } = await monter(COACH, 'module:planning', 'telephone');
    await fireEvent.press(await screen.findByTestId('esport-occ-e1e1e1e1-2026-10-20-ouvrir'));
    await screen.findByTestId('esport-presence-liste');
    expect(screen.getByTestId('esport-evenement-actions')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('esport-marque-lea12345-present'));
    await fireEvent.press(screen.getByTestId('esport-marque-kai12345-excuse'));
    await fireEvent.press(screen.getByTestId('esport-presence-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && a.chemin.endsWith('/presence'))).toBe(true));
    expect(appels.find(a => a.methode === 'PUT' && a.chemin.endsWith('/presence'))?.corps).toEqual({
      marques: [
        { compte: 'lea12345', reel: 'present' },
        { compte: 'kai12345', reel: 'excuse' },
      ],
    });
  });

  it('vues mois et semaine, filtre par type', async () => {
    const { appels } = await monter(COACH, 'module:planning');
    await screen.findByTestId('esport-planning-mois');
    await fireEvent.press(screen.getByTestId('esport-mois-2026-10-20'));
    expect(await screen.findByTestId('esport-planning-jour')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-planning-vue-semaine'));
    await fireEvent.press(screen.getByTestId('esport-filtre-type-match'));
    await waitFor(() => expect(appels.some(a => a.chemin.includes('types=match'))).toBe(true));
  });
});

describe('écrans Disponibilités, Présence et accueil', () => {
  it('heatmap : « Proposer un événement » ouvre le formulaire prérempli', async () => {
    await monter(COACH, 'module:availability');
    await screen.findByTestId('esport-heatmap-plages');
    await fireEvent.press(screen.getByTestId('esport-heatmap-proposer-2026-10-19-20:00'));
    expect(await screen.findByTestId('esport-formulaire')).toBeTruthy();
    expect(screen.getByTestId('esport-formulaire-date').props.value).toBe('2026-10-19');
    expect(screen.getByTestId('esport-formulaire-debut').props.value).toBe('20:00');
    expect(screen.getByTestId('esport-formulaire-fin').props.value).toBe('22:00');
    expect(screen.getByTestId('esport-formulaire-titre').props.value).toBe('Scrim');
  });

  it('mes créneaux : ajout puis enregistrement', async () => {
    const { appels } = await monter(JOUEUR, 'module:availability', 'telephone');
    await screen.findByTestId('esport-dispos-creneaux');
    await fireEvent.press(screen.getByTestId('esport-creneau-jour-3'));
    await fireEvent.changeText(screen.getByTestId('esport-creneau-debut'), '20:00');
    await fireEvent.changeText(screen.getByTestId('esport-creneau-fin'), '22:00');
    await fireEvent.press(screen.getByTestId('esport-creneau-ajouter'));
    await fireEvent.press(screen.getByTestId('esport-creneau-enregistrer'));
    await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && a.chemin.endsWith('/dispos/moi/regles'))).toBe(true));
    const put = appels.find(a => a.chemin.endsWith('/dispos/moi/regles'))!;
    expect((put.corps as { regles: unknown[] }).regles).toEqual([
      { jour: 1, debut: '19:00', fin: '23:00', type: 'disponible' },
      { jour: 1, debut: '20:00', fin: '22:00', type: 'disponible' },
      { jour: 3, debut: '20:00', fin: '22:00', type: 'disponible' },
    ]);
  });

  it('présence : taux, par joueur et par type, export CSV', async () => {
    const exporter = jest.fn(async () => true);
    await monter(COACH, 'module:attendance', 'large', theme, exporter);
    expect((await screen.findByTestId('esport-presence-taux-global')).props.children).toBe('75 %');
    expect(screen.getByTestId('esport-stat-joueur-lea12345-taux').props.children).toBe('75 %');
    expect(screen.getByTestId('esport-stat-type-training')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-presence-csv'));
    await waitFor(() => expect(exporter).toHaveBeenCalledWith('presence.csv', '"Date"\r\n', 'text/csv'));
  });

  it('accueil de la team : prochains événements et alertes de présence', async () => {
    const { appels } = await monter(JOUEUR, 'accueil', 'telephone');
    expect(await screen.findByTestId('esport-accueil-prochains')).toBeTruthy();
    expect(await screen.findByTestId('esport-alerte-rsvp')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-alerte-rsvp-2026-10-20-non'));
    await waitFor(() => expect(appels.some(a => a.chemin.endsWith('/rsvp') && (a.corps as { rsvp: string }).rsvp === 'non')).toBe(true));
  });

  it('les trois écrans s’affichent dans les 8 thèmes, sur téléphone', async () => {
    expect(THEMES_HUB.length).toBe(8);
    for (const t of THEMES_HUB) {
      for (const [section, id] of [
        ['module:planning', 'esport-planning'],
        ['module:availability', 'esport-heatmap'],
        ['module:attendance', 'esport-presence-stats'],
      ] as const) {
        const { unmount } = await monter(COACH, section, 'telephone', t);
        expect(await screen.findByTestId(id)).toBeTruthy();
        await unmount();
      }
    }
  });
});

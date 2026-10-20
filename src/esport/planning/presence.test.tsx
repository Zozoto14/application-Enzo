/**
 * Refonte de la présence côté app : page à onglets (À marquer, Historique,
 * Statistiques ; Mes réponses, Ma présence), feuille d'appel en un appui
 * (tout présent, retard en minutes, motif, non-convoqué ajouté), statistiques
 * lisibles (jamais de « — »), fiche d'un joueur, annonce de retard ou de motif
 * côté joueur.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../../hub/themes';
import { ModeAffichageForce } from '../../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from '../client';
import { PageTeam, type SectionTeam } from '../ui/PageTeam';
import { fauxPlanning, type AppelPlanning } from './faux';

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

async function monter(permissions: string[], section: SectionTeam, mode: 'large' | 'telephone' = 'telephone') {
  const f = fauxPlanning(permissions);
  const c = {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    team: async () => detail(permissions),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    moi: async () => ({ compte: 'c', superAdmin: false, profil: { pseudo: 'Zed', riotId: null, discord: null }, peutCreerTeam: false }),
    stats: async () => ({ periode: { du: '', au: '', fuseau: 'Europe/Paris' }, membres: { actifs: 3, suspendus: 0 }, presence: null, taches: null, resumes: null, activite: null }),
    requete: f.requete,
  } as unknown as ClientEsport;
  await render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={theme} client={c} teamId="t1" large={mode === 'large'} sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
  return { appels: f.appels };
}

const puts = (appels: AppelPlanning[]) => appels.filter(a => a.methode === 'PUT' && a.chemin.endsWith('/presence')).map(a => a.corps);

describe('présence (refonte)', () => {
  it('staff sur iPhone : « À marquer » avec compteur, feuille d’appel plein écran, tout présent puis exceptions', async () => {
    const { appels } = await monter(COACH, 'module:attendance');
    // Onglet par défaut : « À marquer », avec le nombre de séances.
    expect(await screen.findByTestId('esport-presence-a-marquer')).toBeTruthy();
    expect(screen.getByTestId('esport-presence-onglet-a-marquer')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('À marquer (1)')).toBeTruthy());
    expect(screen.getByTestId('esport-a-marquer-e1e1e1e1-2026-10-20-restants')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-a-marquer-e1e1e1e1-2026-10-20-appel'));
    // Plein écran : la feuille d'appel remplace la page (retour en haut).
    expect(await screen.findByTestId('esport-presence-seance')).toBeTruthy();
    expect(screen.getByTestId('esport-presence-fermer')).toBeTruthy();
    expect(screen.queryByTestId('esport-presence-onglets')).toBeNull();
    // Compteurs en haut : convoqués et réponses ; l'annonce du joueur est visible.
    expect(screen.getByTestId('esport-presence-compteur-convoques')).toBeTruthy();
    expect(screen.getByTestId('esport-presence-avancement')).toBeTruthy();
    expect(screen.getByText(/annonce 10 min de retard/)).toBeTruthy();
    // « Tout le monde présent » : un seul envoi.
    await fireEvent.press(screen.getByTestId('esport-presence-tout-present'));
    await waitFor(() => expect(puts(appels)).toEqual([{ marques: [], toutPresent: true }]));
    expect(await screen.findByTestId('esport-presence-avis')).toBeTruthy();
    // Puis l'exception : Kai en retard de 10 minutes (deux appuis), confirmation sur sa ligne.
    await fireEvent.press(screen.getByTestId('esport-marque-kai12345-retard'));
    expect(await screen.findByTestId('esport-presence-kai12345-ok')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('esport-presence-kai12345-min-10'));
    await waitFor(() => expect(puts(appels).slice(1)).toEqual([{ marques: [{ compte: 'kai12345', reel: 'retard' }] }, { marques: [{ compte: 'kai12345', reel: 'retard', retardMinutes: 10 }] }]));
    // Léa excusée avec un motif.
    await fireEvent.press(screen.getByTestId('esport-marque-lea12345-excuse'));
    await fireEvent.changeText(await screen.findByTestId('esport-presence-lea12345-motif'), 'Malade');
    await fireEvent.press(screen.getByTestId('esport-presence-lea12345-motif-ok'));
    await waitFor(() => expect(puts(appels).at(-1)).toEqual({ marques: [{ compte: 'lea12345', reel: 'excuse', motif: 'Malade' }] }));
    // Un remplaçant venu sans convocation.
    await fireEvent.press(screen.getByTestId('esport-presence-ajouter'));
    await fireEvent.press(await screen.findByTestId('esport-presence-ajouter-tom12345'));
    await waitFor(() => expect(puts(appels).at(-1)).toEqual({ marques: [{ compte: 'tom12345', reel: 'present', horsConvocation: true }] }));
    expect(await screen.findByTestId('esport-presence-tom12345-hors')).toBeTruthy();
    // Retour à la page.
    await fireEvent.press(screen.getByTestId('esport-presence-fermer'));
    expect(await screen.findByTestId('esport-presence-onglets')).toBeTruthy();
  });

  it('statistiques lisibles : chiffres clés, définitions, série et tendance, fiche d’un joueur (jamais de « — »)', async () => {
    await monter(COACH, 'module:attendance', 'large');
    await fireEvent.press(await screen.findByTestId('esport-presence-onglet-stats'));
    expect((await screen.findByTestId('esport-presence-taux-global')).props.children).toBe('75 %');
    expect(screen.getByTestId('esport-stat-joueur-lea12345-serie')).toBeTruthy();
    expect(screen.getByText(/−25 pts/)).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
    // Définitions écrites en clair.
    await fireEvent.press(screen.getByTestId('esport-presence-definitions'));
    expect(screen.getByText(/Taux de présence = \(présents \+ en retard\)/)).toBeTruthy();
    // Périodes : 7 jours, 30 jours, 3 mois, saison, dates.
    for (const p of ['7', '30', '90', 'saison', 'perso']) expect(screen.getByTestId(`esport-presence-periode-${p}`)).toBeTruthy();
    // Fiche du joueur (volet sur PC) : historique et motifs.
    await fireEvent.press(screen.getByTestId('esport-stat-joueur-lea12345'));
    expect(await screen.findByTestId('esport-fiche-presence-motifs')).toBeTruthy();
    expect(screen.getByTestId('esport-fiche-presence-seance-2026-10-20')).toBeTruthy();
    expect(screen.getAllByText('Absent : Examen').length).toBeGreaterThan(0);
  });

  it('historique : une ligne par séance avec son taux', async () => {
    await monter(COACH, 'module:attendance', 'large');
    await fireEvent.press(await screen.findByTestId('esport-presence-onglet-historique'));
    expect(await screen.findByTestId('esport-historique-e1e1e1e1-2026-10-20')).toBeTruthy();
    expect(screen.getByText('Présence 100 %')).toBeTruthy();
  });

  it('joueur : « Mes réponses » en un appui, retard annoncé ; « Ma présence » ; pas d’onglet du staff', async () => {
    const { appels } = await monter(JOUEUR, 'module:attendance');
    expect(screen.queryByTestId('esport-presence-onglet-a-marquer')).toBeNull();
    expect(await screen.findByTestId('esport-presence-a-venir')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-presence-occ-2026-10-20-rsvp-oui'));
    await fireEvent.press(await screen.findByTestId('esport-presence-occ-2026-10-20-rsvp-annonce-retard-15'));
    await waitFor(() => expect(appels.filter(a => a.chemin.endsWith('/rsvp')).map(a => a.corps)).toEqual([{ rsvp: 'oui' }, { rsvp: 'oui', retardPrevu: 15 }]));
    await fireEvent.press(screen.getByTestId('esport-presence-occ-2026-10-20-rsvp-non'));
    await fireEvent.changeText(await screen.findByTestId('esport-presence-occ-2026-10-20-rsvp-annonce-motif'), 'Examen');
    await fireEvent.press(screen.getByTestId('esport-presence-occ-2026-10-20-rsvp-annonce-motif-ok'));
    await waitFor(() => expect(appels.filter(a => a.chemin.endsWith('/rsvp')).map(a => a.corps).at(-1)).toEqual({ rsvp: 'non', motif: 'Examen' }));
    await fireEvent.press(screen.getByTestId('esport-presence-onglet-ma-presence'));
    expect(await screen.findByTestId('esport-ma-presence')).toBeTruthy();
    expect(appels.some(a => a.chemin.includes('/presence/joueurs/moi'))).toBe(true);
  });

  it('accueil du joueur : « Mon profil de joueur » avec sa présence', async () => {
    await monter(JOUEUR, 'accueil');
    expect(await screen.findByTestId('esport-mon-suivi')).toBeTruthy();
    expect(await screen.findByTestId('esport-ma-presence-accueil')).toBeTruthy();
  });
});

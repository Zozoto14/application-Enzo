/**
 * Disponibilités de l'équipe CM unifiées (migration 0081, docs/esport/cm-reunions.md) : une seule entrée
 * « Disponibilités » dans le groupe Équipe de l'espace CM (celle de la team CM du club, sinon celle des Réunions),
 * Réunions réduites à Agenda | Rendez-vous avec un raccourci « Mes disponibilités », anciens liens redirigés.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport } from './client';
import type { MoiReunions } from './cm/reunions';
import { definirLangue } from './i18n';
import { EspaceCm, ONGLET_DISPOS_TEAM, groupesCm, normaliserOngletCm } from './ui/cm/EspaceCm';
import { Reunions } from './ui/cm/reunions/Reunions';
import type { EntreeTeamCm } from './ui/cm/SectionsTeamCm';

const theme = themeHub('nuit');
const PARIS = 'Europe/Paris';

afterEach(() => definirLangue('fr'));

const moiReunions: MoiReunions = {
  droits: { voir: true, gerer: false },
  invite: false,
  aRepondre: 0,
  compte: 'cor12345',
  profil: { fuseau: PARIS, statut: null, message: '', jusqua: null },
  equipe: [{ compte: 'cor12345', pseudo: 'Cora', fuseau: PARIS, enReunion: false, statut: 'disponible', message: '', jusqua: null, auto: true }],
};

function faux() {
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  const requete = jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/cm/reunions/moi') return moiReunions;
    if (chemin.startsWith('/cm/reunions?')) return { reunions: [], noms: {}, droits: moiReunions.droits };
    if (chemin.startsWith('/cm/reunions/dispos/moi')) return { fuseau: PARIS, teamId: '00000000-0000-4000-8000-00000000c0de', semaines: [], regles: [{ jour: 3, debut: '20:00', fin: '21:00', type: 'disponible', fuseau: PARIS }], exceptions: [] };
    if (chemin.startsWith('/cm/reunions/equipe/grille')) return { jours: [], creneaux: [], cellules: [], fuseau: PARIS, pas: 60, total: 1, noms: {}, sansCreneaux: [] };
    if (chemin.startsWith('/cm/reunions/rdv')) return { offres: [], noms: {} };
    throw new Error(`route inattendue ${methode ?? 'GET'} ${chemin}`);
  });
  const client = { config: { adresse: 'https://esport.test' }, requete } as unknown as ClientEsport;
  return { client, appels };
}

const equipeTeam: EntreeTeamCm[] = [
  { id: 'team:membres', libelle: 'Équipe CM', groupe: 'equipe' },
  { id: ONGLET_DISPOS_TEAM, libelle: 'Disponibilités', groupe: 'equipe' },
  { id: 'team:module:meeting_summaries', libelle: 'Résumés', groupe: 'equipe' },
];

describe('groupe Équipe : une seule entrée « Disponibilités »', () => {
  it('membre de la team CM du club : Équipe CM, Disponibilités (de la team), Réunions, Résumés, Rôles CM', () => {
    const equipe = groupesCm({ voirCm: true, drive: false, sponsors: false, reunions: true, disposCm: true, gerer: true, team: equipeTeam }).find(g => g.id === 'equipe')!;
    expect(equipe.entrees.map(e => [e.id, e.libelle])).toEqual([
      ['team:membres', 'Équipe CM'],
      [ONGLET_DISPOS_TEAM, 'Disponibilités'],
      ['reunions', 'Réunions'],
      ['team:module:meeting_summaries', 'Résumés'],
      ['equipe', 'Rôles CM'],
    ]);
    expect(equipe.entrees.filter(e => e.libelle === 'Disponibilités')).toHaveLength(1);
  });

  it('équipe CM hors team CM du club (correspondant) : l’entrée « dispos » des Réunions, une seule fois', () => {
    const equipe = groupesCm({ voirCm: true, drive: false, sponsors: false, reunions: true, disposCm: true, gerer: false }).find(g => g.id === 'equipe')!;
    expect(equipe.entrees.map(e => [e.id, e.libelle])).toEqual([
      ['dispos', 'Disponibilités'],
      ['reunions', 'Réunions'],
    ]);
    // Invité seulement (pas d'équipe CM) : pas de disponibilités.
    expect(groupesCm({ voirCm: false, drive: false, sponsors: false, reunions: true, gerer: false }).find(g => g.id === 'equipe')!.entrees.map(e => e.id)).toEqual(['reunions']);
  });

  it('en anglais', () => {
    definirLangue('en');
    const equipe = groupesCm({ voirCm: true, drive: false, sponsors: false, reunions: true, disposCm: true, gerer: false }).find(g => g.id === 'equipe')!;
    expect(equipe.entrees[0].libelle).toBe('Availability');
  });

  it('anciens liens : Réunions › Disponibilités → l’entrée unique', () => {
    for (const ancien of ['reunions:dispos', 'reunions-dispos', 'reunions/dispos', 'disponibilites']) expect(normaliserOngletCm(ancien)).toBe('dispos');
    expect(normaliserOngletCm('reunions')).toBe('reunions');
    expect(normaliserOngletCm(undefined)).toBeUndefined();
  });
});

describe('Réunions : Agenda | Rendez-vous', () => {
  it('plus de sous-onglet Disponibilités ; « Mes disponibilités » ouvre l’entrée du groupe Équipe', async () => {
    definirLangue('fr');
    const { client } = faux();
    const onDispos = jest.fn();
    await render(<Reunions theme={theme} client={client} large onDispos={onDispos} />);
    await screen.findByTestId('esport-cm-reunions-section-agenda');
    expect(screen.getByTestId('esport-cm-reunions-section-rdv')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-reunions-section-dispos')).toBeNull();
    expect(screen.queryByText('Disponibilités')).toBeNull();
    expect(screen.queryByTestId('esport-cm-reunions-dispos')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-reunions-mes-dispos'));
    expect(onDispos).toHaveBeenCalledTimes(1);
  });
});

describe('espace CM : ancien lien vers Réunions › Disponibilités', () => {
  it('ouvre l’entrée unique « Disponibilités » (mêmes données que la team CM du club)', async () => {
    definirLangue('fr');
    const { client, appels } = faux();
    await render(<EspaceCm theme={theme} client={client} large={false} ongletInitial={'reunions:dispos' as never} moi={{ espace: true, club: [], teams: [], gerer: false, sponsors: [], reunions: { voir: true, gerer: false, invite: false } }} />);
    expect(await screen.findByTestId('esport-cm-reunions-dispos')).toBeTruthy();
    expect(screen.getByTestId('esport-cm-dispos-source')).toBeTruthy();
    await waitFor(() => expect(appels.some(a => a.chemin.startsWith('/cm/reunions/dispos/moi'))).toBe(true));
    expect(screen.queryByTestId('esport-cm-reunions-section-agenda')).toBeNull();
  });
});

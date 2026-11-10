/**
 * Réunions de l'équipe CM côté app (docs/esport/cm-reunions.md) : règles pures du calendrier (jours d'une vue,
 * positions dans la grille horaire), onglet « Réunions » de l'espace CM (agenda semaine, fiche, réponse, notes
 * confidentielles), « Trouver un créneau » dans le formulaire, invité hors équipe CM (agenda seul), statut du moment,
 * phrases des notifications et du journal (FR / EN).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport, Notification } from './client';
import { bloc, decaler, heurePlus, joursVue, murale, type MoiReunions, type Reunion } from './cm/reunions';
import { phraseJournalCm } from './cm/libelles';
import { definirLangue } from './i18n';
import { phraseNotification } from './libelles';
import { Reunions } from './ui/cm/reunions/Reunions';
import { EspaceCm } from './ui/cm/EspaceCm';

const theme = themeHub('nuit');
const R1 = '11111111-1111-4111-8111-111111111111';
const PARIS = 'Europe/Paris';

test('calendrier : jours d’une vue (jour, semaine du lundi, mois en semaines entières), décalage, blocs horaires', () => {
  expect(joursVue('jour', '2026-10-22')).toEqual(['2026-10-22']);
  expect(joursVue('semaine', '2026-10-22')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  const mois = joursVue('mois', '2026-10-22');
  expect(mois[0]).toBe('2026-09-28');
  expect(mois.length % 7).toBe(0);
  expect(mois[mois.length - 1]).toBe('2026-11-01');
  expect(decaler('semaine', '2026-10-22', 1)).toBe('2026-10-29');
  expect(decaler('mois', '2026-10-31', 1)).toBe('2026-11-15');
  expect(bloc(18 * 60, 19 * 60, 7 * 60, 23 * 60)).toEqual({ haut: 11 * 60, hauteur: 60 });
  expect(bloc(5 * 60, 6 * 60, 7 * 60, 23 * 60)).toBeNull();
  expect(bloc(22 * 60 + 30, 30, 7 * 60, 23 * 60)).toEqual({ haut: 15 * 60 + 30, hauteur: 30 });
  expect(heurePlus('23:30', 60)).toBe('24:00');
  expect(murale('2026-10-22T16:00:00.000Z', PARIS)).toEqual({ date: '2026-10-22', heure: '18:00', minutes: 1080 });
});

function reunion(date: string, extra: Partial<Reunion> = {}): Reunion {
  return {
    id: R1,
    genre: 'reunion',
    titre: 'Point éditorial',
    cle: `${date}T16:00:00.000Z`,
    debut: `${date}T16:00:00.000Z`,
    fin: `${date}T17:00:00.000Z`,
    fuseau: PARIS,
    local: { date, heure: '18:00', heureFin: '19:00' },
    recurrence: null,
    lieuGenre: 'lien',
    lieu: '',
    lien: 'https://meet.example.org/cm',
    rappelMinutes: 15,
    organisateur: 'res12345',
    statut: 'active',
    motifAnnulation: null,
    version: 1,
    participants: [
      { compte: 'res12345', reponse: 'accepte', commentaire: '', proposition: null, reponduLe: null },
      { compte: 'cor12345', reponse: 'attente', commentaire: '', proposition: null, reponduLe: null },
    ],
    maReponse: 'attente',
    droits: { modifier: false, notes: true, repondre: true },
    ...extra,
  };
}

const moi = (extra: Partial<MoiReunions> = {}): MoiReunions => ({
  droits: { voir: true, gerer: false },
  invite: false,
  aRepondre: 1,
  compte: 'cor12345',
  profil: { fuseau: PARIS, statut: null, message: '', jusqua: null },
  equipe: [
    { compte: 'res12345', pseudo: 'Rita', fuseau: PARIS, enReunion: false, statut: 'ne_pas_deranger', message: 'Tournage', jusqua: null, auto: false },
    { compte: 'cor12345', pseudo: 'Cora', fuseau: 'America/Toronto', enReunion: false, statut: 'disponible', message: '', jusqua: null, auto: true },
  ],
  ...extra,
});

function faux(m: MoiReunions) {
  const date = murale(new Date().toISOString(), PARIS).date;
  const appels: Array<{ chemin: string; methode?: string; corps?: unknown }> = [];
  let r = reunion(date);
  const requete = jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
    appels.push({ chemin, methode, corps });
    if (chemin === '/cm/reunions/moi') return m;
    if (chemin.startsWith('/cm/reunions?')) return { reunions: [r], noms: { res12345: 'Rita', cor12345: 'Cora' }, droits: m.droits };
    if (chemin === `/cm/reunions/${R1}/reponse`) {
      r = { ...r, maReponse: (corps as { reponse: Reunion['maReponse'] }).reponse };
      return { reunion: { ...r, notes: notes() }, noms: { res12345: 'Rita', cor12345: 'Cora' } };
    }
    if (chemin === `/cm/reunions/${R1}`) return { reunion: { ...r, notes: notes() }, noms: { res12345: 'Rita', cor12345: 'Cora' } };
    if (chemin === '/cm/reunions/creneaux') {
      return {
        propositions: [{ debut: `${date}T15:00:00.000Z`, fin: `${date}T16:00:00.000Z`, libres: ['cor12345', 'res12345'], inconnus: [], occupes: [], absents: [], n: 2, total: 2, tous: true, local: { date: '2026-12-03', heure: '17:00', heureFin: '18:00' } }],
        participants: [],
        noms: { res12345: 'Rita', cor12345: 'Cora' },
        fuseau: PARIS,
      };
    }
    if (chemin.startsWith('/cm/reunions/comptes')) return { comptes: [] };
    if (chemin === '/cm/moi') return { espace: true, club: [], teams: [], gerer: false, sponsors: [], reunions: { voir: false, gerer: false, invite: true } };
    throw new Error(`route inattendue ${methode ?? 'GET'} ${chemin}`);
  });
  const client = { config: { adresse: 'https://esport.test' }, requete } as unknown as ClientEsport;
  return { client, appels, date };
}
const notes = () => ({ ordreDuJour: 'Plan', compteRendu: '', majPar: null, majLe: null, taches: [] });

test('onglet Réunions : agenda de la semaine, statuts de l’équipe, fiche, réponse « Accepter », notes confidentielles', async () => {
  definirLangue('fr');
  const { client, appels } = faux(moi());
  await render(<Reunions theme={theme} client={client} large />);
  await screen.findByTestId(`esport-cm-reunion-${R1}`);
  expect(screen.getByTestId('esport-cm-reunions-a-repondre')).toBeTruthy();
  expect(screen.getByText('1 invitation attend votre réponse')).toBeTruthy();
  // Équipe CM : statut et message de Rita.
  expect(screen.getByTestId('esport-cm-reunions-equipe-res12345')).toBeTruthy();
  expect(screen.getByText('Ne pas déranger · Tournage')).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`esport-cm-reunion-${R1}`));
  await screen.findByTestId('esport-cm-reunion-detail');
  expect(await screen.findByTestId('esport-cm-reunion-confidentiel')).toBeTruthy();
  expect(screen.getByText('En attente')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-cm-reunion-accepter'));
  await waitFor(() => expect(appels.some(a => a.chemin === `/cm/reunions/${R1}/reponse` && (a.corps as { reponse: string }).reponse === 'accepte')).toBe(true));
});

test('nouvelle réunion : « Trouver un créneau » propose les créneaux et remplit date et heure', async () => {
  definirLangue('fr');
  const { client, appels } = faux(moi());
  await render(<Reunions theme={theme} client={client} large />);
  await fireEvent.press(await screen.findByTestId('esport-cm-reunions-nouvelle'));
  await fireEvent.changeText(screen.getByTestId('esport-cm-reunion-form-titre'), 'Bilan du mois');
  await fireEvent.press(screen.getByTestId('esport-cm-reunion-form-p-res12345'));
  await fireEvent.press(screen.getByTestId('esport-cm-reunion-creneaux-chercher'));
  await screen.findByTestId('esport-cm-reunion-proposition-0');
  const appel = appels.find(a => a.chemin === '/cm/reunions/creneaux');
  expect(appel?.corps).toMatchObject({ participants: ['res12345'], duree: 60, jours: 7 });
  expect(screen.getByText('Tout le monde est libre')).toBeTruthy();
  expect(screen.getByText('Libres : Cora, Rita')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-cm-reunion-proposition-0-choisir'));
  expect(screen.getByTestId('esport-cm-reunion-form-date').props.value).toBe('03/12/2026');
  expect(screen.getByTestId('esport-cm-reunion-form-heure').props.value).toBe('17:00');
});

test('membre du club invité (hors équipe CM) : l’espace CM n’ouvre que l’onglet Réunions, sans création ni disponibilités', async () => {
  definirLangue('fr');
  const m = moi({ droits: { voir: false, gerer: false }, invite: true, equipe: [] });
  const { client } = faux(m);
  await render(<EspaceCm theme={theme} client={client} large moi={{ espace: true, club: [], teams: [], gerer: false, sponsors: [], reunions: { voir: false, gerer: false, invite: true } }} />);
  expect(await screen.findByTestId('esport-cm-reunions')).toBeTruthy();
  await screen.findByTestId(`esport-cm-reunion-${R1}`);
  expect(screen.queryByTestId('esport-cm-reunions-nouvelle')).toBeNull();
  expect(screen.queryByTestId('esport-cm-reunions-section')).toBeNull();
  expect(screen.getByText('Vous voyez les réunions de l’équipe CM où vous êtes invité.')).toBeTruthy();
});

test('notifications et journal des réunions, en français et en anglais', () => {
  const n = (type: string, charge: Record<string, unknown>) => ({ id: '1', type, team: null, charge, lue: false, date: '' }) as unknown as Notification;
  definirLangue('fr');
  expect(phraseNotification(n('cm-reunion-invite', { titre: 'Point', membre: 'res12345', debut: '2026-10-22T16:00:00.000Z', fuseau: PARIS }), { res12345: 'Rita' })).toMatch(/^Rita vous invite à « Point » \(.*18:00\)$/);
  expect(phraseNotification(n('cm-reunion-annulee', { titre: 'Point', debut: '2026-10-22T16:00:00.000Z', fuseau: PARIS, motif: 'Report' }), {})).toMatch(/est annulée .* : Report$/);
  expect(phraseNotification(n('cm-reunion-reponse', { titre: 'Point', membre: 'cor12345', reponse: 'propose' }), { cor12345: 'Cora' })).toBe('Cora propose un autre horaire pour « Point »');
  expect(phraseJournalCm('cm.rdv_reserve', 'Cora', { titre: 'RDV' })).toBe('Cora a réservé le rendez-vous « RDV »');
  definirLangue('en');
  expect(phraseNotification(n('cm-reunion-reponse', { titre: 'Point', membre: 'cor12345', reponse: 'accepte' }), { cor12345: 'Cora' })).toBe('Cora accepted “Point”');
  expect(phraseNotification(n('cm-reunion-rappel', { titre: 'Point', debut: '2026-10-22T16:00:00.000Z', fuseau: PARIS }), {})).toBe('Reminder: “Point” starts at 18:00');
  definirLangue('fr');
});

/**
 * Page « Réseaux » côté app : onglet de l'espace CM (pas d'entrée de plus dans la barre du bas), tableau de bord
 * (totaux, top posts, comparaison des réseaux, abonnés), comptes et réglage de l'annonce Discord (variables
 * contrôlées en direct, aperçu, cibles), import CSV (correspondance, création), formats (nombres, %, durées),
 * phrases du journal et de la notification « relevez les statistiques » (FR / EN).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport, Notification } from './client';
import type { MoiCm } from './cm/api';
import { duree, nombreCompact, pourcentage, variablesInconnues, variationSignee, type EtatReseaux, type TableauDeBordReseaux } from './cm/reseauxApi';
import { phraseJournalCm } from './cm/libelles';
import { definirLangue } from './i18n';
import { libelleChamp, raisonImport } from './i18n/reseaux';
import { phraseNotification } from './libelles';
import { CadreEsport } from './ui/CadreEsport';
import { EspaceCm } from './ui/cm/EspaceCm';
import { EspaceReseaux } from './ui/cm/reseaux/EspaceReseaux';

const theme = themeHub('nuit');
const TEAM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const COMPTE = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const SALON = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

const etat = (gerer = true): EtatReseaux => ({
  droits: { voir: true, editer: true, gerer, club: true },
  reseaux: [
    { cle: 'x', nom: 'X', couleur: '#0f1419', glyphe: '𝕏', posts: true },
    { cle: 'instagram', nom: 'Instagram', couleur: '#d62976', glyphe: '◎', posts: true },
    { cle: 'youtube', nom: 'YouTube', couleur: '#ff0000', glyphe: '▶', posts: false },
  ],
  typesContenu: ['annonce', 'match', 'resultat', 'clip', 'sponsor', 'coulisses', 'recrutement', 'autre'],
  variables: ['reseau', 'compte', 'url', 'titre', 'team'],
  modelesDefaut: { en: 'New {reseau} post from {compte}: {titre}\n{url}', fr: 'Nouveau post {reseau} de {compte} : {titre}\n{url}' },
  comptes: [
    {
      id: COMPTE,
      reseau: 'x',
      identifiant: 'Club_GG',
      url: 'https://x.com/Club_GG',
      nom: '',
      teamId: null,
      actif: true,
      dernierReleve: { jour: '2026-10-27', abonnes: 1250 },
      ...(gerer ? { annonce: { active: true, modeleEn: null, modeleFr: null, roleMention: null, cibles: [{ cle: `salon:${SALON}`, genre: 'salon' as const, teamId: null, salonId: SALON }], dernierTest: null } } : {}),
    },
  ],
  teams: [{ id: TEAM, nom: 'Team Alpha', discord: 'webhook' }],
  ...(gerer ? { salons: [{ id: SALON, nom: 'annonces', masque: '…/WXYZ', filFr: true, langue: 'fr' as const, dernierSucces: null, dernierEchec: null, invalide: false, dernierTest: null }], reglages: { rappels: true }, bot: true } : {}),
});

const tdb = (): TableauDeBordReseaux => ({
  periode: { du: '2026-09-28', au: '2026-10-27' },
  totaux: { publications: 3, relevees: 3, vues: 23500, interactions: 1300, engagement: 5.53, abonnes: 1250, variationAbonnes: 250 },
  comptes: [{ id: COMPTE, reseau: 'x', identifiant: 'Club_GG', teamId: null, team: null, serie: [{ jour: '2026-09-28', abonnes: 1000 }, { jour: '2026-10-27', abonnes: 1250 }], debut: 1000, fin: 1250, variation: 250, variationPct: 25, vues: null, impressions: null, publications: 300 }],
  topVues: [
    { id: 'p1', titre: 'Highlights', reseau: 'youtube', url: 'https://www.youtube.com/watch?v=abc', type: 'clip', team: null, compte: 'ClubGG', publieLe: '2026-10-22T12:00:00.000Z', vues: 12000, interactions: 640, engagement: 5.33, jour: '2026-10-26' },
    { id: 'p2', titre: 'Victoire 2-0', reseau: 'x', url: 'https://x.com/Club_GG/status/1', type: 'resultat', team: 'Team Alpha', compte: 'Club_GG', publieLe: '2026-10-20T10:00:00.000Z', vues: 3500, interactions: 300, engagement: 6, jour: '2026-10-27' },
  ],
  topEngagement: [{ id: 'p2', titre: 'Victoire 2-0', reseau: 'x', url: 'https://x.com/Club_GG/status/1', type: 'resultat', team: 'Team Alpha', compte: 'Club_GG', publieLe: '2026-10-20T10:00:00.000Z', vues: 3500, interactions: 300, engagement: 6, jour: '2026-10-27' }],
  parReseau: [
    { cle: 'x', publications: 1, relevees: 1, vues: 3500, interactions: 300, engagement: 6 },
    { cle: 'youtube', publications: 1, relevees: 1, vues: 12000, interactions: 640, engagement: 5.33 },
  ],
  parType: [{ cle: 'clip', publications: 1, relevees: 1, vues: 12000, interactions: 640, engagement: 5.33 }],
  parTeam: [{ cle: 'club', nom: null, publications: 1, relevees: 1, vues: 12000, interactions: 640, engagement: 5.33 }],
});

function fauxClient(gerer = true) {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === '/cm/reseaux') return etat(gerer) as R;
    if (c === '/cm/reseaux/tableau-de-bord') return tdb() as R;
    if (c === '/cm/reseaux/annonces') return { annonces: [] } as R;
    if (c === '/cm/reseaux/apercu')
      return {
        en: { texte: '', embed: { title: '𝕏 2-0 win', description: '@Club_GG on X: 2-0 win against the Falcons' }, mention: '<@&930000000000000001>' },
        fr: { texte: '', embed: { title: '𝕏 Victoire', description: '@Club_GG sur X : Victoire 2-0 contre les Faucons' }, mention: null },
      } as R;
    if (c === '/cm/reseaux/import/apercu') return { genre: 'posts', separateur: ';', entetes: ['Post URL', 'Views'], exemples: [['https://x.com/Club_GG/status/1', '1200']], lignes: 1, correspondance: { 0: 'url', 1: 'vues' }, champs: ['url', 'reseau', 'jour', 'vues'] } as R;
    if (c === '/cm/reseaux/import') return { releves: 1, crees: 0, invalides: [{ ligne: 3, code: 'publication-inconnue' }], nInvalides: 1 } as R;
    if (c === '/cm/etat') return { versions: {}, aValider: 0 } as R;
    if (c === '/cm/tableaux') return { tableaux: [], portees: [] } as R;
    return { ok: true } as R;
  };
  const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete } as unknown as ClientEsport;
  return { client, appels };
}

afterEach(() => definirLangue('fr'));

describe('page Réseaux', () => {
  it('formats et règles : nombres compacts, %, variations, durées, variables d’un modèle, champs et raisons d’import', () => {
    expect(nombreCompact(950, 'fr-FR')).toBe('950');
    expect(nombreCompact(12500, 'fr-FR').replace(/\s/g, ' ')).toBe('12,5 k');
    expect(nombreCompact(null, 'fr-FR')).toBe('—');
    expect(pourcentage(6.67, 'fr-FR')).toBe('6,67 %');
    expect(variationSignee(250, 'fr-FR')).toBe('+250');
    expect(variationSignee(-12, 'en-GB')).toBe('−12');
    expect(duree(65)).toBe('1:05');
    expect(variablesInconnues('{reseau} {pseudo} {titre} {pseudo}', ['reseau', 'titre'])).toEqual(['pseudo']);
    expect(libelleChamp('vues')).toBe('Vues');
    expect(libelleChamp('url')).toBe('Adresse du post');
    expect(raisonImport('publication-inconnue')).toMatch(/publication inconnue/);
    expect(raisonImport('likes')).toBe('valeur illisible (J’aime)');
    definirLangue('en');
    expect(libelleChamp('portee')).toBe('Reach');
  });

  it('journal et notification : phrases FR et EN (motif du serveur traduit)', () => {
    expect(phraseJournalCm('cm.reseau_compte_cree', 'Clara', { identifiant: 'Club_GG' })).toBe('Clara a modifié les comptes réseaux (@Club_GG)');
    expect(phraseJournalCm('cm.post_adresses', 'Clara', { titre: 'Victoire' })).toBe('Clara a mis à jour les adresses du post « Victoire »');
    const n = { id: '1', type: 'cm-releve', team: null, charge: { titre: 'Victoire', reseau: 'x', j: 7 }, creeLe: '2026-10-27T10:00:00.000Z', lueLe: null } as unknown as Notification;
    expect(phraseNotification(n, {})).toBe('Réseaux · relevez les statistiques de « Victoire » (x, J+7)');
    definirLangue('en');
    expect(phraseJournalCm('cm.annonce_abandonnee', 'x', { reseau: 'x', motif: 'Annonce désactivée pour ce compte' })).toBe('Discord announcement (x) dropped: Announcement disabled for this account');
    expect(phraseNotification(n, {})).toBe('Social · record the stats of “Victoire” (x, D+7)');
  });

  it('espace CM : onglet « Réseaux » pour qui voit la section CM, pas pour un compte sans cm.voir', async () => {
    const { client } = fauxClient(false);
    const moi = (club: string[], sponsors: string[] = []): MoiCm => ({ espace: true, club: club as MoiCm['club'], teams: [], gerer: club.includes('cm.gerer'), sponsors });
    const r = await render(<CadreEsport theme={theme} large onglet="teams" onOnglet={() => undefined}><EspaceCm theme={theme} client={client} large moi={moi(['cm.voir'])} /></CadreEsport>);
    await fireEvent.press(screen.getByTestId('esport-cm-onglet-reseaux'));
    expect(await screen.findByTestId('esport-rs-tdb')).toBeTruthy();
    // Sans cm.gerer : pas d'onglet « Bot Discord ».
    expect(screen.queryByTestId('esport-rs-onglet-bot')).toBeNull();
    await r.unmount();
    await render(<CadreEsport theme={theme} large onglet="teams" onOnglet={() => undefined}><EspaceCm theme={theme} client={client} large moi={moi(['cm.deposer'])} /></CadreEsport>);
    expect(screen.queryByTestId('esport-cm-onglet-reseaux')).toBeNull();
  });

  it('tableau de bord : totaux, abonnés, top posts, comparaison des réseaux ; filtres envoyés au serveur', async () => {
    const { client, appels } = fauxClient();
    await render(<EspaceReseaux theme={theme} client={client} large />);
    expect(await screen.findByTestId('esport-rs-tdb-top-vues-p1')).toBeTruthy();
    expect(screen.getByTestId('esport-rs-tdb-vues')).toBeTruthy();
    expect(screen.getByText('23,5 k'.replace(' ', ' '))).toBeTruthy();
    expect(screen.getByText('+250 sur la période')).toBeTruthy();
    expect(screen.getByTestId('esport-rs-tdb-reseaux-youtube')).toBeTruthy();
    expect(screen.getByTestId(`esport-rs-tdb-courbe-${COMPTE}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-rs-tdb-filtres-reseau-x'));
    await waitFor(() => expect(appels.some(a => a.chemin.startsWith('/cm/reseaux/tableau-de-bord') && a.chemin.includes('reseau=x'))).toBe(true));
  });

  it('annonce Discord d’un compte : variables contrôlées en direct, aperçu EN / FR, cibles et enregistrement', async () => {
    const { client, appels } = fauxClient();
    await render(<EspaceReseaux theme={theme} client={client} large />);
    await fireEvent.press(await screen.findByTestId('esport-rs-onglet-comptes'));
    await fireEvent.press(await screen.findByTestId(`esport-rs-compte-${COMPTE}-annonce`));
    await fireEvent.changeText(await screen.findByTestId('esport-rs-annonce-modele-en'), 'Hi {pseudo}');
    expect(await screen.findByTestId('esport-rs-annonce-inconnues')).toBeTruthy();
    expect(screen.getByTestId('esport-rs-annonce-enregistrer').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('esport-rs-annonce-modele-en'), '{compte} on {reseau}: {titre}');
    await fireEvent.press(screen.getByTestId('esport-rs-annonce-apercu'));
    expect((await screen.findByTestId('esport-rs-annonce-apercu-fr')).props.children).toBe('@Club_GG sur X : Victoire 2-0 contre les Faucons');
    // Ajouter le salon de la Team Alpha, puis enregistrer : cibles envoyées (salon du club déjà coché).
    await fireEvent(screen.getByTestId(`esport-rs-annonce-cible-team-${TEAM}`), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('esport-rs-annonce-role'), '930000000000000001');
    await fireEvent.press(screen.getByTestId('esport-rs-annonce-enregistrer'));
    await waitFor(() => expect(appels.find(a => a.methode === 'PUT' && a.chemin === `/cm/reseaux/comptes/${COMPTE}/annonce`)?.corps).toEqual({
      active: true,
      modeleEn: '{compte} on {reseau}: {titre}',
      modeleFr: '',
      roleMention: '930000000000000001',
      cibles: [{ genre: 'team', id: TEAM }, { genre: 'salon', id: SALON }],
    }));
  });

  it('import CSV : aperçu, correspondance proposée, import et lignes écartées expliquées', async () => {
    const { client, appels } = fauxClient();
    await render(<EspaceReseaux theme={theme} client={client} large />);
    await fireEvent.press(await screen.findByTestId('esport-rs-onglet-outils'));
    await fireEvent.changeText(await screen.findByTestId('esport-rs-import-texte'), 'Post URL;Views\nhttps://x.com/Club_GG/status/1;1200');
    await fireEvent.press(screen.getByTestId('esport-rs-import-apercu'));
    expect(await screen.findByTestId('esport-rs-import-correspondance')).toBeTruthy();
    await fireEvent(screen.getByTestId('esport-rs-import-creer'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('esport-rs-import-ok'));
    await waitFor(() => expect(appels.find(a => a.chemin === '/cm/reseaux/import')?.corps).toEqual({ genre: 'posts', contenu: 'Post URL;Views\nhttps://x.com/Club_GG/status/1;1200', correspondance: { 0: 'url', 1: 'vues' }, creer: true }));
    expect(await screen.findByText(/Ligne 3 : publication inconnue/)).toBeTruthy();
  });
});

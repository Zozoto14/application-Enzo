/**
 * Rubrique Sponsors côté app : rangée dans l'espace CM (onglet « Sponsors », seul visible pour un compte qui
 * n'a que les Sponsors ; rien pour un compte sans permission), Kanban du pipeline (colonnes, déplacement au
 * clavier, perte motivée), règles pures (montants, périodes, mailto FR / EN, déplacements), phrases des
 * notifications et du journal (FR / EN), mention sponsor d'une carte post.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport, Notification } from './client';
import type { MoiCm } from './cm/api';
import { apiSponsors, type Etape, type Pipeline as DonneesPipeline, type ResumeProspect } from './sponsors/api';
import { phraseJournalSponsors } from './sponsors/libelles';
import { cibleDeplacement, formaterMontant, lienMailto, nomPeriode, prospectsDe, saisieMontant } from './sponsors/regles';
import { definirLangue } from './i18n';
import { phraseNotification } from './libelles';
import { CadreEsport } from './ui/CadreEsport';
import { EspaceCm } from './ui/cm/EspaceCm';
import { MentionsSponsors } from './ui/sponsors/MentionsSponsors';
import { Pipeline } from './ui/sponsors/Pipeline';

const theme = themeHub('nuit');
const P1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const P2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const PART = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';

const etape = (id: string, cle: string, issue: Etape['issue'], position: number): Etape => ({ id, cle, nom: null, issue, couleur: '#579dff', position, archive: false });
const ETAPES: Etape[] = [etape('e1', 'a_contacter', 'ouverte', 1), etape('e2', 'contacte', 'ouverte', 2), etape('e6', 'signe', 'gagnee', 6), etape('e7', 'perdu', 'perdue', 7)];

const prospect = (id: string, nom: string, etapeId: string, position: number, extra: Partial<ResumeProspect> = {}): ResumeProspect => ({
  id,
  nom,
  secteur: 'Boissons',
  taille: 'pme',
  source: '',
  interet: 2,
  priorite: 'normale',
  valeurEstimee: 150000,
  etapeId,
  issue: ETAPES.find(e => e.id === etapeId)!.issue,
  position,
  responsable: null,
  teams: [],
  prochaineAction: '',
  prochaineActionLe: null,
  actionEnRetard: false,
  contact: null,
  partenaireId: null,
  raisonPerte: null,
  version: 1,
  majLe: '',
  ...extra,
});

const pipeline = (): DonneesPipeline => ({
  etapes: ETAPES,
  prospects: [prospect(P1, 'Brasserie Zéphyr', 'e1', 1024, { prochaineAction: 'Envoyer le deck', prochaineActionLe: '2026-10-19T08:00:00.000Z', actionEnRetard: true, contact: { nom: 'Ana Test', role: 'Marketing' } }), prospect(P2, 'Atelier Nimbus', 'e1', 2048, { priorite: 'haute' })],
  noms: {},
  teams: {},
  gerer: true,
});

function fauxClient() {
  const appels: Array<{ chemin: string; methode: string; corps?: unknown }> = [];
  const requete = async <R,>(chemin: string, methode = 'GET', corps?: unknown): Promise<R> => {
    appels.push({ chemin, methode, corps });
    const c = chemin.split('?')[0];
    if (c === '/sponsors/pipeline') return pipeline() as R;
    if (/^\/sponsors\/prospects\/[0-9a-f-]+\/deplacer$/.test(c)) return { ok: true, etapeId: (corps as { etapeId: string }).etapeId, issue: 'ouverte', convertible: false } as R;
    if (c === '/sponsors/comptes') return { comptes: [] } as R;
    if (c === '/sponsors/mentionnables') return { partenaires: [{ id: PART, nom: 'Brasserie Zéphyr', niveau: 'principal' }] } as R;
    if (c === '/sponsors/tableau-de-bord')
      return {
        aujourdhui: '2026-10-20',
        pipeline: { etapes: ETAPES.map(e => ({ ...e, n: 0, valeur: 0 })), ouverts: 2, valeurOuverte: 300000 },
        conversion: { signes: 1, perdus: 1, taux: 50, depuis: '2025-10-20' },
        revenus: { annee: 2026, mois: Array.from({ length: 12 }, (_, i) => ({ mois: `2026-${String(i + 1).padStart(2, '0')}`, numeraire: 0, nature: 0 })), numeraire: 0, nature: 0 },
        partenairesActifs: 1,
        obligationsEnRetard: [{ obligationId: 'o1', partenaire: { id: PART, nom: 'Brasserie Zéphyr' }, intitule: '2 posts par mois', periode: '2026-09', fin: '2026-09-30', fait: 1, quantite: 2 }],
        obligationsAFaire: [],
        contratsExpirant: [],
        actions: [],
        noms: {},
      } as R;
    if (c === '/cm/etat') return { versions: {}, aValider: 0 } as R;
    if (c === '/cm/tableaux') return { tableaux: [], portees: [] } as R;
    return { ok: true } as R;
  };
  const client = { config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete } as unknown as ClientEsport;
  return { client, appels };
}

afterEach(() => definirLangue('fr'));

describe('rubrique Sponsors', () => {
  it('règles : montants, périodes, prospects d’une étape, déplacements au clavier', () => {
    expect(formaterMontant(150050).replace(/\s/g, ' ')).toBe('1 500,50 €');
    expect(formaterMontant(300000).replace(/\s/g, ' ')).toBe('3 000 €');
    expect(saisieMontant(150050)).toBe('1500,50');
    expect(saisieMontant(0)).toBe('');
    expect(nomPeriode('2026-T4')).toBe('T4 2026');
    expect(nomPeriode('2026-S07')).toBe('Semaine 7 · 2026');
    expect(nomPeriode('2026-10')).toMatch(/octobre 2026/);
    const d = pipeline();
    expect(prospectsDe(d.prospects, 'e1').map(p => p.id)).toEqual([P1, P2]);
    expect(cibleDeplacement(ETAPES, d.prospects, P1, 'haut')).toBeUndefined();
    expect(cibleDeplacement(ETAPES, d.prospects, P1, 'bas')).toEqual({ etapeId: 'e1', index: 1, issue: 'ouverte' });
    expect(cibleDeplacement(ETAPES, d.prospects, P1, 'suivante')).toEqual({ etapeId: 'e2', index: 0, issue: 'ouverte' });
    expect(cibleDeplacement(ETAPES, d.prospects, P1, 'precedente')).toBeUndefined();
    definirLangue('en');
    expect(nomPeriode('2026-T4')).toBe('Q4 2026');
  });

  it('e-mail : modèle FR ou EN en mailto (variables remplies, adresse vérifiée, sans injection d’en-tête)', () => {
    const fr = lienMailto('ana@site-exemple.fr', 'premier_contact', 'fr', { prenom: 'Ana', entreprise: 'Brasserie Zéphyr', club: 'les Faucons' })!;
    expect(fr.startsWith('mailto:ana@site-exemple.fr?subject=')).toBe(true);
    expect(decodeURIComponent(fr)).toContain('Bonjour Ana');
    expect(decodeURIComponent(fr)).toContain('Brasserie Zéphyr');
    const en = decodeURIComponent(lienMailto('ana@site-exemple.fr', 'relance', 'en', { prenom: 'Ana', entreprise: 'Brasserie Zéphyr', club: 'the Falcons' })!);
    expect(en).toContain('Hello Ana');
    expect(decodeURIComponent(lienMailto('ana@site-exemple.fr', 'premier_contact', 'en', { prenom: 'Ana', entreprise: 'X', club: '' })!)).toContain('partnerships at our club');
    expect(en).toContain('reply “stop”');
    expect(lienMailto('pas une adresse', 'relance', 'fr', { prenom: '', entreprise: '', club: '' })).toBeUndefined();
    expect(lienMailto('a@b.fr?cc=x@y.fr', 'relance', 'fr', { prenom: '', entreprise: '', club: '' })).toBeUndefined();
  });

  it('notifications et journal : phrases FR et EN', () => {
    const n = (type: string, charge: Record<string, unknown>): Notification => ({ id: '1', type, team: null, charge, creeLe: '2026-10-20T10:00:00.000Z', lueLe: null }) as unknown as Notification;
    expect(phraseNotification(n('sp-contrat', { titre: 'Brasserie Zéphyr', fin: '2026-11-15' }), {})).toBe('Sponsors · le contrat de Brasserie Zéphyr se termine le 2026-11-15');
    expect(phraseNotification(n('sp-obligation', { titre: 'Brasserie Zéphyr', intitule: 'Logo', fait: 1, quantite: 2, fin: '2026-10-31' }), {})).toContain('(1 / 2, avant le 2026-10-31)');
    expect(phraseJournalSponsors('sponsors.prospect_converti', 'Clara', { titre: 'Atelier Nimbus' })).toBe('Clara a converti « Atelier Nimbus » en partenaire');
    expect(phraseJournalSponsors('cm.carte_creee', 'Clara', {})).toBeUndefined();
    definirLangue('en');
    expect(phraseNotification(n('sp-action', { titre: 'Atelier Nimbus', action: 'Call back' }), {})).toBe('Sponsors · action planned today for “Atelier Nimbus”: Call back');
    expect(phraseJournalSponsors('sponsors.import', 'Clara', { crees: 3 })).toBe('Clara imported 3 prospects');
  });

  it('espace CM : onglet « Sponsors » selon les droits ; seul visible pour un compte qui n’a que les Sponsors', async () => {
    const { client, appels } = fauxClient();
    const moi = (club: string[], sponsors: string[]): MoiCm => ({ espace: true, club: club as MoiCm['club'], teams: [], gerer: club.includes('cm.gerer'), sponsors });
    const r = await render(<CadreEsport theme={theme} large onglet="teams" onOnglet={() => undefined}><EspaceCm theme={theme} client={client} large moi={moi(['cm.voir', 'cm.editer'], [])} /></CadreEsport>);
    expect(screen.queryByTestId('esport-cm-groupe-partenaires')).toBeNull();
    await r.unmount();
    appels.length = 0;
    // Lecteur Sponsors seulement : l'espace s'ouvre sur la rubrique, sans tableau CM ni requête /cm/etat.
    const r2 = await render(<CadreEsport theme={theme} large onglet="teams" onOnglet={() => undefined}><EspaceCm theme={theme} client={client} large moi={moi([], ['sponsors.voir'])} /></CadreEsport>);
    expect(screen.getByTestId('esport-cm-groupe-partenaires')).toBeTruthy();
    expect(screen.queryByTestId('esport-cm-groupe-contenus')).toBeNull();
    expect(await screen.findByTestId('esport-sp-tdb')).toBeTruthy();
    expect(screen.queryByTestId('esport-sp-onglet-outils')).toBeNull();
    expect(screen.getByTestId(`esport-sp-tdb-retard-o1-2026-09`)).toBeTruthy();
    expect(appels.some(a => a.chemin === '/cm/etat')).toBe(false);
    await r2.unmount();
  });

  it('pipeline : colonnes par étape, action en retard signalée, déplacement au clavier, perte motivée', async () => {
    const { client, appels } = fauxClient();
    await render(<Pipeline theme={theme} api={apiSponsors(client)} large version={0} onOuvrir={() => undefined} onNouveau={() => undefined} onConvertir={() => undefined} />);
    expect(await screen.findByTestId(`esport-sp-carte-${P1}`)).toBeTruthy();
    expect(screen.getByTestId('esport-sp-colonne-a_contacter')).toBeTruthy();
    expect(screen.getByTestId(`esport-sp-carte-${P1}-action`).props.children).toMatch(/^⚠ Envoyer le deck/);
    await fireEvent.press(screen.getByTestId(`esport-sp-carte-${P1}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-sp-carte-${P1}-suivante`));
    await waitFor(() => expect(appels.some(a => a.chemin === `/sponsors/prospects/${P1}/deplacer` && (a.corps as { etapeId: string }).etapeId === 'e2')).toBe(true));
    // Vers « Perdu » : la raison est demandée avant tout envoi.
    await fireEvent.press(screen.getByTestId(`esport-sp-carte-${P2}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-sp-carte-${P2}-vers-perdu`));
    expect(await screen.findByTestId('esport-sp-perte')).toBeTruthy();
    expect(appels.some(a => a.chemin === `/sponsors/prospects/${P2}/deplacer`)).toBe(false);
    await fireEvent.changeText(screen.getByTestId('esport-sp-perte-raison'), 'Budget gelé');
    await waitFor(() => expect(screen.getByTestId('esport-sp-perte-ok').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByTestId('esport-sp-perte-ok'));
    await waitFor(() => expect(appels.find(a => a.chemin === `/sponsors/prospects/${P2}/deplacer`)?.corps).toEqual({ etapeId: 'e7', index: 0, raisonPerte: 'Budget gelé' }));
  });

  it('carte post : « mention sponsor » cochable (partenaires actifs, nom seulement)', async () => {
    const { client } = fauxClient();
    const changes: unknown[] = [];
    await render(<MentionsSponsors theme={theme} client={client} liens={{ membres: ['abc123'] }} noms={[]} editer onChanger={l => changes.push(l)} />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-lien-sponsor-${PART}`));
    expect(changes).toEqual([{ membres: ['abc123'], sponsors: [PART] }]);
    await render(<MentionsSponsors theme={theme} client={client} liens={{ sponsors: [PART] }} noms={[{ id: PART, nom: 'Brasserie Zéphyr' }]} editer={false} onChanger={() => undefined} />);
    expect(screen.getByText('Mention sponsor : Brasserie Zéphyr')).toBeTruthy();
  });
});

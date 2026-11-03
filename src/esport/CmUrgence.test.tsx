/**
 * Drapeau d'urgence des cartes CM (docs/esport/cm.md, « Urgences ») : carte compacte (drapeau sans agrandir la carte,
 * libellé accessible), compteurs d'en-tête de colonne, filtre par niveau, tri de colonne par urgence (mémorisé),
 * réglage par la fiche et par le menu ⋯ (permission cm.editer), notifications FR / EN, couleurs lisibles.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { THEMES_HUB, themeHub } from '../hub/themes';
import { clientEsport, oublierSessions, type ClientEsport } from './client';
import { apiCm, type CarteResume, type DetailTableau, type ReponseCarte, type Urgence } from './cm/api';
import { phraseJournalCm, phraseNotificationCm } from './cm/libelles';
import { barresUrgence, compterUrgences, couleurUrgence, fondCarteUrgence, jetonUrgence, NIVEAUX_URGENCE, rangUrgence, trierParUrgence } from './cm/urgence';
import { contraste } from './contraste';
import { definirLangue } from './i18n';
import { Tableau, carteAInfos, carteVisible } from './ui/cm/Tableau';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const [A, B, C, D, E] = ['1', '2', '3', '4', '5'].map(n => `cccccccc-cccc-4ccc-8ccc-ccccccccccc${n}`);

const resume = (id: string, titre: string, position: number, urgence: Urgence | null, extra: Partial<CarteResume> = {}): CarteResume => ({
  id, listeId: L1, teamId: null, titre, description: false, position, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null,
  etiquettes: [], membres: [], urgence, commentaires: 0, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true, ...extra,
});

function tableau(editer = true): DetailTableau {
  return {
    tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: [{ id: L1, nom: 'Idées', cle: null, position: 1024, archive: false }],
    etiquettes: [],
    cartes: [
      resume(A, 'Faible chose', 1, 'faible'),
      resume(B, 'Carte critique', 2, 'critique'),
      resume(C, 'Sans drapeau', 3, null),
      resume(D, 'Carte urgente', 4, 'urgent'),
      resume(E, 'Critique archivée', 5, 'critique', { archive: true }),
    ],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  };
}

function reponseCarte(urgence: Urgence | null): ReponseCarte {
  return {
    carte: {
      id: A, tableauId: T, listeId: L1, teamId: null, titre: 'Faible chose', description: '', position: 1, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, urgence, post: false, statut: null, reseaux: [], textes: {}, liens: {},
      publications: {}, soumisPar: null, soumisLe: null, validePar: null, valideLe: null, refusMotif: null, refusePar: null, publiePar: null, publieLe: null, origine: 'manuel', depotGenre: null, trello: false, archive: false,
      creePar: 'cm123456', creeLe: '2026-10-20T09:00:00.000Z', majLe: '', version: 1, etiquettes: [], membres: [], checklists: [], commentaires: [], pieces: [], activite: [{ id: 'a1', acteur: 'cm123456', action: 'urgence', meta: { de: null, vers: 'faible' }, date: '2026-10-20T09:05:00.000Z' }], clips: [], resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: {},
    problemes: [],
  };
}

interface Appel {
  url: string;
  methode: string;
  xMethode?: string;
  corps?: Record<string, unknown>;
}
function fauxServeur(repondre: (a: Appel) => { status?: number; corps: unknown } | undefined) {
  const appels: Appel[] = [];
  const requete = jest.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    const a: Appel = { url: url.replace('https://esport.test', ''), methode: init?.method ?? 'GET', xMethode: init?.headers?.['X-Methode'], corps: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    appels.push(a);
    if (a.url === '/session') return { ok: true, status: 200, json: async () => ({ session: 's1', expire: '2099-01-01T00:00:00.000Z', compte: 'cm123456', superAdmin: false, profil: null, peutCreerTeam: false, fonctions: ['surcharge-methode'] }) };
    const r = repondre(a) ?? { corps: { ok: true } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.corps };
  });
  const client: ClientEsport = clientEsport({ adresse: 'https://esport.test', jetonRelais: 'jeton-relais-0123456789' }, requete);
  return { client, appels };
}
const serveur = (editer = true, preferences: Record<string, unknown> = {}) =>
  fauxServeur(a => {
    const c = a.url.split('?')[0];
    if (c === `/cm/tableaux/${T}`) return { corps: tableau(editer) };
    if (c === '/cm/preferences' && a.methode === 'GET') return { corps: { preferences } };
    if (c === `/cm/cartes/${A}` && a.methode === 'GET') return { corps: reponseCarte('faible') };
    if (c === `/cm/cartes/${A}` && a.xMethode === 'PATCH') return { corps: reponseCarte((a.corps?.urgence as Urgence | null) ?? null) };
    return undefined;
  });

const titresColonne = () =>
  within(screen.getByTestId(`esport-cm-liste-${L1}-cartes`))
    .getAllByTestId(/^esport-cm-carte-[0-9a-f-]+-tuile$/)
    .map(n => n.props.accessibilityLabel as string);

const mouvementReduit = (v: boolean) => jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(v);
beforeEach(() => {
  oublierSessions();
  // Pas de pulsation dans les tests de rendu courants (évite les mises à jour d'animation hors act) ; le test dédié la réactive.
  mouvementReduit(true);
});
afterEach(() => {
  definirLangue('fr');
  jest.restoreAllMocks();
});

describe('drapeau d’urgence : niveaux, couleurs, tri', () => {
  it('quatre niveaux ordonnés ; couleurs distinctes et lisibles (AA) en thème clair comme sombre', () => {
    expect(NIVEAUX_URGENCE.map(rangUrgence)).toEqual([1, 2, 3, 4]);
    expect(rangUrgence(null)).toBe(0);
    for (const id of ['nuit', 'jour'] as const) {
      const t = themeHub(id);
      const couleurs = NIVEAUX_URGENCE.map(n => couleurUrgence(n, t.sombre));
      expect(new Set(couleurs).size).toBe(4);
      for (const c of couleurs) {
        expect(contraste(c, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(c, t.fond)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('tri par urgence décroissante (position conservée à égalité) et compteurs sans les archivées', () => {
    const cartes = tableau().cartes;
    expect(trierParUrgence(cartes).map(c => c.titre)).toEqual(['Carte critique', 'Critique archivée', 'Carte urgente', 'Faible chose', 'Sans drapeau']);
    expect(compterUrgences(cartes)).toEqual({ critique: 1, urgent: 1 });
  });

  it('filtre par niveau (et « sans drapeau »), plusieurs niveaux possibles', () => {
    const f = { q: '', etiquettes: [], membres: [], echeance: 'toutes' as const, type: 'tout' as const, statut: '' as const };
    const vues = (urgences: Array<Urgence | 'aucune'>) => tableau().cartes.filter(c => carteVisible(c, { ...f, urgences }, Date.now(), {})).map(c => c.titre);
    expect(vues([])).toHaveLength(5);
    expect(vues(['critique'])).toEqual(['Carte critique', 'Critique archivée']);
    expect(vues(['critique', 'urgent'])).toHaveLength(3);
    expect(vues(['aucune'])).toEqual(['Sans drapeau']);
  });

  it('phrases de journal et de notification, en français et en anglais', () => {
    const nom = () => 'Clara';
    expect(phraseNotificationCm('cm-urgence', '', { titre: 'Annonce', membre: 'x', niveau: 'critique' }, nom)).toBe('Clara a passé la carte « Annonce » en urgence critique');
    expect(phraseNotificationCm('cm-urgence', '', { titre: 'Annonce', membre: 'x', niveau: 'urgent' }, nom)).toBe('Clara a passé la carte « Annonce » en urgent');
    expect(phraseJournalCm('cm.carte_urgence', 'Clara', { titre: 'Annonce', niveau: 'urgent' })).toBe('Clara a passé « Annonce » en urgence : Urgent');
    definirLangue('en');
    expect(phraseNotificationCm('cm-urgence', '', { titre: 'Annonce', membre: 'x', niveau: 'critique' }, nom)).toBe('Clara flagged the card “Annonce” as critical');
    expect(phraseJournalCm('cm.carte_urgence', 'Clara', { titre: 'Annonce', niveau: 'critique' })).toBe('Clara raised “Annonce” to priority: Critical');
  });
});

describe('drapeau d’urgence sur le tableau', () => {
  it('la carte compacte affiche le drapeau sans s’agrandir ; libellé accessible ; compteurs d’en-tête de colonne', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    expect(await screen.findByTestId(`esport-cm-carte-${B}-urgence-drapeau`)).toBeTruthy();
    expect(screen.queryByTestId(`esport-cm-carte-${C}-urgence-drapeau`)).toBeNull();
    // Le drapeau n'ajoute aucune ligne d'informations : la carte reste compacte.
    expect(carteAInfos(tableau().cartes[1])).toBe(false);
    expect(screen.queryByTestId(`esport-cm-carte-${B}-infos`)).toBeNull();
    expect(screen.getByLabelText('Carte critique, Urgence : Critique')).toBeTruthy();
    // En-tête : 1 critique et 1 urgente (l'archivée ne compte pas).
    expect(screen.getByLabelText('1 carte critique')).toBeTruthy();
    expect(screen.getByLabelText('1 carte urgente')).toBeTruthy();
  });

  it('filtre par niveau sur le tableau', async () => {
    const { client } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    await fireEvent.press(screen.getByTestId('esport-cm-filtres'));
    await fireEvent.press(screen.getByTestId('esport-cm-filtre-urgence-critique'));
    expect(titresColonne().map(t => t.split(',')[0])).toEqual(['Carte critique', 'Critique archivée']);
    await fireEvent.press(screen.getByTestId('esport-cm-filtre-urgence-critique'));
    await fireEvent.press(screen.getByTestId('esport-cm-filtre-urgence-aucune'));
    expect(titresColonne()).toEqual(['Sans drapeau']);
  });

  it('« Trier la colonne par urgence » : ordre par niveau, choix mémorisé, plus de glisser-déposer dans la colonne', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    expect(titresColonne().map(t => t.split(',')[0])).toEqual(['Faible chose', 'Carte critique', 'Sans drapeau', 'Carte urgente', 'Critique archivée']);
    expect(screen.getByTestId(`esport-cm-carte-${A}-poignee`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`esport-cm-liste-${L1}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-liste-${L1}-tri-urgence`));
    expect(titresColonne().map(t => t.split(',')[0])).toEqual(['Carte critique', 'Critique archivée', 'Carte urgente', 'Faible chose', 'Sans drapeau']);
    expect(screen.getByTestId(`esport-cm-liste-${L1}-tri-actif`)).toBeTruthy();
    expect(screen.queryByTestId(`esport-cm-carte-${A}-poignee`)).toBeNull();
    await waitFor(() => expect(appels.some(a => a.url === `/cm/preferences/tableau.${T}.tri_urgence`)).toBe(true));
    expect(appels.find(a => a.url === `/cm/preferences/tableau.${T}.tri_urgence`)?.corps).toEqual({ valeur: [L1] });
    // Relu depuis les préférences du compte.
    const relu = serveur(true, { [`tableau.${T}.tri_urgence`]: [L1] });
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(relu.client)} id={T} large testID="tableau-relu" />);
    await waitFor(() => expect(within(screen.getByTestId('tableau-relu')).getByTestId(`esport-cm-liste-${L1}-tri-actif`)).toBeTruthy());
  });

  it('menu ⋯ de la carte : « Urgence… » règle le drapeau (PATCH urgence) ; absent sans droit d’édition', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${C}`);
    await fireEvent.press(screen.getByTestId(`esport-cm-carte-${C}-menu`));
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${C}-urgence`));
    await fireEvent.press(await screen.findByTestId('esport-cm-urgence-choix-critique'));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.url === `/cm/cartes/${C}`)).toBe(true));
    expect(appels.find(a => a.xMethode === 'PATCH')?.corps).toMatchObject({ urgence: 'critique' });
    // Lecteur : pas d'entrée « Urgence… » dans le menu.
    const lecteur = serveur(false);
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(lecteur.client)} id={T} large testID="tableau-lecteur" />);
    const t = await screen.findByTestId('tableau-lecteur');
    await waitFor(() => expect(within(t).getAllByTestId(`esport-cm-carte-${C}-menu`).length).toBeGreaterThan(0));
    await fireEvent.press(within(t).getByTestId(`esport-cm-carte-${C}-menu`));
    expect(await within(t).findByTestId(`esport-cm-carte-${C}-ouvrir`)).toBeTruthy();
    expect(within(t).queryByTestId(`esport-cm-carte-${C}-urgence`)).toBeNull();
  });

  it('fiche de la carte : sélecteur rapide des cinq choix, niveau actuel coché, journal lisible', async () => {
    const { client, appels } = serveur();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${A}-tuile`));
    const choix = await screen.findByTestId('esport-cm-fiche-urgence');
    expect(within(choix).getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByTestId('esport-cm-fiche-urgence-faible').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText(/a changé l’urgence : Aucune → Faible/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-fiche-urgence-urgent'));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.corps?.urgence === 'urgent')).toBe(true));
    await fireEvent.press(screen.getByTestId('esport-cm-fiche-urgence-aucune'));
    await waitFor(() => expect(appels.some(a => a.xMethode === 'PATCH' && a.corps?.urgence === null)).toBe(true));
  });
});

describe('niveaux d’urgence plus visuels : jetons, pastilles, bande, fiche, légende', () => {
  const F = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6';
  const serveurQuatre = () =>
    fauxServeur(a => {
      const c = a.url.split('?')[0];
      if (c === `/cm/tableaux/${T}`) {
        const t = tableau();
        return { corps: { ...t, cartes: [...t.cartes, resume(F, 'Carte moyenne', 6, 'moyen')] } };
      }
      if (c === '/cm/preferences') return { corps: { preferences: {} } };
      if (c === `/cm/cartes/${B}` && a.methode === 'GET') return { corps: { ...reponseCarte('critique'), carte: { ...reponseCarte('critique').carte, id: B, titre: 'Carte critique' } } };
      return undefined;
    });

  it('jetons : texte de la pastille AA sur son fond, bande lisible et texte lisible sur le fond teinté, dans les huit thèmes', () => {
    for (const t of THEMES_HUB) {
      for (const n of NIVEAUX_URGENCE) {
        const j = jetonUrgence(n, t.sombre);
        expect(contraste(j.encre, j.fond)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(j.trait, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(t.texte, fondCarteUrgence(n, t.surface, t.sombre))).toBeGreaterThanOrEqual(7);
        expect(contraste(t.attenue, fondCarteUrgence(n, t.surface, t.sombre))).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Moyen et Faible ne teintent pas la carte ; Critique la teinte plus qu'Urgent.
    expect(fondCarteUrgence('faible', '#ffffff', false)).toBe('#ffffff');
    expect(fondCarteUrgence('moyen', '#ffffff', false)).toBe('#ffffff');
    expect(fondCarteUrgence(null, '#ffffff', false)).toBe('#ffffff');
    expect(contraste(fondCarteUrgence('critique', '#ffffff', false), '#ffffff')).toBeGreaterThan(contraste(fondCarteUrgence('urgent', '#ffffff', false), '#ffffff'));
    expect(NIVEAUX_URGENCE.map(barresUrgence)).toEqual([1, 2, 3, 4]);
  });

  it('carte compacte : pastille texte et bande pour les quatre niveaux, forme (barres) en plus de la couleur', async () => {
    const { client } = serveurQuatre();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    const attendu: Array<[string, string, Urgence]> = [[A, 'FAIBLE', 'faible'], [F, 'MOYEN', 'moyen'], [D, 'URGENT', 'urgent'], [B, 'CRITIQUE', 'critique']];
    for (const [id, texte, niveau] of attendu) {
      const pastille = screen.getByTestId(`esport-cm-carte-${id}-urgence-drapeau`);
      expect(within(pastille).getByText(texte)).toBeTruthy();
      expect(within(pastille).getByTestId(`urgence-barres-${niveau}`).props['data-barres']).toBe(barresUrgence(niveau));
      expect(screen.getByTestId(`esport-cm-carte-${id}-urgence-bande`)).toBeTruthy();
    }
    expect(screen.queryByTestId(`esport-cm-carte-${C}-urgence-bande`)).toBeNull();
    const fond = (id: string) => StyleSheet.flatten(screen.getByTestId(`esport-cm-carte-${id}`).props.style) as { backgroundColor: string; borderColor: string; borderWidth: number };
    const t = themeHub('nuit');
    expect(fond(B).backgroundColor).toBe(fondCarteUrgence('critique', t.surface, t.sombre));
    expect(fond(B).borderColor).toBe(couleurUrgence('critique', t.sombre));
    expect(fond(D).backgroundColor).not.toBe(t.surface);
    expect(fond(F).backgroundColor).toBe(t.surface);
    expect(fond(A).backgroundColor).toBe(t.surface);
    // La carte reste compacte : le niveau n'ajoute pas de ligne d'informations.
    expect(screen.queryByTestId(`esport-cm-carte-${B}-infos`)).toBeNull();
  });

  it('pulsation de la bande Critique seulement (Urgent et les autres ne pulsent pas)', async () => {
    mouvementReduit(false);
    const { client } = serveurQuatre();
    await render(<Tableau theme={themeHub('jour')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    await waitFor(() => expect(screen.getByTestId(`esport-cm-carte-${B}-urgence-bande`).props['data-pulsation']).toBe('oui'));
    expect(screen.getByTestId(`esport-cm-carte-${D}-urgence-bande`).props['data-pulsation']).toBe('non');
    expect(screen.getByTestId(`esport-cm-carte-${A}-urgence-bande`).props['data-pulsation']).toBe('non');
  });

  it('prefers-reduced-motion : la bande Critique ne pulse pas', async () => {
    mouvementReduit(true);
    const { client } = serveurQuatre();
    await render(<Tableau theme={themeHub('jour')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    await waitFor(() => expect(screen.getByTestId(`esport-cm-carte-${B}-urgence-bande`).props['data-pulsation']).toBe('non'));
  });

  it('en-tête de colonne : pastilles colorées avec chiffre ; légende des couleurs repliable par le bouton « ? »', async () => {
    const { client } = serveurQuatre();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await screen.findByTestId(`esport-cm-carte-${B}`);
    const critiques = screen.getByTestId(`esport-cm-liste-${L1}-critiques`);
    expect(within(critiques).getByText('1')).toBeTruthy();
    expect(critiques.props.accessibilityLabel).toBe('1 carte critique');
    expect(StyleSheet.flatten(critiques.props.style).backgroundColor).toBe(jetonUrgence('critique', true).fond);
    expect(screen.queryByTestId('esport-cm-urgence-legende')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-cm-urgence-legende-bouton'));
    const legende = screen.getByTestId('esport-cm-urgence-legende');
    for (const n of NIVEAUX_URGENCE) expect(within(legende).getByTestId(`esport-cm-urgence-legende-${n}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-cm-urgence-legende-bouton'));
    expect(screen.queryByTestId('esport-cm-urgence-legende')).toBeNull();
  });

  it('fiche : bandeau du niveau en grand et sélecteur de gros boutons colorés (+ Aucun)', async () => {
    const { client } = serveurQuatre();
    await render(<Tableau theme={themeHub('nuit')} api={apiCm(client)} id={T} large />);
    await fireEvent.press(await screen.findByTestId(`esport-cm-carte-${B}-tuile`));
    const bandeau = await screen.findByTestId('esport-cm-fiche-urgence-bandeau');
    expect(within(bandeau).getByText('CRITIQUE')).toBeTruthy();
    expect(StyleSheet.flatten(bandeau.props.style).backgroundColor).toBe(jetonUrgence('critique', true).fond);
    const choix = screen.getByTestId('esport-cm-fiche-urgence');
    expect(within(choix).getAllByRole('radio')).toHaveLength(5);
    const actif = screen.getByTestId('esport-cm-fiche-urgence-critique');
    expect(actif.props.accessibilityState.checked).toBe(true);
    const style = StyleSheet.flatten(actif.props.style) as { backgroundColor: string; minHeight: number };
    expect(style.backgroundColor).toBe(jetonUrgence('critique', true).fond);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});

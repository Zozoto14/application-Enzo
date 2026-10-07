import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import type { Espaces, ObjetEspace } from '../sync/relais/espaces';
import { jetonDeProfil } from '../sync/relais/portees';
import {
  celluleCsv, compter, exporterCsv, exporterJson, filtrer, fusionner, grouper, titreEntree, valeursFiltres, type EntreeHistorique,
} from './logiqueHistorique';
import { ClaudeOffice } from './Racine';
import type { LectureHistorique, PontClaudeOffice, PontHistorique } from './pont';
import {
  CLE_ETAT_SYNCHRO, DELAI_MIN_ENVOI_MS, MAX_ENTREES_SYNCHRO, creerServiceHistorique, lireEtatSynchro, selectionnerPourEnvoi, synchroniserSiDu,
} from './synchroHistorique';

const theme = themeHub('nuit');
const entree = (id: string, ts: string, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({
  v: 1, id, ts, type: 'demande', appareil: 'PC-bureau', appareilId: 'aaaaaaaaaaaa', session: 'sess-1', projet: 'budget', texte: `demande ${id}`, ...extra,
});

const JOURNAL: EntreeHistorique[] = [
  entree('a', '2026-10-05T09:00:00Z', { texte: 'Ajoute un export CSV au budget' }),
  entree('b', '2026-10-05T09:01:00Z', { type: 'outil', outil: 'Edit', resume: 'export.ts', texte: undefined }),
  entree('c', '2026-10-06T14:00:00Z', { projet: 'tsuzuku', session: 'sess-2', texte: 'Corrige le lecteur vidéo' }),
  entree('d', '2026-10-06T14:02:00Z', { type: 'outil', outil: 'Bash', resume: 'npm test', projet: 'tsuzuku', session: 'sess-2', texte: undefined, echec: true }),
  entree('e', '2026-10-07T08:00:00Z', { appareil: 'Portable', appareilId: 'bbbbbbbbbbbb', texte: 'Évite les accents cassés' }),
];

describe('historique : logique pure', () => {
  it('fusion : déduplication par identifiant, entrées invalides écartées, tri par date', () => {
    const fusion = fusionner([JOURNAL[2], JOURNAL[0]], [JOURNAL[0], { v: 1, id: 'x' }, null, 'texte'], [JOURNAL[1]]);
    expect(fusion.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('recherche plein texte (sans accents ni casse, tous les mots) et filtres', () => {
    expect(filtrer(JOURNAL, { recherche: 'EXPORT csv' }).map(e => e.id)).toEqual(['a']);
    expect(filtrer(JOURNAL, { recherche: 'evite accents' }).map(e => e.id)).toEqual(['e']);
    expect(filtrer(JOURNAL, { recherche: 'export.ts' }).map(e => e.id)).toEqual(['b']);
    expect(filtrer(JOURNAL, { projet: 'tsuzuku' }).map(e => e.id)).toEqual(['c', 'd']);
    expect(filtrer(JOURNAL, { appareil: 'Portable' }).map(e => e.id)).toEqual(['e']);
    expect(filtrer(JOURNAL, { outil: 'Bash' }).map(e => e.id)).toEqual(['d']);
    expect(filtrer(JOURNAL, { type: 'outil' }).map(e => e.id)).toEqual(['b', 'd']);
    expect(filtrer(JOURNAL, { du: '2026-10-06T00:00:00Z', au: '2026-10-06T23:59:59Z' }).map(e => e.id)).toEqual(['c', 'd']);
    expect(valeursFiltres(JOURNAL)).toEqual({ projets: ['budget', 'tsuzuku'], appareils: ['PC-bureau', 'Portable'], outils: ['Bash', 'Edit'] });
  });

  it('compteurs et regroupement par jour puis par session, du plus récent au plus ancien', () => {
    expect(compter(JOURNAL)).toMatchObject({ total: 5, demandes: 3, outils: 2, sessions: 2, projets: 2, appareils: 2 });
    const groupes = grouper(JOURNAL);
    expect(groupes).toHaveLength(3);
    expect(groupes[0].sessions[0].entrees.map(e => e.id)).toEqual(['e']);
    expect(groupes[1].sessions[0].entrees.map(e => e.id)).toEqual(['d', 'c']);
    expect(titreEntree(JOURNAL[1])).toBe('Edit · export.ts');
  });

  it('export JSON et CSV (séparateur « ; », guillemets, formules neutralisées)', () => {
    const json = JSON.parse(exporterJson(JOURNAL, new Date('2026-10-07T10:00:00Z')));
    expect(json).toMatchObject({ format: 'claude-office-historique', version: 1 });
    expect(json.entrees).toHaveLength(5);
    const csv = exporterCsv([entree('z', '2026-10-07T08:00:00Z', { texte: '=HYPERLINK("x"); "cité"\nligne 2' })]);
    const lignes = csv.replace(/^﻿/, '').split('\r\n');
    expect(lignes[0]).toBe('id;ts;type;appareil;projet;dossier;session;outil;resume;texte;entree;sortie;echec');
    expect(csv).toContain('"\'=HYPERLINK(""x""); ""cité""\nligne 2"');
    expect(celluleCsv('-2+3')).toBe("'-2+3");
    expect(celluleCsv(undefined)).toBe('');
  });
});

/** Faux relais : l'espace `principal` en mémoire, tel que le relais le stockerait. */
function fauxEspaces() {
  const objets = new Map<string, ObjetEspace>();
  const espaces: Espaces & { objets: typeof objets } = {
    objets,
    lister: jest.fn(async () => Object.fromEntries([...objets].map(([n, o]) => [n, { date: o.date, taille: o.charge.length, auteur: 'maitre' }]))),
    lire: jest.fn(async (_id: string, nom: string) => objets.get(nom)),
    deposer: jest.fn(async (id: string, nom: string, charge: string, date: string) => {
      expect(id).toBe('principal');
      objets.set(nom, { date, charge, auteur: 'maitre' });
    }),
    supprimer: jest.fn(async (_id: string, nom: string) => void objets.delete(nom)),
  };
  return espaces;
}

const CLE = '11'.repeat(32);
const JETON = 'jeton-maitre-de-test-0123456789';
const CONFIG = { relais: 'https://relais.test', jeton: JETON, cle: CLE };

function fausseBase(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return { valeurs, lire: (c: string) => valeurs.get(c), ecrire: (c: string, v: string) => void valeurs.set(c, v), supprimer: (c: string) => void valeurs.delete(c) };
}

describe('historique : copie chiffrée sur le relais', () => {
  it('rien de lisible côté relais ; seul un appareil qui a la clé de synchro la rouvre', async () => {
    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces })!;
    await service.deposer('aaaaaaaaaaaa', JOURNAL, '2026-10-07T10:00:00.000Z');
    const stocke = espaces.objets.get('office-historique-aaaaaaaaaaaa')!;
    for (const clair of ['export CSV', 'budget', 'tsuzuku', 'PC-bureau', 'sess-1', 'demande']) {
      expect(stocke.charge).not.toContain(clair);
    }
    const relu = await service.lireTout();
    expect(relu.erreurs).toEqual([]);
    expect(relu.entrees.map(e => e.id)).toEqual(JOURNAL.map(e => e.id));
    expect(relu.copies[0]).toMatchObject({ objet: 'office-historique-aaaaaaaaaaaa', entrees: 5 });
    // Mauvaise clé : la copie ne s'ouvre pas.
    const autre = creerServiceHistorique({ ...CONFIG, cle: '22'.repeat(32) }, { espaces })!;
    const mauvais = await autre.lireTout();
    expect(mauvais.entrees).toEqual([]);
    expect(mauvais.erreurs[0]).toMatch(/mot de passe de synchronisation/);
    // Une copie déplacée sous un autre nom est refusée (l'appareil est lié au chiffré).
    espaces.objets.set('office-historique-cccccccccccc', stocke);
    expect((await service.lireTout()).erreurs.join()).toMatch(/déplacée/);
    await service.retirer('aaaaaaaaaaaa');
    expect(espaces.objets.has('office-historique-aaaaaaaaaaaa')).toBe(false);
  });

  it('droits : pas de service pour un compte à jeton de profil (ami, gestionnaire, promu) ni sans relais', () => {
    expect(creerServiceHistorique(undefined)).toBeUndefined();
    expect(creerServiceHistorique({ ...CONFIG, jeton: jetonDeProfil(JETON, 'abcdef1234') }, { espaces: fauxEspaces() })).toBeUndefined();
    expect(creerServiceHistorique({ ...CONFIG, cle: 'courte' }, { espaces: fauxEspaces() })).toBeUndefined();
  });

  it('désactivée par défaut, puis au plus un dépôt par délai minimal et seulement si quelque chose a changé', async () => {
    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces });
    const base = fausseBase();
    const t0 = new Date('2026-10-07T10:00:00Z');
    expect(lireEtatSynchro(base).active).toBe(false);
    expect((await synchroniserSiDu({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: JOURNAL, maintenant: t0 })).issue).toBe('desactivee');
    expect(espaces.deposer).not.toHaveBeenCalled();
    base.ecrire(CLE_ETAT_SYNCHRO, JSON.stringify({ active: true }));
    expect((await synchroniserSiDu({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: JOURNAL, maintenant: t0 })).issue).toBe('envoyee');
    // Seules les entrées de cet appareil partent (celles du portable viennent de sa propre copie).
    const relu = await service!.lireTout();
    expect(relu.entrees.map(e => e.id)).toEqual(['a', 'b', 'c', 'd']);
    const plusTard = new Date(t0.getTime() + 60_000);
    expect((await synchroniserSiDu({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: [...JOURNAL, entree('f', '2026-10-07T10:00:30Z')], maintenant: plusTard })).issue).toBe('trop-tot');
    const apresDelai = new Date(t0.getTime() + DELAI_MIN_ENVOI_MS + 1);
    expect((await synchroniserSiDu({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: JOURNAL, maintenant: apresDelai })).issue).toBe('inchangee');
    expect(espaces.deposer).toHaveBeenCalledTimes(1);
    const r = await synchroniserSiDu({ service, base, appareilId: 'aaaaaaaaaaaa', entrees: [...JOURNAL, entree('f', '2026-10-07T10:00:30Z')], maintenant: apresDelai });
    expect(r.issue).toBe('envoyee');
    expect(lireEtatSynchro(base).derniere).toBe(apresDelai.toISOString());
  });

  it('volume borné : les plus récentes seulement', () => {
    const beaucoup = Array.from({ length: MAX_ENTREES_SYNCHRO + 50 }, (_, i) => entree(`n${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString()));
    const choisies = selectionnerPourEnvoi(beaucoup);
    expect(choisies).toHaveLength(MAX_ENTREES_SYNCHRO);
    expect(choisies.at(-1)!.id).toBe(`n${MAX_ENTREES_SYNCHRO + 49}`);
  });
});

function fauxPontHistorique(entrees: EntreeHistorique[] = JOURNAL): jest.Mocked<PontHistorique> {
  const lecture: LectureHistorique = {
    ok: true, dossier: '/maison/.agent-office/historique', entrees, total: entrees.length, ignorees: 0, octets: 1000, fichiers: 1,
    reglages: { actif: true, enregistrerSorties: false, masquerSecrets: true, maxFichierMo: 10, maxTotalMo: 200, appareil: null, appareilId: 'aaaaaaaaaaaa' },
  };
  const pont = {
    lire: jest.fn(async () => lecture),
    reglages: jest.fn(async () => ({ ok: true, reglages: lecture.reglages })),
    supprimer: jest.fn(async () => ({ ok: true, supprimees: 1 })),
    importer: jest.fn(async () => ({ ok: true, importees: 3, ignorees: 0 })),
    apercuHooks: jest.fn(async () => ({ ok: true, plan: { fichier: 's.json', existe: true, commande: 'node h', change: true, ajouts: ['UserPromptSubmit'], retraits: [], description: '  + UserPromptSubmit : ajoute' } })),
    installerHooks: jest.fn(async () => ({ ok: true, ecrit: true, sauvegarde: 's.json.bak' })),
  };
  return pont as unknown as jest.Mocked<PontHistorique>;
}

function fauxOffice(historique?: PontHistorique): PontClaudeOffice {
  return {
    etat: jest.fn(async () => ({ url: 'http://127.0.0.1:3334', dossier: null, hooks: 'inconnus' as const, historique: 'absents' as const, serveur: { joignable: false } })),
    choisirDossier: jest.fn(),
    reglerUrl: jest.fn(),
    apercuHooks: jest.fn(),
    installerHooks: jest.fn(),
    ouvrir: jest.fn(),
    historique,
  } as unknown as PontClaudeOffice;
}

const globalPont = globalThis as { applibourse?: unknown };

async function ouvrirHistorique(contexte: ContexteHub = {}) {
  await render(<ClaudeOffice contexte={contexte} theme={theme} registre={REGISTRE} onRetour={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('claude-office-onglet-historique'));
  await act(async () => undefined);
}

describe('écran Historique', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => {
    delete globalPont.applibourse;
    jest.useRealTimers();
  });

  it('sur le PC : avertissement honnête, compteurs, recherche, filtre, détail et suppression confirmée deux fois', async () => {
    const historique = fauxPontHistorique();
    globalPont.applibourse = { bureau: true, claudeOffice: fauxOffice(historique) };
    await ouvrirHistorique();
    expect(screen.getByTestId('historique-avertissement')).toBeTruthy();
    expect(screen.getByText(/ce que vous écrivez à Claude/)).toBeTruthy();
    expect(screen.getByText(/Un PC éteint, ou un appareil sans le hook, n’enregistre rien/)).toBeTruthy();
    expect(screen.getByTestId('historique-compte-entrées').props.children).toBe(5);
    expect(screen.getByTestId('historique-hook-etat').props.children.join('')).toMatch(/Pas encore installé/);
    // Ingestion continue : relu toutes les 5 s.
    expect(historique.lire).toHaveBeenCalledTimes(1);
    await act(async () => void jest.advanceTimersByTime(5_000));
    expect(historique.lire).toHaveBeenCalledTimes(2);

    await fireEvent.changeText(screen.getByTestId('historique-recherche'), 'lecteur video');
    expect(screen.getByTestId('historique-compte-entrées').props.children).toBe(1);
    await fireEvent.changeText(screen.getByTestId('historique-recherche'), '');
    await fireEvent.press(screen.getByTestId('filtre-projet-tsuzuku'));
    expect(screen.getByTestId('historique-compte-entrées').props.children).toBe(2);

    await fireEvent.press(screen.getByTestId('historique-entree-c'));
    expect(screen.getByTestId('historique-detail-texte').props.children).toContain('Corrige le lecteur vidéo');
    await fireEvent.press(screen.getByTestId('historique-supprimer-entree'));
    expect(historique.supprimer).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('historique-supprimer-entree'));
    expect(historique.supprimer).toHaveBeenCalledWith({ ids: ['c'] });
    expect(screen.getByTestId('historique-message').props.children).toMatch(/1 entrée supprimée/);

    await fireEvent.press(screen.getByTestId('historique-supprimer-tout'));
    await fireEvent.press(screen.getByTestId('historique-supprimer-tout'));
    expect(historique.supprimer).toHaveBeenLastCalledWith({ tout: true });
    // Hook : rien d'installé sans clic.
    expect(historique.installerHooks).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('historique-hook-apercu'));
    expect(screen.getByTestId('historique-plan').props.children).toContain('UserPromptSubmit');
  });

  it('export des entrées filtrées et réglage « contenu des outils »', async () => {
    const historique = fauxPontHistorique();
    globalPont.applibourse = { bureau: true, claudeOffice: fauxOffice(historique) };
    const enregistrerFichier = jest.fn(async () => true);
    await ouvrirHistorique({ enregistrerFichier });
    await fireEvent.press(screen.getByTestId('filtre-type-outil'));
    await fireEvent.press(screen.getByTestId('historique-export-csv'));
    const [nom, contenu, type] = (enregistrerFichier.mock.calls[0] as unknown as [string, string, string]);
    expect(nom).toMatch(/^historique-claude-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(type).toBe('text/csv');
    expect(contenu.split('\r\n').filter(Boolean)).toHaveLength(3);
    await fireEvent(screen.getByTestId('reglage-sorties'), 'valueChange', true);
    expect(historique.reglages).toHaveBeenCalledWith({ enregistrerSorties: true });
  });

  it('sur le site : rien de local ; sans service, l’écran dit où est le journal ; avec, il lit la copie du relais', async () => {
    await ouvrirHistorique();
    expect(screen.getByTestId('historique-hors-pc').props.children).toMatch(/Le journal est sur le PC/);
    expect(screen.queryByTestId('historique-supprimer-tout')).toBeNull();
    screen.unmount();

    const espaces = fauxEspaces();
    const service = creerServiceHistorique(CONFIG, { espaces })!;
    await service.deposer('aaaaaaaaaaaa', JOURNAL);
    await ouvrirHistorique({ historiqueOffice: service, baseProfil: fausseBase() });
    await act(async () => undefined);
    expect(screen.getByTestId('historique-compte-entrées').props.children).toBe(5);
    expect(screen.getByTestId('historique-synchro')).toBeTruthy();
  });
});

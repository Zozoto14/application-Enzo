/**
 * Esport, phase 7 (interface) : journal complet (filtres, export CSV,
 * conservation), statistiques de la team sur l'accueil, exports CSV des
 * tâches et objectifs, demandes RGPD par le Fondateur, accessibilité de base
 * (contrastes dans les 8 thèmes, cibles de 44 px, libellés).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { THEMES_HUB, themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, MENTION_DONNEES, type ClientEsport, type DetailTeam, type Membre, type PageJournal, type StatsTeam } from './client';
import { contraste, encreSur } from './contraste';
import { CATEGORIES } from './review/libelles';
import { bornesPeriode, libelleRetention } from './ui/Journal';
import { PageTeam } from './ui/PageTeam';

const theme = themeHub('nuit');

const detail = (permissions: string[], { superAdmin = false, modules = ['activity_log', 'goals_tasks', 'planning', 'attendance'] } = {}): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Manager', couleur: '#2563eb', cle: 'manager' }, permissions, superAdmin },
});

const PAGE: PageJournal = {
  entrees: [
    { id: 'e1', action: 'member.role_changed', module: 'coeur', acteur: 'max12345', entiteType: 'membre', entiteId: 'm2', meta: { compte: 'lea12345', de: 'Joueur', vers: 'Coach' }, date: '2026-10-20T10:00:00.000Z' },
    { id: 'e2', action: 'task.created', module: 'goals_tasks', acteur: 'max12345', entiteType: 'tache', entiteId: 'x', meta: { titre: 'Revoir B' }, date: '2026-10-19T10:00:00.000Z' },
  ],
  noms: { max12345: 'Max', lea12345: 'Léa' },
  suite: '2026-10-19T10:00:00.000Z|0b0b0b0b-1111-4222-8333-444455556666',
  membres: [
    { compte: 'max12345', pseudo: 'Max' },
    { compte: 'lea12345', pseudo: 'Léa' },
  ],
  retentionJours: 365,
};

const STATS: StatsTeam = {
  periode: { du: '2026-09-21', au: '2026-10-20', fuseau: 'Europe/Paris' },
  membres: { actifs: 5, suspendus: 0 },
  presence: { seances: 4, taux: 75, reel: { present: 5, retard: 1, absent: 2, excuse: 0, inconnu: 0 }, rsvp: { oui: 6, non: 2, peut_etre: 0, sans_reponse: 0 }, joueurs: [{ compte: 'lea12345', pseudo: 'Léa', marques: 4, taux: 100 }, { compte: 'kai12345', pseudo: 'Kai', marques: 4, taux: 50 }] },
  taches: { creees: 6, terminees: 3, ouvertes: 4, enRetard: 1, aFaire: 3, enCours: 1, objectifs: { actif: 1, atteint: 0, abandonne: 0 } },
  resumes: { deposes: 2, termines: 1, enAttente: 1 },
  activite: { actions: 42, membresActifs: 4, parModule: { coeur: 10, goals_tasks: 20, planning: 12 }, parJour: [{ jour: '2026-10-20', n: 42 }] },
};

const LEA: Membre = { id: 'm2', compte: 'lea12345', pseudo: 'Léa', riotId: null, discord: null, posteJeu: null, statut: 'actif', rejointLe: '2026-10-01T00:00:00.000Z', role: { id: 'r2', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, moi: false };

let detailCourant: DetailTeam;

function fauxClient(surcharges: Partial<ClientEsport> = {}): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detailCourant,
      moi: async () => ({ compte: 'max12345', superAdmin: false, profil: { pseudo: 'Max', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      membres: async () => [LEA],
      roles: async () => [],
      invitations: async () => [],
      journal: async () => PAGE,
      reglagesJournal: async () => ({ retentionJours: 365, choix: [0, 30, 90, 180, 365, 730], modifiable: true }),
      stats: async () => STATS,
      objectifs: async () => [],
      taches: async () => ({ jour: '2026-10-20', taches: [] }),
      requete: async () => ({ occurrences: [], droits: {}, prochains: [], alertes: [] }),
      ...surcharges,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}

async function monter(client: ClientEsport, d: DetailTeam, section: React.ComponentProps<typeof PageTeam>['sectionInitiale'], options: { mode?: 'large' | 'telephone'; onExporter?: (nom: string, contenu: string, type?: string) => Promise<boolean>; t?: typeof theme } = {}) {
  detailCourant = d;
  const mode = options.mode ?? 'large';
  return render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={options.t ?? theme} client={client} teamId="t1" large={mode === 'large'} sectionInitiale={section} onQuitter={() => undefined} onExporter={options.onExporter} />
    </ModeAffichageForce>,
  );
}

describe('journal d’activité', () => {
  it('phrases lisibles, filtres (module, type d’action, membre, période) transmis au serveur, page suivante', async () => {
    const journal = jest.fn(async () => PAGE);
    await monter(fauxClient({ journal }), detail(['activity_log.view', 'team.manage']), 'journal');
    expect(await screen.findByText('Max a changé le rôle de Léa de Joueur à Coach')).toBeTruthy();
    expect(journal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ limite: 50 }));
    expect((journal.mock.calls[0] as unknown as [string, { module?: string }])[1].module).toBeUndefined();
    await fireEvent.press(screen.getByTestId('esport-journal-module-goals_tasks'));
    await waitFor(() => expect(journal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ module: 'goals_tasks' })));
    await fireEvent.press(await screen.findByTestId('esport-journal-action-task'));
    await waitFor(() => expect(journal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ module: 'goals_tasks', action: 'task' })));
    await fireEvent.press(screen.getByTestId('esport-journal-membre-lea12345'));
    await waitFor(() => expect(journal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ acteur: 'lea12345' })));
    await fireEvent.press(screen.getByTestId('esport-journal-periode-dates'));
    await fireEvent.changeText(screen.getByTestId('esport-journal-du'), '01/10/2026');
    await fireEvent.changeText(screen.getByTestId('esport-journal-au'), '15/10/2026');
    await waitFor(() => expect(journal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ du: '2026-10-01', au: '2026-10-15' })));
    await fireEvent.press(screen.getByTestId('esport-journal-suite'));
    await waitFor(() => expect(journal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ avant: PAGE.suite })));
  });

  it('export CSV avec les filtres choisis ; durée de conservation affichée et réglable', async () => {
    const exporterJournal = jest.fn(async () => ({ nom: 'journal-faucons-2026-10-20.csv', type: 'text/csv; charset=utf-8', contenu: '﻿"Date"\r\n' }));
    const changerRetentionJournal = jest.fn(async (_id: string, j: number) => ({ retentionJours: j, choix: [0, 30, 90, 180, 365, 730], modifiable: true }));
    const onExporter = jest.fn(async () => true);
    await monter(fauxClient({ exporterJournal, changerRetentionJournal }), detail(['activity_log.view', 'team.manage']), 'journal', { onExporter });
    await screen.findAllByTestId('esport-journal-entree');
    expect((await screen.findByTestId('esport-journal-retention')).props.children.join('')).toBe('Conservation : 1 an');
    await fireEvent.press(screen.getByTestId('esport-journal-module-coeur'));
    await fireEvent.press(screen.getByTestId('esport-journal-csv'));
    await waitFor(() => expect(onExporter).toHaveBeenCalledWith('journal-faucons-2026-10-20.csv', '﻿"Date"\r\n', 'text/csv'));
    expect(exporterJournal).toHaveBeenCalledWith('t1', expect.objectContaining({ module: 'coeur' }));
    await fireEvent.press(screen.getByTestId('esport-journal-conservation-90'));
    await waitFor(() => expect(changerRetentionJournal).toHaveBeenCalledWith('t1', 90));
    expect(await screen.findByText('Journal conservé : 90 jours.')).toBeTruthy();
  });

  it('aides pures : période et libellés de conservation', () => {
    const t = Date.parse('2026-10-20T12:00:00Z');
    expect(bornesPeriode('tout', '', '', t)).toEqual({});
    expect(bornesPeriode('7', '', '', t)).toEqual({ du: '2026-10-14', au: '2026-10-20' });
    expect(bornesPeriode('dates', '01/10/2026', '', t)).toEqual({ du: '2026-10-01', au: undefined });
    expect(bornesPeriode('dates', '32/10/2026', '', t)).toBeUndefined();
    expect([0, 30, 365, 730].map(libelleRetention)).toEqual(['Illimitée', '30 jours', '1 an', '2 ans']);
  });
});

describe('statistiques de la team (accueil)', () => {
  it('présence, tâches, résumés, activité ; période réglable ; barres avec leur valeur en texte', async () => {
    const stats = jest.fn(async () => STATS);
    await monter(fauxClient({ stats }), detail(['activity_log.view', 'attendance.view_all', 'goals_tasks.view']), 'accueil');
    expect(await screen.findByTestId('esport-stats')).toBeTruthy();
    expect(screen.getByLabelText('présence (4 séances) : 75 %')).toBeTruthy();
    expect(screen.getByLabelText('tâches faites sur 6 créées : 3')).toBeTruthy();
    expect(screen.getByLabelText('Léa : 100 % (4)')).toBeTruthy();
    expect(screen.getByLabelText('Objectifs et tâches : 20')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-stats-periode-7'));
    await waitFor(() => expect(stats).toHaveBeenCalledTimes(2));
    const [, periode] = stats.mock.calls[1] as unknown as [string, { du: string; au: string }];
    expect(Date.parse(periode.au) - Date.parse(periode.du)).toBe(6 * 86_400_000);
  });

  it('serveur sans statistiques (ancienne version) : rien ne s’affiche, aucune erreur', async () => {
    await monter(fauxClient({ stats: async () => Promise.reject(new Error('Adresse inconnue.')) }), detail([]), 'accueil');
    await screen.findByTestId('esport-accueil-team');
    expect(screen.queryByTestId('esport-stats')).toBeNull();
  });
});

describe('exports et RGPD', () => {
  it('objectifs et tâches : export CSV des tâches (filtre courant) et des objectifs', async () => {
    const exporterTaches = jest.fn(async () => ({ nom: 'taches.csv', type: 'text/csv', contenu: 'a' }));
    const exporterObjectifs = jest.fn(async () => ({ nom: 'objectifs.csv', type: 'text/csv', contenu: 'b' }));
    const onExporter = jest.fn(async () => true);
    await monter(fauxClient({ exporterTaches, exporterObjectifs }), detail(['goals_tasks.view']), 'module:goals_tasks', { onExporter });
    await fireEvent.press(await screen.findByTestId('esport-taches-csv'));
    await waitFor(() => expect(onExporter).toHaveBeenCalledWith('taches.csv', 'a', 'text/csv'));
    await fireEvent.press(screen.getByTestId('esport-objectifs-csv'));
    await waitFor(() => expect(onExporter).toHaveBeenCalledWith('objectifs.csv', 'b', 'text/csv'));
  });

  it('Fondateur : exporte les données d’un membre et supprime son compte Esport (confirmation)', async () => {
    const exporterCompte = jest.fn(async () => ({ format: 'applibourse-esport-mes-donnees', compte: 'lea12345' }));
    const supprimerCompte = jest.fn(async () => undefined);
    const onExporter = jest.fn(async () => true);
    await monter(fauxClient({ exporterCompte, supprimerCompte }), detail(['members.view', 'members.remove'], { superAdmin: true }), 'membres', { onExporter });
    await fireEvent.press(await screen.findByLabelText('Gérer Léa'));
    await fireEvent.press(screen.getByTestId('esport-rgpd-exporter-lea12345'));
    await waitFor(() => expect(onExporter).toHaveBeenCalledWith('esport-donnees-lea12345.json', expect.stringContaining('"compte": "lea12345"'), 'application/json'));
    await fireEvent.press(screen.getByTestId('esport-rgpd-supprimer-lea12345'));
    expect(supprimerCompte).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('esport-rgpd-supprimer-lea12345-confirmer'));
    await waitFor(() => expect(supprimerCompte).toHaveBeenCalledWith('lea12345'));
  });

  it('un Manager (pas Fondateur) ne voit pas les demandes RGPD des autres', async () => {
    await monter(fauxClient(), detail(['members.view', 'members.remove']), 'membres');
    await fireEvent.press(await screen.findByLabelText('Gérer Léa'));
    expect(screen.queryByTestId('esport-rgpd-lea12345')).toBeNull();
  });

  it('mention d’information : données stockées, durée, droits, mineurs', () => {
    for (const mot of ['pseudo', 'Riot ID', 'Discord', 'jamais d’adresse e-mail', 'disponibilités', 'journal d’activité', 'exporter', 'supprimer', 'Fondateur', 'mineur']) {
      expect(MENTION_DONNEES).toContain(mot);
    }
  });
});

describe('accessibilité de base', () => {
  it.each(THEMES_HUB.map(t => [t.id, t] as const))('thème %s : états (ok, critique, alerte) lisibles sur le fond et les cartes', (_id, t) => {
    for (const c of [t.ok, t.critique, t.alerte, t.texte]) {
      expect(contraste(c, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(c, t.fond)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('pictogrammes des repères : encre lisible sur chaque couleur de catégorie', () => {
    for (const c of CATEGORIES) expect(contraste(encreSur(c.couleur), c.couleur)).toBeGreaterThanOrEqual(4.5);
  });

  it('onglets de la team : 44 px de haut, rôle « tab » et état « sélectionné » (téléphone)', async () => {
    await monter(fauxClient(), detail(['activity_log.view']), 'accueil', { mode: 'telephone' });
    const onglet = await screen.findByTestId('esport-onglet-accueil');
    expect(StyleSheet.flatten(onglet.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(onglet.props.accessibilityRole).toBe('tab');
    expect(onglet.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId('esport-onglet-journal').props.accessibilityLabel).toBe('Journal');
  });

  it('filtres du journal : cibles de 44 px et libellés accessibles, dans les 8 thèmes', async () => {
    for (const t of THEMES_HUB) {
      const { unmount } = await monter(fauxClient(), detail(['activity_log.view']), 'journal', { mode: 'telephone', t });
      const choix = await screen.findByTestId('esport-journal-module-coeur');
      expect(StyleSheet.flatten(choix.props.style).minHeight).toBeGreaterThanOrEqual(44);
      expect(choix.props.accessibilityLabel).toBe('Module : Team et membres');
      await unmount();
    }
  });
});

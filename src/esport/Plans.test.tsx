/**
 * Esport, module Plan de match (interface) : logique pure (tri, filtres, veto type, contenu envoyé, « mon rôle »,
 * checklist, document imprimable), onglet selon le module et la permission, liste (à venir, passés, filtres, modèles),
 * page d'un plan (résumé, vue du joueur, checklist cochée par le staff, statut), éditeur de composition, éditeur
 * (enregistrement, aucun assistant d'écriture), libellés du journal et des notifications.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, type ClientEsport, type DetailTeam } from './client';
import { oublierProfilsTeams } from './jeux/profil';
import { phraseJournal, phraseNotification } from './libelles';
import type { LiensPlan, LigneCompo, ListePlans, Plan, ResumePlan } from './plans/api';
import { aVenir, avancementChecklist, carteVide, deplacer, facettesPlans, filtrerPlans, ligneCompo, mapsDuFormat, markdownPlan, monRole, tailleCompo, trierPlans, versSaisie, vetoType, type TextesImpression } from './plans/logique';
import { assetsRepli } from './strats/assets';
import { PageTeam, entreesBarre } from './ui/PageTeam';
import { EditeurCompo } from './ui/plans/EditeurPlan';
import { fournirAssets } from './ui/strats/commun';

const theme = themeHub('nuit');
const TOUS = ['activity_log', 'planning', 'strat_editor', 'lineups', 'plans_match'];
const MAINTENANT = Date.parse('2026-10-20T10:00:00.000Z');

const detail = (permissions: string[], modules = TOUS, team: Partial<DetailTeam['team']> = {}): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false, ...team },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
});
const JOUEUR = ['members.view', 'plans.voir'];
const COACH = [...JOUEUR, 'plans.editer', 'strats.view', 'lineups.voir'];

const resume = (champs: Partial<ResumePlan> = {}): ResumePlan => ({
  id: 'p1',
  titre: 'Plan contre Karmine',
  statut: 'pret',
  estModele: false,
  dateMatch: '2026-10-25',
  debut: '2026-10-25T19:00:00.000Z',
  adversaire: { id: 'a1', nom: 'Karmine' },
  format: 'bo3',
  cartes: ['Ascent', 'Bind'],
  evenement: { id: 'e1', occurrence: '2026-10-25T19:00:00.000Z', titre: 'Match vs Karmine', type: 'match', debut: '2026-10-25T19:00:00.000Z', heure: '21:00' },
  checklist: { faits: 1, total: 2 },
  creePar: { compte: 'zed12345', pseudo: 'Zed' },
  majLe: '2026-10-20T09:00:00.000Z',
  ...champs,
});
const ligne = (champs: Partial<LigneCompo>): LigneCompo => ({ ...ligneCompo(), ...champs });
const plan = (champs: Partial<Plan> = {}): Plan => ({
  ...resume(),
  jeu: 'valorant',
  modele: 'valorant',
  contenu: {
    veto: [
      { id: 'v1', action: 'ban', camp: 'nous', carte: { cle: 'breeze', nom: 'Breeze' }, replis: [{ cle: 'haven', nom: 'Haven' }], note: 'Leur meilleure map' },
      { id: 'v2', action: 'pick', camp: 'eux', carte: null, replis: [], note: '' },
    ],
    cartes: [
      {
        id: 'c1',
        carte: { cle: 'ascent', nom: 'Ascent' },
        mode: '',
        compo: [ligne({ id: 'l1', membre: 'lea12345', pseudo: 'Léa', moi: true, personnage: { cle: 'jett', nom: 'Jett' }, role: 'Entry', note: 'Dash en premier' }), ligne({ id: 'l2', membre: 'kai12345', pseudo: 'Kai', moi: false, personnage: { cle: 'omen', nom: 'Omen' }, role: 'IGL' }), ligne({ id: 'l3' })],
        strats: [
          { id: 's1', side: 'attaque', type: 'pistol', strat: null, playbook: null, titre: 'Split A', note: 'Deux smokes', ouvrable: false },
          { id: 's2', side: 'attaque', type: 'execution', strat: 'st1', playbook: null, titre: 'Exec A split', note: '', ouvrable: true },
          { id: 's3', side: 'defense', type: 'retake', strat: null, playbook: null, titre: 'Retake A', note: '', ouvrable: false },
        ],
        lineups: [{ id: 'lu1', titre: 'Smoke Heaven', personnage: 'Omen', capacite: 'Dark Cover', zone: 'A Heaven', ouvrable: true }],
        conditions: 'Contrôle du mid',
        tendances: 'Ils forcent le round 2',
        calls: 'Kai call les rotations',
        notes: '',
      },
      { id: 'c2', carte: { cle: 'bind', nom: 'Bind' }, mode: '', compo: [ligne({ id: 'l4', membre: 'lea12345', pseudo: 'Léa', moi: true, personnage: { cle: 'raze', nom: 'Raze' }, role: 'Entry' })], strats: [], lineups: [], conditions: '', tendances: '', calls: '', notes: 'Attention aux TP' },
    ],
    checklist: [
      { id: 'k1', texte: 'Échauffement fait' },
      { id: 'k2', texte: 'Vocal testé' },
    ],
    notes: 'Rester calmes',
  },
  coches: ['k1'],
  tournoiMatch: null,
  resultat: null,
  debrief: null,
  scouting: null,
  pretLe: '2026-10-20T09:00:00.000Z',
  moi: { editer: false, debrief: false },
  ...champs,
});

const LIENS: LiensPlan = {
  evenements: [{ id: 'e1', occurrence: '2026-10-25T19:00:00.000Z', titre: 'Match vs Karmine', type: 'match', debut: '2026-10-25T19:00:00.000Z', jour: '2026-10-25', heure: '21:00', adversaireId: 'a1' }],
  adversaires: [{ id: 'a1', nom: 'Karmine' }],
  matchs: [],
  resultats: [],
  membres: [
    { compte: 'kai12345', pseudo: 'Kai' },
    { compte: 'lea12345', pseudo: 'Léa' },
  ],
  strats: [{ id: 'st1', titre: 'Exec A split', carte: 'Ascent', side: 'attaque' }],
  playbook: [],
  lineups: [{ id: 'lu1', titre: 'Smoke Heaven', carte: 'Ascent', personnage: 'Omen', capacite: 'Dark Cover' }],
};

let detailCourant: DetailTeam;
function fauxClient(requete: jest.Mock): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detailCourant,
      moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      requete,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}
async function monter(client: ClientEsport, d: DetailTeam) {
  detailCourant = d;
  return await render(
    <ModeAffichageForce mode="large">
      <PageTeam theme={theme} client={client} teamId="t1" large sectionInitiale="module:plans_match" onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
}

/** Faux serveur : la liste, le détail, et les écritures notées. */
function serveur(plans: Plan[], droits = { editer: false }, modeles: ResumePlan[] = []) {
  const etat = new Map(plans.map(p => [p.id, p]));
  return jest.fn(async (chemin: string, methode?: string, corps?: unknown) => {
    const liste = (): ListePlans => ({ plans: [...etat.values()].filter(p => !p.estModele), modeles, droits });
    if (chemin === '/teams/t1/plans' && (!methode || methode === 'GET')) return liste();
    if (chemin === '/teams/t1/plans/liens') return LIENS;
    const m = /^\/teams\/t1\/plans\/([^/]+)(\/coches)?$/.exec(chemin);
    if (m && etat.has(m[1])) {
      const p = etat.get(m[1]) as Plan;
      if (!methode || methode === 'GET') return { plan: p };
      const suite = m[2] ? { ...p, coches: (corps as { coches: string[] }).coches } : { ...p, ...(corps as Partial<Plan>), contenu: p.contenu };
      etat.set(p.id, suite);
      return { plan: suite };
    }
    if (chemin.startsWith('/temps-reel/')) return { cle: 'x', version: 1, presences: [] };
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  });
}

beforeEach(() => {
  oublierProfilsTeams();
  fournirAssets(assetsRepli(0));
});
afterAll(() => fournirAssets(undefined));

describe('logique pure', () => {
  it('liste : à venir d’abord (le plus proche en tête), puis passés ; filtres et facettes', () => {
    const tous = [
      resume({ id: 'passe', dateMatch: '2026-10-10', debut: null, evenement: null, statut: 'joue', adversaire: { id: null, nom: 'Vitality' }, cartes: ['Haven'] }),
      resume({ id: 'loin', dateMatch: '2026-11-02', debut: null, evenement: null, statut: 'brouillon', adversaire: null, cartes: [] }),
      resume({ id: 'proche' }),
      resume({ id: 'sans-date', dateMatch: null, debut: null, evenement: null, statut: 'brouillon' }),
    ];
    expect(trierPlans(tous, MAINTENANT).map(p => p.id)).toEqual(['proche', 'loin', 'sans-date', 'passe']);
    expect(tous.map(p => aVenir(p, MAINTENANT))).toEqual([false, true, true, true]);
    expect(filtrerPlans(tous, { statut: 'brouillon' }).map(p => p.id)).toEqual(['loin', 'sans-date']);
    expect(filtrerPlans(tous, { adversaire: 'a1' }).map(p => p.id)).toEqual(['proche', 'sans-date']);
    expect(filtrerPlans(tous, { adversaire: 'nom:vitality' }).map(p => p.id)).toEqual(['passe']);
    expect(filtrerPlans(tous, { carte: 'ASCENT' }).map(p => p.id)).toEqual(['proche', 'sans-date']);
    const f = facettesPlans(tous);
    expect(f.adversaires).toEqual([
      { id: 'a1', nom: 'Karmine', n: 2 },
      { id: 'nom:vitality', nom: 'Vitality', n: 1 },
    ]);
    expect(f.cartes.map(c => [c.nom, c.n])).toEqual([['Ascent', 2], ['Bind', 2], ['Haven', 1]]);
  });

  it('veto type d’un format, composition par défaut selon le jeu, ordre d’une liste', () => {
    expect(vetoType('bo3').map(v => `${v.camp}:${v.action}`)).toEqual(['nous:ban', 'eux:ban', 'nous:pick', 'eux:pick', 'nous:ban', 'eux:ban', 'nous:decider']);
    expect(vetoType('bo1').filter(v => v.action === 'ban')).toHaveLength(6);
    expect(vetoType('bo5').filter(v => v.action === 'pick')).toHaveLength(4);
    expect(vetoType('')).toEqual([]);
    expect([mapsDuFormat('bo1'), mapsDuFormat('bo3'), mapsDuFormat('bo5'), mapsDuFormat('')]).toEqual([1, 3, 5, 0]);
    expect([tailleCompo('valorant'), tailleCompo('thefinals')]).toEqual([5, 3]);
    expect(carteVide({ cle: 'ascent', nom: 'Ascent' }, 'thefinals').compo).toHaveLength(3);
    // La composition de la map précédente est reprise, avec de nouveaux identifiants.
    const precedente = [ligne({ id: 'x1', membre: 'lea12345', role: 'Entry' })];
    const suivante = carteVide({ cle: 'bind', nom: 'Bind' }, 'valorant', precedente).compo;
    expect(suivante.map(l => [l.membre, l.role])).toEqual([['lea12345', 'Entry']]);
    expect(suivante[0].id).not.toBe('x1');
    expect(deplacer(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(deplacer(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('contenu envoyé (lineups par identifiant, sans champs de lecture), « mon rôle », checklist, document imprimable', () => {
    const p = plan();
    const saisie = versSaisie(p.contenu);
    expect(saisie.cartes[0].lineups).toEqual(['lu1']);
    expect(Object.keys(saisie.cartes[0].compo[0])).not.toContain('pseudo');
    expect(Object.keys(saisie.cartes[0].strats[0])).not.toContain('ouvrable');
    expect(monRole(p).map(r => [r.carte, r.personnage, r.role])).toEqual([['Ascent', 'Jett', 'Entry'], ['Bind', 'Raze', 'Entry']]);
    expect(avancementChecklist(p.contenu, ['k1', 'disparue'])).toEqual({ faits: 1, total: 2 });
    const t: TextesImpression = { contre: nom => `contre ${nom}`, statut: s => s, format: f => f.toUpperCase(), action: a => a, camp: c => c, type: x => x, side: s => s || 'tous', titres: { veto: 'Veto', compo: 'Composition', strats: 'Strats', lineups: 'Lineups', conditions: 'Conditions', tendances: 'Tendances', calls: 'Calls', notes: 'Notes', checklist: 'Checklist', replis: 'replis', reserve: 'réserve', scouting: '' } };
    const md = markdownPlan(p, t, 'dim. 25 octobre à 21:00');
    expect(md).toContain('# Plan contre Karmine');
    expect(md).toContain('contre Karmine · dim. 25 octobre à 21:00 · BO3 · pret');
    expect(md).toContain('1. nous · ban **Breeze** (replis : Haven) : Leur meilleure map');
    expect(md).toContain('- **Léa** : Jett · Entry (Dash en premier)');
    expect(md).toContain('2. execution : Exec A split');
    expect(md).toContain('- Smoke Heaven (Omen, Dark Cover, A Heaven)');
    expect(md).toContain('- [x] Échauffement fait');
    expect(md).toContain('- [ ] Vocal testé');
    // La ligne de composition vide n'est pas imprimée.
    expect(md).not.toContain('**?**');
  });
});

describe('navigation et libellés', () => {
  it('l’onglet Plan de match n’apparaît que si le module est activé ET le rôle peut le voir', () => {
    const onglets = (d: DetailTeam) => entreesBarre(d).map(e => e.id);
    expect(onglets(detail(JOUEUR))).toContain('module:plans_match');
    expect(onglets(detail(['members.view']))).not.toContain('module:plans_match');
    expect(onglets(detail(JOUEUR, ['activity_log']))).not.toContain('module:plans_match');
  });

  it('journal et notifications : jamais de contenu tactique', () => {
    const noms = { zed12345: 'Zed' };
    const entree = (action: string, meta: Record<string, unknown>) => phraseJournal({ id: '1', action, acteur: 'zed12345', date: '', meta } as never, noms);
    expect(entree('plan_match.ready', { titre: 'Plan contre Karmine' })).toBe('Zed a marqué le plan de match « Plan contre Karmine » comme prêt.');
    expect(entree('plan_match.created', { titre: 'Modèle BO3', modele: true })).toBe('Zed a enregistré le modèle de plan « Modèle BO3 ».');
    const notif = (charge: Record<string, unknown>) => phraseNotification({ id: 'n', type: 'plan-pret', team: { id: 't1', nom: 'Faucons' }, charge, lue: false, date: '' }, noms);
    expect(notif({ plan: 'p1', titre: 'Plan', adversaire: 'Karmine' })).toBe('Faucons : le plan de match contre Karmine est prêt.');
    expect(notif({ plan: 'p1', titre: 'Finale' })).toBe('Faucons : le plan de match « Finale » est prêt.');
  });
});

describe('liste', () => {
  it('plans à venir puis passés, filtres sur place ; le joueur n’a ni bouton de création ni modèles', async () => {
    const requete = serveur([plan({ dateMatch: '2099-10-25', debut: '2099-10-25T19:00:00.000Z' }), plan({ id: 'p2', titre: 'Scrim Vitality', adversaire: { id: null, nom: 'Vitality' }, dateMatch: '2000-01-02', debut: null, evenement: null, statut: 'joue', cartes: ['Haven'] })]);
    await monter(fauxClient(requete), detail(JOUEUR));
    expect(await screen.findByTestId('esport-plan-carte-p1')).toBeTruthy();
    expect(within(screen.getByTestId('esport-plans-a-venir')).getByTestId('esport-plan-carte-p1')).toBeTruthy();
    expect(within(screen.getByTestId('esport-plans-passes')).getByTestId('esport-plan-carte-p2')).toBeTruthy();
    expect(within(screen.getByTestId('esport-plan-carte-p1')).getByText('Contre Karmine')).toBeTruthy();
    expect(screen.queryByTestId('esport-plans-nouveau')).toBeNull();
    expect(screen.queryByTestId('esport-plans-modeles')).toBeNull();
    // Le joueur ne filtre pas sur « Brouillons » (il n'en voit pas).
    expect(screen.queryByTestId('esport-plans-filtre-statut-brouillon')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-plans-filtre-statut-joue'));
    expect(screen.queryByTestId('esport-plan-carte-p1')).toBeNull();
    expect(screen.getByTestId('esport-plan-carte-p2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-plans-filtres-effacer'));
    await fireEvent.press(screen.getByTestId('esport-plans-filtre-carte-ascent'));
    expect(screen.queryByTestId('esport-plan-carte-p2')).toBeNull();
    expect(requete.mock.calls.filter(c => c[0] === '/teams/t1/plans')).toHaveLength(1);
    await screen.unmount();
  });

  it('état vide : explique à quoi sert un plan ; le staff a le bouton', async () => {
    await monter(fauxClient(serveur([])), detail(JOUEUR));
    expect(await screen.findByTestId('esport-plans-vide')).toBeTruthy();
    expect(screen.queryByTestId('esport-plans-vide-nouveau')).toBeNull();
    await screen.unmount();
    await monter(fauxClient(serveur([], { editer: true })), detail(COACH));
    expect(await screen.findByTestId('esport-plans-vide-nouveau')).toBeTruthy();
    await screen.unmount();
  });
});

describe('page d’un plan', () => {
  it('vue du joueur : résumé, « Mon rôle » par map, sa ligne mise en avant, checklist en lecture seule', async () => {
    const requete = serveur([plan()]);
    await monter(fauxClient(requete), detail(JOUEUR));
    await fireEvent.press(await screen.findByTestId('esport-plan-ouvrir-p1'));
    expect(await screen.findByTestId('esport-plan-resume')).toBeTruthy();
    expect(screen.getByTestId('esport-plan-titre').props.children).toBe('Contre Karmine');
    expect(String(screen.getByTestId('esport-plan-date').props.children)).toContain('21:00');
    // Mon rôle : une carte par map où la joueuse est dans la composition.
    const role = screen.getByTestId('esport-plan-mon-role');
    expect(within(role).getByText('Jett · Entry')).toBeTruthy();
    expect(within(role).getByText('Raze · Entry')).toBeTruthy();
    expect(screen.getAllByTestId('esport-plan-compo-moi')).toHaveLength(1);
    // Veto, strats par side, lineups clés, textes de la map.
    expect(within(screen.getByTestId('esport-plan-veto-0')).getByText('Breeze')).toBeTruthy();
    expect(within(screen.getByTestId('esport-plan-strats')).getByText('Exec A split')).toBeTruthy();
    expect(screen.getByTestId('esport-plan-lineup-lu1')).toBeTruthy();
    expect(within(screen.getByTestId('esport-plan-conditions')).getByText('Contrôle du mid')).toBeTruthy();
    // Un appui sur « Mon rôle » de Bind montre la section de Bind.
    await fireEvent.press(screen.getByTestId('esport-plan-mon-role-c2'));
    expect(within(screen.getByTestId('esport-plan-carte-c2')).getByText('Attention aux TP')).toBeTruthy();
    // Lecture seule : ni modification, ni statut, ni case cochable.
    for (const id of ['esport-plan-modifier', 'esport-plan-pret', 'esport-plan-joue', 'esport-plan-supprimer']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('esport-plan-coche-k2').props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    expect(screen.getByTestId('esport-plan-coche-k1').props.accessibilityState).toMatchObject({ checked: true });
    await screen.unmount();
  });

  it('staff : cocher la checklist et marquer « prêt » passent par l’API', async () => {
    const requete = serveur([plan({ statut: 'brouillon', moi: { editer: true, debrief: true } })], { editer: true });
    await monter(fauxClient(requete), detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-plan-ouvrir-p1'));
    expect(await screen.findByTestId('esport-plan-brouillon-aide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-plan-coche-k2'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/plans/p1/coches', 'PUT', { coches: ['k1', 'k2'] }));
    await waitFor(() => expect(screen.getByTestId('esport-plan-coche-k2').props.accessibilityState).toMatchObject({ checked: true }));
    await fireEvent.press(screen.getByTestId('esport-plan-pret'));
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/plans/p1', 'PATCH', { statut: 'pret' }));
    expect(await screen.findByTestId('esport-plan-joue')).toBeTruthy();
    await screen.unmount();
  });
});

describe('éditeur', () => {
  it('composition : joueur de la team, rôle proposé en un appui, ajout et retrait d’une ligne', async () => {
    const changer = jest.fn();
    const compo = [ligne({ id: 'a' }), ligne({ id: 'b', membre: 'kai12345', nom: 'Kai', role: 'IGL' })];
    await render(<EditeurCompo theme={theme} modele="valorant" assets={assetsRepli(0)} membres={LIENS.membres} compo={compo} onChanger={changer} />);
    expect(screen.getAllByTestId(/^esport-plan-form-compo-ligne-\d$/)).toHaveLength(2);
    // Un joueur sans membre choisi garde un champ de nom libre ; un membre choisi, non.
    expect(screen.getByTestId('esport-plan-form-compo-nom-0')).toBeTruthy();
    expect(screen.queryByTestId('esport-plan-form-compo-nom-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-plan-form-compo-role-0-entry'));
    expect(changer).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a', role: 'Entry' }), compo[1]]);
    await fireEvent.press(screen.getByTestId('esport-plan-form-compo-ajouter'));
    expect(changer.mock.calls.at(-1)?.[0]).toHaveLength(3);
    await fireEvent.press(screen.getByTestId('esport-plan-form-compo-retirer-1'));
    expect(changer).toHaveBeenLastCalledWith([compo[0]]);
    // The Finals : arme, spécialisation, trois gadgets et réserve.
    await screen.unmount();
    await render(<EditeurCompo theme={theme} modele="thefinals" assets={undefined} membres={[]} compo={[ligne({ id: 'a' })]} onChanger={changer} />);
    for (const id of ['arme', 'specialisation', 'gadget0', 'gadget1', 'gadget2']) expect(screen.getByTestId(`esport-plan-form-compo-${id}-0`)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('esport-plan-form-compo-reserve-0'), 'Frag, Goo');
    expect(changer.mock.calls.at(-1)?.[0][0].reserve).toEqual(['Frag', 'Goo']);
    await screen.unmount();
  });

  it('enregistrer envoie le titre et le contenu (lineups par identifiant) ; aucun assistant d’écriture', async () => {
    const requete = serveur([plan({ statut: 'brouillon', moi: { editer: true, debrief: true } })], { editer: true });
    await monter(fauxClient(requete), detail(COACH));
    await fireEvent.press(await screen.findByTestId('esport-plan-ouvrir-p1'));
    await fireEvent.press(await screen.findByTestId('esport-plan-modifier'));
    expect(await screen.findByTestId('esport-plan-form')).toBeTruthy();
    // Contenu tactique : aucun bouton de l'assistant d'écriture dans le formulaire.
    expect(screen.queryAllByTestId(/ecriture/)).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('esport-plan-form-titre'), 'Plan contre Karmine (v2)');
    await fireEvent.changeText(screen.getByTestId('esport-plan-form-conditions'), 'Tenir le mid');
    await fireEvent.press(screen.getByTestId('esport-plan-form-enregistrer'));
    await waitFor(() => expect(requete.mock.calls.some(c => c[0] === '/teams/t1/plans/p1' && c[1] === 'PATCH')).toBe(true));
    const corps = requete.mock.calls.find(c => c[0] === '/teams/t1/plans/p1' && c[1] === 'PATCH')?.[2] as { titre: string; evenementId: string; contenu: { cartes: Array<{ conditions: string; lineups: string[]; compo: unknown[] }> } };
    expect(corps.titre).toBe('Plan contre Karmine (v2)');
    expect(corps.evenementId).toBe('e1');
    expect(corps.contenu.cartes[0].conditions).toBe('Tenir le mid');
    expect(corps.contenu.cartes[0].lineups).toEqual(['lu1']);
    expect(await screen.findByTestId('esport-plan-resume')).toBeTruthy();
    await screen.unmount();
  });
});

/**
 * Esport, phase 3 (interface) : résumés de réunions (dépôt, historique,
 * PDF, boîte de réception du rédacteur avec « Nouveau » / « Vu »), objectifs
 * et tâches (progression, filtres, kanban), accueil de la team, 8 thèmes.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { THEMES_HUB, themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, requeteUrl, type Boite, type ClientEsport, type DetailDepot, type Depot, type DetailTeam, type Objectif, type Tache } from './client';
import { LIBELLES_STATUT_DEPOT, lireDateSaisie, phraseJournal, phraseNotification, tailleLisible } from './libelles';
import { PageTeam, entreesBarre } from './ui/PageTeam';
import { BoiteResumes } from './ui/Resumes';

const theme = themeHub('nuit');

const detail = (permissions: string[], modules = ['meeting_summaries', 'goals_tasks', 'activity_log']): DetailTeam => ({
  team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
  modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
  membres: 3,
  moi: { membreId: 'm1', role: { id: 'r1', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
});
const JOUEUR = ['members.view', 'meeting_summaries.submit', 'meeting_summaries.view_summary', 'goals_tasks.view'];
const HEBDO = { id: 'ty1', nom: 'Hebdo', couleur: '#2563eb', visibilite: 'team' as const, global: true, position: 1 };

const depot = (champs: Partial<Depot> = {}): Depot => ({
  id: 'd1',
  team: { id: 't1', nom: 'Faucons' },
  titre: 'Réunion du lundi',
  lien: 'https://youtu.be/x',
  type: HEBDO,
  dateReunion: '2026-10-19',
  note: '',
  statut: 'a_resumer',
  deposePar: { compte: 'lea12345', pseudo: 'Léa' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T08:00:00.000Z',
  resume: null,
  nouveau: true,
  vu: null,
  moi: { deposant: true, redacteur: false },
  ...champs,
});

let detailCourant: DetailTeam;

function fauxClient(surcharges: Partial<ClientEsport> = {}): ClientEsport {
  const non = async () => {
    throw new Error('non prévu');
  };
  return new Proxy(
    {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detailCourant,
      moi: async () => ({ compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false }),
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      membres: async () => [],
      typesReunion: async () => [HEBDO],
      resumesTeam: async () => [],
      mesDepots: async () => [],
      objectifs: async () => [],
      taches: async () => ({ jour: '2026-10-20', taches: [] }),
      ...surcharges,
    } as unknown as ClientEsport,
    { get: (cible, cle) => (cle in cible ? (cible as unknown as Record<string | symbol, unknown>)[cle] : non) },
  );
}

async function monter(client: ClientEsport, d: DetailTeam, section: React.ComponentProps<typeof PageTeam>['sectionInitiale'], mode: 'large' | 'telephone' = 'large', t = theme) {
  detailCourant = d;
  return render(
    <ModeAffichageForce mode={mode}>
      <PageTeam theme={t} client={client} teamId="t1" large={mode === 'large'} sectionInitiale={section} onQuitter={() => undefined} />
    </ModeAffichageForce>,
  );
}

describe('libellés et aides', () => {
  it('statuts, dates, tailles, paramètres d’URL', () => {
    expect(LIBELLES_STATUT_DEPOT).toEqual({ a_resumer: 'À résumer', en_cours: 'En cours', termine: 'Terminé' });
    expect(lireDateSaisie('19/10/2026')).toBe('2026-10-19');
    expect(lireDateSaisie('2026-10-19')).toBe('2026-10-19');
    expect(lireDateSaisie('31/02/2026')).toBeUndefined();
    expect(tailleLisible(1536)).toBe('2 Ko');
    expect(tailleLisible(3 * 1024 * 1024)).toBe('3,0 Mo');
    expect(requeteUrl({ statut: 'en_cours', team: undefined, nouveaux: true, tri: '' })).toBe('?statut=en_cours&nouveaux=1');
  });

  it('journal et notifications de la phase 3', () => {
    const noms = { lea12345: 'Léa', principal: 'Fondateur' };
    const e = (action: string, meta: Record<string, unknown>) => ({ id: '1', action, acteur: 'principal', entiteType: null, entiteId: null, meta, date: '' });
    expect(phraseJournal(e('meeting.summary_published', { titre: 'Hebdo' }), noms)).toBe('Fondateur a publié le résumé « Hebdo »');
    expect(phraseJournal(e('meeting.status_changed', { titre: 'Hebdo', vers: 'termine', automatique: true }), noms)).toBe('Fondateur a passé « Hebdo » en Terminé (PDF déposé)');
    expect(phraseJournal(e('task.assigned', { titre: 'VOD', assigne: 'lea12345' }), noms)).toBe('Fondateur a assigné « VOD » à Léa');
    const n = (type: string, charge: Record<string, unknown>) => ({ id: '1', type, team: { id: 't', nom: 'Faucons' }, charge, lue: false, date: '' });
    expect(phraseNotification(n('resume-publie', { titre: 'Hebdo' }), noms)).toBe('Le résumé de « Hebdo » est prêt (Faucons)');
    expect(phraseNotification(n('resume-depose', { membre: 'lea12345', titre: 'Hebdo' }), noms)).toBe('Léa a déposé une réunion à résumer dans Faucons : « Hebdo »');
    expect(phraseNotification(n('tache-echeance', { titre: 'VOD', echeance: '2026-10-21', retard: false }), noms)).toBe('Échéance proche : « VOD » (21/10/2026)');
  });

  it('barre : Résumés et Objectifs ne sont plus « bientôt »', () => {
    const e = entreesBarre(detail(JOUEUR));
    expect(e.find(x => x.id === 'module:meeting_summaries')?.bientot).toBe(false);
    expect(e.find(x => x.id === 'module:goals_tasks')?.bientot).toBe(false);
  });
});

describe('résumés de réunions', () => {
  it('Joueur : dépôt (date JJ/MM/AAAA → ISO), puis historique avec le PDF prêt', async () => {
    let miens: Depot[] = [];
    const deposerReunion = jest.fn(async (_t: string, d: { titre: string }) => {
      miens = [depot({ titre: d.titre, statut: 'termine', resume: { fichierId: 'f1', le: '', par: null } })];
      return miens[0];
    });
    const lienPdf = jest.fn(async () => ({ url: 'https://esport.test/fichiers/f1?sig=x', expire: '' }));
    const ouvrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await monter(fauxClient({ deposerReunion, mesDepots: async () => miens, lienPdf }), detail(JOUEUR), 'module:meeting_summaries');
    await screen.findByTestId('esport-depot-formulaire');
    // Un Joueur ne voit ni la boîte de réception ni les types.
    expect(screen.queryByTestId('esport-resumes-vue-boite')).toBeNull();
    expect(screen.queryByTestId('esport-resumes-vue-types')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('esport-depot-lien'), 'https://youtu.be/abc');
    await fireEvent.changeText(screen.getByTestId('esport-depot-date'), '19/10/2026');
    await fireEvent.changeText(screen.getByTestId('esport-depot-titre'), 'Réunion du lundi');
    await waitFor(() => expect(screen.getByTestId('esport-depot-type-ty1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('esport-depot-envoyer'));
    await waitFor(() => expect(deposerReunion).toHaveBeenCalledWith('t1', { lien: 'https://youtu.be/abc', typeId: 'ty1', dateReunion: '2026-10-19', titre: 'Réunion du lundi', note: undefined }));
    await screen.findByTestId('esport-mes-depots');
    await fireEvent.press(await screen.findByTestId('esport-depot-pdf-d1'));
    await waitFor(() => expect(ouvrir).toHaveBeenCalledWith('https://esport.test/fichiers/f1?sig=x'));
    expect(lienPdf).toHaveBeenCalledWith('t1', 'd1', { telecharger: false });
    ouvrir.mockRestore();
  });

  it('rédacteur : boîte de réception, badge « Nouveau », compteur, ouverture qui marque « Vu », statut', async () => {
    const d = depot();
    const vu: DetailDepot = { ...d, nouveau: false, vu: { le: '2026-10-20T09:00:00.000Z', par: 'principal' }, moi: { deposant: false, redacteur: true }, fichiers: [] };
    let boite: Boite = { depots: [d], teams: [{ id: 't1', nom: 'Faucons', redacteur: true }], types: [HEBDO], deposants: [d.deposePar], attente: 1, nouveaux: 1, total: 1 };
    const marquerVu = jest.fn(async () => {
      boite = { ...boite, depots: [{ ...d, nouveau: false }], nouveaux: 0 };
      return vu;
    });
    const changerStatutDepot = jest.fn(async () => ({ ...vu, statut: 'en_cours' as const }));
    const client = fauxClient({
      boiteResumes: async () => boite,
      depot: async () => ({ ...vu, nouveau: true, vu: null }),
      marquerVu,
      changerStatutDepot,
    });
    await render(<BoiteResumes theme={theme} client={client} large />);
    await screen.findByTestId('esport-boite-nouveau-d1');
    expect(screen.getByTestId('esport-boite-compteur').props.children).toBe('1 en attente · 1 nouveau');
    await fireEvent.press(screen.getByTestId('esport-boite-depot-d1'));
    await screen.findByTestId('esport-detail-depot');
    await waitFor(() => expect(marquerVu).toHaveBeenCalledWith('t1', 'd1'));
    await waitFor(() => expect(screen.queryByTestId('esport-boite-nouveau-d1')).toBeNull());
    // Terminé désactivé tant qu'il n'y a pas de PDF ; En cours possible.
    expect(screen.getByTestId('esport-detail-statut-termine').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('esport-detail-statut-en_cours'));
    await waitFor(() => expect(changerStatutDepot).toHaveBeenCalledWith('t1', 'd1', 'en_cours'));
  });
});

describe('objectifs et tâches', () => {
  const objectif: Objectif = { id: 'o1', titre: 'Monter Immortel', description: '', proprietaire: null, dateCible: null, statut: 'actif', progression: { total: 4, faites: 1, pourcentage: 25 }, creePar: null, creeLe: '' };
  const tache = (champs: Partial<Tache>): Tache => ({
    id: 'x',
    titre: 'Tâche',
    description: '',
    objectif: null,
    assigne: { compte: 'lea12345', pseudo: 'Léa' },
    echeance: null,
    priorite: 'normale',
    statut: 'a_faire',
    enRetard: false,
    creePar: null,
    creeLe: '',
    majLe: '',
    termineLe: null,
    ...champs,
  });

  it('progression, kanban, filtre « En retard », l’assigné fait avancer sa tâche', async () => {
    const taches = jest.fn(async (_t: string, f?: { filtre?: string }) => ({
      jour: '2026-10-20',
      taches: f?.filtre === 'retard' ? [tache({ id: 'a', titre: 'VOD', echeance: '2026-10-18', enRetard: true })] : [tache({ id: 'a', titre: 'VOD', echeance: '2026-10-18', enRetard: true }), tache({ id: 'b', titre: 'Lineups', assigne: { compte: 'kai12345', pseudo: 'Kai' }, statut: 'en_cours' })],
    }));
    const modifierTache = jest.fn(async () => tache({}));
    await monter(fauxClient({ objectifs: async () => [objectif], taches, modifierTache }), detail(JOUEUR), 'module:goals_tasks');
    await screen.findByTestId('esport-objectif-o1');
    expect(screen.getByTestId('esport-objectif-pourcentage-o1').props.children).toEqual([25, ' %']);
    expect(screen.queryByTestId('esport-tache-nouvelle')).toBeNull();
    // Ni bouton « + Nouvelle tâche » (le formulaire s'ouvre de là).
    expect(screen.queryByTestId('esport-tache-creer')).toBeNull();
    await screen.findByTestId('esport-kanban-a_faire');
    expect(screen.getByTestId('esport-tache-retard-a')).toBeTruthy();
    // Sa tâche : il peut la passer « En cours » ; pas celle de Kai.
    expect(screen.queryByTestId('esport-tache-b-fait')).toBeNull();
    await fireEvent.press(screen.getByTestId('esport-tache-a-en_cours'));
    await waitFor(() => expect(modifierTache).toHaveBeenCalledWith('t1', 'a', { statut: 'en_cours' }));
    await fireEvent.press(screen.getByTestId('esport-taches-filtre-retard'));
    await waitFor(() => expect(taches).toHaveBeenLastCalledWith('t1', { filtre: 'retard' }));
    await fireEvent.press(screen.getByTestId('esport-taches-vue-liste'));
    expect(await screen.findByTestId('esport-taches-liste')).toBeTruthy();
  });

  it('accueil : derniers résumés et tâches en retard', async () => {
    const client = fauxClient({
      resumesTeam: async () => [depot({ id: 'r1', titre: 'Bilan du mois', statut: 'termine' })],
      taches: async () => ({ jour: '2026-10-20', taches: [tache({ id: 'late', titre: 'VOD', echeance: '2026-10-18', enRetard: true })] }),
    });
    await monter(client, detail(JOUEUR), 'accueil');
    await screen.findByTestId('esport-accueil-resumes');
    expect(await screen.findByTestId('esport-accueil-resume-r1')).toBeTruthy();
    expect(await screen.findByTestId('esport-accueil-retard-late')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('esport-accueil-aller-taches'));
    expect(await screen.findByTestId('esport-objectifs')).toBeTruthy();
  });

  it('les sections s’affichent dans les 8 thèmes, sur téléphone', async () => {
    expect(THEMES_HUB.length).toBe(8);
    const redacteur = [...JOUEUR, 'meeting_summaries.write_summary', 'goals_tasks.create', 'goals_tasks.assign'];
    for (const t of THEMES_HUB) {
      for (const section of ['module:meeting_summaries', 'module:goals_tasks'] as const) {
        const { unmount } = await monter(fauxClient({ boiteResumes: async () => ({ depots: [], teams: [], types: [], deposants: [], attente: 0, nouveaux: 0, total: 0 }) }), detail(redacteur), section, 'telephone', t);
        expect(await screen.findByTestId(section === 'module:goals_tasks' ? 'esport-objectifs' : 'esport-resumes')).toBeTruthy();
        await unmount();
      }
    }
  });
});

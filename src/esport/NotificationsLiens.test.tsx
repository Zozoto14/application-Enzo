/**
 * Liens directs des notifications (docs/esport/notifications.md « Liens directs ») :
 *  - logique pure : chaque genre de cible mène à un écran (échoue pour un genre sans écran), adresses partageables ;
 *  - écrans : carte CM ouverte et commentaire mis en avant, ticket ouvert et message mis en avant, fichier du Drive
 *    ouvert dans son dossier, événement du planning ouvert à sa date ;
 *  - app : clic sur une notification (marquée lue, vérifiée par le serveur, écran ouvert, adresse tenue à jour),
 *    élément supprimé, accès perdu, adresse partageable suivie au chargement.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import { ModeAffichageForce } from '../ui/mobile';
import { CATALOGUE, clientEsport, oublierSessions, type ClientEsport, type DetailTeam } from './client';
import { apiCm, type CarteResume, type DetailTableau, type ReponseCarte } from './cm/api';
import type { ContenuDrive, FichierDrive } from './cm/drive';
import { definirLangue } from './i18n';
import type { NotificationCentre } from './notifications/api';
import { CHAMPS_CIBLES, GENRES_CIBLES, destinationCible, fragmentCible, fragmentEcran, lireFragment, normaliserCible, type CibleNotification } from './notifications/cibles';
import { fauxPlanning } from './planning/faux';
import type { DetailTicket, ResumeTicket } from './tickets/api';
import { PageTeam } from './ui/PageTeam';
import { Esport, ecranDeVue, fabrique, vueDEcran } from './ui/RacineEsport';
import { Tableau } from './ui/cm/Tableau';
import { Drive } from './ui/cm/drive/Drive';
import { FournisseurCible, type CibleActive } from './ui/notifications/Cible';
import { ListeTickets } from './ui/tickets/TicketsStaff';
import { PageTickets } from './ui/tickets/PageTickets';

const theme = themeHub('nuit');

afterEach(() => {
  oublierSessions();
  definirLangue('fr');
});

// ------------------------------------------------------------------ Logique pure

describe('cibles : écrans et adresses', () => {
  it('chaque genre de cible mène à un écran (un nouveau genre sans écran fait échouer ce test)', () => {
    for (const g of GENRES_CIBLES) {
      const c = { v: 1, g } as CibleNotification;
      for (const k of CHAMPS_CIBLES[g]) c[k] = k === 'portee' ? 'club' : `${k}-1`;
      const d = destinationCible(c);
      expect([g, d]).toEqual([g, expect.objectContaining({ vue: expect.objectContaining({ v: expect.any(String) }) })]);
    }
    expect(destinationCible({ v: 1, g: 'ticket', ticket: 't1', message: 'm1' })).toEqual({ vue: { v: 'tickets' }, surligne: 'tk-msg:m1' });
    expect(destinationCible({ v: 1, g: 'carte_cm', carte: 'c1', commentaire: 'k1', tableau: 'tb' })).toEqual({ vue: { v: 'cm', onglet: 'tableaux' }, surligne: 'cm-commentaire:k1' });
    // Carte d'une team, compte sans espace CM : l'onglet CM de la team.
    expect(destinationCible({ v: 1, g: 'carte_cm', carte: 'c1', team: 't1' }, { espaceCm: false })?.vue).toEqual({ v: 'team', id: 't1', section: 'module:cm' });
    expect(destinationCible({ v: 1, g: 'evenement', evenement: 'e1', team: 't1' })).toEqual({ vue: { v: 'team', id: 't1', section: 'module:planning' }, surligne: 'evenement:e1' });
    // Sans team : rien à ouvrir.
    expect(destinationCible({ v: 1, g: 'evenement', evenement: 'e1' })).toBeNull();
    expect(destinationCible({ v: 1, g: 'devblog', brouillon: 'd1' })?.vue).toEqual({ v: 'administration', sous: 'devblog' });
  });

  it('avis et alertes (migration 0077) : Tickets › Avis, fiche de l’événement et ligne du match, Bot Esport HQ › Salons vocaux, Rôles temporaires de la team', () => {
    expect(destinationCible({ v: 1, g: 'avis_ticket', ticket: 't1' })).toEqual({ vue: { v: 'tickets' }, surligne: 'tk-avis:t1' });
    expect(destinationCible({ v: 1, g: 'salon_match', evenement: 'e1', match: 'm:9' })).toEqual({ vue: { v: 'administration', sous: 'evenements' }, surligne: 'salon-match:m:9' });
    expect(destinationCible({ v: 1, g: 'salon_match', evenement: 'e1' })).toEqual({ vue: { v: 'administration', sous: 'evenements' }, surligne: 'salons-match:e1' });
    expect(destinationCible({ v: 1, g: 'alerte_discord', zone: 'vocaux' })).toEqual({ vue: { v: 'administration', sous: 'bot' }, surligne: 'bot-fn:vocaux' });
    expect(destinationCible({ v: 1, g: 'alerte_discord', zone: 'evenement', evenement: 'e1' })).toEqual({ vue: { v: 'administration', sous: 'evenements' }, surligne: 'evenement-discord:e1' });
    expect(destinationCible({ v: 1, g: 'alerte_discord', zone: 'role_temp', team: 't1' })).toEqual({ vue: { v: 'team', id: 't1', section: 'module:discord' }, surligne: 'roles-temp:t1' });
    expect(destinationCible({ v: 1, g: 'alerte_discord', zone: 'role_temp' })).toBeNull();
    const c: CibleNotification = { v: 1, g: 'salon_match', evenement: 'e1', match: 'm:9' };
    expect(fragmentCible(c)).toBe('#/app/esport/c/salon_match?evenement=e1&match=m%3A9');
    expect(lireFragment(fragmentCible(c))).toEqual({ cible: c });
  });

  it('adresses partageables : élément et écran, lus et relus à l’identique', () => {
    const c: CibleNotification = { v: 1, g: 'ticket', ticket: 't1', message: 'm1' };
    expect(fragmentCible(c)).toBe('#/app/esport/c/ticket?ticket=t1&message=m1');
    expect(lireFragment(fragmentCible(c))).toEqual({ cible: c });
    expect(lireFragment('#/app/esport/c/carte_cm?carte=c1&inconnu=x')).toEqual({ cible: { v: 1, g: 'carte_cm', carte: 'c1' } });
    expect(lireFragment('#/app/esport/c/inconnu?x=1')).toBeNull();
    expect(lireFragment('#/app/taches')).toBeNull();
    expect(normaliserCible({ v: 2, g: 'ticket', ticket: 't1' })).toBeNull();
    for (const v of [{ v: 'team' as const, id: 't1', section: 'module:planning' as const }, { v: 'cm' as const, onglet: 'drive' as const }, { v: 'membres' as const, sous: 'trombi' as const }, { v: 'administration' as const, sous: 'jeux' as const }, { v: 'notifications' as const }]) {
      const lu = lireFragment(fragmentEcran(ecranDeVue(v)));
      expect(lu && 'ecran' in lu ? vueDEcran(lu.ecran) : undefined).toEqual(v);
    }
    expect(fragmentEcran({ v: 'team', id: 't1', sous: 'module:planning' })).toBe('#/app/esport/v/team/t1/module%3Aplanning');
  });
});

// ------------------------------------------------------------------ Écrans

const active = (cible: CibleNotification, surligne?: string): CibleActive => ({ cible, n: 1, surligne });

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const L1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

const resumeCarte = (): CarteResume => ({ id: C1, listeId: L1, teamId: null, titre: 'Annonce du tournoi', description: false, position: 1024, couverture: null, echeance: null, echeanceFaite: false, datePublication: null, post: false, statut: null, reseaux: [], origine: 'manuel', depotGenre: null, etiquettes: [], membres: [], commentaires: 2, checklist: { total: 0, faits: 0 }, pieces: 0, archive: false, version: 1, modifiable: true });

function tableauCm(): DetailTableau {
  return {
    tableau: { id: T, nom: 'Contenus', cleDefaut: null, portee: 'club', team: null, couleur: '#db2777', description: '', version: 3, archive: false, trello: false, majLe: '', fond: null },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true },
    moi: 'cm123456',
    listes: [{ id: L1, nom: 'Idées', cle: null, position: 1024, archive: false }],
    etiquettes: [],
    cartes: [resumeCarte()],
    noms: {},
    personnes: [{ compte: 'cm123456', pseudo: 'Clara' }],
  } as DetailTableau;
}

function reponseCarte(): ReponseCarte {
  return {
    carte: {
      ...resumeCarte(),
      tableauId: T,
      description: '',
      textes: {},
      liens: {},
      publications: {},
      soumisPar: null,
      soumisLe: null,
      validePar: null,
      valideLe: null,
      refusMotif: null,
      refusePar: null,
      publiePar: null,
      publieLe: null,
      trello: false,
      creePar: 'cm123456',
      creeLe: '2026-10-20T09:00:00.000Z',
      majLe: '',
      checklists: [],
      commentaires: [
        { id: 'k1', auteur: 'red12345', auteurNom: null, texte: 'Premier', creeLe: '2026-10-20T10:00:00.000Z', majLe: '', trello: false, moi: false, nouveau: false },
        { id: 'k2', auteur: 'red12345', auteurNom: null, texte: 'Relis ça @Clara', creeLe: '2026-10-21T10:00:00.000Z', majLe: '', trello: false, moi: false, nouveau: true },
      ],
      pieces: [],
      activite: [],
      clips: [],
      resumes: {},
    },
    droits: { voir: true, deposer: true, editer: true, valider: true, gerer: true, commenter: true, modifier: true },
    noms: { red12345: 'Remi', cm123456: 'Clara' },
    problemes: [],
  } as unknown as ReponseCarte;
}

function clientHttp(repondre: (chemin: string, methode: string) => unknown) {
  const requete = jest.fn(async (url: string, init?: { method?: string }) => {
    const chemin = url.replace('https://esport.test', '');
    if (chemin === '/session') return { ok: true, status: 200, json: async () => ({ session: 's1', expire: '2099-01-01T00:00:00.000Z', compte: 'cm123456', superAdmin: false, profil: null, peutCreerTeam: false, fonctions: ['surcharge-methode'] }) };
    const corps = repondre(chemin, init?.method ?? 'GET') ?? { ok: true };
    return { ok: true, status: 200, json: async () => corps };
  });
  return clientEsport({ adresse: 'https://esport.test', jetonRelais: 'jeton-relais-0123456789' }, requete);
}

describe('écrans ouverts par un lien direct', () => {
  it('carte CM : la fiche de la carte s’ouvre et le commentaire visé est mis en avant', async () => {
    const client = clientHttp(chemin => {
      const c = chemin.split('?')[0];
      if (c === `/cm/tableaux/${T}`) return tableauCm();
      if (c === `/cm/cartes/${C1}`) return reponseCarte();
      return undefined;
    });
    await render(
      <FournisseurCible active={active({ v: 1, g: 'carte_cm', carte: C1, commentaire: 'k2', tableau: T }, 'cm-commentaire:k2')}>
        <Tableau theme={theme} api={apiCm(client)} id={T} large />
      </FournisseurCible>,
    );
    expect(await screen.findByTestId('esport-cm-fiche')).toBeTruthy();
    const surligne = await screen.findByTestId('esport-cible-surlignee');
    expect(within(surligne).getByTestId('esport-cm-commentaire-k2')).toBeTruthy();
    expect(within(surligne).queryByTestId('esport-cm-commentaire-k1')).toBeNull();
  });

  it('ticket : le ticket s’ouvre et le message visé est mis en avant', async () => {
    const CAT = { id: 'cat1', nom: { fr: 'Recrutement', en: 'Recruitment' }, couleur: '#22aa66', icone: 'membres', actif: true };
    const TK = '00000000-0000-0000-0000-000000000009';
    const resume: ResumeTicket = { id: TK, numero: 9, categorie: CAT, statut: 'ferme', priorite: 'moyen', auteur: { discordId: '8001', nom: 'Léa', compte: null }, responsable: null, ouvertLe: '2026-11-04T10:00:00.000Z', derniereActivite: '2026-11-04T10:05:00.000Z', fermeLe: null, note: null, nonLu: false, permanent: false } as unknown as ResumeTicket;
    const detail = {
      ...resume,
      nonLuDepuis: null,
      salon: { id: '7001', nom: 'ticket-0009-lea', supprime: false },
      reponses: [],
      raison: null,
      noteCommentaire: null,
      liaison: { type: 'aucune' },
      liaisonCategorie: { type: 'aucune' },
      purge: false,
      fermeture: { heures: 168, source: 'general', staffSeul: false, permanentPar: null, permanentLe: null },
      membres: [],
      messages: [
        { id: 'm1', genre: 'discord', auteur: { nom: 'Léa', discordId: '8001', compte: null }, staff: false, contenu: 'Bonjour', envoi: 'ok', le: '2026-11-04T10:01:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] },
        { id: 'm2', genre: 'discord', auteur: { nom: 'Léa', discordId: '8001', compte: null }, staff: false, contenu: 'Vous êtes là ?', envoi: 'ok', le: '2026-11-04T10:02:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] },
      ],
      droits: { repondre: true, gerer: false },
    } as unknown as DetailTicket;
    const requete = async (chemin: string): Promise<unknown> => {
      // Le ticket (fermé) n'est pas dans la liste « ouverts » : il s'ouvre quand même.
      if (chemin.startsWith('/tickets?')) return { tickets: [], categories: [CAT], droits: { repondre: true, gerer: false, configurer: false } };
      if (chemin === '/tickets/preferences') return { mpNouveau: false, mpMessage: true };
      if (chemin === `/tickets/${TK}`) return detail;
      return { ok: true };
    };
    await render(
      <FournisseurCible active={active({ v: 1, g: 'ticket', ticket: TK, message: 'm2' }, 'tk-msg:m2')}>
        <ListeTickets theme={theme} client={{ requete } as unknown as ClientEsport} large />
      </FournisseurCible>,
    );
    expect(await screen.findByTestId('esport-tk-vue')).toBeTruthy();
    const surligne = await screen.findByTestId('esport-cible-surlignee');
    expect(within(surligne).getByTestId('esport-tk-msg-m2')).toBeTruthy();
    expect(within(surligne).queryByTestId('esport-tk-msg-m1')).toBeNull();
  });

  it('avis d’un ticket : l’onglet Avis s’ouvre, filtré sur ce ticket et mis en avant ; « Tous les avis » retire le filtre', async () => {
    const CAT = { id: 'cat1', nom: { fr: 'Recrutement', en: 'Recruitment' }, couleur: '#22aa66', icone: 'membres', actif: true };
    const TK = '00000000-0000-0000-0000-000000000009';
    const avis = (id: string, numero: number, note: number) => ({ id, ticketId: id, numero, salon: null, anonyme: false, categorie: CAT, note, commentaire: 'Merci', auteur: 'Léa', responsable: null, le: '2026-11-04T10:05:00.000Z' });
    const appels: string[] = [];
    const requete = async (chemin: string): Promise<unknown> => {
      appels.push(chemin);
      if (chemin === '/tickets/etat') return { actif: true, bot: true, connexion: { etat: 'direct' } };
      if (chemin.startsWith('/tickets/avis')) {
        const seul = chemin.includes(`ticket=${TK}`);
        const liste = seul ? [avis(TK, 9, 4)] : [avis(TK, 9, 4), avis('autre', 10, 2)];
        return { total: liste.length, moyenne: 3, repartition: [0, 1, 0, 1, 0], avis: liste, categories: [CAT], responsables: [], voirTickets: false };
      }
      return { tickets: [], categories: [CAT], droits: { repondre: true, gerer: true, configurer: false } };
    };
    await render(
      <FournisseurCible active={active({ v: 1, g: 'avis_ticket', ticket: TK }, `tk-avis:${TK}`)}>
        <PageTickets theme={theme} client={{ requete } as unknown as ClientEsport} large moi={{ voir: true, repondre: true, gerer: true, configurer: false, actif: true }} />
      </FournisseurCible>,
    );
    expect(await screen.findByTestId('esport-tk-avis')).toBeTruthy();
    await waitFor(() => expect(appels.some(c => c.startsWith('/tickets/avis') && c.includes(`ticket=${TK}`))).toBe(true));
    const surligne = await screen.findByTestId('esport-cible-surlignee');
    expect(within(surligne).getByTestId(`esport-tk-avis-${TK}`)).toBeTruthy();
    expect(screen.queryByTestId('esport-tk-avis-autre')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-tk-avis-f-ticket-tous'));
    });
    expect(await screen.findByTestId('esport-tk-avis-autre')).toBeTruthy();
    expect(screen.queryByTestId('esport-tk-avis-f-ticket')).toBeNull();
  });

  it('Drive : le dossier du fichier s’ouvre et le fichier s’affiche (aperçu et détails)', async () => {
    const D = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    const F = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
    const droits = { voir: true, envoyer: true, gerer: true, depot: false };
    const quota = { utilise: 1, enCours: 0, limite: 20_000, pourcent: 1, alerte: false, fichierMax: 1024 ** 3, zipMax: 1024 ** 3 };
    const fichier = { id: F, portee: 'club', dossierId: D, nom: 'blason.png', genre: 'image', type: 'image/png', taille: 2048, version: 1, meta: { format: 'png', nomFormat: 'PNG', largeur: 10, hauteur: 10, duree: null, codecVideo: null, codecAudio: null }, tags: [], favori: false, origine: 'envoi', creePar: 'cm123456', creeLe: '', majPar: 'cm123456', majLe: '', vignette: null, modifiable: true } as FichierDrive;
    const dossier = { id: D, portee: 'club', parentId: null, nom: 'Logos', cle: null, restreint: false, fichiers: 1, favori: false, creePar: null, creeLe: '', majLe: '', modifiable: true, systeme: false };
    const appels: string[] = [];
    const requete = async (chemin: string): Promise<unknown> => {
      appels.push(chemin);
      const [c, qs = ''] = chemin.split('?');
      const q = new URLSearchParams(qs);
      if (c === '/cm/drive/portees') return { portees: [{ portee: 'club', team: null, droits }], quota, reglages: { rangementVisuels: true, rangementClips: true } };
      if (c === '/cm/drive')
        return (q.get('dossier') === D
          ? { portee: 'club', team: null, droits, dossier, chemin: [{ id: D, nom: 'Logos', cle: null }], dossiers: [], fichiers: [fichier], noms: {}, tronque: false, quota }
          : { portee: 'club', team: null, droits, dossier: null, chemin: [], dossiers: [dossier], fichiers: [], noms: {}, tronque: false, quota }) as ContenuDrive;
      if (c === '/cm/drive/arbre') return { portee: 'club', dossiers: [{ id: D, parentId: null, nom: 'Logos', cle: null, restreint: false }] };
      if (c === `/cm/drive/fichiers/${F}`) return { fichier, chemin: [{ id: D, nom: 'Logos', cle: null }], versions: [{ version: 1, nom: 'blason.png', type: 'image/png', taille: 2048, creePar: 'cm123456', creeLe: '', actuelle: true, meta: fichier.meta }], utilisations: { cartes: [], visuels: 0, sponsors: 0 }, droits: { ...droits, modifier: true }, noms: {} };
      if (c === '/cm/drive/filtres') return { tags: [], auteurs: [], genres: [] };
      if (c === '/cm/drive/nouveautes') return { total: 0, portees: [] };
      return { ok: true };
    };
    await render(
      <FournisseurCible active={active({ v: 1, g: 'drive', fichier: F, dossier: D, portee: 'club' }, `drive:${F}`)}>
        <Drive theme={theme} client={{ config: { adresse: 'https://esport.test', jetonRelais: 'x' }, requete } as unknown as ClientEsport} large />
      </FournisseurCible>,
    );
    expect(await screen.findByTestId('esport-drive-detail')).toBeTruthy();
    await waitFor(() => expect(appels.some(a => a.startsWith(`/cm/drive?portee=club&dossier=${D}`))).toBe(true));
    expect(appels).toContain(`/cm/drive/fichiers/${F}`);
  });

  it('planning : le planning se place à la date de l’événement et l’ouvre', async () => {
    const COACH = ['members.view', 'planning.view', 'planning.create', 'planning.update', 'planning.delete', 'attendance.view_all', 'attendance.rsvp_own'];
    const f = fauxPlanning(COACH);
    const detail: DetailTeam = {
      team: { id: 't1', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
      modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: ['activity_log', 'planning', 'availability', 'attendance'].includes(m.cle) })),
      membres: 3,
      moi: { membreId: 'm1', role: { id: 'r1', nom: 'Coach', couleur: '#2563eb', cle: 'coach' }, permissions: COACH, superAdmin: false },
    } as DetailTeam;
    const client = {
      config: { adresse: 'https://esport.test', jetonRelais: 'x' },
      team: async () => detail,
      membres: async () => [],
      notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
      moi: async () => ({ compte: 'c', superAdmin: false, profil: { pseudo: 'Zed', riotId: null, discord: null }, peutCreerTeam: false }),
      requete: f.requete,
    } as unknown as ClientEsport;
    await render(
      <ModeAffichageForce mode="large">
        <FournisseurCible active={active({ v: 1, g: 'evenement', evenement: 'e1e1e1e1-0000-4000-8000-000000000001', occurrence: '2026-10-20T18:00:00.000Z', team: 't1' })}>
          <PageTeam theme={theme} client={client} teamId="t1" large sectionInitiale="module:planning" onQuitter={() => undefined} />
        </FournisseurCible>
      </ModeAffichageForce>,
    );
    const volet = await screen.findByTestId('esport-planning-volet');
    expect(within(volet).getAllByText(/Entraînement/).length).toBeGreaterThan(0);
    // Demande du mois de l'événement (octobre 2026), pas seulement du mois courant.
    expect(f.appels.some(a => /debut=2026-09-28/.test(a.chemin))).toBe(true);
  });
});

// ------------------------------------------------------------------ App : clic, avis, adresse

const N_CARTE: NotificationCentre = {
  id: 'ev-9:lea12345',
  source: 'perso',
  type: 'devblog-auto',
  evenement: null,
  categorie: 'devblog',
  team: null,
  acteur: null,
  entite: null,
  lien: { vue: 'devblog' },
  cible: { v: 1, g: 'devblog', entree: 'd1' },
  charge: { etat: 'publie', titre: 'v3' },
  lue: false,
  date: new Date().toISOString(),
};

function fauxClientApp(requete: jest.Mock): ClientEsport {
  const compte = { compte: 'lea12345', superAdmin: false, profil: { pseudo: 'Léa', riotId: null, discord: null }, peutCreerTeam: false };
  return {
    config: { adresse: 'https://esport.test', jetonRelais: 'x' },
    ouvrir: async () => compte,
    moi: async () => compte,
    teams: async () => [],
    tableau: async () => ({ genereLe: '', teams: [], global: { resumesARediger: 0, evenementsSemaine: [], alertes: [] } }),
    notifications: async () => ({ nonLues: 0, noms: {}, liste: [] }),
    boiteResumes: async () => ({ teams: [], attente: 0, nouveaux: 0 }),
    requete,
  } as unknown as ClientEsport;
}

function serveurApp(etat: 'ok' | 'supprime' | 'interdit') {
  return jest.fn(async (chemin: string, methode = 'GET', corps?: { cible?: CibleNotification }) => {
    if (chemin === '/notifications/compteur') return { nonLues: 1 };
    if (chemin.startsWith('/notifications/centre') && methode === 'GET') return { liste: [N_CARTE], noms: {}, suite: null, nonLues: 1, categories: [], teams: [] };
    if (chemin === '/notifications/centre/lues') return { nonLues: 0 };
    if (chemin === '/notifications/cible') return etat === 'ok' ? { etat, cible: corps?.cible } : { etat };
    if (chemin === '/devblog/nouveautes') return { entree: null };
    if (chemin.startsWith('/devblog')) return { entrees: [], gestion: false };
    if (/^\/(cm|tickets)\//.test(chemin)) throw new Error('absent');
    return { ok: true };
  });
}

/** Adresse de la page (web) simulée : fragment lu et remplacé par l'app. */
function adresseSimulee(fragment = '') {
  const g = globalThis as unknown as { location?: unknown; history?: unknown };
  const avant = { location: g.location, history: g.history };
  const location = { hash: fragment, href: `https://app.exemple.fr/${fragment}` };
  g.location = location;
  g.history = {
    replaceState: (_e: unknown, _t: string, url: string) => {
      location.href = url;
      location.hash = url.includes('#') ? `#${url.split('#')[1]}` : '';
    },
  };
  return {
    location,
    remettre: () => {
      g.location = avant.location;
      g.history = avant.history;
    },
  };
}

async function monterApp(client: ClientEsport, mode: 'large' | 'telephone' = 'large') {
  fabrique.relais = () => ({ relais: 'https://relais.appdashboard.fr', jeton: `p1.lea12345.${'a'.repeat(64)}` });
  fabrique.client = () => client;
  return render(
    <ModeAffichageForce mode={mode}>
      <Esport contexte={{ profil: { id: 'lea12345', nom: 'Léa', admin: false, creeLe: '', apps: ['esport'] } }} theme={theme} registre={REGISTRE} onRetour={() => undefined} />
    </ModeAffichageForce>,
  );
}

describe('app : ouvrir une notification', () => {
  const relaisReel = fabrique.relais;
  const clientReel = fabrique.client;
  afterEach(() => {
    fabrique.relais = relaisReel;
    fabrique.client = clientReel;
  });

  const ouvrirNotification = async () => {
    const cloche = await screen.findByTestId('esport-cloche', {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.press(cloche);
    });
    const ligne = await screen.findByTestId(`esport-notif-${N_CARTE.id}-ouvrir`, {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.press(ligne);
    });
  };

  it('lien direct : marquée lue, vérifiée par le serveur, écran de l’élément ouvert, adresse partageable tenue à jour', async () => {
    const adresse = adresseSimulee();
    try {
      const requete = serveurApp('ok');
      await monterApp(fauxClientApp(requete));
      await ouvrirNotification();
      expect(requete).toHaveBeenCalledWith('/notifications/centre/lues', 'POST', { ids: [N_CARTE.id] });
      expect(requete).toHaveBeenCalledWith('/notifications/cible', 'POST', { cible: N_CARTE.cible });
      expect(await screen.findByTestId('esport-devblog', {}, { timeout: 5000 })).toBeTruthy();
      expect(screen.queryByTestId('esport-notifications-page')).toBeNull();
      await waitFor(() => expect(adresse.location.hash).toBe('#/app/esport/c/devblog?entree=d1'));
    } finally {
      adresse.remettre();
    }
  });

  it('élément supprimé : « Cet élément n’existe plus », on reste sur les notifications', async () => {
    const requete = serveurApp('supprime');
    await monterApp(fauxClientApp(requete));
    await ouvrirNotification();
    expect(await screen.findByText('Cet élément n’existe plus : il a été supprimé ou archivé.')).toBeTruthy();
    expect(screen.getByTestId('esport-notifications-page')).toBeTruthy();
    expect(requete).toHaveBeenCalledWith('/notifications/centre/lues', 'POST', { ids: [N_CARTE.id] });
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-cible-avis-fermer'));
    });
    expect(screen.queryByTestId('esport-cible-avis')).toBeNull();
  });

  it('accès perdu : « Vous n’avez plus accès à cet élément »', async () => {
    const requete = serveurApp('interdit');
    await monterApp(fauxClientApp(requete), 'telephone');
    await ouvrirNotification();
    expect(await screen.findByText('Vous n’avez plus accès à cet élément.')).toBeTruthy();
    expect(screen.getByTestId('esport-notifications-page')).toBeTruthy();
  });

  it('adresse partageable : un rechargement sur `#/app/esport/c/…` rouvre l’élément', async () => {
    const adresse = adresseSimulee('#/app/esport/c/devblog?entree=d1');
    try {
      const requete = serveurApp('ok');
      await monterApp(fauxClientApp(requete));
      expect(await screen.findByTestId('esport-devblog', {}, { timeout: 5000 })).toBeTruthy();
      expect(requete).toHaveBeenCalledWith('/notifications/cible', 'POST', { cible: { v: 1, g: 'devblog', entree: 'd1' } });
      expect(adresse.location.hash).toBe('#/app/esport/c/devblog?entree=d1');
    } finally {
      adresse.remettre();
    }
  });

  it('adresse partageable : un rechargement sur `#/app/esport/v/…` rouvre l’écran', async () => {
    const adresse = adresseSimulee('#/app/esport/v/notifications');
    try {
      await monterApp(fauxClientApp(serveurApp('ok')), 'telephone');
      expect(await screen.findByTestId('esport-notifications-page', {}, { timeout: 5000 })).toBeTruthy();
      expect(adresse.location.hash).toBe('#/app/esport/v/notifications');
    } finally {
      adresse.remettre();
    }
  });
});

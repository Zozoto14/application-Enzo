/**
 * Esport côté app : périmètre « Esport seulement » dans le hub, modèle de
 * l'Administration, adresse du serveur, client (session, nouvel essai,
 * serveur absent), phrases du journal, barre latérale.
 */

import { ID_ADMINISTRATION, REGISTRE } from '../hub/registre';
import { appsAttribuables, appsVisibles } from '../hub/permissions';
import { pagesVisibles } from '../hub/pages';
import { modeleCorrespondant, niveauxDuModele } from '../hub/admin/niveaux';
import { versAutorisations } from '../hub/admin/comptes';
import type { ContexteHub } from '../hub/types';
import type { Profil } from '../profils/profils';
import { ID_ESPORT, aAccesEsport, perimetreEsportSeul } from './acces';
import { CATALOGUE, ErreurEsport, adresseDepuisRelais, adresseValide, clientEsport, estInactif, lignesMatrice, oublierSessions, trouverConfig } from './client';
import { phraseJournal, phraseNotification } from './libelles';
import { entreesBarre } from './ui/PageTeam';
import { rolesAttribuables } from './ui/MembresRoles';

const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];
const ami = (apps: string[], role?: Profil['role']): Profil => ({ id: 'lea12345', nom: 'Léa', admin: false, creeLe: '2026-10-01', apps, ...(role ? { role } : {}) });

describe('périmètre esport_only dans le hub', () => {
  it('un compte Ami limité à l’Esport ne voit QUE l’Esport (ni Portefeuille, ni Tâches, ni page Administration)', () => {
    const contexte: ContexteHub = { profil: ami([ID_ESPORT]), profils: controle };
    expect(appsVisibles(REGISTRE, contexte).map(a => a.id)).toEqual([ID_ESPORT]);
    expect(pagesVisibles(REGISTRE, contexte)).toEqual(['publique']);
  });

  it('même une liste d’apps retouchée ne lui ouvre pas une app réservée', () => {
    const contexte: ContexteHub = { profil: ami([ID_ESPORT, ID_ADMINISTRATION, 'prospects']), profils: controle };
    expect(appsVisibles(REGISTRE, contexte).map(a => a.id)).toEqual([ID_ESPORT]);
  });

  it('badge « Esport » : Ami dont la seule app est l’Esport ; pas le Fondateur, ni un gestionnaire, ni un ami à plusieurs apps', () => {
    expect(perimetreEsportSeul(ami([ID_ESPORT]))).toBe(true);
    expect(perimetreEsportSeul(ami([ID_ESPORT, 'portefeuille']))).toBe(false);
    expect(perimetreEsportSeul(ami([]))).toBe(false);
    expect(perimetreEsportSeul(ami([ID_ESPORT], 'gestionnaire'))).toBe(false);
    expect(perimetreEsportSeul({ admin: true, apps: [ID_ESPORT] })).toBe(false);
    expect(aAccesEsport(ami([ID_ESPORT]))).toBe(true);
    expect(aAccesEsport(ami(['portefeuille']))).toBe(false);
  });

  it('l’Esport est une app attribuable ; le modèle « Esport seulement » ne l’ouvre qu’elle', () => {
    expect(appsAttribuables(REGISTRE).map(a => a.id)).toContain(ID_ESPORT);
    const apps = appsAttribuables(REGISTRE);
    const niveaux = niveauxDuModele(apps, 'esport');
    expect(Object.entries(niveaux).filter(([, n]) => n !== 'aucun').map(([id]) => id)).toEqual([ID_ESPORT]);
    expect(modeleCorrespondant(apps, niveaux)).toBe('esport');
    expect(versAutorisations(REGISTRE, niveaux).apps).toEqual([ID_ESPORT]);
    // « Ami » (accès complet partout) reste reconnu comme avant.
    expect(modeleCorrespondant(apps, niveauxDuModele(apps, 'ami'))).toBe('ami');
  });
});

describe('adresse du serveur Esport', () => {
  it('déduite du relais (hébergement o2switch : relais.<domaine> → esport.<domaine>)', () => {
    expect(adresseDepuisRelais('https://relais.appdashboard.fr')).toBe('https://esport.appdashboard.fr');
    expect(adresseDepuisRelais('https://relais.appdashboard.fr/')).toBe('https://esport.appdashboard.fr');
    expect(adresseDepuisRelais('https://autre.exemple.fr')).toBeUndefined();
    expect(adresseDepuisRelais('https://RELAIS.AppDashboard.fr/')).toBe('https://esport.appdashboard.fr');
    expect(adresseDepuisRelais('https://relais.appdashboard.fr/chemin')).toBeUndefined();
    expect(adresseDepuisRelais('http://relais.appdashboard.fr')).toBeUndefined();
    expect(adresseDepuisRelais(undefined)).toBeUndefined();
  });

  it('adresses acceptées : https, ou http local seulement', () => {
    expect(adresseValide('https://esport.appdashboard.fr')).toBe(true);
    expect(adresseValide('http://localhost:8790')).toBe(true);
    expect(adresseValide('http://exemple.fr')).toBe(false);
    expect(adresseValide('javascript:alert(1)')).toBe(false);
  });

  it('sans relais relié : pas de configuration (écran « pas encore activé »)', async () => {
    expect(await trouverConfig(undefined, undefined)).toEqual({ raison: 'sans-relais' });
    expect(await trouverConfig({ relais: 'https://autre.exemple.fr', jeton: 'x'.repeat(20) }, undefined)).toEqual({ raison: 'sans-adresse' });
    expect((await trouverConfig({ relais: 'https://relais.appdashboard.fr', jeton: 'p1.lea12345.abc' }, undefined)).config).toEqual({
      adresse: 'https://esport.appdashboard.fr',
      jetonRelais: 'p1.lea12345.abc',
    });
  });
});

type Appel = { url: string; method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer | Uint8Array };
function fauxServeur(reponses: (a: Appel) => { status: number; corps?: unknown; html?: boolean }) {
  const appels: Appel[] = [];
  const requete = async (url: string, init: Omit<Appel, 'url'> = {}) => {
    const a = { url, ...init };
    appels.push(a);
    const r = reponses(a);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.html) throw new Error('pas du JSON');
        return r.corps;
      },
    };
  };
  return { appels, requete };
}

describe('client Esport', () => {
  beforeEach(() => oublierSessions());
  const config = { adresse: 'https://esport.test', jetonRelais: 'p1.lea12345.' + 'a'.repeat(64) };

  it('présente le jeton du relais une seule fois, puis la session courte', async () => {
    const s = fauxServeur(a =>
      a.url.endsWith('/session') ? { status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString() } } : { status: 200, corps: { teams: [] } },
    );
    const c = clientEsport(config, s.requete);
    await c.teams();
    await c.teams();
    expect(s.appels.filter(a => a.url.endsWith('/session'))).toHaveLength(1);
    expect(s.appels[0].headers?.Authorization).toBe(`Bearer ${config.jetonRelais}`);
    expect(s.appels.filter(a => a.url.endsWith('/teams')).every(a => a.headers?.Authorization === 'Bearer es1.x.y')).toBe(true);
  });

  it('phase 7 : adresses du journal (filtres), des exports CSV, des statistiques et des demandes RGPD ; JSON annoncé', async () => {
    const s = fauxServeur(a => (a.url.endsWith('/session') ? { status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString() } } : { status: 200, corps: {} }));
    const c = clientEsport(config, s.requete);
    await c.journal('t1', { module: 'goals_tasks', acteur: 'lea12345', du: '2026-10-01', au: '2026-10-20', avant: '2026-10-19T10:00:00.000Z|abc', limite: 50 });
    await c.exporterJournal('t1', { module: 'coeur' });
    await c.changerRetentionJournal('t1', 90);
    await c.stats('t1', { du: '2026-10-01', au: '2026-10-30' });
    await c.exporterTaches('t1', { filtre: 'miennes' });
    await c.exporterObjectifs('t1');
    await c.exporterCompte('lea12345');
    await c.supprimerCompte('lea12345');
    const urls = s.appels.filter(a => !a.url.endsWith('/session')).map(a => `${a.method ?? 'GET'} ${a.url.replace(config.adresse, '')}`);
    expect(urls).toEqual([
      'GET /teams/t1/journal?module=goals_tasks&acteur=lea12345&du=2026-10-01&au=2026-10-20&avant=2026-10-19T10%3A00%3A00.000Z%7Cabc&limite=50',
      'GET /teams/t1/journal/export.csv?module=coeur&format=json',
      'PUT /teams/t1/journal/reglages',
      'GET /teams/t1/stats?du=2026-10-01&au=2026-10-30',
      'GET /teams/t1/taches/export.csv?filtre=miennes&format=json',
      'GET /teams/t1/objectifs/export.csv?format=json',
      'GET /admin/comptes/lea12345/export',
      'DELETE /admin/comptes/lea12345',
    ]);
    // Le serveur refuse un corps qui n'est pas annoncé JSON : le client l'annonce toujours.
    expect(s.appels.every(a => a.headers?.['Content-Type'] === 'application/json')).toBe(true);
  });

  it('session expirée côté serveur : une nouvelle, une fois', async () => {
    let n = 0;
    const s = fauxServeur(a => {
      if (a.url.endsWith('/session')) return { status: 200, corps: { session: `es1.${++n}.y`, expire: new Date(Date.now() + 3600_000).toISOString() } };
      return a.headers?.Authorization === 'Bearer es1.1.y' ? { status: 401, corps: { erreur: 'Session', code: 'session' } } : { status: 200, corps: { teams: [] } };
    });
    await expect(clientEsport(config, s.requete).teams()).resolves.toEqual([]);
    expect(n).toBe(2);
  });

  it('serveur absent (page HTML de l’hébergeur, ou réseau) : erreur « inactif »', async () => {
    const html = fauxServeur(() => ({ status: 404, html: true }));
    const e1 = await clientEsport(config, html.requete).ouvrir().catch(e => e);
    expect(estInactif(e1)).toBe(true);
    const coupe = clientEsport(config, async () => {
      throw new Error('réseau');
    });
    expect(estInactif(await coupe.ouvrir().catch(e => e))).toBe(true);
    const ancien = fauxServeur(() => ({ status: 503, corps: { erreur: 'Relais à mettre à jour', code: 'relais-ancien' } }));
    expect(estInactif(await clientEsport(config, ancien.requete).ouvrir().catch(e => e))).toBe(true);
  });

  it('refus du serveur : message et code conservés (pas « inactif »)', async () => {
    const s = fauxServeur(a =>
      a.url.endsWith('/session') ? { status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString() } } : { status: 403, corps: { erreur: 'Vous ne pouvez pas.', code: 'escalade' } },
    );
    const e = await clientEsport(config, s.requete).creerRole('t', { nom: 'X', couleur: '#000000', permissions: [] }).catch(x => x);
    expect(e).toBeInstanceOf(ErreurEsport);
    expect(e.code).toBe('escalade');
    expect(e.message).toBe('Vous ne pouvez pas.');
    expect(estInactif(e)).toBe(false);
  });
});

describe('client Esport : surcharge de méthode (frontal o2switch qui bloque PATCH, PUT, DELETE)', () => {
  beforeEach(() => oublierSessions());
  const config = { adresse: 'https://esport.test', jetonRelais: 'p1.lea12345.' + 'a'.repeat(64) };
  const session = (fonctions?: string[]) => ({ status: 200, corps: { session: 'es1.x.y', expire: new Date(Date.now() + 3600_000).toISOString(), ...(fonctions ? { fonctions } : {}) } });

  it('serveur qui annonce « surcharge-methode » : PATCH, PUT et DELETE partent en POST + X-Methode (rôle, tâche, planning, ressource, binaire)', async () => {
    const s = fauxServeur(a => (a.url.endsWith('/session') ? session(['surcharge-methode']) : { status: 200, corps: {} }));
    const c = clientEsport(config, s.requete);
    await c.modifierRole('t1', 'r1', { permissions: ['strats.view'] });
    await c.modifierTache('t1', 'ta1', { titre: 'x' });
    await c.requete('/teams/t1/planning/e1', 'PATCH', { titre: 'y' });
    await c.requete('/teams/t1/ressources/x1', 'DELETE');
    await c.changerModules('t1', {});
    await c.binaire('/teams/t1/medias/m1/morceaux/0', 'PUT', new Uint8Array([1, 2]), { 'X-Sha256': 'abc' });
    await c.teams();
    await c.creerTeam({ nom: 'A' } as never);
    const vus = s.appels.filter(a => !a.url.endsWith('/session')).map(a => `${a.method ?? 'GET'} ${a.headers?.['X-Methode'] ?? '-'} ${a.url.replace(config.adresse, '')}`);
    expect(vus).toEqual([
      'POST PATCH /teams/t1/roles/r1',
      'POST PATCH /teams/t1/taches/ta1',
      'POST PATCH /teams/t1/planning/e1',
      'POST DELETE /teams/t1/ressources/x1',
      'POST PUT /teams/t1/modules',
      'POST PUT /teams/t1/medias/m1/morceaux/0',
      'GET - /teams',
      'POST - /teams',
    ]);
    // Corps et Content-Type inchangés (le serveur garde son contrôle anti-CSRF).
    const role = s.appels.find(a => a.url.endsWith('/roles/r1'))!;
    expect(role.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(role.body as string)).toEqual({ permissions: ['strats.view'] });
    expect(s.appels.find(a => a.url.includes('/morceaux/'))?.headers?.['Content-Type']).toBe('application/octet-stream');
  });

  it('serveur ancien (sans l’annonce) : méthode d’origine, pas d’en-tête X-Methode', async () => {
    const s = fauxServeur(a => (a.url.endsWith('/session') ? session() : { status: 200, corps: {} }));
    await clientEsport(config, s.requete).modifierRole('t1', 'r1', { permissions: [] });
    const role = s.appels.find(a => a.url.endsWith('/roles/r1'))!;
    expect(role.method).toBe('PATCH');
    expect(role.headers?.['X-Methode']).toBeUndefined();
  });

  it('écriture coupée en route alors que le serveur répond : « refus du frontal », pas « injoignable »', async () => {
    const s = fauxServeur(a => {
      if (a.url.endsWith('/session')) return session();
      if (a.url.endsWith('/sante')) return { status: 200, corps: { ok: true } };
      if (a.method === 'PATCH') throw new TypeError('Failed to fetch');
      return { status: 501, html: true };
    });
    const c = clientEsport(config, s.requete);
    const e = await c.modifierRole('t1', 'r1', { permissions: [] }).catch(x => x);
    expect(e).toBeInstanceOf(ErreurEsport);
    expect(e.code).toBe('refuse-frontal');
    expect(estInactif(e)).toBe(false);
    const e2 = await c.requete<unknown>('/teams/t1/ressources/x1', 'DELETE').then(() => undefined, (x: ErreurEsport) => x);
    expect(e2?.code).toBe('refuse-frontal');
    expect(e2?.statut).toBe(501);
    // Vraie panne (le serveur ne répond pas du tout) : toujours « injoignable ».
    oublierSessions();
    const panne = clientEsport(config, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await panne.ouvrir().catch(x => x)).code).toBe('injoignable');
  });
});

describe('libellés', () => {
  const noms = { max12345: 'Max', lea12345: 'Léa' };
  it('journal lisible : « X a changé le rôle de Y de Joueur à Coach »', () => {
    const e = { id: '1', action: 'member.role_changed', acteur: 'max12345', entiteType: 'membre', entiteId: 'm', meta: { compte: 'lea12345', de: 'Joueur', vers: 'Coach' }, date: '2026-10-20T10:00:00Z' };
    expect(phraseJournal(e, noms)).toBe('Max a changé le rôle de Léa de Joueur à Coach');
    expect(phraseJournal({ ...e, action: 'modules.changed', meta: { actives: ['planning'], desactives: ['scouting'] } }, noms)).toBe('Max a activé Planning et désactivé Scouting');
    expect(phraseJournal({ ...e, acteur: 'parti123', action: 'member.left', meta: {} }, noms)).toBe('Un compte supprimé a quitté la team');
    expect(phraseJournal({ ...e, acteur: 'principal', action: 'team.created', meta: {} }, {})).toBe('Le Fondateur a créé la team');
    expect(phraseJournal({ ...e, action: 'role.updated', meta: { nom: 'Coach', ajoutees: ['planning.create'], retirees: ['strats.create'] } }, noms)).toMatch(
      /^Max a modifié les permissions du rôle Coach : ajout de .+ ; retrait de Strats.+Créer$/,
    );
    expect(phraseJournal({ ...e, action: 'role.updated', meta: { nom: 'Capitaine', ajoutees: [], retirees: [] } }, noms)).toBe('Max a modifié le rôle Capitaine');
  });
  it('notifications', () => {
    const n = { id: '1', type: 'membre-arrive', team: { id: 't', nom: 'Faucons' }, charge: { membre: 'lea12345', role: 'Joueur' }, lue: false, date: '' };
    expect(phraseNotification(n, noms)).toBe('Léa a rejoint Faucons (Joueur)');
  });
});

describe('page d’une team', () => {
  const detail = (modules: string[], permissions: string[]) => ({
    team: { id: 't', nom: 'Faucons', slug: 'faucons', jeu: 'valorant', description: '', logoUrl: null, fuseau: 'Europe/Paris', creeLe: '', archivee: false },
    modules: CATALOGUE.modules.map(m => ({ cle: m.cle, active: modules.includes(m.cle) })),
    membres: 3,
    moi: { membreId: 'm', role: { id: 'r', nom: 'Joueur', couleur: '#16a34a', cle: 'joueur' }, permissions, superAdmin: false },
  });

  it('la barre ne montre que les modules activés et ce que le rôle permet (tous les modules sont livrés)', () => {
    const e = entreesBarre(detail(['planning', 'strat_editor', 'activity_log'], ['members.view', 'planning.view', 'strats.view']));
    expect(e.map(x => x.id)).toEqual(['accueil', 'module:planning', 'module:strat_editor', 'membres', 'parametres']);
    // Planning (phase 2) et Strats (phase 6) sont livrés : plus aucun « bientôt ».
    expect(e.some(x => x.bientot)).toBe(false);
    // Strats activé mais sans strats.view : pas d'entrée.
    expect(entreesBarre(detail(['strat_editor'], ['members.view', 'planning.view'])).map(x => x.id)).not.toContain('module:strat_editor');
    // Scouting (phase 5) : livré, mais sans scouting.view (un Joueur), pas d'entrée.
    expect(entreesBarre(detail(['scouting'], ['members.view', 'planning.view'])).map(x => x.id)).not.toContain('module:scouting');
    expect(entreesBarre(detail(['scouting'], ['scouting.view'])).map(x => x.id)).toContain('module:scouting');
    // Module livré mais sans aucune permission pour l'ouvrir : pas d'entrée.
    expect(entreesBarre(detail(['planning', 'attendance'], ['members.view', 'planning.view'])).map(x => x.id)).not.toContain('module:attendance');
    expect(entreesBarre(detail(['planning', 'attendance'], ['planning.view', 'attendance.rsvp_own'])).map(x => x.id)).toContain('module:attendance');
    const manager = entreesBarre(detail(['activity_log'], ['members.view', 'activity_log.view']));
    expect(manager.map(x => x.id)).toEqual(['accueil', 'membres', 'journal', 'parametres']);
    // Journal désactivé : plus d'entrée, même avec la permission.
    expect(entreesBarre(detail([], ['members.view', 'activity_log.view'])).map(x => x.id)).not.toContain('journal');
  });

  it('matrice : seulement le cœur et les modules activés', () => {
    expect(lignesMatrice(['planning']).map(l => l.cle)).toEqual(['team', 'members', 'planning']);
    const membres = lignesMatrice([]).find(l => l.cle === 'members')!;
    expect(membres.colonnes.voir.map(p => p.cle)).toEqual(['members.view', 'membres.trombi.voir']);
    expect(membres.colonnes.special.map(p => p.cle)).toEqual(['members.create', 'roles.manage']);
  });

  it('rôles proposés à l’attribution : jamais au-dessus du sien', () => {
    const r = (id: string, cle: string | null, position: number, permissions: string[]) => ({ id, nom: id, couleur: '#000000', systeme: cle !== null, cle, position, permissions, membres: 0 });
    const roles = [r('proprio', 'proprietaire', 0, ['team.delete']), r('manager', 'manager', 1, ['members.invite', 'team.manage']), r('coach', 'coach', 2, ['strats.create']), r('perso', null, 6, ['members.view'])];
    const d = { ...detail([], ['members.view', 'members.invite', 'team.manage']), moi: { membreId: 'm', role: { id: 'manager', nom: 'Manager', couleur: '#000', cle: 'manager' }, permissions: ['members.view', 'members.invite', 'team.manage'], superAdmin: false } };
    expect(rolesAttribuables(roles, d).map(x => x.id)).toEqual(['manager', 'coach', 'perso']);
  });
});

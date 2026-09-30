import type { Profil } from '../../profils/profils';
import { appsAttribuables, appsVisibles, etatTuile, nombreUtilisateurs } from '../../hub/permissions';
import { REGISTRE } from '../../hub/registre';
import type { ContexteHub } from '../../hub/types';
import { stockageMemoire } from '../moteur/bibliotheque';
import { attenteNulle, fauxReseau, html, json } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import { APP_TSUZUKU, ID_TSUZUKU } from '../registre';
import { lireReglages, REGLAGES_DEFAUT } from './reglages';
import { prochainEpisode } from './LienAnime';
import { lireAnime, lireFilm } from './resoudre';
import { infoTsuzuku, resumerBibliotheque } from './resume';
import { creerServices } from './services';

const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
const ami = (apps: string[]): Profil => ({ id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps, actif: true });
const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];

describe('registre : Tsuzuku', () => {
  it('a l’identifiant tsuzuku, une tuile complète et un écran racine', () => {
    expect(APP_TSUZUKU).toMatchObject({ id: 'tsuzuku', nom: 'Tsuzuku', teinte: 'anime' });
    expect(APP_TSUZUKU.icone.length).toBeGreaterThan(0);
    expect(APP_TSUZUKU.Racine).toBeDefined();
    expect(APP_TSUZUKU.adminSeulement).toBeUndefined();
    expect(REGISTRE.find(a => a.id === ID_TSUZUKU)).toBe(APP_TSUZUKU);
    expect(appsAttribuables(REGISTRE).map(a => a.id)).toContain('tsuzuku');
  });

  it('un ami sans « tsuzuku » ne voit pas la tuile ; avec, il la voit ; l’administrateur la voit toujours', () => {
    const ids = (profil: Profil, extra: Partial<ContexteHub> = {}) => appsVisibles(REGISTRE, { profil, profils: controle, ...extra }).map(a => a.id);
    expect(ids(ami(['portefeuille']))).not.toContain('tsuzuku');
    expect(ids(ami([]))).toEqual([]);
    expect(ids(ami(['tsuzuku']))).toEqual(['tsuzuku']);
    expect(ids(admin)).toContain('tsuzuku');
    expect(appsVisibles(REGISTRE, { profil: undefined }).map(a => a.id)).toContain('tsuzuku');
    expect(nombreUtilisateurs(APP_TSUZUKU, [admin, ami(['tsuzuku']), ami([])])).toBe(2);
  });

  it('respecte la désactivation et la maintenance de la politique globale', () => {
    const avec = (etat: object): ContexteHub => ({ profil: ami(['tsuzuku']), profils: { ...controle, politique: { version: 1, apps: { tsuzuku: etat } } } as never });
    // Désactivée : disparaît pour l'ami, pas pour l'administrateur.
    const off = avec({ active: false, defaut: 'complet' });
    expect(appsVisibles(REGISTRE, off).map(a => a.id)).toEqual([]);
    const politique = { version: 1, apps: { tsuzuku: { active: false, defaut: 'complet' } } };
    expect(appsVisibles(REGISTRE, { profil: admin, profils: { ...controle, politique } as never }).map(a => a.id)).toContain('tsuzuku');
    // Maintenance : visible, mais elle ne s'ouvre plus pour l'ami, et le message est sur la tuile.
    const maintenance = avec({ active: true, defaut: 'complet', maintenance: 'Retour ce soir' });
    expect(appsVisibles(REGISTRE, maintenance).map(a => a.id)).toEqual(['tsuzuku']);
    expect(etatTuile(APP_TSUZUKU, maintenance)).toMatchObject({ ouvrable: false, maintenance: 'Retour ce soir' });
    expect(etatTuile(APP_TSUZUKU, avec({ active: true, defaut: 'complet' }))).toMatchObject({ ouvrable: true, desactivee: false });
  });
});

describe('information en direct de la tuile', () => {
  const entree = (o: object) => ({ id: '1', kind: 'anime', title: 'Frieren', status: 'en_cours', currentEpisode: 4, totalEpisodes: 28, lastWatched: '2026-10-01', ...o });
  const texte = (o: object) => JSON.stringify({ version: 2, anime: [], movies: [], history: [], manualSources: { anime: {}, movies: {} }, ...o });

  it('« Reprendre <titre> · Ép. N » avec le titre le plus récemment regardé', () => {
    const r = resumerBibliotheque(texte({ anime: [entree({}), entree({ id: '2', title: 'Ancien', lastWatched: '2026-09-01', currentEpisode: 9 })] }));
    expect(r?.reprise).toEqual({ titre: 'Frieren', episode: 5, film: false });
    expect(infoTsuzuku(r)?.sousTitre).toBe('Reprendre Frieren · Ép. 5');
    expect(infoTsuzuku(r)?.indicateurs.map(i => i.libelle)).toEqual(['À voir', 'En cours', 'Vus']);
  });

  it('sans reprise : le nombre « à voir » ; sans rien : un texte neutre ; l’épisode ne dépasse pas le total', () => {
    const r = resumerBibliotheque(texte({ anime: [entree({ status: 'a_voir', currentEpisode: 0 }), entree({ id: '3', status: 'a_voir', currentEpisode: 0 })], movies: [{ id: 'tmdb-1', kind: 'movie', title: 'F', status: 'a_voir' }] }));
    expect(r).toMatchObject({ aVoir: 3, enCours: 0 });
    expect(infoTsuzuku(r)?.sousTitre).toBe('3 à voir');
    expect(infoTsuzuku(resumerBibliotheque(''))?.sousTitre).toMatch(/sans serveur/);
    expect(resumerBibliotheque(texte({ anime: [entree({ currentEpisode: 28 })] }))?.reprise?.episode).toBe(28);
    expect(resumerBibliotheque(texte({ movies: [{ id: 'tmdb-2', kind: 'movie', title: 'Dune', status: 'en_cours', lastWatched: '2026-10-02' }] }))?.reprise).toEqual({ titre: 'Dune', episode: null, film: true });
  });

  it('résiste à un contenu illisible ou absent', () => {
    expect(resumerBibliotheque('{oups')).toBeUndefined();
    expect(resumerBibliotheque(undefined)).toBeUndefined();
    expect(infoTsuzuku(undefined)).toBeUndefined();
  });

  it('la tuile du registre lit le résumé du contexte', () => {
    expect(APP_TSUZUKU.info?.({ tsuzuku: { aVoir: 2, enCours: 0, vus: 1 } })?.sousTitre).toBe('2 à voir');
    expect(APP_TSUZUKU.info?.({})).toBeUndefined();
  });
});

describe('réglages', () => {
  it('lit avec tolérance et retombe sur les défauts', () => {
    expect(lireReglages(undefined)).toEqual(REGLAGES_DEFAUT);
    expect(lireReglages('{oups')).toEqual(REGLAGES_DEFAUT);
    expect(lireReglages(JSON.stringify({ cleTmdb: '  abc ', langue: 'klingon', suivantAuto: 'oui', masquerVus: true }))).toEqual({ ...REGLAGES_DEFAUT, cleTmdb: 'abc', masquerVus: true });
  });
});

const choix = (reseau: ReturnType<typeof fauxReseau>, lectureSources = true) => ({ plateforme: (lectureSources ? 'pc' : 'site') as 'pc' | 'site', reseau, lectureSources });
const service = (reseau: ReturnType<typeof fauxReseau>, o: { admin?: boolean; lecture?: boolean; stockage?: ReturnType<typeof stockageMemoire> } = {}) =>
  creerServices({ choix: choix(reseau, o.lecture ?? true), stockage: o.stockage ?? stockageMemoire(), estAdmin: o.admin ?? true, catalogue: { attendre: attenteNulle } });

const SOURCE = {
  id: 'src1',
  name: 'Médiathèque',
  baseUrl: 'https://mediatheque-exemple.fr',
  enabled: true,
  language: 'vostfr',
  search: { path: '/recherche?q={query}', item: 'li.res', title: 'a', link: 'a' },
  episodes: { item: 'li.ep', number: '.n', link: 'a' },
  player: { iframe: 'iframe' },
  movies: { search: { path: '/films?q={query}', item: 'li.film', title: 'a', link: 'a' }, player: { iframe: 'iframe.film' } },
};

describe('sources : réservées à l’administrateur', () => {
  it('vides par défaut', async () => {
    expect(await service(fauxReseau({})).sources()).toEqual([]);
  });

  it('le Fondateur les enregistre dans SA base ; un ami ne peut ni les écrire ni se servir d’une clé « sources » de sa base', async () => {
    const base = stockageMemoire();
    const a = service(fauxReseau({}), { stockage: base });
    await a.enregistrerSources(importerSources([SOURCE]).sources);
    expect(base.contenu.has(CLES.sources)).toBe(true);
    expect((await a.sources())[0]).toMatchObject({ name: 'Médiathèque', enabled: true });

    const baseAmi = stockageMemoire();
    const b = service(fauxReseau({}), { admin: false, stockage: baseAmi });
    await expect(b.enregistrerSources([])).rejects.toMatchObject({ statut: 403 });
    expect(baseAmi.contenu.size).toBe(0);
    // Sa propre clé « sources » (ou l'ancienne copie) est ignorée : seules les sources PARTAGÉES comptent.
    baseAmi.contenu.set(CLES.sources, JSON.stringify([SOURCE]));
    baseAmi.contenu.set(CLES.sourcesAdmin, JSON.stringify([SOURCE]));
    expect(await b.sources()).toEqual([]);
    baseAmi.contenu.set(CLES.sourcesRecues, JSON.stringify({ date: '2026-09-30T10:00:00Z', sources: [SOURCE] }));
    expect((await b.sources()).map(s => s.name)).toEqual(['Médiathèque']);
  });

  it('une source vers une adresse non publique est écartée à la lecture', async () => {
    const base = stockageMemoire({ [CLES.sources]: JSON.stringify([{ ...SOURCE, baseUrl: 'http://192.168.1.10' }]) });
    expect(await service(fauxReseau({}), { stockage: base }).sources()).toEqual([]);
  });
});

describe('du lien au lecteur', () => {
  const fiche = { id: '5114', titres: ['Frieren'], numero: 2 };

  it('un lien manuel (motif {n}) donne le lecteur de l’épisode demandé, sur PC', async () => {
    const reseau = fauxReseau({ 'https://exemple.fr/ep-2': html('<iframe src="https://lecteur-exemple.fr/e/2"></iframe>') });
    const s = service(reseau);
    await s.depot.modifier(db => {
      db.manualSources = { anime: { '5114': { type: 'pattern', pattern: 'https://exemple.fr/ep-{n}', padding: 0, offset: 0, overrides: {}, label: null, createdAt: '', updatedAt: '' } }, movies: {} };
    });
    const l = await lireAnime(s, fiche);
    expect(l.origine).toBe('manuel');
    expect(l.lecteurs).toEqual([expect.objectContaining({ url: 'https://lecteur-exemple.fr/e/2', kind: 'iframe' })]);
  });

  it('sur le site : le lien manuel est affiché tel quel (aucune page lue), avec le message annoncé', async () => {
    const reseau = fauxReseau({});
    const s = service(reseau, { lecture: false });
    await s.depot.modifier(db => {
      db.manualSources = { anime: {}, movies: { 'tmdb-1': { url: 'https://cdn-exemple.fr/film.mp4', kind: 'video', label: 'Mon film', savedAt: '' } } };
    });
    const film = await lireFilm(s, { id: 'tmdb-1', titres: ['Film'] });
    expect(film.lecteurs).toEqual([{ label: 'Mon film - fichier vidéo', url: 'https://cdn-exemple.fr/film.mp4', kind: 'video' }]);
    const sansLien = await lireFilm(s, { id: 'tmdb-2', titres: ['Autre'] });
    expect(sansLien.lecteurs).toEqual([]);
    expect(sansLien.message).toMatch(/app PC\/iPhone/);
    expect(reseau.appels).toEqual([]);
  });

  it('sans source ni lien : message clair, aucune requête vers un site', async () => {
    const reseau = fauxReseau({});
    const l = await lireAnime(service(reseau), fiche);
    expect(l).toMatchObject({ origine: 'aucune', lecteurs: [] });
    expect(l.message).toMatch(/Aucune source/);
    expect(reseau.appels).toEqual([]);
  });

  it('avec une source de l’administrateur : trouve la série, l’épisode puis le lecteur', async () => {
    const reseau = fauxReseau({
      'https://mediatheque-exemple.fr/recherche?q=Frieren': html('<ul><li class="res"><a href="/serie/frieren">Frieren</a></li></ul>'),
      'https://mediatheque-exemple.fr/serie/frieren': html('<ul><li class="ep"><span class="n">1</span><a href="/ep/1">Ép 1</a></li><li class="ep"><span class="n">2</span><a href="/ep/2">Ép 2</a></li></ul>'),
      'https://mediatheque-exemple.fr/ep/2': html('<iframe src="https://lecteur-exemple.fr/e/frieren-2"></iframe>'),
    });
    const s = service(reseau);
    await s.enregistrerSources(importerSources([SOURCE]).sources);
    const l = await lireAnime(s, fiche);
    expect(l.origine).toBe('source');
    expect(l.lecteurs[0].url).toBe('https://lecteur-exemple.fr/e/frieren-2');
  });

  it('un lecteur visant le réseau local est écarté', async () => {
    const reseau = fauxReseau({ 'https://exemple.fr/ep-1': html('<iframe src="http://192.168.1.5/e"></iframe><video src="https://cdn-exemple.fr/v.mp4"></video>') });
    const s = service(reseau);
    await s.depot.modifier(db => {
      db.manualSources = { anime: { '5114': { type: 'pattern', pattern: 'https://exemple.fr/ep-{n}', padding: 0, offset: 0, overrides: {}, label: null, createdAt: '', updatedAt: '' } }, movies: {} };
    });
    const l = await lireAnime(s, { ...fiche, numero: 1 });
    expect(l.lecteurs.map(x => x.url)).toEqual(['https://cdn-exemple.fr/v.mp4']);
  });
});

describe('catalogue', () => {
  it('la clé TMDB (réglages techniques du profil) sert aux films (et elle n’est pas dans l’URL de cache)', async () => {
    const reseau = fauxReseau({ 'https://api.themoviedb.org/3/genre/movie/list': json({ genres: [] }), 'https://api.themoviedb.org/3/search/movie': json({ page: 1, total_pages: 1, results: [{ id: 603, title: 'Matrix', release_date: '1999-03-30', poster_path: '/m.jpg' }] }) });
    const s = service(reseau);
    await s.enregistrerReglagesAvances({ cleTmdb: 'cle-secrete-123', delaiS: 15, tailleMaxMo: 8 });
    const r = await s.catalogue.films.rechercher('Matrix');
    expect(r.source).toBe('tmdb');
    expect(r.items[0].title).toBe('Matrix');
    expect(reseau.urls().some(u => u.includes('api_key=cle-secrete-123'))).toBe(true);
  });
});

describe('épisode suivant', () => {
  const db = (courant: number) => ({ version: 2, anime: [{ id: '1', kind: 'anime', title: 'A', currentEpisode: courant }], movies: [], history: [], manualSources: { anime: {}, movies: {} } }) as never;
  it('suit la progression, et recommence quand tout est vu', () => {
    expect(prochainEpisode(undefined, '1', 12)).toBe(1);
    expect(prochainEpisode(db(0), '1', 12)).toBe(1);
    expect(prochainEpisode(db(4), '1', 12)).toBe(5);
    expect(prochainEpisode(db(12), '1', 12)).toBe(1);
    expect(prochainEpisode(db(1000), '1', null)).toBe(1001);
  });
});

/**
 * Droits sur les sources par rang, partage, réglages techniques (clés d'API).
 * Fixtures neutres : domaines `*-exemple.fr`.
 */

import type { Rang } from '../../hub/admin/roles';
import { stockageMemoire } from '../moteur/bibliotheque';
import { fauxReseau } from '../moteur/outilsTest';
import { importerSources } from '../moteur/sources';
import { CLES } from '../plateforme/stockage';
import {
  beneficiaires,
  lireAvances,
  lireChoix,
  lirePartages,
  masquerCle,
  peutGererSources,
  publicationsParCompte,
  sourcesUtilisables,
  lireRecues,
  type CompteBeneficiaire,
} from './gestion';
import { creerServices } from './services';

const SOURCE_A = { id: 'src-a', name: 'Médiathèque A', baseUrl: 'https://mediatheque-exemple.fr', enabled: true, search: { path: '/r?q={query}', item: 'li', title: 'a', link: 'a' } };
const SOURCE_F = { id: 'src-f', name: 'Films libres', baseUrl: 'https://films-exemple.fr', enabled: true, movies: { search: { path: '/f?q={query}', item: '.film', title: 'h3', link: 'a' }, player: { iframe: 'iframe' } } };
const SOURCES = importerSources([SOURCE_A, SOURCE_F]).sources;

const COMPTES: CompteBeneficiaire[] = [
  { id: 'principal', apps: ['tsuzuku'], actif: true },
  { id: 'amiaaa01', apps: ['tsuzuku', 'portefeuille'], actif: true },
  { id: 'amibbb02', apps: ['tsuzuku'], actif: true },
  { id: 'amiccc03', apps: ['portefeuille'], actif: true },
  { id: 'amiddd04', apps: ['tsuzuku'], actif: false },
];

const services = (rang: Rang, stockage = stockageMemoire()) =>
  creerServices({ choix: { plateforme: 'pc', reseau: fauxReseau({}), lectureSources: true }, stockage, rang });

describe('droits sur les sources, par rang', () => {
  it('seul le Fondateur est habilité (option la plus protectrice) ; jamais Gestionnaire ni Ami', () => {
    expect(peutGererSources('fondateur')).toBe(true);
    expect(peutGererSources('administrateur')).toBe(false);
    expect(peutGererSources('gestionnaire')).toBe(false);
    expect(peutGererSources('ami')).toBe(false);
    expect(peutGererSources(undefined)).toBe(false);
  });

  it.each(['administrateur', 'gestionnaire', 'ami'] as const)('%s : ajouter, modifier, supprimer, partager, régler les clés = 403, rien n’est écrit', async rang => {
    const stockage = stockageMemoire();
    const s = services(rang, stockage);
    expect(s.estAdmin).toBe(false);
    await expect(s.enregistrerSources(SOURCES)).rejects.toMatchObject({ statut: 403 });
    await expect(s.enregistrerSources([])).rejects.toMatchObject({ statut: 403 });
    await expect(s.enregistrerPartages({ 'src-a': { mode: 'tous', comptes: [] } })).rejects.toMatchObject({ statut: 403 });
    await expect(s.enregistrerReglagesAvances({ cleTmdb: 'x', delaiS: 15, tailleMaxMo: 8 })).rejects.toMatchObject({ statut: 403 });
    await expect(s.reglagesAvances()).rejects.toMatchObject({ statut: 403 });
    expect(stockage.contenu.size).toBe(0);
    expect(await s.partages()).toEqual({});
    expect(await s.sourcesPropres()).toEqual([]);
  });

  it('le Fondateur ajoute, partage, supprime ; la suppression retire aussi le partage', async () => {
    const stockage = stockageMemoire();
    const s = services('fondateur', stockage);
    await s.enregistrerSources(SOURCES);
    await s.enregistrerPartages({ 'src-a': { mode: 'selection', comptes: ['amiaaa01'] }, 'src-f': { mode: 'tous', comptes: [] }, fantome: { mode: 'tous', comptes: [] } });
    expect(Object.keys(await s.partages()).sort()).toEqual(['src-a', 'src-f']);
    await s.enregistrerSources(SOURCES.filter(x => x.id !== 'src-a'));
    expect(Object.keys(await s.partages())).toEqual(['src-f']);
  });
});

describe('partage : qui reçoit quoi', () => {
  it('« tous » = comptes actifs autorisés à Tsuzuku, jamais le compte historique ; « sélection » ∩ autorisés ; défaut : personne', () => {
    expect(beneficiaires({ mode: 'tous', comptes: [] }, COMPTES)).toEqual(['amiaaa01', 'amibbb02']);
    expect(beneficiaires({ mode: 'selection', comptes: ['amiaaa01', 'amiccc03', 'amiddd04'] }, COMPTES)).toEqual(['amiaaa01']);
    expect(beneficiaires({ mode: 'personne', comptes: ['amiaaa01'] }, COMPTES)).toEqual([]);
  });

  it('isolation : chaque compte ne reçoit que SES sources, sans liste de bénéficiaires ni autre compte', () => {
    const pub = publicationsParCompte(SOURCES, { 'src-a': { mode: 'selection', comptes: ['amiaaa01'] }, 'src-f': { mode: 'tous', comptes: [] } }, COMPTES);
    expect(pub.amiaaa01.map(s => s.id)).toEqual(['src-a', 'src-f']);
    expect(pub.amibbb02.map(s => s.id)).toEqual(['src-f']);
    expect(pub.amiccc03).toEqual([]);
    expect(pub.amiddd04).toEqual([]);
    expect(pub.principal).toBeUndefined();
    const texte = JSON.stringify(pub.amibbb02);
    expect(texte).not.toMatch(/amiaaa01|amiccc03|principal|selection|comptes/);
  });

  it('une source désactivée par le Fondateur n’est plus publiée (retrait)', () => {
    const pub = publicationsParCompte(SOURCES.map(s => ({ ...s, enabled: s.id !== 'src-f' })), { 'src-f': { mode: 'tous', comptes: [] } }, COMPTES);
    expect(pub.amibbb02).toEqual([]);
  });

  it('lecture tolérante des partages : identifiants invalides et principal écartés', () => {
    expect(lirePartages('{oups')).toEqual({});
    expect(lirePartages(JSON.stringify({ x: { mode: 'hack', comptes: ['principal', '../x', 'amiaaa01', 'amiaaa01'] } }))).toEqual({ x: { mode: 'personne', comptes: ['amiaaa01'] } });
  });
});

describe('côté bénéficiaire : sources partagées en lecture seule, activées pour soi', () => {
  it('l’ami voit nom, type et état ; il active/désactive pour lui seul, sans rien modifier', async () => {
    const stockage = stockageMemoire({ [CLES.sourcesRecues]: JSON.stringify({ date: '2026-09-30T10:00:00Z', sources: SOURCES }) });
    const s = services('ami', stockage);
    expect(await s.sourcesPartagees()).toEqual([
      { id: 'src-a', nom: 'Médiathèque A', animes: true, films: false, langue: 'indifferent', actif: true },
      { id: 'src-f', nom: 'Films libres', animes: false, films: true, langue: 'indifferent', actif: true },
    ]);
    await s.choisirSourcePartagee('src-a', false);
    await s.choisirSourcePartagee('inconnue', false);
    expect(lireChoix(stockage.contenu.get(CLES.choixSources))).toEqual({ 'src-a': false });
    expect((await s.sources()).map(x => [x.id, x.enabled])).toEqual([['src-a', false], ['src-f', true]]);
    // La copie reçue n'a pas changé.
    expect(lireRecues(stockage.contenu.get(CLES.sourcesRecues)).sources.every(x => x.enabled)).toBe(true);
  });

  it('un Fondateur garde ses sources ; une source reçue au même identifiant est ignorée', () => {
    const recues = lireRecues(JSON.stringify({ date: 'd', sources: [{ ...SOURCE_A, name: 'Autre' }] }));
    expect(sourcesUtilisables(SOURCES, recues, {}).map(s => s.name)).toEqual(['Médiathèque A', 'Films libres']);
  });

  it('une copie reçue illisible ou visant le réseau local est écartée', () => {
    expect(lireRecues('{oups').sources).toEqual([]);
    expect(lireRecues(JSON.stringify({ sources: [{ ...SOURCE_A, baseUrl: 'http://192.168.1.2' }] })).sources).toEqual([]);
  });
});

describe('clés d’API et options avancées', () => {
  it('jamais réaffichées en entier après saisie', () => {
    expect(masquerCle('')).toBe('');
    expect(masquerCle('court')).toBe('••••••••');
    const cle = 'cle-tmdb-tres-secrete-0123456789';
    expect(masquerCle(cle)).toBe('••••••••6789');
    expect(masquerCle(cle)).not.toContain('secrete');
  });

  it('reprend l’ancienne clé des réglages de confort, borne les options', () => {
    expect(lireAvances(undefined, 'ancienne')).toEqual({ cleTmdb: 'ancienne', delaiS: 15, tailleMaxMo: 8 });
    expect(lireAvances(JSON.stringify({ cleTmdb: 'nouvelle', delaiS: 900, tailleMaxMo: 0 }), 'ancienne')).toEqual({ cleTmdb: 'nouvelle', delaiS: 60, tailleMaxMo: 1 });
  });

  it('le Fondateur enregistre la clé dans SA base ; l’ancienne place est vidée', async () => {
    const stockage = stockageMemoire({ [CLES.reglages]: JSON.stringify({ cleTmdb: 'ancienne', langue: 'vf' }) });
    const s = services('fondateur', stockage);
    await s.enregistrerReglagesAvances({ cleTmdb: 'nouvelle-cle', delaiS: 20, tailleMaxMo: 4 });
    expect(await s.reglagesAvances()).toEqual({ cleTmdb: 'nouvelle-cle', delaiS: 20, tailleMaxMo: 4 });
    expect(stockage.contenu.get(CLES.reglages)).not.toContain('ancienne');
    expect(JSON.parse(stockage.contenu.get(CLES.reglages)!).langue).toBe('vf');
    // Les réglages de confort ne réécrivent pas la clé.
    await s.enregistrerReglages({ ...(await s.reglages()), cleTmdb: 'pirate', langue: 'vostfr' });
    expect(stockage.contenu.get(CLES.reglages)).not.toContain('pirate');
  });
});

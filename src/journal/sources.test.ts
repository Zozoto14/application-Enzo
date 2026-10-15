/**
 * Sources d'événements remplies côté hôte par chaque app (contrat du hub) :
 * lecture des données locales, confidentialité par rang, boîte des apps sans source.
 */

import { Decimal } from '../core/money/decimal';
import type { Titre, Transaction } from '../core/domain/types';
import { creerLecteurPortefeuille, SOURCE_PORTEFEUILLE } from '../app/sourceJournalPortefeuille';
import { evenementsOffice, SOURCE_OFFICE } from '../claudeOffice/sourceJournal';
import type { EntreeHistorique } from '../claudeOffice/logiqueHistorique';
import { donneesVides as donneesAdminVides, ecrireDonnees, CLE_DONNEES } from '../hub/admin/donnees';
import { SOURCE_ABONNEMENTS } from '../hub/abonnements/sourceJournal';
import { marquerPaye, compteVide, REGLAGES_ABO_DEFAUT } from '../hub/abonnements/abonnements';
import { deposerEvenementJournal, lireBoite, evenementValide, MAX_PAR_MOIS } from '../hub/journal/boite';
import type { ContexteHub } from '../hub/types';
import type { Profil } from '../profils/profils';
import { enregistrerProspect, noterContact, saisieVide } from '../prospects/prospects';
import { SOURCE_PROSPECTS } from '../prospects/sourceJournal';
import { creerEspace, creerProjet, creerTache, donneesVides, modifierTache } from '../taches/modele';
import { CLES_TACHES } from '../taches/partage';
import { SOURCE_TACHES } from '../taches/sourceJournal';
import { CLES as CLES_TSUZUKU } from '../tsuzuku/plateforme/stockage';
import { SOURCE_TSUZUKU } from '../tsuzuku/app/sourceJournal';
import { SOURCES_JOURNAL, SOURCE_BOITE_JOURNAL } from './sources';
import { baseMemoire } from './__fixtures__/outils';
import { lireSources } from './moteur';

const local = (jour: string, h: number, m = 0) => new Date(`${jour}T00:00:00`).getTime() + (h * 60 + m) * 60_000;
const J = '2026-10-13';
const fondateur: Profil = { id: 'principal', nom: 'Enzo', admin: true, creeLe: '2026-01-01' };
const lea: Profil = { id: 'leaami01', nom: 'Léa', admin: false, creeLe: '2026-01-01', apps: ['journal', 'taches'] };
const admin = (m = new Map<string, string>()) => ({ m, stockage: { lire: (c: string) => m.get(c), ecrire: (c: string, v: string) => void m.set(c, v) }, verifierIdentite: () => undefined, etatCoffre: () => undefined });

describe('source Tâches', () => {
  const ctx = (t: number) => ({ maintenant: t, auteur: 'fondateur' as const, alea: () => 0.5 });
  function donnees() {
    let d = donneesVides();
    const e = creerEspace(d, 'Perso', ctx(local('2026-10-01', 9)));
    d = e.donnees;
    const p = creerProjet(d, e.espace.id, 'Clients', ctx(local('2026-10-01', 9)));
    d = p.donnees;
    // Créée hier, terminée aujourd'hui.
    let r = creerTache(d, { titre: 'Relire le contrat', listeId: p.liste.id }, ctx(local('2026-10-12', 10)));
    d = modifierTache(r.donnees, r.tache.id, { statut: 'fait' }, ctx(local(J, 9, 30)));
    // Créée et laissée ouverte aujourd'hui.
    r = creerTache(d, { titre: 'Préparer la réunion', listeId: p.liste.id }, ctx(local(J, 15)));
    d = r.donnees;
    // Créée par une app reliée : ce n'est pas une création de l'utilisateur.
    r = creerTache(d, { titre: 'Relancer Zoé', listeId: p.liste.id, source: { app: 'prospects', cle: 'p1' } }, ctx(local(J, 16)));
    d = r.donnees;
    // Créée aujourd'hui puis supprimée.
    r = creerTache(d, { titre: 'Brouillon', listeId: p.liste.id }, ctx(local(J, 17)));
    return modifierTache(r.donnees, r.tache.id, { supprime: true }, ctx(local(J, 17, 5)));
  }

  it('rend les tâches terminées et créées ce jour-là, avec leur projet et leur heure', async () => {
    const b = baseMemoire({ [CLES_TACHES.donnees]: JSON.stringify(donnees()) });
    const l = await lireSources(J, [SOURCE_TACHES], { profil: fondateur, admin: admin(), baseProfil: b });
    const par = Object.fromEntries(l.evenements.map(e => [e.titre, e]));
    expect(par['Relire le contrat']).toMatchObject({ genre: 'tache-terminee', heure: '09:30', groupe: 'Clients', famille: 'taches' });
    expect(par['Préparer la réunion']).toMatchObject({ genre: 'tache-creee', heure: '15:00' });
    expect(Object.keys(par)).toHaveLength(2);
  });

  it('jours voisins : la tâche terminée aujourd’hui n’apparaît pas hier ; sa création, si', async () => {
    const b = baseMemoire({ [CLES_TACHES.donnees]: JSON.stringify(donnees()) });
    const l = await lireSources('2026-10-12', [SOURCE_TACHES], { profil: fondateur, admin: admin(), baseProfil: b });
    expect(l.evenements.map(e => [e.titre, e.genre])).toEqual([['Relire le contrat', 'tache-creee']]);
  });

  it('un compte sans accès à Tâches ne rend rien', async () => {
    const b = baseMemoire({ [CLES_TACHES.donnees]: JSON.stringify(donnees()) });
    const l = await lireSources(J, [SOURCE_TACHES], { profil: { ...lea, apps: ['journal'] }, baseProfil: b });
    expect(l.evenements).toEqual([]);
  });
});

describe('source Tsuzuku', () => {
  const biblio = (history: unknown[]) => JSON.stringify({ version: 2, anime: [], movies: [], history, manualSources: {} });
  const h = (animeId: string, title: string, episode: number, quand: string, kind = 'anime') => ({ kind, animeId, title, image: null, episode, watchedAt: new Date(quand).toISOString() });

  it('rend les épisodes et films vus ce jour-là (heure locale)', async () => {
    const b = baseMemoire({ [CLES_TSUZUKU.bibliotheque]: biblio([h('a1', 'Aventure du Phare', 4, `${J}T21:00:00`), h('a1', 'Aventure du Phare', 5, `${J}T21:30:00`), h('m1', 'Film exemple', 1, `${J}T22:10:00`, 'movie'), h('a1', 'Aventure du Phare', 3, '2026-10-12T21:00:00')]) });
    const l = await lireSources(J, [SOURCE_TSUZUKU], { baseProfil: b });
    expect(l.evenements.map(e => [e.titre, e.nombre, e.heure])).toEqual([
      ['Aventure du Phare', 4, '21:00'],
      ['Aventure du Phare', 5, '21:30'],
      ['Film exemple', undefined, '22:10'],
    ]);
    expect(l.evenements.every(e => e.genre === 'episode-vu' && e.famille === 'tsuzuku')).toBe(true);
  });

  it('bibliothèque absente ou illisible : rien, sans erreur', async () => {
    expect((await lireSources(J, [SOURCE_TSUZUKU], { baseProfil: baseMemoire() })).evenements).toEqual([]);
    const l = await lireSources(J, [SOURCE_TSUZUKU], { baseProfil: baseMemoire({ [CLES_TSUZUKU.bibliotheque]: '{pas du json' }) });
    expect(l.evenements).toEqual([]);
    expect(l.enEchec).toEqual([]);
  });
});

describe('source Claude Office', () => {
  const e = (id: string, quand: string, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({ v: 1, id, ts: new Date(quand).toISOString(), type: 'outil', session: 's1', appareil: 'PC', projet: 'application-exemple', ...extra });
  const entrees: EntreeHistorique[] = [
    e('1', `${J}T14:00:00`, { type: 'debut-session' }),
    e('2', `${J}T14:01:00`, { type: 'demande', texte: 'Ajoute le journal automatique, clé sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }),
    e('3', `${J}T14:20:00`, { type: 'outil', outil: 'Edit' }),
    e('4', `${J}T14:21:00`, { type: 'demande', texte: 'Ajoute les tests' }),
    e('5', `${J}T14:40:00`, { type: 'fin-session' }),
    // Session sans fin, silencieuse depuis plus d'une heure : tenue pour terminée.
    e('6', `${J}T09:00:00`, { session: 's2', type: 'demande', texte: 'Corrige le bug du calendrier' }),
    e('7', `${J}T09:10:00`, { session: 's2' }),
    // Session encore active (dernière trace il y a 5 min) : pas terminée.
    e('8', `${J}T22:55:00`, { session: 's3', type: 'demande', texte: 'En cours' }),
    // Autre jour.
    e('9', '2026-10-12T10:00:00', { session: 's4', type: 'fin-session' }),
  ];

  it('rend les sessions terminées du jour : projet, dernière demande, durée active, nombre de demandes', () => {
    const evts = evenementsOffice(J, entrees, local(J, 23, 0));
    expect(evts).toHaveLength(2);
    const s1 = evts.find(x => x.id.endsWith('s1'))!;
    expect(s1).toMatchObject({ genre: 'session-office', groupe: 'application-exemple', titre: 'Ajoute les tests', detail: '2 demandes', heure: '14:40' });
    // 1 min + 19 min + 1 min + 19 min de traces rapprochées (5 min max entre deux traces pour compter) : la durée reste bornée.
    expect(s1.nombre).toBeGreaterThanOrEqual(1);
    expect(evts.find(x => x.id.endsWith('s2'))?.titre).toBe('Corrige le bug du calendrier');
    expect(evts.some(x => x.id.endsWith('s3'))).toBe(false);
  });

  it('masque les secrets avant de les ranger dans le journal', () => {
    const evts = evenementsOffice(J, [entrees[0], entrees[1], entrees[4]], local(J, 23, 0));
    expect(evts[0].titre).not.toContain('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  });

  it('lit les copies chiffrées du relais déjà présentes (lecture seule), pour le Fondateur seulement', async () => {
    const lireTout = jest.fn(async () => ({ entrees, copies: [], erreurs: [] }));
    const historiqueOffice = { lireTout } as unknown as ContexteHub['historiqueOffice'];
    const contexte: ContexteHub = { profil: fondateur, baseProfil: baseMemoire({ 'claude-office.historique.synchro': JSON.stringify({ active: true }) }), historiqueOffice, maintenant: local(J, 23, 0) };
    const l = await lireSources(J, [SOURCE_OFFICE], contexte);
    expect(l.evenements).toHaveLength(2);
    expect(lireTout).toHaveBeenCalledTimes(1);
    const ami = await lireSources(J, [SOURCE_OFFICE], { ...contexte, profil: lea });
    expect(ami.evenements).toEqual([]);
  });

  it('relais injoignable : la page se fait sans Claude Office, sans erreur', async () => {
    const historiqueOffice = { lireTout: async () => { throw new Error('hors ligne'); } } as unknown as ContexteHub['historiqueOffice'];
    const l = await lireSources(J, [SOURCE_OFFICE], { profil: fondateur, baseProfil: baseMemoire(), historiqueOffice });
    expect(l.evenements).toEqual([]);
  });
});

describe('sources réservées au Fondateur : Prospects et Abonnements', () => {
  function donneesAdmin() {
    const d = donneesAdminVides();
    let carnet = d.prospects;
    const r = enregistrerProspect(carnet, { ...saisieVide(), nom: 'Zoé Durand', entreprise: 'Studio exemple', email: 'zoe@studio-exemple.fr' }, local('2026-10-01', 9), undefined, () => 0.3);
    carnet = r.donnees;
    carnet = { ...carnet, prospects: { ...carnet.prospects, [r.prospect.id]: noterContact(r.prospect, { date: J, note: 'Relance par message' }, 'cont0001') } };
    const compte = marquerPaye({ ...compteVide(REGLAGES_ABO_DEFAUT, '2026-10-01T00:00:00.000Z'), montant: 4500, echeance: J }, { date: J, moyen: 'virement', id: 'pay1' }, '2026-10-13T10:00:00.000Z');
    return { ...d, prospects: carnet, abonnements: { reglages: REGLAGES_ABO_DEFAUT, comptes: { leaami01: compte } } };
  }
  const profils = [fondateur, lea];
  const services = () => admin(new Map([[CLE_DONNEES, ecrireDonnees(donneesAdmin())]]));

  it('le Fondateur obtient les relances et les paiements du jour, sans adresse e-mail', async () => {
    const ctx: ContexteHub = { profil: fondateur, admin: services(), profils: { tous: profils } as unknown as ContexteHub['profils'] };
    const l = await lireSources(J, [SOURCE_PROSPECTS, SOURCE_ABONNEMENTS], ctx);
    const pr = l.evenements.find(e => e.genre === 'relance-prospect')!;
    const ab = l.evenements.find(e => e.genre === 'paiement-abonnement')!;
    expect(pr.titre).toBe('Zoé Durand (Studio exemple)');
    expect(JSON.stringify(l.evenements)).not.toContain('zoe@studio-exemple.fr');
    expect(ab).toMatchObject({ titre: 'Léa', montant: 45 });
  });

  it('un ami n’obtient jamais ces données, même avec le journal et les services en main', async () => {
    const ctx: ContexteHub = { profil: lea, admin: services(), profils: { tous: profils } as unknown as ContexteHub['profils'] };
    const l = await lireSources(J, [SOURCE_PROSPECTS, SOURCE_ABONNEMENTS], ctx);
    expect(l.evenements).toEqual([]);
    expect((await lireSources(J, [SOURCE_PROSPECTS, SOURCE_ABONNEMENTS], { profil: lea })).evenements).toEqual([]);
  });
});

describe('source Portefeuille', () => {
  const titre = (id: string, nom: string): Titre => ({ id, isin: 'FR0000000000', nom, ticker: 'XX', deviseCotation: 'EUR', eligiblePEA: true });
  const tr = (t: Partial<Transaction> & { id: string; type: Transaction['type'] }): Transaction => ({ compteId: 'c1', date: J, devise: 'EUR', ...t }) as Transaction;
  const entrees = {
    titres: [titre('t1', 'ETF Monde exemple')],
    comptes: [{ id: 'c1', nom: 'PEA exemple' }],
    transactions: [
      tr({ id: 'a1', type: 'ACHAT', titreId: 't1', quantite: Decimal.de('10'), prixUnitaire: Decimal.de('123.45'), frais: Decimal.de('0') } as never),
      tr({ id: 'v1', type: 'VERSEMENT', montant: Decimal.de('500') } as never),
      tr({ id: 'x1', type: 'VENTE', date: '2026-10-12', titreId: 't1', quantite: Decimal.de('1'), prixUnitaire: Decimal.de('100'), frais: Decimal.de('0') } as never),
    ],
    points: [
      { date: '2026-10-12', valeurTotale: Decimal.de('10000'), fluxExterne: Decimal.de('0') },
      { date: J, valeurTotale: Decimal.de('10625'), fluxExterne: Decimal.de('500') },
    ],
  };

  it('opérations du jour avec le nom du titre, et variation hors versements', () => {
    const l = creerLecteurPortefeuille(entrees);
    expect(l.operations(J)).toEqual([
      { id: 'a1', type: 'ACHAT', libelle: 'ETF Monde exemple', quantite: 10, montant: 1234.5 },
      { id: 'v1', type: 'VERSEMENT', libelle: 'PEA exemple', montant: 500 },
    ]);
    // (10 625 − 500 − 10 000) / 10 000 = 1,25 %.
    expect(l.variation(J)).toEqual({ pourcentage: 1.25, montant: 125 });
    expect(l.variation('2026-10-12')).toBeUndefined();
    expect(l.variation('2026-10-10')).toBeUndefined();
  });

  it('la source rend des événements bruts (jamais masqués) et rien sans lecteur', async () => {
    const contexte: ContexteHub = { journalPortefeuille: creerLecteurPortefeuille(entrees) };
    const l = await lireSources(J, [SOURCE_PORTEFEUILLE], contexte);
    expect(l.evenements.find(e => e.id === 'a1')).toMatchObject({ genre: 'operation-bourse', groupe: 'ACHAT', titre: 'ETF Monde exemple', nombre: 10, montant: 1234.5 });
    expect(l.evenements.find(e => e.genre === 'variation-portefeuille')).toMatchObject({ pourcentage: 1.25, montant: 125 });
    expect((await lireSources(J, [SOURCE_PORTEFEUILLE], {})).evenements).toEqual([]);
  });
});

describe('boîte du journal (apps sans source : coach de décisions, météo…)', () => {
  it('une app dépose un événement, le journal le retrouve ce jour-là', async () => {
    const b = baseMemoire();
    expect(deposerEvenementJournal(b, { id: 'dec-1', famille: 'decisions', genre: 'decision', jour: J, heure: '17:00', titre: 'Garder le plan d’épargne', poids: 80 })).toBe(true);
    expect(deposerEvenementJournal(b, { id: 'meteo', famille: 'meteo', genre: 'meteo', jour: J, titre: 'Ensoleillé, 19 °C' })).toBe(true);
    expect(deposerEvenementJournal(b, { id: 'dec-0', famille: 'decisions', genre: 'decision', jour: '2026-10-12', titre: 'Hier' })).toBe(true);
    expect(lireBoite(b, J).map(e => e.id).sort()).toEqual(['dec-1', 'meteo']);
    const l = await lireSources(J, [SOURCE_BOITE_JOURNAL], { baseProfil: b });
    expect(l.evenements.find(e => e.id === 'dec-1')).toMatchObject({ famille: 'decisions', genre: 'decision', poids: 80, source: 'boite' });
    expect(l.evenements.find(e => e.genre === 'meteo')?.famille).toBe('meteo');
  });

  it('redéposer le même identifiant remplace, sans doublon ; les mois sont séparés', () => {
    const b = baseMemoire();
    for (const titre of ['v1', 'v2']) deposerEvenementJournal(b, { id: 'dec-1', famille: 'decisions', genre: 'decision', jour: J, titre });
    deposerEvenementJournal(b, { id: 'dec-2', famille: 'decisions', genre: 'decision', jour: '2026-11-02', titre: 'Novembre' });
    expect(lireBoite(b, J)).toHaveLength(1);
    expect(lireBoite(b, J)[0].titre).toBe('v2');
    expect([...b.m.keys()].sort()).toEqual(['journal.boite.2026-10', 'journal.boite.2026-11']);
  });

  it('refuse un événement invalide et borne la boîte', () => {
    const b = baseMemoire();
    expect(deposerEvenementJournal(b, { id: '', famille: 'autre', genre: 'autre', jour: J, titre: 'x' })).toBe(false);
    expect(deposerEvenementJournal(b, { id: 'a', famille: 'autre', genre: 'autre', jour: 'demain', titre: 'x' })).toBe(false);
    expect(deposerEvenementJournal(undefined, { id: 'a', famille: 'autre', genre: 'autre', jour: J, titre: 'x' })).toBe(false);
    expect(evenementValide({ id: 'a', jour: J, titre: 'ok', famille: 'inconnue', genre: 'bizarre', poids: 500 })).toMatchObject({ famille: 'autre', genre: 'autre', poids: 100 });
    for (let i = 0; i < MAX_PAR_MOIS + 20; i++) deposerEvenementJournal(b, { id: `e${i}`, famille: 'autre', genre: 'autre', jour: J, titre: `E${i}` });
    expect(lireBoite(b, J)).toHaveLength(MAX_PAR_MOIS);
  });
});

describe('liste des sources', () => {
  it('toutes les apps sont branchées, chaque source a un identifiant unique', () => {
    expect(SOURCES_JOURNAL.map(s => s.id)).toEqual(['taches', 'claude-office', 'tsuzuku', 'portefeuille', 'abonnements', 'prospects', 'boite']);
    expect(new Set(SOURCES_JOURNAL.map(s => s.id)).size).toBe(SOURCES_JOURNAL.length);
  });
});

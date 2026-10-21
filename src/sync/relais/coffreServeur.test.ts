/**
 * Coffre serveur (relais version 9) : le serveur est la référence. Tests contre le VRAI relais en
 * mémoire : premier lancement d'un appareil à jour (migration), navigateur neuf, modification
 * visible ailleurs sans liaison, conflit sans perte, hors ligne puis retour du réseau, anciens
 * appareils (dépôts `/boite`), compte d'ami, données des apps (journal, notes).
 */
import { achat, compte, titre, versement } from '../../core/testing/fixtures';
import { DepotComptes, DepotParametres, DepotTitres, DepotTransactions, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { deposerEvenementJournal } from '../../hub/journal/boite';
import { lirePage, modifierPage } from '../../journal/modele';
import { deriverCleSynchro } from './chiffrement';
import { historiqueServeur, idEnregistrement, oublierCapacites, relaisAvecCoffre, synchroniserServeur } from './coffreServeur';
import { ecrireConfigRelais, lireEtatSynchro, synchroniser } from './synchroniser';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from './__fixtures__/relaisV9';

const KDF_RAPIDE = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };
const CLE = deriverCleSynchro('cle-du-compte', 'x', KDF_RAPIDE);
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };

let horloge = Date.parse('2026-10-20T10:00:00Z');
const maintenant = () => new Date((horloge += 60_000));

function appareil(): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  return pilote;
}

const tour = (relais: RelaisV9, pilote: PiloteSqlite, o: { compte?: string; liaison?: { relais: string; jeton: string }; cle?: string; appareil?: string } = {}) =>
  synchroniserServeur({ pilote, liaison: o.liaison ?? MAITRE, cle: o.cle ?? CLE, compte: o.compte ?? 'principal', appareil: o.appareil, maintenant, requete: relais.requete });

const valeurs = (relais: RelaisV9) => {
  const store = relais.env.COFFRES as { lire(p: string, d: number, l: number): Promise<{ enregistrements: Array<{ valeur: string }> }> };
  return store.lire('principal', 0, 10_000).then(r => r.enregistrements.map(e => e.valeur).join('\n'));
};

describe('coffre serveur : le serveur est la référence', () => {
  let relais: RelaisV9;
  beforeEach(() => {
    relais = relaisV9();
    oublierCapacites();
  });

  it('le PC migre ses données ; un navigateur neuf les retrouve toutes (portefeuille, thème, journal, notes) sans liaison', async () => {
    const pc = appareil();
    new DepotComptes(pc).enregistrer(compte());
    new DepotTitres(pc).enregistrer(titre());
    new DepotTransactions(pc).enregistrer(versement('2026-01-02', 1000));
    new DepotTransactions(pc).enregistrer(achat('2026-01-03', 2, 150));
    const p = new DepotParametres(pc);
    p.ecrire('hub.theme', 'sauge');
    p.ecrire('claude-office.notes', JSON.stringify({ a: 'note du PC' }));
    p.ecrire(PARAMETRES.identifiantAppareil, 'pc000001');
    const base = { lire: (c: string) => p.lire(c), ecrire: (c: string, v: string) => p.ecrire(c, v) };
    modifierPage(base, '2026-10-19', { note: 'Belle journée' }, horloge);
    deposerEvenementJournal(base, { id: 'e1', famille: 'autre', genre: 'autre', jour: '2026-10-19', titre: 'Décision du coach' });

    expect(await relaisAvecCoffre(MAITRE, relais.requete)).toBe(true);
    const r1 = await tour(relais, pc);
    expect(r1.envoyes).toBeGreaterThan(5);
    expect(r1.enAttente).toBe(0);
    // Le serveur ne lit rien : ni nom de compte, ni note, ni thème en clair.
    const brut = await valeurs(relais);
    for (const secret of ['PEA Boursobank', 'Belle journée', 'note du PC', 'sauge', 'Décision du coach', 'hub.theme']) expect(brut).not.toContain(secret);
    // Ni l'identifiant d'appareil (propre au PC).
    expect(r1.envoyes).toBe(Object.keys(lireEtatSynchro(pc).connus).length);

    const navigateur = appareil();
    const r2 = await tour(relais, navigateur);
    expect(r2.recus).toBe(r1.envoyes);
    const pn = new DepotParametres(navigateur);
    expect(new DepotComptes(navigateur).tous()).toHaveLength(1);
    expect(new DepotTransactions(navigateur).toutes()).toHaveLength(2);
    expect(pn.lire('hub.theme')).toBe('sauge');
    expect(pn.lire('claude-office.notes')).toContain('note du PC');
    expect(pn.lire(PARAMETRES.identifiantAppareil)).toBeUndefined();
    expect(lirePage({ lire: c => pn.lire(c) }, '2026-10-19')?.note).toBe('Belle journée');
    expect(pn.lire('journal.boite.2026-10')).toContain('Décision du coach');
    // Rien ne repart : le navigateur est aligné.
    const r3 = await tour(relais, navigateur);
    expect([r3.envoyes, r3.recus, r3.enAttente]).toEqual([0, 0, 0]);
    pc.fermer();
    navigateur.fermer();
  });

  it('modification sur A, visible sur B au tour suivant ; suppression aussi', async () => {
    const a = appareil();
    const b = appareil();
    new DepotComptes(a).enregistrer(compte());
    await tour(relais, a);
    await tour(relais, b);
    new DepotComptes(a).enregistrer(compte({ nom: 'PEA renommé' }));
    new DepotParametres(a).ecrire('hub.theme', 'nuit-vive');
    await tour(relais, a);
    await tour(relais, b);
    expect(new DepotComptes(b).tous()[0].nom).toBe('PEA renommé');
    expect(new DepotParametres(b).lire('hub.theme')).toBe('nuit-vive');
    new DepotComptes(b).supprimer('pea');
    await tour(relais, b);
    await tour(relais, a);
    expect(new DepotComptes(a).tous()).toHaveLength(0);
    // La valeur supprimée est dans la corbeille du serveur, toujours chiffrée, lisible par le compte.
    const corbeille = await historiqueServeur({ liaison: MAITRE, cle: CLE, compte: 'principal', requete: relais.requete });
    expect(corbeille.find(h => h.cle === 'compte:pea' && h.raison === 'suppression')?.valeur).toMatchObject({ nom: 'PEA renommé' });
    a.fermer();
    b.fermer();
  });

  it('conflit : deux appareils modifient la même donnée hors ligne ; le plus récent gagne partout, l’autre version est gardée', async () => {
    const a = appareil();
    const b = appareil();
    new DepotComptes(a).enregistrer(compte());
    await tour(relais, a);
    await tour(relais, b);
    relais.horsLigne = true;
    new DepotComptes(a).enregistrer(compte({ nom: 'Version A' }));
    await expect(tour(relais, a)).rejects.toThrow(/injoignable/);
    new DepotComptes(b).enregistrer(compte({ nom: 'Version B (plus récente)' }));
    await expect(tour(relais, b)).rejects.toThrow(/injoignable/);
    expect(lireEtatSynchro(a).enAttente?.cles).toContain('compte:pea');
    relais.horsLigne = false;
    // B revient en ligne le premier, puis A (dont la modification est plus ancienne).
    await tour(relais, b);
    const ra = await tour(relais, a);
    expect(new DepotComptes(a).tous()[0].nom).toBe('Version B (plus récente)');
    expect(ra.enAttente).toBe(0);
    const historique = await historiqueServeur({ liaison: MAITRE, cle: CLE, compte: 'principal', requete: relais.requete });
    expect(historique.some(h => h.raison === 'conflit' && (h.valeur as { nom?: string })?.nom === 'Version A')).toBe(true);
    a.fermer();
    b.fermer();
  });

  it('hors ligne : la copie locale reste utilisable, la file attend, tout part au retour du réseau', async () => {
    const a = appareil();
    const b = appareil();
    await tour(relais, a);
    relais.horsLigne = true;
    new DepotComptes(a).enregistrer(compte({ id: 'cto', nom: 'Compte-titres' }));
    new DepotParametres(a).ecrire('taches.perso', '{"liste":["acheter du pain"]}');
    await expect(tour(relais, a)).rejects.toThrow();
    const etat = lireEtatSynchro(a);
    expect(etat.enAttente?.cles).toEqual(expect.arrayContaining(['compte:cto', 'kv:taches.perso']));
    expect(etat.enAttente?.essais).toBe(1);
    expect(new DepotComptes(a).tous()).toHaveLength(1);
    relais.horsLigne = false;
    const r = await tour(relais, a);
    expect(r.enAttente).toBe(0);
    await tour(relais, b);
    expect(new DepotParametres(b).lire('taches.perso')).toContain('acheter du pain');
    a.fermer();
    b.fermer();
  });

  it('migration de plusieurs appareils : les données de chacun sont fusionnées, un appareil en retard n’écrase rien de plus récent', async () => {
    // Avant la mise à jour : PC et iPhone synchronisés par l'ancienne boîte (/boite/<appareil>).
    const pc = appareil();
    const iphone = appareil();
    for (const [p, nom] of [
      [pc, 'PC'],
      [iphone, 'iPhone'],
    ] as const) {
      ecrireConfigRelais(p, { relais: RELAIS_V9, jeton: JETON_V9, cle: CLE, nom });
    }
    new DepotComptes(pc).enregistrer(compte());
    new DepotTitres(pc).enregistrer(titre());
    await synchroniser({ pilote: pc, appareil: 'pc000001', moi: { plateforme: 'bureau' }, maintenant, requete: relais.requete, force: true });
    await synchroniser({ pilote: iphone, appareil: 'ip000002', moi: { plateforme: 'ios' }, maintenant, requete: relais.requete, force: true });
    // L'iPhone (encore ancien) ajoute un compte que le PC n'a jamais vu.
    new DepotComptes(iphone).enregistrer(compte({ id: 'livret', nom: 'Livret A' }));
    await synchroniser({ pilote: iphone, appareil: 'ip000002', moi: { plateforme: 'ios' }, maintenant, requete: relais.requete, force: true });
    // Le PC passe à la version 9 et renomme le PEA.
    new DepotComptes(pc).enregistrer(compte({ nom: 'PEA (PC, récent)' }));
    const r = await tour(relais, pc, { appareil: 'pc000001' });
    expect(r.anciens).toBe(1);
    expect(new DepotComptes(pc).tous().map(c => c.id).sort()).toEqual(['livret', 'pea']);
    // Son ancien dépôt a été retiré du relais (ménage) ; celui de l'iPhone, récent, reste pour l'instant.
    expect(relais.env.BOITE.donnees.has('appareil:pc000001')).toBe(false);
    expect(relais.env.BOITE.donnees.has('appareil:ip000002')).toBe(true);
    // L'iPhone se met à jour à son tour : son PEA « ancien » ne remplace pas le nom plus récent.
    const ri = await tour(relais, iphone, { appareil: 'ip000002' });
    expect(ri.enAttente).toBe(0);
    expect(new DepotComptes(iphone).tous().find(c => c.id === 'pea')?.nom).toBe('PEA (PC, récent)');
    // Un navigateur neuf voit l'union.
    const nav = appareil();
    await tour(relais, nav);
    expect(new DepotComptes(nav).tous().map(c => [c.id, c.nom]).sort()).toEqual([
      ['livret', 'Livret A'],
      ['pea', 'PEA (PC, récent)'],
    ]);
    pc.fermer();
    iphone.fermer();
    nav.fermer();
  });

  it('compte d’ami : son coffre à lui, sa clé, son jeton ; ni lui ni le serveur ne lisent celui d’un autre', async () => {
    const jetonLea = await relais.jetonAmi('lea12345');
    const cleLea = deriverCleSynchro('cle-de-lea', 'y', KDF_RAPIDE);
    const liaisonLea = { relais: RELAIS_V9, jeton: jetonLea };
    const telephone = appareil();
    const site = appareil();
    new DepotComptes(telephone).enregistrer(compte({ id: 'lea-pea', nom: 'PEA de Léa' }));
    await tour(relais, telephone, { compte: 'lea12345', liaison: liaisonLea, cle: cleLea });
    await tour(relais, site, { compte: 'lea12345', liaison: liaisonLea, cle: cleLea });
    expect(new DepotComptes(site).tous()[0].nom).toBe('PEA de Léa');
    await expect(tour(relais, appareil(), { compte: 'principal', liaison: liaisonLea, cle: cleLea })).rejects.toThrow(/403/);
    // La clé d'un autre compte n'ouvre rien : les identifiants ne correspondent même pas.
    expect(idEnregistrement(cleLea, 'compte:lea-pea')).not.toBe(idEnregistrement(CLE, 'compte:lea-pea'));
    telephone.fermer();
    site.fermer();
  });

  it('journal : pages fusionnées par jour, événements par union (deux appareils n’effacent rien de l’autre)', async () => {
    const a = appareil();
    const b = appareil();
    const base = (p: PiloteSqlite) => {
      const d = new DepotParametres(p);
      return { lire: (c: string) => d.lire(c), ecrire: (c: string, v: string) => d.ecrire(c, v) };
    };
    modifierPage(base(a), '2026-10-18', { note: 'Note du 18 (A)' }, horloge);
    deposerEvenementJournal(base(a), { id: 'a1', famille: 'autre', genre: 'autre', jour: '2026-10-18', titre: 'Événement A' });
    await tour(relais, a);
    await tour(relais, b);
    modifierPage(base(b), '2026-10-19', { humeur: 4 }, horloge);
    deposerEvenementJournal(base(b), { id: 'b1', famille: 'autre', genre: 'autre', jour: '2026-10-19', titre: 'Événement B' });
    deposerEvenementJournal(base(a), { id: 'a2', famille: 'autre', genre: 'autre', jour: '2026-10-19', titre: 'Événement A2' });
    await tour(relais, b);
    await tour(relais, a);
    await tour(relais, b);
    for (const p of [a, b]) {
      expect(lirePage(base(p), '2026-10-18')?.note).toBe('Note du 18 (A)');
      expect(lirePage(base(p), '2026-10-19')?.humeur).toBe(4);
      const boite = base(p).lire('journal.boite.2026-10') ?? '';
      for (const t of ['Événement A', 'Événement B', 'Événement A2']) expect(boite).toContain(t);
    }
    a.fermer();
    b.fermer();
  });

  it('relais sans coffre serveur (Cloudflare, pas encore à jour) : annoncé, l’appareil garde l’ancienne synchronisation', async () => {
    const ancien = relaisV9({ avecCoffre: false });
    // Le relais annonce la fonction, mais le magasin manque : la route répond 501.
    expect(await relaisAvecCoffre(MAITRE, ancien.requete)).toBe(true);
    await expect(tour(ancien, appareil())).rejects.toThrow(/501/);
  });
});

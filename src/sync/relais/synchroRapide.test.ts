/**
 * Synchro quasi immédiate (relais version 10), contre le VRAI relais en mémoire :
 *  - une modification part en UNE requête (envoi d'abord ; rien à relire si personne n'a écrit) ;
 *  - différences seulement (les enregistrements modifiés), toujours chiffrées ;
 *  - envoi `keepalive` à la fermeture, sans doublon ni faux conflit au tour suivant ;
 *  - délai mesuré entre une modification sur A et sa visibilité sur B : avis par flux SSE, par
 *    attente longue, par sondage (objectif : moins de 500 ms en local).
 */
import { compte } from '../../core/testing/fixtures';
import { DepotComptes, DepotParametres } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { deriverCleSynchro } from './chiffrement';
import { capacitesCoffre, envoyerAvantFermeture, oublierCapacites, synchroniserServeur, type EtatServeur } from './coffreServeur';
import { Planificateur } from './planificateur';
import { lireEtatSynchro } from './synchroniser';
import { Veilleur, oublierFluxRetenus, type ModeVeille } from './veille';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from './__fixtures__/relaisV9';

const KDF_RAPIDE = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };
const CLE = deriverCleSynchro('cle-du-compte-rapide', 'x', KDF_RAPIDE);
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };
const pause = (ms: number) => new Promise<void>(ok => setTimeout(ok, ms));

function appareil(): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  return pilote;
}
const tour = (relais: RelaisV9, pilote: PiloteSqlite, o: { pousserDabord?: boolean; revConnue?: number } = {}) =>
  synchroniserServeur({ pilote, liaison: MAITRE, cle: CLE, compte: 'principal', requete: relais.requete, api: 10, ...o });
const revDe = (pilote: PiloteSqlite) => (lireEtatSynchro(pilote) as EtatServeur).serveur?.rev ?? 0;

describe('synchro quasi immédiate (version 10)', () => {
  let relais: RelaisV9;
  beforeEach(() => {
    relais = relaisV9();
    oublierCapacites();
    oublierFluxRetenus();
  });

  it('le relais annonce v10 et les avis ; une modification part en une seule requête, sans relecture', async () => {
    expect(await capacitesCoffre(MAITRE, relais.requete)).toEqual({ coffre: true, v10: true, avis: true });
    const a = appareil();
    new DepotComptes(a).enregistrer(compte());
    await tour(relais, a);
    relais.appels.length = 0;
    new DepotParametres(a).ecrire('hub.theme', 'sauge');
    const r = await tour(relais, a, { pousserDabord: true });
    expect(r.envoyes).toBe(1);
    expect(relais.appels).toEqual([{ methode: 'POST', chemin: '/v10/coffre/principal', statut: 200 }]);
    // La révision a avancé sans relire : le tour suivant ne retélécharge rien.
    relais.appels.length = 0;
    const r2 = await tour(relais, a);
    expect([r2.recus, r2.envoyes]).toEqual([0, 0]);
    expect(relais.appels.filter(x => x.chemin.startsWith('/v10/coffre'))).toHaveLength(1);
    a.fermer();
  });

  it('envoi d’abord, mais un autre appareil a écrit entre-temps : relecture, rien de perdu', async () => {
    const a = appareil();
    const b = appareil();
    new DepotComptes(a).enregistrer(compte());
    await tour(relais, a);
    await tour(relais, b);
    new DepotParametres(b).ecrire('hub.theme', 'nuit-vive');
    await tour(relais, b, { pousserDabord: true });
    new DepotParametres(a).ecrire('claude-office.notes', JSON.stringify({ n: 'note de A' }));
    relais.appels.length = 0;
    await tour(relais, a, { pousserDabord: true });
    expect(relais.appels.map(x => x.methode)).toEqual(['POST', 'GET']);
    expect(new DepotParametres(a).lire('hub.theme')).toBe('nuit-vive');
    await tour(relais, b);
    expect(new DepotParametres(b).lire('claude-office.notes')).toContain('note de A');
    a.fermer();
    b.fermer();
  });

  it('différences seulement : une modification n’envoie que l’enregistrement modifié (chiffré)', async () => {
    const a = appareil();
    for (let i = 0; i < 30; i++) new DepotParametres(a).ecrire(`claude-office.notes`, JSON.stringify({ i }));
    new DepotComptes(a).enregistrer(compte());
    new DepotParametres(a).ecrire('hub.theme', 'sauge');
    await tour(relais, a);
    const corps: string[] = [];
    const espion = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') corps.push(String(init.body));
      return relais.requete(url, init);
    }) as typeof fetch;
    new DepotParametres(a).ecrire('hub.theme', 'terminal');
    await synchroniserServeur({ pilote: a, liaison: MAITRE, cle: CLE, compte: 'principal', requete: espion, api: 10, pousserDabord: true });
    expect(corps).toHaveLength(1);
    const envoi = JSON.parse(corps[0]) as { enregistrements: Array<{ valeur: string }> };
    expect(envoi.enregistrements).toHaveLength(1);
    expect(corps[0]).not.toContain('terminal');
    a.fermer();
  });

  it('fermeture de l’onglet : la file part en keepalive ; au retour, ni doublon ni faux conflit', async () => {
    const a = appareil();
    const b = appareil();
    new DepotComptes(a).enregistrer(compte());
    await tour(relais, a);
    new DepotParametres(a).ecrire('hub.theme', 'sauge');
    let keepalive = false;
    const requete = (async (url: string, init?: RequestInit) => {
      keepalive = Boolean((init as { keepalive?: boolean })?.keepalive);
      return relais.requete(url, init);
    }) as typeof fetch;
    expect(envoyerAvantFermeture({ pilote: a, liaison: MAITRE, cle: CLE, compte: 'principal', requete, api: 10 })).toBe(true);
    await pause(20);
    expect(keepalive).toBe(true);
    // L'autre appareil l'a déjà, sans que A n'ait fait de tour.
    await tour(relais, b);
    expect(new DepotParametres(b).lire('hub.theme')).toBe('sauge');
    // A rouvre : sa modification (notée dans sa file au tour suivant) retrouve l'enregistrement identique sur le serveur.
    const store = relais.env.COFFRES as { historique(p: string): Promise<unknown[]>; version(p: string): Promise<number> };
    const historiqueAvant = (await store.historique('principal')).length;
    const revAvant = await store.version('principal');
    const r = await tour(relais, a, { pousserDabord: true });
    expect([r.conflits, r.enAttente, r.envoyes]).toEqual([0, 0, 0]);
    expect((await store.historique('principal')).length).toBe(historiqueAvant);
    expect(await store.version('principal')).toBe(revAvant);
    // Rien à envoyer : pas d'envoi de fermeture.
    expect(envoyerAvantFermeture({ pilote: a, liaison: MAITRE, cle: CLE, compte: 'principal', requete, api: 10 })).toBe(false);
    a.fermer();
    b.fermer();
  });

  /**
   * Délai A → B de bout en bout (même processus, relais en mémoire) : A modifie, son planificateur
   * envoie après le micro-regroupement ; B est prévenu par son veilleur et tire la différence.
   */
  async function mesurer(mode: ModeVeille): Promise<number[]> {
    const a = appareil();
    const b = appareil();
    new DepotComptes(a).enregistrer(compte());
    await tour(relais, a);
    await tour(relais, b);
    const planA = new Planificateur(async raison => {
      await tour(relais, a, { pousserDabord: raison === 'modification' });
      return true;
    });
    let vuSurB: (() => void) | undefined;
    const planB = new Planificateur(async () => {
      await tour(relais, b);
      if (new DepotParametres(b).lire('hub.theme') === attendu) vuSurB?.();
      return true;
    });
    let attendu = '';
    planA.demarrer();
    planB.demarrer();
    const veille = new Veilleur({ liaison: MAITRE, compte: 'principal', revConnue: () => revDe(b), surVersion: () => planB.notification(), requete: relais.requete, modeInitial: mode, pasSondageMs: 100 });
    veille.demarrer();
    await pause(50);
    const delais: number[] = [];
    for (const theme of ['sauge', 'terminal', 'nuit-vive', 'ivoire', 'sauge']) {
      attendu = theme;
      const vu = new Promise<void>(ok => {
        vuSurB = ok;
      });
      const debut = Date.now();
      new DepotParametres(a).ecrire('hub.theme', theme);
      planA.modification();
      await vu;
      delais.push(Date.now() - debut);
      await pause(30);
    }
    veille.arreter();
    planA.arreter();
    planB.arreter();
    a.fermer();
    b.fermer();
    return delais;
  }

  it.each<ModeVeille>(['flux', 'attente', 'sondage'])('délai A → B avec les avis par %s : moins de 500 ms en local', async mode => {
    const delais = await mesurer(mode);
    const tries = [...delais].sort((x, y) => x - y);
    // Mesure rapportée dans docs/synchro-relais.md.
    console.log(`délai A → B (${mode}) : ${delais.join(', ')} ms ; médiane ${tries[2]} ms`);
    if (mode === 'sondage') expect(tries[2]).toBeLessThan(500);
    else expect(Math.max(...delais)).toBeLessThan(500);
  });
});

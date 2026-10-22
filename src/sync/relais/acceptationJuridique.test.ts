/**
 * « Je dois toujours valider les politiques (chaque connexion) » : l'acceptation des documents légaux
 * restait sur chaque appareil (paramètre `juridique.acceptations` hors synchro). Elle est maintenant
 * dans le coffre serveur du compte (version des textes et date), réunie par union entre appareils,
 * avec une copie locale pour le hors ligne. Tests contre le VRAI relais en mémoire.
 */
import { DepotParametres, PARAMETRES } from '../../db/depots';
import type { PiloteSqlite } from '../../db/pilote';
import { ouvrirBaseNode } from '../../db/pilotes/node';
import { migrer } from '../../db/schema';
import { accepter, doitAccepter, lireAcceptations, versionJuridique } from '../../juridique/modele';
import { deriverCleSynchro } from './chiffrement';
import { oublierCapacites, synchroniserServeur } from './coffreServeur';
import { lireEtatSynchro } from './synchroniser';
import { JETON_V9, RELAIS_V9, relaisV9, type RelaisV9 } from './__fixtures__/relaisV9';

const KDF_RAPIDE = { algorithme: 'argon2id' as const, passes: 1, memoireKio: 8, fils: 1, longueurCle: 32 };
const CLE = deriverCleSynchro('cle-du-compte-juridique', 'x', KDF_RAPIDE);
const MAITRE = { relais: RELAIS_V9, jeton: JETON_V9 };
let horloge = Date.parse('2026-10-22T08:00:00Z');
const maintenant = () => new Date((horloge += 60_000));

function appareil(): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);
  return pilote;
}
const acceptations = (p: PiloteSqlite) => lireAcceptations(new DepotParametres(p).lire(PARAMETRES.acceptationsJuridiques));
/** Exactement ce que fait le bouton « Continuer » de l'écran « Avant de commencer ». */
const accepterIci = (p: PiloteSqlite, version: string) => {
  const depot = new DepotParametres(p);
  depot.ecrire(PARAMETRES.acceptationsJuridiques, JSON.stringify(accepter(lireAcceptations(depot.lire(PARAMETRES.acceptationsJuridiques)), version, maintenant().toISOString())));
};
const tour = (relais: RelaisV9, p: PiloteSqlite) => synchroniserServeur({ pilote: p, liaison: MAITRE, cle: CLE, compte: 'principal', maintenant, requete: relais.requete });

describe('documents légaux : acceptation enregistrée dans le coffre serveur du compte', () => {
  let relais: RelaisV9;
  beforeEach(() => {
    relais = relaisV9();
    oublierCapacites();
  });

  it('acceptée une fois sur A : un navigateur B neuf ne la redemande pas (version et date gardées), même hors ligne ensuite', async () => {
    const version = versionJuridique(undefined);
    const a = appareil();
    expect(doitAccepter(acceptations(a), version)).toBe(true);
    accepterIci(a, version);
    await tour(relais, a);

    const b = appareil();
    expect(doitAccepter(acceptations(b), version)).toBe(true);
    await tour(relais, b);
    expect(doitAccepter(acceptations(b), version)).toBe(false);
    expect(acceptations(b)).toEqual(acceptations(a));
    expect(acceptations(b)[0].date).toMatch(/^2026-10-22T/);
    // Copie locale : relue sans réseau.
    relais.horsLigne = true;
    expect(doitAccepter(acceptations(b), version)).toBe(false);
    // Le serveur ne voit pas la version en clair.
    const brut = (await (relais.env.COFFRES as { lire(p: string, d: number, l: number): Promise<{ enregistrements: Array<{ valeur: string }> }> }).lire('principal', 0, 1000)).enregistrements.map(e => e.valeur).join('');
    expect(brut).not.toContain('juridique');
  });

  it('redemandée quand la version des textes change, puis la nouvelle acceptation vaut aussi partout', async () => {
    const a = appareil();
    const b = appareil();
    accepterIci(a, '1.0');
    await tour(relais, a);
    await tour(relais, b);
    expect(doitAccepter(acceptations(b), '1.0')).toBe(false);
    // Un Fondateur modifie un texte : version 1.1.
    expect(doitAccepter(acceptations(a), '1.1')).toBe(true);
    expect(doitAccepter(acceptations(b), '1.1')).toBe(true);
    accepterIci(b, '1.1');
    await tour(relais, b);
    await tour(relais, a);
    expect(doitAccepter(acceptations(a), '1.1')).toBe(false);
    expect(acceptations(a).map(x => x.version)).toEqual(['1.0', '1.1']);
  });

  it('deux appareils acceptent chacun hors ligne : les deux acceptations sont gardées (union), sans aller-retour', async () => {
    const a = appareil();
    const b = appareil();
    await tour(relais, a);
    await tour(relais, b);
    accepterIci(a, '1.0');
    accepterIci(b, '1.2');
    for (let i = 0; i < 3; i++) {
      await tour(relais, a);
      await tour(relais, b);
    }
    expect(acceptations(a)).toEqual(acceptations(b));
    expect(acceptations(a).map(x => x.version)).toEqual(['1.0', '1.2']);
    expect((await tour(relais, a)).envoyes + (await tour(relais, b)).envoyes).toBe(0);
  });

  it('migration : un appareil déjà synchronisé avant cette version remonte l’acceptation qu’il gardait pour lui', async () => {
    const a = appareil();
    await tour(relais, a);
    expect(lireEtatSynchro(a).connus['kv:juridique.acceptations']).toBeUndefined();
    // Acceptation d'avant (restée sur l'appareil) : déjà dans la base, jamais partie.
    accepterIci(a, '1.0');
    await tour(relais, a);
    const b = appareil();
    await tour(relais, b);
    expect(doitAccepter(acceptations(b), '1.0')).toBe(false);
  });
});

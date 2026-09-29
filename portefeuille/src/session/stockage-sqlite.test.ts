import { ouvrirBaseNode } from '../db/pilotes/node';
import type { PiloteSqlite } from '../db/pilote';
import { aleatoireDeterministe } from '../securite/aleatoire';
import {
  creerCoffre,
  deverrouillerParMotDePasse,
  type Coffre,
} from '../securite/coffre';
import type { ParametresKdf } from '../securite/kdf';
import { stockageSqlite } from './stockage-sqlite';

const KDF_RAPIDE: ParametresKdf = {
  algorithme: 'argon2id',
  passes: 1,
  memoireKio: 64,
  fils: 1,
  longueurCle: 32,
};

const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe';

function coffreDeTest() {
  return creerCoffre({
    motDePasse: MOT_DE_PASSE,
    nombreCodes: 2,
    kdf: KDF_RAPIDE,
    alea: aleatoireDeterministe(1),
  });
}

let pilote: PiloteSqlite;

beforeEach(() => {
  pilote = ouvrirBaseNode();
});

afterEach(() => {
  pilote.fermer();
});

describe('stockageSqlite', () => {
  it('part d’un stockage vide', () => {
    expect(stockageSqlite(pilote).lire()).toBeUndefined();
  });

  it('conserve un coffre exploitable après relecture', () => {
    // Le vrai critère : le coffre relu doit encore ouvrir la base.
    const stockage = stockageSqlite(pilote);
    const { coffre, cleMaitresse } = coffreDeTest();

    stockage.ecrire(coffre);
    const relu = stockage.lire()!;

    expect(deverrouillerParMotDePasse(relu, MOT_DE_PASSE)).toEqual(cleMaitresse);
  });

  it('remplace le coffre au lieu d’en accumuler', () => {
    const stockage = stockageSqlite(pilote);
    stockage.ecrire(coffreDeTest().coffre);
    stockage.ecrire(coffreDeTest().coffre);

    const [ligne] = pilote.lire<{ n: number }>('SELECT COUNT(*) AS n FROM coffre');
    expect(ligne.n).toBe(1);
  });

  it('efface le coffre', () => {
    const stockage = stockageSqlite(pilote);
    stockage.ecrire(coffreDeTest().coffre);
    stockage.effacer();

    expect(stockage.lire()).toBeUndefined();
  });

  it('survit à une réouverture du stockage sur la même base', () => {
    stockageSqlite(pilote).ecrire(coffreDeTest().coffre);
    // Deuxième appel : le schéma ne doit pas être recréé de force.
    expect(stockageSqlite(pilote).lire()).toBeDefined();
  });

  it('refuse un coffre illisible au lieu de le prendre pour une absence', () => {
    // Confondre les deux ferait proposer la création d'un nouveau coffre,
    // écrasant le seul moyen de déchiffrer les données.
    const stockage = stockageSqlite(pilote);
    stockage.ecrire(coffreDeTest().coffre);
    pilote.executer("UPDATE coffre SET contenu = 'pas du json' WHERE id = 1");

    expect(() => stockage.lire()).toThrow(/illisible/);
  });

  it('conserve la structure exacte du coffre', () => {
    const stockage = stockageSqlite(pilote);
    const { coffre } = coffreDeTest();
    stockage.ecrire(coffre);

    const relu = stockage.lire() as Coffre;
    expect(relu.version).toBe(coffre.version);
    expect(relu.enveloppes).toHaveLength(coffre.enveloppes.length);
    expect(relu.enveloppes.map(e => e.usage)).toEqual(
      coffre.enveloppes.map(e => e.usage),
    );
  });
});

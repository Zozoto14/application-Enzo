import { ouvrirBaseNode } from '../db/pilotes/node';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import { codeTotp } from '../securite/totp';
import { Session } from '../session/session';
import { stockageMemoire } from '../session/stockage-coffre';
import { creerAccesAmi, genererMotDePasse } from './identifiants';

const KDF: ParametresKdf = { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 };
const HORLOGE = 1_700_000_000_000;

function neuve() {
  return new Session({ stockage: stockageMemoire(), ouvrirBase: () => ouvrirBaseNode(), horloge: () => HORLOGE, alea: aleatoireDeterministe(7), kdf: KDF });
}

describe('identifiants d’un ami', () => {
  it('génère un mot de passe de 4 groupes, sans caractère ambigu, différent à chaque tirage', () => {
    const a = genererMotDePasse();
    expect(a).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/);
    expect(a.replace(/-/g, '').length).toBeGreaterThanOrEqual(12);
    expect(genererMotDePasse()).not.toBe(a);
  });

  it('crée un coffre ordinaire, montré une fois, puis verrouillé', () => {
    const session = neuve();
    const acces = creerAccesAmi(session, 'Lucas', aleatoireDeterministe(3));
    expect(acces.codesRecuperation).toHaveLength(10);
    expect(acces.uriTotp).toContain('Lucas');
    // La clé maîtresse ne reste pas en mémoire.
    expect(session.statut()).toBe('verrouille');
    // Le mot de passe et le code TOTP fournis ouvrent bien le coffre.
    session.deverrouiller({ motDePasse: acces.motDePasse, codeTotp: codeTotp(acces.secretTotp, HORLOGE) });
    expect(session.statut()).toBe('deverrouille');
  });

  it('refuse d’écraser un coffre existant', () => {
    const session = neuve();
    creerAccesAmi(session, 'Lucas');
    expect(() => creerAccesAmi(session, 'Lucas')).toThrow(/déjà un coffre/);
  });
});

import { aleatoireDeterministe } from '../securite/aleatoire';
import {
  LONGUEUR_IDENTIFIANT_APPAREIL,
  appareilDe,
  creerGenerateurId,
  identifiantAppareil,
  identifiantAppareilValide,
  tirerIdentifiantAppareil,
} from './identite';

/** Dépôt clé-valeur en mémoire, à la place des paramètres de la base. */
function depotMemoire(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return {
    valeurs,
    lire: (cle: string) => valeurs.get(cle),
    ecrire: (cle: string, valeur: string) => {
      valeurs.set(cle, valeur);
    },
  };
}

describe('tirerIdentifiantAppareil', () => {
  it('rend huit caractères hexadécimaux', () => {
    const identifiant = tirerIdentifiantAppareil(aleatoireDeterministe(1));

    expect(identifiant).toHaveLength(LONGUEUR_IDENTIFIANT_APPAREIL);
    expect(identifiantAppareilValide(identifiant)).toBe(true);
  });

  it('tire des identifiants différents', () => {
    const a = tirerIdentifiantAppareil(aleatoireDeterministe(1));
    const b = tirerIdentifiantAppareil(aleatoireDeterministe(2));

    expect(a).not.toBe(b);
  });
});

describe('identifiantAppareilValide', () => {
  it('refuse ce qui n’est pas huit caractères hexadécimaux', () => {
    expect(identifiantAppareilValide('abc')).toBe(false);
    expect(identifiantAppareilValide('ABCDEF12')).toBe(false);
    expect(identifiantAppareilValide('zzzzzzzz')).toBe(false);
    expect(identifiantAppareilValide('abcdef123')).toBe(false);
  });
});

describe('identifiantAppareil', () => {
  it('tire et mémorise au premier appel', () => {
    const depot = depotMemoire();

    const identifiant = identifiantAppareil(depot, 'appareil', aleatoireDeterministe(1));

    expect(depot.valeurs.get('appareil')).toBe(identifiant);
  });

  it('rend le même identifiant ensuite', () => {
    const depot = depotMemoire();
    const premier = identifiantAppareil(depot, 'appareil', aleatoireDeterministe(1));

    // Un identifiant qui changerait ferait de chaque redemarrage un nouvel
    // appareil aux yeux de la fusion.
    expect(identifiantAppareil(depot, 'appareil', aleatoireDeterministe(2))).toBe(premier);
  });

  it('remplace un identifiant enregistré illisible', () => {
    const depot = depotMemoire({ appareil: 'corrompu' });

    const identifiant = identifiantAppareil(depot, 'appareil', aleatoireDeterministe(1));

    expect(identifiantAppareilValide(identifiant)).toBe(true);
    expect(depot.valeurs.get('appareil')).toBe(identifiant);
  });
});

describe('creerGenerateurId', () => {
  it('place l’appareil dans chaque identifiant', () => {
    const generer = creerGenerateurId('a1b2c3d4', () => 1000);

    expect(generer('op')).toMatch(/^op-a1b2c3d4-/);
  });

  it('distingue deux créations dans la même milliseconde', () => {
    // Saisir trois operations d'affilee est plus rapide que l'horloge.
    const generer = creerGenerateurId('a1b2c3d4', () => 1000);

    const trois = [generer('op'), generer('op'), generer('op')];

    expect(new Set(trois).size).toBe(3);
  });

  it('repart de zéro à la milliseconde suivante', () => {
    let instant = 1000;
    const generer = creerGenerateurId('a1b2c3d4', () => instant);

    generer('op');
    generer('op');
    instant = 1001;

    expect(generer('op')).toBe(`op-a1b2c3d4-${(1001).toString(36)}-0`);
  });

  it('ne produit jamais le même identifiant sur deux appareils', () => {
    // C'est tout l'objet du module : sans le prefixe, deux operations
    // differentes saisies dans la meme milliseconde sur deux appareils
    // portaient le meme identifiant, et la fusion en supprimait une.
    const iphone = creerGenerateurId('a1b2c3d4', () => 1000);
    const ipad = creerGenerateurId('e5f6a7b8', () => 1000);

    expect(iphone('op')).not.toBe(ipad('op'));
  });

  it('respecte le préfixe demandé', () => {
    const generer = creerGenerateurId('a1b2c3d4', () => 1000);

    expect(generer('cpt')).toMatch(/^cpt-/);
    expect(generer('ttr')).toMatch(/^ttr-/);
  });
});

describe('appareilDe', () => {
  it('retrouve l’appareil d’origine', () => {
    const generer = creerGenerateurId('a1b2c3d4', () => 1000);

    expect(appareilDe(generer('op'))).toBe('a1b2c3d4');
  });

  it('rend undefined sur un identifiant d’avant cette correction', () => {
    // Les anciens identifiants restent valides : ils ne portent simplement
    // pas d'appareil.
    expect(appareilDe('op-1758000000000')).toBeUndefined();
    expect(appareilDe('op-3')).toBeUndefined();
  });
});

import { decouper, detecterDelimiteur, lireCsv } from './csv';

describe('detecterDelimiteur', () => {
  it('reconnaît le point-virgule des exports français', () => {
    expect(detecterDelimiteur('a;b;c\n1;2;3')).toBe(';');
  });

  it('reconnaît la virgule', () => {
    expect(detecterDelimiteur('a,b,c\n1,2,3')).toBe(',');
  });

  it('privilégie le séparateur qui découpe régulièrement', () => {
    // Les virgules apparaissent dans les libellés, mais seul le point-virgule
    // donne le même nombre de colonnes sur toutes les lignes.
    const contenu = 'date;libelle;montant\n15/03/2024;Air Liquide, action;1 234,56';
    expect(detecterDelimiteur(contenu)).toBe(';');
  });

  it('retombe sur le point-virgule pour un contenu vide', () => {
    expect(detecterDelimiteur('')).toBe(';');
  });
});

describe('decouper', () => {
  it('respecte les guillemets', () => {
    expect(decouper('a;"b;c";d', ';')).toEqual(['a', 'b;c', 'd']);
  });

  it('gère les guillemets doublés', () => {
    expect(decouper('a;"il a dit ""oui""";c', ';')).toEqual(['a', 'il a dit "oui"', 'c']);
  });

  it('conserve les champs vides', () => {
    expect(decouper('a;;c', ';')).toEqual(['a', '', 'c']);
  });
});

describe('lireCsv', () => {
  it('associe chaque valeur à son en-tête', () => {
    const fichier = lireCsv('date;montant\n15/03/2024;1 234,56');

    expect(fichier.entetes).toEqual(['date', 'montant']);
    expect(fichier.lignes).toHaveLength(1);
    expect(fichier.lignes[0].champs).toEqual({
      date: '15/03/2024',
      montant: '1 234,56',
    });
  });

  it('retire le BOM UTF-8 ajouté par Excel', () => {
    const fichier = lireCsv('﻿date;montant\n15/03/2024;10');
    expect(fichier.entetes[0]).toBe('date');
  });

  it('ignore les lignes vides sans décaler la numérotation', () => {
    const fichier = lireCsv('date;montant\n\n15/03/2024;10\n\n16/03/2024;20\n');

    expect(fichier.lignes).toHaveLength(2);
    expect(fichier.lignes[0].numero).toBe(3);
    expect(fichier.lignes[1].numero).toBe(5);
  });

  it('saute les bandeaux d’en-tête bancaires', () => {
    const contenu = [
      'Releve de compte BoursoBank',
      'Periode : 01/01/2024 - 31/12/2024',
      'date;montant',
      '15/03/2024;10',
    ].join('\n');

    const fichier = lireCsv(contenu, { lignesIgnorees: 2 });
    expect(fichier.entetes).toEqual(['date', 'montant']);
    expect(fichier.lignes).toHaveLength(1);
    expect(fichier.lignes[0].numero).toBe(4);
  });

  it('gère les fins de ligne Windows', () => {
    const fichier = lireCsv('date;montant\r\n15/03/2024;10\r\n');
    expect(fichier.lignes[0].champs.montant).toBe('10');
  });

  it('complète les lignes plus courtes que l’en-tête', () => {
    const fichier = lireCsv('a;b;c\n1;2');
    expect(fichier.lignes[0].champs).toEqual({ a: '1', b: '2', c: '' });
  });

  it('renvoie un fichier vide sans planter', () => {
    expect(lireCsv('').lignes).toEqual([]);
  });
});

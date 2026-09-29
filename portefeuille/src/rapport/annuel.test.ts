import { d } from '../core/money/decimal';
import type { Transaction } from '../core/domain/types';
import { rejouer } from '../core/portfolio/engine';
import { achat, compte, dividende, frais, titre, vente, versement } from '../core/testing/fixtures';
import {
  anneesDisponibles,
  construireRapportAnnuel,
  echapper,
  type EntreesRapport,
} from './annuel';

/** Le formateur groupe les milliers par une espace fine insecable. */
const FINE = ' ';

const pea = compte();
const cto = compte({ id: 'cto', nom: 'CTO BoursoBank', type: 'CTO' });
const airLiquide = titre();

const JOURNAL: Transaction[] = [
  versement('2025-01-05', 10000),
  achat('2025-01-10', 20, 100, 5),
  versement('2026-02-01', 5000, { compteId: 'cto' }),
  achat('2026-02-05', 10, 100, 2, { compteId: 'cto' }),
  dividende('2026-05-15', 60),
  vente('2026-07-01', 5, 140, 3, { compteId: 'cto' }),
  frais('2026-08-01', 12),
];

function entrees(partiel: Partial<EntreesRapport> = {}): EntreesRapport {
  const transactions = partiel.transactions ?? JOURNAL;
  return {
    annee: 2026,
    etat: rejouer([pea, cto], [...transactions]),
    comptes: [pea, cto],
    titres: [airLiquide],
    transactions,
    cours: new Map([['air-liquide', d('120')]]),
    aujourdhui: '2027-03-15',
    ...partiel,
    ...(partiel.transactions
      ? { etat: rejouer([pea, cto], [...partiel.transactions]) }
      : {}),
  };
}

describe('echapper', () => {
  it('neutralise le balisage venu des noms saisis', () => {
    // Un nom de valeur est de la donnee utilisateur : sans echappement, il
    // casserait le document, voire y injecterait du script.
    expect(echapper('<script>alert("x")</script> & co')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
    );
  });
});

describe('construireRapportAnnuel', () => {
  it('produit un document HTML autonome', () => {
    const rapport = construireRapportAnnuel(entrees());

    expect(rapport.html).toMatch(/^<!doctype html>/);
    expect(rapport.html).toContain('<style>');
    // Rien d'externe : le document doit s'ouvrir dans dix ans sans reseau.
    expect(rapport.html).not.toMatch(/<link[^>]+href/);
    expect(rapport.html).not.toMatch(/<script/);
    expect(rapport.html).not.toMatch(/https?:\/\//);
  });

  it('nomme le fichier par son année', () => {
    expect(construireRapportAnnuel(entrees()).nom).toBe('rapport-2026.html');
  });

  it('dit sur quelles données il repose et d’où elles viennent', () => {
    const rapport = construireRapportAnnuel(entrees());

    expect(rapport.html).toContain('Rapport annuel 2026');
    expect(rapport.html).toMatch(/Généré le 15\/03\/2027/);
    expect(rapport.html).toMatch(/Aucune donnée n’a quitté l’appareil/);
  });

  describe('bornes de l’année', () => {
    it('ne retient que les opérations de l’année demandée', () => {
      const rapport = construireRapportAnnuel(entrees());

      // Le versement de 2025 ne doit pas compter dans les versements 2026.
      expect(rapport.html).toContain(`5${FINE}000,00`);
      expect(rapport.html).toMatch(/6 opération\(s\) enregistrée\(s\) dans l’année|5 opération/);
      expect(rapport.html).not.toContain('05/01/2025');
    });

    it('signale une année sans rien plutôt que de produire un document vide', () => {
      const rapport = construireRapportAnnuel(entrees({ annee: 2020 }));

      expect(rapport.anneeVide).toBe(true);
      expect(rapport.html).toContain('Aucune cession réalisée.');
    });
  });

  describe('fiscalité', () => {
    it('sépare les cessions de compte-titres de celles du PEA', () => {
      // Une vente dans un PEA ne se declare pas : elle ne doit pas entrer
      // dans les cases.
      const avecVentePEA: Transaction[] = [
        ...JOURNAL,
        vente('2026-09-01', 5, 150, 2),
      ];
      const rapport = construireRapportAnnuel(entrees({ transactions: avecVentePEA }));

      // La vente CTO : 5 x 140 - 3 = 697, revient 5 x 100,2 = 501 -> +196.
      expect(rapport.html).toContain('196,00');
      expect(rapport.html).toMatch(/Une vente à l’intérieur d’un PEA ne déclenche aucune imposition/);
    });

    it('nomme les cases de la déclaration', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/formulaire 2074/);
      expect(rapport.html).toMatch(/case 3VG/);
      expect(rapport.html).toMatch(/case 3VH/);
    });

    it('estime l’impôt au prélèvement forfaitaire unique et le dit', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/Impôt sur le revenu \(12,8 %\)/);
      expect(rapport.html).toMatch(/Prélèvements sociaux \(17,2 %\)/);
      expect(rapport.html).toMatch(/barème progressif peut être plus avantageuse/);
    });

    it('explique le report d’une moins-value au lieu de l’ignorer', () => {
      const perte: Transaction[] = [
        versement('2026-02-01', 5000, { compteId: 'cto' }),
        achat('2026-02-05', 10, 100, 0, { compteId: 'cto' }),
        vente('2026-07-01', 10, 60, 0, { compteId: 'cto' }),
      ];
      const rapport = construireRapportAnnuel(entrees({ transactions: perte }));

      expect(rapport.html).toMatch(/perte de 400,00/);
      expect(rapport.html).toMatch(/reportable sur les plus-values des dix années suivantes/);
    });

    it('ne reporte rien quand aucune cession n’a eu lieu sur compte-titres', () => {
      const rapport = construireRapportAnnuel(
        entrees({ transactions: [versement('2026-01-05', 1000)] }),
      );

      expect(rapport.html).toMatch(/Aucune cession sur compte-titres/);
    });

    it('détaille le plafond et l’antériorité du PEA', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/Antériorité au 31\/12\/2026/);
      expect(rapport.html).toContain(`150${FINE}000,00`);
      // Ouvert en 2019 : plus de cinq ans au 31/12/2026.
      expect(rapport.html).toMatch(/exonérés d’impôt sur le revenu/);
    });

    it('avertit qu’un PEA jeune serait taxé et clôturé', () => {
      const jeune = compte({ dateOuverture: '2024-06-01' });
      const rapport = construireRapportAnnuel(entrees({ comptes: [jeune, cto] }));

      expect(rapport.html).toMatch(/entraînerait la clôture du plan/);
    });

    it('rappelle que les dividendes de PEA ne se déclarent pas', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/Ceux perçus dans un PEA ne se déclarent pas/);
    });
  });

  describe('positions', () => {
    it('liste les positions détenues avec leur prix de revient', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toContain('Air Liquide');
      expect(rapport.html).toMatch(/Positions détenues au 31\/12\/2026/);
    });

    it('exclut et signale une ligne sans cours', () => {
      const rapport = construireRapportAnnuel(entrees({ cours: new Map() }));

      expect(rapport.html).toMatch(/ligne\(s\) exclue\(s\) des totaux faute de cours connu/);
      expect(rapport.html).toMatch(/plutôt que valorisées à zéro/);
    });

    it('précise que les plus-values latentes ne sont pas imposables', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/ne le deviennent qu’à la vente/);
    });
  });

  describe('avertissements', () => {
    it('dit que le document ne remplace pas une déclaration', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/prépare une déclaration ; il ne la remplace pas/);
    });

    it('nomme la règle de calcul retenue et celle qui ne l’est pas', () => {
      // Confondre le prix de revient moyen pondere avec le FIFO est l'erreur
      // qui fausse tout, et elle ne se voit pas.
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/prix de revient moyen pondéré/);
      expect(rapport.html).toMatch(/CGI art\. 150-0 D/);
      expect(rapport.html).toMatch(/non la méthode FIFO/);
    });

    it('énumère les cas particuliers qu’il ne traite pas', () => {
      const rapport = construireRapportAnnuel(entrees());

      expect(rapport.html).toMatch(/abattement pour durée de détention/);
      expect(rapport.html).toMatch(/faites vérifier ce rapport/);
    });
  });

  it('échappe les noms dans tout le document', () => {
    const malicieux = titre({ nom: '<b>Air & Liquide</b>' });
    const rapport = construireRapportAnnuel(entrees({ titres: [malicieux] }));

    expect(rapport.html).toContain('&lt;b&gt;Air &amp; Liquide&lt;/b&gt;');
    expect(rapport.html).not.toContain('<b>Air');
  });
});

describe('anneesDisponibles', () => {
  it('rend les années du journal, de la plus récente à la plus ancienne', () => {
    expect(anneesDisponibles(JOURNAL)).toEqual([2026, 2025]);
  });

  it('ne rend rien sans opération', () => {
    expect(anneesDisponibles([])).toEqual([]);
  });

  it('ne compte chaque année qu’une fois', () => {
    expect(anneesDisponibles([versement('2026-01-01', 1), versement('2026-06-01', 1)])).toEqual([
      2026,
    ]);
  });
});

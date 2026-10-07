import { d } from '../core/money/decimal';
import { rejouer } from '../core/portfolio/engine';
import {
  achat,
  compte,
  dividende,
  titre,
  versement,
  vente,
} from '../core/testing/fixtures';
import {
  DepotComptes,
  DepotCours,
  DepotParametres,
  DepotTitres,
  DepotTransactions,
  PARAMETRES,
  chargerEtat,
} from '../db/depots';
import type { PiloteSqlite } from '../db/pilote';
import { ouvrirBaseNode } from '../db/pilotes/node';
import { migrer } from '../db/schema';
import { aleatoireDeterministe } from '../securite/aleatoire';
import type { ParametresKdf } from '../securite/kdf';
import {
  ErreurArchive,
  creerArchive,
  decrireArchive,
  ouvrirArchive,
  texteDepuisOctets,
  type Archive,
} from './archive';
import { exporterDepuisBase, restaurerDansBase } from './depot';

const KDF_RAPIDE: ParametresKdf = {
  algorithme: 'argon2id',
  passes: 1,
  memoireKio: 64,
  fils: 1,
  longueurCle: 32,
};

const MOT_DE_PASSE = 'sauvegarde-du-portefeuille-2026';

function baseGarnie(): PiloteSqlite {
  const pilote = ouvrirBaseNode();
  migrer(pilote);

  new DepotComptes(pilote).enregistrer(compte());
  new DepotTitres(pilote).enregistrer(titre());
  new DepotTransactions(pilote).enregistrerLot([
    versement('2026-01-05', 10000),
    achat('2026-01-10', 20, '5.094', '0.51'),
    vente('2026-06-10', 5, 6, '0.30'),
    dividende('2026-07-01', '30.50'),
  ]);
  new DepotCours(pilote).enregistrer('air-liquide', '2026-09-22', d('4.2235'));
  new DepotParametres(pilote).ecrire(PARAMETRES.fournisseurCours, 'finnhub');
  new DepotParametres(pilote).ecrire(PARAMETRES.cleApiCours, 'cle-secrete-123');

  return pilote;
}

const exporter = (pilote: PiloteSqlite, inclureSecrets = false) =>
  exporterDepuisBase(pilote, {
    motDePasse: MOT_DE_PASSE,
    date: '2026-09-22',
    kdf: KDF_RAPIDE,
    alea: aleatoireDeterministe(1),
    inclureSecrets,
  });

describe('texteDepuisOctets', () => {
  it('décode l’UTF-8 sans TextDecoder', () => {
    // Le moteur embarqué ne garantit pas TextDecoder, et une sauvegarde
    // illisible faute de décodeur arriverait au pire moment.
    const { utf8ToBytes } = require('@noble/hashes/utils.js');
    for (const texte of ['simple', 'accentué à côté', 'PEA « émis »', '日本語', '💶']) {
      expect(texteDepuisOctets(utf8ToBytes(texte))).toBe(texte);
    }
  });
});

describe('archive', () => {
  let pilote: PiloteSqlite;

  beforeEach(() => {
    pilote = baseGarnie();
  });

  afterEach(() => pilote.fermer());

  it('décrit son contenu sans être déchiffrée', () => {
    // Retrouver trois sauvegardes anonymes et devoir toutes les ouvrir pour
    // identifier la bonne serait absurde.
    const archive = exporter(pilote);

    expect(decrireArchive(archive)).toBe(
      'Sauvegarde du 2026-09-22 — 1 compte(s), 1 valeur(s), 4 opération(s).',
    );
  });

  it('ne laisse fuir aucune donnée en clair', () => {
    const archive = exporter(pilote);
    const serialise = JSON.stringify(archive);

    expect(serialise).not.toContain('PEA Boursobank');
    expect(serialise).not.toContain('Air Liquide');
    expect(serialise).not.toContain('FR0000120073');
    expect(serialise).not.toContain('5.094');
  });

  it('exclut la clé d’API par défaut', () => {
    // Une sauvegarde peut être posée sur un service tiers : un identifiant
    // technique n'a pas à s'y retrouver.
    const resultat = ouvrirArchive(exporter(pilote), MOT_DE_PASSE);
    expect(resultat.ouverte).toBe(true);

    if (resultat.ouverte) {
      const cles = resultat.contenu.parametres.map(p => p.cle);
      expect(cles).toContain(PARAMETRES.fournisseurCours);
      expect(cles).not.toContain(PARAMETRES.cleApiCours);
    }
  });

  it('inclut la clé d’API quand on le demande explicitement', () => {
    const resultat = ouvrirArchive(exporter(pilote, true), MOT_DE_PASSE);
    if (resultat.ouverte) {
      expect(resultat.contenu.parametres.map(p => p.cle)).toContain(
        PARAMETRES.cleApiCours,
      );
    }
  });

  describe('refus', () => {
    it('refuse un mot de passe faux', () => {
      const resultat = ouvrirArchive(exporter(pilote), 'pas-le-bon');

      expect(resultat.ouverte).toBe(false);
      if (!resultat.ouverte) {
        expect(resultat.motif).toMatch(/Mot de passe incorrect/);
      }
    });

    it('refuse une archive modifiée', () => {
      const archive = exporter(pilote);
      const altere: Archive = {
        ...archive,
        charge: `00${archive.charge.slice(2)}`,
      };

      expect(ouvrirArchive(altere, MOT_DE_PASSE).ouverte).toBe(false);
    });

    it('refuse un fichier qui n’est pas une sauvegarde', () => {
      const resultat = ouvrirArchive(
        { ...exporter(pilote), format: 'autre-chose' } as unknown as Archive,
        MOT_DE_PASSE,
      );

      if (!resultat.ouverte) {
        expect(resultat.motif).toMatch(/n’est pas une sauvegarde/);
      }
    });

    it('refuse une archive produite par une version plus récente', () => {
      const resultat = ouvrirArchive({ ...exporter(pilote), version: 99 }, MOT_DE_PASSE);

      if (!resultat.ouverte) {
        expect(resultat.motif).toMatch(/version plus récente/);
      }
    });

    it('refuse un export sans mot de passe', () => {
      expect(() =>
        creerArchive({
          motDePasse: '',
          date: '2026-09-22',
          contenu: { comptes: [], titres: [], transactions: [], cours: [], parametres: [] },
        }),
      ).toThrow(ErreurArchive);
    });
  });
});

describe('restauration', () => {
  it('reconstitue un portefeuille identique dans une base vierge', () => {
    // Le vrai critere : apres restauration, le rejeu du journal doit rendre
    // exactement le meme portefeuille.
    const source = baseGarnie();
    const avant = chargerEtat(source);
    const archive = exporter(source);
    source.fermer();

    const cible = ouvrirBaseNode();
    migrer(cible);
    const lecture = ouvrirArchive(archive, MOT_DE_PASSE);
    expect(lecture.ouverte).toBe(true);

    if (lecture.ouverte) {
      const rapport = restaurerDansBase(cible, lecture.contenu);
      expect(rapport).toEqual({
        comptes: 1,
        titres: 1,
        transactions: 4,
        cours: 1,
        parametres: 1,
      });
    }

    const apres = chargerEtat(cible);
    expect(apres.comptes).toEqual(avant.comptes);
    expect(apres.titres).toEqual(avant.titres);
    expect(apres.etat.positions[0].pru.toString()).toBe(
      avant.etat.positions[0].pru.toString(),
    );
    expect(apres.etat.comptes.get('pea')!.cash.toString()).toBe(
      avant.etat.comptes.get('pea')!.cash.toString(),
    );
    cible.fermer();
  });

  it('conserve la précision décimale des montants', () => {
    const source = baseGarnie();
    const archive = exporter(source);
    source.fermer();

    const cible = ouvrirBaseNode();
    migrer(cible);
    const lecture = ouvrirArchive(archive, MOT_DE_PASSE);
    if (lecture.ouverte) {
      restaurerDansBase(cible, lecture.contenu);
    }

    const achatRestaure = new DepotTransactions(cible)
      .toutes()
      .find(t => t.type === 'ACHAT')!;

    expect(achatRestaure.type === 'ACHAT' && achatRestaure.prixUnitaire.toString()).toBe(
      '5.094',
    );
    expect(achatRestaure.type === 'ACHAT' && achatRestaure.frais.toString()).toBe('0.51');
    cible.fermer();
  });

  it('conserve l’historique des cours', () => {
    const source = baseGarnie();
    const archive = exporter(source);
    source.fermer();

    const cible = ouvrirBaseNode();
    migrer(cible);
    const lecture = ouvrirArchive(archive, MOT_DE_PASSE);
    if (lecture.ouverte) {
      restaurerDansBase(cible, lecture.contenu);
    }

    expect(new DepotCours(cible).derniersCours().get('air-liquide')!.toString()).toBe(
      '4.2235',
    );
    cible.fermer();
  });

  it('remplace le contenu au lieu de le fusionner', () => {
    // Fusionner supposerait d'arbitrer entre deux versions d'une meme
    // operation, ce qu'aucune regle automatique ne tranche correctement.
    const source = baseGarnie();
    const archive = exporter(source);
    source.fermer();

    const cible = baseGarnie();
    new DepotTransactions(cible).enregistrer(versement('2026-08-01', 5000));
    expect(new DepotTransactions(cible).compter()).toBe(5);

    const lecture = ouvrirArchive(archive, MOT_DE_PASSE);
    if (lecture.ouverte) {
      restaurerDansBase(cible, lecture.contenu);
    }

    expect(new DepotTransactions(cible).compter()).toBe(4);
    cible.fermer();
  });

  it('laisse la base intacte si la restauration echoue', () => {
    // Une restauration interrompue laisserait sinon une base a moitie videe,
    // c'est-a-dire pire que celle dont on partait.
    const cible = baseGarnie();
    const avant = chargerEtat(cible);

    const contenuFautif = {
      version: 1,
      date: '2026-09-22',
      comptes: [compte()],
      titres: [],
      // Transaction rattachee a un titre absent : la cle etrangere la refuse.
      transactions: [achat('2026-01-10', 1, 100, 0)],
      cours: [],
      parametres: [],
    };

    expect(() => restaurerDansBase(cible, contenuFautif)).toThrow();

    const apres = chargerEtat(cible);
    expect(apres.transactions).toHaveLength(avant.transactions.length);
    expect(apres.titres).toHaveLength(avant.titres.length);
    cible.fermer();
  });

  it('restaure un portefeuille vide sans se plaindre', () => {
    const vide = ouvrirBaseNode();
    migrer(vide);
    const archive = exporterDepuisBase(vide, {
      motDePasse: MOT_DE_PASSE,
      date: '2026-09-22',
      kdf: KDF_RAPIDE,
    });

    const lecture = ouvrirArchive(archive, MOT_DE_PASSE);
    expect(lecture.ouverte).toBe(true);
    if (lecture.ouverte) {
      expect(restaurerDansBase(vide, lecture.contenu).transactions).toBe(0);
    }
    vide.fermer();
  });

  it('survit a un aller-retour par JSON, comme un vrai fichier', () => {
    const source = baseGarnie();
    const archive = exporter(source);
    source.fermer();

    // C'est ainsi que l'archive existera : un fichier texte.
    const relue: Archive = JSON.parse(JSON.stringify(archive));
    const lecture = ouvrirArchive(relue, MOT_DE_PASSE);

    expect(lecture.ouverte).toBe(true);
    if (lecture.ouverte) {
      const cible = ouvrirBaseNode();
      migrer(cible);
      restaurerDansBase(cible, lecture.contenu);
      const etat = rejouer(
        new DepotComptes(cible).tous(),
        new DepotTransactions(cible).toutes(),
      );
      expect(etat.positions[0].quantite.toString()).toBe('15');
      cible.fermer();
    }
  });
});

describe('fichiers de sauvegarde', () => {
  const { systemeMemoire } = require('../fichiers/systeme');
  const {
    ErreurFichierSauvegarde,
    ecrireSauvegarde,
    lireSauvegarde,
    listerSauvegardes,
    nomDeFichier,
    supprimerSauvegarde,
  } = require('./fichiers');

  it('horodate le nom du fichier', () => {
    expect(nomDeFichier('2026-09-22')).toBe('applibourse-2026-09-22.sauvegarde.json');
    expect(nomDeFichier('2026-09-22', 'avant-import')).toBe(
      'applibourse-2026-09-22-avant-import.sauvegarde.json',
    );
  });

  it('écrit une sauvegarde et la relit', async () => {
    const fichiers = systemeMemoire();
    const pilote = baseGarnie();
    const archive = exporter(pilote);
    pilote.fermer();

    const ecrite = await ecrireSauvegarde(fichiers, archive);
    expect(ecrite.chemin).toContain('/sauvegardes/');
    expect(ecrite.description).toMatch(/1 compte\(s\)/);

    const relue = await lireSauvegarde(fichiers, ecrite.chemin);
    expect(ouvrirArchive(relue, MOT_DE_PASSE).ouverte).toBe(true);
  });

  it('accumule les sauvegardes au lieu de les écraser', async () => {
    // Une sauvegarde unique qui se réécrit ne protège de rien : si la
    // dernière est corrompue, il ne reste rien derrière.
    const fichiers = systemeMemoire();
    const pilote = baseGarnie();

    await ecrireSauvegarde(fichiers, exporter(pilote));
    await ecrireSauvegarde(
      fichiers,
      exporterDepuisBase(pilote, {
        motDePasse: MOT_DE_PASSE,
        date: '2026-10-01',
        kdf: KDF_RAPIDE,
      }),
    );
    pilote.fermer();

    const liste = await listerSauvegardes(fichiers);
    expect(liste).toHaveLength(2);
    // La plus récente en premier.
    expect(liste[0].date).toBe('2026-10-01');
  });

  it('signale une sauvegarde illisible au lieu de la masquer', async () => {
    const fichiers = systemeMemoire();
    await fichiers.creerDossier('/Documents/sauvegardes');
    await fichiers.ecrireTexte(
      '/Documents/sauvegardes/applibourse-2026-09-22.sauvegarde.json',
      'ceci n’est pas du json',
    );

    const liste = await listerSauvegardes(fichiers);
    expect(liste).toHaveLength(1);
    expect(liste[0].description).toMatch(/illisible/);
  });

  it('ignore les fichiers étrangers au dossier', async () => {
    const fichiers = systemeMemoire();
    await fichiers.ecrireTexte('/Documents/sauvegardes/notes.txt', 'rien');

    expect(await listerSauvegardes(fichiers)).toEqual([]);
  });

  it('rend une liste vide quand rien n’a été sauvegardé', async () => {
    expect(await listerSauvegardes(systemeMemoire())).toEqual([]);
  });

  it('refuse de lire un fichier absent', async () => {
    await expect(lireSauvegarde(systemeMemoire(), '/absent.json')).rejects.toThrow(
      ErreurFichierSauvegarde,
    );
  });

  it('supprime une sauvegarde', async () => {
    const fichiers = systemeMemoire();
    const pilote = baseGarnie();
    const ecrite = await ecrireSauvegarde(fichiers, exporter(pilote));
    pilote.fermer();

    await supprimerSauvegarde(fichiers, ecrite.chemin);
    expect(await listerSauvegardes(fichiers)).toEqual([]);
  });
});

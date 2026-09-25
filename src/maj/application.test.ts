import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  base64DepuisOctets,
  octetsDepuisBase64,
  systemeMemoire,
} from '../fichiers/systeme';
import {
  GestionnaireMiseAJour,
  VERSION_ORIGINE,
  gestionnaireDepuisFs,
} from './application';
import { genererClesSignature, signerPaquet } from './manifeste';

const CLES = genererClesSignature();
const PAQUET = utf8ToBytes('var app = 2; // nouveau paquet');

/** Système de fichiers en mémoire, partagé avec la sauvegarde. */
function fichiersEnMemoire() {
  const systeme = systemeMemoire();
  return { systeme, contenu: systeme.contenu };
}

function deposerPaquet(
  contenu: Map<string, Uint8Array | string>,
  version = 2,
  clePrivee = CLES.privee,
  paquet = PAQUET,
) {
  const manifeste = signerPaquet(paquet, {
    version,
    date: '2026-09-22',
    clePrivee,
    notes: 'Onglet Performances',
  });
  contenu.set('/entrant/main.jsbundle', paquet);
  contenu.set('/entrant/manifeste.json', JSON.stringify(manifeste));
  return manifeste;
}

describe('GestionnaireMiseAJour', () => {
  describe('état initial', () => {
    it('part du paquet livré avec le binaire', async () => {
      const { systeme } = fichiersEnMemoire();
      const etat = await new GestionnaireMiseAJour(systeme, CLES.publique).etat();

      expect(etat.version).toBe(VERSION_ORIGINE);
      expect(etat.miseAJourActive).toBe(false);
      expect(etat.enEssai).toBe(false);
    });
  });

  describe('installation', () => {
    it('installe un paquet authentique', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);
      deposerPaquet(contenu);

      const resultat = await gestionnaire.installer(
        '/entrant/main.jsbundle',
        '/entrant/manifeste.json',
      );

      expect(resultat.valide).toBe(true);
      const etat = await gestionnaire.etat();
      expect(etat.version).toBe(2);
      expect(etat.miseAJourActive).toBe(true);
      expect(etat.notes).toBe('Onglet Performances');
    });

    it('refuse un paquet signé par une autre clé, sans rien écrire', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);
      deposerPaquet(contenu, 2, genererClesSignature().privee);

      const resultat = await gestionnaire.installer(
        '/entrant/main.jsbundle',
        '/entrant/manifeste.json',
      );

      expect(resultat.motif).toMatch(/Signature invalide/);
      expect(contenu.has('/Documents/maj-active/main.jsbundle')).toBe(false);
      expect((await gestionnaire.etat()).version).toBe(VERSION_ORIGINE);
    });

    it('refuse une version qui n’est pas plus récente', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);

      deposerPaquet(contenu, 3);
      await gestionnaire.installer('/entrant/main.jsbundle', '/entrant/manifeste.json');

      deposerPaquet(contenu, 3);
      const resultat = await gestionnaire.installer(
        '/entrant/main.jsbundle',
        '/entrant/manifeste.json',
      );

      expect(resultat.motif).toMatch(/pas plus récent/);
      expect((await gestionnaire.etat()).version).toBe(3);
    });

    it('signale un fichier absent plutôt que de lever', async () => {
      const { systeme } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);

      expect(
        (await gestionnaire.installer('/absent.jsbundle', '/absent.json')).motif,
      ).toMatch(/Paquet introuvable/);
    });

    it('signale un manifeste illisible', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      contenu.set('/entrant/main.jsbundle', PAQUET);
      contenu.set('/entrant/manifeste.json', 'ceci n’est pas du json');

      const resultat = await new GestionnaireMiseAJour(systeme, CLES.publique).installer(
        '/entrant/main.jsbundle',
        '/entrant/manifeste.json',
      );

      expect(resultat.motif).toMatch(/pas du JSON/);
    });
  });

  describe('filet de sécurité au démarrage', () => {
    it('signale un démarrage encore en essai', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);
      deposerPaquet(contenu);
      await gestionnaire.installer('/entrant/main.jsbundle', '/entrant/manifeste.json');

      // Marqueur posé par le code natif juste avant de charger le paquet.
      contenu.set('/Documents/maj-active/en-essai', '');

      expect((await gestionnaire.etat()).enEssai).toBe(true);
    });

    it('efface le marqueur une fois le démarrage abouti', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);
      contenu.set('/Documents/maj-active/en-essai', '');

      await gestionnaire.confirmerDemarrage();

      expect(contenu.has('/Documents/maj-active/en-essai')).toBe(false);
      expect((await gestionnaire.etat()).enEssai).toBe(false);
    });

    it('ne se plaint pas si le marqueur est déjà absent', async () => {
      const { systeme } = fichiersEnMemoire();
      await expect(
        new GestionnaireMiseAJour(systeme, CLES.publique).confirmerDemarrage(),
      ).resolves.toBeUndefined();
    });
  });

  describe('retour à l’origine', () => {
    it('efface la mise à jour installée', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);
      deposerPaquet(contenu);
      await gestionnaire.installer('/entrant/main.jsbundle', '/entrant/manifeste.json');

      await gestionnaire.revenirAOrigine();

      const etat = await gestionnaire.etat();
      expect(etat.version).toBe(VERSION_ORIGINE);
      expect(etat.miseAJourActive).toBe(false);
    });

    it('rend une nouvelle installation possible ensuite', async () => {
      const { systeme, contenu } = fichiersEnMemoire();
      const gestionnaire = new GestionnaireMiseAJour(systeme, CLES.publique);
      deposerPaquet(contenu, 5);
      await gestionnaire.installer('/entrant/main.jsbundle', '/entrant/manifeste.json');
      await gestionnaire.revenirAOrigine();

      // Après retour, la version 2 redevient acceptable.
      deposerPaquet(contenu, 2);
      const resultat = await gestionnaire.installer(
        '/entrant/main.jsbundle',
        '/entrant/manifeste.json',
      );

      expect(resultat.valide).toBe(true);
    });
  });
});

describe('conversions base64', () => {
  it('font un aller-retour sans perte', () => {
    // `atob` et `Buffer` ne sont pas garantis dans le moteur embarqué, et un
    // paquet mal décodé ferait échouer la vérification d'empreinte sans que
    // la cause soit lisible.
    for (const longueur of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const octets = Uint8Array.from({ length: longueur }, (_, i) => (i * 7) % 256);
      expect(octetsDepuisBase64(base64DepuisOctets(octets))).toEqual(octets);
    }
  });

  it('produit le même encodage que la référence', () => {
    expect(base64DepuisOctets(utf8ToBytes('bonjour'))).toBe('Ym9uam91cg==');
    expect(base64DepuisOctets(utf8ToBytes('ab'))).toBe('YWI=');
  });
});

describe('gestionnaireDepuisFs', () => {
  it('renvoie undefined quand le module de fichiers est absent', () => {
    // Cas réel d'un binaire compilé sans react-native-fs : l'interface doit
    // pouvoir le dire au lieu de planter.
    expect(gestionnaireDepuisFs(undefined)).toBeUndefined();
    expect(gestionnaireDepuisFs({})).toBeUndefined();
  });

  it('construit le gestionnaire quand le module est présent', () => {
    const faux = {
      DocumentDirectoryPath: '/Documents',
      exists: async () => false,
      readFile: async () => '',
      writeFile: async () => undefined,
      unlink: async () => undefined,
      mkdir: async () => undefined,
    };
    expect(gestionnaireDepuisFs(faux)).toBeInstanceOf(GestionnaireMiseAJour);
  });
});

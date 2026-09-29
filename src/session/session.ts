/**
 * Session : ce qui se passe quand on ouvre l'application.
 *
 * C'est la pièce qui relie les trois couches. Le coffre produit la clé, la
 * clé ouvre la base, la politique décide si la tentative est seulement permise.
 * Aucune d'elles ne connaît les autres ; c'est ici, et nulle part ailleurs,
 * que l'enchaînement est décidé.
 *
 * Contrainte découverte en écrivant l'enchaînement : le secret TOTP est scellé
 * par la clé maîtresse, donc **le code ne peut pas être vérifié avant le mot
 * de passe**. Une tentative au code faux coûte donc une dérivation Argon2id
 * complète. C'est le prix à payer pour que le secret TOTP ne traîne pas en
 * clair à côté du coffre.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { PiloteSqlite } from '../db/pilote';
import { migrer } from '../db/schema';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import {
  ErreurDeverrouillage,
  changerMotDePasse as changerMotDePasseCoffre,
  cleHexadecimale,
  creerCoffre,
  definirSecretTotp,
  deverrouillerParCodeRecuperation,
  deverrouillerParMotDePasse,
  lireSecretTotp,
  regenererCodesRecuperation,
  type Coffre,
} from '../securite/coffre';
import type { ParametresKdf } from '../securite/kdf';
import {
  ETAT_INITIAL,
  POLITIQUE_DEFAUT,
  apresEchec,
  apresSucces,
  evaluerVerrou,
  raccourciBiometriqueAutorise,
  type EtatVerrouillage,
  type PolitiqueVerrouillage,
  type Verrou,
} from '../securite/politique';
import { genererSecretTotp, uriOtpauth, verifierCodeTotp } from '../securite/totp';
import { scellerPourAdmin } from '../securite/sequestre';
import type { StockageCoffre } from './stockage-coffre';

/**
 * Contexte de dérivation d'une clé d'usage. Le profil principal garde le
 * contexte historique (sa clé de synchronisation est partagée avec ses
 * autres appareils) ; tout autre profil y ajoute son identifiant.
 */
export function contexteDerivation(usage: string, profil: string | undefined): string {
  return !profil || profil === 'principal' ? `applibourse/${usage}/v1|` : `applibourse/${usage}/profil/${profil}/v1|`;
}

/** Contexte du dépôt de séquestre d'un compte. */
export function usageSequestre(idCompte: string): string {
  return `sequestre/cle-maitresse/${idCompte}`;
}

export class ErreurSession extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurSession';
  }
}

/** Levée quand la temporisation après échecs interdit toute tentative. */
export class ErreurTemporisation extends ErreurSession {
  constructor(readonly secondesRestantes: number) {
    super(`Trop de tentatives : réessayez dans ${secondesRestantes} seconde(s)`);
    this.name = 'ErreurTemporisation';
  }
}

export type StatutSession = 'non-initialise' | 'verrouille' | 'deverrouille';

export interface DependancesSession {
  stockage: StockageCoffre;
  /**
   * Ouvre la base avec la clé donnée, au format hexadécimal attendu par
   * SQLCipher. C'est le seul endroit qui connaît le pilote concret.
   */
  ouvrirBase(cleHexadecimale: string): PiloteSqlite;
  /** Horloge injectable, pour tester temporisations et fenêtres. */
  horloge?: () => number;
  alea?: SourceAleatoire;
  politique?: PolitiqueVerrouillage;
  kdf?: ParametresKdf;
  /**
   * Efface le portefeuille local, avant d'adopter le coffre d'un autre
   * appareil : l'ancienne base est scellée par une autre clé et ne pourrait
   * plus s'ouvrir. Ses données reviennent par la synchronisation.
   */
  reinitialiserBase?(): void;
  /**
   * Profil dont c'est la session (« principal » par défaut). Il entre dans
   * le contexte de dérivation des clés (`cleDerivee`) : deux profils
   * n'obtiennent jamais la même clé pour le même usage.
   */
  profil?: string;
}

export interface Initialisation {
  /** À montrer une seule fois, puis à noter hors ligne. */
  codesRecuperation: string[];
  /** Secret TOTP à enrôler dans l'application d'authentification. */
  secretTotp: string;
  /** Même secret, sous forme d'URI à présenter en QR code. */
  uriTotp: string;
}

export interface OptionsInitialisation {
  motDePasse: string;
  nombreCodes?: number;
  /** Identifiant affiché dans l'application d'authentification. */
  compte?: string;
}

export interface OptionsDeverrouillage {
  motDePasse: string;
  codeTotp: string;
}

export interface OptionsRecuperation {
  codeRecuperation: string;
  /** Un code de récupération sert à reprendre la main, donc à redéfinir un mot de passe. */
  nouveauMotDePasse: string;
}

export interface ResultatRecuperation {
  codesRestants: number;
}

export class Session {
  private readonly horloge: () => number;
  private readonly alea: SourceAleatoire;
  private readonly politique: PolitiqueVerrouillage;

  private etatVerrou: EtatVerrouillage = ETAT_INITIAL;
  private cleMaitresse?: Uint8Array;
  private pilote?: PiloteSqlite;

  constructor(private readonly deps: DependancesSession) {
    this.horloge = deps.horloge ?? (() => Date.now());
    this.alea = deps.alea ?? aleatoireParDefaut;
    this.politique = deps.politique ?? POLITIQUE_DEFAUT;
  }

  statut(): StatutSession {
    if (!this.deps.stockage.lire()) {
      return 'non-initialise';
    }
    return this.cleMaitresse ? 'deverrouille' : 'verrouille';
  }

  /** État du verrou temporaire imposé après des échecs répétés. */
  verrou(): Verrou {
    return evaluerVerrou(this.etatVerrou, this.horloge(), this.politique);
  }

  /**
   * Premier lancement : crée le coffre, le secret TOTP et les codes de
   * récupération, puis ouvre la base. La session est déverrouillée à l'issue.
   */
  initialiser(options: OptionsInitialisation): Initialisation {
    if (this.deps.stockage.lire()) {
      throw new ErreurSession('Le coffre existe déjà');
    }

    const { coffre, codesRecuperation, cleMaitresse } = creerCoffre({
      motDePasse: options.motDePasse,
      nombreCodes: options.nombreCodes,
      kdf: this.deps.kdf,
      alea: this.alea,
    });

    const secretTotp = genererSecretTotp(this.alea);
    const coffreComplet = definirSecretTotp(coffre, cleMaitresse, secretTotp, this.alea);
    this.deps.stockage.ecrire(coffreComplet);

    this.ouvrir(cleMaitresse);

    return {
      codesRecuperation,
      secretTotp,
      uriTotp: uriOtpauth({
        secret: secretTotp,
        compte: options.compte ?? 'portefeuille',
      }),
    };
  }

  /**
   * Déverrouillage nominal : mot de passe puis code TOTP.
   *
   * L'erreur renvoyée est volontairement la même dans les deux cas d'échec :
   * indiquer lequel des deux facteurs est faux renseignerait un attaquant.
   */
  deverrouiller(options: OptionsDeverrouillage): void {
    const coffre = this.exigerCoffre();
    this.exigerAbsenceDeTemporisation();

    let cleMaitresse: Uint8Array;
    try {
      cleMaitresse = deverrouillerParMotDePasse(coffre, options.motDePasse);
    } catch (erreur) {
      if (erreur instanceof ErreurDeverrouillage) {
        this.enregistrerEchec();
        throw new ErreurDeverrouillage('Mot de passe ou code incorrect');
      }
      throw erreur;
    }

    const secretTotp = lireSecretTotp(coffre, cleMaitresse);
    if (secretTotp && !verifierCodeTotp(secretTotp, options.codeTotp, this.horloge())) {
      // Le mot de passe était bon : la clé a été reconstituée. Elle est effacée
      // sans avoir servi, plutôt que gardée « au cas où ».
      cleMaitresse.fill(0);
      this.enregistrerEchec();
      throw new ErreurDeverrouillage('Mot de passe ou code incorrect');
    }

    this.ouvrir(cleMaitresse);
  }

  /**
   * Revérifie l'identité (mot de passe + code TOTP) d'une session déjà
   * ouverte, pour une action sensible. Mêmes contrôles et mêmes
   * temporisations après échec qu'au déverrouillage ; la clé reconstituée
   * est effacée aussitôt, rien ne change dans la session en cas de succès.
   */
  verifierIdentite(options: OptionsDeverrouillage): void {
    const coffre = this.exigerCoffre();
    this.exigerCleMaitresse();
    this.exigerAbsenceDeTemporisation();
    let cle: Uint8Array;
    try {
      cle = deverrouillerParMotDePasse(coffre, options.motDePasse);
    } catch (erreur) {
      if (erreur instanceof ErreurDeverrouillage) {
        this.enregistrerEchec();
        throw new ErreurDeverrouillage('Mot de passe ou code incorrect');
      }
      throw erreur;
    }
    const secretTotp = lireSecretTotp(coffre, cle);
    cle.fill(0);
    if (secretTotp && !verifierCodeTotp(secretTotp, options.codeTotp, this.horloge())) {
      this.enregistrerEchec();
      throw new ErreurDeverrouillage('Mot de passe ou code incorrect');
    }
  }

  /** État du coffre sans rien déchiffrer : TOTP enrôlé, codes de récupération restants. */
  etatCoffre(): { totpActif: boolean; codesRecuperation: number } | undefined {
    const coffre = this.deps.stockage.lire();
    if (!coffre) {
      return undefined;
    }
    return {
      totpActif: Boolean(coffre.totp),
      codesRecuperation: coffre.enveloppes.filter(enveloppe => enveloppe.usage === 'recuperation').length,
    };
  }

  /**
   * Reprise en main avec un code de récupération.
   * Le code est consommé et un nouveau mot de passe est défini dans la foulée :
   * un code de récupération sert à retrouver l'accès, pas à s'en passer.
   */
  recuperer(options: OptionsRecuperation): ResultatRecuperation {
    const coffre = this.exigerCoffre();
    this.exigerAbsenceDeTemporisation();

    let resultat;
    try {
      resultat = deverrouillerParCodeRecuperation(coffre, options.codeRecuperation);
    } catch (erreur) {
      if (erreur instanceof ErreurDeverrouillage) {
        this.enregistrerEchec();
      }
      throw erreur;
    }

    const coffreFinal = changerMotDePasseCoffre(
      resultat.coffre,
      resultat.cleMaitresse,
      options.nouveauMotDePasse,
      { kdf: this.deps.kdf, alea: this.alea },
    );
    this.deps.stockage.ecrire(coffreFinal);
    this.ouvrir(resultat.cleMaitresse);

    return { codesRestants: resultat.codesRestants };
  }

  /** Face ID ne peut que raccourcir une réouverture rapprochée, jamais remplacer les deux facteurs. */
  raccourciBiometriqueDisponible(): boolean {
    return (
      this.statut() !== 'non-initialise' &&
      raccourciBiometriqueAutorise(this.etatVerrou, this.horloge(), this.politique)
    );
  }

  changerMotDePasse(ancien: string, nouveau: string): void {
    const coffre = this.exigerCoffre();
    // On repart du mot de passe fourni plutôt que de la clé en mémoire :
    // changer de mot de passe doit exiger de connaître l'ancien.
    const cleMaitresse = deverrouillerParMotDePasse(coffre, ancien);
    this.deps.stockage.ecrire(
      changerMotDePasseCoffre(coffre, cleMaitresse, nouveau, {
        kdf: this.deps.kdf,
        alea: this.alea,
      }),
    );
  }

  /** Remplace tous les codes de récupération, par exemple après en avoir consommé un. */
  renouvelerCodesRecuperation(nombreCodes?: number): string[] {
    const coffre = this.exigerCoffre();
    const cleMaitresse = this.exigerCleMaitresse();

    const { coffre: renouvele, codesRecuperation } = regenererCodesRecuperation(
      coffre,
      cleMaitresse,
      { nombreCodes, kdf: this.deps.kdf, alea: this.alea },
    );
    this.deps.stockage.ecrire(renouvele);
    return codesRecuperation;
  }

  /**
   * Coffre de cet appareil, pour le partager avec les autres. Il n'est pas
   * secret : ses enveloppes ne s'ouvrent qu'avec le mot de passe ou un code
   * de récupération, et le secret TOTP y est scellé par la clé maîtresse.
   */
  coffreActuel(): Coffre | undefined {
    return this.deps.stockage.lire();
  }

  /**
   * Adopte le coffre d'un autre appareil : même mot de passe, même code
   * d'authentification, même clé maîtresse. Le portefeuille local est
   * effacé (il revient par la synchronisation) et la session se verrouille.
   */
  adopterCoffre(coffre: Coffre): void {
    if (
      !coffre ||
      typeof coffre.version !== 'number' ||
      !Array.isArray(coffre.enveloppes) ||
      !coffre.enveloppes.some(enveloppe => enveloppe.usage === 'motdepasse')
    ) {
      throw new ErreurSession('Ce coffre est illisible.');
    }
    this.verrouiller();
    this.deps.reinitialiserBase?.();
    this.deps.stockage.ecrire(coffre);
    this.etatVerrou = ETAT_INITIAL;
  }

  /**
   * Secret tiré de la clé maîtresse pour un usage donné (hexadécimal).
   * Identique sur tous les appareils qui partagent le coffre : c'est ce qui
   * leur donne la même clé de synchronisation sans autre mot de passe.
   */
  cleDerivee(usage: string): string {
    const cle = this.exigerCleMaitresse();
    return bytesToHex(sha256(concatBytes(utf8ToBytes(contexteDerivation(usage, this.deps.profil)), cle)));
  }

  /**
   * Dépose la clé maîtresse pour l'administrateur (séquestre), scellée pour
   * sa clé publique : ce profil ne peut pas relire le dépôt, ni rien tirer
   * de la clé publique. Le contexte lie le dépôt à ce compte.
   */
  deposerPourSequestre(publiqueAdmin: string, idCompte: string): string {
    return scellerPourAdmin(publiqueAdmin, this.exigerCleMaitresse(), usageSequestre(idCompte), this.alea);
  }

  /**
   * Ouvre la session avec une clé maîtresse obtenue autrement que par le mot
   * de passe : celle que l'administrateur relit du séquestre. La clé est
   * d'abord éprouvée contre le coffre (secret TOTP scellé) ; une clé fausse
   * est refusée sans rien ouvrir. La session prend possession de la clé.
   */
  ouvrirAvecCle(cleMaitresse: Uint8Array): void {
    const coffre = this.exigerCoffre();
    try {
      if (!coffre.totp) {
        throw new ErreurDeverrouillage('Coffre sans secret d’authentification : clé invérifiable.');
      }
      lireSecretTotp(coffre, cleMaitresse);
    } catch {
      cleMaitresse.fill(0);
      throw new ErreurDeverrouillage('Clé de séquestre refusée par ce coffre.');
    }
    this.verrouiller();
    this.ouvrir(cleMaitresse);
  }

  /** Base ouverte. Lève tant que la session est verrouillée. */
  base(): PiloteSqlite {
    if (!this.pilote) {
      throw new ErreurSession('Session verrouillée');
    }
    return this.pilote;
  }

  /** Ferme la base et efface la clé de la mémoire. */
  verrouiller(): void {
    this.pilote?.fermer();
    this.pilote = undefined;
    this.cleMaitresse?.fill(0);
    this.cleMaitresse = undefined;
  }

  private ouvrir(cleMaitresse: Uint8Array): void {
    try {
      this.pilote = this.deps.ouvrirBase(cleHexadecimale(cleMaitresse));
      migrer(this.pilote);
    } catch (erreur) {
      // Base refusée (profil fermé, fichier illisible) : la clé ne reste pas en mémoire.
      this.pilote = undefined;
      cleMaitresse.fill(0);
      throw erreur;
    }
    this.cleMaitresse = cleMaitresse;
    this.etatVerrou = apresSucces(this.horloge());
  }

  private exigerCoffre(): Coffre {
    const coffre = this.deps.stockage.lire();
    if (!coffre) {
      throw new ErreurSession('Aucun coffre : l’application n’est pas initialisée');
    }
    return coffre;
  }

  private exigerCleMaitresse(): Uint8Array {
    if (!this.cleMaitresse) {
      throw new ErreurSession('Session verrouillée');
    }
    return this.cleMaitresse;
  }

  private exigerAbsenceDeTemporisation(): void {
    const verrou = this.verrou();
    if (verrou.verrouille) {
      throw new ErreurTemporisation(verrou.secondesRestantes);
    }
  }

  private enregistrerEchec(): void {
    this.etatVerrou = apresEchec(this.etatVerrou, this.horloge());
  }
}

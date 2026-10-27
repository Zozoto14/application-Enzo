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
import { ecouterEcritures } from '../db/ecoute';
import { migrer } from '../db/schema';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import {
  ErreurCalculCle,
  ErreurDeverrouillage,
  changerMotDePasse as changerMotDePasseCoffre,
  cleHexadecimale,
  creerCoffre,
  definirSecretTotp,
  deverrouillerParCodeRecuperation,
  deverrouillerParMotDePasse,
  exempterTotp,
  lireSecretTotp,
  totpExige,
  regenererCodesRecuperation,
  remplacerCodesRecuperation,
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
import { formeCanonique } from '../profils/invitation';
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

/** Contexte du dépôt pour un titulaire (le compte historique garde le contexte d'origine). */
export function usageDepotTitulaire(titulaire: string, idCompte: string): string {
  return titulaire === 'principal' ? usageSequestre(idCompte) : `sequestre/titulaire/${titulaire}/${idCompte}`;
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

/**
 * Les identifiants sont justes pour le coffre publié par un autre appareil
 * (le PC), mais le portefeuille de cet appareil est scellé par une autre clé :
 * il faut relier ce navigateur au compte (« Lier à mon compte »).
 */
export class ErreurCoffreDifferent extends ErreurSession {
  constructor() {
    super(
      'Ces identifiants ouvrent le compte publié par votre PC, mais ce navigateur garde les données d’un autre coffre (créé ici autrefois). Pour le remplacer : effacez les données de ce site dans les réglages du navigateur, puis « Se connecter » avec votre identifiant et votre mot de passe (vos données reviennent du serveur).',
    );
    this.name = 'ErreurCoffreDifferent';
  }
}

/**
 * Mot de passe (et code) JUSTES, mais la base gardée sur cet appareil est scellée par une autre
 * clé maîtresse que celle du coffre du compte : compte recréé (« Régénérer les identifiants »)
 * pendant que cet appareil gardait l'ancienne base, ou copie publiée par un appareil resté sur
 * l'ancienne clé. Le mot de passe ne peut rien y faire (une réinitialisation garde la clé du
 * compte) : la base du serveur, qui fait référence, est reprise sur demande explicite
 * (`deverrouiller({ repartirDuServeur: true })`), l'ancienne copie mise de côté, jamais effacée.
 * Ce n'est pas un échec d'authentification : aucune tentative n'est comptée.
 */
export class ErreurBaseIllisible extends ErreurSession {
  readonly code = 'base-autre-cle';
  constructor() {
    super(
      'Ton mot de passe est bon, mais les données gardées sur cet appareil sont scellées par une ancienne clé de ton compte (compte recréé, ou accès réinitialisé alors que cet appareil gardait une ancienne copie) : elles ne s’ouvrent plus. Touche « Reprendre mes données du serveur » : tes données enregistrées sur le serveur reviennent, et l’ancienne copie de cet appareil est mise de côté (rien n’est effacé).',
    );
    this.name = 'ErreurBaseIllisible';
  }
}

/**
 * Le mot de passe temporaire d'une invitation n'ouvre plus le coffre : il a
 * déjà été remplacé (invitation utilisée), ou le Fondateur a réinitialisé l'accès.
 */
export class ErreurInvitationUtilisee extends ErreurSession {
  constructor() {
    super('Cette invitation a déjà été utilisée (ou remplacée) : connecte-toi avec ton prénom et ton mot de passe, ou demande un nouveau lien.');
    this.name = 'ErreurInvitationUtilisee';
  }
}

/** Seul message d'échec d'authentification : il ne dit jamais quel facteur est faux. */
export const MESSAGE_ECHEC = 'Mot de passe ou code incorrect';

/** Échec sur un coffre sans code TOTP (mot de passe choisi par invitation) : un seul facteur, message précis. */
export const MESSAGE_ECHEC_MOT_DE_PASSE =
  'Mot de passe incorrect. Vérifie les majuscules et les accents ; s’il est oublié, touche « Mot de passe oublié ».';

/** Caractères invisibles qu'un copier-coller (gestionnaire, notes, courriel) peut ajouter. */
const INVISIBLES = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/**
 * Formes du mot de passe essayées, dans l'ordre, la saisie BRUTE d'abord.
 *
 * Compatibilité : la dérivation a toujours reçu la chaîne telle quelle (aucune
 * normalisation à la création). Essayer la valeur brute en premier garantit
 * qu'un mot de passe existant qui commence ou finit par un espace, ou qui est
 * en NFD, s'ouvre exactement comme avant. Les formes suivantes ne servent que
 * si la brute échoue : NFC (clavier ou gestionnaire qui recompose les
 * accents), puis sans caractères invisibles ni espaces/retours à la ligne de
 * début et de fin (copier-coller). Au plus trois dérivations, une seule
 * tentative comptée : la protection en ligne reste celle du limiteur, et une
 * attaque hors ligne n'y gagne rien.
 */
export function variantesMotDePasse(saisi: string, canonique = false): string[] {
  if (canonique) {
    // Coffre scellé sous la forme canonique (mot de passe choisi par invitation) : une seule dérivation.
    const forme = formeCanonique(saisi);
    return forme.length > 0 ? [forme] : [];
  }
  const nfc = saisi.normalize('NFC');
  const nettoye = nfc.replace(INVISIBLES, '').trim();
  // En dernier : guillemets typographiques et espaces insécables (copie depuis une messagerie).
  const formes = [saisi, nfc, nettoye, formeCanonique(saisi)].filter(forme => forme.length > 0);
  return [...new Set(formes)];
}

/** Le code TOTP saisi, réduit à ses chiffres (espace « 123 456 », chiffres pleine chasse, caractères invisibles). */
export function normaliserCodeTotp(saisi: string): string {
  return saisi.normalize('NFKC').replace(/\D/g, '');
}

/**
 * Coffre d'un ami après l'acceptation de son invitation (sans rien ouvrir) :
 * le temporaire l'ouvre, le mot de passe choisi (forme canonique) le remplace,
 * le code TOTP n'est plus exigé. Lève `ErreurInvitationUtilisee` si le
 * temporaire ne l'ouvre plus. La clé rendue est à effacer après usage.
 */
export function coffreApresInvitation(
  coffre: Coffre,
  temporaire: string,
  choisi: string,
  options: { kdf?: ParametresKdf; alea?: SourceAleatoire } = {},
): { coffre: Coffre; cle: Uint8Array } {
  const nouveau = formeCanonique(choisi);
  if (nouveau.length === 0) {
    throw new ErreurSession('Choisissez un mot de passe.');
  }
  let cle: Uint8Array;
  try {
    cle = deverrouillerParMotDePasse(coffre, temporaire);
  } catch (erreur) {
    if (erreur instanceof ErreurDeverrouillage) {
      throw new ErreurInvitationUtilisee();
    }
    throw erreur instanceof ErreurCalculCle ? erreur : new ErreurCalculCle(erreur);
  }
  const alea = options.alea ?? aleatoireParDefaut;
  const final: Coffre = { ...exempterTotp(changerMotDePasseCoffre(coffre, cle, nouveau, { kdf: options.kdf, alea }), cle, alea), canonique: true };
  return { coffre: final, cle };
}

export type StatutSession = 'non-initialise' | 'verrouille' | 'deverrouille';

export interface DependancesSession {
  stockage: StockageCoffre;
  /**
   * Ouvre la base avec la clé donnée, au format hexadécimal attendu par
   * SQLCipher. C'est le seul endroit qui connaît le pilote concret.
   */
  ouvrirBase(cleHexadecimale: string, options?: OptionsOuvertureBase): PiloteSqlite;
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
   * Autres coffres du même compte, essayés si le coffre local refuse le mot
   * de passe : celui que le PC a publié sur le relais, plus récent quand le
   * mot de passe y a été changé. Adopté seulement s'il ouvre aussi la base
   * de cet appareil (même clé maîtresse).
   */
  coffresAlternatifs?(): readonly Coffre[];
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
  /**
   * Après `ErreurBaseIllisible` seulement, sur demande explicite : la base de cet appareil
   * (scellée par une autre clé) est mise de côté et une base neuve s'ouvre, que la
   * synchronisation remplit depuis le serveur. Sans effet si la base s'ouvre normalement, et
   * jamais avant que mot de passe et code aient été vérifiés.
   */
  repartirDuServeur?: boolean;
}

/** Ce que `ouvrirBase` reçoit en plus de la clé. */
export interface OptionsOuvertureBase {
  /** Voir `OptionsDeverrouillage.repartirDuServeur`. */
  repartir?: boolean;
}

export interface OptionsRecuperation {
  codeRecuperation: string;
  /** Un code de récupération sert à reprendre la main, donc à redéfinir un mot de passe. */
  nouveauMotDePasse: string;
}

export interface ResultatRecuperation {
  codesRestants: number;
}

/** JSON aux clés triées : deux copies d'un même coffre se reconnaissent quel que soit l'ordre. */
function canonique(valeur: unknown): string {
  return JSON.stringify(valeur, (_cle, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Forme minimale d'un coffre utilisable (au moins une enveloppe de mot de passe). */
export function coffreValide(coffre: unknown): coffre is Coffre {
  const c = coffre as Coffre | undefined;
  return Boolean(
    c &&
      typeof c === 'object' &&
      typeof c.version === 'number' &&
      Array.isArray(c.enveloppes) &&
      c.enveloppes.some(
        enveloppe =>
          enveloppe &&
          enveloppe.usage === 'motdepasse' &&
          typeof enveloppe.sel === 'string' &&
          typeof enveloppe.nonce === 'string' &&
          typeof enveloppe.charge === 'string' &&
          Boolean(enveloppe.kdf),
      ),
  );
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

    // ErreurCalculCle (mémoire, navigateur) traverse : ce n'est pas un échec
    // d'authentification, il ne compte pas comme tentative.
    const trouve = this.essayerMotDePasse(coffre, options.motDePasse, true);
    if (!trouve) {
      this.enregistrerEchec();
      // Coffre sans code (mot de passe choisi par invitation) : le seul facteur est le mot de passe, on le dit.
      throw new ErreurDeverrouillage(coffre.sansTotp ? MESSAGE_ECHEC_MOT_DE_PASSE : MESSAGE_ECHEC);
    }

    const secretTotp = lireSecretTotp(trouve.coffre, trouve.cle);
    if (secretTotp && totpExige(trouve.coffre, trouve.cle) && !verifierCodeTotp(secretTotp, normaliserCodeTotp(options.codeTotp), this.horloge())) {
      // Le mot de passe était bon : la clé a été reconstituée. Elle est effacée
      // sans avoir servi, plutôt que gardée « au cas où ».
      trouve.cle.fill(0);
      this.enregistrerEchec();
      throw new ErreurDeverrouillage(MESSAGE_ECHEC);
    }

    if (trouve.coffre === coffre) {
      this.ouvrir(trouve.cle, options.repartirDuServeur ? { repartir: true } : undefined);
      return;
    }
    // Coffre plus récent publié par un autre appareil : adopté seulement s'il
    // ouvre la base d'ici (même clé maîtresse, mot de passe changé ailleurs).
    try {
      this.ouvrir(trouve.cle);
    } catch {
      throw new ErreurCoffreDifferent();
    }
    this.deps.stockage.ecrire(trouve.coffre);
  }

  /**
   * Clé maîtresse ouverte par l'une des formes du mot de passe, dans le
   * coffre local puis (si permis) dans les coffres alternatifs.
   */
  private essayerMotDePasse(
    coffre: Coffre,
    motDePasse: string,
    alternatifs: boolean,
  ): { cle: Uint8Array; coffre: Coffre } | undefined {
    const variantes = variantesMotDePasse(motDePasse);
    const vus = new Set([canonique(coffre)]);
    const candidats = [coffre];
    if (alternatifs) {
      for (const autre of this.deps.coffresAlternatifs?.() ?? []) {
        if (coffreValide(autre) && !vus.has(canonique(autre))) {
          vus.add(canonique(autre));
          candidats.push(autre);
        }
      }
    }
    for (const candidat of candidats) {
      for (const variante of candidat.canonique ? variantesMotDePasse(motDePasse, true) : variantes) {
        try {
          return { cle: deverrouillerParMotDePasse(candidat, variante), coffre: candidat };
        } catch (erreur) {
          if (!(erreur instanceof ErreurDeverrouillage)) {
            throw erreur instanceof ErreurCalculCle ? erreur : new ErreurCalculCle(erreur);
          }
        }
      }
    }
    return undefined;
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
    const trouve = this.essayerMotDePasse(coffre, options.motDePasse, false);
    if (!trouve) {
      this.enregistrerEchec();
      throw new ErreurDeverrouillage(MESSAGE_ECHEC);
    }
    const secretTotp = lireSecretTotp(coffre, trouve.cle);
    const exige = totpExige(coffre, trouve.cle);
    trouve.cle.fill(0);
    if (secretTotp && exige && !verifierCodeTotp(secretTotp, normaliserCodeTotp(options.codeTotp), this.horloge())) {
      this.enregistrerEchec();
      throw new ErreurDeverrouillage(MESSAGE_ECHEC);
    }
  }

  /**
   * État du coffre sans rien déchiffrer : TOTP enrôlé, codes de récupération
   * restants, et si l'écran doit demander le code à six chiffres (`codeDemande`,
   * simple indication : l'exemption n'est crue qu'une fois la clé reconstituée).
   */
  etatCoffre(): { totpActif: boolean; codesRecuperation: number; codeDemande: boolean } | undefined {
    const coffre = this.deps.stockage.lire();
    if (!coffre) {
      return undefined;
    }
    return {
      totpActif: Boolean(coffre.totp),
      codesRecuperation: coffre.enveloppes.filter(enveloppe => enveloppe.usage === 'recuperation').length,
      codeDemande: Boolean(coffre.totp) && !coffre.sansTotp,
    };
  }

  /**
   * Acceptation d'une invitation : le mot de passe TEMPORAIRE (porté par
   * l'invitation) ouvre le coffre, puis le mot de passe CHOISI le remplace
   * (forme canonique), et le code TOTP n'est plus demandé. Le temporaire
   * cesse aussitôt de marcher : l'invitation ne sert qu'une fois. La session
   * est ouverte à l'issue. Le coffre écrit est rendu (à publier sur le relais).
   */
  accepterInvitation(temporaire: string, choisi: string): Coffre {
    const coffre = this.exigerCoffre();
    this.exigerAbsenceDeTemporisation();
    const { coffre: final, cle } = coffreApresInvitation(coffre, temporaire, choisi, { kdf: this.deps.kdf, alea: this.alea });
    this.deps.stockage.ecrire(final);
    this.verrouiller();
    this.ouvrir(cle);
    return final;
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
      resultat.coffre.canonique ? formeCanonique(options.nouveauMotDePasse) : options.nouveauMotDePasse,
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
    const cleMaitresse = coffre.canonique ? deverrouillerParMotDePasse(coffre, formeCanonique(ancien)) : deverrouillerParMotDePasse(coffre, ancien);
    this.deps.stockage.ecrire(
      changerMotDePasseCoffre(coffre, cleMaitresse, coffre.canonique ? formeCanonique(nouveau) : nouveau, {
        kdf: this.deps.kdf,
        alea: this.alea,
      }),
    );
  }

  /**
   * Connexion par identifiant + mot de passe (relais version 9, migration du Fondateur) : l'identité
   * est revérifiée (mot de passe actuel, et code à six chiffres si le coffre en exige un), puis le
   * coffre est rescellé par le NOUVEAU mot de passe sous sa forme canonique, le code à six chiffres
   * n'est plus exigé (le serveur vérifie une preuve du mot de passe et freine les essais), et de
   * nouveaux codes de récupération sont tirés (rendus en clair, une seule fois). La clé maîtresse
   * ne change pas : aucune donnée n'est rechiffrée, la base s'ouvre comme avant.
   */
  passerAConnexionParIdentifiant(options: {
    motDePasseActuel: string;
    codeTotp: string;
    nouveauMotDePasse: string;
    nombreCodes?: number;
    /** Codes déjà tirés (et publiés pour l'accès de secours) : ils remplacent les anciens. */
    codes?: readonly string[];
    /**
     * Validation en deux étapes gardée (version 10 : le serveur vérifie le code à la connexion) : le
     * coffre continue d'exiger le code à six chiffres ici aussi, avec le même secret.
     */
    garderCode?: boolean;
  }): { coffre: Coffre; codesRecuperation: string[] } {
    this.verifierIdentite({ motDePasse: options.motDePasseActuel, codeTotp: options.codeTotp });
    const cle = this.exigerCleMaitresse();
    const nouveau = formeCanonique(options.nouveauMotDePasse);
    if (nouveau.length === 0) {
      throw new ErreurSession('Choisissez un mot de passe.');
    }
    const avecMotDePasse = changerMotDePasseCoffre(this.exigerCoffre(), cle, nouveau, { kdf: this.deps.kdf, alea: this.alea });
    const { coffre: avecCodes, codesRecuperation } = options.codes
      ? { coffre: remplacerCodesRecuperation(avecMotDePasse, cle, options.codes, { kdf: this.deps.kdf, alea: this.alea }), codesRecuperation: [...options.codes] }
      : regenererCodesRecuperation(avecMotDePasse, cle, { nombreCodes: options.nombreCodes, kdf: this.deps.kdf, alea: this.alea });
    const final: Coffre = { ...(options.garderCode && avecCodes.totp ? avecCodes : exempterTotp(avecCodes, cle, this.alea)), canonique: true };
    this.deps.stockage.ecrire(final);
    return { coffre: final, codesRecuperation };
  }

  /**
   * Secret TOTP de ce coffre (session déverrouillée) : confié au serveur, qui vérifie le code à la
   * connexion par identifiant (validation en deux étapes, relais version 10). Même secret : la même
   * application d'authentification continue de servir.
   */
  secretTotp(): string | undefined {
    return lireSecretTotp(this.exigerCoffre(), this.exigerCleMaitresse());
  }

  /** Le code à six chiffres n'est plus exigé à l'ouverture sur cet appareil (A2F désactivée). */
  exempterCodeLocal(): Coffre {
    const final = exempterTotp(this.exigerCoffre(), this.exigerCleMaitresse(), this.alea);
    this.deps.stockage.ecrire(final);
    return final;
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
    if (!coffreValide(coffre)) {
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
   * Dépose la clé maîtresse pour un titulaire autre que le compte historique
   * (Administrateur, Fondateur), avec le prénom et la date de création du
   * compte pour son bloc privé. Même ECIES ; le contexte nomme le titulaire.
   */
  deposerPourTitulaire(publique: string, titulaire: string, idCompte: string, meta: { nom?: string; creeLe?: string } = {}): string {
    const k = bytesToHex(this.exigerCleMaitresse());
    return scellerPourAdmin(publique, utf8ToBytes(JSON.stringify({ k, ...meta })), usageDepotTitulaire(titulaire, idCompte), this.alea);
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

  private readonly ecouteurs = new Set<() => void>();

  /** Prévient à chaque écriture d'une donnée synchronisée (voir db/ecoute.ts). Renvoie la fonction qui désabonne. */
  surEcriture(rappel: () => void): () => void {
    this.ecouteurs.add(rappel);
    return () => void this.ecouteurs.delete(rappel);
  }

  /** Base ouverte. Lève tant que la session est verrouillée. */
  base(): PiloteSqlite {
    if (!this.pilote) {
      throw new ErreurSession('Session verrouillée');
    }
    return this.pilote;
  }

  private readonly ouvertures = new Set<() => void>();
  private readonly fermetures = new Set<() => void>();

  /**
   * Prévient juste après chaque ouverture de la base (déverrouillage, code de
   * récupération, séquestre), avant que l'interface ne se redessine : la
   * synchronisation y fusionne ce qu'elle a reçu avant le déverrouillage.
   */
  surOuverture(rappel: () => void): () => void {
    this.ouvertures.add(rappel);
    return () => void this.ouvertures.delete(rappel);
  }

  /** Prévient juste avant de fermer la base (la base est encore lisible). */
  surFermeture(rappel: () => void): () => void {
    this.fermetures.add(rappel);
    return () => void this.fermetures.delete(rappel);
  }

  /** Ferme la base et efface la clé de la mémoire. */
  verrouiller(): void {
    if (this.pilote) {
      for (const rappel of [...this.fermetures]) {
        try {
          rappel();
        } catch {
          // Un abonné fautif n'empêche jamais de verrouiller.
        }
      }
    }
    this.pilote?.fermer();
    this.pilote = undefined;
    this.cleMaitresse?.fill(0);
    this.cleMaitresse = undefined;
  }

  private ouvrir(cleMaitresse: Uint8Array, options?: OptionsOuvertureBase): void {
    try {
      const brut = options ? this.deps.ouvrirBase(cleHexadecimale(cleMaitresse), options) : this.deps.ouvrirBase(cleHexadecimale(cleMaitresse));
      migrer(brut);
      this.pilote = ecouterEcritures(brut, this.ecouteurs);
    } catch (erreur) {
      // Base refusée (profil fermé, fichier illisible) : la clé ne reste pas en mémoire.
      this.pilote = undefined;
      cleMaitresse.fill(0);
      throw erreur;
    }
    this.cleMaitresse = cleMaitresse;
    this.etatVerrou = apresSucces(this.horloge());
    for (const rappel of [...this.ouvertures]) {
      try {
        rappel();
      } catch {
        // La fusion du cache est un plus : son échec n'empêche pas d'ouvrir.
      }
    }
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

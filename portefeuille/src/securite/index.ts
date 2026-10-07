/**
 * Couche de sécurité : dérivation de clé, coffre à enveloppes, TOTP,
 * codes de récupération et politique de déverrouillage.
 *
 * Entièrement en JavaScript pur (@noble/hashes, @noble/ciphers) : aucun module
 * natif, donc tout est exécutable et testable sur le PC comme sur l'appareil.
 */

export {
  aleatoireDeterministe,
  aleatoireParDefaut,
  type SourceAleatoire,
} from './aleatoire';

export {
  ALPHABET_CROCKFORD,
  ALPHABET_RFC4648,
  ErreurEncodage,
  depuisBase32,
  depuisCrockford,
  egaliteConstante,
  normaliserCrockford,
  versBase32,
  versCrockford,
} from './encodage';

export {
  ErreurKdf,
  LONGUEUR_SEL,
  PARAMETRES_KDF_DEFAUT,
  deriverCle,
  type ParametresKdf,
} from './kdf';

export {
  ErreurDeverrouillage,
  LONGUEUR_CLE_MAITRESSE,
  NOMBRE_CODES_DEFAUT,
  VERSION_COFFRE,
  changerMotDePasse,
  cleHexadecimale,
  creerCoffre,
  definirSecretTotp,
  deverrouillerParCodeRecuperation,
  deverrouillerParMotDePasse,
  lireSecretTotp,
  regenererCodesRecuperation,
  type Coffre,
  type CoffreCree,
  type DeverrouillageRecuperation,
  type Enveloppe,
  type OptionsCreation,
  type UsageEnveloppe,
} from './coffre';

export {
  formatValide,
  genererCodeRecuperation,
  normaliserCode,
} from './codes-recuperation';

export {
  codeHotp,
  codeTotp,
  fenetreCourante,
  genererSecretTotp,
  uriOtpauth,
  verifierCodeTotp,
  type AlgorithmeTotp,
  type OptionsTotp,
  type OptionsUri,
  type OptionsVerification,
} from './totp';

export {
  ETAT_INITIAL,
  POLITIQUE_DEFAUT,
  apresEchec,
  apresSucces,
  evaluerVerrou,
  raccourciBiometriqueAutorise,
  temporisationApresEchecs,
  type EtatVerrouillage,
  type PolitiqueVerrouillage,
  type Verrou,
} from './politique';

export {
  ErreurScelle,
  LONGUEUR_NONCE,
  SIGNATURE,
  VERSION_SCELLE,
  descellerOctets,
  estScelle,
  scellerOctets,
} from './scelle';

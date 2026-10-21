/**
 * Invitation d'un ami et connexion par identifiant (voir docs/connexion-amis.md).
 *
 * Le Fondateur crée le compte d'un ami (un coffre ordinaire, au mot de passe
 * TEMPORAIRE tiré au hasard) puis lui envoie une INVITATION : un lien dont le
 * secret voyage dans le fragment `#invitation=…` (jamais envoyé à un serveur).
 * L'ami ouvre le lien sur n'importe quel appareil, choisit SON mot de passe :
 * le coffre est rescellé par ce mot de passe (le temporaire cesse aussitôt de
 * marcher : l'invitation ne sert qu'une fois), et il n'a plus de code TOTP à
 * saisir (exemption scellée par sa clé maîtresse, voir `exempterTotp`).
 *
 * Deux formes d'invitation :
 *  - `relais` (relais version 6) : le lien ne porte que l'adresse du relais et
 *    un secret de 32 octets. Le relais garde le contenu SCELLÉ par une clé tirée
 *    de ce secret (il ne peut pas l'ouvrir), le rend une seule fois, refuse
 *    après l'expiration ou une révocation, et freine les essais ;
 *  - `lien` (relais pas encore redéployé) : le contenu est dans le lien
 *    lui-même. L'usage unique tient au mot de passe temporaire (remplacé à
 *    l'acceptation) ; l'expiration est vérifiée par l'appareil.
 *
 * Connexion d'un nouvel appareil par identifiant + mot de passe (relais v6) :
 * l'ami dépose sur le relais un « accès » : le nécessaire pour retrouver son
 * compte (jeton de profil), scellé par une clé tirée de son mot de passe
 * (Argon2id), et un témoin qui permet au relais de vérifier le mot de passe
 * sans le connaître (il compare l'empreinte d'une preuve dérivée). Le relais
 * ne voit jamais ni le mot de passe, ni la clé, ni le jeton en clair, et il
 * limite les essais (délai progressif).
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import { PARAMETRES_KDF_DEFAUT, deriverCle, type ParametresKdf } from '../securite/kdf';
import { descellerAvecContexte, normaliserNom, scellerAvecContexte, utf8DepuisOctets } from '../securite/sequestre';
import { normaliserCrockford, versCrockford } from '../securite/encodage';
import { normaliserCode as normaliserCodeRecuperation } from '../securite/codes-recuperation';

// ------------------------------------------------------------ Saisies

/** Caractères invisibles qu'un copier-coller (messagerie, notes, courriel) peut ajouter. */
const INVISIBLES = /[​-‍⁠﻿­‪-‮⁦-⁩]/g;
/** Espaces « exotiques » (insécable, fine…) : un espace ordinaire. */
const ESPACES = /[  -   　]/g;

/**
 * Identifiant tel qu'on l'affiche et le retient : NFC, sans caractères
 * invisibles, espaces multiples réduits, sans espace au bord. La casse et les
 * accents sont gardés pour l'affichage ; la COMPARAISON passe par `cleIdentifiant`.
 */
export function normaliserIdentifiant(saisie: string): string {
  return saisie.normalize('NFC').replace(INVISIBLES, '').replace(ESPACES, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** Forme comparée : insensible à la casse, aux accents (NFC/NFD), aux espaces. */
export function cleIdentifiant(saisie: string): string {
  return normaliserNom(normaliserIdentifiant(saisie));
}

/**
 * Forme canonique d'un mot de passe, appliquée à la CRÉATION comme à la
 * saisie (coffres marqués `canonique`) : Unicode NFC (iOS compose les accents
 * autrement que Windows), sans caractères invisibles, espaces exotiques
 * ramenés à l'espace ordinaire, apostrophes et guillemets typographiques
 * (ponctuation « intelligente » d'iOS) ramenés à leur forme droite, et sans
 * espace ni retour à la ligne AU BORD (copier-coller depuis un message). Le
 * milieu du mot de passe n'est jamais modifié autrement.
 */
export function formeCanonique(motDePasse: string): string {
  return motDePasse
    .normalize('NFC')
    .replace(INVISIBLES, '')
    .replace(ESPACES, ' ')
    .replace(/[‘’‚‛′´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/^[\s]+|[\s]+$/g, '');
}

export const LONGUEUR_MIN_AMI = 10;

/**
 * Politique du mot de passe d'un ami, réglée par le Fondateur (Administration
 * › Réglages) et portée, scellée, par l'invitation : longueur minimale (10 à
 * 64) et force minimale (1 Correct … 4 Excellent). Les règles de base
 * (10 caractères, pas seulement des chiffres, ni le prénom…) s'appliquent
 * toujours : la politique ne peut que les durcir.
 */
export interface PolitiqueMdp {
  longueurMin: number;
  forceMin: 1 | 2 | 3 | 4;
}
export const POLITIQUE_MDP_DEFAUT: PolitiqueMdp = { longueurMin: LONGUEUR_MIN_AMI, forceMin: 1 };
export const LIBELLES_FORCE = ['Trop faible', 'Correct', 'Bien', 'Solide', 'Excellent'] as const;

/** Politique lue d'une source quelconque, bornée ; undefined si absente ou illisible. */
export function lirePolitiqueMdp(brut: unknown): PolitiqueMdp | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const l = typeof o.l === 'number' ? o.l : o.longueurMin;
  const f = typeof o.f === 'number' ? o.f : o.forceMin;
  if (typeof l !== 'number' || typeof f !== 'number' || !Number.isFinite(l) || !Number.isFinite(f)) return undefined;
  return { longueurMin: Math.min(64, Math.max(LONGUEUR_MIN_AMI, Math.round(l))), forceMin: Math.min(4, Math.max(1, Math.round(f))) as PolitiqueMdp['forceMin'] };
}

const COURANTS = ['motdepasse', 'password', 'azerty', 'qwerty', '123456', 'soleil', 'bonjour', 'doudou', 'loulou', 'chouchou', 'iloveyou', 'marseille', 'football', 'appdashboard'];

export interface EvaluationMotDePasse {
  /** Vrai quand le mot de passe respecte les règles (il peut être choisi). */
  valide: boolean;
  /** Règles non respectées, en clair. */
  erreurs: string[];
  /** 0 (très faible) à 4 (excellent). */
  force: 0 | 1 | 2 | 3 | 4;
  libelle: string;
}

/**
 * Règles d'un mot de passe choisi par un ami : 10 caractères au moins (après
 * forme canonique), pas seulement des chiffres, ni son prénom, ni un mot de
 * passe courant. L'indicateur de force compte la longueur et la variété.
 */
export function evaluerMotDePasse(saisi: string, prenom = '', politique: PolitiqueMdp = POLITIQUE_MDP_DEFAUT): EvaluationMotDePasse {
  const mdp = formeCanonique(saisi);
  const erreurs: string[] = [];
  const longueurMin = Math.max(LONGUEUR_MIN_AMI, politique.longueurMin);
  if (mdp.length < longueurMin) erreurs.push(`${longueurMin} caractères au moins (${mdp.length} pour l’instant).`);
  if (mdp.length > 0 && /^\d+$/.test(mdp)) erreurs.push('Pas seulement des chiffres.');
  const bas = normaliserNom(mdp).replace(/\s+/g, '');
  const nom = normaliserNom(prenom).replace(/\s+/g, '');
  const lettres = bas.replace(/[^a-z]/g, '');
  if (nom.length >= 3 && lettres.includes(nom.replace(/[^a-z]/g, '')) && lettres.length - nom.length < 4) erreurs.push('Pas ton prénom (ou presque).');
  if (COURANTS.some(c => (bas.startsWith(c) && bas.length - c.length <= 4) || (lettres.startsWith(c) && lettres.length - c.length < 3))) erreurs.push('Trop courant : choisis autre chose.');
  if (mdp.length > 0 && new Set(mdp).size <= 2) erreurs.push('Trop répétitif.');
  const classes = [/[a-zà-ÿ]/, /[A-ZÀ-Þ]/, /\d/, /[^A-Za-zÀ-ÿ0-9]/].filter(m => m.test(mdp)).length;
  let force: EvaluationMotDePasse['force'] = 0;
  if (erreurs.length === 0) {
    const points = (mdp.length >= 12 ? 1 : 0) + (mdp.length >= 16 ? 1 : 0) + (mdp.length >= 20 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (classes >= 2 ? 1 : 0);
    force = Math.max(1, Math.min(4, points)) as EvaluationMotDePasse['force'];
    if (force < politique.forceMin) {
      erreurs.push(`Plus solide : force « ${LIBELLES_FORCE[politique.forceMin]} » au moins (ajoute des mots, des chiffres ou des symboles).`);
    }
  }
  const libelle = LIBELLES_FORCE[force];
  return { valide: erreurs.length === 0, erreurs, force, libelle };
}

// ------------------------------------------------------------ Code d'invitation

export const PREFIXE_INVITATION = 'AI1.';
const VERSION = 1;
const MOTIF_ID_COMPTE = /^[a-z0-9]{6,16}$/;

/** Ce que l'ami reçoit (scellé dans le relais, ou porté par le lien). */
export interface ContenuInvitation {
  v: 1;
  /** Identifiant opaque du compte. */
  compte: string;
  /** Prénom (identifiant de connexion), tel que le Fondateur l'a saisi. */
  prenom: string;
  /** Jeton de profil du relais (n'ouvre que l'espace de ce compte). */
  jeton: string;
  relais: string;
  site?: string;
  /** Mot de passe TEMPORAIRE du coffre (remplacé à l'acceptation). */
  mdp: string;
  /** Fin de validité (ISO). */
  expire: string;
  /** Prénom du Fondateur, pour les messages (« demande à … »). */
  fondateur?: string;
  creeLe: string;
  /** Politique du mot de passe à choisir (`l` longueur minimale, `f` force minimale) ; absente : règles de base. */
  politique?: { l: number; f: number };
}

export interface LienInvitationRelais {
  mode: 'relais';
  relais: string;
  site?: string;
  /** Secret de 32 octets, en base 64 URL. */
  secret: string;
}

export interface LienInvitationDirect {
  mode: 'lien';
  relais: string;
  site?: string;
  contenu: ContenuInvitation;
}

export type LienInvitation = LienInvitationRelais | LienInvitationDirect;

export class ErreurInvitation extends Error {
  constructor(
    readonly code: CodeErreurConnexion,
    message?: string,
  ) {
    super(message ?? messageErreur(code));
    this.name = 'ErreurInvitation';
  }
}

function versBase64Url(octets: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let sortie = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i];
    const b = octets[i + 1];
    const c = octets[i + 2];
    sortie += table[a >> 2] + table[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) sortie += table[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) sortie += table[c & 63];
  }
  return sortie;
}

function depuisBase64Url(texte: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const propre = texte.replace(/[^A-Za-z0-9_-]/g, '');
  const octets: number[] = [];
  let tampon = 0;
  let bits = 0;
  for (const c of propre) {
    tampon = (tampon << 6) | table.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets.push((tampon >> bits) & 0xff);
    }
  }
  return Uint8Array.from(octets);
}

const adresseValide = (a: unknown): a is string => typeof a === 'string' && /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(a) && a.length <= 300;
const propreAdresse = (a: string) => a.trim().replace(/\/+$/, '');

function lireContenu(brut: unknown): ContenuInvitation | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  if (
    o.v !== 1 ||
    typeof o.compte !== 'string' ||
    !MOTIF_ID_COMPTE.test(o.compte) ||
    typeof o.prenom !== 'string' ||
    !o.prenom.trim() ||
    typeof o.jeton !== 'string' ||
    !/^p1\.[a-z0-9]{6,16}\.[0-9a-f]{64}$/.test(o.jeton) ||
    !o.jeton.startsWith(`p1.${o.compte}.`) ||
    !adresseValide(o.relais) ||
    typeof o.mdp !== 'string' ||
    o.mdp.length < 8 ||
    typeof o.expire !== 'string' ||
    Number.isNaN(Date.parse(o.expire))
  ) {
    return undefined;
  }
  return {
    v: 1,
    compte: o.compte,
    prenom: o.prenom.slice(0, 30),
    jeton: o.jeton,
    relais: propreAdresse(o.relais),
    ...(adresseValide(o.site) ? { site: propreAdresse(o.site) } : {}),
    mdp: o.mdp,
    expire: o.expire,
    ...(typeof o.fondateur === 'string' && o.fondateur.trim() ? { fondateur: o.fondateur.trim().slice(0, 30) } : {}),
    creeLe: typeof o.creeLe === 'string' ? o.creeLe.slice(0, 40) : '',
    ...politiqueContenu(lirePolitiqueMdp(o.politique)),
  };
}

/** Forme courte d'une politique dans le contenu d'une invitation (rien si ce sont les règles de base). */
export function politiqueContenu(politique: PolitiqueMdp | undefined): { politique?: { l: number; f: number } } {
  if (!politique || (politique.longueurMin <= LONGUEUR_MIN_AMI && politique.forceMin <= 1)) return {};
  return { politique: { l: politique.longueurMin, f: politique.forceMin } };
}

/** Politique portée par une invitation (règles de base si elle n'en porte pas). */
export function politiqueDeContenu(contenu: Pick<ContenuInvitation, 'politique'> | undefined): PolitiqueMdp {
  return lirePolitiqueMdp(contenu?.politique) ?? POLITIQUE_MDP_DEFAUT;
}

export function encoderInvitation(lien: LienInvitation): string {
  const corps =
    lien.mode === 'relais'
      ? { v: VERSION, r: lien.relais, ...(lien.site ? { s: lien.site } : {}), k: lien.secret }
      : { v: VERSION, r: lien.relais, ...(lien.site ? { s: lien.site } : {}), i: lien.contenu };
  return PREFIXE_INVITATION + versBase64Url(utf8ToBytes(JSON.stringify(corps)));
}

/**
 * Lit un code d'invitation, ou un lien qui en porte un. Tolère ce qu'ajoutent
 * les messageries : espaces, retours à la ligne au milieu du lien, encodage
 * `%2E`, guillemets ou chevrons autour.
 */
export function decoderInvitation(texte: string): LienInvitation | undefined {
  let brut = texte;
  try {
    brut = decodeURIComponent(texte);
  } catch {
    // Texte non encodé : tel quel.
  }
  const compact = brut.replace(/\s+/g, '');
  const trouve = /AI1\.([A-Za-z0-9_-]+)/.exec(compact);
  if (!trouve) return undefined;
  try {
    const o = JSON.parse(utf8DepuisOctets(depuisBase64Url(trouve[1]))) as Record<string, unknown>;
    if (o.v !== VERSION || !adresseValide(o.r)) return undefined;
    const relais = propreAdresse(o.r);
    const site = adresseValide(o.s) ? propreAdresse(o.s) : undefined;
    if (typeof o.k === 'string' && depuisBase64Url(o.k).length === 32) {
      return { mode: 'relais', relais, ...(site ? { site } : {}), secret: o.k };
    }
    const contenu = lireContenu(o.i);
    return contenu ? { mode: 'lien', relais, ...(site ? { site } : {}), contenu } : undefined;
  } catch {
    return undefined;
  }
}

/** Lien à envoyer : le site, et l'invitation dans le fragment (jamais transmis au serveur du site). */
export function lienInvitation(site: string, code: string): string {
  return `${propreAdresse(site)}/#invitation=${code}`;
}

/** Lien de connexion des appareils suivants : le site, et l'adresse du relais (rien de secret). */
export function lienConnexion(site: string, relais: string): string {
  return `${propreAdresse(site)}/#relais=${encodeURIComponent(propreAdresse(relais))}`;
}

/** Adresse du relais apportée par un lien `#relais=…`. */
export function relaisDuLien(fragment: string): string | undefined {
  const trouve = /[#&]relais=([^&\s]+)/.exec(fragment);
  if (!trouve) return undefined;
  try {
    const adresse = propreAdresse(decodeURIComponent(trouve[1]));
    return adresseValide(adresse) ? adresse : undefined;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------ Secrets dérivés

const ctx = (usage: string) => utf8ToBytes(`applibourse/invitation/${usage}/v1`);

export interface SecretsInvitation {
  /** Identifiant de l'invitation sur le relais (32 hexadécimaux). */
  id: string;
  /** Clé du contenu scellé. */
  cle: Uint8Array;
  /** Preuve de possession du secret (présentée pour consommer l'invitation). */
  preuve: string;
  /** Ce que le relais garde : l'empreinte de la preuve. */
  verif: string;
}

function derives(materiau: Uint8Array): SecretsInvitation {
  const id = bytesToHex(hkdf(sha256, materiau, undefined, ctx('id'), 16));
  const cle = hkdf(sha256, materiau, undefined, ctx('cle'), 32);
  const preuve = bytesToHex(hkdf(sha256, materiau, undefined, ctx('preuve'), 32));
  return { id, cle, preuve, verif: bytesToHex(sha256(utf8ToBytes(preuve))) };
}

export function secretsInvitation(secret: string): SecretsInvitation {
  const octets = depuisBase64Url(secret);
  if (octets.length !== 32) throw new ErreurInvitation('lien-illisible');
  return derives(octets);
}

export function nouveauSecret(alea: SourceAleatoire = aleatoireParDefaut): string {
  return versBase64Url(alea(32));
}

/** Paramètres Argon2id du code court (assez lents pour qu'un relais compromis ne puisse pas tout essayer). */
export const KDF_CODE_COURT: ParametresKdf = { ...PARAMETRES_KDF_DEFAUT };

/** Code court à taper : 10 caractères Crockford (50 bits), présentés « XXXXX-XXXXX ». */
export function nouveauCodeCourt(alea: SourceAleatoire = aleatoireParDefaut): string {
  const brut = versCrockford(alea(7)).slice(0, 10);
  return `${brut.slice(0, 5)}-${brut.slice(5)}`;
}

export function normaliserCodeCourt(saisie: string): string | undefined {
  const brut = normaliserCrockford(saisie);
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(brut)) return undefined;
  return `${brut.slice(0, 5)}-${brut.slice(5)}`;
}

/** Secrets d'un code court : Argon2id du code (le relais seul ne peut pas les retrouver par essais rapides). */
export function secretsCodeCourt(code: string, kdf: ParametresKdf = KDF_CODE_COURT): SecretsInvitation {
  const propre = normaliserCodeCourt(code);
  if (!propre) throw new ErreurInvitation('code-court-illisible');
  const sel = sha256(utf8ToBytes(`applibourse/invitation/court/sel|${propre}`)).slice(0, 16);
  return derives(deriverCle(propre, sel, kdf));
}

const USAGE_CONTENU = 'invitation/contenu';

export function scellerContenu(contenu: ContenuInvitation, secrets: SecretsInvitation, alea: SourceAleatoire = aleatoireParDefaut): string {
  return scellerAvecContexte(secrets.cle, utf8ToBytes(JSON.stringify(contenu)), `${USAGE_CONTENU}/${secrets.id}`, alea);
}

export function ouvrirContenu(charge: string, secrets: SecretsInvitation): ContenuInvitation {
  let contenu: ContenuInvitation | undefined;
  try {
    contenu = lireContenu(JSON.parse(utf8DepuisOctets(descellerAvecContexte(secrets.cle, charge, `${USAGE_CONTENU}/${secrets.id}`))));
  } catch {
    contenu = undefined;
  }
  if (!contenu) throw new ErreurInvitation('lien-illisible');
  return contenu;
}

/** L'invitation a-t-elle expiré ? `maintenant` : l'heure du relais quand on la connaît (horloge de l'appareil décalée). */
export function invitationExpiree(contenu: Pick<ContenuInvitation, 'expire'>, maintenant: number): boolean {
  return maintenant >= Date.parse(contenu.expire);
}

// ------------------------------------------------------------ Accès par identifiant

/** Empreinte d'un identifiant (clé de l'accès sur le relais). */
export function empreinteIdentifiant(prenom: string): string {
  return bytesToHex(sha256(utf8ToBytes(`applibourse/acces/identifiant/v1|${cleIdentifiant(prenom)}`)));
}

/**
 * Ce que l'accès scelle : de quoi retrouver le compte. Le compte `principal` (Fondateur, version 9)
 * n'a pas de jeton dans sa charge : le relais lui remet un jeton de SESSION à chaque connexion.
 */
export interface ContenuAcces {
  v: 1;
  compte: string;
  prenom: string;
  jeton?: string;
  relais: string;
  site?: string;
}

/** Ce que le relais garde pour un identifiant : rien qu'il puisse ouvrir. */
export interface DepotAcces {
  compte: string;
  sel: string;
  kdf: ParametresKdf;
  verif: string;
  charge: string;
  /** Accès de secours (version 9) : un code de récupération ouvre aussi la charge. */
  secours?: DepotSecours;
}

/** Une entrée par code de récupération : empreinte de sa preuve, charge scellée par une clé tirée du code. */
export interface DepotSecours {
  sel: string;
  kdf: ParametresKdf;
  entrees: Array<{ verif: string; charge: string }>;
}

function clesAcces(motDePasse: string, sel: Uint8Array, kdf: ParametresKdf): { cle: Uint8Array; preuve: string } {
  const maitre = deriverCle(formeCanonique(motDePasse), sel, kdf);
  try {
    return {
      cle: hkdf(sha256, maitre, undefined, utf8ToBytes('applibourse/acces/cle/v1'), 32),
      preuve: bytesToHex(hkdf(sha256, maitre, undefined, utf8ToBytes('applibourse/acces/preuve/v1'), 32)),
    };
  } finally {
    maitre.fill(0);
  }
}

export function preparerAcces(motDePasse: string, contenu: ContenuAcces, alea: SourceAleatoire = aleatoireParDefaut, kdf: ParametresKdf = PARAMETRES_KDF_DEFAUT): DepotAcces {
  const sel = alea(16);
  const { cle, preuve } = clesAcces(motDePasse, sel, kdf);
  try {
    return {
      compte: contenu.compte,
      sel: bytesToHex(sel),
      kdf,
      verif: bytesToHex(sha256(utf8ToBytes(preuve))),
      charge: scellerAvecContexte(cle, utf8ToBytes(JSON.stringify(contenu)), `acces/${contenu.compte}`, alea),
    };
  } finally {
    cle.fill(0);
  }
}

/**
 * Accès de secours : chaque code de récupération (normalisé : casse, tirets, confusions de lecture)
 * dérive, avec un sel COMMUN (les codes ont 80 bits d'aléa : une seule dérivation à la connexion),
 * une preuve dont le relais garde l'empreinte, et la clé qui scelle la même charge.
 */
export function preparerSecours(codes: readonly string[], contenu: ContenuAcces, alea: SourceAleatoire = aleatoireParDefaut, kdf: ParametresKdf = PARAMETRES_KDF_DEFAUT): DepotSecours {
  const sel = alea(16);
  const entrees = codes.map(code => {
    const { cle, preuve } = clesAcces(normaliserCodeRecuperation(code), sel, kdf);
    try {
      return { verif: bytesToHex(sha256(utf8ToBytes(preuve))), charge: scellerAvecContexte(cle, utf8ToBytes(JSON.stringify(contenu)), `acces/${contenu.compte}`, alea) };
    } finally {
      cle.fill(0);
    }
  });
  return { sel: bytesToHex(sel), kdf, entrees };
}

/** Preuve et clé d'un code de récupération saisi (même normalisation qu'au dépôt). */
export function preuveSecours(code: string, selHexa: string, kdf: ParametresKdf): { cle: Uint8Array; preuve: string } {
  return clesAcces(normaliserCodeRecuperation(code), hexToBytes(selHexa), kdf);
}

export function lireKdf(brut: unknown): ParametresKdf | undefined {
  const o = brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {};
  const n = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (o.algorithme !== 'argon2id' || !n(o.passes, 1, 10) || !n(o.memoireKio, 8, 262144) || !n(o.fils, 1, 4) || o.longueurCle !== 32) return undefined;
  return { algorithme: 'argon2id', passes: o.passes as number, memoireKio: o.memoireKio as number, fils: o.fils as number, longueurCle: 32 };
}

/** Preuve à présenter au relais, et clé qui ouvrira la charge rendue. */
export function preuveAcces(motDePasse: string, selHexa: string, kdf: ParametresKdf): { cle: Uint8Array; preuve: string } {
  return clesAcces(motDePasse, hexToBytes(selHexa), kdf);
}

export function ouvrirAcces(charge: string, cle: Uint8Array, compte: string): ContenuAcces {
  try {
    const o = JSON.parse(utf8DepuisOctets(descellerAvecContexte(cle, charge, `acces/${compte}`))) as Record<string, unknown>;
    const jetonValide = compte === 'principal' ? o.jeton === undefined : typeof o.jeton === 'string' && o.jeton.startsWith(`p1.${compte}.`);
    if (o.v === 1 && o.compte === compte && jetonValide && adresseValide(o.relais) && typeof o.prenom === 'string') {
      return {
        v: 1,
        compte,
        prenom: o.prenom,
        ...(typeof o.jeton === 'string' ? { jeton: o.jeton } : {}),
        relais: propreAdresse(o.relais),
        ...(adresseValide(o.site) ? { site: propreAdresse(o.site) } : {}),
      };
    }
  } catch {
    // Rien : erreur ci-dessous.
  }
  throw new ErreurInvitation('mot-de-passe');
}

// ------------------------------------------------------------ Messages

export type CodeErreurConnexion =
  | 'identifiant-inconnu'
  | 'mot-de-passe'
  | 'invitation-expiree'
  | 'invitation-utilisee'
  | 'invitation-revoquee'
  | 'invitation-inconnue'
  | 'non-publie'
  | 'relais-injoignable'
  | 'relais-ancien'
  | 'relais-inconnu'
  | 'trop-de-tentatives'
  | 'lien-illisible'
  | 'code-court-illisible'
  | 'acces-revoque'
  | 'identifiant-pris'
  | 'code-recuperation';

/**
 * Message précis et actionnable pour chaque cause d'échec. `qui` : prénom du
 * Fondateur (« demande à Enzo… ») ; `attenteS` : délai avant un nouvel essai.
 */
export function messageErreur(code: CodeErreurConnexion, o: { qui?: string; attenteS?: number } = {}): string {
  const qui = o.qui ?? 'la personne qui t’a invité';
  switch (code) {
    case 'identifiant-inconnu':
      return `Identifiant inconnu : vérifie ton prénom tel que ${qui} l’a écrit (les majuscules, accents et espaces ne comptent pas).`;
    case 'mot-de-passe':
      // Même message pour un identifiant inconnu (le serveur ne dit pas lequel des deux est faux).
      return 'Identifiant ou mot de passe incorrect. Vérifie-les (majuscules et accents du mot de passe) ; s’il est oublié : « Mot de passe oublié ».';
    case 'identifiant-pris':
      return 'Cet identifiant est déjà pris par un autre compte : choisis-en un autre (par exemple ton prénom suivi d’une initiale).';
    case 'code-recuperation':
      return 'Identifiant ou code de récupération incorrect (un code ne sert qu’une fois).';
    case 'invitation-expiree':
      return `Cette invitation a expiré. Demande à ${qui} de t’en renvoyer une (Administration › ton compte › Renvoyer une invitation).`;
    case 'invitation-utilisee':
      return 'Cette invitation a déjà été utilisée : ton mot de passe est choisi. Connecte-toi avec ton prénom et ton mot de passe. Si ce n’était pas toi, préviens tout de suite la personne qui t’a invité.';
    case 'invitation-revoquee':
      return `Cette invitation a été annulée ou remplacée par une plus récente. Demande à ${qui} le dernier lien.`;
    case 'invitation-inconnue':
      return `Invitation introuvable : le lien est peut-être incomplet (copie-le en entier) ou a été annulé. Demande à ${qui} de le renvoyer.`;
    case 'non-publie':
      return `Ton compte n’est pas encore publié sur le serveur : demande à ${qui} d’ouvrir AppDashboard (déverrouillé) pour synchroniser, puis réessaie dans une minute.`;
    case 'relais-injoignable':
      return 'Serveur de synchronisation injoignable : vérifie ta connexion Internet, puis réessaie.';
    case 'relais-ancien':
      return `Le serveur de synchronisation (relais) doit être mis à jour pour cette fonction. Utilise le lien d’invitation, ou demande à ${qui} de mettre le relais à jour.`;
    case 'relais-inconnu':
      return 'Ce navigateur ne sait pas encore où est ton compte : ouvre le lien de connexion reçu avec ton invitation (ou scanne le QR code « Connecter un autre appareil » sur un appareil déjà connecté).';
    case 'trop-de-tentatives': {
      const s = o.attenteS ?? 60;
      const duree = s >= 120 ? `${Math.ceil(s / 60)} min` : `${s} s`;
      return `Trop de tentatives : réessaie dans ${duree}.`;
    }
    case 'lien-illisible':
      return 'Lien d’invitation incomplet ou abîmé : copie-le en entier (il commence par https:// et contient « #invitation= »).';
    case 'code-court-illisible':
      return 'Code d’invitation illisible : 10 lettres ou chiffres, par exemple K7M2Q-9XH4T.';
    case 'acces-revoque':
      return `Ton accès a été révoqué. Contacte ${qui} si c’est une erreur.`;
    default:
      return 'Connexion impossible.';
  }
}

export interface ElementsMessage {
  /** Longueur minimale du mot de passe à choisir (défaut : 10). */
  longueur?: number;
  prenom: string;
  fondateur?: string;
  lien: string;
  expire: string;
  codeCourt?: string;
  site?: string;
  lienConnexion?: string;
}

/** Message d'invitation prêt à coller dans une messagerie (lien + instructions simples). */
export function messageInvitation(e: ElementsMessage): string {
  const date = new Date(e.expire);
  const jour = Number.isNaN(date.getTime()) ? e.expire : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const lignes = [
    `Salut ${e.prenom} ! ${e.fondateur ? `${e.fondateur} t’invite` : 'Je t’invite'} sur AppDashboard.`,
    '',
    '1. Ouvre ce lien (sur ton téléphone ou ton ordinateur) :',
    e.lien,
    `2. Choisis ton mot de passe (${e.longueur ?? LONGUEUR_MIN_AMI} caractères au moins). Ton identifiant : ${e.prenom}`,
    '3. C’est tout : tu es connecté.',
    '',
    `Le lien ne marche qu’une fois, jusqu’au ${jour}. Ne le transfère à personne.`,
  ];
  if (e.codeCourt && e.site) {
    lignes.push('', `Si le lien ne s’ouvre pas : va sur ${e.site}, touche « J’ai une invitation » et tape le code ${e.codeCourt}.`);
  }
  if (e.lienConnexion) {
    lignes.push('', `Plus tard, sur un autre appareil : ${e.lienConnexion} puis ton prénom et ton mot de passe.`);
  }
  return lignes.join('\n');
}

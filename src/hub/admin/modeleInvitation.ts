/**
 * Message d'invitation : modèle personnalisable (réglages de l'Administration,
 * Fondateur seulement), rendu avec les variables de l'invitation, et lien
 * `mailto:` qui ouvre la messagerie de l'appareil, pré-remplie.
 *
 * **Aucun e-mail ne part d'un serveur** (ni du relais, ni d'un service tiers) :
 * c'est la messagerie de l'appareil (Mail sur iPhone/iPad, Outlook ou Gmail sur
 * le PC…) qui envoie, depuis la boîte du Fondateur. Le lien d'invitation ne
 * quitte donc l'appareil que dans le message qu'il envoie lui-même.
 *
 * Variables : {prenom}, {lien}, {expiration}, {fondateur} (obligatoires dans le
 * sens où elles ont toujours une valeur), et {code}, {site}, {connexion},
 * {longueur} (facultatives : une ligne dont une variable est vide disparaît).
 *
 * Tout est pur.
 */

export interface ModeleInvitation {
  objet: string;
  corps: string;
}

export const VARIABLES_MODELE = ['prenom', 'lien', 'expiration', 'fondateur', 'code', 'site', 'connexion', 'longueur'] as const;
export type VariableModele = (typeof VARIABLES_MODELE)[number];
export const LIBELLES_VARIABLES: Record<VariableModele, string> = {
  prenom: 'prénom de l’ami (son identifiant)',
  lien: 'lien d’invitation (obligatoire dans le message)',
  expiration: 'date de fin de validité du lien',
  fondateur: 'votre prénom',
  code: 'code court (si le relais est à jour)',
  site: 'adresse du site',
  connexion: 'lien de connexion pour ses autres appareils',
  longueur: 'longueur minimale de son mot de passe',
};

export const LONGUEUR_MAX_OBJET = 120;
export const LONGUEUR_MAX_CORPS = 2000;
/**
 * Longueur maximale d'un lien `mailto:` : au-delà, certaines messageries
 * (Outlook sous Windows, anciens navigateurs) le tronquent ou refusent de
 * l'ouvrir. 2 000 caractères est la limite sûre la plus répandue.
 */
export const LONGUEUR_MAX_MAILTO = 2000;

export const MODELE_INVITATION_DEFAUT: ModeleInvitation = {
  objet: '{fondateur} t’invite sur AppDashboard',
  corps: [
    'Salut {prenom} !',
    '',
    '{fondateur} t’invite sur AppDashboard.',
    '',
    '1. Ouvre ce lien (sur ton téléphone ou ton ordinateur) :',
    '{lien}',
    '2. Choisis ton mot de passe ({longueur} caractères au moins). Ton identifiant : {prenom}',
    '3. C’est tout : tu es connecté.',
    '',
    'Le lien ne marche qu’une fois, jusqu’au {expiration}. Ne le transfère à personne.',
    '',
    'Si le lien ne s’ouvre pas : va sur {site}, touche « J’ai une invitation » et tape le code {code}.',
    'Plus tard, sur un autre appareil : {connexion} puis ton prénom et ton mot de passe.',
  ].join('\n'),
};

export type ValeursModele = Partial<Record<VariableModele, string>>;

const MOTIF_VARIABLE = /\{([a-zA-Z]+)\}/g;
const FACULTATIVES: readonly VariableModele[] = ['code', 'site', 'connexion', 'longueur'];

/** Le prénom « Moi » (coffre créé sans prénom) ne s'affiche pas dans un message. */
export function prenomFondateur(nom: string | undefined): string {
  const propre = (nom ?? '').trim();
  return propre && propre !== 'Moi' ? propre.slice(0, 30) : 'Ton administrateur';
}

/** Date lisible d'expiration (« 22 octobre à 14:05 »). */
export function dateExpiration(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/** Texte d'une ligne de modèle : sans caractères de contrôle (sauf retours à la ligne pour le corps), borné. */
function nettoyer(texte: string, max: number, multiligne: boolean): string {
  // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle.
  const sans = texte.replace(/\r\n?/g, '\n').replace(multiligne ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]+/g, multiligne ? '' : ' ');
  return sans.slice(0, max);
}

/** Lecture défensive d'un modèle enregistré ; undefined : modèle par défaut. */
export function lireModele(brut: unknown): ModeleInvitation | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  if (typeof o.objet !== 'string' || typeof o.corps !== 'string') return undefined;
  const modele = { objet: nettoyer(o.objet, LONGUEUR_MAX_OBJET, false).trim(), corps: nettoyer(o.corps, LONGUEUR_MAX_CORPS, true) };
  return validerModele(modele).length === 0 ? modele : undefined;
}

/** Problèmes d'un modèle (vide : il peut être enregistré). */
export function validerModele(modele: ModeleInvitation): string[] {
  const erreurs: string[] = [];
  if (!modele.objet.trim()) erreurs.push('L’objet est vide.');
  if (modele.objet.length > LONGUEUR_MAX_OBJET) erreurs.push(`Objet : ${LONGUEUR_MAX_OBJET} caractères au plus.`);
  if (modele.corps.length > LONGUEUR_MAX_CORPS) erreurs.push(`Message : ${LONGUEUR_MAX_CORPS} caractères au plus.`);
  if (!modele.corps.includes('{lien}')) erreurs.push('Le message doit contenir {lien} : sans lui, l’ami ne peut pas se connecter.');
  if (modele.objet.includes('{lien}')) erreurs.push('Le lien ne va pas dans l’objet (il serait visible dans les listes de messages).');
  const inconnues = new Set<string>();
  for (const texte of [modele.objet, modele.corps]) {
    for (const [, nom] of texte.matchAll(MOTIF_VARIABLE)) {
      if (!(VARIABLES_MODELE as readonly string[]).includes(nom.toLowerCase())) inconnues.add(`{${nom}}`);
    }
  }
  if (inconnues.size > 0) erreurs.push(`Variable inconnue : ${[...inconnues].join(', ')}. Variables possibles : ${VARIABLES_MODELE.map(v => `{${v}}`).join(', ')}.`);
  return erreurs;
}

function remplacer(texte: string, valeurs: ValeursModele): string {
  return texte.replace(MOTIF_VARIABLE, (tout, nom: string) => {
    const cle = nom.toLowerCase() as VariableModele;
    return (VARIABLES_MODELE as readonly string[]).includes(cle) ? valeurs[cle] ?? '' : tout;
  });
}

/**
 * Rend un texte du modèle. Une ligne qui contient une variable FACULTATIVE
 * vide ({code} sans relais à jour…) est retirée ; les lignes vides en trop
 * sont resserrées.
 */
export function rendreTexte(texte: string, valeurs: ValeursModele): string {
  const lignes = texte.replace(/\r\n?/g, '\n').split('\n');
  const gardees = lignes.filter(ligne => {
    for (const [, nom] of ligne.matchAll(MOTIF_VARIABLE)) {
      const cle = nom.toLowerCase() as VariableModele;
      if (FACULTATIVES.includes(cle) && !valeurs[cle]) return false;
    }
    return true;
  });
  return gardees
    .map(ligne => remplacer(ligne, valeurs).replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface MessageRendu {
  objet: string;
  corps: string;
}

/** Objet et corps du message, rendus. */
export function rendreModele(modele: ModeleInvitation | undefined, valeurs: ValeursModele): MessageRendu {
  const m = modele ?? MODELE_INVITATION_DEFAUT;
  return { objet: rendreTexte(m.objet, valeurs).replace(/\s+/g, ' ').slice(0, LONGUEUR_MAX_OBJET), corps: rendreTexte(m.corps, valeurs) };
}

/** Texte complet (objet + corps) pour « Copier le message » et « Partager ». */
export function texteComplet(message: MessageRendu): string {
  return message.corps;
}

/** Destinataire encodé pour `mailto:` (le @ reste lisible). */
function destinataire(email: string | undefined): string {
  return email ? encodeURIComponent(email.trim()).replace(/%40/g, '@') : '';
}

/** Encodage d'un paramètre `mailto:` (RFC 6068) : UTF-8 en %XX, retours à la ligne en CRLF. */
export function encoderParametre(texte: string): string {
  return encodeURIComponent(texte.replace(/\r?\n/g, '\r\n'));
}

export interface LienMailto {
  url: string;
  /** Le corps complet était trop long : un message court (lien + validité) le remplace. */
  raccourci: boolean;
}

/**
 * Lien `mailto:` pré-rempli. Au-delà de `LONGUEUR_MAX_MAILTO`, le corps est
 * remplacé par un message court qui garde l'essentiel (le lien), puis par le
 * lien seul : le message complet reste disponible par « Copier le message ».
 */
export function lienMailto(email: string | undefined, message: MessageRendu, valeurs: ValeursModele, max = LONGUEUR_MAX_MAILTO): LienMailto {
  const base = `mailto:${destinataire(email)}?subject=${encoderParametre(message.objet)}&body=`;
  const complet = base + encoderParametre(message.corps);
  if (complet.length <= max) return { url: complet, raccourci: false };
  const court = rendreTexte(
    ['Salut {prenom} !', '', 'Voici ton lien d’invitation AppDashboard (il ne marche qu’une fois, jusqu’au {expiration}) :', '{lien}', '', 'Ton identifiant : {prenom}'].join('\n'),
    valeurs,
  );
  const moyen = base + encoderParametre(court);
  if (moyen.length <= max) return { url: moyen, raccourci: true };
  return { url: base + encoderParametre(valeurs.lien ?? ''), raccourci: true };
}

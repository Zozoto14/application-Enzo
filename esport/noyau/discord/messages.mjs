/**
 * Messages Discord : nettoyage du texte (aucune mention possible), validation
 * des modèles et de l'ID de rôle, rendu d'un modèle avec ses variables, et
 * construction de la charge envoyée au webhook. Fonctions PURES.
 *
 * Inspiré de nettoyerTexteDiscord() du relais (route /support), reprise ici
 * pour que le cœur portable de l'Esport ne dépende pas du relais.
 *
 * Trois barrières contre l'injection de mentions, cumulées :
 *  1. `@everyone`, `@here` et les mentions `<@id>`, `<@&id>`, `<#id>` sont
 *     rendus inoffensifs dans TOUT texte (modèle comme variables) ;
 *  2. la seule mention possible est celle du rôle configuré, validé comme un
 *     identifiant numérique, et seule listée dans `allowed_mentions.roles` ;
 *  3. sans rôle, `allowed_mentions: { parse: [] }` : Discord ne notifie personne.
 */

import { echec } from '../outils.mjs';
import { EXEMPLES, evenementDiscord } from './catalogue.mjs';
import { bornerEmbeds, embedMessage } from './embeds.mjs';

export const LONGUEUR_MAX_MESSAGE = 2000;
export const LONGUEUR_MAX_MODELE = 500;
export const LONGUEUR_MAX_VARIABLE = 200;
const MOTIF_VARIABLE = /\{([a-z]+)\}/g;
const MOTIF_ROLE = /^[0-9]{5,25}$/;
const ZERO = '​';

/** Texte pour Discord : contrôles retirés, mentions neutralisées, tronqué à `max`. */
export function nettoyerTexteDiscord(valeur, max) {
  let texte = String(valeur ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    // @everyone, @here, <@id>, <@&id>, <#id>, </commande:id>, <id:guide> : plus rien ne s'active.
    .replace(/@(everyone|here)/gi, `@${ZERO}$1`)
    .replace(/<(?=[@#/]|id:)/gi, `<${ZERO}`);
  if (texte.length > max) texte = `${texte.slice(0, max - 1)}…`;
  return texte;
}

/** Variable : une seule ligne, courte, nettoyée. */
export function nettoyerVariable(valeur) {
  return nettoyerTexteDiscord(valeur, LONGUEUR_MAX_VARIABLE).replace(/\s*\n+\s*/g, ' ').trim();
}

/** Identifiant de rôle Discord (chiffres seulement) ou `null` ; lève si la saisie est autre chose. */
export function lireRoleMention(saisie) {
  if (saisie === undefined || saisie === null) return null;
  const texte = String(saisie).trim();
  if (texte === '') return null;
  if (!MOTIF_ROLE.test(texte)) {
    throw echec(400, 'role-mention', 'Rôle Discord : saisissez son identifiant numérique (chiffres seulement). @everyone et @here ne sont pas permis.');
  }
  return texte;
}

/** Variables citées dans un modèle (sans doublon). */
export function variablesDuModele(modele) {
  return [...new Set([...String(modele ?? '').matchAll(MOTIF_VARIABLE)].map(m => m[1]))];
}

/**
 * Modèle saisi par la team : texte nettoyé, longueur limitée, variables
 * connues de ce type de message. Vide : `null` (modèle par défaut).
 */
export function validerModele(cle, saisie) {
  const type = evenementDiscord(cle);
  if (!type) throw echec(404, 'discord-evenement', 'Type de notification inconnu.');
  if (saisie === undefined || saisie === null) return null;
  const brut = String(saisie).normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (brut === '') return null;
  if (brut.length > LONGUEUR_MAX_MODELE) throw echec(400, 'modele-long', `Modèle trop long (${LONGUEUR_MAX_MODELE} caractères au plus).`);
  const inconnues = variablesDuModele(brut).filter(v => !Object.hasOwn(type.variables, v));
  if (inconnues.length > 0) {
    const e = echec(400, 'variable-inconnue', `Variable inconnue : ${inconnues.map(v => `{${v}}`).join(', ')}. Variables permises : ${Object.keys(type.variables).map(v => `{${v}}`).join(', ')}.`);
    e.details = { inconnues, permises: Object.keys(type.variables) };
    throw e;
  }
  return nettoyerTexteDiscord(brut, LONGUEUR_MAX_MODELE);
}

/** Remplace {variable} par sa valeur nettoyée (variable absente : vide). */
export function rendreModele(modele, valeurs = {}) {
  const texte = String(modele ?? '').replace(MOTIF_VARIABLE, (_, nom) => nettoyerVariable(valeurs[nom] ?? ''));
  // Un lien vide laisse des espaces en trop : on les resserre sans toucher aux retours à la ligne.
  return texte.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

/** Aperçu d'un modèle avec des valeurs d'exemple. */
export function apercuModele(modele) {
  return nettoyerTexteDiscord(rendreModele(modele, EXEMPLES), LONGUEUR_MAX_MESSAGE);
}

/**
 * Charge JSON d'un message (webhook ou bot) : un EMBED soigné (embeds.mjs).
 * `contenu` : texte du message (modèle rendu) ; `embed` : embed déjà construit
 * (sinon un embed simple de type `cle`, titre `titre`). La mention de rôle
 * (`roleId`, déjà validée) est la SEULE mention autorisée par défaut ; le bot y
 * ajoute les utilisateurs convoqués (`utilisateurs`, identifiants numériques),
 * listés un à un dans `allowed_mentions.users` : jamais @everyone ni @here.
 */
export function construireCharge(contenu, { roleId = null, nomTeam = '', logoTeam = null, embed, cle = 'test', titre, lien = '', utilisateurs = [], composants, maintenant = Date.now() } = {}) {
  const role = roleId && MOTIF_ROLE.test(roleId) ? roleId : null;
  const ids = [...new Set(utilisateurs.filter(id => /^[0-9]{5,25}$/.test(String(id))).map(String))].slice(0, 50);
  const mentions = [role ? `<@&${role}>` : '', ...ids.map(id => `<@${id}>`)].filter(Boolean).join(' ');
  const nom = nettoyerVariable(nomTeam);
  const texte = nettoyerTexteDiscord(contenu, LONGUEUR_MAX_MESSAGE).trim() || 'Notification Esport';
  const corps = embed ?? embedMessage({ cle, titre: titre ?? 'Notification', texte, team: { nom, logo: logoTeam }, lien, maintenant });
  const allowed = { parse: [] };
  if (role) allowed.roles = [role];
  if (ids.length) allowed.users = ids;
  return {
    username: nom ? `Esport · ${nom}`.slice(0, 80) : 'Esport',
    ...(mentions ? { content: mentions } : {}),
    embeds: bornerEmbeds([corps]),
    allowed_mentions: allowed,
    ...(composants?.length ? { components: composants } : {}),
  };
}

/** Tout le texte visible d'une charge (contenu et embeds) : journaux, tests, aperçus. */
export function texteCharge(charge) {
  const e = charge?.embeds ?? [];
  return [charge?.content ?? '', ...e.flatMap(x => [x.author?.name, x.title, x.description, ...(x.fields ?? []).flatMap(f => [f.name, f.value]), x.footer?.text])].filter(Boolean).join('\n');
}

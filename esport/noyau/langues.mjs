/**
 * Langues du serveur Esport (français / anglais) : textes des messages Discord, des réponses du
 * bot et des exports CSV. Sans dépendance, pur.
 *
 *  - `texte(langue, 'cle', { variable })` : interpolation `{variable}` ;
 *  - `texteNombre(langue, 'cle', n, vars)` : pluriel (clés `cle.one` / `cle.other`, `{n}` fourni) ;
 *  - la langue d'un compte est enregistrée dans `comptes.langue` (migration 0012), celle d'une
 *    team pour ses messages Discord dans `teams.langue_discord` (défaut : français), utilisée quand le
 *    fil français est désactivé ; sinon les messages Discord partent en anglais avec leur version
 *    française dans un fil (discord/bilingue.mjs, migration 0020).
 *
 * Les messages d'erreur de l'API restent en français avec un `code` stable : l'app et le bot les
 * traduisent par `traduireErreur` (table `erreurs.json`).
 */

import CATALOGUE from './catalogue.json' with { type: 'json' };
import ERREURS from './erreurs.json' with { type: 'json' };
import { EN } from './textes/en.mjs';
import { FR } from './textes/fr.mjs';

export const LANGUES = Object.freeze(['fr', 'en']);
export const LANGUE_DEFAUT = 'fr';
const DICTIONNAIRES = { fr: FR, en: EN };
const LOCALES = { fr: 'fr-FR', en: 'en-GB' };

/** 'fr' | 'en' si valide, sinon `null`. */
export const lireLangue = v => (v === 'fr' || v === 'en' ? v : null);

export const localeIntl = langue => LOCALES[langue] ?? LOCALES.fr;

/** « en », « en-US », « en_GB » → anglais ; tout le reste (fr, de, absent…) → français. */
export const langueDepuisLocale = locale => (/^en([-_]|$)/i.test(String(locale ?? '').trim()) ? 'en' : 'fr');

/** Première langue de l'en-tête Accept-Language (« en-GB,en;q=0.9 » → en), ou `null`. */
export function langueDepuisEntete(valeur) {
  const premier = String(valeur ?? '').split(',')[0]?.split(';')[0]?.trim();
  return premier ? langueDepuisLocale(premier) : null;
}

export function interpoler(modele, vars) {
  if (!vars) return modele;
  return modele.replace(/\{(\w+)\}/g, (brut, nom) => (vars[nom] !== undefined && vars[nom] !== null ? String(vars[nom]) : brut));
}

/** Texte d'une clé dans une langue (secours : français, puis la clé elle-même). */
export function texte(langue, cle, vars) {
  const d = DICTIONNAIRES[langue] ?? FR;
  return interpoler(d[cle] ?? FR[cle] ?? cle, vars);
}

export const categoriePluriel = (langue, n) => (new Intl.PluralRules(localeIntl(langue)).select(n) === 'one' ? 'one' : 'other');

/** Pluriel : `texteNombre('en', 'convoques.et_autres', 2)` → « and 2 others ». */
export function texteNombre(langue, cle, n, vars) {
  return texte(langue, `${cle}.${categoriePluriel(langue, n)}`, { n, ...vars });
}

/** Liste de textes d'une clé « a|b|c » (en-têtes CSV). */
export const listeTextes = (langue, cle) => texte(langue, cle).split('|');

export const dictionnaires = DICTIONNAIRES;

/** Nom d'un rôle système (reconnu à son nom français) dans une langue ; les rôles créés par la team restent tels quels. */
export function nomRoleSysteme(langue, nom) {
  const systeme = CATALOGUE.rolesSysteme.find(r => r.nom === nom);
  return systeme ? texte(langue, `role.${systeme.cle}`) : nom;
}

// ------------------------------------------------------------------ Messages d'erreur

/**
 * Message d'erreur de l'API dans une langue. Le serveur écrit en français ; en anglais, on cherche
 * la phrase exacte (`messages`), puis un motif à variables (`motifs`, regex avec groupes `$1`…).
 * Sans correspondance : le message d'origine.
 */
export function traduireErreur(langue, message) {
  const m = String(message ?? '');
  if (langue !== 'en') return m;
  const exact = ERREURS.messages[m];
  if (exact) return exact;
  for (const [motif, modele] of ERREURS.motifs) {
    const r = new RegExp(motif, 's').exec(m);
    if (r) return modele.replace(/\$(\d)/g, (_, i) => r[Number(i)] ?? '');
  }
  return m;
}

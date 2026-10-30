/**
 * Devblog (notes de mise à jour) : règles PURES, sans base ni réseau (docs/esport/devblog.md).
 *
 *  - `lireContenu(saisie)` : contenu d'une langue validé et nettoyé (titre, intro, sections { emoji, titre,
 *    puces { nom, description } }, conclusion) ;
 *  - `texteDiscord(entree, langue, { here })` : le message Discord dans la DA du devblog posté à la main par le
 *    Fondateur (titre « 🚀 DEVBLOG — … 🛠️ », phrase d'intro, sections « emoji + **titre** », puces
 *    « • **Nom :** description », phrase de fin, puis @here dans le message principal seulement) ;
 *  - `decouperDiscord(texte)` : découpage propre en messages de 2000 caractères au plus (entre deux sections,
 *    sinon entre deux lignes, sinon entre deux mots) ;
 *  - `empreinteTextes` : ce qui a été publié (une correction se reconnaît à une empreinte différente).
 *
 * Tout texte saisi est neutralisé pour Discord (aucune mention possible : @everyone, @here, <@id>…) ; le SEUL
 * « @here » est celui ajouté ici quand la case « Mentionner @here » est cochée.
 */

import { echec } from '../outils.mjs';
import { nettoyerTexteDiscord } from '../discord/messages.mjs';

export const PERMISSION_DEVBLOG = 'devblog.gerer';
export const LIMITE_DISCORD = 2000;
export const MAX_SECTIONS = 12;
export const MAX_PUCES = 20;
export const LONGUEURS = Object.freeze({ titre: 120, intro: 1000, emoji: 16, titreSection: 80, nom: 80, description: 600, conclusion: 600, version: 20 });
const MOTIF_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOTIF_VERSION = /^[0-9A-Za-z][0-9A-Za-z .\-_]{0,19}$/;

/** Ligne de texte saisie : contrôles retirés, espaces resserrés, bornée. */
function ligne(v, max) {
  return String(v ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Paragraphe (retours à la ligne gardés, trois au plus d'affilée). */
function paragraphe(v, max) {
  return String(v ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Contenu vide d'une langue. */
export const contenuVide = () => ({ titre: '', intro: '', sections: [], conclusion: '' });

/**
 * Contenu d'une langue (saisie de l'éditeur) : structure imposée, longueurs bornées, sections et puces vides
 * retirées. `exiger` : titre et au moins une puce obligatoires (publication).
 */
export function lireContenu(saisie, { exiger = false, langue = 'fr' } = {}) {
  const s = saisie && typeof saisie === 'object' && !Array.isArray(saisie) ? saisie : {};
  const sections = (Array.isArray(s.sections) ? s.sections : []).slice(0, MAX_SECTIONS).map(x => {
    const sec = x && typeof x === 'object' ? x : {};
    return {
      emoji: ligne(sec.emoji, LONGUEURS.emoji),
      titre: ligne(sec.titre, LONGUEURS.titreSection),
      puces: (Array.isArray(sec.puces) ? sec.puces : [])
        .slice(0, MAX_PUCES)
        .map(p => ({ nom: ligne(p?.nom, LONGUEURS.nom), description: paragraphe(p?.description, LONGUEURS.description).replace(/\n+/g, ' ') }))
        .filter(p => p.nom || p.description),
    };
  }).filter(sec => sec.titre || sec.puces.length);
  const c = { titre: ligne(s.titre, LONGUEURS.titre), intro: paragraphe(s.intro, LONGUEURS.intro), sections, conclusion: paragraphe(s.conclusion, LONGUEURS.conclusion) };
  if (exiger) {
    const en = langue === 'en';
    if (!c.titre) throw echec(400, 'devblog-titre', en ? 'Version anglaise : titre obligatoire.' : 'Version française : titre obligatoire.');
    if (!c.sections.some(sec => sec.puces.length)) throw echec(400, 'devblog-vide', en ? 'Version anglaise : au moins une section avec une puce.' : 'Version française : au moins une section avec une puce.');
  }
  return c;
}

/** Date affichée (AAAA-MM-JJ). */
export function lireDate(v, repli) {
  if (v === undefined || v === null || v === '') return repli;
  const d = String(v).trim();
  if (!MOTIF_DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw echec(400, 'devblog-date', 'Date : au format AAAA-MM-JJ.');
  return d;
}

/** Version facultative (« 2.4 », « 2026.10 »…) ; vide : aucune. */
export function lireVersion(v) {
  const t = ligne(v, LONGUEURS.version);
  if (t && !MOTIF_VERSION.test(t)) throw echec(400, 'devblog-version', 'Version : lettres, chiffres, points et tirets (20 caractères au plus).');
  return t;
}

/** Une entrée a-t-elle une version anglaise utilisable (titre et au moins une puce) ? */
export const contenuComplet = c => Boolean(c?.titre && c.sections?.some(s => s.puces?.length));

// ------------------------------------------------------------------ Rendu Discord

/** Texte saisi, pour Discord : mentions neutralisées, sans gras ni souligné cassés par un astérisque isolé. */
const sur = (v, max = 4000) => nettoyerTexteDiscord(v, max);
const enGras = v => `**${sur(v).replace(/\*\*/g, '')}**`;

/** « 30/10/2026 » ou « 30 Oct 2026 ». */
export function dateLisible(jour, langue) {
  const d = new Date(`${jour}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return jour;
  return d.toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Message Discord d'une entrée dans une langue. `entree` : `{ contenu, version, date }` ; `here` : mention @here
 * à la fin (message principal en anglais SEULEMENT : jamais dans le fil français).
 */
export function texteDiscord(entree, langue, { here = false } = {}) {
  const c = entree.contenu ?? contenuVide();
  const blocs = [];
  const tete = [`🚀 DEVBLOG — ${sur(c.titre || (langue === 'en' ? 'New Update!' : 'Nouvelle Mise à Jour !'), 200)} 🛠️`];
  if (entree.version) tete.push(`-# Version ${sur(entree.version, 40)} · ${dateLisible(entree.date, langue)}`);
  blocs.push(tete.join('\n'));
  if (c.intro) blocs.push(sur(c.intro));
  for (const s of c.sections ?? []) {
    const lignes = [];
    const titre = [s.emoji ? sur(s.emoji, 20) : '', s.titre ? enGras(s.titre) : ''].filter(Boolean).join(' ');
    if (titre) lignes.push(titre);
    for (const p of s.puces ?? []) {
      const deuxPoints = langue === 'en' ? ':' : ' :';
      lignes.push(p.nom ? `• **${sur(p.nom).replace(/\*\*/g, '')}${deuxPoints}** ${sur(p.description)}`.trimEnd() : `• ${sur(p.description)}`);
    }
    if (lignes.length) blocs.push(lignes.join('\n'));
  }
  const fin = sur(c.conclusion ?? '');
  if (fin || here) blocs.push([fin, here ? '@here' : ''].filter(Boolean).join(' '));
  return blocs.join('\n\n');
}

/**
 * Découpe un texte en messages de `max` caractères au plus, proprement : d'abord entre les blocs (sections,
 * séparées par une ligne vide), puis entre les lignes d'un bloc trop long, puis entre les mots d'une ligne
 * trop longue. Aucun morceau vide ; l'ordre et le texte sont conservés (aux séparateurs près).
 */
export function decouperDiscord(texte, max = LIMITE_DISCORD) {
  const morceaux = [];
  let courant = '';
  const pousser = (unite, sep) => {
    if (!unite) return;
    if (!courant) courant = unite;
    else if (courant.length + sep.length + unite.length <= max) courant += sep + unite;
    else {
      morceaux.push(courant);
      courant = unite;
    }
  };
  // Ligne plus longue qu'un message : coupée entre les mots (un mot géant : coupé net).
  const mots = l => {
    const sortie = [];
    let c = '';
    for (const m of l.split(' ')) {
      const bouts = m.length > max ? m.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [m];
      for (const b of bouts) {
        if (!c) c = b;
        else if (c.length + 1 + b.length <= max) c += ` ${b}`;
        else {
          sortie.push(c);
          c = b;
        }
      }
    }
    if (c) sortie.push(c);
    return sortie;
  };
  for (const bloc of String(texte ?? '').split('\n\n')) {
    if (bloc.length <= max) {
      pousser(bloc, '\n\n');
      continue;
    }
    let premier = true;
    for (const l of bloc.split('\n')) {
      const parts = l.length <= max ? [l] : mots(l);
      for (const p of parts) {
        pousser(p, premier ? '\n\n' : '\n');
        premier = false;
      }
    }
  }
  if (courant) morceaux.push(courant);
  return morceaux.filter(m => m.trim());
}

/** Messages Discord d'une entrée : `{ en: [...], fr: [...] }` (anglais avec @here si demandé ; français sans). */
export function messagesDiscord(entree, { here = true } = {}) {
  return {
    en: decouperDiscord(texteDiscord({ ...entree, contenu: entree.contenuEn }, 'en', { here })),
    fr: decouperDiscord(texteDiscord({ ...entree, contenu: entree.contenuFr }, 'fr')),
  };
}

/** Empreinte (non cryptographique, stable) des messages publiés : détecte une correction à republier. */
export function empreinteTextes(messages) {
  const s = JSON.stringify(messages);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}${s.length.toString(16)}`;
}

/** Nom du fil français : « 🇫🇷 Version française · DEVBLOG — <titre> » (100 caractères au plus). */
export function nomFilDevblog(titreFr) {
  const t = ligne(String(titreFr ?? '').replace(/@/g, '@​'), 200);
  const n = t ? `🇫🇷 Version française · DEVBLOG — ${t}` : '🇫🇷 Version française';
  return n.length > 100 ? `${n.slice(0, 99)}…` : n;
}

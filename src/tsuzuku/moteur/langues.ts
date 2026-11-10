/**
 * Langue d'une version (VF ou VOSTFR) : détection sur les titres, les
 * adresses et les blocs d'une page (onglets, attributs `data-lang`, titres de
 * section), et regroupement des fiches d'une même série par langue.
 *
 * Règle : ne jamais deviner sans le dire. Chaque langue lue porte son INDICE
 * (« « (VF) » dans le titre », « -vostfr dans l'adresse », « onglet « VF » »…) ;
 * une langue seulement PRÉSUMÉE (fiche sans marqueur à côté d'une fiche
 * « (VF) ») est marquée comme telle ; sans indice, la langue reste inconnue.
 */

import type { AnyNode, Element } from 'domhandler';
import { texteVisible, type Noeud, type Page } from './lecteurPage';

import type { LangueVersion } from './languesVersion';
// Constantes à part (languesVersion.ts) : la synchro les lit au démarrage sans charger l'analyseur HTML.
export { autreLangue, LANGUES_VERSION, LIBELLE_LANGUE_VERSION, type LangueVersion } from './languesVersion';

/** Une langue lue, et ce qui l'a montrée. */
export interface LangueLue {
  langue: LangueVersion;
  indice: string;
}

function sansAccents(t: string): string {
  let x = String(t ?? '');
  try {
    x = x.normalize('NFD');
  } catch {
    // Pas de normalize : les accents restent (les motifs ASCII marchent quand même).
  }
  return x.replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Marqueurs FORTS de la version originale sous-titrée. */
const VOSTFR_FORTS = new Set(['vostfr', 'vost', 'vosta', 'vostf', 'vo', 'sub', 'subs', 'subbed', 'subtitled', 'subtitles', 'vosub']);
/** Marqueurs FORTS de la version doublée. */
const VF_FORTS = new Set(['vf', 'vff', 'vfq', 'dub', 'dubbed', 'doublage']);
/** Marqueurs FAIBLES (« French » seul) : VF seulement sans marqueur de sous-titres. */
const VF_FAIBLES = new Set(['french', 'francais']);

const jetons = (t: string) => sansAccents(t).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Langue d'un texte (titre de fiche, texte d'un lien, onglet) :
 * « (VF) », « VF », « Dub », « Doublé », « Version française », « French » →
 * VF ; « VOSTFR », « VOST », « VO », « Sub », « Sous-titré » → VOSTFR. Les deux
 * à la fois (« VF / VOSTFR ») : inconnue (le bloc propose les deux).
 */
export function langueDeTexte(texte: unknown, ou = 'texte'): LangueLue | null {
  const brut = String(texte ?? '');
  if (!brut.trim()) {
    return null;
  }
  const t = sansAccents(brut);
  const mots = jetons(brut);
  const vost = mots.find(m => VOSTFR_FORTS.has(m)) ?? (/\bsous[\s-]?titr/.test(t) ? 'sous-titré' : /\bversion originale\b/.test(t) ? 'version originale' : undefined);
  const vf = mots.find(m => VF_FORTS.has(m)) ?? (/doubl(?:é|ée|és|ées)(?![a-z])/i.test(brut) ? 'doublé' : /\bversion francaise\b/.test(t) ? 'version française' : undefined);
  if (vost && vf) {
    return null;
  }
  const montre = (m: string) => (m.length <= 6 ? m.toUpperCase() : m);
  if (vost) {
    return { langue: 'vostfr', indice: `« ${montre(vost)} » dans le ${ou}` };
  }
  if (vf) {
    return { langue: 'vf', indice: `« ${montre(vf)} » dans le ${ou}` };
  }
  const faible = mots.find(m => VF_FAIBLES.has(m));
  return faible ? { langue: 'vf', indice: `« ${faible} » dans le ${ou}` } : null;
}

/**
 * Langue d'une adresse : seulement son chemin et sa requête (« /titre-vf/ »,
 * « /vostfr/titre », « ?lang=vf », « -dub ») — jamais le nom du site.
 */
export function langueDAdresse(url: string | null | undefined): LangueLue | null {
  if (!url) {
    return null;
  }
  const reste = String(url).replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const mots = jetons(reste.replace(/#.*$/, ''));
  const vost = mots.find(m => VOSTFR_FORTS.has(m) && m !== 'vo');
  const vf = mots.find(m => VF_FORTS.has(m));
  if (vost && vf) {
    return null;
  }
  if (vost) return { langue: 'vostfr', indice: `« -${vost} » dans l’adresse` };
  if (vf) return { langue: 'vf', indice: `« -${vf} » dans l’adresse` };
  return null;
}

/** Valeur d'un attribut de langue (`data-lang="fr"`, `"ja"`, `"vostfr"`). */
function langueDAttribut(valeur: string, nom: string): LangueLue | null {
  const v = sansAccents(valeur).trim();
  if (/^(?:fr|fre|fra|french|francais|vf|vff|dub|dubbed)$/.test(v)) return { langue: 'vf', indice: `attribut ${nom}="${valeur}"` };
  if (/^(?:ja|jp|jpn|vo|vost|vostfr|sub|subbed|original)$/.test(v)) return { langue: 'vostfr', indice: `attribut ${nom}="${valeur}"` };
  const t = langueDeTexte(valeur);
  return t ? { langue: t.langue, indice: `attribut ${nom}="${valeur}"` } : null;
}

const ATTRIBUTS_LANGUE = ['data-lang', 'data-langue', 'data-language', 'data-version', 'data-audio', 'data-type'];
/** Jetons sûrs dans un `id` ou une `class` (« sub-menu » n'est pas « Sub ») ; `vo` exclu (« vo-… »). */
const JETONS_CLASSE: Record<string, LangueVersion> = { vf: 'vf', vff: 'vf', dub: 'vf', dubbed: 'vf', vostfr: 'vostfr', vost: 'vostfr', vosta: 'vostfr', subbed: 'vostfr' };
const RE_TITRE_SECTION = /^(?:h[1-6]|strong|b|span|p|div|li|label|button|a|summary|dt|legend)$/;

function langueDeClasses(page: Page, el: Noeud): LangueLue | null {
  const trouvees = new Map<LangueVersion, string>();
  for (const nom of ['id', 'class']) {
    for (const j of jetons(page.attr(el, nom) ?? '')) {
      const l = JETONS_CLASSE[j];
      if (l && !trouvees.has(l)) trouvees.set(l, `${nom}="${page.attr(el, nom)}"`);
    }
  }
  if (trouvees.size !== 1) return null;
  const [[langue, indice]] = [...trouvees];
  return { langue, indice: `bloc ${indice}` };
}

/** Titre de section court juste AVANT un bloc (« <h3>VF</h3><ul>…</ul> »). */
function titreAvant(page: Page, el: Noeud): LangueLue | null {
  let prec: AnyNode | null = el.prev;
  for (let vus = 0; prec && vus < 3; prec = prec.prev) {
    if (prec.type !== 'tag') {
      continue;
    }
    vus += 1;
    const tag = (prec as Element).name;
    if (!RE_TITRE_SECTION.test(tag)) {
      break;
    }
    const texte = texteVisible(prec).trim();
    if (texte && texte.length <= 40) {
      const l = langueDeTexte(texte) ?? langueDeClasses(page, prec as Element);
      if (l) return { langue: l.langue, indice: `section « ${texte.slice(0, 30)} »` };
    }
    // Un titre trouvé sans langue : le bloc n'en annonce pas.
    if (/^h[1-6]$/.test(tag)) break;
  }
  return null;
}

/**
 * Langue d'un ÉLÉMENT de la page (bloc d'épisode, lien, option) : ses
 * attributs de langue, puis ceux de ses parents (onglet `id="vf"`, `<div
 * data-lang="vostfr">`, `<optgroup label="VF">`), et les titres de section
 * qui les précèdent. `null` : rien ne le dit.
 */
export function langueDeNoeud(page: Page, el: Noeud, profondeur = 8): LangueLue | null {
  let courant: Element | null = el;
  for (let n = 0; courant && n < profondeur; n += 1) {
    if (courant.name === 'body' || courant.name === 'html') {
      break;
    }
    for (const nom of ATTRIBUTS_LANGUE) {
      const v = page.attr(courant, nom);
      if (v) {
        const l = langueDAttribut(v, nom);
        if (l) return l;
      }
    }
    if (courant.name === 'optgroup') {
      const l = langueDeTexte(page.attr(courant, 'label'));
      if (l) return { langue: l.langue, indice: `groupe « ${page.attr(courant, 'label')} »` };
    }
    const c = langueDeClasses(page, courant);
    if (c) return c;
    if (n > 0) {
      const titre = page.attr(courant, 'aria-label') || page.attr(courant, 'title');
      const l = titre && titre.length <= 40 ? langueDeTexte(titre) : null;
      if (l) return { langue: l.langue, indice: `bloc « ${titre} »` };
    }
    const avant = titreAvant(page, courant);
    if (avant) return avant;
    courant = courant.parent && courant.parent.type === 'tag' ? (courant.parent as Element) : null;
  }
  return null;
}

/**
 * Langue d'un épisode lu sur une page : son texte, son adresse, puis son bloc
 * (attributs, onglet, section). Ordre : le plus précis d'abord.
 */
export function langueDEpisode(texte: string | null | undefined, url: string | null | undefined, page?: Page, el?: Noeud | null): LangueLue | null {
  return langueDeTexte(texte, 'texte du lien') ?? langueDAdresse(url) ?? (page && el ? langueDeNoeud(page, el) : null);
}

/** Langue d'un objet JSON d'épisode (`lang`, `langue`, `language`, `version`, `audio`, titre, adresse). */
export function langueDObjetJson(o: Record<string, unknown>, url: string | null): LangueLue | null {
  for (const nom of ['lang', 'langue', 'language', 'version', 'audio', 'type']) {
    const v = o[nom];
    if (typeof v === 'string' && v.trim()) {
      const l = langueDAttribut(v, nom);
      if (l) return { langue: l.langue, indice: `champ JSON ${nom}="${v}"` };
    }
  }
  const titre = typeof o.title === 'string' ? o.title : typeof o.titre === 'string' ? o.titre : typeof o.name === 'string' ? o.name : null;
  return langueDeTexte(titre, 'titre') ?? langueDAdresse(url);
}

/** Langue d'un candidat de recherche (fiche de série) : son titre, puis son adresse. */
export function langueDeCandidat(c: { title: string; url: string }): LangueLue | null {
  return langueDeTexte(c.title, 'titre') ?? langueDAdresse(c.url);
}

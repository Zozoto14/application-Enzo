/**
 * Diagnostic détaillé « Sur vos sources », en texte : affiché dans le
 * panneau et COPIABLE pour être transmis tel quel (support, IA, développeur).
 *
 * Par source : adresse appelée, méthode, statut HTTP, type de contenu,
 * taille, durée, détections (page construite en JavaScript, protection
 * anti-robot, JSON), mode d'extraction, nombre de candidats, meilleurs
 * candidats avec leur score face aux titres comparés, raison du rejet,
 * lecture des épisodes.
 *
 * AUCUN secret : les paramètres d'adresse sensibles (clé, jeton, mot de
 * passe, signature, session…) et les identifiants sont masqués ; ni clé
 * d'API, ni réglage, ni donnée de bibliothèque n'y figurent.
 */

import { SCORE_MINIMAL } from '../moteur/appariement';
import { LANGUES_VERSION, LIBELLE_LANGUE_VERSION, type LangueVersion } from '../moteur/langues';
import type { DetailEpisodes, DiagnosticSource, LanguesDiagnostic, RequeteDiagnostic, StatutSource } from '../moteur/resolution';

const LL = (l: LangueVersion | null | undefined) => (l ? LIBELLE_LANGUE_VERSION[l] : 'langue ?');

export const LIBELLE_STATUT_SOURCE: Record<StatutSource, string> = {
  ok: 'trouvé',
  erreur: 'en erreur',
  bloquee: 'bloquée par le site (anti-robot)',
  'titre-introuvable': 'titre non reconnu',
  'aucun-resultat': 'aucun résultat',
  'aucun-episode': 'aucun épisode lu',
  'non-configuree': 'non configurée pour ce type',
};

/** Ce dont le texte a besoin (sous-ensemble de `DiagnosticLecture`). */
export interface DiagnosticAExporter {
  raison: string;
  titres: readonly string[];
  sources: readonly DiagnosticSource[];
}

const PARAMS_SENSIBLES = /^(?:key|api[_-]?key|apikey|token|access[_-]?token|auth|authorization|pass|passwd|password|pwd|secret|sig|signature|session|sessionid|sid|jwt|nonce|_wpnonce|code|cle|jeton|mdp)$/i;

/** Adresse sans secret : identifiants et paramètres sensibles masqués. */
export function masquerAdresse(url: string | null | undefined): string {
  if (!url) {
    return '';
  }
  return String(url)
    .replace(/^(https?:\/\/)[^/@\s]*@/i, '$1')
    .replace(/([?&;])([^=&#;]+)=([^&#;]*)/g, (m, sep: string, nom: string) => (PARAMS_SENSIBLES.test(decodeURIComponentSur(nom)) ? `${sep}${nom}=***` : m));
}

function decodeURIComponentSur(t: string): string {
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

/** Texte libre sans jeton visible (« Bearer … », longues suites hexadécimales ou base64). */
export function masquerTexte(t: string | null | undefined): string {
  return String(t ?? '')
    .replace(/https?:\/\/[^\s»"')]+/g, u => masquerAdresse(u))
    .replace(/\b(Bearer)\s+[\w.~+/-]+=*/gi, '$1 ***')
    .replace(/\b[a-f0-9]{32,}\b/gi, '***')
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/g, '***');
}

const taille = (o?: number) => (o === undefined ? '' : o < 1024 ? `${o} o` : o < 1024 * 1024 ? `${(o / 1024).toFixed(1)} Ko` : `${(o / 1024 / 1024).toFixed(1)} Mo`);

const EXTRACTION: Record<string, string> = {
  selecteurs: 'sélecteurs CSS',
  json: 'API JSON',
  'json-html': 'HTML dans du JSON',
  generique: 'repérage automatique',
  page: 'page de l’oeuvre ({slug})',
  aucune: 'rien d’extrait',
};

/** Une requête, sur une ligne : ce qui a été appelé, ce qui est revenu, ce qui a été vu. */
export function ligneRequete(r: RequeteDiagnostic): string {
  const vu: string[] = [];
  if (r.statut !== undefined) vu.push(`HTTP ${r.statut}`);
  if (r.typeContenu) vu.push(r.typeContenu);
  if (r.octets !== undefined) vu.push(taille(r.octets));
  if (r.ms !== undefined) vu.push(`${r.ms} ms`);
  if (r.extraction) vu.push(`extraction : ${EXTRACTION[r.extraction] ?? r.extraction}${r.blocs !== undefined && r.extraction !== 'json' ? ` (${r.blocs} bloc(s) pour le sélecteur)` : ''}`);
  if (r.json) vu.push('réponse JSON');
  if (r.renduJs) vu.push('page construite en JavaScript (SPA)');
  if (r.blocage) vu.push(`anti-robot : ${r.blocage}`);
  if (r.urlFinale) vu.push(`redirigé vers ${masquerAdresse(r.urlFinale)}`);
  const resultat = r.erreur ? `erreur : ${masquerTexte(r.erreur)}` : `${r.resultats} résultat(s)`;
  return `  · « ${r.requete} » → ${resultat}${vu.length ? ` [${vu.join(' · ')}]` : ''}${r.url ? ` — ${r.methode === 'POST' ? 'POST ' : ''}${masquerAdresse(r.url)}` : ''}`;
}

/** Numéros en plages lisibles : [1, 2, 3, 5, 7, 8] → « 1–3, 5, 7–8 ». */
export function plagesNumeros(numeros: readonly number[]): string {
  const tries = [...new Set(numeros)].sort((a, b) => a - b);
  const plages: string[] = [];
  for (let i = 0; i < tries.length; i += 1) {
    let j = i;
    while (j + 1 < tries.length && tries[j + 1] === tries[j] + 1) j += 1;
    plages.push(j > i ? `${tries[i]}–${tries[j]}` : String(tries[i]));
    i = j;
  }
  return plages.length > 12 ? `${plages.slice(0, 12).join(', ')}, …` : plages.join(', ');
}

/** Liens d'épisodes affichés au plus dans le diagnostic. */
const LUS_AFFICHES = 12;
const NUMEROTATION: Record<string, string> = {
  ordre: 'aucun numéro lisible : numérotés par leur ordre dans la liste (du plus récent au plus ancien)',
  mixte: 'numéros manquants déduits de l’ordre de la liste',
};

function lignesEpisodes(d: DetailEpisodes): string[] {
  const l = [
    `  · page de la série : ${d.pages} page(s) lue(s), extraction ${EXTRACTION[d.extraction] ?? d.extraction} (${d.blocs} bloc(s) pour le sélecteur)${d.renduJs ? ', page construite en JavaScript' : ''}${d.saison ? `, saison ${d.saison} gardée` : ''}`,
  ];
  if (d.numeros?.length) {
    l.push(`  · épisodes trouvés : ${plagesNumeros(d.numeros)} (${d.numeros.length})${d.numerotation && NUMEROTATION[d.numerotation] ? ` — ${NUMEROTATION[d.numerotation]}` : ''}`);
  }
  if (d.langues) {
    const g = d.langues;
    l.push(
      `  · langue des blocs : ${g.vf} VF, ${g.vostfr} VOSTFR, ${g.inconnue} sans marqueur${g.separees ? ' — la page propose les deux langues (listes séparées)' : g.page ? ` — page en ${LL(g.page.langue)}` : ''}${g.presumee ? ` ; blocs sans marqueur présumés ${LL(g.presumee)}` : ''}`,
    );
  }
  for (const x of (d.lus ?? []).slice(0, LUS_AFFICHES)) {
    const adresse = masquerAdresse(x.url);
    l.push(`    – n° ${x.numero ?? '?'}${x.langue ? ` [${LL(x.langue)}]` : ''} ← « ${masquerTexte(x.texte.slice(0, 60)) || '(sans texte)'} » — ${adresse.length > 100 ? `${adresse.slice(0, 99)}…` : adresse}`);
  }
  if ((d.lus?.length ?? 0) > LUS_AFFICHES) l.push(`    – … (${(d.lus?.length ?? 0) - LUS_AFFICHES} autre(s))`);
  return l;
}

/** Langues d'une série sur une source : celle lue, les autres versions, et pourquoi une langue manque. */
export function lignesLangues(g: LanguesDiagnostic): string[] {
  const l = [`  · langue : ${g.courante ? `${LL(g.courante)} pour les épisodes lus` : 'inconnue (la source ne la distingue pas)'}`];
  for (const v of g.variantes) {
    const etat = v.aChercher ? 'recherche dédiée, à la demande' : v.echec ? `échec : ${masquerTexte(v.echec)}` : v.episodes !== undefined ? `${v.episodes} épisode(s)` : 'page lue à la demande';
    l.push(`    – ${LL(v.langue)}${v.presumee ? ' (présumée)' : ''} : ${v.title ? `« ${v.title} » ` : ''}${v.url ? `${masquerAdresse(v.url)} ` : ''}— ${masquerTexte(v.indice)} — ${etat}`);
  }
  for (const x of LANGUES_VERSION) {
    if (g.absentes[x]) l.push(`    – ${LL(x)} indisponible : ${masquerTexte(g.absentes[x])}`);
  }
  return l;
}

/** Lignes d'une source. */
export function lignesSource(x: DiagnosticSource): string[] {
  const l = [`Source « ${x.source} » : ${LIBELLE_STATUT_SOURCE[x.statut]}${x.statut === 'ok' || x.statut === 'aucun-episode' ? ` (${x.episodes} épisode(s))` : ''}`];
  for (const r of x.requetes) l.push(ligneRequete(r));
  if (x.meilleurs?.length) l.push(`  · meilleurs candidats : ${x.meilleurs.map(m => `« ${m.title} » (${m.score}${m.langue !== undefined ? `, ${m.langue ? LL(m.langue) : 'langue non marquée'}` : ''})`).join(', ')} — minimum ${SCORE_MINIMAL}`);
  if (x.serie) l.push(`  · retenu : « ${x.serie.title} » (ressemblance ${x.serie.score}) — ${masquerAdresse(x.serie.url)}`);
  if (x.refuse) l.push(`  · écarté : « ${x.refuse.title} » (ressemblance ${x.refuse.score}, minimum ${SCORE_MINIMAL})`);
  if (x.lectureEpisodes) l.push(...lignesEpisodes(x.lectureEpisodes));
  if (x.langues) l.push(...lignesLangues(x.langues));
  if (x.raison && !x.requetes.some(r => r.erreur === x.raison)) l.push(`  · raison : ${masquerTexte(x.raison)}`);
  if (x.erreur && !x.requetes.some(r => r.erreur === x.erreur) && x.erreur !== x.raison) l.push(`  · ${masquerTexte(x.erreur)}`);
  return l;
}

/** Lignes affichées dans le panneau (« Détail du diagnostic »). */
export function lignesDiagnostic(d: DiagnosticAExporter): string[] {
  const lignes = [`Titres cherchés : ${d.titres.map(t => `« ${t} »`).join(', ') || '(aucun)'}`];
  if (!d.sources.length) lignes.push('Aucune source interrogée.');
  for (const x of d.sources) lignes.push(...lignesSource(x));
  return lignes;
}

/**
 * Texte complet à copier : en-tête (date, plateforme, oeuvre, raison), puis le
 * détail de chaque source. Sans secret (voir `masquerAdresse`).
 */
export function texteDiagnostic(d: DiagnosticAExporter, contexte: { oeuvre?: string; plateforme?: string; quand?: string; message?: string } = {}): string {
  return [
    'Diagnostic Tsuzuku — sources',
    `Date : ${contexte.quand ?? new Date().toISOString()}`,
    ...(contexte.plateforme ? [`Plateforme : ${contexte.plateforme}`] : []),
    ...(contexte.oeuvre ? [`Oeuvre : ${contexte.oeuvre}`] : []),
    `Raison : ${d.raison}`,
    ...(contexte.message ? [`Message : ${masquerTexte(contexte.message)}`] : []),
    '',
    ...lignesDiagnostic(d),
    '',
    '(Aucune clé d’API ni aucun secret : les paramètres sensibles des adresses sont masqués.)',
  ].join('\n');
}

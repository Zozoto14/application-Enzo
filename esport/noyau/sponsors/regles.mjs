/**
 * Sponsors & partenaires : règles PURES (ni base, ni horloge implicite).
 *
 *  - périodes d'une obligation (hebdomadaire, mensuelle, trimestrielle, annuelle, unique) : clé, bornes, liste ;
 *  - avancement d'une période (fait / à faire / en retard) ;
 *  - CSV : lecture (séparateur détecté, guillemets, entrées malformées), écriture SÛRE (formules neutralisées) ;
 *  - correspondance des colonnes d'un import ; montants saisis (« 1 500,50 » → centimes).
 *
 * Jours civils « AAAA-MM-JJ » (heure de Paris pour le club), calculés en UTC sur la date seule.
 */

export const FUSEAU_SPONSORS = 'Europe/Paris';
export const FREQUENCES = Object.freeze(['unique', 'hebdomadaire', 'mensuelle', 'trimestrielle', 'annuelle']);
export const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const JOUR_MS = 86_400_000;

/** Jour civil (AAAA-MM-JJ) d'un instant dans un fuseau. */
export function jourDans(ms, fuseau = FUSEAU_SPONSORS) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Jour valide (calendrier réel, 2000-2100). */
export function jourValide(j) {
  if (typeof j !== 'string' || !MOTIF_JOUR.test(j)) return false;
  const ms = Date.parse(`${j}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === j && j >= '2000-01-01' && j <= '2100-12-31';
}

const msJour = j => Date.parse(`${j}T00:00:00Z`);
const jourMs = ms => new Date(ms).toISOString().slice(0, 10);
export const ajouterJours = (j, n) => jourMs(msJour(j) + n * JOUR_MS);
export const ecartJours = (a, b) => Math.round((msJour(b) - msJour(a)) / JOUR_MS);

/** Semaine ISO (année ISO, numéro) d'un jour. */
function semaineIso(j) {
  const d = new Date(msJour(j));
  const jourSemaine = (d.getUTCDay() + 6) % 7; // lundi = 0
  const jeudi = new Date(d.getTime() + (3 - jourSemaine) * JOUR_MS);
  const annee = jeudi.getUTCFullYear();
  const premierJeudi = new Date(Date.UTC(annee, 0, 4));
  const debutSemaine1 = premierJeudi.getTime() - ((premierJeudi.getUTCDay() + 6) % 7) * JOUR_MS;
  return { annee, numero: 1 + Math.floor((jeudi.getTime() - debutSemaine1 - 3 * JOUR_MS) / (7 * JOUR_MS)) };
}

/**
 * Période d'une fréquence qui contient le jour `j` : `{ cle, debut, fin }` (bornes incluses, AAAA-MM-JJ).
 * Pour « unique », la période est celle de l'obligation entière (`bornes`).
 */
export function periodeDe(frequence, j, bornes = {}) {
  const [a, m] = j.split('-').map(Number);
  switch (frequence) {
    case 'hebdomadaire': {
      const lundi = ajouterJours(j, -((new Date(msJour(j)).getUTCDay() + 6) % 7));
      const s = semaineIso(j);
      return { cle: `${s.annee}-S${String(s.numero).padStart(2, '0')}`, debut: lundi, fin: ajouterJours(lundi, 6) };
    }
    case 'mensuelle': {
      const debut = `${a}-${String(m).padStart(2, '0')}-01`;
      return { cle: debut.slice(0, 7), debut, fin: jourMs(Date.UTC(a, m, 0)) };
    }
    case 'trimestrielle': {
      const t = Math.floor((m - 1) / 3);
      return { cle: `${a}-T${t + 1}`, debut: jourMs(Date.UTC(a, t * 3, 1)), fin: jourMs(Date.UTC(a, t * 3 + 3, 0)) };
    }
    case 'annuelle':
      return { cle: String(a), debut: `${a}-01-01`, fin: `${a}-12-31` };
    default:
      return { cle: 'unique', debut: bornes.debut ?? j, fin: bornes.fin ?? bornes.debut ?? j };
  }
}

/**
 * Périodes d'une obligation entre `debut` et `jusqua` (inclus), ramenées à ses bornes : `[{ cle, debut, fin }]`,
 * de la plus ancienne à la plus récente, au plus `max` (les plus récentes).
 */
export function periodesEntre(frequence, debut, fin, jusqua, max = 60) {
  if (!jourValide(debut)) return [];
  const borneFin = fin && jourValide(fin) ? fin : null;
  if (frequence === 'unique') {
    const f = borneFin ?? debut;
    return debut <= jusqua || f <= jusqua ? [{ cle: 'unique', debut, fin: f }] : [];
  }
  const sortie = [];
  let j = debut;
  const limite = borneFin && borneFin < jusqua ? borneFin : jusqua;
  let garde = 0;
  while (j <= limite && garde++ < 2000) {
    const p = periodeDe(frequence, j);
    sortie.push({ cle: p.cle, debut: p.debut < debut ? debut : p.debut, fin: borneFin && p.fin > borneFin ? borneFin : p.fin });
    j = ajouterJours(p.fin, 1);
  }
  return sortie.slice(-max);
}

/** État d'une période : `fait` (atteint), `en_retard` (terminée sans être atteinte), `a_faire`. */
export function etatPeriode({ fait, quantite, fin }, aujourdhui) {
  if (fait >= quantite) return 'fait';
  return fin < aujourdhui ? 'en_retard' : 'a_faire';
}

// ------------------------------------------------------------------ Montants

/**
 * Montant saisi en euros (« 1500 », « 1 500,50 », « 1500.5 ») ou nombre → centimes (entier ≥ 0).
 * `undefined` si illisible ; borne : 1 milliard d'euros.
 */
export function lireMontant(v) {
  if (v === undefined || v === null || v === '') return 0;
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v.replace(/[\s  ]/g, '').replace(/€|eur$/i, '');
    if (!/^\d+([.,]\d{1,2})?$/.test(t)) return undefined;
    n = Number(t.replace(',', '.'));
  } else return undefined;
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return undefined;
  return Math.round(n * 100);
}

// ------------------------------------------------------------------ CSV

/**
 * Champ CSV SÛR : guillemets doublés, et formule neutralisée (injection dans un tableur) quand le texte
 * commence — même après des espaces — par =, +, -, @, une tabulation ou un retour chariot : une apostrophe est
 * ajoutée devant. Les retours à la ligne internes restent (entre guillemets).
 */
export function champCsvSur(valeur) {
  let t = valeur === null || valeur === undefined ? '' : String(valeur);
  if (/^[\s]*[=+\-@\t\r]/.test(t) || /^[\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

/** Texte CSV (séparateur virgule, CRLF, BOM UTF-8 pour les tableurs), champs sûrs. */
export function ecrireCsv(entetes, lignes) {
  return `﻿${[entetes, ...lignes].map(l => l.map(champCsvSur).join(',')).join('\r\n')}\r\n`;
}

export class CsvInvalide extends Error {
  constructor(code, ligne) {
    super(code);
    this.code = code;
    this.ligne = ligne;
  }
}

/**
 * Lit un CSV : séparateur détecté sur la première ligne (virgule, point-virgule, tabulation), guillemets
 * doublés, retours à la ligne entre guillemets. Lève `CsvInvalide` : guillemet non refermé, trop de lignes,
 * trop de colonnes, champ trop long. Les lignes vides sont ignorées. Rend `{ separateur, lignes: string[][] }`
 * avec, pour chaque ligne, son numéro dans le fichier (`numeros`).
 */
export function lireCsv(contenu, { maxLignes = 2000, maxColonnes = 40, maxChamp = 4000 } = {}) {
  const texte = String(contenu ?? '').replace(/^﻿/, '');
  const premiere = texte.split(/\r?\n/, 1)[0] ?? '';
  const compte = c => premiere.split(c).length - 1;
  const separateur = compte(';') > compte(',') && compte(';') >= compte('\t') ? ';' : compte('\t') > compte(',') ? '\t' : ',';
  const lignes = [];
  const numeros = [];
  let ligne = [];
  let champ = '';
  let guillemets = false;
  let numero = 1;
  let debutLigne = 1;
  const finChamp = () => {
    if (champ.length > maxChamp) throw new CsvInvalide('champ-trop-long', debutLigne);
    ligne.push(champ);
    champ = '';
    if (ligne.length > maxColonnes) throw new CsvInvalide('trop-de-colonnes', debutLigne);
  };
  const finLigne = () => {
    finChamp();
    if (ligne.some(v => v.trim())) {
      lignes.push(ligne);
      numeros.push(debutLigne);
      if (lignes.length > maxLignes + 1) throw new CsvInvalide('trop-de-lignes', debutLigne);
    }
    ligne = [];
  };
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i++;
        } else guillemets = false;
      } else {
        if (c === '\n') numero++;
        champ += c;
        if (champ.length > maxChamp) throw new CsvInvalide('champ-trop-long', debutLigne);
      }
    } else if (c === '"' && champ.trim() === '') {
      champ = '';
      guillemets = true;
    } else if (c === separateur) finChamp();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      finLigne();
      numero++;
      debutLigne = numero;
    } else champ += c;
  }
  if (guillemets) throw new CsvInvalide('guillemet-non-ferme', debutLigne);
  finLigne();
  return { separateur, lignes, numeros };
}

/** Champs d'un prospect qu'une colonne peut alimenter (import). */
export const CHAMPS_IMPORT = Object.freeze([
  'nom',
  'site',
  'secteur',
  'taille',
  'source',
  'interet',
  'priorite',
  'valeur',
  'etape',
  'notes',
  'prochaine_action',
  'contact_nom',
  'contact_role',
  'contact_email',
  'contact_telephone',
  'contact_reseaux',
]);

const sansAccents = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const ALIAS_IMPORT = {
  nom: ['nom', 'entreprise', 'societe', 'marque', 'company', 'brand', 'name', 'organisation', 'organization'],
  site: ['site', 'site web', 'website', 'url', 'web'],
  secteur: ['secteur', 'industrie', 'industry', 'sector', 'domaine'],
  taille: ['taille', 'size', 'effectif'],
  source: ['source', 'origine', 'origin'],
  interet: ['interet', 'interest'],
  priorite: ['priorite', 'priority'],
  valeur: ['valeur', 'valeur estimee', 'montant', 'value', 'amount', 'budget'],
  etape: ['etape', 'stage', 'statut', 'status'],
  notes: ['notes', 'note', 'commentaire', 'comments'],
  prochaine_action: ['prochaine action', 'next action', 'action'],
  contact_nom: ['contact', 'nom du contact', 'contact name', 'interlocuteur'],
  contact_role: ['role', 'fonction', 'poste', 'title', 'job title'],
  contact_email: ['email', 'e-mail', 'mail', 'courriel', 'adresse e-mail'],
  contact_telephone: ['telephone', 'tel', 'phone', 'portable', 'mobile'],
  contact_reseaux: ['reseaux', 'reseaux sociaux', 'social', 'socials', 'linkedin'],
};

/** Correspondance proposée `{ indexColonne: champ }` à partir des en-têtes (un champ au plus une fois). */
export function correspondanceProposee(entetes) {
  const sortie = {};
  const pris = new Set();
  const norme = x => sansAccents(String(x ?? '')).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  entetes.forEach((e, i) => {
    const t = norme(e);
    for (const champ of CHAMPS_IMPORT) {
      if (pris.has(champ)) continue;
      if (t === norme(champ) || ALIAS_IMPORT[champ].some(a => norme(a) === t)) {
        sortie[i] = champ;
        pris.add(champ);
        return;
      }
    }
  });
  return sortie;
}

export const sansAccentsMinuscules = sansAccents;

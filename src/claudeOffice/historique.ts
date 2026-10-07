/**
 * Historique de Claude Office : logique pure de l'écran (sans React ni pont).
 *
 * Les entrées viennent du journal local du PC (hook de Claude Code, voir
 * bureau/electron/officeHistorique.mjs et docs/claude-office-historique.md)
 * et, si la synchro est activée, des copies chiffrées déposées sur le relais
 * par les autres appareils équipés. Ici : fusion (déduplication par
 * identifiant), recherche plein texte, filtres, regroupement par jour et par
 * session, compteurs, export JSON/CSV.
 */

export type TypeEntree = 'demande' | 'outil' | 'debut-session' | 'fin-session' | 'fin-reponse' | 'fin-sous-agent';

export interface EntreeHistorique {
  v: 1;
  id: string;
  /** Horodatage ISO. */
  ts: string;
  type: TypeEntree | string;
  source?: string;
  appareil?: string;
  appareilId?: string;
  session?: string;
  dossier?: string;
  projet?: string;
  /** Texte de la demande (secrets masqués). */
  texte?: string;
  outil?: string;
  /** Résumé court (fichier visé, début de commande…). */
  resume?: string;
  /** Contenu des entrées/sorties d'outils, seulement si le réglage l'autorise. */
  entree?: string;
  sortie?: string;
  echec?: boolean;
  importe?: boolean;
  tronque?: boolean;
}

export const LIBELLES_TYPES: Record<string, string> = {
  demande: 'Demande',
  outil: 'Outil',
  'debut-session': 'Début de session',
  'fin-session': 'Fin de session',
  'fin-reponse': 'Fin de réponse',
  'fin-sous-agent': 'Fin de sous-agent',
};

/** Entrée de forme valide (tout ce qui vient d'un fichier ou du relais passe par là). */
export function entreeValide(e: unknown): e is EntreeHistorique {
  const o = e as Partial<EntreeHistorique> | null;
  return (
    !!o && typeof o === 'object' && !Array.isArray(o) && o.v === 1 &&
    typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 100 &&
    typeof o.ts === 'string' && !Number.isNaN(Date.parse(o.ts)) && typeof o.type === 'string'
  );
}

/** Fusion de plusieurs sources : une entrée par identifiant (la première vue gagne), triées par date. */
export function fusionner(...sources: ReadonlyArray<readonly unknown[] | undefined>): EntreeHistorique[] {
  const parId = new Map<string, EntreeHistorique>();
  for (const source of sources) {
    for (const e of source ?? []) {
      if (entreeValide(e) && !parId.has(e.id)) parId.set(e.id, e);
    }
  }
  return [...parId.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
}

export interface Filtres {
  recherche?: string;
  projet?: string;
  appareil?: string;
  outil?: string;
  type?: string;
  /** Bornes de période (incluses), ISO ou AAAA-MM-JJ. */
  du?: string;
  au?: string;
}

/** Sans accents ni casse, pour une recherche tolérante. */
export const normaliser = (texte: string): string =>
  texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const debutJour = (jour: string) => Date.parse(jour.length === 10 ? `${jour}T00:00:00` : jour);
const finJour = (jour: string) => (jour.length === 10 ? Date.parse(`${jour}T23:59:59.999`) : Date.parse(jour));

/** Texte où chercher : demande, résumé, outil, projet, contenus enregistrés. */
const texteDe = (e: EntreeHistorique) =>
  normaliser([e.texte, e.resume, e.outil, e.projet, e.dossier, e.entree, e.sortie, e.appareil].filter(Boolean).join('\n'));

export function filtrer(entrees: readonly EntreeHistorique[], f: Filtres): EntreeHistorique[] {
  const mots = normaliser(f.recherche ?? '').split(/\s+/).filter(Boolean);
  const du = f.du ? debutJour(f.du) : undefined;
  const au = f.au ? finJour(f.au) : undefined;
  return entrees.filter(e => {
    if (f.projet && e.projet !== f.projet) return false;
    if (f.appareil && e.appareil !== f.appareil) return false;
    if (f.outil && e.outil !== f.outil) return false;
    if (f.type && e.type !== f.type) return false;
    const t = Date.parse(e.ts);
    if (du !== undefined && !Number.isNaN(du) && t < du) return false;
    if (au !== undefined && !Number.isNaN(au) && t > au) return false;
    if (mots.length) {
      const texte = texteDe(e);
      if (!mots.every(m => texte.includes(m))) return false;
    }
    return true;
  });
}

/** Valeurs proposées dans les filtres (triées, sans doublon). */
export function valeursFiltres(entrees: readonly EntreeHistorique[]) {
  const ensemble = (cle: 'projet' | 'appareil' | 'outil') =>
    [...new Set(entrees.map(e => e[cle]).filter((v): v is string => typeof v === 'string' && v !== ''))].sort((a, b) => a.localeCompare(b, 'fr'));
  return { projets: ensemble('projet'), appareils: ensemble('appareil'), outils: ensemble('outil') };
}

export interface Compteurs {
  total: number;
  demandes: number;
  outils: number;
  sessions: number;
  projets: number;
  appareils: number;
  jours: number;
}

export function compter(entrees: readonly EntreeHistorique[]): Compteurs {
  const sessions = new Set<string>();
  const projets = new Set<string>();
  const appareils = new Set<string>();
  const jours = new Set<string>();
  let demandes = 0;
  let outils = 0;
  for (const e of entrees) {
    if (e.type === 'demande') demandes++;
    if (e.type === 'outil') outils++;
    if (e.session) sessions.add(e.session);
    if (e.projet) projets.add(e.projet);
    if (e.appareil) appareils.add(e.appareil);
    jours.add(jourLocal(e.ts));
  }
  return { total: entrees.length, demandes, outils, sessions: sessions.size, projets: projets.size, appareils: appareils.size, jours: jours.size };
}

/** AAAA-MM-JJ dans le fuseau de l'appareil. */
export function jourLocal(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function libelleJour(jour: string, maintenant = Date.now()): string {
  const aujourdhui = jourLocal(new Date(maintenant).toISOString());
  const hier = jourLocal(new Date(maintenant - 86_400_000).toISOString());
  if (jour === aujourdhui) return 'Aujourd’hui';
  if (jour === hier) return 'Hier';
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export const heure = (ts: string): string =>
  new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export interface GroupeSession {
  session: string;
  projet?: string;
  appareil?: string;
  entrees: EntreeHistorique[];
}
export interface GroupeJour {
  jour: string;
  sessions: GroupeSession[];
}

/** Du plus récent au plus ancien : jours, puis sessions (par dernière activité), puis entrées. */
export function grouper(entrees: readonly EntreeHistorique[]): GroupeJour[] {
  const jours = new Map<string, Map<string, GroupeSession>>();
  for (const e of [...entrees].reverse()) {
    const jour = jourLocal(e.ts);
    const cle = `${e.appareil ?? ''}|${e.session ?? 'sans-session'}`;
    let sessions = jours.get(jour);
    if (!sessions) jours.set(jour, (sessions = new Map()));
    let groupe = sessions.get(cle);
    if (!groupe) sessions.set(cle, (groupe = { session: e.session ?? 'sans-session', projet: e.projet, appareil: e.appareil, entrees: [] }));
    groupe.entrees.push(e);
    if (!groupe.projet && e.projet) groupe.projet = e.projet;
  }
  return [...jours.entries()].map(([jour, sessions]) => ({ jour, sessions: [...sessions.values()] }));
}

/** Titre court d'une entrée, pour la liste. */
export function titreEntree(e: EntreeHistorique): string {
  const coupe = (t: string, n = 160) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  switch (e.type) {
    case 'demande':
      return coupe((e.texte ?? '').replace(/\s+/g, ' ').trim() || '(demande vide)');
    case 'outil':
      return coupe(`${e.outil ?? 'Outil'}${e.resume ? ` · ${e.resume}` : ''}`);
    default:
      return `${LIBELLES_TYPES[e.type] ?? e.type}${e.resume ? ` (${e.resume})` : ''}`;
  }
}

/** Texte complet d'une entrée, pour « Copier ». */
export function texteComplet(e: EntreeHistorique): string {
  const lignes = [
    `${LIBELLES_TYPES[e.type] ?? e.type} — ${new Date(e.ts).toLocaleString('fr-FR')}`,
    e.appareil ? `Appareil : ${e.appareil}` : '',
    e.projet ? `Projet : ${e.projet}${e.dossier ? ` (${e.dossier})` : ''}` : '',
    e.session ? `Session : ${e.session}` : '',
    e.outil ? `Outil : ${e.outil}` : '',
    e.resume ? `Résumé : ${e.resume}` : '',
    e.texte ? `\n${e.texte}` : '',
    e.entree ? `\nEntrée :\n${e.entree}` : '',
    e.sortie ? `\nSortie :\n${e.sortie}` : '',
  ];
  return lignes.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- export

export const COLONNES_CSV = ['id', 'ts', 'type', 'appareil', 'projet', 'dossier', 'session', 'outil', 'resume', 'texte', 'entree', 'sortie', 'echec'] as const;

/** Une cellule CSV : guillemets doublés ; une formule (=, +, -, @) est neutralisée pour les tableurs. */
export function celluleCsv(valeur: unknown): string {
  if (valeur === undefined || valeur === null) return '';
  let texte = String(valeur);
  if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  return /[";\n\r,]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

export function exporterCsv(entrees: readonly EntreeHistorique[]): string {
  const lignes = [COLONNES_CSV.join(';')];
  for (const e of entrees) lignes.push(COLONNES_CSV.map(c => celluleCsv(e[c])).join(';'));
  // BOM : Excel lit l'UTF-8 (accents) correctement.
  return `﻿${lignes.join('\r\n')}\r\n`;
}

export function exporterJson(entrees: readonly EntreeHistorique[], maintenant = new Date()): string {
  return `${JSON.stringify({ format: 'claude-office-historique', version: 1, exporteLe: maintenant.toISOString(), entrees }, null, 2)}\n`;
}

export const nomExport = (format: 'json' | 'csv', maintenant = new Date()): string =>
  `historique-claude-${maintenant.toISOString().slice(0, 10)}.${format}`;

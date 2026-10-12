/**
 * Claude Office (v4) : les SOUS-AGENTS dans la scène — logique pure, testée
 * dans sceneV4.test.tsx.
 *
 * Contrat (le même que le module de données `sousAgents(evenements)` de
 * l'intégration, docs/claude-office.md) : par session, une liste de
 * sous-agents {id, parent, description, type, modèle, début, fin, état,
 * durée}. En attendant le module complet, on les DÉDUIT de l'historique :
 * chaque outil « Task » / « Agent » noté à sa fin avec sa durée a tourné de
 * (fin − durée) à fin ; la démo en fournit d'autres, en parallèle.
 *
 * Rendu : un petit personnage (mini-version du parent) sort de la Salle de
 * réunion, va dans la zone de son activité (ou reste près du parent), puis
 * revient « rendre » son travail au parent et disparaît.
 */

import type { Agent } from './logiqueBureau';
import type { EntreeHistorique } from './logiqueHistorique';
import { RECTS_ZONES, type Point } from './logiqueScene';
import type { Zone } from './zones';

export type EtatSousAgent = 'en-cours' | 'termine' | 'echec';

/** Un sous-agent (contrat du module de données). */
export interface SousAgent {
  id: string;
  /** Clé de l'agent parent (appareil + session). */
  parent: string;
  description?: string;
  /** Type de sous-agent (Explore, Plan, general-purpose…). */
  type?: string;
  modele?: string;
  /** Début et fin (ms). */
  debut: number;
  fin?: number;
  etat: EtatSousAgent;
  /** Durée (ms), quand elle est connue. */
  duree?: number;
}

/** Temps de l'animation « rendu au parent » après la fin (ms) : ensuite, il disparaît. */
export const DUREE_RENDU_MS = 4_000;
/** Au-delà, les mini-personnages sont regroupés en « +N » (performances, lisibilité). */
export const MAX_MINIS = 6;

const cleAppareil = (e: EntreeHistorique) => e.appareilId ?? e.appareil ?? 'appareil';

/**
 * Sous-agents déduits de l'historique : un outil Task / Agent terminé à `ts`
 * avec sa durée. Ceux qui ne sont pas encore finis à l'instant `t` (relecture)
 * sont « en cours ».
 */
export function deduireSousAgents(entrees: readonly EntreeHistorique[], t: number): SousAgent[] {
  const res: SousAgent[] = [];
  for (const e of entrees) {
    if (e.type !== 'outil' || !/^(task|agent)$/i.test(e.outil ?? '')) continue;
    const fin = Date.parse(e.ts);
    if (!Number.isFinite(fin)) continue;
    const duree = typeof e.duree === 'number' && e.duree > 0 ? e.duree : undefined;
    const debut = fin - (duree ?? 0);
    if (debut > t) continue;
    const enCours = fin > t;
    res.push({
      id: e.id,
      parent: `${cleAppareil(e)}|${e.session ?? 'sans-session'}`,
      description: e.resume,
      type: e.outil === 'Agent' ? 'Agent' : 'Task',
      debut,
      ...(enCours ? {} : { fin }),
      etat: enCours ? 'en-cours' : e.echec ? 'echec' : 'termine',
      ...(duree ? { duree } : {}),
    });
  }
  return res;
}

export type PhaseSousAgent = 'travaille' | 'rendu';

export interface SousAgentVisible extends SousAgent {
  phase: PhaseSousAgent;
}

/**
 * Ceux qu'on dessine à l'instant `t` : en cours, ou finis depuis moins de
 * `DUREE_RENDU_MS` (ils rendent leur travail) ; seulement si le parent est là.
 * Les plus récents d'abord ; au-delà de `MAX_MINIS`, le reste est compté.
 */
export function sousAgentsVisibles(liste: readonly SousAgent[], parents: ReadonlySet<string>, t: number): { visibles: SousAgentVisible[]; enPlus: number } {
  const tous = liste
    .filter(s => parents.has(s.parent) && s.debut <= t && (s.fin === undefined || s.etat === 'en-cours' || t - s.fin < DUREE_RENDU_MS))
    .map(s => ({ ...s, phase: (s.fin !== undefined && s.fin <= t && s.etat !== 'en-cours' ? 'rendu' : 'travaille') as PhaseSousAgent }))
    .sort((a, b) => b.debut - a.debut || (a.id < b.id ? -1 : 1));
  return { visibles: tous.slice(0, MAX_MINIS), enPlus: Math.max(0, tous.length - MAX_MINIS) };
}

/** Sous-agents en cours par parent (compteur discret sur le parent). */
export function compterParParent(liste: readonly SousAgent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of liste) if (s.etat === 'en-cours') m.set(s.parent, (m.get(s.parent) ?? 0) + 1);
  return m;
}

/** Où travaille un sous-agent, selon son type ; inconnu : près de son parent. */
export function zoneSousAgent(s: Pick<SousAgent, 'type' | 'description'>): Zone | undefined {
  const t = `${s.type ?? ''} ${s.description ?? ''}`;
  if (/explore|cherche|search|lis|lit|read|analyse|audit/i.test(t)) return 'bibliotheque';
  if (/plan|organis|conçoi|concoi/i.test(t)) return 'reunion';
  if (/test|build|bash|commande|lance|vérifi|verifi/i.test(t)) return 'machines';
  if (/web|doc|navig/i.test(t)) return 'cafe';
  if (/écri|ecri|code|corrige|implémente|implemente|refacto/i.test(t)) return 'atelier';
  return undefined;
}

/** Sortie de la Salle de réunion (au sol, en dalles) : d'où partent les sous-agents. */
export const SORTIE_REUNION: Point = { x: 4.3, y: 4.9 };

/** Emplacements libres (en dalles) de chaque zone pour les mini-personnages : en bord de zone, hors des places. */
const EMPLACEMENTS: Record<Zone, Array<[number, number]>> = (Object.keys(RECTS_ZONES) as Zone[]).reduce((acc, z) => {
  const r = RECTS_ZONES[z];
  const pts: Array<[number, number]> = [];
  for (const fy of [0.88, 0.62]) for (const fx of [0.12, 0.38, 0.62, 0.88]) pts.push([r.x0 + (r.x1 - r.x0) * fx, r.y0 + (r.y1 - r.y0) * fy]);
  acc[z] = pts;
  return acc;
}, {} as Record<Zone, Array<[number, number]>>);

/** Décalages autour du parent (dalles), quand on ne sait pas où va le sous-agent. */
const AUTOUR: Array<[number, number]> = [[0.75, 0.55], [-0.6, 0.75], [0.85, -0.45], [-0.75, -0.5], [0.2, 0.95], [1.05, 0.15]];

/**
 * Position (au sol, en dalles) de chaque mini-personnage : un emplacement par
 * zone, jamais deux au même endroit ; près du parent sinon. Déterministe.
 */
export function placerSousAgents(visibles: readonly SousAgentVisible[], positionParent: (cle: string) => Point | undefined): Map<string, Point> {
  const res = new Map<string, Point>();
  const pris = new Map<Zone, number>();
  const autour = new Map<string, number>();
  for (const s of [...visibles].sort((a, b) => a.debut - b.debut || (a.id < b.id ? -1 : 1))) {
    const parent = positionParent(s.parent);
    if (s.phase === 'rendu' && parent) {
      res.set(s.id, { x: parent.x + 0.35, y: parent.y + 0.35 });
      continue;
    }
    const z = zoneSousAgent(s);
    if (z) {
      const k = pris.get(z) ?? 0;
      pris.set(z, k + 1);
      const [x, y] = EMPLACEMENTS[z][k % EMPLACEMENTS[z].length];
      res.set(s.id, { x, y });
    } else if (parent) {
      const k = autour.get(s.parent) ?? 0;
      autour.set(s.parent, k + 1);
      const [dx, dy] = AUTOUR[k % AUTOUR.length];
      res.set(s.id, { x: Math.max(0.4, Math.min(19.6, parent.x + dx)), y: Math.max(0.4, Math.min(13.6, parent.y + dy)) });
    } else res.set(s.id, { ...SORTIE_REUNION });
  }
  return res;
}

// ------------------------------------------------------------------ démo

const DESCRIPTIONS_DEMO: ReadonlyArray<[string, string]> = [
  ['Explore', 'Cherche les usages de l’export'],
  ['general-purpose', 'Vérifie les cas limites'],
  ['Plan', 'Planifie la migration'],
  ['Explore', 'Analyse les tests qui échouent'],
  ['general-purpose', 'Écrit la documentation'],
];

/**
 * Sous-agents fictifs de la démo : trois sessions en lancent régulièrement
 * (20 à 26 s chacun), si bien que deux ou trois tournent en parallèle.
 */
export function sousAgentsDemo(debut: number, maintenant: number, parents: readonly Agent[]): SousAgent[] {
  const res: SousAgent[] = [];
  const ecoule = (maintenant - debut) / 1000;
  const hotes = parents.filter(a => a.session.startsWith('demo-') && !a.session.startsWith('demo-visiteur') && a.etat !== 'termine' && !a.salle).slice(0, 3);
  hotes.forEach((p, r) => {
    const periode = 34 + r * 5;
    const decalage = 3 + r * 9;
    const dernier = Math.floor((ecoule - decalage) / periode);
    for (let k = Math.max(0, dernier - 1); k <= dernier; k++) {
      const d = decalage + k * periode;
      const duree = (20 + ((k + r) % 3) * 3) * 1000;
      const [type, description] = DESCRIPTIONS_DEMO[(r * 2 + k) % DESCRIPTIONS_DEMO.length];
      const tDebut = debut + d * 1000;
      const tFin = tDebut + duree;
      if (tDebut > maintenant) continue;
      const fini = tFin <= maintenant;
      res.push({ id: `demo-sa-${r}-${k}`, parent: p.cle, type, description, modele: 'claude-sonnet', debut: tDebut, ...(fini ? { fin: tFin } : {}), etat: fini ? 'termine' : 'en-cours', duree });
    }
  });
  return res;
}

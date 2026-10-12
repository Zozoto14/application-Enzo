/**
 * Claude Office v4 : SOUS-AGENTS d'une session, logique pure (sans React ni pont).
 *
 * Contrat pour la scène (rendu) : `sousAgents(entrees, { maintenant })` → par clé de session
 * (`appareil|session`, la même que `Agent.cle` de logiqueBureau.ts) la liste des sous-agents :
 *
 *   { id, cleSession, session, parent, profondeur, description?, type?, modele?, arrierePlan?,
 *     debut, fin?, debutInconnu?, etat: 'en-cours' | 'termine' | 'echec' | 'expire', dureeMs,
 *     outils: [{ nom, n }], nbOutils, echecs, dernier }
 *
 * D'où viennent les données (hook d'historique v4, docs/claude-office.md) :
 *  - `debut-sous-agent` (SubagentStart : agent_id, agent_type) et `fin-sous-agent` (SubagentStop) ;
 *  - l'outil `Agent` (ex-`Task`), noté à sa FIN (PostToolUse) : description courte, `sousAgentType`,
 *    `modele`, `arrierePlan`, durée, échec ; `agentLance` si Claude Code renvoie l'identifiant ;
 *  - les outils lancés DANS un sous-agent portent `agent` (agent_id) : ils lui sont attribués.
 *
 * Robuste aux trous : un lancement sans SubagentStart (hook d'avant la v4) crée le sous-agent ; une fin sans
 * identifiant (ancien SubagentStop) va au plus ancien sous-agent en cours du même type ; une fin sans début
 * crée un sous-agent `debutInconnu` ; un début sans fin expire après `EXPIRATION_SOUS_AGENT_MS` sans
 * activité, ou à la fin de la session. Sous-agents en parallèle et imbriqués (un lancement fait DANS un
 * sous-agent a ce sous-agent pour parent) compris.
 */

import { cleAppareil, resumerTexte } from './logiqueBureau';
import { fusionner, jourLocal, type EntreeHistorique } from './logiqueHistorique';

export type EtatSousAgent = 'en-cours' | 'termine' | 'echec' | 'expire';

export interface SousAgent {
  /** agent_id de Claude Code, ou identifiant fabriqué (`lance-…`, `fin-…`) quand il manque. */
  id: string;
  cleSession: string;
  session: string;
  /** Session (identifiant) pour un sous-agent de premier niveau, sinon l'id du sous-agent parent. */
  parent: string;
  /** 1 : lancé par l'agent principal ; 2 : par un sous-agent… */
  profondeur: number;
  /** Description courte donnée au lancement (secrets masqués). */
  description?: string;
  /** Type de sous-agent (Explore, Plan, general-purpose…). */
  type?: string;
  modele?: string;
  arrierePlan?: boolean;
  /** Début (ms) ; `debutInconnu` : estimé (fin vue sans début). */
  debut: number;
  debutInconnu?: boolean;
  /** Fin (ms), si connue. */
  fin?: number;
  etat: EtatSousAgent;
  /** Durée (ms) : jusqu'à la fin, ou jusqu'à maintenant s'il tourne, ou jusqu'à sa dernière activité s'il a expiré. */
  dureeMs: number;
  /** Outils utilisés DANS le sous-agent (attribués par agent_id), les plus fréquents d'abord. */
  outils: Array<{ nom: string; n: number }>;
  nbOutils: number;
  echecs: number;
  /** Dernière activité connue (ms). */
  dernier: number;
}

/** Un sous-agent sans nouvelle depuis ce délai (ni fin) est « expiré ». */
export const EXPIRATION_SOUS_AGENT_MS = 30 * 60_000;
/** Écart maximal entre un lancement (outil Agent) et un SubagentStart pour les apparier. */
export const APPARIEMENT_MS = 60_000;

const t = (e: EntreeHistorique) => Date.parse(e.ts);
const estLancement = (e: EntreeHistorique) => e.type === 'outil' && /^(agent|task)$/i.test(e.outil ?? '');
const typesCompatibles = (a?: string, b?: string) => !a || !b || a === b;

interface Interne extends Omit<SousAgent, 'etat' | 'dureeMs' | 'outils' | 'profondeur'> {
  /** Fin déduite du lancement (outil Agent au premier plan, noté à sa fin). */
  finLancement?: number;
  arrete?: boolean;
  lance?: boolean;
  echecLancement?: boolean;
  parOutil: Map<string, number>;
}

export interface OptionsSousAgents {
  maintenant: number;
  /** Date du dernier dépôt par appareil (copie du relais) : l'état est jugé à cette date. */
  references?: Record<string, number>;
}

/** Sous-agents d'UNE session (entrées triées de cette session). */
function sousAgentsSession(cleSession: string, liste: readonly EntreeHistorique[], o: OptionsSousAgents): SousAgent[] {
  const session = liste[0]?.session ?? 'sans-session';
  const agents: Interne[] = [];
  const parId = new Map<string, Interne>();
  const creer = (a: Omit<Interne, 'parOutil' | 'cleSession' | 'session' | 'parent' | 'nbOutils' | 'echecs' | 'dernier'> & Partial<Interne>): Interne => {
    const n: Interne = { cleSession, session, parent: session, nbOutils: 0, echecs: 0, dernier: a.debut, parOutil: new Map(), ...a };
    agents.push(n);
    parId.set(n.id, n);
    return n;
  };
  const dernierTs = liste.length ? t(liste[liste.length - 1]) : o.maintenant;
  const ref = o.references?.[cleAppareil(liste[liste.length - 1] ?? {})];
  const reference = ref !== undefined ? Math.max(ref, dernierTs) : o.maintenant;
  const finSession = liste.find(e => e.type === 'fin-session');

  // 1. Débuts (SubagentStart).
  for (const e of liste.filter(x => x.type === 'debut-sous-agent')) {
    const id = e.agent ?? `debut-${e.id}`;
    const deja = parId.get(id);
    if (deja) deja.debut = Math.min(deja.debut, t(e));
    else creer({ id, debut: t(e), ...(e.agentType ? { type: e.agentType } : {}) });
  }

  // 2. Lancements (outil Agent, noté à sa fin) : rattachés à un début, ou sous-agent créé.
  for (const e of liste.filter(estLancement)) {
    const fin = t(e);
    const debutApprox = fin - (e.duree ?? 0);
    const type = e.sousAgentType;
    let cible = e.agentLance ? parId.get(e.agentLance) : undefined;
    if (!cible) {
      let meilleur: Interne | undefined;
      for (const a of agents) {
        if (a.lance || !typesCompatibles(a.type, type)) continue;
        const ecart = Math.abs(a.debut - debutApprox);
        if (ecart > APPARIEMENT_MS) continue;
        if (!meilleur || ecart < Math.abs(meilleur.debut - debutApprox)) meilleur = a;
      }
      cible = meilleur;
    }
    if (!cible) cible = creer({ id: e.agentLance ?? `lance-${e.id}`, debut: debutApprox });
    cible.lance = true;
    if (e.resume) cible.description = resumerTexte(e.resume, 120);
    if (type && !cible.type) cible.type = type;
    if (e.modele) cible.modele = e.modele;
    if (e.arrierePlan !== undefined) cible.arrierePlan = e.arrierePlan;
    if (e.agent && e.agent !== cible.id) cible.parent = e.agent;
    if (e.echec) cible.echecLancement = true;
    // Au premier plan, l'outil Agent se termine avec le sous-agent.
    if (e.arrierePlan !== true && e.duree !== undefined) cible.finLancement = fin;
  }

  // 3. Fins (SubagentStop) : par identifiant, sinon le plus ancien en cours du même type.
  for (const e of liste.filter(x => x.type === 'fin-sous-agent')) {
    const ts = t(e);
    let cible = e.agent ? parId.get(e.agent) : undefined;
    if (!cible && !e.agent) {
      const candidats = agents.filter(a => !a.arrete && a.debut <= ts + 1_000 && typesCompatibles(a.type, e.agentType));
      // D'abord celui dont le lancement finit juste après (premier plan), sinon le plus ancien.
      cible = candidats.find(a => a.finLancement !== undefined && a.finLancement >= ts - 1_000 && a.finLancement - ts <= APPARIEMENT_MS)
        ?? candidats.sort((a, b) => a.debut - b.debut)[0];
    }
    if (!cible) cible = creer({ id: e.agent ?? `fin-${e.id}`, debut: ts, debutInconnu: true, ...(e.agentType ? { type: e.agentType } : {}) });
    cible.arrete = true;
    cible.fin = cible.fin === undefined ? ts : Math.max(cible.fin, ts);
    if (e.agentType && !cible.type) cible.type = e.agentType;
  }
  for (const a of agents) if (a.fin === undefined && a.finLancement !== undefined) a.fin = a.finLancement;

  // 4. Outils lancés DANS un sous-agent.
  for (const e of liste) {
    if (!e.agent || e.type === 'debut-sous-agent' || e.type === 'fin-sous-agent') continue;
    const ts = t(e);
    let a = parId.get(e.agent);
    if (!a) a = creer({ id: e.agent, debut: ts, debutInconnu: true, ...(e.agentType ? { type: e.agentType } : {}) });
    if (a.debutInconnu && ts < a.debut) a.debut = ts;
    a.dernier = Math.max(a.dernier, ts);
    if (e.type === 'outil' && !estLancement(e)) {
      a.nbOutils++;
      if (e.echec) a.echecs++;
      if (e.outil) a.parOutil.set(e.outil, (a.parOutil.get(e.outil) ?? 0) + 1);
    }
  }

  // 5. États, durées, profondeur.
  const profondeur = (a: Interne, vus = new Set<string>()): number => {
    const p = parId.get(a.parent);
    if (!p || vus.has(p.id)) return 1;
    vus.add(a.id);
    return 1 + profondeur(p, vus);
  };
  return agents
    .map(a => {
      const dernier = Math.max(a.dernier, a.debut, a.fin ?? 0);
      let etat: EtatSousAgent;
      if (a.fin !== undefined) etat = a.echecLancement ? 'echec' : 'termine';
      else if (a.echecLancement) etat = 'echec';
      else if ((finSession && t(finSession) >= a.debut) || reference - dernier > EXPIRATION_SOUS_AGENT_MS) etat = 'expire';
      else etat = 'en-cours';
      const bout = a.fin ?? (etat === 'en-cours' ? reference : dernier);
      const { parOutil, finLancement: _f, arrete: _a, lance: _l, echecLancement: _e, ...reste } = a;
      return {
        ...reste,
        etat,
        dernier,
        dureeMs: Math.max(0, bout - a.debut),
        outils: [...parOutil].map(([nom, n]) => ({ nom, n })).sort((x, y) => y.n - x.n || x.nom.localeCompare(y.nom)),
        profondeur: profondeur(a),
      } as SousAgent;
    })
    .sort((x, y) => x.debut - y.debut || (x.id < y.id ? -1 : 1));
}

/** Sous-agents de chaque session, par clé `appareil|session` (sessions sans sous-agent absentes). */
export function sousAgents(entrees: readonly EntreeHistorique[], o: OptionsSousAgents): Record<string, SousAgent[]> {
  const parSession = new Map<string, EntreeHistorique[]>();
  for (const e of fusionner(entrees)) {
    const cle = `${cleAppareil(e)}|${e.session ?? 'sans-session'}`;
    let l = parSession.get(cle);
    if (!l) parSession.set(cle, (l = []));
    l.push(e);
  }
  const res: Record<string, SousAgent[]> = {};
  for (const [cle, liste] of parSession) {
    if (!liste.some(e => e.type === 'debut-sous-agent' || e.type === 'fin-sous-agent' || e.agent || estLancement(e))) continue;
    const l = sousAgentsSession(cle, liste, o);
    if (l.length) res[cle] = l;
  }
  return res;
}

/** Ceux qui tournent encore (pour la scène : petits personnages autour de l'agent). */
export const sousAgentsEnCours = (l: readonly SousAgent[]): SousAgent[] => l.filter(a => a.etat === 'en-cours');

export const LIBELLES_ETAT_SOUS_AGENT: Record<EtatSousAgent, string> = {
  'en-cours': 'En cours', termine: 'Terminé', echec: 'Échec', expire: 'Sans nouvelles',
};

// ------------------------------------------------------------------ statistiques

export interface StatsSousAgents {
  total: number;
  /** Du plus ancien au plus récent : un point par jour de la période. */
  parJour: Array<{ jour: string; n: number }>;
  /** Sessions ayant lancé au moins un sous-agent, et le maximum pour une session. */
  sessions: number;
  maxParSession: number;
  /** Au plus haut, combien tournaient en même temps (dans une session). */
  maxParalleles: number;
  types: Array<{ nom: string; n: number }>;
  echecs: number;
  dureeMoyenneMs?: number;
}

export function statsSousAgents(entrees: readonly EntreeHistorique[], maintenant: number, jours: number): StatsSousAgents {
  const d = new Date(maintenant);
  d.setHours(0, 0, 0, 0);
  const depuis = d.getTime() - (jours - 1) * 86_400_000;
  const fin = d.getTime() + 86_400_000;
  const tous = Object.values(sousAgents(entrees, { maintenant })).map(l => l.filter(a => a.debut >= depuis && a.debut < fin)).filter(l => l.length);
  const parJour = new Map<string, number>();
  for (let x = depuis; x < fin; x += 86_400_000) parJour.set(jourLocal(new Date(x + 12 * 3_600_000).toISOString()), 0);
  const types = new Map<string, number>();
  let total = 0;
  let echecs = 0;
  let maxParalleles = 0;
  const durees: number[] = [];
  for (const l of tous) {
    total += l.length;
    for (const a of l) {
      const j = jourLocal(new Date(a.debut).toISOString());
      if (parJour.has(j)) parJour.set(j, (parJour.get(j) ?? 0) + 1);
      types.set(a.type ?? 'inconnu', (types.get(a.type ?? 'inconnu') ?? 0) + 1);
      if (a.etat === 'echec') echecs++;
      if (a.fin !== undefined && !a.debutInconnu) durees.push(a.fin - a.debut);
    }
    // Chevauchements : balayage des débuts et fins.
    const bornes = l.flatMap(a => [[a.debut, 1], [a.debut + Math.max(1, a.dureeMs), -1]] as Array<[number, number]>).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let n = 0;
    for (const [, s] of bornes) maxParalleles = Math.max(maxParalleles, (n += s));
  }
  return {
    total,
    parJour: [...parJour].map(([jour, n]) => ({ jour, n })),
    sessions: tous.length,
    maxParSession: Math.max(0, ...tous.map(l => l.length)),
    maxParalleles,
    types: [...types].map(([nom, n]) => ({ nom, n })).sort((x, y) => y.n - x.n || x.nom.localeCompare(y.nom)),
    echecs,
    ...(durees.length ? { dureeMoyenneMs: Math.round(durees.reduce((s, x) => s + x, 0) / durees.length) } : {}),
  };
}

// ------------------------------------------------------------------ démo

/**
 * Démo (fictive) : une session « refonte » qui, toutes les `CYCLE_DEMO_SOUS_AGENTS` s, lance trois
 * sous-agents EN PARALLÈLE (deux Explore en arrière-plan, un general-purpose au premier plan qui en lance
 * lui-même un « Plan » en arrière-plan, et finit en échec), avec leurs outils. À fusionner dans les entrées de démo
 * du bureau pour les voir dans la scène.
 */
export const CYCLE_DEMO_SOUS_AGENTS = 90;
export const SESSION_DEMO_SOUS_AGENTS = 'demo-refonte';

export function entreesDemoSousAgents(debut: number, maintenant: number): EntreeHistorique[] {
  const res: EntreeHistorique[] = [];
  const ecoule = (maintenant - debut) / 1000;
  const ev = (s: number, type: string, extra: Partial<EntreeHistorique> = {}) => {
    if (s > ecoule) return;
    res.push({
      v: 1, id: `demo-sa-${s.toFixed(1)}-${type}-${extra.agent ?? extra.agentLance ?? ''}-${extra.outil ?? ''}`, ts: new Date(debut + s * 1000).toISOString(), type,
      appareil: 'PC de démo', appareilId: 'demo00000000', session: SESSION_DEMO_SOUS_AGENTS, projet: 'refonte', dossier: '/demo/refonte', ...extra,
    });
  };
  ev(-30, 'debut-session');
  const cycle = Math.max(0, Math.floor(ecoule / CYCLE_DEMO_SOUS_AGENTS));
  for (let c = Math.max(0, cycle - 1); c <= cycle; c++) {
    const o = c * CYCLE_DEMO_SOUS_AGENTS + 2;
    const id = (n: string) => `demo-agent-${c}-${n}`;
    const outilDans = (s: number, agent: string, agentType: string, outil: string, resume: string, echec = false) =>
      ev(o + s, 'outil', { agent, agentType, outil, resume, duree: 600, ...(echec ? { echec: true } : {}) });
    ev(o, 'demande', { texte: 'Refonds la page d’accueil : cherche les composants, propose un plan, applique-le' });
    ev(o + 2, 'debut-sous-agent', { agent: id('a'), agentType: 'Explore' });
    ev(o + 2.2, 'outil', { outil: 'Agent', resume: 'Trouver les composants de l’accueil', sousAgentType: 'Explore', modele: 'haiku', arrierePlan: true, agentLance: id('a'), duree: 120 });
    ev(o + 2.5, 'debut-sous-agent', { agent: id('b'), agentType: 'Explore' });
    ev(o + 2.7, 'outil', { outil: 'Agent', resume: 'Lister les styles utilisés', sousAgentType: 'Explore', modele: 'haiku', arrierePlan: true, agentLance: id('b'), duree: 110 });
    ev(o + 3, 'debut-sous-agent', { agent: id('c'), agentType: 'general-purpose' });
    outilDans(6, id('a'), 'Explore', 'Glob', 'src/**/*.tsx');
    outilDans(8, id('b'), 'Explore', 'Grep', '« className »');
    outilDans(11, id('a'), 'Explore', 'Read', 'src/Accueil.tsx');
    outilDans(12, id('c'), 'general-purpose', 'Read', 'src/Accueil.tsx');
    ev(o + 14, 'debut-sous-agent', { agent: id('d'), agentType: 'Plan' });
    ev(o + 14.2, 'outil', { agent: id('c'), agentType: 'general-purpose', outil: 'Agent', resume: 'Proposer un plan de refonte', sousAgentType: 'Plan', arrierePlan: true, agentLance: id('d'), duree: 150 });
    outilDans(16, id('b'), 'Explore', 'Read', 'styles/accueil.css');
    outilDans(19, id('d'), 'Plan', 'Read', 'docs/architecture.md');
    ev(o + 22, 'fin-sous-agent', { agent: id('a'), agentType: 'Explore' });
    ev(o + 26, 'fin-sous-agent', { agent: id('d'), agentType: 'Plan' });
    ev(o + 30, 'fin-sous-agent', { agent: id('b'), agentType: 'Explore' });
    outilDans(33, id('c'), 'general-purpose', 'Edit', 'src/Accueil.tsx');
    outilDans(38, id('c'), 'general-purpose', 'Bash', 'npm test', true);
    ev(o + 44, 'fin-sous-agent', { agent: id('c'), agentType: 'general-purpose' });
    ev(o + 44.3, 'outil', { outil: 'Agent', resume: 'Appliquer le plan et lancer les tests', sousAgentType: 'general-purpose', modele: 'sonnet', arrierePlan: false, agentLance: id('c'), duree: 41_300, echec: true });
    ev(o + 50, 'fin-reponse');
  }
  return res;
}

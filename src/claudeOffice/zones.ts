/**
 * Claude Office : les ZONES THÉMATIQUES de l'open space et la correspondance
 * outil → zone (logique pure, testée dans zones.test.ts).
 *
 * Chaque agent va s'installer dans la zone de son activité du moment, déduite
 * des événements du hook : écrire du code à l'Atelier, lancer des commandes en
 * Salle des machines, lire et chercher à la Bibliothèque, consulter le web au
 * Café web, déléguer ou planifier en Salle de réunion, réfléchir au Coin
 * réflexion ; arrivée à l'Accueil, pause en Détente ; « attend ta réponse » au
 * Guichet ; tâche terminée en Salle d'attente. Pour ajouter un outil : une
 * ligne dans `CORRESPONDANCE_OUTILS` (les outils inconnus vont à l'Atelier).
 */

import type { EntreeHistorique } from './logiqueHistorique';

export type Zone = 'accueil' | 'atelier' | 'machines' | 'bibliotheque' | 'cafe' | 'reunion' | 'reflexion' | 'guichet' | 'salle' | 'detente';

export interface InfoZone {
  nom: string;
  /** Ce qu'on y fait, en une phrase simple (légende « ? »). */
  role: string;
  /** Couleur de la zone (sol, enseigne, pastilles). */
  teinte: string;
  icone: string;
}

export const ZONES: Record<Zone, InfoZone> = {
  atelier: { nom: 'Atelier code', role: 'écrit ou modifie des fichiers (Edit, Write…) ; outils inconnus aussi', teinte: '#7C6CF2', icone: '</>' },
  machines: { nom: 'Salle des machines', role: 'lance des commandes : tests, builds, terminal (Bash…)', teinte: '#2FBF71', icone: '>_' },
  bibliotheque: { nom: 'Bibliothèque', role: 'lit des fichiers et cherche dans le code (Read, Grep, Glob…)', teinte: '#3BA3D9', icone: '¶' },
  cafe: { nom: 'Café web', role: 'consulte le web (WebFetch, WebSearch, navigateur…)', teinte: '#2E8FE0', icone: '◍' },
  reunion: { nom: 'Salle de réunion', role: 'délègue à des sous-agents ou planifie (Task, TodoWrite…)', teinte: '#C05BD8', icone: '✦' },
  reflexion: { nom: 'Coin réflexion', role: 'réfléchit : demande reçue, aucun outil pour l’instant', teinte: '#8F96A8', icone: '…' },
  accueil: { nom: 'Accueil', role: 'vient d’ouvrir une session, pas encore de demande', teinte: '#C7A23A', icone: '⌂' },
  detente: { nom: 'Détente', role: 'inactif : a fini de répondre depuis un moment, café', teinte: '#B98552', icone: '☕' },
  guichet: { nom: 'Attend ta réponse', role: 'Claude te demande une autorisation ou pose une question : va voir Claude Code', teinte: '#E5484D', icone: '!' },
  salle: { nom: 'Salle d’attente', role: 'vient de terminer une tâche : touche-le pour voir ce qu’il a fini', teinte: '#2FA36B', icone: '✓' },
};

/** Ordre d'affichage (légende, vue Liste). */
export const ORDRE_ZONES: readonly Zone[] = ['guichet', 'salle', 'atelier', 'machines', 'bibliotheque', 'cafe', 'reunion', 'reflexion', 'accueil', 'detente'];

/** Zones où l'agent va tout de suite (sans attendre la fin du séjour minimal) : elles demandent ton attention. */
export const ZONES_PRIORITAIRES: ReadonlySet<Zone> = new Set(['guichet', 'salle']);

/**
 * Correspondance outil → zone : la première ligne qui reconnaît le nom gagne.
 * Outils MCP compris (`mcp__serveur__outil`). Rien ne correspond : l'Atelier.
 */
export const CORRESPONDANCE_OUTILS: ReadonlyArray<{ motif: RegExp; zone: Zone; exemples: string }> = [
  { motif: /^(write|write_file|edit|multiedit|replace|notebookedit|str_replace_editor|str_replace_based_edit_tool|apply_patch)$/i, zone: 'atelier', exemples: 'Edit, Write, MultiEdit, NotebookEdit' },
  { motif: /^(task|agent|todowrite|todoread|exitplanmode|enterplanmode)$|plan|subagent/i, zone: 'reunion', exemples: 'Task, Agent, TodoWrite, ExitPlanMode' },
  { motif: /web|fetch|browser|navigat|https?|url|playwright|puppeteer|chrome/i, zone: 'cafe', exemples: 'WebFetch, WebSearch, navigateur, MCP web' },
  { motif: /^(bash|bashoutput|killshell|killbash|run_shell_command|powershell)$|shell|terminal|command|exec|monitor/i, zone: 'machines', exemples: 'Bash, PowerShell, BashOutput' },
  { motif: /^(read|read_file|glob|grep|grep_search|search_file_content|list_directory|ls|lsp|notebookread|toolsearch)$|^mcp__.*(read|search|get|list|find|query|fetch)/i, zone: 'bibliotheque', exemples: 'Read, Grep, Glob, LS, MCP de lecture' },
];

export function zoneOutil(nom: string | undefined): Zone {
  const n = (nom ?? '').trim();
  if (!n) return 'atelier';
  return CORRESPONDANCE_OUTILS.find(c => c.motif.test(n))?.zone ?? 'atelier';
}

/** Les outils d'une même rafale (ce délai avant le dernier) votent pour la zone : pas d'aller-retour à chaque outil. */
export const FENETRE_RAFALE_MS = 20_000;
export const DEMI_VIE_VOTE_MS = 6_000;

/**
 * Zone voulue pour un agent, d'après les événements de SA session (triés) et
 * son état déduit. `enSalle` : il vient de terminer une tâche (salle d'attente).
 */
export function zoneVoulue(liste: readonly EntreeHistorique[], etat: string, enSalle: boolean): Zone {
  if (enSalle) return 'salle';
  if (etat === 'attend') return 'guichet';
  if (etat === 'termine') return 'salle';
  if (etat === 'inactif') return liste.some(e => e.type === 'demande' || e.type === 'outil') ? 'detente' : 'accueil';
  if (etat === 'reflechit') return 'reflexion';
  // Au travail : les outils de la dernière rafale votent, les plus récents comptent plus (demi-vie de 6 s).
  const outils = liste.filter(e => e.type === 'outil');
  if (!outils.length) return 'reflexion';
  const fin = Date.parse(outils[outils.length - 1].ts);
  const votes = new Map<Zone, { n: number; dernier: number }>();
  for (const e of outils) {
    const t = Date.parse(e.ts);
    if (fin - t > FENETRE_RAFALE_MS) continue;
    const z = zoneOutil(e.outil);
    const v = votes.get(z) ?? { n: 0, dernier: 0 };
    votes.set(z, { n: v.n + 0.5 ** ((fin - t) / DEMI_VIE_VOTE_MS), dernier: Math.max(v.dernier, t) });
  }
  return [...votes].sort((a, b) => b[1].n - a[1].n || b[1].dernier - a[1].dernier)[0][0];
}

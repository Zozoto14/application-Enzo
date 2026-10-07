/**
 * Claude Office, onglet « Bureau » : logique pure (sans React ni pont).
 *
 * Le bureau natif du hub ne reçoit aucun flux en direct : il DÉDUIT l'état de
 * chaque agent (une session de Claude Code = un personnage) à partir des
 * derniers événements du journal d'historique (hook de Claude Code, voir
 * docs/claude-office-historique.md). Sur le PC, le journal local est relu
 * toutes les 2 s ; ailleurs, on lit la copie chiffrée déposée sur le relais,
 * et l'état est calculé À LA DATE DU DÉPÔT (jamais présenté comme « en direct »).
 */

import { fusionner, type EntreeHistorique } from './logiqueHistorique';

export type EtatAgent = 'ecrit' | 'outil' | 'reflechit' | 'inactif' | 'termine';

/** Un outil vu il y a moins de ce délai : l'agent est encore « sur » cet outil. */
export const OUTIL_RECENT_MS = 60_000;
/** Sans aucun événement depuis ce délai, un agent est considéré inactif (pause, attente). */
export const INACTIF_MS = 10 * 60_000;
/** Une session terminée reste visible ce temps-là, puis quitte le bureau. */
export const TERMINE_VISIBLE_MS = 30 * 60_000;
/** Une session sans événement depuis ce délai (horloge réelle) a expiré : elle quitte le bureau. */
export const EXPIRATION_MS = 3 * 3_600_000;
/** Au plus ce nombre de personnages dessinés (les autres sont comptés). */
export const MAX_AGENTS_AFFICHES = 12;

const OUTILS_ECRITURE = /^(write|write_file|edit|multiedit|replace|notebookedit|str_replace_editor|apply_patch)$/i;

export const LIBELLES_ETAT: Record<EtatAgent, string> = {
  ecrit: 'Écrit du code',
  outil: 'Utilise un outil',
  reflechit: 'Réfléchit',
  inactif: 'Inactif',
  termine: 'Terminé',
};

const ORDRE_ETAT: Record<EtatAgent, number> = { ecrit: 0, outil: 1, reflechit: 2, inactif: 3, termine: 4 };

export interface Agent {
  /** Clé stable : appareil + session. */
  cle: string;
  session: string;
  projet?: string;
  appareil?: string;
  appareilId?: string;
  etat: EtatAgent;
  /** Horodatage (ms) du dernier événement de la session. */
  dernier: number;
  /** Début connu de la session (ms). */
  debut: number;
  /** Dernier outil vu (nom) et son résumé court, déjà masqués. */
  outil?: string;
  resumeOutil?: string;
  /** Dernière demande, résumée sur une ligne, secrets masqués. */
  demande?: string;
  demandes: number;
  outils: number;
  sousAgents: number;
  echecs: number;
  /**
   * Vrai quand l'état vient d'une copie du relais trop ancienne pour être
   * animée : le personnage est figé et l'étiquette dit « dernier état connu ».
   */
  fige: boolean;
  /** Date (ms) à laquelle l'état a été calculé : maintenant (PC) ou date du dépôt (relais). */
  reference: number;
}

export interface Bureau {
  agents: Agent[];
  /** Agents au-delà de `MAX_AGENTS_AFFICHES`, non dessinés. */
  enPlus: number;
  /** Sessions expirées (plus d'événement depuis `EXPIRATION_MS`), non dessinées. */
  expirees: number;
  /** Dernier événement connu, toutes sessions confondues (ms), ou rien. */
  derniereActivite?: number;
}

export interface CompteursBureau {
  actifs: number;
  inactifs: number;
  termines: number;
  demandesDuJour: number;
  outilsDuJour: number;
}

// ------------------------------------------------------------------ masquage

/**
 * Masquage d'appoint à l'affichage (le hook masque déjà avant l'écriture) :
 * les motifs les plus courants, au cas où une entrée ancienne ou importée y
 * aurait échappé. Il peut en laisser passer : l'écran le rappelle.
 */
const MOTIFS_SECRETS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[clé privée masquée]'],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, '[secret masqué]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[secret masqué]'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[secret masqué]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[secret masqué]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[secret masqué]'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '[secret masqué]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[secret masqué]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[secret masqué]'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [secret masqué]'],
  [/\b(mot_de_passe|motdepasse|password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)\S+/gi, '$1$2[secret masqué]'],
  [/(--password|--token|-p)\s+\S+/g, '$1 [secret masqué]'],
  [/(https?:\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1[secret masqué]@'],
  [/\bp1\.[a-z0-9]{6,16}\.[0-9a-f]{64}\b/g, '[secret masqué]'],
  [/\bAB1\.[A-Za-z0-9_-]{20,}/g, '[secret masqué]'],
];

export function masquerAffichage(texte: string): string {
  let t = texte;
  for (const [motif, remplacement] of MOTIFS_SECRETS) t = t.replace(motif, remplacement);
  return t;
}

/** Une ligne, coupée proprement, secrets masqués. */
export function resumerTexte(texte: string | undefined, max = 110): string | undefined {
  if (!texte) return undefined;
  const ligne = masquerAffichage(texte).replace(/\s+/g, ' ').trim();
  if (!ligne) return undefined;
  return ligne.length > max ? `${ligne.slice(0, max - 1).trimEnd()}…` : ligne;
}

// ------------------------------------------------------------------ déduction

/** Clé d'un appareil pour les références de date (identifiant, à défaut le nom). */
export const cleAppareil = (e: Pick<EntreeHistorique, 'appareilId' | 'appareil'>): string => e.appareilId ?? e.appareil ?? '?';

/**
 * État d'une session à la date `reference`, d'après son dernier événement
 * (le journal ne note que la FIN des outils, PostToolUse : un outil récent
 * veut dire que l'agent est en plein travail).
 */
export function etatDepuis(dernier: EntreeHistorique, reference: number): EtatAgent {
  const age = Math.max(0, reference - Date.parse(dernier.ts));
  if (dernier.type === 'fin-session') return 'termine';
  if (dernier.type === 'fin-reponse') return 'inactif';
  if (age > INACTIF_MS) return 'inactif';
  if (dernier.type === 'outil') {
    if (age <= OUTIL_RECENT_MS) return dernier.outil && OUTILS_ECRITURE.test(dernier.outil) ? 'ecrit' : 'outil';
    return 'reflechit';
  }
  if (dernier.type === 'debut-session') return 'inactif';
  // Demande envoyée, fin d'un sous-agent : Claude réfléchit à la suite.
  return 'reflechit';
}

export interface OptionsBureau {
  /** Horloge réelle (ms). */
  maintenant: number;
  /**
   * Pour les entrées venues du relais : date du dernier dépôt de chaque
   * appareil (clé `cleAppareil`). L'état d'une session de cet appareil est
   * calculé à cette date, pas à l'heure actuelle. Absente : maintenant (PC).
   */
  references?: Readonly<Record<string, number>>;
  /** Au-delà de cet âge (horloge réelle), un état venu du relais est figé. */
  figerApresMs?: number;
}

/** Les agents du bureau, triés : ceux qui travaillent d'abord, puis par activité récente. */
export function deduireBureau(entrees: readonly EntreeHistorique[], o: OptionsBureau): Bureau {
  const parSession = new Map<string, EntreeHistorique[]>();
  let derniereActivite: number | undefined;
  for (const e of fusionner(entrees)) {
    const t = Date.parse(e.ts);
    derniereActivite = derniereActivite === undefined ? t : Math.max(derniereActivite, t);
    const cle = `${cleAppareil(e)}|${e.session ?? 'sans-session'}`;
    let liste = parSession.get(cle);
    if (!liste) parSession.set(cle, (liste = []));
    liste.push(e);
  }
  const agents: Agent[] = [];
  let expirees = 0;
  for (const [cle, liste] of parSession) {
    const dernier = liste[liste.length - 1];
    const tDernier = Date.parse(dernier.ts);
    const refAppareil = o.references?.[cleAppareil(dernier)];
    const reference = refAppareil !== undefined ? Math.max(refAppareil, tDernier) : o.maintenant;
    if (o.maintenant - tDernier > EXPIRATION_MS) {
      expirees++;
      continue;
    }
    const etat = etatDepuis(dernier, reference);
    if (etat === 'termine' && o.maintenant - tDernier > TERMINE_VISIBLE_MS) continue;
    const demande = [...liste].reverse().find(e => e.type === 'demande' && e.texte);
    const outil = [...liste].reverse().find(e => e.type === 'outil');
    const avecProjet = [...liste].reverse().find(e => e.projet);
    const figerApres = o.figerApresMs ?? INACTIF_MS;
    agents.push({
      cle,
      session: dernier.session ?? 'sans-session',
      projet: avecProjet?.projet,
      appareil: dernier.appareil,
      appareilId: dernier.appareilId,
      etat,
      dernier: tDernier,
      debut: Date.parse(liste[0].ts),
      outil: outil?.outil ? resumerTexte(outil.outil, 40) : undefined,
      resumeOutil: resumerTexte(outil?.resume, 80),
      demande: resumerTexte(demande?.texte),
      demandes: liste.filter(e => e.type === 'demande').length,
      outils: liste.filter(e => e.type === 'outil').length,
      sousAgents: liste.filter(e => e.type === 'fin-sous-agent' || (e.type === 'outil' && /^(task|agent)$/i.test(e.outil ?? ''))).length,
      echecs: liste.filter(e => e.echec).length,
      fige: refAppareil !== undefined && o.maintenant - reference > figerApres,
      reference,
    });
  }
  agents.sort((a, b) => ORDRE_ETAT[a.etat] - ORDRE_ETAT[b.etat] || b.dernier - a.dernier || (a.cle < b.cle ? -1 : 1));
  return {
    agents: agents.slice(0, MAX_AGENTS_AFFICHES),
    enPlus: Math.max(0, agents.length - MAX_AGENTS_AFFICHES),
    expirees,
    ...(derniereActivite !== undefined ? { derniereActivite } : {}),
  };
}

export const estActif = (etat: EtatAgent): boolean => etat === 'ecrit' || etat === 'outil' || etat === 'reflechit';

export function compterBureau(bureau: Bureau, entrees: readonly EntreeHistorique[], maintenant: number): CompteursBureau {
  const debutJour = new Date(maintenant);
  debutJour.setHours(0, 0, 0, 0);
  const depuis = debutJour.getTime();
  let demandesDuJour = 0;
  let outilsDuJour = 0;
  for (const e of entrees) {
    if (Date.parse(e.ts) < depuis) continue;
    if (e.type === 'demande') demandesDuJour++;
    else if (e.type === 'outil') outilsDuJour++;
  }
  const tous = bureau.agents;
  return {
    actifs: tous.filter(a => estActif(a.etat)).length,
    inactifs: tous.filter(a => a.etat === 'inactif').length,
    termines: tous.filter(a => a.etat === 'termine').length,
    demandesDuJour,
    outilsDuJour,
  };
}

// ------------------------------------------------------------------ libellés

/** « à l’instant », « il y a 3 min », « il y a 2 h », « il y a 4 j ». */
export function ilYA(ms: number, maintenant: number): string {
  const s = Math.max(0, Math.round((maintenant - ms) / 1000));
  if (s < 45) return 'à l’instant';
  const min = Math.round(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Phrase d'état d'un agent, honnête sur la date (« dernier état connu » s'il est figé). */
export function phraseAgent(a: Agent, maintenant: number): string {
  const quoi =
    a.etat === 'ecrit' ? `Écrit${a.resumeOutil ? ` dans ${a.resumeOutil}` : ' du code'}`
    : a.etat === 'outil' ? `${a.outil ?? 'Outil'}${a.resumeOutil ? ` · ${a.resumeOutil}` : ''}`
    : a.etat === 'reflechit' ? 'Réfléchit'
    : a.etat === 'termine' ? 'Session terminée'
    : 'En attente';
  if (a.fige) return `Dernier état connu (${ilYA(a.reference, maintenant)}) : ${quoi.charAt(0).toLowerCase()}${quoi.slice(1)}`;
  return `${quoi} · ${ilYA(a.dernier, maintenant)}`;
}

export type SourceBureau =
  | { genre: 'local' }
  | { genre: 'relais'; date?: number }
  | { genre: 'aucune' };

/** Âge de la donnée affichée, pour l'en-tête du bureau. */
export function libelleFraicheur(source: SourceBureau, maintenant: number): string {
  if (source.genre === 'local') return 'En direct · journal de ce PC (relu toutes les 2 s)';
  if (source.genre === 'relais') {
    return source.date ? `Copie chiffrée · à jour ${ilYA(source.date, maintenant)}` : 'Copie chiffrée · aucun dépôt reçu';
  }
  return 'Aucune source d’activité';
}

/** Teinte stable d'un projet (parmi quelques couleurs lisibles en clair et en sombre). */
export const COULEURS_AGENTS = ['#5B8CFF', '#3FB37F', '#E0803A', '#B77DE8', '#D9566B', '#2FA7B8', '#C7A23A', '#7A8BA6'] as const;
export function couleurAgent(cle: string): string {
  let h = 0;
  for (let i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) >>> 0;
  return COULEURS_AGENTS[h % COULEURS_AGENTS.length];
}

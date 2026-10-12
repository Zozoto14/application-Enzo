/**
 * Claude Office v4 : PERSONNALISATION DES AGENTS (écran « Équipe ») et NOTES
 * par session. Logique pure + petit magasin en mémoire branché sur la base du
 * profil ouvert (clés `claude-office.equipe` et `claude-office.notes`), donc
 * PROPRE À L'APPAREIL : rien ne part sur le relais (aucune écriture KV).
 *
 * Point d'entrée pour la scène : `apparenceAgent(projet, session)` (surnom,
 * couleur, accessoire, favori ; la session l'emporte sur le projet) et
 * `apparencePersonnalisee(agent)`, remplaçant direct de `apparence(agent)` de
 * logiqueScene.ts (derrière le drapeau `PERSONNALISATION_DANS_LA_SCENE`).
 * `useMagasinSuivi()` fait se redessiner un composant quand l'équipe ou les
 * notes changent. En démo, le magasin passe sur des données fictives en
 * mémoire (rien n'est écrit).
 */

import { useEffect, useState } from 'react';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { COULEURS_AGENTS, couleurAgent, masquerAffichage, type Agent } from './logiqueBureau';
import { normaliser } from './logiqueHistorique';
import { ACCESSOIRES, apparence, type Apparence } from './logiqueScene';

export const CLE_EQUIPE = 'claude-office.equipe';
export const CLE_NOTES = 'claude-office.notes';

/** Intégration : la scène utilise la personnalisation (couleur du haut, accessoire) quand ce drapeau est vrai. */
export const PERSONNALISATION_DANS_LA_SCENE = true;

/** Accessoires proposés : ceux que la scène sait déjà dessiner, plus trois nouveaux (dessinés par `AvatarAgent`). */
export const CATALOGUE_ACCESSOIRES = [
  { id: 'aucun', nom: 'Aucun' },
  { id: 'lunettes', nom: 'Lunettes' },
  { id: 'casque', nom: 'Casque' },
  { id: 'bonnet', nom: 'Bonnet' },
  { id: 'noeud', nom: 'Nœud' },
  { id: 'echarpe', nom: 'Écharpe' },
  { id: 'couronne', nom: 'Couronne' },
  { id: 'casquette', nom: 'Casquette' },
  { id: 'fleur', nom: 'Fleur' },
] as const;
export type AccessoireAgent = (typeof CATALOGUE_ACCESSOIRES)[number]['id'];
const IDS_ACCESSOIRES: readonly string[] = CATALOGUE_ACCESSOIRES.map(a => a.id);
/** Couleurs proposées (celles des projets, plus quatre). */
export const COULEURS_EQUIPE: readonly string[] = [...COULEURS_AGENTS, '#1F9D55', '#E94F9B', '#8C6D46', '#4B5563'];
export const MAX_SURNOM = 24;
export const MAX_NOTE = 500;
export const MAX_NOTES = 500;
const MAX_PERSOS = 300;

export interface Perso {
  surnom?: string;
  couleur?: string;
  accessoire?: AccessoireAgent;
  favori?: boolean;
}

export interface Equipe {
  projets: Record<string, Perso>;
  sessions: Record<string, Perso>;
}

export interface NoteSession {
  texte: string;
  /** Dernière modification (ms). */
  maj: number;
  projet?: string;
}
export type Notes = Record<string, NoteSession>;

export interface ApparenceAgent {
  surnom?: string;
  /** Couleur du haut : choisie, sinon celle du projet. */
  couleur: string;
  accessoire?: AccessoireAgent;
  favori: boolean;
  /** Vrai si quelque chose a été choisi (projet ou session). */
  personnalise: boolean;
}

// ------------------------------------------------------------------ lecture prudente

const MOTIF_COULEUR = /^#[0-9A-Fa-f]{6}$/;
const nettoyerTexte = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
  return t || undefined;
};

export function lirePerso(v: unknown): Perso | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const p: Perso = {};
  const surnom = nettoyerTexte(o.surnom, MAX_SURNOM);
  if (surnom) p.surnom = surnom;
  if (typeof o.couleur === 'string' && MOTIF_COULEUR.test(o.couleur)) p.couleur = o.couleur.toUpperCase();
  if (typeof o.accessoire === 'string' && IDS_ACCESSOIRES.includes(o.accessoire)) p.accessoire = o.accessoire as AccessoireAgent;
  if (o.favori === true) p.favori = true;
  return Object.keys(p).length ? p : undefined;
}

function lireTable(v: unknown): Record<string, Perso> {
  const res: Record<string, Perso> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return res;
  for (const [cle, val] of Object.entries(v as Record<string, unknown>).slice(0, MAX_PERSOS)) {
    if (!cle || cle.length > 200) continue;
    const p = lirePerso(val);
    if (p) res[cle] = p;
  }
  return res;
}

export const EQUIPE_VIDE: Equipe = { projets: {}, sessions: {} };

export function lireEquipe(brut: string | null | undefined): Equipe {
  try {
    const o = JSON.parse(brut ?? '{}') as Record<string, unknown>;
    return { projets: lireTable(o.projets), sessions: lireTable(o.sessions) };
  } catch {
    return { projets: {}, sessions: {} };
  }
}

export function lireNotes(brut: string | null | undefined): Notes {
  const res: Notes = {};
  try {
    const o = JSON.parse(brut ?? '{}') as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return res;
    for (const [session, v] of Object.entries(o)) {
      const n = v as Partial<NoteSession> | null;
      const texte = nettoyerNote(n?.texte);
      if (!session || session.length > 200 || !texte || typeof n?.maj !== 'number') continue;
      res[session] = { texte, maj: n.maj, ...(nettoyerTexte(n.projet, 120) ? { projet: nettoyerTexte(n.projet, 120) } : {}) };
    }
  } catch {
    // Illisible : aucune note.
  }
  return bornerNotes(res);
}

/** Une note garde ses retours à la ligne (pas les autres caractères de contrôle). */
function nettoyerNote(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, MAX_NOTE);
  return t || undefined;
}

function bornerNotes(n: Notes): Notes {
  const cles = Object.keys(n);
  if (cles.length <= MAX_NOTES) return n;
  const gardees = cles.sort((a, b) => n[b].maj - n[a].maj).slice(0, MAX_NOTES);
  return Object.fromEntries(gardees.map(c => [c, n[c]]));
}

// ------------------------------------------------------------------ modifications (pures)

/** Fusionne un changement dans le perso d'un projet ou d'une session ; un perso vide est retiré. */
export function changerPerso(e: Equipe, genre: 'projets' | 'sessions', cle: string, changement: Partial<Perso> | null): Equipe {
  const table = { ...e[genre] };
  const p = changement === null ? undefined : lirePerso({ ...table[cle], ...changement });
  if (p) table[cle] = p;
  else delete table[cle];
  return { ...e, [genre]: table };
}

export function changerNote(n: Notes, session: string, texte: string, maintenant: number, projet?: string): Notes {
  const propre = nettoyerNote(texte);
  const res = { ...n };
  if (!propre) delete res[session];
  else res[session] = { texte: propre, maj: maintenant, ...(projet ? { projet: projet.slice(0, 120) } : {}) };
  return bornerNotes(res);
}

/** Notes dont le texte, le projet ou l'identifiant de session contient la recherche (sans accents ni casse), récentes d'abord. */
export function chercherNotes(n: Notes, recherche: string): Array<{ session: string } & NoteSession> {
  const q = normaliser(recherche.trim());
  return Object.entries(n)
    .filter(([s, v]) => !q || normaliser(`${v.texte} ${v.projet ?? ''} ${s}`).includes(q))
    .map(([session, v]) => ({ session, ...v }))
    .sort((a, b) => b.maj - a.maj);
}

/** Apparence choisie d'un agent : la session l'emporte sur le projet, champ par champ. */
export function apparenceDepuis(e: Equipe, projet: string | undefined, session: string | undefined): ApparenceAgent {
  const p = (projet && e.projets[projet]) || {};
  const s = (session && e.sessions[session]) || {};
  const surnom = s.surnom ?? p.surnom;
  const accessoire = s.accessoire ?? p.accessoire;
  const choisie = s.couleur ?? p.couleur;
  return {
    ...(surnom ? { surnom } : {}),
    couleur: choisie ?? couleurAgent(projet ?? session ?? '?'),
    ...(accessoire ? { accessoire } : {}),
    favori: Boolean(p.favori || s.favori),
    personnalise: Boolean(surnom || accessoire || choisie || p.favori || s.favori),
  };
}

/** Projets favoris d'abord (ordre alphabétique dans chaque groupe). */
export function trierProjets(projets: readonly string[], e: Equipe): string[] {
  return [...new Set(projets)].sort((a, b) => Number(Boolean(e.projets[b]?.favori)) - Number(Boolean(e.projets[a]?.favori)) || a.localeCompare(b, 'fr'));
}

/** Nom à afficher : « Surnom (projet) », ou le projet. Secrets masqués (un surnom reste du texte libre). */
export function nomAgent(projet: string | undefined, session: string | undefined, e: Equipe = magasin.equipe): string {
  const surnom = apparenceDepuis(e, projet, session).surnom;
  const p = projet ?? 'Projet inconnu';
  return masquerAffichage(surnom ? `${surnom} (${p})` : p);
}

// ------------------------------------------------------------------ magasin (mémoire + base du profil)

interface Magasin {
  base?: BasePrefs;
  demo: boolean;
  equipe: Equipe;
  notes: Notes;
  version: number;
}
const magasin: Magasin = { demo: false, equipe: { projets: {}, sessions: {} }, notes: {}, version: 0 };
const abonnes = new Set<() => void>();
const prevenir = () => {
  magasin.version++;
  for (const f of [...abonnes]) f();
};

/**
 * Branche le magasin sur la base du profil (l'écran Claude Office le fait à
 * l'ouverture) ou, en démo, sur des données fictives en mémoire.
 */
export function brancherMagasinSuivi(base: BasePrefs | undefined, demo?: { equipe: Equipe; notes: Notes }): void {
  if (demo) {
    if (magasin.demo) return;
    Object.assign(magasin, { base, demo: true, equipe: demo.equipe, notes: demo.notes });
  } else {
    if (!magasin.demo && magasin.base === base && magasin.version > 0) return;
    let equipe: Equipe = { projets: {}, sessions: {} };
    let notes: Notes = {};
    try {
      equipe = lireEquipe(base?.lire(CLE_EQUIPE));
      notes = lireNotes(base?.lire(CLE_NOTES));
    } catch {
      // Base indisponible : vide.
    }
    Object.assign(magasin, { base, demo: false, equipe, notes });
  }
  prevenir();
}

const ecrire = (cle: string, valeur: unknown) => {
  if (magasin.demo) return;
  try {
    magasin.base?.ecrire(cle, JSON.stringify(valeur));
  } catch {
    // Stockage indisponible : vaut pour cette fois.
  }
};

export function equipeCourante(): Equipe {
  return magasin.equipe;
}
export function notesCourantes(): Notes {
  return magasin.notes;
}
export function magasinEnDemo(): boolean {
  return magasin.demo;
}

export function modifierPerso(genre: 'projets' | 'sessions', cle: string, changement: Partial<Perso> | null): void {
  magasin.equipe = changerPerso(magasin.equipe, genre, cle, changement);
  ecrire(CLE_EQUIPE, magasin.equipe);
  prevenir();
}

export function modifierNote(session: string, texte: string, projet?: string, maintenant = Date.now()): void {
  magasin.notes = changerNote(magasin.notes, session, texte, maintenant, projet);
  ecrire(CLE_NOTES, magasin.notes);
  prevenir();
}

export function noteDe(session: string | undefined): NoteSession | undefined {
  return session ? magasin.notes[session] : undefined;
}

/** POUR LA SCÈNE : apparence choisie d'un agent (surnom, couleur, accessoire, favori). */
export function apparenceAgent(projet: string | undefined, session: string | undefined): ApparenceAgent {
  return apparenceDepuis(magasin.equipe, projet, session);
}

/** Apparence de la scène avec la personnalisation appliquée (accessoires connus de la scène seulement). */
export function fusionnerApparence(base: Apparence, perso: ApparenceAgent, avecCouleurProjet = true): Apparence {
  const accessoire = perso.accessoire && (ACCESSOIRES as readonly string[]).includes(perso.accessoire) ? (perso.accessoire as Apparence['accessoire']) : base.accessoire;
  return { ...base, haut: avecCouleurProjet ? perso.couleur : base.haut, accessoire };
}

/** Remplaçant direct de `apparence(agent)` (logiqueScene.ts) qui applique l'équipe si le drapeau est vrai. */
export function apparencePersonnalisee(a: Pick<Agent, 'cle' | 'session' | 'projet'>): Apparence {
  const base = apparence(a);
  return PERSONNALISATION_DANS_LA_SCENE ? fusionnerApparence(base, apparenceAgent(a.projet, a.session)) : base;
}

export function ecouterMagasinSuivi(f: () => void): () => void {
  abonnes.add(f);
  return () => void abonnes.delete(f);
}

/** Redessine le composant quand l'équipe ou les notes changent ; renvoie un numéro de version. */
export function useMagasinSuivi(): number {
  const [v, setV] = useState(magasin.version);
  useEffect(() => ecouterMagasinSuivi(() => setV(magasin.version)), []);
  return v;
}

/** Tests : remet le magasin à zéro. */
export function reinitialiserMagasinSuivi(): void {
  Object.assign(magasin, { base: undefined, demo: false, equipe: { projets: {}, sessions: {} }, notes: {} });
  prevenir();
}

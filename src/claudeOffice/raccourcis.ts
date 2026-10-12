/**
 * Claude Office v4 : RACCOURCIS CLAVIER (PC, iPad avec clavier) et petit bus
 * d'événements entre l'écran et la scène.
 *
 *   ?  aide des raccourcis        B / H / S  onglets Bureau / Historique / Statistiques
 *   /  recherche                  F          plein écran (délégué à la scène)
 *   Échap  fermer                 J / K      agent suivant / précédent
 *
 * Jamais actifs pendant la saisie (champ, zone de texte, liste, contenu
 * éditable) ni avec Ctrl, Cmd ou Alt (raccourcis du navigateur). Web seulement.
 *
 * INTÉGRATION avec la scène (fichiers de l'autre chantier) — un seul point chacun :
 *  - plein écran : `useEffect(() => ecouterOffice('plein-ecran', () => { basculer(); return true; }), [])`
 *    (sans écouteur : la touche F ne fait rien) ;
 *  - J/K et Échap sur le détail : `useNavigationAgents(cles, choisi, setChoisi)` dans `BureauVisuel`
 *    (déjà branché, Bureau.tsx).
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

export type ActionRaccourci =
  | 'aide' | 'onglet-bureau' | 'onglet-historique' | 'onglet-stats' | 'recherche' | 'plein-ecran' | 'fermer' | 'agent-suivant' | 'agent-precedent';

export const RACCOURCIS: ReadonlyArray<{ touches: readonly string[]; action: ActionRaccourci; description: string }> = [
  { touches: ['?'], action: 'aide', description: 'Afficher cette aide' },
  { touches: ['B'], action: 'onglet-bureau', description: 'Onglet Bureau' },
  { touches: ['H'], action: 'onglet-historique', description: 'Onglet Historique' },
  { touches: ['S'], action: 'onglet-stats', description: 'Onglet Statistiques' },
  { touches: ['/'], action: 'recherche', description: 'Rechercher (historique, notes)' },
  { touches: ['F'], action: 'plein-ecran', description: 'Plein écran du bureau (si disponible)' },
  { touches: ['Échap'], action: 'fermer', description: 'Fermer le panneau ouvert' },
  { touches: ['J'], action: 'agent-suivant', description: 'Agent suivant (ouvre son détail)' },
  { touches: ['K'], action: 'agent-precedent', description: 'Agent précédent' },
];

const PAR_TOUCHE: Readonly<Record<string, ActionRaccourci>> = {
  '?': 'aide', b: 'onglet-bureau', h: 'onglet-historique', s: 'onglet-stats', '/': 'recherche', f: 'plein-ecran', escape: 'fermer', j: 'agent-suivant', k: 'agent-precedent',
};

export interface ToucheClavier {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  isComposing?: boolean;
}

/** Vrai quand la cible est en saisie : champ, zone de texte, liste déroulante, contenu éditable, rôle « textbox ». */
export function estEnSaisie(cible: unknown): boolean {
  const el = cible as { tagName?: string; isContentEditable?: boolean; getAttribute?(n: string): string | null; type?: string } | null;
  if (!el || typeof el !== 'object') return false;
  const balise = el.tagName?.toLowerCase();
  if (balise === 'textarea' || balise === 'select') return true;
  if (balise === 'input') return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes((el.type ?? 'text').toLowerCase());
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

/** L'action d'une touche, ou rien (saisie en cours, modificateur, touche inconnue). */
export function actionClavier(e: ToucheClavier): ActionRaccourci | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return undefined;
  if (estEnSaisie(e.target)) return undefined;
  return PAR_TOUCHE[e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()];
}

// ------------------------------------------------------------------ bus d'événements

export type EvenementOffice = 'plein-ecran' | 'agent-suivant' | 'agent-precedent' | 'fermer' | 'recherche';
/** Un écouteur renvoie vrai s'il a traité l'événement. */
type Ecouteur = () => boolean | void;
const ecouteurs = new Map<EvenementOffice, Set<Ecouteur>>();

export function ecouterOffice(nom: EvenementOffice, f: Ecouteur): () => void {
  let s = ecouteurs.get(nom);
  if (!s) ecouteurs.set(nom, (s = new Set()));
  s.add(f);
  return () => void s!.delete(f);
}

/** Émet ; vrai si un écouteur l'a traité (les plus récents d'abord). */
export function emettreOffice(nom: EvenementOffice): boolean {
  for (const f of [...(ecouteurs.get(nom) ?? [])].reverse()) if (f() === true) return true;
  return false;
}

/** Agent suivant / précédent dans la liste affichée (boucle), et Échap qui ferme le détail ouvert. */
export function agentVoisin(cles: readonly string[], choisi: string | undefined, sens: 1 | -1): string | undefined {
  if (!cles.length) return undefined;
  const i = choisi ? cles.indexOf(choisi) : -1;
  if (i < 0) return sens === 1 ? cles[0] : cles[cles.length - 1];
  return cles[(i + sens + cles.length) % cles.length];
}

/** INTÉGRATION Bureau : J/K parcourent les agents (ouvre leur détail), Échap ferme le détail. */
export function useNavigationAgents(cles: readonly string[], choisi: string | undefined, choisir: (cle: string | undefined) => void): void {
  const etat = useRef({ cles, choisi, choisir });
  etat.current = { cles, choisi, choisir };
  useEffect(() => {
    const aller = (sens: 1 | -1) => () => {
      const { cles: c, choisi: ch, choisir: f } = etat.current;
      const v = agentVoisin(c, ch, sens);
      if (v === undefined) return false;
      f(v);
      return true;
    };
    const retirer = [
      ecouterOffice('agent-suivant', aller(1)),
      ecouterOffice('agent-precedent', aller(-1)),
      ecouterOffice('fermer', () => {
        if (etat.current.choisi === undefined) return false;
        etat.current.choisir(undefined);
        return true;
      }),
    ];
    return () => retirer.forEach(r => r());
  }, []);
}

// ------------------------------------------------------------------ écoute du clavier (web)

interface EvenementDom extends ToucheClavier {
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
interface DocumentDom {
  addEventListener(t: 'keydown', f: (e: EvenementDom) => void, capture?: boolean): void;
  removeEventListener(t: 'keydown', f: (e: EvenementDom) => void, capture?: boolean): void;
}

/**
 * Écoute le clavier (web) en phase de capture : une touche traitée par l'écran
 * (`gerer` renvoie vrai) n'est pas vue plus loin — Échap ferme alors le panneau
 * au lieu de quitter l'app.
 */
export function useRaccourcisOffice(gerer: (a: ActionRaccourci) => boolean, actif = true): void {
  const ref = useRef(gerer);
  ref.current = gerer;
  useEffect(() => {
    const doc = (globalThis as { document?: DocumentDom }).document;
    if (!actif || !doc || Platform.OS !== 'web') return undefined;
    const surTouche = (e: EvenementDom) => {
      if (e.defaultPrevented) return;
      const a = actionClavier(e);
      if (!a || !ref.current(a)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    doc.addEventListener('keydown', surTouche, true);
    return () => doc.removeEventListener('keydown', surTouche, true);
  }, [actif]);
}

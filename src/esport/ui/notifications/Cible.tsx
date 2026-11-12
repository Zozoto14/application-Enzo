/**
 * Liens directs des notifications, côté écrans (docs/esport/notifications.md « Liens directs ») : la cible ouverte
 * (déjà vérifiée par le serveur) est fournie par RacineEsport à tout l'arbre ; chaque écran concerné l'applique UNE
 * fois (`useCible` : l'espace CM ouvre le tableau, le tableau ouvre la carte, la page Tickets ouvre le ticket…) et
 * l'élément visé est mis en avant (`CibleSurlignee` : défilé jusqu'à lui, cadre accentué quelques secondes).
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { CibleNotification } from '../../notifications/cibles';

export interface CibleActive {
  cible: CibleNotification;
  /** Numéro de la navigation (chaque clic sur une notification en est une nouvelle). */
  n: number;
  /** Élément à mettre en avant (clé, voir destinationCible). */
  surligne?: string;
}

interface ValeurContexte {
  active?: CibleActive;
  faits: Set<string>;
}

const Contexte = createContext<ValeurContexte>({ faits: new Set() });

export function FournisseurCible({ active, children }: { active?: CibleActive; children: React.ReactNode }) {
  const faits = useRef(new Set<string>()).current;
  const valeur = useMemo(() => ({ active, faits }), [active, faits]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/**
 * Applique la cible ouverte UNE fois par navigation et par rôle (`role` : « cm-tableau », « ticket »…). `appliquer`
 * rend `false` tant qu'il ne peut pas encore (données pas chargées) : il est rappelé quand `deps` changent.
 */
export function useCible(role: string, appliquer: (c: CibleNotification) => boolean | void, deps: readonly unknown[] = []): void {
  const { active, faits } = useContext(Contexte);
  useEffect(() => {
    if (!active) return;
    const cle = `${active.n}:${role}`;
    if (faits.has(cle)) return;
    if (appliquer(active.cible) !== false) faits.add(cle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appliquer change à chaque rendu ; deps explicites.
  }, [active, faits, role, ...deps]);
}

/** Durée de la mise en avant (le cadre s'efface ensuite). */
export const DUREE_SURLIGNAGE_MS = 4000;

/** Défile (web) jusqu'à l'élément marqué, au centre de l'écran. */
function defilerVers(testID: string) {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as { document?: { querySelector?(s: string): { scrollIntoView?(o: unknown): void } | null } }).document;
  // Laisse le temps au volet ou à la liste de se poser.
  setTimeout(() => {
    try {
      doc?.querySelector?.(`[data-testid="${testID}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } catch {
      // Navigateur ancien : sans défilement, l'élément reste mis en avant.
    }
  }, 150);
}

/**
 * Élément d'une liste qui peut être la cible d'une notification (`cle` : « tk-msg:<id> », « cm-commentaire:<id> »…) :
 * mis en avant (cadre accentué) et amené à l'écran quand il l'est.
 */
export function CibleSurlignee({ theme, cle, children }: { theme: ThemeHub; cle: string; children: React.ReactNode }) {
  const { active } = useContext(Contexte);
  const vise = Boolean(active?.surligne && active.surligne === cle);
  const [visible, setVisible] = useState(false);
  const n = active?.n;
  useEffect(() => {
    if (!vise) return undefined;
    setVisible(true);
    defilerVers('esport-cible-surlignee');
    const minuterie = setTimeout(() => setVisible(false), DUREE_SURLIGNAGE_MS);
    return () => clearTimeout(minuterie);
  }, [vise, n]);
  if (!visible) return <>{children}</>;
  return (
    <View testID="esport-cible-surlignee" accessibilityLabel={cle} style={{ borderRadius: 8, borderWidth: 2, borderColor: theme.accent, backgroundColor: teinteTransparente(theme.accent, 0.1), padding: 2 }}>
      {children}
    </View>
  );
}

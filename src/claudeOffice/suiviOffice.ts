/**
 * Claude Office v4 : ce que l'écran (Racine.tsx) branche en UNE ligne pour les
 * fonctionnalités v4 — horloge, activité récente pour les alertes (lecture
 * légère : PC toutes les 5 s, relais toutes les 2 min, index seulement tant que
 * rien ne change), alertes et pastille, magasin de l'équipe et des notes
 * (réel ou démo), raccourcis clavier et leur aide.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContexteHub } from '../hub/types';
import { useActiviteBureau } from './activiteBureau';
import { useAlertesOffice, type AlertesOffice } from './alertesOffice';
import { entreesDemoSuivi, equipeDemo, notesDemo } from './demoSuivi';
import { brancherMagasinSuivi } from './equipe';
import { libellePastille } from './logiqueAlertes';
import { fusionner, type EntreeHistorique } from './logiqueHistorique';
import { entreesDemo } from './logiqueScene';
import { entreesDemoSousAgents } from './logiqueSousAgents';
import type { PontClaudeOffice } from './pont';
import { emettreOffice, useRaccourcisOffice, type ActionRaccourci } from './raccourcis';

export const INTERVALLE_ALERTES_PC_MS = 5_000;
export const INTERVALLE_ALERTES_RELAIS_MS = 2 * 60_000;
const SELECTEURS_RECHERCHE = ['bureau-recherche', 'historique-recherche', 'suivi-notes-recherche'].map(id => `[data-testid="${id}"]`).join(', ');

type Onglet = 'bureau' | 'historique' | 'stats' | 'suivi';

interface ElementFocalisable {
  focus?(): void;
}
function focaliserRecherche(): boolean {
  const doc = (globalThis as { document?: { querySelector?(s: string): ElementFocalisable | null } }).document;
  const el = doc?.querySelector?.(SELECTEURS_RECHERCHE);
  if (!el?.focus) return false;
  el.focus();
  return true;
}

export interface SuiviOffice {
  alertes: AlertesOffice;
  /** Pastille de l'onglet Suivi (alertes non lues), ou rien. */
  pastille?: string;
  maintenant: number;
  activite: { entrees: readonly EntreeHistorique[]; references: Record<string, number> };
  aide: boolean;
  ouvrirAide(): void;
  fermerAide(): void;
}

export function useSuiviOffice({ contexte, office, debutDemo, changerOnglet }: {
  contexte: ContexteHub; office?: PontClaudeOffice; debutDemo?: number; changerOnglet(o: Onglet): void;
}): SuiviOffice {
  const demo = debutDemo !== undefined;
  const base = contexte.baseProfil;
  const pont = office?.historique;
  // Seulement le canal d'activité léger (v3) : jamais le journal complet en boucle.
  const pontLeger = pont?.activite ? pont : undefined;
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), demo ? 5_000 : 15_000);
    return () => clearInterval(t);
  }, [demo]);
  const activite = useActiviteBureau({
    pont: pontLeger, service: pont && !pontLeger ? undefined : contexte.historiqueOffice, base, actif: !demo, intervallePc: INTERVALLE_ALERTES_PC_MS, intervalleRelais: INTERVALLE_ALERTES_RELAIS_MS,
  });
  const entrees = useMemo(
    () => (demo ? fusionner(entreesDemo(debutDemo!, maintenant), entreesDemoSuivi(debutDemo!), entreesDemoSousAgents(debutDemo!, maintenant)) : activite.entrees),
    [demo, debutDemo, maintenant, activite.entrees],
  );
  const alertes = useAlertesOffice({
    base, entrees, references: demo ? undefined : activite.references, maintenant, lu: demo || activite.lu, debutDemo, surPc: Boolean(pont),
  });

  // Équipe et notes : base du profil, ou données fictives pendant la démo.
  useEffect(() => {
    brancherMagasinSuivi(base, demo ? { equipe: equipeDemo(), notes: notesDemo(Date.now()) } : undefined);
  }, [base, demo]);

  const [aide, setAide] = useState(false);
  const aideRef = useRef(aide);
  aideRef.current = aide;
  const gerer = useCallback((a: ActionRaccourci): boolean => {
    switch (a) {
      case 'aide':
        setAide(v => !v);
        return true;
      case 'fermer':
        if (aideRef.current) {
          setAide(false);
          return true;
        }
        return emettreOffice('fermer');
      case 'onglet-bureau':
        changerOnglet('bureau');
        return true;
      case 'onglet-historique':
        changerOnglet('historique');
        return true;
      case 'onglet-stats':
        changerOnglet('stats');
        return true;
      case 'recherche':
        if (emettreOffice('recherche') || focaliserRecherche()) return true;
        changerOnglet('historique');
        setTimeout(focaliserRecherche, 120);
        return true;
      case 'plein-ecran':
        return emettreOffice('plein-ecran');
      case 'agent-suivant':
        return emettreOffice('agent-suivant');
      case 'agent-precedent':
        return emettreOffice('agent-precedent');
      default:
        return false;
    }
  }, [changerOnglet]);
  useRaccourcisOffice(gerer);

  return {
    alertes,
    ...(alertes.nonLues ? { pastille: libellePastille(alertes.nonLues) } : {}),
    maintenant,
    activite: demo ? { entrees, references: {} } : { entrees: activite.entrees, references: activite.references },
    aide,
    ouvrirAide: () => setAide(true),
    fermerAide: () => setAide(false),
  };
}

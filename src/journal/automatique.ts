/**
 * Écriture automatique du journal, tant que l'app est ouverte et déverrouillée :
 * un contrôle peu après l'ouverture (rattrapage des soirs manqués, une fois la
 * synchro passée) puis toutes les minutes (échéance du soir). Seule la base
 * locale du profil est touchée : aucune écriture sur le relais.
 */

import { useEffect, useRef } from 'react';
import { appsVisibles } from '../hub/permissions';
import type { ContexteHub } from '../hub/types';
import { annoncerEcritures } from './evenements';
import { executerEcheances } from './moteur';
import { lireReglages } from './modele';
import { APP_JOURNAL } from './registre';
import { SOURCES_JOURNAL } from './sources';

export const DELAI_PREMIER_CONTROLE_MS = 8_000;
export const INTERVALLE_CONTROLE_MS = 60_000;

/** Un contrôle : écrit les pages dues. Renvoie les jours écrits. */
export async function controlerJournal(contexte: ContexteHub): Promise<string[]> {
  const base = contexte.baseProfil;
  if (!base || appsVisibles([APP_JOURNAL], contexte).length === 0) return [];
  const jours = await executerEcheances({ base, sources: SOURCES_JOURNAL, contexte, maintenant: contexte.maintenant ?? Date.now(), redacteur: lireReglages(base)?.ia ? contexte.redacteurJournal : undefined });
  if (jours.length) annoncerEcritures(jours);
  return jours;
}

export function useJournalAutomatique(contexte: ContexteHub, actif: boolean): void {
  const dernier = useRef(contexte);
  dernier.current = contexte;
  const enCours = useRef(false);
  useEffect(() => {
    if (!actif) return undefined;
    const controler = () => {
      if (enCours.current) return;
      enCours.current = true;
      controlerJournal(dernier.current)
        .catch(() => undefined)
        .finally(() => {
          enCours.current = false;
        });
    };
    const premier = setTimeout(controler, DELAI_PREMIER_CONTROLE_MS);
    const minuterie = setInterval(controler, INTERVALLE_CONTROLE_MS);
    return () => {
      clearTimeout(premier);
      clearInterval(minuterie);
    };
  }, [actif]);
}

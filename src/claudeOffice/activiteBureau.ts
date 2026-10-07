/**
 * D'où vient l'activité du bureau natif de Claude Office (onglet « Bureau »
 * et petit résumé de la tuile du hub) :
 *
 *  - sur le PC (pont Electron) : le journal LOCAL, relu toutes les
 *    `INTERVALLE_PC_MS` par le canal `claude-office:historique-activite` (rien
 *    n'est relu si le journal n'a pas grandi) ; plus, si la copie chiffrée est
 *    active, les dépôts des AUTRES PC équipés ;
 *  - ailleurs (site, téléphone, PC sans l'application à jour) : les dépôts
 *    chiffrés du relais (présence et historique), relus toutes les
 *    `INTERVALLE_RELAIS_MS` — seulement l'index, puis les dépôts dont la date
 *    a changé. L'âge du dernier dépôt est toujours montré : ce n'est pas du direct.
 *
 * Aucun autre accès réseau : sans service (compte principal relié), rien ne part.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntreeHistorique } from './logiqueHistorique';
import { cleAppareil, type SourceBureau } from './logiqueBureau';
import type { PontHistorique } from './pont';
import { lireEtatSynchro, type CacheActivite, type DepotActivite, type ServiceHistoriqueRelais } from './synchroHistorique';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';

export const INTERVALLE_PC_MS = 2_000;
/** Ancien PC (sans le canal d'activité) : le journal complet, moins souvent. */
export const INTERVALLE_PC_ANCIEN_MS = 5_000;
export const INTERVALLE_RELAIS_MS = 60_000;
/** Sur le PC, les dépôts des autres appareils : moins souvent. */
export const INTERVALLE_AUTRES_PC_MS = 2 * 60_000;

export interface ActiviteBureau {
  entrees: EntreeHistorique[];
  /** Date (ms) du dernier dépôt de chaque appareil lu sur le relais (clé `cleAppareil`). */
  references: Record<string, number>;
  source: SourceBureau;
  depots: DepotActivite[];
  erreur?: string;
  /** Vrai dès la première lecture terminée (pour ne pas montrer l'état vide trop tôt). */
  lu: boolean;
  /** Identifiant de ce PC (journal local), s'il est connu. */
  appareilId?: string;
  relire(): void;
}

export interface OptionsActivite {
  pont?: PontHistorique;
  service?: ServiceHistoriqueRelais;
  base?: BasePrefs;
  /** Faux : aucune lecture (écran caché). */
  actif?: boolean;
  /** Lire aussi les copies d'historique (gros objets) ; faux pour la tuile (présences seulement). */
  historique?: boolean;
  intervallePc?: number;
  intervalleRelais?: number;
}

/** Références de date (dernier dépôt par appareil) et entrées des dépôts, sauf ceux d'un appareil exclu. */
export function depuisDepots(depots: readonly DepotActivite[], exclure?: string) {
  const references: Record<string, number> = {};
  const entrees: EntreeHistorique[] = [];
  let date: number | undefined;
  for (const d of depots) {
    if (exclure && d.appareilId === exclure) continue;
    const t = Date.parse(d.date);
    if (Number.isNaN(t)) continue;
    date = date === undefined ? t : Math.max(date, t);
    for (const e of d.entrees) {
      const cle = cleAppareil(e);
      references[cle] = Math.max(references[cle] ?? 0, t);
    }
    references[d.appareilId] = Math.max(references[d.appareilId] ?? 0, t);
    entrees.push(...d.entrees);
  }
  return { references, entrees, date };
}

export function useActiviteBureau(o: OptionsActivite): ActiviteBureau {
  const { pont, service, base, actif = true, historique = true } = o;
  const [local, setLocal] = useState<{ entrees: EntreeHistorique[]; appareilId?: string }>();
  const [distant, setDistant] = useState<DepotActivite[]>();
  const [erreur, setErreur] = useState<string>();
  const [lu, setLu] = useState(false);
  const signature = useRef('');
  const cache = useRef<CacheActivite>(new Map());
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => void (monte.current = false);
  }, []);

  const lireLocal = useCallback(async () => {
    if (!pont) return;
    try {
      if (pont.activite) {
        const r = await pont.activite(signature.current);
        if (!monte.current) return;
        if (!r.ok) throw new Error(r.erreur ?? 'journal illisible');
        if (r.signature) signature.current = r.signature;
        if (!r.inchange && r.entrees) setLocal({ entrees: r.entrees, appareilId: r.appareilId });
      } else {
        const r = await pont.lire();
        if (!monte.current) return;
        if (!r.ok) throw new Error(r.erreur ?? 'journal illisible');
        setLocal({ entrees: (r.entrees ?? []).slice(-2_000), appareilId: r.reglages?.appareilId });
      }
      setErreur(undefined);
    } catch (e) {
      if (monte.current) setErreur(`Journal : ${(e as Error).message}`);
    } finally {
      if (monte.current) setLu(true);
    }
  }, [pont]);

  const lireDistant = useCallback(async () => {
    if (!service?.lireActivite) return;
    // Sur le PC, les autres appareils seulement si la copie est active (sinon ce PC ne participe pas).
    if (pont && !lireEtatSynchro(base).active) return;
    try {
      const r = await service.lireActivite({ historique, cache: cache.current });
      if (!monte.current) return;
      cache.current = r.cache;
      setDistant(r.depots);
      setErreur(r.erreurs.length ? `Relais : ${r.erreurs.join(' ; ')}` : undefined);
    } catch (e) {
      if (monte.current) setErreur(`Relais : ${(e as Error).message}`);
    } finally {
      if (monte.current) setLu(true);
    }
  }, [service, pont, base, historique]);

  useEffect(() => {
    if (!actif || !pont) return undefined;
    void lireLocal();
    const t = setInterval(() => void lireLocal(), o.intervallePc ?? (pont.activite ? INTERVALLE_PC_MS : INTERVALLE_PC_ANCIEN_MS));
    return () => clearInterval(t);
  }, [actif, pont, lireLocal, o.intervallePc]);

  useEffect(() => {
    if (!actif || !service?.lireActivite) {
      if (!pont) setLu(true);
      return undefined;
    }
    void lireDistant();
    const t = setInterval(() => void lireDistant(), o.intervalleRelais ?? (pont ? INTERVALLE_AUTRES_PC_MS : INTERVALLE_RELAIS_MS));
    return () => clearInterval(t);
  }, [actif, service, pont, lireDistant, o.intervalleRelais]);

  const relire = useCallback(() => {
    void lireLocal();
    void lireDistant();
  }, [lireLocal, lireDistant]);

  const donnees = useMemo(() => {
    const autres = depuisDepots(distant ?? [], local?.appareilId);
    if (pont) {
      // Sur le PC : le journal local fait foi pour ce PC (en direct), les dépôts pour les autres.
      const references = { ...autres.references };
      if (local?.appareilId) delete references[local.appareilId];
      return { entrees: [...(local?.entrees ?? []), ...autres.entrees], references, source: { genre: 'local' } as SourceBureau };
    }
    const source: SourceBureau = service ? { genre: 'relais', ...(autres.date !== undefined ? { date: autres.date } : {}) } : { genre: 'aucune' };
    return { entrees: autres.entrees, references: autres.references, source };
  }, [distant, local, pont, service]);

  return {
    ...donnees,
    depots: distant ?? [],
    ...(erreur ? { erreur } : {}),
    lu,
    ...(pont && local?.appareilId ? { appareilId: local.appareilId } : {}),
    relire,
  };
}

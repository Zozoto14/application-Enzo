/**
 * IA et GitHub dans l'app (Fondateur) : réglages de l'appareil (`taches.secrets`,
 * base chiffrée), état des PR (`taches.github`, base de l'appareil), relu au
 * plus toutes les 5 min tant que l'app est ouverte, et « Faite quand la PR
 * est fusionnée » appliqué (une écriture, une fois).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BasePrefs } from '../../tsuzuku/plateforme/stockage';
import { appliquerFusions, clientGithub, clientGithubSimule, lireCache, rafraichir, type CacheGithub } from '../github';
import { lireSecrets, type Secrets } from '../ia';
import { CLES_TACHES } from '../partage';
import type { AidesV3, CibleIA } from './actions';
import type { EtatApp } from './etat';

export const INTERVALLE_GITHUB_MS = 5 * 60_000;

export function useAidesV3(base: BasePrefs, etat: EtatApp, ouvrirIA: (c: CibleIA) => void, onAvis: (t: string) => void): AidesV3 | undefined {
  // Le Fondateur seulement (pas un membre dans ses projets personnels).
  const fondateur = etat.role === 'fondateur' && !etat.perso;
  const [secrets, setSecrets] = useState<Secrets>(() => lireSecrets(fondateur ? base.lire(CLES_TACHES.secrets) : undefined));
  const [github, setGithub] = useState<CacheGithub>(() => lireCache(base.lire(CLES_TACHES.github)));
  const courant = useRef({ etat, secrets, github, onAvis });
  courant.current = { etat, secrets, github, onAvis };
  const changerSecrets = useCallback(
    (s: Secrets) => {
      base.ecrire(CLES_TACHES.secrets, JSON.stringify(s));
      setSecrets(s);
    },
    [base],
  );
  const rafraichirGithub = useCallback(
    async (force?: boolean) => {
      const { etat: e, secrets: s, github: g } = courant.current;
      if (e.role !== 'fondateur' || !s.github.actif) return;
      const essai = s.github.mode === 'essai';
      if (!essai && !s.github.jeton) throw new Error('Ajoutez un jeton GitHub en lecture (👥 › IA et GitHub).');
      const r = await rafraichir(e.donnees, g, essai ? clientGithubSimule : clientGithub, s.github.jeton ?? '', e.maintenant(), force ? 0 : INTERVALLE_GITHUB_MS);
      base.ecrire(CLES_TACHES.github, JSON.stringify(r.cache));
      setGithub(r.cache);
      let terminees: string[] = [];
      e.maj((x, ctx) => {
        const f = appliquerFusions(x, r.cache, ctx, e.aujourdhui);
        terminees = f.terminees;
        return f.donnees;
      });
      if (terminees.length) courant.current.onAvis(`${terminees.length} tâche${terminees.length > 1 ? 's' : ''} terminée${terminees.length > 1 ? 's' : ''} : PR fusionnée.`);
      if (r.erreurs.length) throw new Error(r.erreurs[0]);
    },
    [base],
  );
  // Tant que l'app est ouverte : à l'ouverture, puis toutes les 5 minutes.
  useEffect(() => {
    if (!fondateur || !secrets.github.actif) return undefined;
    const tour = () => void rafraichirGithub().catch(() => undefined);
    tour();
    const t = setInterval(tour, INTERVALLE_GITHUB_MS);
    return () => clearInterval(t);
  }, [fondateur, secrets.github.actif, secrets.github.mode, secrets.github.jeton, rafraichirGithub]);
  return useMemo(() => (fondateur ? { secrets, changerSecrets, github, rafraichirGithub, ouvrirIA } : undefined), [fondateur, secrets, changerSecrets, github, rafraichirGithub, ouvrirIA]);
}

/**
 * Lien Tâches ↔ Claude Office, côté hub : tant qu'une tâche ouverte du
 * Fondateur est liée à une session de Claude Code (et que le lien est
 * activé), l'activité de Claude Office est lue (journal du PC toutes les
 * 30 s, présences du relais toutes les 3 min ailleurs — jamais les grosses
 * copies d'historique) ; quand l'agent lié a fini, la tâche passe « En
 * revue » et la notification « office » part selon les réglages.
 *
 * Lecture seule de Claude Office (aucun de ses fichiers n'est écrit).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useActiviteBureau } from '../../claudeOffice/activiteBureau';
import { deduireBureau } from '../../claudeOffice/logiqueBureau';
import { pontClaudeOffice } from '../../claudeOffice/pont';
import { sousAgentsDepuisHistorique } from '../../claudeOffice/sousAgentsScene';
import type { ContexteHub } from '../../hub/types';
import { roleTaches } from '../acces';
import { ecrireDonnees, lireDonnees } from '../modele';
import { CLES_TACHES } from '../partage';
import { verifierRappels } from '../resume';
import { lienActif } from './commun';
import { appliquerFinsOffice, tachesLieesOuvertes, type FinOffice } from './office';

/** Fins vues dans l'activité : agents qui ont fini (réponse ou session), sous-agents terminés. */
export function finsDepuisActivite(entrees: Parameters<typeof deduireBureau>[0], references: Record<string, number>, maintenant: number): FinOffice[] {
  const bureau = deduireBureau(entrees, { maintenant, references });
  const fins: FinOffice[] = [];
  const sessions = new Map<string, string>();
  for (const a of bureau.agents) {
    sessions.set(a.cle, a.session);
    if (a.fin !== undefined && (a.etat === 'termine' || a.etat === 'inactif')) fins.push({ session: a.session, fin: a.fin });
  }
  for (const s of sousAgentsDepuisHistorique(entrees, maintenant, references)) {
    const session = sessions.get(s.parent);
    if (session && s.fin !== undefined && s.etat !== 'en-cours') fins.push({ session, sousAgent: s.id, fin: s.fin });
  }
  return fins;
}

let cache: { brut: string; attente: number } = { brut: '\u0000', attente: 0 };

export function useLiensOffice(contexte: ContexteHub, actif: boolean): void {
  const base = contexte.baseProfil;
  const fondateur = roleTaches(contexte) === 'fondateur';
  // Lu seulement s'il y a des tâches qui attendent un agent (relu à chaque rendu du hub : léger).
  let attente = 0;
  if (actif && fondateur && base) {
    try {
      const brut = base.lire(CLES_TACHES.donnees) ?? '';
      // Relu à chaque rendu du hub, analysé seulement quand les données ont changé.
      if (brut !== cache.brut) {
        const d = lireDonnees(brut || undefined);
        cache = { brut, attente: lienActif(d, 'office') ? tachesLieesOuvertes(d) : 0 };
      }
      attente = cache.attente;
    } catch {
      attente = 0;
    }
  }
  const lire = attente > 0;
  const pont = lire ? pontClaudeOffice()?.historique : undefined;
  const activite = useActiviteBureau({ pont, service: lire ? contexte.historiqueOffice : undefined, base, actif: lire, historique: false, intervallePc: 30_000, intervalleRelais: 3 * 60_000 });
  const courant = useRef(contexte);
  courant.current = contexte;
  const signature = useMemo(() => `${activite.entrees.length}|${activite.entrees.at(-1)?.ts ?? ''}|${JSON.stringify(activite.references)}`, [activite.entrees, activite.references]);
  useEffect(() => {
    if (!lire || !activite.lu || !base) return;
    const maintenant = Date.now();
    const fins = finsDepuisActivite(activite.entrees, activite.references, maintenant);
    if (!fins.length) return;
    try {
      const d = lireDonnees(base.lire(CLES_TACHES.donnees) ?? undefined);
      const r = appliquerFinsOffice(d, fins, { maintenant, auteur: 'fondateur' });
      if (!r.evenements.length) return;
      base.ecrire(CLES_TACHES.donnees, ecrireDonnees(r.donnees));
      verifierRappels(courant.current, maintenant, r.evenements);
    } catch {
      // Réessayé à la prochaine lecture.
    }
    // La signature résume les entrées : pas de nouvelle passe sans nouvelle activité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lire, activite.lu, signature, base]);
}

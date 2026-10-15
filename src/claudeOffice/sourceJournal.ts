/**
 * Source du Journal automatique pour Claude Office (contrat
 * `hub/journal/contrat.ts`) : les sessions de Claude Code terminées ce
 * jour-là, et ce qu'elles ont fait (dernière demande, projet, durée active).
 *
 * Lecture seule : le journal local du PC (pont de l'application de bureau) et,
 * si la synchro de l'historique est active (ou hors du PC), les copies chiffrées
 * des autres appareils déjà présentes sur le relais — lues, jamais écrites.
 * Réservée au Fondateur, comme l'app. Les secrets sont masqués avant tout
 * enregistrement dans le journal.
 */

import { rangDe } from '../hub/admin/roles';
import type { EvenementJournal, SourceJournal } from '../hub/journal/contrat';
import type { ContexteHub } from '../hub/types';
import { cleAppareil, resumerTexte } from './logiqueBureau';
import { fusionner, jourLocal, type EntreeHistorique } from './logiqueHistorique';
import { PAUSE_MAX_ACTIF_MS } from './logiqueStats';
import { pontClaudeOffice } from './pont';
import { lireEtatSynchro } from './synchroHistorique';

export const ID_SOURCE_OFFICE = 'claude-office';

/** Une session sans « fin de session » est tenue pour terminée après ce silence (terminal fermé brutalement). */
export const SILENCE_FIN_SESSION_MS = 60 * 60_000;

const deux = (n: number) => String(n).padStart(2, '0');

/** Événements d'un jour à partir d'entrées d'historique (pur). */
export function evenementsOffice(jour: string, entrees: readonly EntreeHistorique[], maintenant: number): EvenementJournal[] {
  const duJour = fusionner(entrees).filter(e => jourLocal(e.ts) === jour);
  const parSession = new Map<string, EntreeHistorique[]>();
  for (const e of duJour) {
    const cle = `${cleAppareil(e)}|${e.session ?? 'sans-session'}`;
    parSession.set(cle, [...(parSession.get(cle) ?? []), e]);
  }
  const sortie: EvenementJournal[] = [];
  for (const [cle, l] of parSession) {
    const demandes = l.filter(e => e.type === 'demande');
    const fin = l.find(e => e.type === 'fin-session');
    const dernier = Date.parse(l[l.length - 1].ts);
    // Terminée : fin déclarée, ou silence assez long après des demandes.
    if (!fin && !(demandes.length > 0 && maintenant - dernier >= SILENCE_FIN_SESSION_MS)) continue;
    const ts = l.map(e => Date.parse(e.ts));
    let actifMs = 0;
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 0 && ts[i] - ts[i - 1] <= PAUSE_MAX_ACTIF_MS) actifMs += ts[i] - ts[i - 1];
    const minutes = Math.max(1, Math.round(actifMs / 60_000));
    const projet = [...l].reverse().find(e => e.projet)?.projet;
    const derniere = [...demandes].reverse().find(e => e.texte)?.texte;
    const d = new Date(fin ? Date.parse(fin.ts) : dernier);
    sortie.push({
      id: cle,
      source: ID_SOURCE_OFFICE,
      famille: 'office',
      genre: 'session-office',
      jour,
      heure: `${deux(d.getHours())}:${deux(d.getMinutes())}`,
      titre: resumerTexte(derniere, 110) ?? 'Session',
      ...(projet ? { groupe: resumerTexte(projet, 60) } : {}),
      nombre: minutes,
      detail: `${demandes.length} demande${demandes.length > 1 ? 's' : ''}`,
    });
  }
  return sortie;
}

export async function entreesOfficeLocales(contexte: Pick<ContexteHub, 'baseProfil' | 'historiqueOffice'>): Promise<EntreeHistorique[]> {
  const pont = pontClaudeOffice()?.historique;
  const lots: EntreeHistorique[][] = [];
  if (pont) {
    try {
      const lu = await pont.lire();
      if (lu.ok && lu.entrees) lots.push(lu.entrees);
    } catch {
      // Le journal du PC est illisible : on tente les copies du relais.
    }
  }
  if (contexte.historiqueOffice && (!pont || lireEtatSynchro(contexte.baseProfil).active)) {
    try {
      lots.push((await contexte.historiqueOffice.lireTout()).entrees);
    } catch {
      // Relais injoignable : la page se fait avec ce qu'on a.
    }
  }
  return fusionner(...lots);
}

export const SOURCE_OFFICE: SourceJournal = {
  id: ID_SOURCE_OFFICE,
  nom: 'Claude Office',
  famille: 'office',
  async lire(jour, contexte) {
    if (rangDe(contexte.profil) !== 'fondateur') return [];
    return evenementsOffice(jour, await entreesOfficeLocales(contexte), contexte.maintenant ?? Date.now());
  },
};

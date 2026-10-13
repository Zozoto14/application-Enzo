/**
 * Lien Tâches ↔ Claude Office (Fondateur seul).
 *
 *  - Depuis le Détail d'un agent (ou d'un de ses sous-agents) dans Claude
 *    Office : « ＋ Tâche » crée une tâche liée à la session (projet choisi, ou
 *    le projet « Claude Office »).
 *  - Quand l'agent (ou le sous-agent) lié FINIT — une fin postérieure au lien —
 *    la tâche ouverte passe « En revue » (une fois par fin), et une
 *    notification « office » peut partir.
 *  - Sur la tâche : la liste des sessions liées, qui ouvrent l'Historique de
 *    Claude Office filtré sur la session (demande déposée dans la base de
 *    l'appareil, lue par Claude Office à son ouverture).
 *
 * Les sessions liées ne partent jamais chez l'ami (`projectionPourAmi`).
 */

import type { BasePrefs } from '../../tsuzuku/plateforme/stockage';
import {
  ErreurTaches,
  estTerminee,
  listesDe,
  creerTache,
  modifierTache,
  statutsDe,
  tachesVivantes,
  vivant,
  type Contexte,
  type DonneesTaches,
  type LienOffice,
  type Statut,
  type Tache,
} from '../modele';
import type { EvenementNotif } from '../notifications';
import { idProjetAuto, projetAuto } from './commun';

/** Valeur « projet Claude Office » du choix de projet. */
export const idProjetAutoOffice = idProjetAuto('office');

/** Ce que Claude Office donne pour créer ou lier une tâche. */
export interface CibleOffice {
  session: string;
  cle?: string;
  projet?: string;
  /** Demande en cours (agent) ou description (sous-agent) : proposée comme titre. */
  libelle?: string;
  sousAgent?: string;
}

export function titrePropose(c: CibleOffice): string {
  const base = (c.libelle ?? '').replace(/\s+/g, ' ').trim();
  if (base) return base.slice(0, 120);
  return c.sousAgent ? 'Relire le travail du sous-agent' : `Relire la session ${c.projet ? `« ${c.projet} »` : c.session.slice(0, 8)}`;
}

function lien(c: CibleOffice, maintenant: number): LienOffice {
  return {
    session: c.session.slice(0, 80),
    ...(c.cle ? { cle: c.cle.slice(0, 160) } : {}),
    ...(c.sousAgent ? { sousAgent: c.sousAgent.slice(0, 80) } : {}),
    ...(c.projet ? { projet: c.projet.slice(0, 80) } : {}),
    ...(c.libelle ? { libelle: c.libelle.replace(/\s+/g, ' ').trim().slice(0, 160) } : {}),
    depuis: new Date(maintenant).toISOString(),
  };
}

/** Crée une tâche liée à une session (ou un sous-agent) de Claude Code. */
export function creerTacheOffice(d: DonneesTaches, c: CibleOffice, titre: string, projetId: string | undefined, ctx: Contexte): { donnees: DonneesTaches; tache: Tache } {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches('Réservé au Fondateur.');
  let x = d;
  let listeId: string | undefined;
  if (projetId && vivant(x.projets[projetId])) listeId = listesDe(x, projetId)[0]?.id;
  if (!listeId) {
    const p = projetAuto(x, 'office', ctx);
    x = p.donnees;
    listeId = p.listeId;
  }
  return creerTache(x, { titre: titre.trim() || titrePropose(c), listeId, etiquettes: ['claude'], liensOffice: [lien(c, ctx.maintenant)], description: c.projet ? `Session Claude Code « ${c.projet} ».` : '' }, ctx);
}

/** Lie une session de plus à une tâche existante. */
export function lierSession(d: DonneesTaches, tacheId: string, c: CibleOffice, ctx: Contexte): DonneesTaches {
  const t = d.taches[tacheId];
  if (!vivant(t)) throw new ErreurTaches('Tâche introuvable.');
  const liens = t.liensOffice ?? [];
  if (liens.some(l => l.session === c.session && l.sousAgent === c.sousAgent)) return d;
  return modifierTache(d, tacheId, { liensOffice: [...liens, lien(c, ctx.maintenant)].slice(-20) }, ctx);
}

export function retirerLien(d: DonneesTaches, tacheId: string, index: number, ctx: Contexte): DonneesTaches {
  const t = d.taches[tacheId];
  if (!t?.liensOffice) return d;
  const reste = t.liensOffice.filter((_, i) => i !== index);
  return modifierTache(d, tacheId, { liensOffice: reste.length ? reste : undefined }, ctx);
}

/** Une fin d'agent (ou de sous-agent) vue dans l'activité de Claude Office. */
export interface FinOffice {
  session: string;
  sousAgent?: string;
  fin: number;
}

/** Statut « En revue » du projet (identifiant ou nom), sinon rien. */
export function statutRevue(statuts: readonly Statut[]): Statut | undefined {
  return statuts.find(s => s.id === 'en-revue') ?? statuts.find(s => !s.ferme && /revue|review|relire/i.test(s.nom));
}

/**
 * Fait passer « En revue » les tâches ouvertes dont l'agent lié a fini après
 * le lien (une seule fois par fin). Rend les événements de notification.
 */
export function appliquerFinsOffice(d: DonneesTaches, fins: readonly FinOffice[], ctx: Contexte): { donnees: DonneesTaches; evenements: EvenementNotif[] } {
  if (!fins.length) return { donnees: d, evenements: [] };
  const parSession = new Map<string, FinOffice[]>();
  for (const f of fins) parSession.set(f.session, [...(parSession.get(f.session) ?? []), f]);
  let x = d;
  const evenements: EvenementNotif[] = [];
  for (const t of tachesVivantes(d)) {
    if (!t.liensOffice?.length || estTerminee(d, t)) continue;
    let liens = t.liensOffice;
    let derniere: { fin: number; lien: LienOffice } | undefined;
    liens = liens.map(l => {
      const f = (parSession.get(l.session) ?? []).filter(x2 => x2.sousAgent === l.sousAgent).sort((a, b) => b.fin - a.fin)[0];
      if (!f || f.fin <= Date.parse(l.depuis) || f.fin <= (l.finVue ?? 0)) return l;
      if (!derniere || f.fin > derniere.fin) derniere = { fin: f.fin, lien: l };
      return { ...l, finVue: f.fin };
    });
    if (!derniere) continue;
    const revue = statutRevue(statutsDe(x, t.projetId));
    const changement = { liensOffice: liens, ...(revue && t.statut !== revue.id ? { statut: revue.id } : {}) };
    x = modifierTache(x, t.id, changement, ctx);
    const quoi = derniere.lien.sousAgent ? 'Le sous-agent lié a fini' : 'L’agent lié a fini';
    evenements.push({
      type: 'office',
      cle: `${t.id}|office|${derniere.fin}`,
      tacheId: t.id,
      projetId: t.projetId,
      titre: t.titre,
      texte: revue ? `${quoi} : tâche passée « ${revue.nom} »` : `${quoi} : à relire`,
      date: new Date(derniere.fin).toISOString(),
    });
  }
  return { donnees: x, evenements };
}

/** Tâches ouvertes qui attendent un agent (le hub ne lit l'activité de Claude Office que s'il y en a). */
export const tachesLieesOuvertes = (d: DonneesTaches): number => tachesVivantes(d).filter(t => t.liensOffice?.length && !estTerminee(d, t)).length;

// ------------------------------------------------------------------ Ouvrir l'Historique filtré

/** Demande déposée par Tâches dans la base de l'appareil : Claude Office l'ouvre filtrée sur la session. */
export const CLE_DEMANDE_HISTORIQUE = 'claudeOffice.demandeHistorique';
const DUREE_DEMANDE_MS = 60_000;

export function demanderHistorique(base: Pick<BasePrefs, 'ecrire'> | undefined, session: string, maintenant: number): void {
  try {
    base?.ecrire(CLE_DEMANDE_HISTORIQUE, JSON.stringify({ session: session.slice(0, 80), le: maintenant }));
  } catch {
    // Sans base : Claude Office s'ouvre simplement sur son premier onglet.
  }
}

/** Lue (et effacée) par Claude Office à son ouverture ; ignorée si elle a plus d'une minute. */
export function prendreDemandeHistorique(base: Pick<BasePrefs, 'lire' | 'ecrire'> & { supprimer?(c: string): void } | undefined, maintenant: number): string | undefined {
  try {
    const brut = base?.lire(CLE_DEMANDE_HISTORIQUE);
    if (!brut) return undefined;
    if (base?.supprimer) base.supprimer(CLE_DEMANDE_HISTORIQUE);
    else base?.ecrire(CLE_DEMANDE_HISTORIQUE, '');
    const o = JSON.parse(brut) as { session?: unknown; le?: unknown };
    if (typeof o.session !== 'string' || typeof o.le !== 'number' || maintenant - o.le > DUREE_DEMANDE_MS || o.le > maintenant + 5_000) return undefined;
    return o.session;
  } catch {
    return undefined;
  }
}

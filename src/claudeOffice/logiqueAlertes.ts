/**
 * Claude Office v4 : ALERTES configurables, logique pure (sans React ni pont),
 * calculée sur les événements de l'historique (journal du PC ou copie chiffrée).
 *
 *  - « attente »        : un agent attend ta réponse depuis plus de X min ;
 *  - « session-longue » : une session est active depuis plus de X h ;
 *  - « erreurs »        : plus de N erreurs d'outil d'affilée (N échecs de suite) ;
 *  - « fini »           : un agent a fini une tâche (d'au moins X min).
 *
 * Anti-répétition : chaque occurrence a une clé (session + événement déclencheur)
 * signalée une seule fois, et au plus une alerte par règle et par session toutes
 * les `ANTI_REPETITION_MS` (l'occurrence attend la fin de ce délai). Seuls les faits
 * récents comptent (`FRAICHEUR_MS`) : rouvrir l'écran ne rejoue pas l'historique.
 * Le journal (borné) et l'état sont rangés sur l'appareil (alertesOffice.ts).
 */

import { cleAppareil, INACTIF_MS, masquerAffichage, resumerTexte } from './logiqueBureau';
import { dureeCourte, fusionner, type EntreeHistorique } from './logiqueHistorique';

export type RegleAlerte = 'attente' | 'session-longue' | 'erreurs' | 'fini';
export const REGLES: readonly RegleAlerte[] = ['attente', 'session-longue', 'erreurs', 'fini'];

export interface ReglageAlerte {
  active: boolean;
  /** Minutes (attente, fini), heures (session longue) ou nombre d'erreurs. */
  seuil: number;
  /** Notification du système (PC seulement, mécanisme existant). */
  notifier: boolean;
  /** Compte dans la pastille de l'onglet et de la tuile du hub. */
  badge: boolean;
}
export type ReglagesAlertes = Record<RegleAlerte, ReglageAlerte>;

export const DEFINITIONS: Record<RegleAlerte, { titre: string; unite: string; seuils: readonly number[]; aide: (seuil: number) => string }> = {
  attente: {
    titre: 'Un agent attend ta réponse',
    unite: 'min',
    seuils: [1, 2, 5, 10, 15, 30],
    aide: s => `Claude demande une autorisation ou pose une question depuis plus de ${s} min.`,
  },
  'session-longue': {
    titre: 'Session active depuis longtemps',
    unite: 'h',
    seuils: [1, 2, 3, 4, 6, 8],
    aide: s => `Une session encore active a commencé il y a plus de ${s} h.`,
  },
  erreurs: {
    titre: 'Erreurs d’outil d’affilée',
    unite: 'erreurs',
    seuils: [2, 3, 4, 5, 8],
    aide: s => `${s} outils de suite ont échoué dans une même session.`,
  },
  fini: {
    titre: 'Un agent a fini',
    unite: 'min',
    seuils: [0, 1, 5, 15, 30],
    aide: s => (s ? `Fin d’une tâche qui a duré au moins ${s} min.` : 'Fin de chaque tâche, même courte.'),
  },
};

export const REGLAGES_DEFAUT: ReglagesAlertes = {
  attente: { active: true, seuil: 5, notifier: false, badge: true },
  'session-longue': { active: true, seuil: 2, notifier: false, badge: true },
  erreurs: { active: true, seuil: 3, notifier: false, badge: true },
  fini: { active: true, seuil: 5, notifier: false, badge: true },
};

/** Au plus une alerte par règle et par session dans ce délai. */
export const ANTI_REPETITION_MS = 10 * 60_000;
/** Un fait plus ancien ne déclenche plus d'alerte (pas de rattrapage de l'historique). */
export const FRAICHEUR_MS: Record<RegleAlerte, number> = { attente: 2 * 3_600_000, 'session-longue': 3_600_000, erreurs: 30 * 60_000, fini: 15 * 60_000 };
/** Occurrences signalées gardées ce temps (puis oubliées). */
export const MEMOIRE_MS = 7 * 86_400_000;
export const MAX_JOURNAL = 200;

export interface Alerte {
  /** Clé de l'occurrence (unique). */
  id: string;
  regle: RegleAlerte;
  /** Déclenchement (ISO). */
  ts: string;
  /** Session (identifiant) et clé `appareil|session`. */
  session: string;
  cleSession: string;
  projet?: string;
  appareil?: string;
  titre: string;
  detail: string;
  lue: boolean;
  demo?: boolean;
}

export interface EtatAlertes {
  /** Occurrence → date de signalement (ms). */
  signalees: Record<string, number>;
  /** `règle|session` → dernière alerte (ms). */
  dernieres: Record<string, number>;
}
export const ETAT_VIDE: EtatAlertes = { signalees: {}, dernieres: {} };

// ------------------------------------------------------------------ lecture prudente

export function lireReglagesAlertes(brut: unknown): ReglagesAlertes {
  let o: Record<string, unknown> = {};
  try {
    o = (typeof brut === 'string' ? JSON.parse(brut) : brut ?? {}) as Record<string, unknown>;
  } catch {
    o = {};
  }
  const res = {} as ReglagesAlertes;
  for (const r of REGLES) {
    const v = (o && typeof o === 'object' ? o[r] : undefined) as Partial<ReglageAlerte> | undefined;
    const d = REGLAGES_DEFAUT[r];
    res[r] = {
      active: typeof v?.active === 'boolean' ? v.active : d.active,
      seuil: typeof v?.seuil === 'number' && DEFINITIONS[r].seuils.includes(v.seuil) ? v.seuil : d.seuil,
      notifier: typeof v?.notifier === 'boolean' ? v.notifier : d.notifier,
      badge: typeof v?.badge === 'boolean' ? v.badge : d.badge,
    };
  }
  return res;
}

export function lireJournalAlertes(brut: unknown): { journal: Alerte[]; etat: EtatAlertes } {
  try {
    const o = (typeof brut === 'string' ? JSON.parse(brut) : brut) as { journal?: unknown; etat?: Partial<EtatAlertes> } | null;
    const journal = Array.isArray(o?.journal)
      ? (o!.journal as Alerte[]).filter(a => a && typeof a.id === 'string' && REGLES.includes(a.regle) && typeof a.ts === 'string' && typeof a.titre === 'string').slice(0, MAX_JOURNAL)
      : [];
    const nombres = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? (v as Record<string, unknown>) : {}).filter(([, n]) => typeof n === 'number')) as Record<string, number>;
    return { journal, etat: { signalees: nombres(o?.etat?.signalees), dernieres: nombres(o?.etat?.dernieres) } };
  } catch {
    return { journal: [], etat: { signalees: {}, dernieres: {} } };
  }
}

// ------------------------------------------------------------------ évaluation

export interface OptionsAlertes {
  maintenant: number;
  reglages: ReglagesAlertes;
  etat: EtatAlertes;
  /** Date du dernier dépôt par appareil (copie du relais) : l'état est jugé à cette date. */
  references?: Record<string, number>;
  demo?: boolean;
}

interface Candidate {
  id: string;
  regle: RegleAlerte;
  cle: string;
  session: string;
  projet?: string;
  appareil?: string;
  /** Date du fait déclencheur (ms), pour la fraîcheur. */
  fait: number;
  titre: string;
  detail: string;
}

const t = (e: EntreeHistorique) => Date.parse(e.ts);

/** Candidates d'une session (déjà triée), selon les réglages. */
function candidatesSession(cle: string, liste: readonly EntreeHistorique[], o: OptionsAlertes): Candidate[] {
  const res: Candidate[] = [];
  const dernier = liste[liste.length - 1];
  const session = dernier.session ?? 'sans-session';
  const projet = [...liste].reverse().find(e => e.projet)?.projet;
  const nom = masquerAffichage(projet ?? 'Projet inconnu');
  const commun = { cle, session, ...(projet ? { projet } : {}), ...(dernier.appareil ? { appareil: dernier.appareil } : {}) };
  const tDernier = t(dernier);
  const ref = o.references?.[cleAppareil(dernier)];
  // Sur une copie du relais, on juge à la date du dépôt (jamais au-delà de ce qu'on sait).
  const reference = ref !== undefined ? Math.max(ref, tDernier) : o.maintenant;
  const r = o.reglages;

  if (r.attente.active && dernier.type === 'attente') {
    const depuis = reference - tDernier;
    if (depuis >= r.attente.seuil * 60_000) {
      res.push({
        ...commun, id: `attente|${cle}|${dernier.id}`, regle: 'attente', fait: tDernier,
        titre: `${nom} attend ta réponse depuis ${dureeCourte(depuis).replace(/ \d+ s$/, '')}`,
        detail: resumerTexte(dernier.resume ?? (dernier.outil ? `Autoriser ${dernier.outil} ?` : 'Autorisation ou question en attente'), 140) ?? '',
      });
    }
  }

  if (r['session-longue'].active && dernier.type !== 'fin-session' && reference - tDernier < INACTIF_MS) {
    const debut = t(liste[0]);
    const duree = reference - debut;
    if (duree >= r['session-longue'].seuil * 3_600_000) {
      res.push({
        ...commun, id: `session-longue|${cle}|${r['session-longue'].seuil}`, regle: 'session-longue', fait: tDernier,
        titre: `${nom} : session active depuis ${dureeCourte(duree).replace(/ \d+ s$/, '')}`,
        detail: `Ouverte à ${new Date(debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${liste.filter(e => e.type === 'demande').length} demande(s)`,
      });
    }
  }

  if (r.erreurs.active) {
    let serie: EntreeHistorique[] = [];
    for (const e of liste) {
      if (e.type !== 'outil') continue;
      if (e.echec) serie.push(e);
      else serie = [];
      if (serie.length === r.erreurs.seuil) {
        const outils = [...new Set(serie.map(x => x.outil ?? '?'))].join(', ');
        res.push({
          ...commun, id: `erreurs|${cle}|${serie[0].id}`, regle: 'erreurs', fait: t(e),
          titre: `${nom} : ${serie.length} erreurs d’outil d’affilée`,
          detail: masquerAffichage(`${outils}${e.resume ? ` · ${resumerTexte(e.resume, 80)}` : ''}`),
        });
      }
    }
  }

  if (r.fini.active) {
    let debutTache: number | undefined;
    let demande: string | undefined;
    for (let i = 0; i < liste.length; i++) {
      const e = liste[i];
      if (e.type === 'demande') {
        if (debutTache === undefined) debutTache = t(e);
        demande = e.texte ?? demande;
      }
      const fin = e.type === 'fin-reponse' || (e.type === 'fin-session' && liste[i - 1]?.type !== 'fin-reponse');
      if (!fin) continue;
      const duree = debutTache === undefined ? 0 : t(e) - debutTache;
      if (debutTache !== undefined && duree >= r.fini.seuil * 60_000) {
        res.push({
          ...commun, id: `fini|${cle}|${e.id}`, regle: 'fini', fait: t(e),
          titre: `${nom} a fini${duree >= 60_000 ? ` (${dureeCourte(duree).replace(/ \d+ s$/, '')})` : ''}`,
          detail: resumerTexte(demande, 140) ?? (e.type === 'fin-session' ? 'Session terminée' : 'Réponse terminée'),
        });
      }
      debutTache = undefined;
      demande = undefined;
    }
  }
  return res;
}

/**
 * Nouvelles alertes à l'instant `maintenant`, et l'état mis à jour (occurrences
 * signalées, dernière alerte par règle et par session, mémoire bornée).
 */
export function evaluerAlertes(entrees: readonly EntreeHistorique[], o: OptionsAlertes): { nouvelles: Alerte[]; etat: EtatAlertes } {
  const parSession = new Map<string, EntreeHistorique[]>();
  for (const e of fusionner(entrees)) {
    const cle = `${cleAppareil(e)}|${e.session ?? 'sans-session'}`;
    let l = parSession.get(cle);
    if (!l) parSession.set(cle, (l = []));
    l.push(e);
  }
  const signalees: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.etat.signalees)) if (o.maintenant - v < MEMOIRE_MS) signalees[k] = v;
  const dernieres: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.etat.dernieres)) if (o.maintenant - v < MEMOIRE_MS) dernieres[k] = v;
  const nouvelles: Alerte[] = [];
  const candidates = [...parSession].flatMap(([cle, liste]) => candidatesSession(cle, liste, o)).sort((a, b) => a.fait - b.fait);
  for (const c of candidates) {
    if (signalees[c.id] !== undefined) continue;
    if (o.maintenant - c.fait > FRAICHEUR_MS[c.regle]) continue;
    const cleRepetition = `${c.regle}|${c.cle}`;
    const precedente = dernieres[cleRepetition];
    if (precedente !== undefined && o.maintenant - precedente < ANTI_REPETITION_MS) continue;
    signalees[c.id] = o.maintenant;
    dernieres[cleRepetition] = o.maintenant;
    nouvelles.push({
      id: c.id, regle: c.regle, ts: new Date(o.maintenant).toISOString(), session: c.session, cleSession: c.cle,
      ...(c.projet ? { projet: c.projet } : {}), ...(c.appareil ? { appareil: c.appareil } : {}),
      titre: c.titre, detail: c.detail, lue: false, ...(o.demo ? { demo: true } : {}),
    });
  }
  return { nouvelles, etat: { signalees, dernieres } };
}

// ------------------------------------------------------------------ journal

/** Les plus récentes d'abord, borné. */
export function ajouterAuJournal(journal: readonly Alerte[], nouvelles: readonly Alerte[]): Alerte[] {
  if (!nouvelles.length) return [...journal];
  const ids = new Set(nouvelles.map(a => a.id));
  return [...[...nouvelles].reverse(), ...journal.filter(a => !ids.has(a.id))].slice(0, MAX_JOURNAL);
}

export const marquerToutLu = (journal: readonly Alerte[]): Alerte[] => journal.map(a => (a.lue ? a : { ...a, lue: true }));

/** Alertes non lues qui comptent dans la pastille (règles dont le badge est activé). */
export function nonLues(journal: readonly Alerte[], reglages: ReglagesAlertes): number {
  return journal.filter(a => !a.lue && reglages[a.regle]?.badge).length;
}

/** Libellé de la pastille : « 3 » ou « 9+ ». */
export const libellePastille = (n: number): string => (n > 9 ? '9+' : String(n));

/**
 * Claude Office : résumé « Aujourd'hui », statistiques (requêtes par jour,
 * heures d'activité, outils, projets, durée des sessions) et chronologie d'une
 * session. Logique pure, calculée sur l'appareil à partir de l'historique (le
 * journal sur le PC, la copie chiffrée ailleurs) : rien n'est envoyé.
 */

import { cleAppareil, resumerTexte } from './logiqueBureau';
import { dureeCourte, fusionner, jourLocal, type EntreeHistorique } from './logiqueHistorique';

/** Deux événements d'une session à moins de ce délai : le temps entre eux compte comme « actif ». */
export const PAUSE_MAX_ACTIF_MS = 5 * 60_000;

const debutJourLocal = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const cleSession = (e: EntreeHistorique) => `${cleAppareil(e)}|${e.session ?? 'sans-session'}`;

/** Temps actif d'une liste d'événements d'UNE session triés : somme des écarts courts. */
function tempsActif(ts: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < ts.length; i++) {
    const ecart = ts[i] - ts[i - 1];
    if (ecart > 0 && ecart <= PAUSE_MAX_ACTIF_MS) total += ecart;
  }
  return total;
}

function parSession(entrees: readonly EntreeHistorique[]): Map<string, EntreeHistorique[]> {
  const res = new Map<string, EntreeHistorique[]>();
  for (const e of fusionner(entrees)) {
    const cle = cleSession(e);
    let l = res.get(cle);
    if (!l) res.set(cle, (l = []));
    l.push(e);
  }
  return res;
}

export interface ResumeJour {
  sessions: number;
  demandes: number;
  /** Temps actif cumulé (ms) : écarts de moins de 5 min entre deux événements d'une session. */
  actifMs: number;
  dernierProjet?: string;
}

export function resumeAujourdhui(entrees: readonly EntreeHistorique[], maintenant: number): ResumeJour {
  const depuis = debutJourLocal(maintenant);
  const jour = entrees.filter(e => {
    const t = Date.parse(e.ts);
    return t >= depuis && t <= maintenant + 60_000;
  });
  let actifMs = 0;
  for (const liste of parSession(jour).values()) actifMs += tempsActif(liste.map(e => Date.parse(e.ts)));
  const triees = fusionner(jour);
  const dernierProjet = [...triees].reverse().find(e => e.projet)?.projet;
  return {
    sessions: new Set(jour.map(cleSession)).size,
    demandes: jour.filter(e => e.type === 'demande').length,
    actifMs,
    ...(dernierProjet ? { dernierProjet } : {}),
  };
}

/** « 3 sessions · 12 demandes · 1 h 20 actif · dernier projet : budget ». */
export function phraseAujourdhui(r: ResumeJour): string {
  if (!r.sessions) return 'Aujourd’hui : pas encore d’activité.';
  const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  return [
    `Aujourd’hui : ${pluriel(r.sessions, 'session')}`,
    pluriel(r.demandes, 'demande'),
    `${r.actifMs >= 60_000 ? dureeCourte(r.actifMs).replace(/ \d+ s$/, '') : 'moins d’1 min'} d’activité`,
    r.dernierProjet ? `dernier projet : ${r.dernierProjet}` : '',
  ].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- statistiques

export interface Statistiques {
  jours: number;
  /** Du plus ancien au plus récent : un point par jour de la période. */
  parJour: Array<{ jour: string; demandes: number; outils: number }>;
  /** Carte de chaleur : [jour de la semaine (0 = lundi)][heure] = événements (demandes et outils). */
  chaleur: number[][];
  maxChaleur: number;
  outils: Array<{ nom: string; n: number; dureeMoyMs?: number }>;
  projets: Array<{ nom: string; demandes: number; sessions: number }>;
  totalDemandes: number;
  totalOutils: number;
  sessions: number;
  /** Durée moyenne d'une session (premier → dernier événement), sessions d'au moins deux événements. */
  dureeMoyenneSessionMs?: number;
  /** Temps actif cumulé de la période. */
  actifMs: number;
}

export function calculerStatistiques(entrees: readonly EntreeHistorique[], maintenant: number, jours: 7 | 30): Statistiques {
  const fin = debutJourLocal(maintenant) + 86_400_000;
  const depuis = debutJourLocal(maintenant - (jours - 1) * 86_400_000);
  const periode = fusionner(entrees).filter(e => {
    const t = Date.parse(e.ts);
    return t >= depuis && t < fin;
  });
  const parJour = new Map<string, { demandes: number; outils: number }>();
  for (let t = depuis; t < fin; t += 86_400_000) parJour.set(jourLocal(new Date(t + 3_600_000 * 12).toISOString()), { demandes: 0, outils: 0 });
  const chaleur = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const outils = new Map<string, { n: number; duree: number; mesures: number }>();
  const projets = new Map<string, { demandes: number; sessions: Set<string> }>();
  let totalDemandes = 0;
  let totalOutils = 0;
  for (const e of periode) {
    const d = new Date(e.ts);
    const j = parJour.get(jourLocal(e.ts));
    if (e.type === 'demande' || e.type === 'outil') {
      chaleur[(d.getDay() + 6) % 7][d.getHours()]++;
    }
    if (e.type === 'demande') {
      totalDemandes++;
      if (j) j.demandes++;
    }
    if (e.type === 'outil') {
      totalOutils++;
      if (j) j.outils++;
      const nom = e.outil ?? 'Outil';
      const o = outils.get(nom) ?? { n: 0, duree: 0, mesures: 0 };
      o.n++;
      if (typeof e.duree === 'number') {
        o.duree += e.duree;
        o.mesures++;
      }
      outils.set(nom, o);
    }
    if (e.projet) {
      const p = projets.get(e.projet) ?? { demandes: 0, sessions: new Set<string>() };
      if (e.type === 'demande') p.demandes++;
      p.sessions.add(cleSession(e));
      projets.set(e.projet, p);
    }
  }
  let actifMs = 0;
  let dureeTotale = 0;
  let mesurees = 0;
  const sessions = parSession(periode);
  for (const liste of sessions.values()) {
    const ts = liste.map(e => Date.parse(e.ts));
    actifMs += tempsActif(ts);
    if (ts.length >= 2) {
      dureeTotale += ts[ts.length - 1] - ts[0];
      mesurees++;
    }
  }
  return {
    jours,
    parJour: [...parJour].map(([jour, v]) => ({ jour, ...v })),
    chaleur,
    maxChaleur: Math.max(0, ...chaleur.flat()),
    outils: [...outils].map(([nom, o]) => ({ nom, n: o.n, ...(o.mesures ? { dureeMoyMs: o.duree / o.mesures } : {}) })).sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom)).slice(0, 8),
    projets: [...projets].map(([nom, p]) => ({ nom, demandes: p.demandes, sessions: p.sessions.size })).sort((a, b) => b.demandes - a.demandes || b.sessions - a.sessions || a.nom.localeCompare(b.nom)).slice(0, 8),
    totalDemandes,
    totalOutils,
    sessions: sessions.size,
    ...(mesurees ? { dureeMoyenneSessionMs: dureeTotale / mesurees } : {}),
    actifMs,
  };
}

// ---------------------------------------------------------------- chronologie d'une session

export type GenreEtape = 'debut' | 'demande' | 'outil' | 'reflexion' | 'attente' | 'reponse' | 'sous-agent' | 'fin';

export interface Etape {
  id: string;
  ts: number;
  genre: GenreEtape;
  titre: string;
  detail?: string;
  dureeMs?: number;
  echec?: boolean;
}

export interface ChronologieSession {
  etapes: Etape[];
  /** Étapes plus anciennes non montrées. */
  masquees: number;
  demandes: number;
  outils: number;
  echecs: number;
  attentes: number;
  /** Durée cumulée des outils mesurés (ms). */
  dureeOutilsMs: number;
  debut?: number;
  fin?: number;
}

/** Une réflexion de plus de ce délai (entre une demande ou un outil et l'événement suivant) devient une étape. */
export const REFLEXION_MIN_MS = 15_000;
export const MAX_ETAPES = 80;

/** Chronologie d'une session (clé `appareil|session` du bureau) : demandes, outils (durée), réflexions, attentes, fin. */
export function chronologieSession(entrees: readonly EntreeHistorique[], cle: string): ChronologieSession {
  const liste = fusionner(entrees).filter(e => cleSession(e) === cle);
  const etapes: Etape[] = [];
  let demandes = 0;
  let outils = 0;
  let echecs = 0;
  let attentes = 0;
  let dureeOutilsMs = 0;
  liste.forEach((e, i) => {
    const t = Date.parse(e.ts);
    const precedent = liste[i - 1];
    if (precedent && (precedent.type === 'demande' || precedent.type === 'outil')) {
      // Le hook note la FIN des outils : avec leur durée, la réflexion est l'écart avant leur début.
      const debutCeluiCi = e.type === 'outil' && typeof e.duree === 'number' ? t - e.duree : t;
      const ecart = debutCeluiCi - Date.parse(precedent.ts);
      if (ecart >= REFLEXION_MIN_MS && e.type !== 'fin-session') {
        etapes.push({ id: `${e.id}-r`, ts: Date.parse(precedent.ts) + 1, genre: 'reflexion', titre: 'Réflexion', dureeMs: ecart });
      }
    }
    switch (e.type) {
      case 'debut-session':
        etapes.push({ id: e.id, ts: t, genre: 'debut', titre: 'Session ouverte', ...(e.resume ? { detail: e.resume } : {}) });
        break;
      case 'demande':
        demandes++;
        etapes.push({ id: e.id, ts: t, genre: 'demande', titre: 'Demande', detail: resumerTexte(e.texte, 220) ?? '(vide)' });
        break;
      case 'outil':
        outils++;
        if (e.echec) echecs++;
        if (typeof e.duree === 'number') dureeOutilsMs += e.duree;
        etapes.push({ id: e.id, ts: t, genre: 'outil', titre: e.outil ?? 'Outil', ...(e.resume ? { detail: resumerTexte(e.resume, 120) } : {}), ...(typeof e.duree === 'number' ? { dureeMs: e.duree } : {}), ...(e.echec ? { echec: true } : {}) });
        break;
      case 'attente':
        attentes++;
        // Deux signaux pour la même attente (notification et demande d'autorisation) : une seule étape.
        if (precedent?.type === 'attente' && t - Date.parse(precedent.ts) < 10_000) break;
        etapes.push({ id: e.id, ts: t, genre: 'attente', titre: e.motif === 'question' ? 'Te pose une question' : 'Attend ton autorisation', ...(e.resume ? { detail: resumerTexte(e.resume, 160) } : {}) });
        break;
      case 'fin-reponse':
        etapes.push({ id: e.id, ts: t, genre: 'reponse', titre: 'Réponse terminée', ...(e.sortie ? { detail: resumerTexte(e.sortie, 220) } : {}) });
        break;
      case 'fin-sous-agent':
        etapes.push({ id: e.id, ts: t, genre: 'sous-agent', titre: 'Sous-agent terminé' });
        break;
      case 'fin-session':
        etapes.push({ id: e.id, ts: t, genre: 'fin', titre: 'Session fermée', ...(e.resume ? { detail: e.resume } : {}) });
        break;
      default:
        break;
    }
  });
  etapes.sort((a, b) => a.ts - b.ts);
  const masquees = Math.max(0, etapes.length - MAX_ETAPES);
  return {
    etapes: etapes.slice(masquees),
    masquees,
    demandes,
    outils,
    echecs,
    attentes,
    dureeOutilsMs,
    ...(liste.length ? { debut: Date.parse(liste[0].ts), fin: Date.parse(liste[liste.length - 1].ts) } : {}),
  };
}

// ---------------------------------------------------------------- démo

const PROJETS_HISTO = ['boutique', 'api-meteo', 'carnet', 'jardin', 'atelier', 'site-vitrine'] as const;
const OUTILS_HISTO: ReadonlyArray<[string, string, number]> = [
  ['Read', 'src/index.ts', 300], ['Edit', 'src/module.ts', 900], ['Bash', 'npm test', 8_000], ['Grep', '« config »', 600],
  ['Write', 'src/nouveau.ts', 700], ['Glob', '**/*.tsx', 200], ['WebFetch', 'https://developer.mozilla.org', 2_200], ['Task', 'Revue du code', 25_000],
];

/** Historique fictif de 30 jours (mode « démo » des statistiques et de l'historique) : déterministe. */
export function historiqueDemo(maintenant: number): EntreeHistorique[] {
  const res: EntreeHistorique[] = [];
  const jour0 = debutJourLocal(maintenant);
  let graine = 7;
  const alea = () => ((graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let j = 29; j >= 1; j--) {
    const base = jour0 - j * 86_400_000;
    const weekEnd = [0, 6].includes(new Date(base).getDay());
    const nb = weekEnd ? Math.floor(alea() * 2) : 1 + Math.floor(alea() * 3);
    for (let s = 0; s < nb; s++) {
      const projet = PROJETS_HISTO[Math.floor(alea() * PROJETS_HISTO.length)];
      const session = `demo-h${j}-${s}`;
      let t = base + (9 + Math.floor(alea() * 11)) * 3_600_000 + Math.floor(alea() * 50) * 60_000;
      const ev = (type: string, extra: Partial<EntreeHistorique> = {}) => {
        res.push({ v: 1, id: `${session}-${res.length}`, ts: new Date(t).toISOString(), type, appareil: 'PC de démo', appareilId: 'demo00000000', session, projet, dossier: `/demo/${projet}`, ...extra });
      };
      ev('debut-session', { resume: 'startup' });
      const demandes = 1 + Math.floor(alea() * 4);
      for (let d = 0; d < demandes; d++) {
        t += 60_000;
        ev('demande', { texte: `Demande ${d + 1} sur ${projet}` });
        const n = 2 + Math.floor(alea() * 7);
        for (let k = 0; k < n; k++) {
          const [outil, resume, duree] = OUTILS_HISTO[Math.floor(alea() * OUTILS_HISTO.length)];
          t += 20_000 + Math.floor(alea() * 60_000);
          ev('outil', { outil, resume, duree: Math.round(duree * (0.5 + alea())) });
        }
        t += 30_000;
        ev('fin-reponse');
      }
      t += 120_000;
      ev('fin-session');
    }
  }
  return res;
}

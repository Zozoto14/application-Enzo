/**
 * Claude Office v4 : RÉCAP du jour et de la semaine (7 derniers jours,
 * aujourd'hui compris). Logique pure, sur l'historique lu par l'appareil :
 * sessions, demandes, temps actif, projets, outils, faits marquants (sessions
 * les plus longues, erreurs, attentes). Exports texte, Markdown et JSON,
 * secrets masqués (motifs de `masquerAffichage`), sans contenu d'outil.
 */

import { cleAppareil, masquerAffichage, resumerTexte } from './logiqueBureau';
import { dureeCourte, fusionner, type EntreeHistorique } from './logiqueHistorique';
import { PAUSE_MAX_ACTIF_MS } from './logiqueStats';
import { statsSousAgents } from './logiqueSousAgents';

export type PeriodeRecap = 'jour' | 'semaine';

export interface SessionRecap {
  session: string;
  projet: string;
  appareil?: string;
  debut: string;
  dureeMs: number;
  demandes: number;
  derniereDemande?: string;
}

export interface Recap {
  periode: PeriodeRecap;
  /** Début de la période (ISO, minuit local) et date du calcul. */
  du: string;
  au: string;
  sessions: number;
  demandes: number;
  outils: number;
  actifMs: number;
  projets: Array<{ nom: string; demandes: number; sessions: number }>;
  outilsTop: Array<{ nom: string; n: number }>;
  plusLongues: SessionRecap[];
  erreurs: { total: number; sessions: Array<{ projet: string; session: string; n: number }> };
  attentes: { total: number; plusLongueMs?: number; projet?: string };
  /** Sous-agents lancés sur la période (hook v4, ou outil Agent/Task des hooks plus anciens). */
  sousAgents: { total: number; maxParalleles: number; types: Array<{ nom: string; n: number }> };
}

const debutJour = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const nom = (p: string | undefined) => masquerAffichage(p ?? 'Projet inconnu');

export function calculerRecap(entrees: readonly EntreeHistorique[], maintenant: number, periode: PeriodeRecap): Recap {
  const depuis = periode === 'jour' ? debutJour(maintenant) : debutJour(maintenant - 6 * 86_400_000);
  const liste = fusionner(entrees).filter(e => {
    const ts = Date.parse(e.ts);
    return ts >= depuis && ts <= maintenant + 60_000;
  });
  const parSession = new Map<string, EntreeHistorique[]>();
  for (const e of liste) {
    const cle = `${cleAppareil(e)}|${e.session ?? 'sans-session'}`;
    let l = parSession.get(cle);
    if (!l) parSession.set(cle, (l = []));
    l.push(e);
  }
  let actifMs = 0;
  const projets = new Map<string, { demandes: number; sessions: number }>();
  const outils = new Map<string, number>();
  const sessions: SessionRecap[] = [];
  const erreursSessions: Array<{ projet: string; session: string; n: number }> = [];
  let erreurs = 0;
  let attentes = 0;
  let plusLongueAttente: { ms: number; projet: string } | undefined;
  for (const l of parSession.values()) {
    const ts = l.map(e => Date.parse(e.ts));
    for (let i = 1; i < ts.length; i++) {
      const ecart = ts[i] - ts[i - 1];
      if (ecart > 0 && ecart <= PAUSE_MAX_ACTIF_MS) actifMs += ecart;
    }
    const projet = nom([...l].reverse().find(e => e.projet)?.projet);
    const demandes = l.filter(e => e.type === 'demande');
    const p = projets.get(projet) ?? { demandes: 0, sessions: 0 };
    p.demandes += demandes.length;
    p.sessions += 1;
    projets.set(projet, p);
    let n = 0;
    l.forEach((e, i) => {
      if (e.type === 'outil' && e.outil) outils.set(e.outil, (outils.get(e.outil) ?? 0) + 1);
      if (e.echec) n++;
      if (e.type === 'attente') {
        attentes++;
        const fin = i + 1 < l.length ? ts[i + 1] : Math.min(maintenant, ts[i] + 3_600_000);
        const ms = Math.max(0, fin - ts[i]);
        if (!plusLongueAttente || ms > plusLongueAttente.ms) plusLongueAttente = { ms, projet };
      }
    });
    erreurs += n;
    const session = l[0].session ?? 'sans-session';
    if (n) erreursSessions.push({ projet, session, n });
    const derniere = [...demandes].reverse().find(e => e.texte)?.texte;
    sessions.push({
      session, projet, ...(l[0].appareil ? { appareil: masquerAffichage(l[0].appareil) } : {}), debut: l[0].ts,
      dureeMs: ts[ts.length - 1] - ts[0], demandes: demandes.length,
      ...(derniere ? { derniereDemande: resumerTexte(derniere, 100) } : {}),
    });
  }
  return {
    periode,
    du: new Date(depuis).toISOString(),
    au: new Date(maintenant).toISOString(),
    sessions: parSession.size,
    demandes: liste.filter(e => e.type === 'demande').length,
    outils: liste.filter(e => e.type === 'outil').length,
    actifMs,
    projets: [...projets].map(([n, v]) => ({ nom: n, ...v })).sort((a, b) => b.demandes - a.demandes || b.sessions - a.sessions || a.nom.localeCompare(b.nom, 'fr')).slice(0, 8),
    outilsTop: [...outils].map(([n, v]) => ({ nom: masquerAffichage(n), n: v })).sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom)).slice(0, 6),
    plusLongues: sessions.filter(s => s.dureeMs > 0).sort((a, b) => b.dureeMs - a.dureeMs).slice(0, 3),
    erreurs: { total: erreurs, sessions: erreursSessions.sort((a, b) => b.n - a.n).slice(0, 3) },
    attentes: { total: attentes, ...(plusLongueAttente ? { plusLongueMs: plusLongueAttente.ms, projet: plusLongueAttente.projet } : {}) },
    sousAgents: (() => {
      const sa = statsSousAgents(liste, maintenant, periode === 'jour' ? 1 : 7);
      return { total: sa.total, maxParalleles: sa.maxParalleles, types: sa.types.slice(0, 4).map(x => ({ nom: masquerAffichage(x.nom), n: x.n })) };
    })(),
  };
}

// ------------------------------------------------------------------ phrases et exports

const duree = (ms: number) => (ms >= 60_000 ? dureeCourte(ms).replace(/ \d+ s$/, '') : 'moins d’1 min');
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
export const titreRecap = (r: Recap): string =>
  r.periode === 'jour'
    ? `Récap du ${new Date(r.au).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`
    : `Récap des 7 derniers jours (du ${new Date(r.du).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${new Date(r.au).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })})`;

/** Faits marquants, en phrases courtes (déjà masquées). */
export function faitsMarquants(r: Recap): string[] {
  const f = r.plusLongues.map((s, i) =>
    `${i === 0 ? 'Session la plus longue' : `${i + 1}e plus longue`} : ${s.projet}, ${duree(s.dureeMs)} (${pluriel(s.demandes, 'demande')})${s.derniereDemande ? ` — « ${s.derniereDemande} »` : ''}`);
  if (r.erreurs.total) f.push(`${pluriel(r.erreurs.total, 'erreur')} d’outil${r.erreurs.sessions.length ? ` (surtout ${r.erreurs.sessions.map(s => `${s.projet} : ${s.n}`).join(', ')})` : ''}`);
  else if (r.outils) f.push('Aucune erreur d’outil');
  if (r.sousAgents.total) f.push(`${pluriel(r.sousAgents.total, 'sous-agent')} (${r.sousAgents.types.map(x => `${x.nom} ×${x.n}`).join(', ')})${r.sousAgents.maxParalleles > 1 ? `, jusqu’à ${r.sousAgents.maxParalleles} en parallèle` : ''}`);
  if (r.attentes.total) f.push(`${pluriel(r.attentes.total, 'attente')} de ta réponse${r.attentes.plusLongueMs !== undefined ? ` (la plus longue : ${duree(r.attentes.plusLongueMs)}${r.attentes.projet ? `, ${r.attentes.projet}` : ''})` : ''}`);
  return f;
}

export function phraseRecap(r: Recap): string {
  if (!r.sessions) return r.periode === 'jour' ? 'Pas encore d’activité aujourd’hui.' : 'Aucune activité ces 7 derniers jours.';
  return `${pluriel(r.sessions, 'session')} · ${pluriel(r.demandes, 'demande')} · ${duree(r.actifMs)} d’activité · ${pluriel(r.projets.length, 'projet')}`;
}

export function exporterRecapTexte(r: Recap): string {
  const l = [titreRecap(r), phraseRecap(r)];
  if (r.sessions) {
    l.push('', `Projets : ${r.projets.map(p => `${p.nom} (${pluriel(p.demandes, 'demande')})`).join(', ')}`);
    if (r.outilsTop.length) l.push(`Outils : ${r.outilsTop.map(o => `${o.nom} ×${o.n}`).join(', ')}`);
    const f = faitsMarquants(r);
    if (f.length) l.push('', 'Faits marquants :', ...f.map(x => `- ${x}`));
  }
  return masquerAffichage(l.join('\n'));
}

export function exporterRecapMarkdown(r: Recap): string {
  const l = [`## ${titreRecap(r)}`, '', `**${phraseRecap(r)}**`];
  if (r.sessions) {
    l.push('', '| Projet | Demandes | Sessions |', '| --- | ---: | ---: |', ...r.projets.map(p => `| ${p.nom.replace(/\|/g, '\\|')} | ${p.demandes} | ${p.sessions} |`));
    if (r.outilsTop.length) l.push('', `**Outils** : ${r.outilsTop.map(o => `${o.nom} ×${o.n}`).join(', ')}`);
    const f = faitsMarquants(r);
    if (f.length) l.push('', '### Faits marquants', '', ...f.map(x => `- ${x}`));
  }
  return masquerAffichage(l.join('\n'));
}

export function exporterRecapJson(r: Recap): string {
  return masquerAffichage(JSON.stringify({ format: 'claude-office-recap', version: 1, ...r, faitsMarquants: faitsMarquants(r) }, null, 2));
}

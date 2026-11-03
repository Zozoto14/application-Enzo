/**
 * Tâches (V2) : « Journal du jour » de chaque projet et « Débriefing ».
 *
 *  - Journal : des entrées courtes (« ce que j'ai fait »), datées, signées
 *    (Fondateur ou ami), liées ou non à une tâche, ajoutées depuis le projet,
 *    depuis une tâche ou depuis « Ma journée ». Les tâches terminées et le
 *    temps suivi du jour sont PROPOSÉS (modifiables avant l'ajout), jamais
 *    ajoutés d'office. Une entrée n'est enregistrée qu'à la validation : pas
 *    d'écriture par frappe ; fusion entrée par entrée.
 *  - Débriefing : par projet, pour un jour ou une semaine — résumé (tâches
 *    terminées, temps passé, entrées), puis les entrées par auteur et par
 *    tâche, et ce qui reste (en retard, en revue ou bloqué, à venir), pour que
 *    les autres membres du projet comprennent. Export Markdown ou texte.
 *  - L'ami voit le journal et le débriefing des projets partagés avec lui et
 *    écrit ses entrées dans ceux partagés en écriture (comme les tâches).
 */

import { ajouterJours, jourDe, jourLisible } from './dates';
import {
  BORNES,
  ErreurTaches,
  estTerminee,
  horodatage,
  nouvelId,
  statutDe,
  suffixeAuteur,
  tachesVivantes,
  vivant,
  type Auteur,
  type Contexte,
  type DonneesTaches,
  type EntreeJournal,
  type Tache,
} from './modele';
import { modeProjet } from './partage';
import { dureeLisible, tempsVivants } from './temps';

export interface SaisieJournal {
  projetId: string;
  jour: string;
  texte: string;
  tacheId?: string;
  minutes?: number;
}

function verifierDroit(d: DonneesTaches, projetId: string, ctx: Contexte) {
  if (!vivant(d.projets[projetId])) throw new ErreurTaches('Projet introuvable.');
  if (ctx.auteur !== 'fondateur' && modeProjet(d, projetId) !== 'ecriture') throw new ErreurTaches('Ce projet n’est pas partagé en écriture avec vous.');
}

export function ajouterEntree(d: DonneesTaches, s: SaisieJournal, ctx: Contexte): { donnees: DonneesTaches; entree: EntreeJournal } {
  verifierDroit(d, s.projetId, ctx);
  const texte = s.texte.replace(/\s+/g, ' ').trim().slice(0, BORNES.commentaire);
  if (!texte) throw new ErreurTaches('Écrivez ce que vous avez fait.');
  const t = s.tacheId ? d.taches[s.tacheId] : undefined;
  const entree: EntreeJournal = {
    id: nouvelId('j', ctx.maintenant, ctx.alea),
    projetId: s.projetId,
    jour: s.jour,
    auteur: ctx.auteur,
    texte,
    ...(t && t.projetId === s.projetId ? { tacheId: t.id } : {}),
    ...(s.minutes && s.minutes > 0 ? { minutes: Math.min(24 * 60, Math.round(s.minutes)) } : {}),
    creeLe: new Date(ctx.maintenant).toISOString(),
    h: horodatage(ctx.maintenant, ctx.auteur),
  };
  return { donnees: { ...d, journal: { ...d.journal, [entree.id]: entree } }, entree };
}

function avecEntree(d: DonneesTaches, id: string, ctx: Contexte, changer: (e: EntreeJournal) => EntreeJournal): DonneesTaches {
  const e = d.journal[id];
  if (!e || e.supprime) throw new ErreurTaches('Entrée introuvable.');
  verifierDroit(d, e.projetId, ctx);
  if (e.auteur !== ctx.auteur && ctx.auteur !== 'fondateur') throw new ErreurTaches('Vous ne modifiez que vos entrées.');
  return { ...d, journal: { ...d.journal, [id]: { ...changer(e), h: horodatage(ctx.maintenant, ctx.auteur, e.h) } } };
}

export function modifierEntree(d: DonneesTaches, id: string, texte: string, ctx: Contexte): DonneesTaches {
  const t = texte.replace(/\s+/g, ' ').trim().slice(0, BORNES.commentaire);
  if (!t) throw new ErreurTaches('Une entrée ne peut pas être vide.');
  return avecEntree(d, id, ctx, e => ({ ...e, texte: t }));
}

export const supprimerEntree = (d: DonneesTaches, id: string, ctx: Contexte): DonneesTaches => avecEntree(d, id, ctx, e => ({ ...e, supprime: true }));

/** Entrées vivantes d'un projet entre deux jours inclus, dans l'ordre. */
export function entrees(d: DonneesTaches, projetId: string, du: string, au: string = du): EntreeJournal[] {
  return Object.values(d.journal ?? {})
    .filter(e => !e.supprime && e.projetId === projetId && e.jour >= du && e.jour <= au)
    .sort((a, b) => a.jour.localeCompare(b.jour) || a.creeLe.localeCompare(b.creeLe) || a.id.localeCompare(b.id));
}

export interface Proposition {
  cle: string;
  texte: string;
  tacheId: string;
  minutes?: number;
}

/**
 * Propositions du jour pour `qui` : ses tâches terminées ce jour-là et son
 * temps suivi, par tâche — sauf celles qui ont déjà une entrée de lui ce jour.
 */
export function propositions(d: DonneesTaches, projetId: string, jour: string, qui: Auteur): Proposition[] {
  const deja = new Set(entrees(d, projetId, jour).filter(e => e.auteur === qui && e.tacheId).map(e => e.tacheId!));
  const r: Proposition[] = [];
  for (const t of tachesVivantes(d, projetId)) {
    if (deja.has(t.id)) continue;
    const minutes = tempsVivants(t)
      .filter(e => e.jour === jour && e.auteur === qui)
      .reduce((n, e) => n + e.minutes, 0);
    const fini = estTerminee(d, t) && t.termineLe && jourDe(Date.parse(t.termineLe)) === jour && (t.h.statut ?? '').endsWith(suffixeAuteur(qui));
    if (!fini && !minutes) continue;
    r.push({ cle: `${t.id}|${jour}`, tacheId: t.id, texte: fini ? `Terminé : ${t.titre}` : `Avancé sur : ${t.titre}`, ...(minutes ? { minutes } : {}) });
  }
  return r;
}

// ------------------------------------------------------------------ Débriefing

export interface GroupeDebrief {
  tache?: { id: string; titre: string; terminee: boolean };
  entrees: EntreeJournal[];
}

export interface Debriefing {
  projetId: string;
  projet: string;
  du: string;
  au: string;
  /** Résumé en tête. */
  terminees: Array<{ id: string; titre: string; jour: string }>;
  minutes: number;
  nbEntrees: number;
  parAuteur: Array<{ auteur: Auteur; nom: string; minutes: number; groupes: GroupeDebrief[] }>;
  /** Ce qui reste : en retard, en revue ou bloqué, à venir (7 jours après la période). */
  reste: { retard: Tache[]; attente: Tache[]; aVenir: Tache[]; ouvertes: number };
}

export function debriefing(d: DonneesTaches, projetId: string, du: string, au: string, noms: Record<Auteur, string>): Debriefing {
  const p = d.projets[projetId];
  const liste = entrees(d, projetId, du, au);
  const taches = tachesVivantes(d, projetId);
  const terminees = taches
    .filter(t => estTerminee(d, t) && t.termineLe && jourDe(Date.parse(t.termineLe)) >= du && jourDe(Date.parse(t.termineLe)) <= au)
    .map(t => ({ id: t.id, titre: t.titre, jour: jourDe(Date.parse(t.termineLe!)) }))
    .sort((a, b) => a.jour.localeCompare(b.jour) || a.titre.localeCompare(b.titre));
  const minutesPar: Record<Auteur, number> = { fondateur: 0, ami: 0 };
  for (const t of taches) for (const e of tempsVivants(t)) if (e.jour >= du && e.jour <= au) minutesPar[e.auteur] = (minutesPar[e.auteur] ?? 0) + e.minutes;
  const parAuteur: Debriefing['parAuteur'] = [];
  // Le Fondateur, l'ami des V1/V2, puis les membres (V3) dans l'ordre de leur prénom.
  const autres = [...new Set([...liste.map(e => e.auteur), ...Object.keys(minutesPar)])].filter(x => x !== 'fondateur' && x !== 'ami').sort((a, b) => (noms[a] ?? a).localeCompare(noms[b] ?? b));
  for (const auteur of ['fondateur', 'ami', ...autres]) {
    const siennes = liste.filter(e => e.auteur === auteur);
    if (!siennes.length && !minutesPar[auteur]) continue;
    const groupes = new Map<string, GroupeDebrief>();
    for (const e of siennes) {
      const t = e.tacheId ? d.taches[e.tacheId] : undefined;
      const cle = t && vivant(t) ? t.id : '~';
      if (!groupes.has(cle)) groupes.set(cle, { ...(t && vivant(t) ? { tache: { id: t.id, titre: t.titre, terminee: estTerminee(d, t) } } : {}), entrees: [] });
      groupes.get(cle)!.entrees.push(e);
    }
    // Les entrées libres d'abord, puis par tâche.
    const tries = [...groupes.entries()].sort(([a], [b]) => (a === '~' ? -1 : b === '~' ? 1 : 0)).map(([, g]) => g);
    parAuteur.push({ auteur, nom: noms[auteur] ?? 'Membre', minutes: minutesPar[auteur] ?? 0, groupes: tries });
  }
  const ouvertes = taches.filter(t => !estTerminee(d, t) && !t.parentId);
  const retard = ouvertes.filter(t => t.echeance && t.echeance.jour < au).sort((a, b) => a.echeance!.jour.localeCompare(b.echeance!.jour));
  const attente = ouvertes.filter(t => !retard.includes(t) && /revue|bloqu|attente/i.test(statutDe(d, t).nom));
  const fin = ajouterJours(au, 7);
  const aVenir = ouvertes.filter(t => !retard.includes(t) && !attente.includes(t) && t.echeance && t.echeance.jour >= au && t.echeance.jour <= fin).sort((a, b) => a.echeance!.jour.localeCompare(b.echeance!.jour));
  return {
    projetId,
    projet: p?.nom ?? 'Projet',
    du,
    au,
    terminees,
    minutes: Object.values(minutesPar).reduce((n, m) => n + m, 0),
    nbEntrees: liste.length,
    parAuteur,
    reste: { retard, attente, aVenir, ouvertes: ouvertes.length },
  };
}

const fr = (jour: string) => jour.split('-').reverse().join('/');
const periode = (b: Debriefing) => (b.du === b.au ? `du ${fr(b.du)}` : `du ${fr(b.du)} au ${fr(b.au)}`);

/** Débriefing en Markdown (`texte` : sans mise en forme) — à coller dans un message ou une note. */
export function debriefingTexte(b: Debriefing, format: 'markdown' | 'texte' = 'markdown', aujourdhui?: string): string {
  const md = format === 'markdown';
  const titre = (t: string, n = 2) => (md ? `${'#'.repeat(n)} ${t}` : t.toUpperCase());
  const gras = (t: string) => (md ? `**${t}**` : t);
  const l: string[] = [];
  l.push(titre(`Débriefing « ${b.projet} » ${periode(b)}`, 1), '');
  l.push(
    `${gras('En bref')} : ${b.terminees.length} tâche${b.terminees.length > 1 ? 's' : ''} terminée${b.terminees.length > 1 ? 's' : ''}, ${dureeLisible(b.minutes)} de travail suivi, ${b.nbEntrees} entrée${b.nbEntrees > 1 ? 's' : ''} au journal.`,
    '',
  );
  if (b.terminees.length) {
    l.push(titre('Terminé'));
    for (const t of b.terminees) l.push(`- ✓ ${t.titre}${b.du !== b.au ? ` (${fr(t.jour)})` : ''}`);
    l.push('');
  }
  for (const a of b.parAuteur) {
    l.push(titre(`${a.nom}${a.minutes ? ` · ${dureeLisible(a.minutes)}` : ''}`));
    for (const g of a.groupes) {
      if (g.tache) l.push(`- ${gras(g.tache.titre)}${g.tache.terminee ? ' ✓' : ''}`);
      for (const e of g.entrees) l.push(`${g.tache ? '  ' : ''}- ${b.du !== b.au ? `${fr(e.jour)} · ` : ''}${e.texte}${e.minutes ? ` (${dureeLisible(e.minutes)})` : ''}`);
    }
    if (!a.groupes.length) l.push('- (temps suivi, sans entrée au journal)');
    l.push('');
  }
  const r = b.reste;
  if (r.retard.length || r.attente.length || r.aVenir.length) {
    l.push(titre('Ce qui reste'));
    for (const t of r.retard) l.push(`- ⚠︎ En retard : ${t.titre} (échéance ${aujourdhui ? jourLisible(t.echeance!.jour, aujourdhui) : fr(t.echeance!.jour)})`);
    for (const t of r.attente) l.push(`- ⏸︎ En attente : ${t.titre}`);
    for (const t of r.aVenir) l.push(`- À venir : ${t.titre} (${fr(t.echeance!.jour)})`);
    l.push('');
  }
  l.push(`${r.ouvertes} tâche${r.ouvertes > 1 ? 's' : ''} encore ouverte${r.ouvertes > 1 ? 's' : ''} dans le projet.`);
  return `${l.join('\n').trim()}\n`;
}

/**
 * Tâches : suppression d'un espace, d'un projet, d'une liste ou d'une tâche,
 * avec la corbeille.
 *
 *  - Supprimer pose des pierres tombales (`supprime`, datées, synchronisées)
 *    marquées d'un LOT : l'identifiant de l'élément supprimé. Tout ce qui part
 *    avec lui (projets d'un espace, listes et tâches d'un projet, sous-tâches)
 *    porte ce lot ; ce qui avait été supprimé avant, à part, garde le sien.
 *  - Avant de supprimer, le contenu peut être DÉPLACÉ (projets vers un autre
 *    espace, listes et tâches vers un autre projet, tâches vers une autre
 *    liste). « Annuler » (dans les 10 s) défait le déplacement et la
 *    suppression.
 *  - La corbeille garde 30 jours : restaurer rend tout le lot ; « supprimer
 *    définitivement » efface le contenu des tâches et marque `efface` (la
 *    pierre tombale reste, pour que les autres appareils et l'ami suivent).
 *  - Droits : seul le Fondateur supprime un espace, un projet ou une liste,
 *    restaure ou efface définitivement ; l'ami ne supprime et ne restaure que
 *    des tâches d'un projet partagé en écriture (comme en V1).
 *  - L'app n'est jamais laissée sans espace : supprimer le dernier recrée un
 *    espace « Personnel » vide (retiré si l'on annule).
 *
 * Tout est pur : horloge et auteur passent par `Contexte`.
 */

import { sansAccents } from './dates';
import {
  changerChamps,
  creerEspace,
  ErreurTaches,
  espacesVivants,
  evenement,
  borneHistorique,
  listesDe,
  modifierProjet,
  modifierTache,
  projetsDe,
  sousTaches,
  statutsDe,
  supprimerEspace,
  supprimerListe,
  supprimerProjet,
  supprimerTache,
  tachesVivantes,
  vivant,
  type Contexte,
  type DonneesTaches,
  type Entite,
  type Tache,
} from './modele';
import { modeProjet } from './partage';

export type Genre = 'espace' | 'projet' | 'liste' | 'tache';
type Collection = 'espaces' | 'projets' | 'listes' | 'taches';

export const COLLECTION: Record<Genre, Collection> = { espace: 'espaces', projet: 'projets', liste: 'listes', tache: 'taches' };
export const LIBELLES_GENRE: Record<Genre, string> = { espace: 'Espace', projet: 'Projet', liste: 'Liste', tache: 'Tâche' };
export const DUREE_CORBEILLE_JOURS = 30;
const JOUR_MS = 86_400_000;
export const DUREE_CORBEILLE_MS = DUREE_CORBEILLE_JOURS * JOUR_MS;
export const NOM_ESPACE_DEFAUT = 'Personnel';

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
const instantDe = (h: string | undefined): number => (h ? Date.parse(h.split('|')[0]) : Number.NaN);

// ------------------------------------------------------------------ Ce qui sera supprimé

export interface BilanSuppression {
  projets: number;
  listes: number;
  taches: number;
  /** Projets partagés avec l'ami parmi ceux supprimés. */
  partages: number;
}

export function bilanSuppression(d: DonneesTaches, genre: Genre, id: string): BilanSuppression {
  switch (genre) {
    case 'espace': {
      const projets = projetsDe(d, id);
      return {
        projets: projets.length,
        listes: projets.reduce((n, p) => n + listesDe(d, p.id).length, 0),
        taches: projets.reduce((n, p) => n + tachesVivantes(d, p.id).length, 0),
        partages: projets.filter(p => p.partage !== 'aucun').length,
      };
    }
    case 'projet': {
      const p = d.projets[id];
      return { projets: 1, listes: listesDe(d, id).length, taches: tachesVivantes(d, id).length, partages: vivant(p) && p.partage !== 'aucun' ? 1 : 0 };
    }
    case 'liste':
      return { projets: 0, listes: 1, taches: tachesVivantes(d).filter(t => t.listeId === id).length, partages: 0 };
    case 'tache':
      return { projets: 0, listes: 0, taches: 1 + sousTaches(d, id).length, partages: 0 };
  }
}

/** « 3 projets, 42 tâches » (ce que contient l'élément), ou « vide ». */
export function texteContenu(b: BilanSuppression, genre: Genre): string {
  const morceaux: string[] = [];
  if (genre === 'espace') morceaux.push(pluriel(b.projets, 'projet', 'projets'));
  if (genre === 'projet' && b.listes > 1) morceaux.push(pluriel(b.listes, 'liste', 'listes'));
  if (genre === 'tache') {
    if (b.taches > 1) morceaux.push(pluriel(b.taches - 1, 'sous-tâche', 'sous-tâches'));
  } else morceaux.push(pluriel(b.taches, 'tâche', 'tâches'));
  const texte = morceaux.filter(m => !m.startsWith('0 ')).join(', ');
  return texte || 'vide';
}

/** Le contenu peut-il être déplacé, et vers quoi ? */
export function ciblesDeplacement(d: DonneesTaches, genre: Genre, id: string): Array<{ id: string; nom: string }> {
  switch (genre) {
    case 'espace':
      return espacesVivants(d)
        .filter(e => e.id !== id)
        .map(e => ({ id: e.id, nom: e.nom }));
    case 'projet':
      return projetsDe(d)
        .filter(p => p.id !== id)
        .map(p => ({ id: p.id, nom: `${d.espaces[p.espaceId]?.nom ?? ''} › ${p.nom}` }));
    case 'liste': {
      const l = d.listes[id];
      return projetsDe(d).flatMap(p =>
        listesDe(d, p.id)
          .filter(x => x.id !== id)
          .map(x => ({ id: x.id, nom: p.id === l?.projetId ? x.nom : `${p.nom} › ${x.nom}` })),
      );
    }
    case 'tache':
      return [];
  }
}

// ------------------------------------------------------------------ Supprimer (et annuler)

/** Valeurs d'avant un déplacement : « Annuler » les remet. */
export interface Retour {
  c: Collection;
  id: string;
  valeurs: Record<string, unknown>;
}

export interface ResultatSuppression {
  donnees: DonneesTaches;
  genre: Genre;
  id: string;
  /** Espace « Personnel » recréé (le dernier espace a été supprimé). */
  cree?: string;
  /** Éléments déplacés avant la suppression (et leurs anciennes valeurs). */
  retours: Retour[];
  /** Texte de l'avis : « Espace « Travail » supprimé (3 projets, 42 tâches). » */
  texte: string;
}

function nomDe(d: DonneesTaches, genre: Genre, id: string): string {
  const e = d[COLLECTION[genre]][id] as (Entite & { nom?: string; titre?: string }) | undefined;
  return (genre === 'tache' ? e?.titre : e?.nom) ?? '';
}

function exigerFondateur(ctx: Contexte, genre: Genre) {
  if (ctx.auteur !== 'fondateur') throw new ErreurTaches(genre === 'espace' ? 'Seul le Fondateur supprime un espace.' : genre === 'projet' ? 'Seul le Fondateur supprime un projet.' : genre === 'liste' ? 'Seul le Fondateur supprime une liste.' : 'Seul le Fondateur gère la corbeille.');
}

/** Statut équivalent dans un autre projet : même identifiant, même nom, sinon premier ouvert (ou terminé). */
function statutEquivalent(d: DonneesTaches, t: Tache, versProjet: string): string {
  const cibles = statutsDe(d, versProjet);
  if (cibles.some(s => s.id === t.statut)) return t.statut;
  const actuel = statutsDe(d, t.projetId).find(s => s.id === t.statut);
  const memeNom = actuel && cibles.find(s => sansAccents(s.nom) === sansAccents(actuel.nom));
  if (memeNom) return memeNom.id;
  return (cibles.find(s => s.ferme === Boolean(actuel?.ferme)) ?? cibles[0]).id;
}

/** Listes et tâches d'un projet vers un autre (les listes gardent leur nom ; statuts équivalents). */
function deplacerContenuProjet(d: DonneesTaches, source: string, cible: string, ctx: Contexte, retours: Retour[]): DonneesTaches {
  if (!vivant(d.projets[cible]) || cible === source) throw new ErreurTaches('Projet de destination introuvable.');
  const listes = { ...d.listes };
  const taches = { ...d.taches };
  let ordre = Math.max(0, ...listesDe(d, cible).map(l => l.ordre));
  const deplacees = new Set<string>();
  for (const l of listesDe(d, source)) {
    retours.push({ c: 'listes', id: l.id, valeurs: { projetId: l.projetId, ordre: l.ordre } });
    listes[l.id] = changerChamps(l, { projetId: cible, ordre: ++ordre }, ctx);
    deplacees.add(l.id);
  }
  const nomCible = d.projets[cible].nom;
  for (const t of Object.values(d.taches)) {
    if (t.projetId !== source || !deplacees.has(t.listeId)) continue;
    const statut = statutEquivalent(d, t, cible);
    retours.push({ c: 'taches', id: t.id, valeurs: { projetId: t.projetId, statut: t.statut } });
    const suivante = changerChamps(t, { projetId: cible, statut }, ctx);
    taches[t.id] = t.supprime ? suivante : { ...suivante, historique: borneHistorique([...suivante.historique, evenement(ctx, `Déplacée vers le projet « ${nomCible} »`)]) };
  }
  return { ...d, listes, taches };
}

export interface OptionsSuppression {
  /** Déplacer d'abord le contenu vers cet espace / projet / liste. */
  deplacerVers?: string;
}

/**
 * Supprime un élément (vers la corbeille), après avoir déplacé son contenu si
 * demandé. Rend de quoi l'annuler (`annulerSuppression`).
 */
export function supprimerElement(d: DonneesTaches, genre: Genre, id: string, ctx: Contexte, o: OptionsSuppression = {}): ResultatSuppression {
  if (genre !== 'tache') exigerFondateur(ctx, genre);
  const e = d[COLLECTION[genre]][id];
  if (!vivant(e)) throw new ErreurTaches(`${LIBELLES_GENRE[genre]} introuvable.`);
  if (genre === 'tache' && ctx.auteur === 'ami' && modeProjet(d, (e as Tache).projetId) !== 'ecriture') throw new ErreurTaches('Ce projet n’est pas partagé en écriture avec vous.');
  const nom = nomDe(d, genre, id);
  const retours: Retour[] = [];
  let x = d;
  let deplace = '';
  if (o.deplacerVers) {
    const vers = o.deplacerVers;
    if (genre === 'espace') {
      if (!vivant(d.espaces[vers]) || vers === id) throw new ErreurTaches('Espace de destination introuvable.');
      for (const p of projetsDe(x, id)) {
        retours.push({ c: 'projets', id: p.id, valeurs: { espaceId: p.espaceId } });
        x = modifierProjet(x, p.id, { espaceId: vers }, ctx);
      }
      deplace = `contenu déplacé vers « ${d.espaces[vers].nom} »`;
    } else if (genre === 'projet') {
      x = deplacerContenuProjet(x, id, vers, ctx, retours);
      deplace = `contenu déplacé vers « ${d.projets[vers].nom} »`;
    } else if (genre === 'liste') {
      const l = d.listes[vers];
      if (!vivant(l) || vers === id || !vivant(d.projets[l.projetId])) throw new ErreurTaches('Liste de destination introuvable.');
      // Tâches principales d'abord (leurs sous-tâches suivent), puis ce qui reste.
      const aDeplacer = tachesVivantes(x).filter(t => t.listeId === id);
      for (const t of aDeplacer) retours.push({ c: 'taches', id: t.id, valeurs: { listeId: t.listeId, projetId: t.projetId, statut: t.statut } });
      for (const t of [...aDeplacer.filter(t => !t.parentId), ...aDeplacer.filter(t => t.parentId)]) {
        if (x.taches[t.id].listeId !== id) continue;
        x = modifierTache(x, t.id, { listeId: vers }, ctx);
      }
      deplace = `tâches déplacées vers « ${l.nom} »`;
    }
  }
  const contenu = texteContenu(bilanSuppression(x, genre, id), genre);
  switch (genre) {
    case 'espace':
      x = supprimerEspace(x, id, ctx);
      break;
    case 'projet':
      x = supprimerProjet(x, id, ctx);
      break;
    case 'liste':
      x = supprimerListe(x, id, ctx);
      break;
    case 'tache':
      x = supprimerTache(x, id, ctx);
      break;
  }
  let cree: string | undefined;
  if (genre === 'espace' && espacesVivants(x).length === 0) {
    const r = creerEspace(x, NOM_ESPACE_DEFAUT, ctx);
    x = r.donnees;
    cree = r.espace.id;
  }
  const quoi = genre === 'tache' ? `« ${nom} » supprimée` : `${LIBELLES_GENRE[genre]} « ${nom} » supprimé${genre === 'liste' ? 'e' : ''}`;
  const texte = `${quoi}${deplace ? ` (${deplace})` : contenu !== 'vide' ? ` (${contenu})` : ''}.`;
  return { donnees: x, genre, id, ...(cree ? { cree } : {}), retours, texte };
}

/** « Annuler » : restaure le lot, défait les déplacements, retire l'espace recréé s'il est resté vide. */
export function annulerSuppression(d: DonneesTaches, r: Pick<ResultatSuppression, 'genre' | 'id' | 'cree' | 'retours'>, ctx: Contexte): DonneesTaches {
  let x = restaurerElement(d, r.genre, r.id, ctx);
  for (const { c, id, valeurs } of [...r.retours].reverse()) {
    const e = x[c][id];
    if (!e) continue;
    x = { ...x, [c]: { ...x[c], [id]: changerChamps(e, valeurs, ctx) } };
  }
  if (r.cree) {
    const e = x.espaces[r.cree];
    if (vivant(e) && projetsDe(x, r.cree).length === 0) x = { ...x, espaces: { ...x.espaces, [r.cree]: changerChamps(e, { supprime: true, lot: r.cree, efface: true }, ctx) } };
  }
  return x;
}

// ------------------------------------------------------------------ Corbeille

/** Lot d'une pierre tombale (les suppressions de la V1 n'en ont pas : l'instant de suppression en tient lieu). */
const memeLot = (racine: Entite, e: Entite): boolean =>
  Boolean(e.supprime && !e.efface && (racine.lot ? e.lot === racine.lot : !e.lot && e.h.supprime !== undefined && instantDe(e.h.supprime) === instantDe(racine.h.supprime)));

function parentDe(d: DonneesTaches, genre: Genre, e: Entite): { genre: Genre; e: Entite | undefined } | undefined {
  switch (genre) {
    case 'espace':
      return undefined;
    case 'projet':
      return { genre: 'espace', e: d.espaces[(e as { espaceId: string } & Entite).espaceId] };
    case 'liste':
      return { genre: 'projet', e: d.projets[(e as { projetId: string } & Entite).projetId] };
    case 'tache': {
      const t = e as Tache;
      if (t.parentId) return { genre: 'tache', e: d.taches[t.parentId] };
      return { genre: 'liste', e: d.listes[t.listeId] };
    }
  }
}

/** Élément supprimé PAR L'UTILISATEUR (racine de son lot), pas emporté avec un autre. */
function estRacine(d: DonneesTaches, genre: Genre, e: Entite): boolean {
  if (!e.supprime || e.efface) return false;
  if (e.lot) return e.lot === e.id;
  // V1 : pas de lot. Racine si son parent est vivant, ou supprimé à un autre instant.
  const p = parentDe(d, genre, e);
  return !p || !p.e || !p.e.supprime || instantDe(p.e.h.supprime) !== instantDe(e.h.supprime);
}

export interface ElementCorbeille {
  genre: Genre;
  id: string;
  nom: string;
  /** Où il était : « Travail › Site web ». */
  ou: string;
  contenu: string;
  supprimeLe: number;
  /** Jours restants avant l'effacement automatique. */
  resteJours: number;
  /** Restaurable tout de suite ; sinon pourquoi (parent à restaurer d'abord). */
  restaurable: boolean;
  raison?: string;
}

function contenuDuLot(d: DonneesTaches, racine: Entite): BilanSuppression {
  const compter = (c: Collection) => Object.values(d[c]).filter(e => e.id !== racine.id && memeLot(racine, e)).length;
  return { projets: compter('projets'), listes: compter('listes'), taches: compter('taches'), partages: 0 };
}

function ouEtait(d: DonneesTaches, genre: Genre, e: Entite): string {
  switch (genre) {
    case 'espace':
      return '';
    case 'projet':
      return d.espaces[(e as { espaceId: string } & Entite).espaceId]?.nom ?? '';
    case 'liste': {
      const p = d.projets[(e as { projetId: string } & Entite).projetId];
      return [p && d.espaces[p.espaceId]?.nom, p?.nom].filter(Boolean).join(' › ');
    }
    case 'tache': {
      const t = e as Tache;
      return [d.projets[t.projetId]?.nom, d.listes[t.listeId]?.nom, t.parentId ? d.taches[t.parentId]?.titre : undefined].filter(Boolean).join(' › ');
    }
  }
}

/** Pourquoi on ne peut pas (encore) restaurer : le parent est lui-même à la corbeille. */
function obstacle(d: DonneesTaches, genre: Genre, e: Entite): string | undefined {
  const p = parentDe(d, genre, e);
  const pe: Entite | undefined = p?.e;
  if (!p || (pe && !pe.supprime)) return undefined;
  if (genre === 'projet') return undefined; // espace parti : le projet revient dans un autre espace.
  const nom = pe ? nomDe(d, p.genre, pe.id) : '';
  if (pe && !pe.efface) return `Restaurez d’abord ${p.genre === 'tache' ? 'la tâche' : p.genre === 'liste' ? 'la liste' : 'le projet'} « ${nom} ».`;
  return 'Son projet a été supprimé définitivement.';
}

/** Contenu de la corbeille (les plus récents d'abord), selon le rôle. */
export function elementsCorbeille(d: DonneesTaches, maintenant: number, role: 'fondateur' | 'ami' = 'fondateur'): ElementCorbeille[] {
  const r: ElementCorbeille[] = [];
  const genres: Genre[] = role === 'ami' ? ['tache'] : ['espace', 'projet', 'liste', 'tache'];
  for (const genre of genres) {
    for (const e of Object.values(d[COLLECTION[genre]]) as Entite[]) {
      if (!estRacine(d, genre, e)) continue;
      if (role === 'ami' && modeProjet(d, (e as Tache).projetId) !== 'ecriture') continue;
      const supprimeLe = instantDe(e.h.supprime);
      const date = Number.isFinite(supprimeLe) ? supprimeLe : maintenant;
      const raison = obstacle(d, genre, e);
      const lot = contenuDuLot(d, e);
      const contenu = texteContenu(genre === 'tache' ? { ...lot, taches: lot.taches + 1 } : lot, genre);
      r.push({
        genre,
        id: e.id,
        nom: nomDe(d, genre, e.id) || '(sans titre)',
        ou: ouEtait(d, genre, e),
        contenu: genre === 'tache' ? (contenu === 'vide' ? '' : contenu) : contenu,
        supprimeLe: date,
        resteJours: Math.max(0, Math.round((date + DUREE_CORBEILLE_MS - maintenant) / JOUR_MS)),
        restaurable: !raison,
        ...(raison ? { raison } : {}),
      });
    }
  }
  return r.sort((a, b) => b.supprimeLe - a.supprimeLe || a.id.localeCompare(b.id));
}

/** Restaure un élément de la corbeille et tout ce qui a été supprimé avec lui. */
export function restaurerElement(d: DonneesTaches, genre: Genre, id: string, ctx: Contexte): DonneesTaches {
  if (genre !== 'tache') exigerFondateur(ctx, genre);
  const racine = d[COLLECTION[genre]][id] as Entite | undefined;
  if (!racine || !racine.supprime || racine.efface) throw new ErreurTaches('Cet élément n’est plus dans la corbeille.');
  if (genre === 'tache' && ctx.auteur === 'ami' && modeProjet(d, (racine as Tache).projetId) !== 'ecriture') throw new ErreurTaches('Ce projet n’est pas partagé en écriture avec vous.');
  const raison = obstacle(d, genre, racine);
  if (raison) throw new ErreurTaches(raison);
  let x = d;
  // Projet dont l'espace n'existe plus : il revient dans le premier espace (recréé au besoin).
  let espaceId: string | undefined;
  if (genre === 'projet' && !vivant(d.espaces[(racine as { espaceId: string } & Entite).espaceId])) {
    espaceId = espacesVivants(x)[0]?.id;
    if (!espaceId) {
      const r = creerEspace(x, NOM_ESPACE_DEFAUT, ctx);
      x = r.donnees;
      espaceId = r.espace.id;
    }
  }
  const relever = { supprime: false, lot: undefined };
  for (const c of ['espaces', 'projets', 'listes', 'taches'] as const) {
    const suite = { ...x[c] } as Record<string, Entite>;
    let change = false;
    for (const e of Object.values(x[c]) as Entite[]) {
      if (e.id !== id && !memeLot(racine, e)) continue;
      let r = changerChamps(e, e.id === id && espaceId ? { ...relever, espaceId } : relever, ctx);
      if (c === 'taches') r = { ...(r as Tache), historique: borneHistorique([...(r as Tache).historique, evenement(ctx, 'Tâche restaurée')]) } as Tache;
      suite[e.id] = r;
      change = true;
    }
    if (change) x = { ...x, [c]: suite };
  }
  return x;
}

/** Descendants supprimés d'un élément (pour l'effacer avec lui). */
function descendantsSupprimes(d: DonneesTaches, genre: Genre, id: string): Array<[Collection, string]> {
  const r: Array<[Collection, string]> = [];
  const mort = (e: Entite) => e.supprime && !e.efface;
  if (genre === 'espace') {
    for (const p of Object.values(d.projets)) if (p.espaceId === id && mort(p)) r.push(['projets', p.id], ...descendantsSupprimes(d, 'projet', p.id));
  } else if (genre === 'projet') {
    for (const l of Object.values(d.listes)) if (l.projetId === id && mort(l)) r.push(['listes', l.id]);
    for (const t of Object.values(d.taches)) if (t.projetId === id && mort(t)) r.push(['taches', t.id]);
  } else if (genre === 'liste') {
    for (const t of Object.values(d.taches)) if (t.listeId === id && mort(t)) r.push(['taches', t.id]);
  } else {
    for (const t of Object.values(d.taches)) if (t.parentId === id && mort(t)) r.push(['taches', t.id]);
  }
  return r;
}

/**
 * Supprime définitivement (Fondateur) : le contenu des tâches est effacé et
 * tout est marqué `efface` — la pierre tombale reste, sans quoi un autre
 * appareil ferait revenir l'élément à la fusion.
 */
export function effacerElement(d: DonneesTaches, genre: Genre, id: string, ctx: Contexte): DonneesTaches {
  exigerFondateur(ctx, 'tache');
  const racine = d[COLLECTION[genre]][id] as Entite | undefined;
  if (!racine || !racine.supprime || racine.efface) return d;
  const cibles: Array<[Collection, string]> = [[COLLECTION[genre], id], ...descendantsSupprimes(d, genre, id)];
  let x = d;
  for (const [c, eid] of cibles) {
    const e = x[c][eid] as Entite;
    let r: Entite = changerChamps(e, c === 'taches' ? { efface: true, titre: '', description: '', etiquettes: [] } : { efface: true }, ctx);
    if (c === 'taches') r = { ...(r as Tache), checklist: {}, commentaires: {}, historique: [] } as Tache;
    x = { ...x, [c]: { ...x[c], [eid]: r } };
  }
  return x;
}

export function viderCorbeille(d: DonneesTaches, ctx: Contexte): DonneesTaches {
  let x = d;
  for (const e of elementsCorbeille(d, ctx.maintenant)) x = effacerElement(x, e.genre, e.id, ctx);
  return x;
}

/** Efface ce qui est à la corbeille depuis plus de 30 jours (rend `d` tel quel s'il n'y a rien). */
export function purgerCorbeille(d: DonneesTaches, ctx: Contexte): DonneesTaches {
  let x = d;
  for (const e of elementsCorbeille(d, ctx.maintenant)) if (ctx.maintenant - e.supprimeLe > DUREE_CORBEILLE_MS) x = effacerElement(x, e.genre, e.id, ctx);
  return x;
}

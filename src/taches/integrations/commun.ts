/**
 * Tâches (V2) : socle des liens avec les autres apps du hub.
 *
 * Chaque app reliée (Prospects, Abonnements, Portefeuille) décrit les tâches
 * qu'elle VEUT voir exister (`Voulue` : une clé stable par élément source,
 * un titre, une échéance) ; `synchroniserSource` les range dans un projet
 * « auto-géré » à son nom (espace « Applications »), sans doublon :
 * l'identifiant de la tâche est dérivé de l'app et de la clé (même tâche sur
 * tous les appareils, même créée des deux côtés à la fois). Une tâche déjà
 * créée n'est jamais réécrite (titre, notes, statut restent à l'utilisateur) ;
 * supprimée, elle ne revient pas ; quand l'élément source n'est plus à faire
 * (relance notée, abonnement payé), elle se termine toute seule si l'app le
 * demande. Ces projets ne se partagent pas : rien de ces apps n'est exposé à
 * l'ami (voir `projectionPourAmi`).
 *
 * Fondateur seulement : l'ami n'a ni ces apps ni ces liens.
 */

import {
  changerChamps,
  COULEURS,
  creerEspace,
  creerListe,
  creerProjet,
  creerTache,
  espacesVivants,
  estTerminee,
  modifierTache,
  statutsDe,
  vivant,
  type AppLiee,
  type Contexte,
  type DonneesTaches,
  type Echeance,
  type Entite,
  type Priorite,
} from '../modele';

export const NOMS_APPS: Record<AppLiee, string> = { prospects: 'Prospects', abonnements: 'Abonnements', portefeuille: 'Portefeuille', office: 'Claude Office' };
export const NOM_ESPACE_APPS = 'Applications';
const COULEUR_APP: Record<AppLiee, string> = { prospects: COULEURS[4], abonnements: COULEURS[3], portefeuille: COULEURS[1], office: COULEURS[2] };

/**
 * Lien activé dans les réglages de Tâches. Par défaut : Claude Office oui (il ne
 * crée rien tout seul : « ＋ Tâche » dans son Détail, et « En revue » quand
 * l'agent lié finit) ; les autres non (ils créent des tâches d'eux-mêmes).
 */
export const lienActif = (d: DonneesTaches, app: AppLiee): boolean => d.reglages.liens?.[app] ?? app === 'office';

/** Empreinte courte et stable (FNV-1a 32 bits, deux passes) : identifiant de tâche dérivé d'une clé source. */
function empreinte(texte: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/** Identifiant stable d'une tâche venue d'une app (« x » + app + empreinte de la clé). */
export const idSource = (app: AppLiee, cle: string): string => `x${app.slice(0, 2)}${empreinte(`${app}|${cle}`)}`.slice(0, 40);

/** Identifiants FIXES de l'espace, du projet et de la liste d'une app : deux appareils qui les créent en même temps n'en font qu'un. */
export const ID_ESPACE_APPS = 'e-applications';
export const idProjetAuto = (app: AppLiee) => `p-auto-${app}`;
export const idListeAuto = (app: AppLiee) => `l-auto-${app}`;

/** Remet en vie une entité de l'app (supprimée par l'utilisateur puis recréée par le lien). */
function relever<T extends Entite>(e: T, ctx: Contexte): T {
  return changerChamps(e, { supprime: false, lot: undefined, efface: undefined }, ctx);
}

/** Projet auto-géré de l'app (créé au besoin, dans l'espace « Applications »). */
export function projetAuto(d: DonneesTaches, app: AppLiee, ctx: Contexte): { donnees: DonneesTaches; projetId: string; listeId: string } {
  const pid = idProjetAuto(app);
  const lid = idListeAuto(app);
  if (vivant(d.projets[pid]) && vivant(d.listes[lid]) && d.listes[lid].projetId === pid) return { donnees: d, projetId: pid, listeId: lid };
  let x = d;
  // L'espace « Applications » (un espace vivant de ce nom, sinon le nôtre, recréé ou relevé).
  let espaceId = vivant(x.espaces[ID_ESPACE_APPS]) ? ID_ESPACE_APPS : espacesVivants(x).find(e => e.nom === NOM_ESPACE_APPS)?.id;
  if (!espaceId) {
    const ancien = x.espaces[ID_ESPACE_APPS];
    const e = ancien ? relever(ancien, ctx) : { ...creerEspace(x, NOM_ESPACE_APPS, ctx, COULEURS[7]).espace, id: ID_ESPACE_APPS };
    x = { ...x, espaces: { ...x.espaces, [ID_ESPACE_APPS]: e } };
    espaceId = ID_ESPACE_APPS;
  }
  // Le projet.
  const ancienP = x.projets[pid];
  if (!vivant(ancienP)) {
    const p = ancienP ? relever(changerChamps(ancienP, { espaceId }, ctx), ctx) : { ...creerProjet(x, espaceId, NOMS_APPS[app], ctx).projet, id: pid, couleur: COULEUR_APP[app], auto: app };
    if (!ancienP) p.h = { ...p.h, couleur: p.h.nom, auto: p.h.nom };
    x = { ...x, projets: { ...x.projets, [pid]: p } };
  }
  // Sa liste.
  const ancienneL = x.listes[lid];
  if (!vivant(ancienneL) || ancienneL.projetId !== pid) {
    const l = ancienneL ? relever(changerChamps(ancienneL, { projetId: pid }, ctx), ctx) : { ...creerListe(x, pid, 'À faire', ctx).liste, id: lid };
    x = { ...x, listes: { ...x.listes, [lid]: l } };
  }
  return { donnees: x, projetId: pid, listeId: lid };
}

export interface Voulue {
  /** Clé stable de l'élément source (une occurrence : « prospect|date »). */
  cle: string;
  titre: string;
  description?: string;
  echeance?: Echeance;
  priorite?: Priorite;
  etiquettes?: string[];
}

export interface BilanSource {
  donnees: DonneesTaches;
  creees: number;
  terminees: number;
}

/**
 * Range les tâches voulues par une app : crée celles qui manquent (jamais
 * deux fois : identifiant dérivé de la clé, et une tâche supprimée n'est pas
 * recréée) ; si `fermerAbsentes`, termine les tâches ouvertes de cette app
 * qui ne sont plus voulues. Rend `d` tel quel s'il n'y a rien à faire.
 */
export function synchroniserSource(d: DonneesTaches, app: AppLiee, voulues: readonly Voulue[], ctx: Contexte, o: { fermerAbsentes: boolean }): BilanSource {
  let x = d;
  let creees = 0;
  let terminees = 0;
  const cles = new Set(voulues.map(v => v.cle));
  const manquantes = voulues.filter(v => !x.taches[idSource(app, v.cle)]);
  if (manquantes.length) {
    const p = projetAuto(x, app, ctx);
    x = p.donnees;
    for (const v of manquantes) {
      const id = idSource(app, v.cle);
      if (x.taches[id]) continue;
      x = creerTache(
        x,
        {
          titre: v.titre,
          listeId: p.listeId,
          description: v.description ?? '',
          ...(v.echeance ? { echeance: v.echeance } : {}),
          ...(v.priorite ? { priorite: v.priorite } : {}),
          etiquettes: v.etiquettes ?? [],
          source: { app, cle: v.cle },
        },
        ctx,
        id,
      ).donnees;
      creees++;
    }
  }
  if (o.fermerAbsentes) {
    for (const t of Object.values(x.taches)) {
      if (t.source?.app !== app || cles.has(t.source.cle) || !vivant(t) || !vivant(x.projets[t.projetId]) || estTerminee(x, t)) continue;
      const ferme = statutsDe(x, t.projetId).find(s => s.ferme);
      if (!ferme) continue;
      x = modifierTache(x, t.id, { statut: ferme.id }, ctx);
      x = { ...x, taches: { ...x.taches, [t.id]: { ...x.taches[t.id], historique: [...x.taches[t.id].historique.slice(0, -1), { ...x.taches[t.id].historique.at(-1)!, texte: `Terminée : plus rien à faire dans ${NOMS_APPS[app]}` }] } } };
      terminees++;
    }
  }
  return { donnees: x, creees, terminees };
}

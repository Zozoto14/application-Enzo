/**
 * Tâches : synchronisation par le relais, chiffrée de bout en bout.
 *
 * Aucun nouvel objet que les membres écrivent, aucun changement du relais :
 * on réutilise les mécanismes existants (voir docs/taches.md).
 *
 *  1. Appareils du Fondateur : `p/principal/boite/taches`, ses données
 *     entières scellées par SA clé de synchronisation (`cleDerivee('synchro')`,
 *     comme `admin`). Fusion champ par champ (`fusion.ts`).
 *  2. Fondateur → chaque membre : `p/<membre>/boite/taches` (écrit par le jeton
 *     maître SEUL : le relais refuse qu'un jeton de profil écrive un nom qui
 *     n'est pas à lui), scellé pour la clé PUBLIQUE de réception du membre
 *     (celle de Tsuzuku, `tsuzuku-cle` : ECIES X25519 + XChaCha20-Poly1305,
 *     usage lié à l'identifiant du membre). Contenu : les SEULS projets que ce
 *     membre voit (leurs listes et tâches, pierres tombales comprises), son
 *     droit sur chacun, les prénoms des personnes de ces projets, sa clé de
 *     membre et la clé de partage de chacun de ces projets (V3).
 *  3. Membre → Fondateur : le champ `taches` de son retour `compte` (objet
 *     qu'il écrit déjà), scellé par sa clé de membre ; à l'intérieur, ce qu'il
 *     a fait dans chaque projet est scellé par la clé de CE projet (V3). Le
 *     Fondateur revérifie tout (droit du membre sur le projet, liste du même
 *     projet, auteur des commentaires et du temps) et fusionne ; il ne prend
 *     jamais d'un membre un partage, une suppression de projet ou de liste, ni
 *     un champ réservé (source d'une autre app, sessions liées, minuteur d'un
 *     autre, lien GitHub).
 *
 * Budget d'écritures KV : rien n'est déposé sans changement (empreintes), et
 * jamais deux dépôts du même objet à moins de 30 s (les changements
 * intermédiaires partent avec le suivant). Une frappe ne fait pas de dépôt :
 * l'app n'enregistre un texte qu'à la validation, et le tour des comptes ne
 * part que ~5 s après la dernière écriture. Chaque membre ne reçoit un dépôt
 * que si SA projection a changé.
 */

import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { aleatoireParDefaut, type SourceAleatoire } from '../securite/aleatoire';
import { ouvrirDepot, scellerPourAdmin, utf8DepuisOctets } from '../securite/sequestre';
import { ouvrirEnveloppe, sceller, type Enveloppe } from '../sync/relais/chiffrement';
import { publieParAdmin, type Espaces } from '../sync/relais/espaces';
import { empreinte } from '../sync/relais/fusionLww';
import { lireDocumentCle, OBJET_CLE, paireDe } from '../tsuzuku/plateforme/partage';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { fusionnerDonnees, fusionnerEntite, fusionnerProjet, fusionnerTache, memesDonnees } from './fusion';
import { assurerClesProjets, codeMembre, droitDe, listeMembres, membresDuProjet, modeDuDroit, peutEcrire, type Membre } from './membres';
import {
  donneesVides,
  ecrireDonnees,
  hValide,
  lireDonnees,
  lireJournal,
  lireListe,
  lireProjet,
  lireTache,
  MOTIF_CHAMP_CHRONO,
  suffixeAuteur,
  vivant,
  type Auteur,
  type DonneesTaches,
  type EntreeJournal,
  type Liste,
  type ModePartage,
  type Projet,
  type Tache,
} from './modele';

export const CLES_TACHES = {
  /** Données du Fondateur (sa base chiffrée). */
  donnees: 'taches.donnees',
  /** Copie d'un membre : projets partagés avec lui + ses modifications. */
  copie: 'taches.copie',
  /** Rappels déjà déclenchés et non lus (appareil). */
  rappels: 'taches.rappels',
  /** Préférences d'affichage (vue, projet ouvert…) de l'appareil. */
  affichage: 'taches.affichage',
  /** Identifiant de l'appareil (« un appareil seulement » pour les notifications du système). */
  appareil: 'taches.appareil',
  /** Clé de l'API Claude et jeton GitHub du Fondateur (base chiffrée de CET appareil, jamais synchronisés). */
  secrets: 'taches.secrets',
  /** État des PR GitHub déjà lus (appareil). */
  github: 'taches.github',
} as const;

export const OBJET_TACHES = 'taches';
const ESPACE_ADMIN = 'principal';
export const DELAI_MIN_DEPOTS_MS = 30_000;
const usage = (id: string) => `taches|${id}`;
/** Données associées d'un paquet de projet : lié au projet et à son auteur (pas de rejeu ailleurs). */
const etiquettePaquet = (projetId: string, code: Auteur) => `tp|${projetId}|${code}`;

// ------------------------------------------------------------------ Copie d'un membre

export interface CopieAmi {
  v: 1;
  /** Prénoms affichés : le Fondateur, soi-même. */
  fondateur?: string;
  ami?: string;
  /** Mon code d'auteur (« ami » pour l'ami des V1/V2, sinon mon identifiant de compte). */
  moi?: Auteur;
  /** Prénoms des personnes de mes projets, par code d'auteur. */
  membres?: Record<string, string>;
  /** Ma clé de membre (hex) : scelle ce que je renvoie. */
  cle?: string;
  /** Clé de partage de chacun de mes projets (V3). */
  clesProjets?: Record<string, string>;
  donnees: DonneesTaches;
  recuLe?: string;
}

export const copieVide = (): CopieAmi => ({ v: 1, donnees: donneesVides() });
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^(?:ami|[a-z0-9]{6,16})$/;

function lireNoms(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r: Record<string, string> = {};
  for (const [c, n] of Object.entries(v as Record<string, unknown>).slice(0, 60)) if (CODE.test(c) && c !== 'fondateur' && typeof n === 'string') r[c] = n.slice(0, 40);
  return Object.keys(r).length ? r : undefined;
}
function lireCles(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r: Record<string, string> = {};
  for (const [p, c] of Object.entries(v as Record<string, unknown>).slice(0, 1000)) if (/^[a-z0-9-]{2,48}$/.test(p) && typeof c === 'string' && HEX64.test(c)) r[p] = c;
  return Object.keys(r).length ? r : undefined;
}

export function lireCopie(brut: string | null | undefined): CopieAmi {
  try {
    const o = brut ? (JSON.parse(brut) as Partial<CopieAmi>) : undefined;
    if (!o || o.v !== 1) return copieVide();
    const membres = lireNoms(o.membres);
    const cles = lireCles(o.clesProjets);
    return {
      v: 1,
      ...(typeof o.fondateur === 'string' ? { fondateur: o.fondateur.slice(0, 40) } : {}),
      ...(typeof o.ami === 'string' ? { ami: o.ami.slice(0, 40) } : {}),
      ...(typeof o.moi === 'string' && CODE.test(o.moi) && o.moi !== 'fondateur' ? { moi: o.moi } : {}),
      ...(membres ? { membres } : {}),
      ...(typeof o.cle === 'string' && HEX64.test(o.cle) ? { cle: o.cle } : {}),
      ...(cles ? { clesProjets: cles } : {}),
      donnees: lireDonnees(o.donnees),
      ...(typeof o.recuLe === 'string' ? { recuLe: o.recuLe } : {}),
    };
  } catch {
    return copieVide();
  }
}

/** Mode de partage d'un projet tel que le voit un membre (sa copie : `partage` porte SON droit). */
export const modeProjet = (d: DonneesTaches, projetId: string): ModePartage => {
  const p = d.projets[projetId];
  return vivant(p) ? p.partage : 'aucun';
};

// ------------------------------------------------------------------ Ce que reçoit un membre

export interface DocumentPourAmi {
  v: 1;
  /** Compte destinataire. */
  ami: string;
  amiNom?: string;
  fondateur?: string;
  cle: string;
  donnees: DonneesTaches;
  moi?: Auteur;
  membres?: Record<string, string>;
  clesProjets?: Record<string, string>;
}

/** Un projet tel qu'il part chez un membre : son droit dans `partage`, les droits des personnes du projet par code. */
function projetPour(d: DonneesTaches, p: Projet, compte: string): Projet {
  const droit = droitDe(d, p.id, compte);
  const acces = Object.fromEntries(membresDuProjet(d, p.id).map(m => [m.code, m.droit]));
  const r: Projet = { ...p, h: { ...p.h }, partage: modeDuDroit(droit) };
  if (Object.keys(acces).length) r.acces = acces;
  else delete r.acces;
  return r;
}

/**
 * Projets que ce membre voit (vivants, avec un droit), leurs listes et leurs
 * tâches — pierres tombales comprises, pour qu'il retire ce qui a été
 * supprimé (un projet mis à la corbeille part comme pierre tombale seule).
 * Rien d'autre : ni les autres projets, ni les vues, ni les objectifs, ni les
 * réglages (sauf SES réglages de notification), ni aucune clé d'autrui.
 */
export function projectionPourMembre(d: DonneesTaches, compte: string): DonneesTaches {
  const voit = (p: Projet) => !p.auto && droitDe(d, p.id, compte) !== 'aucun';
  const projets = Object.fromEntries(Object.values(d.projets).filter(p => vivant(p) && voit(p)).map(p => [p.id, projetPour(d, p, compte)]));
  const espaces = Object.fromEntries(
    Object.values(projets)
      .map(p => d.espaces[p.espaceId])
      .filter(vivant)
      .map(e => [e.id, e]),
  );
  const tombes = Object.fromEntries(Object.values(d.projets).filter(p => p.supprime && !p.efface && voit(p)).map(p => [p.id, projetPour(d, p, compte)]));
  const code = codeMembre(d, compte);
  const notif = code === 'ami' ? (d.reglages.notifA ? { valeur: d.reglages.notifA, h: d.reglages.h.notifA } : undefined) : d.reglages.notifsMembres?.[compte];
  return {
    v: 1,
    espaces,
    projets: { ...tombes, ...projets },
    listes: Object.fromEntries(Object.values(d.listes).filter(l => projets[l.projetId]).map(l => [l.id, l])),
    taches: Object.fromEntries(
      Object.values(d.taches)
        .filter(t => projets[t.projetId] && !t.source)
        .map(t => {
          // Les sessions de Claude Code liées restent chez le Fondateur.
          if (!t.liensOffice) return [t.id, t];
          const sans: Tache = { ...t, h: { ...t.h } };
          delete sans.liensOffice;
          delete sans.h.liensOffice;
          return [t.id, sans];
        }),
    ),
    vues: {},
    journal: Object.fromEntries(Object.values(d.journal ?? {}).filter(e => projets[e.projetId]).map(e => [e.id, e])),
    reglages: { id: 'reglages', h: notif?.h ? { notifA: notif.h } : {}, ...(notif?.valeur ? { notifA: notif.valeur } : {}) },
    objectifs: {},
  };
}

/** Compatibilité V1/V2 : la projection pour l'ami historique. */
export function projectionPourAmi(d: DonneesTaches): DonneesTaches {
  if (d.reglages.ami && d.reglages.cle) return projectionPourMembre(d, d.reglages.ami);
  // Sans ami désigné : la projection des V1/V2 (selon le mode de partage de chaque projet).
  const x = { ...d, reglages: { ...d.reglages, ami: 'amihistorique', cle: '0'.repeat(64) } };
  return projectionPourMembre(x, 'amihistorique');
}

/** Document complet pour un membre (sans sa clé publique : scellé ensuite). */
export function documentPourMembre(d: DonneesTaches, m: Membre, nomFondateur?: string): DocumentPourAmi {
  const donnees = projectionPourMembre(d, m.compte);
  const membres: Record<string, string> = {};
  for (const p of Object.values(donnees.projets)) for (const x of membresDuProjet(d, p.id)) membres[x.code] = x.nom;
  membres[m.code] = m.nom;
  const clesProjets = Object.fromEntries(
    Object.values(donnees.projets)
      .filter(p => vivant(p) && d.reglages.clesProjets?.[p.id])
      .map(p => [p.id, d.reglages.clesProjets![p.id].cle]),
  );
  return {
    v: 1,
    ami: m.compte,
    amiNom: m.nom,
    ...(nomFondateur ? { fondateur: nomFondateur } : {}),
    cle: m.cle!,
    donnees,
    moi: m.code,
    membres,
    clesProjets,
  };
}

/** Journal chez le membre : celui reçu, plus ses entrées pas encore renvoyées (projets en écriture). */
function journalRecu(copie: CopieAmi, recu: DonneesTaches, moi: Auteur): DonneesTaches['journal'] {
  const r = { ...recu.journal };
  for (const e of Object.values(copie.donnees.journal ?? {})) {
    const x = r[e.id];
    if (x) r[e.id] = x.h >= e.h ? x : e;
    else if (e.auteur === moi && modeProjet(recu, e.projetId) === 'ecriture') r[e.id] = e;
  }
  return r;
}

const estAdminChez = (d: DonneesTaches, projetId: string, moi: Auteur) => vivant(d.projets[projetId]) && d.projets[projetId].acces?.[moi] === 'admin';

/**
 * Le membre range ce qu'il reçoit : projets, espaces et listes tels que
 * publiés (le Fondateur en est maître ; s'il est admin d'un projet, ses
 * modifications pas encore renvoyées sont gardées, champ par champ) ;
 * tâches fusionnées avec les siennes ; une tâche qu'il a créée et pas encore
 * renvoyée est gardée si son projet est en écriture ; tout le reste (projet
 * retiré, accès retiré) disparaît.
 */
export function appliquerReception(copie: CopieAmi, doc: DocumentPourAmi): CopieAmi {
  const recu = lireDonnees(doc.donnees);
  const moi: Auteur = doc.moi ?? 'ami';
  const taches: Record<string, Tache> = {};
  for (const id of new Set([...Object.keys(recu.taches), ...Object.keys(copie.donnees.taches)])) {
    const a = copie.donnees.taches[id];
    const b = recu.taches[id];
    if (a && b) taches[id] = fusionnerTache(a, b);
    else if (b) taches[id] = b;
    else if (a && modeProjet(recu, a.projetId) === 'ecriture' && (vivant(recu.listes[a.listeId]) || copie.donnees.listes[a.listeId]?.projetId === a.projetId) && (recu.listes[a.listeId]?.projetId ?? a.projetId) === a.projetId) taches[id] = a;
  }
  // Admin d'un projet : ses changements du projet et de ses listes, pas encore renvoyés, restent.
  const projets = { ...recu.projets };
  const listes = { ...recu.listes };
  for (const p of Object.values(recu.projets)) {
    if (!estAdminChez(recu, p.id, moi)) continue;
    const local = copie.donnees.projets[p.id];
    if (local) {
      // Le droit et la liste des personnes restent ceux publiés par le Fondateur.
      const f = fusionnerProjet(local, p);
      const r: Projet = { ...f, partage: p.partage, h: { ...f.h } };
      if (p.acces) r.acces = p.acces;
      else delete r.acces;
      for (const c of ['partage', 'acces'] as const) {
        if (p.h[c]) r.h[c] = p.h[c];
        else delete r.h[c];
      }
      projets[p.id] = r;
    }
    for (const l of Object.values(copie.donnees.listes)) {
      if (l.projetId !== p.id) continue;
      const r = recu.listes[l.id];
      listes[l.id] = r ? fusionnerEntite(l, r) : l;
    }
  }
  const reglages = fusionnerEntite({ id: 'reglages', h: copie.donnees.reglages.h.notifA ? { notifA: copie.donnees.reglages.h.notifA } : {}, ...(copie.donnees.reglages.notifA ? { notifA: copie.donnees.reglages.notifA } : {}) }, recu.reglages);
  return {
    v: 1,
    ...(doc.fondateur ? { fondateur: doc.fondateur } : {}),
    ...(doc.amiNom ? { ami: doc.amiNom } : {}),
    moi,
    ...(doc.membres ? { membres: doc.membres } : {}),
    cle: doc.cle,
    ...(doc.clesProjets && Object.keys(doc.clesProjets).length ? { clesProjets: doc.clesProjets } : {}),
    donnees: { ...recu, projets, listes, taches, reglages, journal: journalRecu(copie, recu, moi) },
    ...(copie.recuLe ? { recuLe: copie.recuLe } : {}),
  };
}

// ------------------------------------------------------------------ Ce que renvoie un membre

/** Ce qu'un membre a fait dans UN projet (scellé par la clé de ce projet). */
export interface PaquetProjet {
  taches: Record<string, Tache>;
  journal?: Record<string, EntreeJournal>;
  /** Admin du projet : le projet (paramètres, statuts) et ses listes. */
  projet?: Projet;
  listes?: Record<string, Liste>;
}

export interface EnvoiAmi {
  v: 1;
  /** Format des V1/V2 (l'ami historique sur un appareil plus ancien). */
  taches: Record<string, Tache>;
  /** Ses réglages de notification (et leur horodatage), pour ses autres appareils. */
  notif?: { valeur: unknown; h: string };
  /** V1/V2 : ses entrées du journal du jour (projets en écriture). */
  journal?: Record<string, EntreeJournal>;
  /** V3 : paquets par projet (en clair ici ; scellés chacun par la clé du projet au moment d'envoyer). */
  projets?: Record<string, PaquetProjet>;
}

/** Une tâche porte-t-elle une trace de cet auteur (champ, élément, commentaire, temps, historique) ? */
export function toucheePar(t: Tache, qui: Auteur): boolean {
  const s = suffixeAuteur(qui);
  return (
    Object.values(t.h).some(h => h.endsWith(s)) ||
    Object.values(t.checklist).some(e => e.h.endsWith(s)) ||
    Object.values(t.commentaires).some(c => c.h.endsWith(s)) ||
    Object.values(t.temps ?? {}).some(e => e.h.endsWith(s)) ||
    t.historique.some(e => e.auteur === qui)
  );
}

/** Ce que le membre renvoie : ses traces dans les projets en écriture (V3 : par projet). */
export function envoiDeLAmi(copie: CopieAmi): EnvoiAmi {
  const moi: Auteur = copie.moi ?? 'ami';
  const s = suffixeAuteur(moi);
  const d = copie.donnees;
  const r = d.reglages;
  const notif = r.notifA && r.h.notifA?.endsWith(s) ? { notif: { valeur: r.notifA, h: r.h.notifA } } : {};
  const ecriture = (pid: string) => modeProjet(d, pid) === 'ecriture';
  const mesTaches = Object.values(d.taches).filter(t => ecriture(t.projetId) && toucheePar(t, moi));
  const monJournal = Object.values(d.journal ?? {}).filter(e => e.h.endsWith(s) && ecriture(e.projetId));
  if (!copie.clesProjets) {
    // Fondateur d'une version antérieure : format des V1/V2.
    const journal = Object.fromEntries(monJournal.map(e => [e.id, e]));
    return { v: 1, taches: Object.fromEntries(mesTaches.map(t => [t.id, t])), ...notif, ...(Object.keys(journal).length ? { journal } : {}) };
  }
  const projets: Record<string, PaquetProjet> = {};
  const paquet = (pid: string) => (projets[pid] ??= { taches: {} });
  for (const t of mesTaches) if (copie.clesProjets[t.projetId]) paquet(t.projetId).taches[t.id] = t;
  for (const e of monJournal) if (copie.clesProjets[e.projetId]) (paquet(e.projetId).journal ??= {})[e.id] = e;
  for (const p of Object.values(d.projets)) {
    if (!estAdminChez(d, p.id, moi) || !copie.clesProjets[p.id]) continue;
    if (Object.values(p.h).some(h => h.endsWith(s))) paquet(p.id).projet = p;
    for (const l of Object.values(d.listes)) if (l.projetId === p.id && Object.values(l.h).some(h => h.endsWith(s))) (paquet(p.id).listes ??= {})[l.id] = l;
  }
  return { v: 1, taches: {}, ...notif, ...(Object.keys(projets).length ? { projets } : {}) };
}

export interface BilanEnvoi {
  donnees: DonneesTaches;
  acceptees: number;
  refusees: number;
}

/** Une tâche peut-elle vivre (venant de ce membre) là où elle dit être ? */
function placeAutorisee(d: DonneesTaches, t: Tache, compte: string): boolean {
  const l = d.listes[t.listeId];
  if (!peutEcrire(droitDe(d, t.projetId, compte)) || !vivant(d.projets[t.projetId]) || !vivant(l) || l.projetId !== t.projetId) return false;
  if (t.parentId) {
    const parent = d.taches[t.parentId];
    if (!parent || parent.projetId !== t.projetId) return false;
  }
  return true;
}

/** Commentaires et temps d'un membre : seulement les siens (ceux des autres, tels qu'ils étaient). */
function seulementLesSiens(t: Tache, existante: Tache | undefined, code: Auteur): Tache {
  const garder = <E extends { auteur: Auteur; h: string }>(siens: Record<string, E>, avant: Record<string, E> | undefined) =>
    Object.fromEntries(Object.entries(siens).filter(([id, e]) => e.auteur === code || (avant?.[id] && avant[id].h === e.h)));
  return { ...t, commentaires: garder(t.commentaires, existante?.commentaires), temps: garder(t.temps ?? {}, existante?.temps) };
}

/** Champs que seul le Fondateur pose : ceux de l'existante sont gardés tels quels. */
function garderReserves(x: Tache, existante: Tache | undefined, code: Auteur): Tache {
  const y = { ...x, h: { ...x.h } } as Tache & Record<string, unknown>;
  const monChrono = code === 'ami' ? 'chronoA' : `chrono_${code}`;
  const reserves = new Set(['source', 'liensOffice', 'chronoF', 'github', 'chronoA', ...Object.keys(x).filter(c => MOTIF_CHAMP_CHRONO.test(c)), ...Object.keys(existante ?? {}).filter(c => MOTIF_CHAMP_CHRONO.test(c))]);
  reserves.delete(monChrono);
  for (const c of reserves) {
    const v = (existante as Record<string, unknown> | undefined)?.[c];
    if (v === undefined) {
      delete y[c];
      delete y.h[c];
    } else {
      y[c] = v;
      if (existante?.h[c]) y.h[c] = existante.h[c];
      else delete y.h[c];
    }
  }
  return y;
}

function appliquerTaches(d: DonneesTaches, brut: unknown, compte: string, code: Auteur, projetId: string | undefined, bilan: { acceptees: number; refusees: number }): DonneesTaches {
  let taches = d.taches;
  for (const valeur of Object.values(brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {}).slice(0, 5000)) {
    const lue = lireTache(valeur);
    if (!lue || (projetId && lue.projetId !== projetId)) {
      bilan.refusees++;
      continue;
    }
    const existante = d.taches[lue.id];
    if (existante && (!placeAutorisee(d, existante, compte) || (projetId && existante.projetId !== projetId))) {
      bilan.refusees++;
      continue;
    }
    const t = seulementLesSiens(lue, existante, code);
    const fusion = garderReserves(existante ? fusionnerTache(existante, t) : t, existante, code);
    if (!placeAutorisee(d, fusion, compte) || (projetId && fusion.projetId !== projetId)) {
      bilan.refusees++;
      continue;
    }
    taches = { ...taches, [lue.id]: fusion };
    bilan.acceptees++;
  }
  return taches === d.taches ? d : { ...d, taches };
}

function appliquerJournal(d: DonneesTaches, brut: unknown, compte: string, code: Auteur, projetId: string | undefined, bilan: { acceptees: number; refusees: number }): DonneesTaches {
  let journal = d.journal;
  const s = suffixeAuteur(code);
  for (const e of Object.values(lireJournal(brut))) {
    const existante = d.journal[e.id];
    if (e.auteur !== code || !e.h.endsWith(s) || (projetId && e.projetId !== projetId) || !peutEcrire(droitDe(d, e.projetId, compte)) || (existante && (existante.auteur !== code || existante.projetId !== e.projetId))) {
      bilan.refusees++;
      continue;
    }
    if (existante && existante.h >= e.h) continue;
    journal = { ...journal, [e.id]: e };
    bilan.acceptees++;
  }
  return journal === d.journal ? d : { ...d, journal };
}

/** Champs d'un projet qu'un admin du projet peut changer. */
const CHAMPS_ADMIN = new Set(['nom', 'couleur', 'description', 'icone', 'etiquettes', 'debut', 'fin', 'statuts']);

function appliquerAdmin(d: DonneesTaches, paquet: { projet?: unknown; listes?: unknown }, compte: string, projetId: string, bilan: { acceptees: number; refusees: number }): DonneesTaches {
  if (droitDe(d, projetId, compte) !== 'admin') {
    if (paquet.projet || paquet.listes) bilan.refusees++;
    return d;
  }
  let x = d;
  const p = d.projets[projetId];
  const recu = paquet.projet ? lireProjet(paquet.projet) : undefined;
  if (recu && recu.id === projetId && vivant(p)) {
    const f = fusionnerProjet(p, recu) as Projet & Record<string, unknown>;
    const r = { ...f, h: { ...f.h } } as Projet & Record<string, unknown>;
    for (const c of new Set([...Object.keys(f), ...Object.keys(p), ...Object.keys(f.h)])) {
      if (c === 'id' || c === 'h' || c === 'historique' || CHAMPS_ADMIN.has(c)) continue;
      const v = (p as unknown as Record<string, unknown>)[c];
      if (v === undefined) delete r[c];
      else r[c] = v;
      if (p.h[c]) r.h[c] = p.h[c];
      else delete r.h[c];
    }
    x = { ...x, projets: { ...x.projets, [projetId]: r as Projet } };
    bilan.acceptees++;
  } else if (paquet.projet) bilan.refusees++;
  for (const brut of Object.values(paquet.listes && typeof paquet.listes === 'object' ? (paquet.listes as Record<string, unknown>) : {}).slice(0, 200)) {
    const l = lireListe(brut);
    const existante = l ? x.listes[l.id] : undefined;
    if (!l || l.projetId !== projetId || (existante && existante.projetId !== projetId) || (!existante && l.supprime)) {
      bilan.refusees++;
      continue;
    }
    // Un admin ne supprime pas de liste (le Fondateur seul) : la suppression n'est pas reprise.
    const f = existante ? fusionnerEntite(existante, l) : l;
    const propre = existante ? { ...f, supprime: existante.supprime, lot: existante.lot, efface: existante.efface, h: { ...f.h, ...(existante.h.supprime ? { supprime: existante.h.supprime } : {}) } } : f;
    if (!existante?.supprime) delete (propre as Partial<Liste>).supprime;
    if (!existante?.lot) delete (propre as Partial<Liste>).lot;
    if (!existante?.efface) delete (propre as Partial<Liste>).efface;
    if (!existante?.h.supprime) delete propre.h.supprime;
    x = { ...x, listes: { ...x.listes, [l.id]: propre as Liste } };
    bilan.acceptees++;
  }
  return x;
}

/** Ouvre un paquet de projet (clé actuelle, ou la précédente pour qui a encore le droit) ; undefined si refusé. */
export function ouvrirPaquet(d: DonneesTaches, projetId: string, code: Auteur, compte: string, enveloppe: unknown): PaquetProjet | undefined {
  const cles = d.reglages.clesProjets?.[projetId];
  const env = enveloppe as Enveloppe;
  if (!cles || !env || typeof env !== 'object' || env.appareil !== etiquettePaquet(projetId, code)) return undefined;
  if (droitDe(d, projetId, compte) === 'aucun') return undefined;
  for (const cle of [cles.cle, cles.avant]) {
    if (!cle) continue;
    try {
      return ouvrirEnveloppe<PaquetProjet>(cle, env);
    } catch {
      // Essai suivant.
    }
  }
  return undefined;
}

/**
 * Le Fondateur applique ce qu'un membre renvoie (déjà ouvert avec la clé du
 * membre) : V3, paquet par paquet (chacun ouvert par la clé de son projet) ;
 * V1/V2, à plat (l'ami historique seulement). Seulement là où le membre a le
 * droit d'écrire (avant comme après la fusion), dans une liste du projet ;
 * seulement ses commentaires, son temps et ses entrées de journal.
 */
export function appliquerEnvoiMembre(d: DonneesTaches, envoi: unknown, compte: string): BilanEnvoi {
  const bilan = { acceptees: 0, refusees: 0 };
  const code = codeMembre(d, compte);
  const o = envoi && typeof envoi === 'object' ? (envoi as { taches?: unknown; journal?: unknown; projets?: unknown; scelles?: unknown; notif?: { valeur?: unknown; h?: unknown } }) : {};
  let x = d;
  // V1/V2 à plat : l'ami historique seulement (appareil pas encore à jour).
  if (code === 'ami') {
    x = appliquerTaches(x, o.taches, compte, code, undefined, bilan);
    x = appliquerJournal(x, o.journal, compte, code, undefined, bilan);
  } else if ((o.taches && Object.keys(o.taches as object).length) || o.journal) bilan.refusees++;
  // V3 : un paquet scellé par projet.
  for (const [pid, env] of Object.entries(o.scelles && typeof o.scelles === 'object' ? (o.scelles as Record<string, unknown>) : {}).slice(0, 1000)) {
    const paquet = ouvrirPaquet(x, pid, code, compte, env);
    if (!paquet) {
      bilan.refusees++;
      continue;
    }
    x = appliquerAdmin(x, paquet, compte, pid, bilan);
    x = appliquerTaches(x, paquet.taches, compte, code, pid, bilan);
    x = appliquerJournal(x, paquet.journal, compte, code, pid, bilan);
  }
  // Réglages de notification : gardés pour ses autres appareils (le plus récent gagne).
  const n = o.notif;
  if (n && hValide(n.h) && n.h.endsWith(suffixeAuteur(code)) && n.valeur && typeof n.valeur === 'object' && JSON.stringify(n.valeur).length < 8000) {
    if (code === 'ami') {
      if (n.h > (x.reglages.h.notifA ?? '')) x = { ...x, reglages: { ...x.reglages, notifA: n.valeur, h: { ...x.reglages.h, notifA: n.h } } };
    } else if (n.h > (x.reglages.notifsMembres?.[compte]?.h ?? '') && x.reglages.membres?.[compte]) {
      x = { ...x, reglages: { ...x.reglages, notifsMembres: { ...(x.reglages.notifsMembres ?? {}), [compte]: { valeur: n.valeur, h: n.h } }, h: { ...x.reglages.h, notifsMembres: n.h.replace(/\|.*$/, '|f') } } };
    }
  }
  return { donnees: x, ...bilan };
}

/** Compatibilité : l'ami historique. */
export const appliquerEnvoiAmi = (d: DonneesTaches, envoi: unknown): BilanEnvoi => (d.reglages.ami ? appliquerEnvoiMembre(d, envoi, d.reglages.ami) : { donnees: d, acceptees: 0, refusees: 0 });

// ------------------------------------------------------------------ Scellement

export function scellerPourAmi(publique: string, id: string, doc: DocumentPourAmi, alea?: SourceAleatoire): string {
  return JSON.stringify({ v: 1, cle: publique, depot: scellerPourAdmin(publique, utf8ToBytes(JSON.stringify(doc)), usage(id), alea) });
}

export function ouvrirPourAmi(privee: string, id: string, charge: string): DocumentPourAmi {
  const o = JSON.parse(charge) as { depot?: unknown };
  if (typeof o.depot !== 'string') throw new Error('Dépôt de tâches illisible.');
  const doc = JSON.parse(utf8DepuisOctets(ouvrirDepot(hexToBytes(privee), o.depot, usage(id)))) as Partial<DocumentPourAmi>;
  if (doc.v !== 1 || doc.ami !== id || typeof doc.cle !== 'string' || !HEX64.test(doc.cle)) throw new Error('Dépôt de tâches d’un autre compte.');
  const membres = lireNoms(doc.membres);
  const cles = lireCles(doc.clesProjets);
  return {
    v: 1,
    ami: id,
    cle: doc.cle,
    donnees: lireDonnees(doc.donnees),
    ...(typeof doc.amiNom === 'string' ? { amiNom: doc.amiNom } : {}),
    ...(typeof doc.fondateur === 'string' ? { fondateur: doc.fondateur } : {}),
    ...(typeof doc.moi === 'string' && CODE.test(doc.moi) && (doc.moi === 'ami' || doc.moi === id) ? { moi: doc.moi } : {}),
    ...(membres ? { membres } : {}),
    ...(cles ? { clesProjets: cles } : {}),
  };
}

/** Scelle un envoi : chaque paquet de projet par la clé du projet, le tout par la clé du membre. */
export function scellerEnvoi(cle: string, envoi: EnvoiAmi, date: string, alea?: SourceAleatoire, clesProjets: Record<string, string> = {}, moi: Auteur = 'ami'): Enveloppe {
  const { projets, ...reste } = envoi;
  const scelles: Record<string, Enveloppe> = {};
  for (const [pid, paquet] of Object.entries(projets ?? {})) {
    const k = clesProjets[pid];
    if (k) scelles[pid] = sceller(k, paquet, etiquettePaquet(pid, moi), date, alea);
  }
  return sceller(cle, Object.keys(scelles).length ? { ...reste, scelles } : reste, 'taches-ami', date, alea);
}
export const ouvrirEnvoi = (cle: string, enveloppe: unknown): unknown => ouvrirEnveloppe<unknown>(cle, enveloppe as Enveloppe);

const plusTard = (depuis: string | undefined, maintenant: string) => !depuis || Date.parse(maintenant) - Date.parse(depuis) >= DELAI_MIN_DEPOTS_MS || Date.parse(maintenant) < Date.parse(depuis);

// ------------------------------------------------------------------ Tour du Fondateur

/** Ce que le Fondateur retient d'un membre entre deux tours (rien de secret). */
export interface SuiviMembre {
  /** Empreinte publiée chez lui, clé publique vue (et sa date), date du dernier dépôt. */
  h?: string;
  cle?: string;
  cleDate?: string;
  depotLe?: string;
  depose?: string;
  /** Sa clé de réception n'est pas encore publiée (il n'a pas encore ouvert l'app). */
  attente?: boolean;
}

/** Ce que le Fondateur retient entre deux tours (rien de secret). */
export interface EtatTachesFondateur {
  /** Date du dépôt `taches` (principal) déjà lu ou écrit, et empreinte de ce qu'il contient. */
  lu?: string;
  publie?: string;
  depotLe?: string;
  /** V3 : chaque membre servi. */
  membres?: Record<string, SuiviMembre>;
  /** V1/V2 (repris dans `membres` au premier tour). */
  ami?: string;
  amiH?: string;
  amiCle?: string;
  amiCleDate?: string;
  amiDepotLe?: string;
  amiDepose?: string;
}

export interface OptionsTachesFondateur {
  espaces: Espaces;
  base: Pick<BasePrefs, 'lire' | 'ecrire'>;
  cleSynchro: string;
  etat: EtatTachesFondateur;
  /** Objets de l'espace `principal` (liste déjà lue). */
  objetsAdmin: Record<string, { date: string; auteur?: string }>;
  /** Objets de l'espace d'un compte (liste déjà lue si possible). */
  objetsCompte(id: string): Promise<Record<string, { date: string; auteur?: string }>>;
  /** Comptes encore présents dans l'annuaire. */
  comptes: ReadonlySet<string>;
  /** Champ `taches` des retours des membres lus à ce tour, par compte. */
  retours: Record<string, unknown>;
  /** Prénom affiché du Fondateur chez les membres. */
  nomFondateur?: string;
  maintenant: string;
  alea?: SourceAleatoire;
}

export interface BilanTaches {
  etat: EtatTachesFondateur;
  depots: number;
  change: boolean;
  /** Au moins un membre n'a pas encore publié sa clé de réception. */
  enAttente: boolean;
  /** Membres en attente de leur première ouverture (comptes). */
  attente: string[];
  erreurs: string[];
}

/** État des V1/V2 repris en V3. */
function migrerEtat(e: EtatTachesFondateur): EtatTachesFondateur {
  if (!e.ami) return e;
  const r: EtatTachesFondateur = { ...e, membres: { ...(e.membres ?? {}) } };
  r.membres![e.ami] ??= { h: e.amiH, cle: e.amiCle, cleDate: e.amiCleDate, depotLe: e.amiDepotLe, depose: e.amiDepose };
  delete r.ami;
  delete r.amiH;
  delete r.amiCle;
  delete r.amiCleDate;
  delete r.amiDepotLe;
  delete r.amiDepose;
  return r;
}

export async function synchroniserTachesFondateur(o: OptionsTachesFondateur): Promise<BilanTaches> {
  const etat: EtatTachesFondateur = migrerEtat({ ...o.etat });
  const bilan: BilanTaches = { etat, depots: 0, change: false, enAttente: false, attente: [], erreurs: [] };
  const brut = o.base.lire(CLES_TACHES.donnees);
  if (!brut && !o.objetsAdmin[OBJET_TACHES] && !Object.keys(etat.membres ?? {}).length) return bilan;
  const locales = lireDonnees(brut ?? undefined);
  let donnees = locales;

  // 1. Ce que les membres renvoient (scellé par leur clé de membre, puis par projet).
  for (const m of listeMembres(donnees)) {
    const retour = o.retours[m.compte];
    if (retour === undefined || !m.cle) continue;
    try {
      donnees = appliquerEnvoiMembre(donnees, ouvrirEnvoi(m.cle, retour), m.compte).donnees;
    } catch (erreur) {
      bilan.erreurs.push(`Tâches de ${m.nom} illisibles : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }

  // 2. Les autres appareils du Fondateur.
  const dateDistante = o.objetsAdmin[OBJET_TACHES]?.date;
  if (dateDistante && dateDistante !== etat.lu) {
    try {
      const objet = await o.espaces.lire(ESPACE_ADMIN, OBJET_TACHES);
      if (objet) {
        const distant = lireDonnees(ouvrirEnveloppe<unknown>(o.cleSynchro, JSON.parse(objet.charge) as Enveloppe));
        donnees = fusionnerDonnees(donnees, distant);
        etat.lu = objet.date;
        etat.publie = empreinte(distant);
      }
    } catch (erreur) {
      bilan.erreurs.push(`Tâches : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    }
  }
  // Chaque projet partagé a sa clé (créée ici si un appareil plus ancien a partagé sans).
  donnees = assurerClesProjets(donnees, { maintenant: Date.parse(o.maintenant), auteur: 'fondateur', aleaOctets: o.alea ?? aleatoireParDefaut });
  if (!memesDonnees(donnees, locales)) {
    o.base.ecrire(CLES_TACHES.donnees, ecrireDonnees(donnees));
    bilan.change = true;
  }
  const h = empreinte(donnees);
  if (h !== etat.publie && plusTard(etat.depotLe, o.maintenant)) {
    const date = dateDistante && dateDistante >= o.maintenant ? new Date(Date.parse(dateDistante) + 1).toISOString() : o.maintenant;
    await o.espaces.deposer(ESPACE_ADMIN, OBJET_TACHES, JSON.stringify(sceller(o.cleSynchro, donnees, OBJET_TACHES, date, o.alea)), date);
    etat.lu = date;
    etat.publie = h;
    etat.depotLe = o.maintenant;
    bilan.depots++;
  }

  // 3. Chaque membre : ses projets, scellés pour sa clé de réception.
  const membres = listeMembres(donnees).filter(m => o.comptes.has(m.compte) && m.cle);
  const servis = new Set(membres.map(m => m.compte));
  const suivis: Record<string, SuiviMembre> = { ...(etat.membres ?? {}) };
  for (const compte of Object.keys(suivis)) {
    if (servis.has(compte)) continue;
    // Ancien membre (retiré, ou compte supprimé) : son dépôt est effacé, il ne voit plus rien.
    try {
      await o.espaces.supprimer(compte, OBJET_TACHES);
      bilan.depots++;
      delete suivis[compte];
    } catch (erreur) {
      if (o.comptes.has(compte)) bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
      else delete suivis[compte];
    }
  }
  for (const m of membres) {
    const suivi: SuiviMembre = { ...(suivis[m.compte] ?? {}) };
    try {
      const objets = await o.objetsCompte(m.compte);
      const dateCle = objets[OBJET_CLE]?.date;
      if (dateCle && dateCle !== suivi.cleDate) {
        const doc = await o.espaces.lire(m.compte, OBJET_CLE);
        suivi.cle = lireDocumentCle(doc?.charge);
        suivi.cleDate = dateCle;
      } else if (!dateCle) {
        suivi.cle = undefined;
        suivi.cleDate = undefined;
      }
      const doc = documentPourMembre(donnees, m, o.nomFondateur);
      const hMembre = empreinte([doc, suivi.cle ?? '']);
      const meta = objets[OBJET_TACHES];
      // Effacé ou réécrit par un autre que le Fondateur : republié.
      const altere = suivi.depose !== undefined && (!meta || !publieParAdmin(meta.auteur));
      if (!suivi.cle) {
        suivi.attente = true;
        bilan.enAttente = true;
        bilan.attente.push(m.compte);
      } else {
        delete suivi.attente;
        if ((hMembre !== suivi.h || altere) && plusTard(suivi.depotLe, o.maintenant)) {
          await o.espaces.deposer(m.compte, OBJET_TACHES, scellerPourAmi(suivi.cle, m.compte, doc, o.alea), o.maintenant);
          suivi.h = hMembre;
          suivi.depotLe = o.maintenant;
          suivi.depose = o.maintenant;
          bilan.depots++;
        }
      }
    } catch (erreur) {
      bilan.erreurs.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
    suivis[m.compte] = suivi;
  }
  etat.membres = suivis;
  return bilan;
}

// ------------------------------------------------------------------ Tour d'un membre

export interface SuiviTachesAmi {
  /** Date du dépôt reçu déjà lu. */
  lu?: string;
  /** Empreinte de l'envoi déjà déposé, et date du dépôt. */
  envoye?: string;
  envoiLe?: string;
}

export interface EnvoiPret {
  h: string;
  /** Scelle l'envoi (nouvelle enveloppe, nouveaux nonces). */
  sceller(date: string): Enveloppe;
  /** Le délai minimal entre deux envois est écoulé. */
  permis: boolean;
}

/**
 * Le membre reçoit ses projets (s'ils ont changé) et prépare ce qu'il
 * renvoie. Rien n'est écrit sur le relais ici : l'envoi part dans le retour
 * `compte` (voir `synchroniserCompteAmi`).
 */
export async function recevoirTachesAmi(o: {
  espaces: Espaces;
  id: string;
  base: BasePrefs;
  objets: Record<string, { date: string; auteur?: string }>;
  suivi: SuiviTachesAmi;
  maintenant: string;
  alea?: SourceAleatoire;
}): Promise<{ suivi: SuiviTachesAmi; change: boolean; envoi?: EnvoiPret }> {
  const suivi = { ...o.suivi };
  let change = false;
  const brut = o.base.lire(CLES_TACHES.copie);
  let copie = lireCopie(brut);
  const date = o.objets[OBJET_TACHES]?.date;
  if (date && date !== suivi.lu) {
    const objet = await o.espaces.lire(o.id, OBJET_TACHES);
    // Seul un dépôt du Fondateur (jeton maître) est cru.
    if (objet && publieParAdmin(objet.auteur)) {
      try {
        const paire = paireDe(o.base, o.alea);
        const doc = ouvrirPourAmi(paire.privee, o.id, objet.charge);
        copie = { ...appliquerReception(copie, doc), recuLe: objet.date };
        suivi.lu = date;
      } catch {
        // Scellé pour une autre clé (autre appareil du membre) : le Fondateur republiera pour la clé déposée.
      }
    } else {
      suivi.lu = date;
    }
  } else if (!date && (Object.keys(copie.donnees.projets).length > 0 || copie.cle)) {
    // Plus rien n'est partagé avec ce compte (ou il n'est plus membre).
    copie = copieVide();
    suivi.lu = undefined;
  }
  const texte = JSON.stringify(copie);
  if (texte !== (brut ?? JSON.stringify(copieVide()))) {
    o.base.ecrire(CLES_TACHES.copie, texte);
    change = true;
  }
  const envoi = envoiDeLAmi(copie);
  if (!copie.cle || (Object.keys(envoi.taches).length === 0 && !envoi.notif && !envoi.journal && !envoi.projets)) return { suivi, change };
  const cle = copie.cle;
  const cles = copie.clesProjets ?? {};
  const moi = copie.moi ?? 'ami';
  const h = empreinte(envoi);
  if (h === suivi.envoye) return { suivi, change };
  return { suivi, change, envoi: { h, sceller: d => scellerEnvoi(cle, envoi, d, o.alea, cles, moi), permis: plusTard(suivi.envoiLe, o.maintenant) } };
}

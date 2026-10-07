/**
 * Sources Tsuzuku du compte (Fondateur) entre SES appareils.
 *
 * Avant, les sources, leur partage, leur dernier test et les clés d'API ne
 * vivaient que dans la base de l'appareil où on les avait saisies : la synchro
 * « latest wins » ne connaissait que le portefeuille et les préférences du
 * hub. Elles deviennent des entités du genre `tsuzuku`, une par source :
 *
 *  - `tsuzuku:source:<id>`  → définition (liste, état activé) ;
 *  - `tsuzuku:partage:<id>` → partage de la source ;
 *  - `tsuzuku:test:<id>`    → dernier test ;
 *  - `tsuzuku:ordre`        → ordre de la liste (identifiants) ;
 *  - `tsuzuku:avance`       → clés d'API et options du moteur.
 *
 * Fusion : dernier gagnant PAR SOURCE (deux appareils qui modifient deux
 * sources différentes gardent les deux) ; une suppression voyage comme
 * pierre tombale datée (`supprimes` du moteur), donc une source supprimée ne
 * renaît pas. Tout part dans la charge scellée par `cleDerivee('synchro')` :
 * le relais ne voit jamais une clé d'API ni une adresse de source en clair.
 * Chaque entité reçue est revalidée (adresse publique, sélecteurs, bornes).
 */

import { ecrireAvances, ecrirePartages, ecrireTests, lireAvances, lireListeSources, lirePartages, lireTests } from '../../tsuzuku/app/gestion';
import { importerSources, type DefinitionSource } from '../../tsuzuku/moteur/sources';
import { CLES as CLES_TSUZUKU } from '../../tsuzuku/plateforme/stockage';

/** Clés de paramètres (base du profil) portées par ces entités. */
export const CLES_TSUZUKU_SYNCHRONISEES: readonly string[] = [CLES_TSUZUKU.sources, CLES_TSUZUKU.partages, CLES_TSUZUKU.testsSources, CLES_TSUZUKU.avance];

export interface AccesParametres {
  lire(cle: string): string | undefined | null;
  ecrire(cle: string, valeur: string): void;
}

const ID_ORDRE = 'ordre';
const ID_AVANCE = 'avance';

/** Entités `tsuzuku:*` de la base (vide si le profil n'a rien). */
export function entitesTsuzuku(lire: AccesParametres['lire']): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  const sources = lireListeSources(lire(CLES_TSUZUKU.sources));
  for (const s of sources) sortie[`tsuzuku:source:${s.id}`] = JSON.parse(JSON.stringify(s));
  if (sources.length) sortie[`tsuzuku:${ID_ORDRE}`] = sources.map(s => s.id);
  for (const [id, p] of Object.entries(lirePartages(lire(CLES_TSUZUKU.partages)))) sortie[`tsuzuku:partage:${id}`] = p;
  for (const [id, t] of Object.entries(lireTests(lire(CLES_TSUZUKU.testsSources)))) sortie[`tsuzuku:test:${id}`] = t;
  const avance = lire(CLES_TSUZUKU.avance);
  if (avance) sortie[`tsuzuku:${ID_AVANCE}`] = JSON.parse(ecrireAvances(lireAvances(avance)));
  return sortie;
}

function decouperId(id: string): { quoi: string; cle: string } {
  const i = id.indexOf(':');
  return i < 0 ? { quoi: id, cle: '' } : { quoi: id.slice(0, i), cle: id.slice(i + 1) };
}

/** Range une liste en suivant `ordre` (les inconnues gardent leur place relative, à la fin). */
function ranger(liste: DefinitionSource[], ordre: readonly string[]): DefinitionSource[] {
  const rang = (id: string) => {
    const i = ordre.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return liste.map((s, i) => ({ s, i })).sort((a, b) => rang(a.s.id) - rang(b.s.id) || a.i - b.i).map(x => x.s);
}

/**
 * Écrit une entité reçue d'un autre appareil du compte. `false` : valeur
 * invalide (adresse non publique, forme inconnue) — rien n'est écrit.
 */
export function ecrireEntiteTsuzuku(base: AccesParametres, id: string, valeur: unknown): boolean {
  const { quoi, cle } = decouperId(id);
  switch (quoi) {
    case 'source': {
      const lue = importerSources([valeur]).sources[0];
      if (!lue || lue.id !== cle) return false;
      const liste = lireListeSources(base.lire(CLES_TSUZUKU.sources));
      const existe = liste.some(s => s.id === cle);
      const suite = existe ? liste.map(s => (s.id === cle ? lue : s)) : [...liste, lue];
      base.ecrire(CLES_TSUZUKU.sources, JSON.stringify(suite));
      return true;
    }
    case ID_ORDRE: {
      if (!Array.isArray(valeur) || !valeur.every(v => typeof v === 'string')) return false;
      const liste = lireListeSources(base.lire(CLES_TSUZUKU.sources));
      base.ecrire(CLES_TSUZUKU.sources, JSON.stringify(ranger(liste, valeur as string[])));
      return true;
    }
    case 'partage': {
      const lu = lirePartages(JSON.stringify({ [cle]: valeur }))[cle];
      if (!lu) return false;
      base.ecrire(CLES_TSUZUKU.partages, ecrirePartages({ ...lirePartages(base.lire(CLES_TSUZUKU.partages)), [cle]: lu }));
      return true;
    }
    case 'test': {
      const lu = lireTests(JSON.stringify({ [cle]: valeur }))[cle];
      if (!lu) return false;
      base.ecrire(CLES_TSUZUKU.testsSources, ecrireTests({ ...lireTests(base.lire(CLES_TSUZUKU.testsSources)), [cle]: lu }));
      return true;
    }
    case ID_AVANCE: {
      if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false;
      base.ecrire(CLES_TSUZUKU.avance, ecrireAvances(lireAvances(JSON.stringify(valeur))));
      return true;
    }
    default:
      return false;
  }
}

/** Applique une suppression (pierre tombale) venue d'un autre appareil. */
export function supprimerEntiteTsuzuku(base: AccesParametres, id: string): void {
  const { quoi, cle } = decouperId(id);
  if (quoi === 'source') {
    const liste = lireListeSources(base.lire(CLES_TSUZUKU.sources));
    if (liste.some(s => s.id === cle)) base.ecrire(CLES_TSUZUKU.sources, JSON.stringify(liste.filter(s => s.id !== cle)));
  } else if (quoi === 'partage') {
    const p = lirePartages(base.lire(CLES_TSUZUKU.partages));
    if (cle in p) {
      delete p[cle];
      base.ecrire(CLES_TSUZUKU.partages, ecrirePartages(p));
    }
  } else if (quoi === 'test') {
    const t = lireTests(base.lire(CLES_TSUZUKU.testsSources));
    if (cle in t) {
      delete t[cle];
      base.ecrire(CLES_TSUZUKU.testsSources, ecrireTests(t));
    }
  }
  // `ordre` et `avance` ne se suppriment pas (une liste vide garde ses réglages).
}

// ------------------------------------------------------------------ Pastille « synchronisé / en attente »

export type EtatPastille = 'synchronise' | 'en-attente' | 'non-configuree';

/**
 * État de synchro des sources, lu dans la base du profil sans rien écrire :
 * « en attente » si une entité `tsuzuku:*` a changé depuis le dernier tour ou
 * attend dans la file d'envoi ; « synchronisé » sinon.
 */
export function etatPastilleTsuzuku(
  lire: AccesParametres['lire'],
  cles: { relais: string; etat: string },
  empreinte: (v: unknown) => string,
): { etat: EtatPastille; depuis?: string } {
  if (!lire(cles.relais)) return { etat: 'non-configuree' };
  let etat: { connus?: Record<string, string>; enAttente?: { cles?: string[] }; derniereSynchro?: string } = {};
  try {
    etat = JSON.parse(lire(cles.etat) ?? '{}') ?? {};
  } catch {
    etat = {};
  }
  const connus = etat.connus ?? {};
  const locales = entitesTsuzuku(lire);
  const change =
    Object.entries(locales).some(([cle, v]) => connus[cle] !== empreinte(v)) ||
    Object.keys(connus).some(cle => cle.startsWith('tsuzuku:') && !(cle in locales)) ||
    (etat.enAttente?.cles ?? []).some(cle => cle.startsWith('tsuzuku:'));
  return change ? { etat: 'en-attente' } : { etat: 'synchronise', depuis: etat.derniereSynchro };
}

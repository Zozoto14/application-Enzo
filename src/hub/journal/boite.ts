/**
 * Boîte du journal : l'entrée des apps qui n'ont pas (encore) de source.
 *
 * Une app dépose un événement du jour (`deposerEvenementJournal`) au moment où
 * il a lieu — une décision enregistrée par le coach, la météo du jour — et le
 * journal l'y retrouve le soir (`lireBoite`). Aucune dépendance entre les deux
 * apps : seul le contrat `EvenementJournal` est partagé. Les événements sont
 * rangés par mois dans la base chiffrée du profil, bornés, dédoublonnés par
 * identifiant, jamais envoyés sur le relais.
 */

import { FAMILLES, GENRES, type EvenementJournal, type FamilleEvenement, type GenreEvenement } from './contrat';

export interface BaseBoite {
  lire(cle: string): string | undefined | null;
  ecrire(cle: string, valeur: string): void;
}

export const PREFIXE_BOITE = 'journal.boite.';
export const MAX_PAR_MOIS = 600;
export const SOURCE_BOITE = 'boite';

const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const MOTIF_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const texte = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const nombre = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Événement revalidé (tout ce qui vient de la base ou d'une autre app passe par là). */
export function evenementValide(brut: unknown): EvenementJournal | undefined {
  const o = brut as Partial<EvenementJournal> | null;
  if (!o || typeof o !== 'object') return undefined;
  const id = texte(o.id, 80);
  const titre = texte(o.titre, 300);
  if (!id || !titre || typeof o.jour !== 'string' || !MOTIF_JOUR.test(o.jour)) return undefined;
  const famille: FamilleEvenement = (FAMILLES as readonly unknown[]).includes(o.famille) ? (o.famille as FamilleEvenement) : 'autre';
  const genre: GenreEvenement = (GENRES as readonly unknown[]).includes(o.genre) ? (o.genre as GenreEvenement) : 'autre';
  const poids = nombre(o.poids);
  return {
    id,
    source: texte(o.source, 40) || SOURCE_BOITE,
    famille,
    genre,
    jour: o.jour,
    ...(typeof o.heure === 'string' && MOTIF_HEURE.test(o.heure) ? { heure: o.heure } : {}),
    titre,
    ...(texte(o.detail, 600) ? { detail: texte(o.detail, 600) } : {}),
    ...(texte(o.groupe, 120) ? { groupe: texte(o.groupe, 120) } : {}),
    ...(nombre(o.nombre) !== undefined ? { nombre: nombre(o.nombre) } : {}),
    ...(nombre(o.montant) !== undefined ? { montant: nombre(o.montant) } : {}),
    ...(nombre(o.pourcentage) !== undefined ? { pourcentage: nombre(o.pourcentage) } : {}),
    ...(poids !== undefined ? { poids: Math.min(100, Math.max(0, poids)) } : {}),
  };
}

function lireListe(base: Pick<BaseBoite, 'lire'> | undefined, mois: string): EvenementJournal[] {
  try {
    const brut = base?.lire(PREFIXE_BOITE + mois);
    const liste = brut ? (JSON.parse(brut) as unknown) : [];
    return Array.isArray(liste) ? liste.flatMap(e => evenementValide(e) ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Dépose un événement dans la boîte du journal (remplace celui qui a le même
 * identifiant). `false` : événement invalide ou base indisponible.
 */
export function deposerEvenementJournal(base: BaseBoite | undefined, evenement: Omit<EvenementJournal, 'source'> & { source?: string }): boolean {
  const valide = evenementValide({ ...evenement, source: evenement.source ?? SOURCE_BOITE });
  if (!base || !valide) return false;
  try {
    const mois = valide.jour.slice(0, 7);
    const liste = lireListe(base, mois).filter(e => !(e.id === valide.id && e.source === valide.source));
    liste.push(valide);
    base.ecrire(PREFIXE_BOITE + mois, JSON.stringify(liste.slice(-MAX_PAR_MOIS)));
    return true;
  } catch {
    return false;
  }
}

/** Événements de la boîte pour un jour. */
export function lireBoite(base: Pick<BaseBoite, 'lire'> | undefined, jour: string): EvenementJournal[] {
  return lireListe(base, jour.slice(0, 7)).filter(e => e.jour === jour);
}

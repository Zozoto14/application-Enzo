/**
 * Rubrique Sponsors : règles pures côté app (montants, périodes lisibles, lien `mailto:` d'un modèle de prise de
 * contact FR / EN, tri du pipeline, déplacements au clavier). Testé (src/esport/Sponsors.test.tsx).
 */

import { formaterDate, langueCourante } from '../i18n';
import { CLUB_DEFAUT, MODELES_COURRIEL, trSp, type CleSp, type CleModele } from '../i18n/sponsors';
import type { Etape, IssueEtape, ResumeProspect } from './api';

/** Montant en centimes → texte lisible en euros (« 1 500 € », « 1 500,50 € »). */
export function formaterMontant(centimes: number, langue = langueCourante()): string {
  const euros = centimes / 100;
  try {
    return new Intl.NumberFormat(langue === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(euros) ? 0 : 2, maximumFractionDigits: 2 }).format(euros);
  } catch {
    return `${euros.toFixed(Number.isInteger(euros) ? 0 : 2)} €`;
  }
}

/** Centimes → saisie en euros (« 1500 », « 1500,5 » en français). */
export function saisieMontant(centimes: number, langue = langueCourante()): string {
  if (!centimes) return '';
  const t = Number.isInteger(centimes / 100) ? String(centimes / 100) : (centimes / 100).toFixed(2);
  return langue === 'en' ? t : t.replace('.', ',');
}

/** Nom affiché d'une étape (nom saisi, sinon nom par défaut traduit). */
export const nomEtape = (e: Pick<Etape, 'nom' | 'cle'>): string => e.nom ?? (e.cle ? trSp(`etape.${e.cle}` as CleSp) : '—');

/** Période d'une contrepartie (« 2026-10 », « 2026-T4 », « 2026-S44 », « 2026 », « unique ») → libellé. */
export function nomPeriode(cle: string): string {
  if (cle === 'unique') return trSp('periode.unique');
  let m = /^(\d{4})-(\d{2})$/.exec(cle);
  if (m) return formaterDate(`${cle}-15T12:00:00Z`, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  m = /^(\d{4})-T([1-4])$/.exec(cle);
  if (m) return trSp('periode.trimestre', { n: m[2], annee: m[1] });
  m = /^(\d{4})-S(\d{2})$/.exec(cle);
  if (m) return trSp('periode.semaine', { n: String(Number(m[2])), annee: m[1] });
  return cle;
}

/** Prospects d'une étape, dans l'ordre (position, puis nom). */
export function prospectsDe(prospects: readonly ResumeProspect[], etapeId: string): ResumeProspect[] {
  return prospects.filter(p => p.etapeId === etapeId).sort((a, b) => a.position - b.position || a.nom.localeCompare(b.nom));
}

/** Étapes visibles du Kanban : non archivées (ou archivées mais encore occupées). */
export function etapesVisibles(etapes: readonly Etape[], prospects: readonly ResumeProspect[]): Etape[] {
  return etapes.filter(e => !e.archive || prospects.some(p => p.etapeId === e.id));
}

/**
 * Déplacement au clavier (menu ⋯ d'une carte) : `{ etapeId, index }` à envoyer au serveur, ou undefined si
 * la carte est déjà au bord. `index` : rang dans l'étape d'arrivée (sans la carte).
 */
export function cibleDeplacement(
  etapes: readonly Etape[],
  prospects: readonly ResumeProspect[],
  id: string,
  sens: 'haut' | 'bas' | 'precedente' | 'suivante',
): { etapeId: string; index: number; issue: IssueEtape } | undefined {
  const p = prospects.find(x => x.id === id);
  if (!p) return undefined;
  const visibles = etapes.filter(e => !e.archive);
  const i = visibles.findIndex(e => e.id === p.etapeId);
  const colonne = prospectsDe(prospects, p.etapeId);
  const rang = colonne.findIndex(x => x.id === id);
  if (sens === 'haut') return rang > 0 ? { etapeId: p.etapeId, index: rang - 1, issue: p.issue } : undefined;
  if (sens === 'bas') return rang < colonne.length - 1 ? { etapeId: p.etapeId, index: rang + 1, issue: p.issue } : undefined;
  const cible = visibles[sens === 'precedente' ? i - 1 : i + 1];
  if (!cible) return undefined;
  return { etapeId: cible.id, index: prospectsDe(prospects, cible.id).length, issue: cible.issue };
}

/** Prénom d'un contact (premier mot de son nom). */
export const prenomDe = (nom: string): string => nom.trim().split(/\s+/)[0] ?? '';

/**
 * Lien `mailto:` d'un modèle de prise de contact (langue du modèle choisie, pas celle de l'app) ; undefined si
 * l'adresse est invalide. Variables : {prenom}, {entreprise}, {club} (vide : « notre club » / « our club »).
 */
export function lienMailto(email: string, modele: CleModele, langue: 'fr' | 'en', variables: { prenom: string; entreprise: string; club: string }): string | undefined {
  const adresse = email.trim();
  if (!/^[^\s<>@"',;?&]+@[^\s<>@"',;?&]+\.[A-Za-z]{2,}$/.test(adresse)) return undefined;
  const m = MODELES_COURRIEL[modele][langue];
  const v = { ...variables, club: variables.club || CLUB_DEFAUT[langue] };
  const remplir = (t: string) => t.replace(/\{(prenom|entreprise|club)\}/g, (_, k: 'prenom' | 'entreprise' | 'club') => v[k] || '');
  return `mailto:${encodeURIComponent(adresse).replace(/%40/g, '@')}?subject=${encodeURIComponent(remplir(m.sujet))}&body=${encodeURIComponent(remplir(m.corps))}`;
}

/** Lien `tel:` (chiffres et + seulement). */
export const lienTel = (tel: string): string | undefined => {
  const t = tel.replace(/[^+0-9]/g, '');
  return t.length >= 3 ? `tel:${t}` : undefined;
};

/** Adresse d'un réseau (lien https) ; un pseudo « @nom » n'a pas d'adresse. */
export const lienReseau = (r: string): string | undefined => (/^https:\/\//i.test(r) ? r : undefined);

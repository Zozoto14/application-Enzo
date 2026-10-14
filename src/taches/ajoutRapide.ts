/**
 * Ajout rapide en une ligne : « Appeler Paul demain #prospects !haute @ami ».
 *
 *  - `#mot` : étiquette ; `!urgente` `!haute` `!normale` `!basse` (ou `!1`…`!4`,
 *    `!!` = haute, `!!!` = urgente) : priorité ;
 *  - `@moi`, `@ami`, `@<prénom>` : personne assignée ;
 *  - une date en français (« aujourd’hui », « demain », « lundi », « 15/11 »,
 *    « dans 3 jours », « 15 novembre », suivie ou non de « à 14h ») ;
 *  - une récurrence (« tous les jours », « chaque lundi et jeudi »,
 *    « toutes les semaines », « chaque mois », « tous les ans »).
 *
 * Ce qui reste forme le titre.
 */

import { JOURS_SEMAINE, jourSemaine, sansAccents, trouverDate } from './dates';
import { occurrenceApres } from './recurrence';
import { normaliserEtiquette, type Auteur, type Echeance, type Priorite, type Recurrence } from './modele';

export interface AjoutLu {
  titre: string;
  echeance?: Echeance;
  etiquettes: string[];
  priorite?: Priorite;
  assigne?: Auteur;
  /** Toutes les personnes nommées (« @Léa @Hugo »). */
  assignes?: Auteur[];
  recurrence?: Recurrence;
  /** Morceaux reconnus, pour l'aperçu (« demain », « #prospects »…). */
  reconnus: string[];
}

const PRIORITES_ECRITES: Record<string, Priorite> = {
  urgente: 'urgente', urgent: 'urgente', u: 'urgente', '1': 'urgente', '!!': 'urgente',
  haute: 'haute', haut: 'haute', h: 'haute', '2': 'haute', '!': 'haute',
  normale: 'normale', normal: 'normale', n: 'normale', '3': 'normale',
  basse: 'basse', bas: 'basse', b: 'basse', '4': 'basse',
};

export interface OptionsAjout {
  aujourdhui: string;
  /** Qui écrit (`@moi`). */
  auteur: Auteur;
  /** Prénoms affichés, pour `@Léa`. */
  noms?: Partial<Record<Auteur, string>>;
  /** L'ami existe-t-il (sinon `@ami` reste dans le titre) ? */
  avecAmi?: boolean;
  /** V3 : à qui « @ami » renvoie quand il n'y a pas d'ami des V1/V2 (le seul membre, ou soi-même chez un membre). */
  amiParDefaut?: Auteur;
}

function lireRecurrenceEcrite(mots: string[], aujourdhui: string): { recurrence: Recurrence; debut: number; fin: number } | undefined {
  const bas = mots.map(m => sansAccents(m).replace(/[,;.]$/, ''));
  for (let i = 0; i < bas.length; i++) {
    const a = bas[i];
    const b = bas[i + 1];
    if (!((a === 'tous' || a === 'toutes') && b === 'les') && a !== 'chaque') continue;
    const j = a === 'chaque' ? i + 1 : i + 2;
    const unite = bas[j];
    if (!unite) continue;
    if (/^jours?$/.test(unite)) return { recurrence: { type: 'quotidienne', intervalle: 1 }, debut: i, fin: j + 1 };
    if (/^semaines?$/.test(unite)) return { recurrence: { type: 'hebdo', jours: [jourSemaine(aujourdhui)] }, debut: i, fin: j + 1 };
    if (unite === 'mois') return { recurrence: { type: 'mensuelle', jour: Number(aujourdhui.slice(8, 10)) }, debut: i, fin: j + 1 };
    if (/^(ans?|annees?)$/.test(unite)) return { recurrence: { type: 'annuelle', mois: Number(aujourdhui.slice(5, 7)), jour: Number(aujourdhui.slice(8, 10)) }, debut: i, fin: j + 1 };
    // « chaque lundi et jeudi », « tous les lundis, mercredis »
    const jours: number[] = [];
    let k = j;
    while (k < bas.length) {
      const mot = bas[k].replace(/s$/, '');
      const idx = JOURS_SEMAINE.indexOf(mot as (typeof JOURS_SEMAINE)[number]);
      if (idx >= 0) {
        jours.push(idx + 1);
        k++;
        continue;
      }
      if ((mot === 'et' || mot === '') && jours.length > 0 && bas[k + 1] && JOURS_SEMAINE.includes(bas[k + 1].replace(/s$/, '') as (typeof JOURS_SEMAINE)[number])) {
        k++;
        continue;
      }
      break;
    }
    if (jours.length) return { recurrence: { type: 'hebdo', jours: [...new Set(jours)].sort() }, debut: i, fin: k };
  }
  return undefined;
}

export function lireAjoutRapide(ligne: string, o: OptionsAjout): AjoutLu {
  const reconnus: string[] = [];
  const etiquettes: string[] = [];
  let priorite: Priorite | undefined;
  const assignes: Auteur[] = [];
  const restants: string[] = [];
  const nomAmi = o.noms?.ami ? sansAccents(o.noms.ami) : undefined;
  const nomFondateur = o.noms?.fondateur ? sansAccents(o.noms.fondateur) : undefined;
  // Membres (V3) : « @Léa » ou « @lea-martin » (prénom, ou nom entier sans espaces).
  const parNom = new Map<string, Auteur>();
  for (const [code, nom] of Object.entries(o.noms ?? {})) {
    if (!nom || code === 'fondateur' || code === 'ami') continue;
    const n = sansAccents(nom);
    parNom.set(n.replace(/\s+/g, '-'), code);
    parNom.set(n.replace(/\s+/g, ''), code);
    if (!parNom.has(n.split(/\s+/)[0])) parNom.set(n.split(/\s+/)[0], code);
  }
  for (const mot of ligne.split(/\s+/).filter(Boolean)) {
    if (/^#[^\s#]+$/.test(mot)) {
      const e = normaliserEtiquette(mot);
      if (e) {
        if (!etiquettes.includes(e)) etiquettes.push(e);
        reconnus.push(`#${e}`);
        continue;
      }
    }
    if (/^!/.test(mot)) {
      const p = PRIORITES_ECRITES[sansAccents(mot.slice(1))];
      if (p) {
        priorite = p;
        reconnus.push(`!${p}`);
        continue;
      }
    }
    if (/^@\S+$/.test(mot)) {
      const qui = sansAccents(mot.slice(1)).replace(/[,;.]$/, '');
      let a: Auteur | undefined;
      if (qui === 'moi') a = o.auteur;
      else if (qui === 'ami' && o.avecAmi !== false) a = 'ami';
      else if (qui === 'ami' && o.amiParDefaut) a = o.amiParDefaut;
      else if (nomAmi && qui === nomAmi) a = 'ami';
      else if (nomFondateur && qui === nomFondateur) a = 'fondateur';
      else if (qui === 'fondateur') a = 'fondateur';
      else if (parNom.has(qui)) a = parNom.get(qui);
      if (a) {
        if (!assignes.includes(a)) assignes.push(a);
        reconnus.push(mot);
        continue;
      }
    }
    restants.push(mot);
  }
  let mots = restants;
  const rec = lireRecurrenceEcrite(mots, o.aujourdhui);
  let recurrence: Recurrence | undefined;
  if (rec) {
    recurrence = rec.recurrence;
    reconnus.push(mots.slice(rec.debut, rec.fin).join(' '));
    mots = [...mots.slice(0, rec.debut), ...mots.slice(rec.fin)];
  }
  let echeance: Echeance | undefined;
  const date = trouverDate(mots.join(' '), o.aujourdhui);
  if (date) {
    echeance = { jour: date.jour, ...(date.heure ? { heure: date.heure } : {}) };
    reconnus.push(date.texte);
    const n = date.texte.split(/\s+/).length;
    const debut = mots.findIndex((_, i) => mots.slice(i, i + n).join(' ') === date.texte);
    if (debut >= 0) {
      // « le 15/11 », « pour demain » : le petit mot part avec la date.
      const avant = debut > 0 ? sansAccents(mots[debut - 1]) : '';
      const retirerAvant = ['le', 'pour', 'avant', 'des'].includes(avant) ? 1 : 0;
      mots = [...mots.slice(0, debut - retirerAvant), ...mots.slice(debut + n)];
    }
  }
  // Récurrence hebdomadaire ou mensuelle sans date : la première occurrence sert d'échéance.
  if (recurrence && !echeance) {
    const ok = recurrence.type !== 'hebdo' || recurrence.jours.includes(jourSemaine(o.aujourdhui));
    echeance = { jour: ok ? o.aujourdhui : occurrenceApres(recurrence, o.aujourdhui) };
  }
  return {
    titre: mots.join(' ').trim(),
    ...(echeance ? { echeance } : {}),
    etiquettes,
    ...(priorite ? { priorite } : {}),
    ...(assignes.length ? { assigne: assignes[0], assignes } : {}),
    ...(recurrence ? { recurrence } : {}),
    reconnus,
  };
}

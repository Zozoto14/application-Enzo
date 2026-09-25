/**
 * Planification des briefings.
 *
 * Le point délicat n'est pas de choisir des heures, c'est que **iOS ne les
 * respectera pas**. Le système réveille l'application quand il le juge bon,
 * jamais à la seconde demandée, et espace les réveils s'il estime
 * l'application peu utilisée.
 *
 * La planification ne dit donc pas « envoie à 8h00 ». Elle répond à une autre
 * question, posée à chaque réveil, quel qu'en soit le moment : **un briefing
 * est-il dû, et n'a-t-il pas déjà été envoyé aujourd'hui ?**
 *
 * D'où la tolérance : passé un certain retard, le briefing est abandonné
 * plutôt qu'envoyé. Un « avant ouverture » qui arrive à 23 heures ne rend
 * service à personne, et entame la confiance dans tous les suivants.
 */

export type JourSemaine =
  | 'lundi'
  | 'mardi'
  | 'mercredi'
  | 'jeudi'
  | 'vendredi'
  | 'samedi'
  | 'dimanche';

export const JOURS: readonly JourSemaine[] = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
];

/** `Date.getDay()` rend 0 pour dimanche : l'ordre francais commence au lundi. */
const JOUR_DEPUIS_INDEX: readonly JourSemaine[] = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
];

export type MomentBriefing = 'matin' | 'soir';

export interface HoraireJour {
  actif: boolean;
  /** Heure au format HH:MM, ou absente si ce briefing est coupé. */
  matin?: string;
  soir?: string;
}

export type Planning = Record<JourSemaine, HoraireJour>;

/**
 * Horaires par défaut.
 *
 * Le week-end est coupé : les marchés sont fermés, et un briefing du samedi
 * répéterait celui du vendredi soir.
 */
export const PLANNING_DEFAUT: Planning = {
  lundi: { actif: true, matin: '08:00', soir: '17:30' },
  mardi: { actif: true, matin: '08:00', soir: '17:30' },
  mercredi: { actif: true, matin: '09:00', soir: '18:30' },
  jeudi: { actif: true, matin: '09:00', soir: '18:30' },
  vendredi: { actif: true, matin: '09:00', soir: '18:30' },
  samedi: { actif: false },
  dimanche: { actif: false },
};

/** Retard maximal toléré, en minutes, avant d'abandonner un briefing. */
export const TOLERANCE_MINUTES_DEFAUT = 240;

const MOTIF_HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function heureValide(heure: string): boolean {
  return MOTIF_HEURE.test(heure.trim());
}

/** Minutes écoulées depuis minuit, ou `undefined` si l'heure est invalide. */
export function minutesDepuisMinuit(heure: string): number | undefined {
  const correspondance = MOTIF_HEURE.exec(heure.trim());
  if (!correspondance) {
    return undefined;
  }
  return Number(correspondance[1]) * 60 + Number(correspondance[2]);
}

export function jourDe(date: Date): JourSemaine {
  return JOUR_DEPUIS_INDEX[date.getDay()];
}

export interface BriefingDu {
  moment: MomentBriefing;
  /** Heure prévue, telle que configurée. */
  heurePrevue: string;
  /** Retard réel au moment du réveil, en minutes. */
  retardMinutes: number;
}

export interface OptionsEcheance {
  /** Identifiants des briefings déjà envoyés, quel que soit le jour. */
  dejaEnvoyes?: ReadonlySet<string>;
  toleranceMinutes?: number;
}

/** Identifiant d'un briefing, stable pour un jour et un moment donnés. */
export function identifiantBriefing(date: Date, moment: MomentBriefing): string {
  const jour = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  return `briefing-${jour}-${moment}`;
}

/**
 * Briefings dus à cet instant précis.
 *
 * Appelée à chaque réveil de l'application, à une heure qu'on ne choisit pas.
 * Un briefing est dû si son heure est passée, s'il n'a pas déjà été envoyé
 * aujourd'hui, et si le retard reste dans la tolérance.
 */
export function briefingsDus(
  planning: Planning,
  maintenant: Date,
  options: OptionsEcheance = {},
): BriefingDu[] {
  const horaire = planning[jourDe(maintenant)];
  if (!horaire?.actif) {
    return [];
  }

  const dejaEnvoyes = options.dejaEnvoyes ?? new Set<string>();
  const tolerance = options.toleranceMinutes ?? TOLERANCE_MINUTES_DEFAUT;
  const minutesActuelles = maintenant.getHours() * 60 + maintenant.getMinutes();

  const dus: BriefingDu[] = [];

  for (const moment of ['matin', 'soir'] as const) {
    const heure = horaire[moment];
    if (!heure) {
      continue;
    }
    const prevue = minutesDepuisMinuit(heure);
    if (prevue === undefined) {
      continue;
    }

    const retard = minutesActuelles - prevue;
    if (retard < 0) {
      continue;
    }
    // Un « avant ouverture » qui arrive a 23 heures ne rend service a personne.
    if (retard > tolerance) {
      continue;
    }
    if (dejaEnvoyes.has(identifiantBriefing(maintenant, moment))) {
      continue;
    }

    dus.push({ moment, heurePrevue: heure, retardMinutes: retard });
  }

  return dus;
}

export interface ProchainBriefing {
  jour: JourSemaine;
  moment: MomentBriefing;
  heure: string;
  /** Vrai si c'est aujourd'hui. */
  aujourdhui: boolean;
}

/**
 * Prochain briefing prévu, pour l'afficher dans les réglages.
 * Cherche sur huit jours : sept, plus aujourd'hui une seconde fois, afin de
 * couvrir un planning qui n'aurait qu'un seul jour actif.
 */
export function prochainBriefing(
  planning: Planning,
  maintenant: Date,
): ProchainBriefing | undefined {
  const minutesActuelles = maintenant.getHours() * 60 + maintenant.getMinutes();

  for (let decalage = 0; decalage <= 7; decalage++) {
    const date = new Date(maintenant.getTime());
    date.setDate(date.getDate() + decalage);
    const jour = jourDe(date);
    const horaire = planning[jour];

    if (!horaire?.actif) {
      continue;
    }

    for (const moment of ['matin', 'soir'] as const) {
      const heure = horaire[moment];
      const prevue = heure ? minutesDepuisMinuit(heure) : undefined;
      if (!heure || prevue === undefined) {
        continue;
      }
      if (decalage === 0 && prevue <= minutesActuelles) {
        continue;
      }
      return { jour, moment, heure, aujourdhui: decalage === 0 };
    }
  }

  return undefined;
}

/** Vrai si au moins un briefing est programmé dans la semaine. */
export function planningActif(planning: Planning): boolean {
  return JOURS.some(jour => {
    const horaire = planning[jour];
    return Boolean(horaire?.actif && (horaire.matin || horaire.soir));
  });
}

/**
 * Relit un planning stocké, en comblant ce qui manque.
 * Un réglage corrompu ou partiel ne doit pas priver de briefings : on retombe
 * sur les valeurs par défaut, jour par jour.
 */
export function planningDepuisJson(texte: string | undefined): Planning {
  if (!texte) {
    return PLANNING_DEFAUT;
  }

  let brut: Partial<Record<JourSemaine, Partial<HoraireJour>>>;
  try {
    brut = JSON.parse(texte);
  } catch {
    return PLANNING_DEFAUT;
  }

  const planning = {} as Planning;
  for (const jour of JOURS) {
    const defaut = PLANNING_DEFAUT[jour];
    const lu = brut?.[jour];

    planning[jour] = {
      actif: typeof lu?.actif === 'boolean' ? lu.actif : defaut.actif,
      matin: lu?.matin && heureValide(lu.matin) ? lu.matin : lu ? undefined : defaut.matin,
      soir: lu?.soir && heureValide(lu.soir) ? lu.soir : lu ? undefined : defaut.soir,
    };
  }
  return planning;
}

export function planningVersJson(planning: Planning): string {
  return JSON.stringify(planning);
}

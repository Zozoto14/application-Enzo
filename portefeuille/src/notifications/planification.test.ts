import {
  JOURS,
  PLANNING_DEFAUT,
  TOLERANCE_MINUTES_DEFAUT,
  briefingsDus,
  heureValide,
  identifiantBriefing,
  jourDe,
  minutesDepuisMinuit,
  planningActif,
  planningDepuisJson,
  planningVersJson,
  prochainBriefing,
  type Planning,
} from './planification';

/** 2026-09-21 est un lundi ; les jours suivants s'enchaînent. */
const LUNDI = (heure: number, minute = 0) => new Date(2026, 8, 21, heure, minute);
const MERCREDI = (heure: number, minute = 0) => new Date(2026, 8, 23, heure, minute);
const SAMEDI = (heure: number, minute = 0) => new Date(2026, 8, 26, heure, minute);

describe('jourDe', () => {
  it('nomme correctement les jours', () => {
    expect(jourDe(LUNDI(12))).toBe('lundi');
    expect(jourDe(MERCREDI(12))).toBe('mercredi');
    expect(jourDe(SAMEDI(12))).toBe('samedi');
    // Le dimanche vaut 0 pour Date.getDay : c'est l'erreur classique.
    expect(jourDe(new Date(2026, 8, 27, 12))).toBe('dimanche');
  });
});

describe('heures', () => {
  it('valide le format HH:MM', () => {
    expect(heureValide('08:00')).toBe(true);
    expect(heureValide('23:59')).toBe(true);
    expect(heureValide('8:00')).toBe(false);
    expect(heureValide('24:00')).toBe(false);
    expect(heureValide('08:60')).toBe(false);
    expect(heureValide('midi')).toBe(false);
  });

  it('convertit en minutes depuis minuit', () => {
    expect(minutesDepuisMinuit('00:00')).toBe(0);
    expect(minutesDepuisMinuit('08:00')).toBe(480);
    expect(minutesDepuisMinuit('17:30')).toBe(1050);
    expect(minutesDepuisMinuit('invalide')).toBeUndefined();
  });
});

describe('horaires par défaut', () => {
  it('suit le rythme demandé', () => {
    expect(PLANNING_DEFAUT.lundi).toEqual({ actif: true, matin: '08:00', soir: '17:30' });
    expect(PLANNING_DEFAUT.mardi).toEqual({ actif: true, matin: '08:00', soir: '17:30' });
    expect(PLANNING_DEFAUT.mercredi).toEqual({
      actif: true,
      matin: '09:00',
      soir: '18:30',
    });
    expect(PLANNING_DEFAUT.jeudi).toEqual(PLANNING_DEFAUT.mercredi);
    expect(PLANNING_DEFAUT.vendredi).toEqual(PLANNING_DEFAUT.mercredi);
  });

  it('coupe le week-end, marchés fermés', () => {
    expect(PLANNING_DEFAUT.samedi.actif).toBe(false);
    expect(PLANNING_DEFAUT.dimanche.actif).toBe(false);
  });
});

describe('briefingsDus', () => {
  it('ne dit rien avant l’heure prévue', () => {
    expect(briefingsDus(PLANNING_DEFAUT, LUNDI(7, 59))).toEqual([]);
  });

  it('déclenche le briefing du matin à l’heure', () => {
    const dus = briefingsDus(PLANNING_DEFAUT, LUNDI(8, 0));

    expect(dus).toHaveLength(1);
    expect(dus[0].moment).toBe('matin');
    expect(dus[0].heurePrevue).toBe('08:00');
    expect(dus[0].retardMinutes).toBe(0);
  });

  it('déclenche encore avec du retard, puisque iOS choisit le moment', () => {
    const dus = briefingsDus(PLANNING_DEFAUT, LUNDI(9, 30));

    expect(dus).toHaveLength(1);
    expect(dus[0].retardMinutes).toBe(90);
  });

  it('abandonne un briefing trop en retard', () => {
    // Un « avant ouverture » a 23 heures ne rend service a personne, et entame
    // la confiance dans tous les suivants.
    expect(briefingsDus(PLANNING_DEFAUT, LUNDI(13, 0)).map(d => d.moment)).toEqual([]);
  });

  it('respecte une tolérance personnalisée', () => {
    const dus = briefingsDus(PLANNING_DEFAUT, LUNDI(13, 0), { toleranceMinutes: 400 });
    expect(dus.map(d => d.moment)).toEqual(['matin']);
  });

  it('déclenche les deux briefings si aucun n’a été envoyé', () => {
    const dus = briefingsDus(PLANNING_DEFAUT, LUNDI(18, 0), { toleranceMinutes: 1440 });
    expect(dus.map(d => d.moment)).toEqual(['matin', 'soir']);
  });

  it('n’envoie pas deux fois le même briefing', () => {
    const dejaEnvoyes = new Set([identifiantBriefing(LUNDI(8), 'matin')]);
    expect(briefingsDus(PLANNING_DEFAUT, LUNDI(9), { dejaEnvoyes })).toEqual([]);
  });

  it('applique les horaires du mercredi, différents du lundi', () => {
    // A 8h30 le mercredi, le briefing de 9h n'est pas encore du.
    expect(briefingsDus(PLANNING_DEFAUT, MERCREDI(8, 30))).toEqual([]);
    expect(briefingsDus(PLANNING_DEFAUT, MERCREDI(9, 0))[0].heurePrevue).toBe('09:00');
    expect(briefingsDus(PLANNING_DEFAUT, MERCREDI(18, 30))[0].moment).toBe('soir');
  });

  it('reste muet le week-end', () => {
    expect(briefingsDus(PLANNING_DEFAUT, SAMEDI(8))).toEqual([]);
    expect(briefingsDus(PLANNING_DEFAUT, SAMEDI(18))).toEqual([]);
  });

  it('respecte un jour désactivé à la main', () => {
    const sansLundi: Planning = {
      ...PLANNING_DEFAUT,
      lundi: { ...PLANNING_DEFAUT.lundi, actif: false },
    };
    expect(briefingsDus(sansLundi, LUNDI(8))).toEqual([]);
  });

  it('respecte un briefing du soir supprimé', () => {
    const sansSoir: Planning = {
      ...PLANNING_DEFAUT,
      lundi: { actif: true, matin: '08:00' },
    };
    expect(briefingsDus(sansSoir, LUNDI(18), { toleranceMinutes: 1440 })).toHaveLength(1);
  });

  it('expose une tolérance par défaut de quatre heures', () => {
    expect(TOLERANCE_MINUTES_DEFAUT).toBe(240);
  });
});

describe('identifiantBriefing', () => {
  it('est stable pour un jour et un moment', () => {
    expect(identifiantBriefing(LUNDI(8), 'matin')).toBe('briefing-2026-09-21-matin');
    expect(identifiantBriefing(LUNDI(20), 'matin')).toBe('briefing-2026-09-21-matin');
    expect(identifiantBriefing(LUNDI(8), 'soir')).toBe('briefing-2026-09-21-soir');
  });
});

describe('prochainBriefing', () => {
  it('annonce le briefing du soir depuis le matin', () => {
    const prochain = prochainBriefing(PLANNING_DEFAUT, LUNDI(10))!;

    expect(prochain).toEqual({
      jour: 'lundi',
      moment: 'soir',
      heure: '17:30',
      aujourdhui: true,
    });
  });

  it('bascule au lendemain une fois la journée passée', () => {
    const prochain = prochainBriefing(PLANNING_DEFAUT, LUNDI(20))!;

    expect(prochain.jour).toBe('mardi');
    expect(prochain.moment).toBe('matin');
    expect(prochain.aujourdhui).toBe(false);
  });

  it('saute le week-end', () => {
    // Vendredi soir : le prochain est lundi matin.
    const vendrediSoir = new Date(2026, 8, 25, 20);
    expect(prochainBriefing(PLANNING_DEFAUT, vendrediSoir)!.jour).toBe('lundi');
  });

  it('ne rend rien si tout est coupé', () => {
    const aucun = JOURS.reduce((planning, jour) => {
      planning[jour] = { actif: false };
      return planning;
    }, {} as Planning);

    expect(prochainBriefing(aucun, LUNDI(10))).toBeUndefined();
    expect(planningActif(aucun)).toBe(false);
  });
});

describe('persistance du planning', () => {
  it('fait un aller-retour sans perte', () => {
    const relu = planningDepuisJson(planningVersJson(PLANNING_DEFAUT));
    expect(relu).toEqual(PLANNING_DEFAUT);
  });

  it('retombe sur les valeurs par défaut sans réglage enregistré', () => {
    expect(planningDepuisJson(undefined)).toEqual(PLANNING_DEFAUT);
  });

  it('retombe sur les valeurs par défaut sur un JSON corrompu', () => {
    // Un reglage illisible ne doit pas priver de briefings.
    expect(planningDepuisJson('ceci n’est pas du json')).toEqual(PLANNING_DEFAUT);
  });

  it('écarte une heure invalide au lieu de la conserver', () => {
    const planning = planningDepuisJson(
      JSON.stringify({ lundi: { actif: true, matin: '25:00', soir: '17:30' } }),
    );

    expect(planning.lundi.matin).toBeUndefined();
    expect(planning.lundi.soir).toBe('17:30');
  });

  it('conserve un jour volontairement vidé', () => {
    // Retirer les deux briefings d'un jour actif doit tenir au rechargement.
    const planning = planningDepuisJson(JSON.stringify({ mardi: { actif: true } }));

    expect(planning.mardi.actif).toBe(true);
    expect(planning.mardi.matin).toBeUndefined();
  });

  it('complète les jours absents du réglage enregistré', () => {
    const planning = planningDepuisJson(JSON.stringify({ lundi: { actif: false } }));

    expect(planning.lundi.actif).toBe(false);
    expect(planning.mercredi).toEqual(PLANNING_DEFAUT.mercredi);
  });
});

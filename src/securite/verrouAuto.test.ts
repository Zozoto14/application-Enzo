import {
  CLE_PRESENCE_ESSAI_S,
  CLE_VERROU_AUTO,
  CLE_VERROU_AUTO_ESSAI_MS,
  DELAIS_VERROU_MINUTES,
  DELAI_VERROU_DEFAUT,
  SAUT_VEILLE_MS,
  confirmerPresence,
  ecrireDelaiAppareil,
  etatInitial,
  evaluer,
  lireDelaiAppareil,
  lireDelaiVerrou,
  lireSurchargeEssai,
  libelleDelaiVerrou,
  messageVerrou,
  noterActivite,
} from './verrouAuto';

const MIN = 60_000;
const T0 = 1_000_000;
const ctx = (delaiMinutes: number, lecture = false) => ({ delaiMinutes, lecture });
/** Vérifications toutes les 30 s jusqu'à `fin` (sans saut d'horloge, comme la minuterie d'une seconde). */
const marcher = (etat: ReturnType<typeof etatInitial>, fin: number, c: ReturnType<typeof ctx> & { presenceSecondes?: number }, debut = etat.verifieLe) => {
  let courant = etat;
  let derniere: ReturnType<typeof evaluer> = { etat, decision: { action: 'rien' } };
  for (let t = debut + 30_000; t <= fin; t += 30_000) {
    derniere = evaluer(courant, t, c);
    courant = derniere.etat;
  }
  return derniere;
};

describe('verrouillage automatique : décision', () => {
  it('le défaut est 45 minutes et la liste propose 5/15/30/45/60/120 minutes ou jamais', () => {
    expect(DELAI_VERROU_DEFAUT).toBe(45);
    expect(DELAIS_VERROU_MINUTES).toEqual([5, 15, 30, 45, 60, 120, 0]);
    expect(libelleDelaiVerrou(0)).toBe('Jamais');
    expect(libelleDelaiVerrou(120)).toBe('2 h');
    expect(libelleDelaiVerrou(45)).toBe('45 min');
  });

  it('ne fait rien avant l’échéance, verrouille à 45 minutes sans activité', () => {
    const e = etatInitial(T0);
    expect(evaluer(e, T0 + 44 * MIN, ctx(45)).decision.action).toBe('rien');
    // Vérifications régulières : pas de saut d'horloge.
    let etat = e;
    for (let t = T0; t < T0 + 44 * MIN; t += 30_000) etat = evaluer(etat, t, ctx(45)).etat;
    const { decision } = evaluer(etat, T0 + 45 * MIN, ctx(45));
    expect(decision).toEqual({ action: 'verrouiller', motif: 'inactivite' });
  });

  it('une activité repousse l’échéance', () => {
    let etat = etatInitial(T0);
    etat = evaluer(etat, T0 + 40 * MIN, ctx(45)).etat;
    etat = noterActivite(etat, T0 + 40 * MIN);
    expect(evaluer(etat, T0 + 80 * MIN - 1000, ctx(45)).decision.action).toBe('rien');
  });

  it('« Jamais » ne verrouille jamais', () => {
    expect(evaluer(etatInitial(T0), T0 + 1000 * MIN, ctx(0)).decision.action).toBe('rien');
  });

  it('mise en veille : l’horloge a sauté au-delà du délai, verrouillage direct sans dialogue, même pendant une lecture', () => {
    const e = etatInitial(T0);
    expect(SAUT_VEILLE_MS).toBeGreaterThan(60_000);
    expect(evaluer(e, T0 + 50 * MIN, ctx(45, false)).decision).toEqual({ action: 'verrouiller', motif: 'veille' });
    expect(evaluer(e, T0 + 50 * MIN, ctx(45, true)).decision).toEqual({ action: 'verrouiller', motif: 'veille' });
  });

  it('un saut d’horloge court, sous le délai, ne verrouille pas', () => {
    expect(evaluer(etatInitial(T0), T0 + 10 * MIN, ctx(45)).decision.action).toBe('rien');
  });

  it('pendant une lecture : à l’échéance on demande, compte à rebours de 60 s, puis on verrouille', () => {
    let etat = etatInitial(T0);
    for (let t = T0; t < T0 + 45 * MIN; t += 1000 * 30) etat = evaluer(etat, t, ctx(45, true)).etat;
    const demande = evaluer(etat, T0 + 45 * MIN, ctx(45, true));
    expect(demande.decision).toEqual({ action: 'demander', depuis: T0 + 45 * MIN, secondesRestantes: 60 });
    const milieu = evaluer(demande.etat, T0 + 45 * MIN + 20_000, ctx(45, true));
    expect(milieu.decision).toMatchObject({ action: 'demander', secondesRestantes: 40 });
    // Une activité pendant le dialogue ne le ferme pas : seul « Je suis là » le ferme.
    const apres = noterActivite(milieu.etat, T0 + 45 * MIN + 25_000);
    expect(apres.demandeDepuis).toBeDefined();
    const fin = evaluer(apres, T0 + 45 * MIN + 60_000, ctx(45, true));
    expect(fin.decision).toEqual({ action: 'verrouiller', motif: 'presence' });
  });

  it('« Je suis là » repart de zéro', () => {
    let etat = marcher(etatInitial(T0), T0 + 45 * MIN, ctx(45, true)).etat;
    expect(etat.demandeDepuis).toBeDefined();
    etat = confirmerPresence(etat, T0 + 45 * MIN + 10_000);
    expect(evaluer(etat, T0 + 45 * MIN + 11_000, ctx(45, true)).decision.action).toBe('rien');
  });

  it('présence personnalisée (essais) : 5 s', () => {
    const c = { delaiMinutes: 1, lecture: true, presenceSecondes: 5 };
    const { etat } = marcher(etatInitial(T0), T0 + 90_000, c);
    expect(etat.demandeDepuis).toBeDefined();
    expect(evaluer(etat, etat.verifieLe + 5_000, c).decision).toMatchObject({ action: 'verrouiller', motif: 'presence' });
  });

  it('la lecture qui s’arrête pendant le dialogue ne l’annule pas ; passer à « Jamais » le ferme', () => {
    const { etat } = marcher(etatInitial(T0), T0 + 45 * MIN, ctx(45, true));
    expect(evaluer(etat, etat.verifieLe + 1000, ctx(45, false)).decision.action).toBe('demander');
    const ferme = evaluer(etat, etat.verifieLe + 1000, ctx(0, true));
    expect(ferme.decision.action).toBe('rien');
    expect(ferme.etat.demandeDepuis).toBeUndefined();
  });
});

describe('verrouillage automatique : réglage d’appareil', () => {
  it('toute valeur hors liste retombe sur 45', () => {
    expect(lireDelaiVerrou(undefined)).toBe(45);
    expect(lireDelaiVerrou('')).toBe(45);
    expect(lireDelaiVerrou('7')).toBe(45);
    expect(lireDelaiVerrou('abc')).toBe(45);
    expect(lireDelaiVerrou('0')).toBe(0);
    expect(lireDelaiVerrou('120')).toBe(120);
  });

  it('lit et écrit dans le stockage local, ou dans le paramètre du profil en natif', () => {
    const valeurs = new Map<string, string>();
    const local = { getItem: (c: string) => valeurs.get(c) ?? null, setItem: (c: string, v: string) => void valeurs.set(c, v) };
    expect(lireDelaiAppareil(local)).toBe(45);
    ecrireDelaiAppareil(local, 15);
    expect(valeurs.get(CLE_VERROU_AUTO)).toBe('15');
    expect(lireDelaiAppareil(local)).toBe(15);
    let param: string | undefined;
    ecrireDelaiAppareil(undefined, 30, v => (param = v));
    expect(lireDelaiAppareil(undefined, () => param)).toBe(30);
    // Stockage qui lève : le défaut, sans exception.
    const casse = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('refusé'); } };
    expect(lireDelaiAppareil(casse)).toBe(45);
    expect(() => ecrireDelaiAppareil(casse, 5)).not.toThrow();
  });

  it('les réglages d’essai ne peuvent que raccourcir et restent bornés', () => {
    const v = new Map<string, string>([[CLE_VERROU_AUTO_ESSAI_MS, '3000'], [CLE_PRESENCE_ESSAI_S, '4']]);
    const local = { getItem: (c: string) => v.get(c) ?? null };
    expect(lireSurchargeEssai(local)).toEqual({ delaiMinutes: 3000 / 60000, presenceSecondes: 4 });
    v.set(CLE_VERROU_AUTO_ESSAI_MS, '99999999');
    v.set(CLE_PRESENCE_ESSAI_S, '0');
    expect(lireSurchargeEssai(local)).toEqual({});
    expect(lireSurchargeEssai(undefined)).toEqual({});
  });

  it('messages de l’écran de déverrouillage', () => {
    expect(messageVerrou('manuel', 45)).toBeUndefined();
    expect(messageVerrou('inactivite', 45)).toContain('45 min');
    expect(messageVerrou('veille', 45)).toContain('veille');
    expect(messageVerrou('presence', 45)).toContain('toujours là');
  });
});

import { PARAMETRES } from '../db/depots';
import { PARAMETRES_A_SYNCHRONISER, PARAMETRES_PARTAGES } from '../sync/relais/entites';

describe('réglages propres à l’appareil ou au compte, jamais synchronisés', () => {
  it('ni le délai de verrouillage, ni les tickets, ni les acceptations ne partent au relais', () => {
    const synchronises = new Set([...PARAMETRES_PARTAGES, ...PARAMETRES_A_SYNCHRONISER]);
    for (const cle of [PARAMETRES.verrouAutoMinutes, PARAMETRES.ticketsSupport, PARAMETRES.acceptationsJuridiques]) expect(synchronises.has(cle)).toBe(false);
  });
});

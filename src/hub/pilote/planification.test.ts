import { lireReglagesPilote, REGLAGES_PILOTE_DEFAUT, type EntreePilote, type EpisodeRecompense, type EvenementFixe, type ReglagesPilote, type Semaine, type TachePlanifiable } from './contrats';
import { minutesDe, septJours } from './jours';
import {
  bilanJours,
  decalerElement,
  deplacerElement,
  derniereProposition,
  empaqueterJour,
  etatRecompenses,
  proposerSemaine,
  remettreElement,
  resumerSemaine,
  retirerElement,
  semaineProposee,
} from './planification';

const LUNDI = '2026-10-19';
const [LUN, MAR, MER, JEU, VEN, SAM, DIM] = septJours(LUNDI);

const reglages = (c: Partial<ReglagesPilote> = {}): ReglagesPilote => ({ ...REGLAGES_PILOTE_DEFAUT, ...c });
const tache = (id: string, c: Partial<TachePlanifiable> = {}): TachePlanifiable => ({ id, titre: `Tâche ${id}`, priorite: 'normale', dureeMin: 60, ...c });
const episode = (n: number, anime = 'a1'): EpisodeRecompense => ({ id: `${anime}-${n}`, animeId: anime, titre: `Animé ${anime}`, episode: n, dureeMin: 24 });
const entree = (c: Partial<EntreePilote> = {}): EntreePilote => ({ debut: LUNDI, aujourdhui: '2026-10-18', reglages: reglages(), taches: [], evenements: [], episodes: [], ...c });
const travail = (s: Semaine) => s.elements.filter(e => e.genre === 'tache' || e.genre === 'repetition');
const jourDe = (s: Semaine, id: string) => s.elements.find(e => e.id === id)?.jour;

describe('proposerSemaine : charge', () => {
  it('ne dépasse jamais la charge maximale d’un jour', () => {
    const taches = Array.from({ length: 10 }, (_, i) => tache(`t${i}`, { dureeMin: 120, echeance: VEN }));
    const s = proposerSemaine(entree({ taches, reglages: reglages({ chargeMax: 360 }) }));
    for (const b of bilanJours(s, reglages({ chargeMax: 360 }))) expect(b.charge).toBeLessThanOrEqual(360);
    expect(travail(s)).toHaveLength(10);
    expect(s.nonPlaces).toHaveLength(0);
  });

  it('range à part ce qui ne tient pas avant l’échéance, sans le forcer', () => {
    // 180 min par jour : une seule tâche de 120 min par jour, soit 5 tâches sur 8.
    const taches = Array.from({ length: 8 }, (_, i) => tache(`t${i}`, { dureeMin: 120, echeance: VEN }));
    const r = reglages({ chargeMax: 180 });
    const s = proposerSemaine(entree({ taches, reglages: r }));
    expect(travail(s)).toHaveLength(5);
    expect(s.nonPlaces).toHaveLength(3);
    expect(s.nonPlaces.every(e => e.raison === 'charge')).toBe(true);
    for (const b of bilanJours(s, r)) expect(b.charge).toBeLessThanOrEqual(180);
  });

  it('équilibre les tâches normales entre les jours', () => {
    const taches = Array.from({ length: 5 }, (_, i) => tache(`t${i}`, { dureeMin: 60, echeance: VEN }));
    const s = proposerSemaine(entree({ taches }));
    expect(new Set(travail(s).map(e => e.jour)).size).toBe(5);
  });

  it('place le plus tôt possible les urgentes et les hautes', () => {
    const s = proposerSemaine(entree({ taches: [tache('u', { priorite: 'urgente', echeance: VEN }), tache('h', { priorite: 'haute', echeance: VEN })] }));
    expect(jourDe(s, 'tache:u')).toBe(LUN);
    expect(jourDe(s, 'tache:h')).toBe(LUN);
  });

  it('plafonne une tâche plus longue que le plus long créneau et le dit', () => {
    const s = proposerSemaine(entree({ taches: [tache('gros', { dureeMin: 600 })] }));
    const e = s.elements.find(x => x.id === 'tache:gros')!;
    expect(e.dureeMin).toBe(240);
    expect(e.plafonnee).toBe(true);
  });

  it('applique la durée par défaut aux tâches sans estimation', () => {
    const s = proposerSemaine(entree({ taches: [{ id: 'x', titre: 'X', priorite: 'normale' }], reglages: reglages({ dureeDefaut: 45 }) }));
    expect(s.elements[0].dureeMin).toBe(45);
  });
});

describe('proposerSemaine : échéances', () => {
  it('place chaque tâche au plus tard à son échéance', () => {
    const taches = [tache('a', { echeance: MAR }), tache('b', { echeance: MER }), tache('c', { echeance: JEU }), tache('d', { echeance: VEN })];
    const s = proposerSemaine(entree({ taches }));
    expect(jourDe(s, 'tache:a')! <= MAR).toBe(true);
    expect(jourDe(s, 'tache:b')! <= MER).toBe(true);
    expect(jourDe(s, 'tache:c')! <= JEU).toBe(true);
    expect(jourDe(s, 'tache:d')! <= VEN).toBe(true);
    expect(s.elements.some(e => e.apresEcheance)).toBe(false);
  });

  it('donne la place aux échéances proches avant aux échéances lointaines', () => {
    // Un seul jour utilisable (lundi) avant mardi : la tâche due lundi passe avant la tâche due vendredi, même basse.
    const r = reglages({ chargeMax: 120 });
    const taches = [tache('loin', { echeance: VEN, priorite: 'urgente', dureeMin: 120 }), tache('proche', { echeance: LUN, priorite: 'basse', dureeMin: 120 })];
    const s = proposerSemaine(entree({ taches, reglages: r }));
    expect(jourDe(s, 'tache:proche')).toBe(LUN);
    expect(jourDe(s, 'tache:loin')).toBe(MAR);
  });

  it('ramène une tâche en retard au premier jour de travail et le signale', () => {
    const s = proposerSemaine(entree({ taches: [tache('r', { echeance: '2026-10-10' })] }));
    const e = s.elements[0];
    expect(e.jour).toBe(LUN);
    expect(e.retard).toBe(true);
  });

  it('respecte la date de début d’une tâche', () => {
    const s = proposerSemaine(entree({ taches: [tache('d', { debut: MER, echeance: VEN })] }));
    expect(jourDe(s, 'tache:d')! >= MER).toBe(true);
  });

  it('une tâche due plus tard que la semaine peut avancer, sans dépasser la semaine', () => {
    const s = proposerSemaine(entree({ taches: [tache('l', { echeance: '2026-11-15' })] }));
    expect(s.elements[0].jour <= VEN).toBe(true);
  });

  it('ne place rien avant aujourd’hui quand on régénère en cours de semaine', () => {
    const s = proposerSemaine(entree({ aujourdhui: MER, taches: [tache('a', { echeance: MAR }), tache('b', { echeance: VEN })] }));
    for (const e of s.elements) expect(e.jour >= MER).toBe(true);
    expect(jourDe(s, 'tache:a')).toBe(MER);
    expect(s.elements.find(e => e.id === 'tache:a')!.retard).toBe(true);
  });
});

describe('proposerSemaine : jours off, créneaux, récurrences', () => {
  it('ne travaille pas les jours off', () => {
    const taches = Array.from({ length: 12 }, (_, i) => tache(`t${i}`, { dureeMin: 90 }));
    const s = proposerSemaine(entree({ taches, reglages: reglages({ joursOff: [3, 6, 7] }) }));
    for (const e of travail(s)) expect([MER, SAM, DIM]).not.toContain(e.jour);
  });

  it('une tâche due un jour off passe avant', () => {
    const s = proposerSemaine(entree({ taches: [tache('d', { echeance: DIM })] }));
    expect(jourDe(s, 'tache:d')! <= VEN).toBe(true);
  });

  it('sans jour de travail disponible, tout est à arbitrer', () => {
    const s = proposerSemaine(entree({ taches: [tache('a')], reglages: reglages({ joursOff: [1, 2, 3, 4, 5, 6] }) }));
    // Le dimanche reste le seul jour ouvré.
    expect(jourDe(s, 'tache:a')).toBe(DIM);
    const s2 = proposerSemaine(entree({ aujourdhui: DIM, taches: [tache('a', { echeance: MAR })], reglages: reglages({ joursOff: [7] }) }));
    expect(s2.nonPlaces[0].raison).toBe('jours-off');
  });

  it('range les heures dans les créneaux, sans chevauchement', () => {
    const taches = Array.from({ length: 12 }, (_, i) => tache(`t${i}`, { dureeMin: 50 + (i % 4) * 10 }));
    const r = reglages();
    const s = proposerSemaine(entree({ taches, reglages: r }));
    for (const jour of septJours(LUNDI)) {
      const du = s.elements.filter(e => e.jour === jour && e.debut && e.genre !== 'episode').sort((a, b) => a.debut!.localeCompare(b.debut!));
      let fin = -1;
      for (const e of du) {
        const a = minutesDe(e.debut!);
        const b = minutesDe(e.fin!);
        expect(b - a).toBe(e.dureeMin);
        expect(r.creneaux.some(c => a >= minutesDe(c.debut) && b <= minutesDe(c.fin))).toBe(true);
        expect(a).toBeGreaterThanOrEqual(fin);
        fin = b;
      }
    }
  });

  it('place les occurrences d’une tâche récurrente à leur jour', () => {
    const s = proposerSemaine(entree({ taches: [tache('rec', { echeance: LUN, repetitions: [MER, VEN], dureeMin: 30 })] }));
    expect(jourDe(s, 'tache:rec')).toBe(LUN);
    expect(jourDe(s, `repetition:rec@${MER}`)).toBe(MER);
    expect(jourDe(s, `repetition:rec@${VEN}`)).toBe(VEN);
    expect(resumerSemaine(s).repetitions).toBe(2);
  });

  it('une occurrence qui tombe un jour off est à arbitrer', () => {
    const s = proposerSemaine(entree({ taches: [tache('rec', { echeance: LUN, repetitions: [SAM] })] }));
    expect(s.nonPlaces.map(e => e.id)).toEqual([`repetition:rec@${SAM}`]);
    expect(s.nonPlaces[0].raison).toBe('jours-off');
  });
});

describe('proposerSemaine : événements des autres apps', () => {
  const ev = (id: string, genre: EvenementFixe['genre'], jour: string, c: Partial<EvenementFixe> = {}): EvenementFixe => ({ id, genre, titre: `Événement ${id}`, jour, ...c });

  it('garde les événements à leur jour et les compte dans la charge', () => {
    const s = proposerSemaine(entree({ evenements: [ev('p1', 'relance', MAR), ev('a1', 'paiement', JEU), ev('v', 'versement', VEN), ev('d', 'dividende', VEN)] }));
    expect(jourDe(s, 'relance:p1')).toBe(MAR);
    expect(jourDe(s, 'paiement:a1')).toBe(JEU);
    const r = resumerSemaine(s);
    expect(r).toMatchObject({ relances: 1, paiements: 1, portefeuille: 2 });
    expect(bilanJours(s, reglages()).find(b => b.jour === MAR)!.charge).toBe(15);
  });

  it('une relance avec heure garde son heure et les tâches l’évitent', () => {
    const taches = [tache('t', { dureeMin: 180, echeance: LUN, priorite: 'haute' })];
    const s = proposerSemaine(entree({ taches, evenements: [ev('r', 'relance', LUN, { heure: '10:00', dureeMin: 30 })] }));
    const r = s.elements.find(e => e.id === 'relance:r')!;
    expect(r.debut).toBe('10:00');
    const t = s.elements.find(e => e.id === 'tache:t')!;
    expect(minutesDe(t.fin!) <= 600 || minutesDe(t.debut!) >= 630).toBe(true);
  });

  it('ramène un événement en retard au premier jour de travail', () => {
    const s = proposerSemaine(entree({ evenements: [ev('x', 'paiement', '2026-10-12', { retard: true })] }));
    const e = s.elements[0];
    expect(e.jour).toBe(LUN);
    expect(e.retard).toBe(true);
  });

  it('un événement d’un jour off reste ce jour-là, toute la journée, hors charge', () => {
    const s = proposerSemaine(entree({ evenements: [ev('s', 'paiement', SAM)] }));
    const e = s.elements[0];
    expect(e.jour).toBe(SAM);
    expect(e.debut).toBeUndefined();
    expect(bilanJours(s, reglages()).find(b => b.jour === SAM)!.charge).toBe(0);
  });

  it('ignore ce qui est hors de la semaine ou mal daté', () => {
    const s = proposerSemaine(entree({ evenements: [ev('loin', 'relance', '2026-11-30'), ev('bad', 'relance', 'pas-une-date')] }));
    expect(s.elements).toHaveLength(0);
  });
});

describe('proposerSemaine : récompenses Tsuzuku', () => {
  const eps = [1, 2, 3, 4, 5, 6, 7, 8].map(n => episode(n));

  it('place les épisodes le soir des jours de travail, après le travail', () => {
    const taches = [tache('a', { echeance: LUN, dureeMin: 60 }), tache('b', { echeance: MER, dureeMin: 60 })];
    const s = proposerSemaine(entree({ taches, episodes: eps }));
    const ep = s.elements.filter(e => e.genre === 'episode');
    expect(ep.length).toBeGreaterThan(0);
    for (const e of ep) {
      const jourTravail = travail(s).filter(t => t.jour === e.jour);
      expect(jourTravail.length).toBeGreaterThan(0);
      expect(minutesDe(e.debut!)).toBeGreaterThanOrEqual(minutesDe('20:00'));
      for (const t of jourTravail) expect(minutesDe(e.debut!)).toBeGreaterThanOrEqual(minutesDe(t.fin!));
    }
  });

  it('ne met aucun épisode un jour sans travail ni un jour off', () => {
    const s = proposerSemaine(entree({ taches: [tache('a', { echeance: MAR })], episodes: eps }));
    for (const e of s.elements.filter(x => x.genre === 'episode')) expect(travail(s).some(t => t.jour === e.jour)).toBe(true);
    const sSansTravail = proposerSemaine(entree({ episodes: eps }));
    expect(sSansTravail.elements).toHaveLength(0);
  });

  it('respecte le nombre d’épisodes par soirée et l’ordre des épisodes', () => {
    const taches = [tache('a', { echeance: LUN }), tache('b', { echeance: MAR }), tache('c', { echeance: MER })];
    const s = proposerSemaine(entree({ taches, episodes: eps, reglages: reglages({ episodesParJour: 1 }) }));
    const ep = s.elements.filter(e => e.genre === 'episode');
    expect(ep).toHaveLength(3);
    expect(ep.map(e => e.episode)).toEqual([1, 2, 3]);
    for (const j of septJours(LUNDI)) expect(ep.filter(e => e.jour === j).length).toBeLessThanOrEqual(1);
  });

  it('ne place pas d’épisode si les récompenses sont désactivées', () => {
    const s = proposerSemaine(entree({ taches: [tache('a')], episodes: eps, reglages: reglages({ recompenses: false }) }));
    expect(s.elements.some(e => e.genre === 'episode')).toBe(false);
  });

  it('n’empile pas les épisodes après la fin de soirée', () => {
    const longs = [1, 2, 3].map(n => ({ ...episode(n), dureeMin: 120 }));
    const s = proposerSemaine(entree({ taches: [tache('a', { echeance: LUN })], episodes: longs, reglages: reglages({ episodesParJour: 4 }) }));
    for (const e of s.elements.filter(x => x.genre === 'episode')) expect(minutesDe(e.fin!)).toBeLessThanOrEqual(minutesDe('23:30'));
  });

  it('débloque les épisodes quand les tâches du jour sont faites (visuel seulement)', () => {
    const taches = [tache('a', { echeance: LUN }), tache('b', { echeance: LUN, priorite: 'haute' })];
    const s = proposerSemaine(entree({ taches, episodes: eps, reglages: reglages({ chargeMax: 360 }) }));
    const lundi = s.elements.filter(e => e.jour === LUN);
    expect(lundi.filter(e => e.genre === 'tache')).toHaveLength(2);
    const id = lundi.find(e => e.genre === 'episode')!.id;
    expect(etatRecompenses(s, new Set())[id]).toEqual({ debloque: false, restant: 2 });
    expect(etatRecompenses(s, new Set(['a']))[id]).toEqual({ debloque: false, restant: 1 });
    expect(etatRecompenses(s, new Set(['a', 'b']))[id]).toEqual({ debloque: true, restant: 0 });
  });
});

describe('déterminisme', () => {
  it('mêmes entrées, même semaine, quel que soit l’ordre des entrées', () => {
    const taches = Array.from({ length: 14 }, (_, i) => tache(`t${i}`, { dureeMin: 30 + (i % 5) * 15, priorite: (['urgente', 'haute', 'normale', 'basse'] as const)[i % 4], echeance: i % 3 ? septJours(LUNDI)[i % 7] : undefined }));
    const evenements: EvenementFixe[] = [
      { id: 'e1', genre: 'relance', titre: 'R', jour: MAR },
      { id: 'e2', genre: 'paiement', titre: 'P', jour: JEU },
    ];
    const episodes = [1, 2, 3, 4].map(n => episode(n));
    const a = proposerSemaine(entree({ taches, evenements, episodes }));
    const b = proposerSemaine(entree({ taches: [...taches].reverse(), evenements: [...evenements].reverse(), episodes }));
    expect(b).toEqual(a);
    expect(proposerSemaine(entree({ taches, evenements, episodes }))).toEqual(a);
  });
});

describe('modifications de l’utilisateur', () => {
  const r = reglages();
  const base = () => proposerSemaine(entree({ taches: [tache('a', { echeance: VEN }), tache('b', { echeance: VEN })], evenements: [{ id: 'p', genre: 'relance', titre: 'R', jour: MAR }] }));

  it('déplace un élément vers un autre jour et range les heures', () => {
    const s = base();
    const de = jourDe(s, 'tache:a')!;
    const apres = deplacerElement(s, r, 'tache:a', JEU);
    expect(jourDe(apres, 'tache:a')).toBe(JEU);
    expect(apres.elements.find(e => e.id === 'tache:a')!.debut).toBeDefined();
    expect(apres.elements).toHaveLength(s.elements.length);
    expect(de).not.toBe(JEU);
  });

  it('refuse un jour hors de la semaine ou un identifiant inconnu', () => {
    const s = base();
    expect(deplacerElement(s, r, 'tache:a', '2026-11-30')).toBe(s);
    expect(deplacerElement(s, r, 'tache:zzz', JEU)).toBe(s);
  });

  it('signale une surcharge au lieu de la refuser', () => {
    const lourdes = Array.from({ length: 4 }, (_, i) => tache(`l${i}`, { dureeMin: 120, echeance: VEN }));
    let s = proposerSemaine(entree({ taches: lourdes, reglages: reglages({ chargeMax: 240 }) }));
    const rr = reglages({ chargeMax: 240 });
    for (const e of s.elements) s = deplacerElement(s, rr, e.id, MAR);
    const bilan = bilanJours(s, rr).find(b => b.jour === MAR)!;
    expect(bilan.charge).toBe(480);
    expect(bilan.depasse).toBe(true);
    expect(s.elements.some(e => e.surcharge)).toBe(true);
  });

  it('retire puis remet un élément', () => {
    const s = base();
    const retire = retirerElement(s, r, 'tache:a');
    expect(retire.elements.find(e => e.id === 'tache:a')).toBeUndefined();
    expect(retire.retires.map(e => e.id)).toEqual(['tache:a']);
    const remis = remettreElement(retire, r, 'tache:a');
    expect(remis.retires).toHaveLength(0);
    expect(jourDe(remis, 'tache:a')).toBe(jourDe(s, 'tache:a'));
  });

  it('place un élément à arbitrer sur le jour choisi', () => {
    const taches = Array.from({ length: 8 }, (_, i) => tache(`t${i}`, { dureeMin: 120, echeance: VEN }));
    const rr = reglages({ chargeMax: 180 });
    const s = proposerSemaine(entree({ taches, reglages: rr }));
    expect(s.nonPlaces).toHaveLength(3);
    const id = s.nonPlaces[0].id;
    const p = deplacerElement(s, rr, id, LUN);
    expect(p.nonPlaces).toHaveLength(2);
    expect(jourDe(p, id)).toBe(LUN);
    expect(p.elements.find(e => e.id === id)!.surcharge).toBe(true);
  });

  it('décale d’un jour sans sortir de la semaine', () => {
    const s = base();
    const lundi = s.elements.find(e => e.jour === LUN);
    if (lundi) {
      expect(decalerElement(s, r, lundi.id, -1)).toBe(s);
      expect(jourDe(decalerElement(s, r, lundi.id, 1), lundi.id)).toBe(MAR);
    }
    const dernier = s.elements[s.elements.length - 1];
    const hors = decalerElement(s, r, dernier.id, 10);
    expect(hors).toBe(s);
  });

  it('un événement à heure imposée perd son épinglage en changeant de jour', () => {
    const s = proposerSemaine(entree({ evenements: [{ id: 'r', genre: 'relance', titre: 'R', jour: LUN, heure: '10:00' }] }));
    expect(s.elements[0].debut).toBe('10:00');
    const d = deplacerElement(s, r, 'relance:r', MAR);
    expect(d.elements[0].epingle).toBeUndefined();
    expect(d.elements[0].debut).toBe('09:00');
  });
});

describe('empaqueterJour', () => {
  it('range un jour vide et ne perd rien', () => {
    expect(empaqueterJour([], reglages(), LUN)).toEqual([]);
  });
});

describe('réglages', () => {
  it('prend les valeurs par défaut pour tout ce qui est invalide', () => {
    const l = lireReglagesPilote({ jour: 12, heure: '25:00', creneaux: [{ debut: '10:00', fin: '09:00' }], chargeMax: 5, joursOff: [1, 2, 3, 4, 5, 6, 7], episodesParJour: 99, dureeDefaut: 'x' });
    expect(l).toEqual({ ...REGLAGES_PILOTE_DEFAUT, jour: 7, chargeMax: 60, episodesParJour: 4 });
  });

  it('garde des réglages valides et écarte les créneaux qui se chevauchent', () => {
    const l = lireReglagesPilote({ jour: 5, heure: '17:30', creneaux: [{ debut: '08:00', fin: '12:00' }, { debut: '11:00', fin: '13:00' }, { debut: '14:00', fin: '16:00' }], chargeMax: 300, joursOff: [7, 6, 6], recompenses: false });
    expect(l.jour).toBe(5);
    expect(l.heure).toBe('17:30');
    expect(l.creneaux).toEqual([{ debut: '08:00', fin: '12:00' }, { debut: '14:00', fin: '16:00' }]);
    expect(l.joursOff).toEqual([6, 7]);
    expect(l.recompenses).toBe(false);
  });

  it('tolère n’importe quoi', () => {
    expect(lireReglagesPilote(null)).toEqual(REGLAGES_PILOTE_DEFAUT);
    expect(lireReglagesPilote('x')).toEqual(REGLAGES_PILOTE_DEFAUT);
  });
});

describe('quand proposer', () => {
  const r = { jour: 7, heure: '18:00' };
  const ms = (y: number, mo: number, j: number, h: number, mi = 0) => new Date(y, mo - 1, j, h, mi).getTime();

  it('le dimanche à 18 h, la semaine proposée est la suivante', () => {
    const p = semaineProposee(ms(2026, 10, 18, 18, 5), r, '2026-10-18');
    expect(p.lundi).toBe('2026-10-19');
  });

  it('le dimanche avant l’heure, on reste sur la semaine en cours', () => {
    expect(semaineProposee(ms(2026, 10, 18, 17, 59), r, '2026-10-18').lundi).toBe('2026-10-12');
  });

  it('en milieu de semaine, la semaine en cours', () => {
    expect(semaineProposee(ms(2026, 10, 21, 9), r, '2026-10-21').lundi).toBe('2026-10-19');
  });

  it('jour réglable : le vendredi', () => {
    expect(semaineProposee(ms(2026, 10, 23, 19), { jour: 5, heure: '18:00' }, '2026-10-23').lundi).toBe('2026-10-26');
    expect(derniereProposition(ms(2026, 10, 23, 17), { jour: 5, heure: '18:00' }, '2026-10-23').jour).toBe('2026-10-16');
  });
});

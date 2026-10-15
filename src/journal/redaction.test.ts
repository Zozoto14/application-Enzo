/**
 * Génération du texte : sections, chiffres clés, fait marquant, variété des
 * tournures, reproductibilité, point d'extension IA.
 */

import type { RedacteurExterne } from '../hub/journal/contrat';
import { agreger } from './agregation';
import { episodes, rediger, redigerAvecExterne, resumePourRedacteur } from './redaction';
import { JOUR, ev, journeeRemplie } from './__fixtures__/outils';

const texteDe = (jour: string, evenements = journeeRemplie(jour)) => {
  const a = rediger(agreger(jour, evenements));
  return [a.intro, ...a.sections.flatMap(s => s.paragraphes), a.marquant?.texte ?? '', a.cloture].join('\n');
};

describe('rédaction de la page', () => {
  it('écrit une section par app qui a de la matière, dans un français naturel', () => {
    const a = rediger(agreger(JOUR, journeeRemplie()));
    expect(a.sections.map(s => s.id)).toEqual(['taches', 'office', 'tsuzuku', 'portefeuille', 'affaires', 'decisions']);
    expect(a.intro.startsWith('Mardi 13 octobre 2026.')).toBe(true);
    const tout = texteDe(JOUR);
    expect(tout).toContain('« Relire le contrat Atelier Lune »');
    expect(tout).toContain('ép. 4 à 6');
    expect(tout).toContain('1 h 35');
    expect(tout).toContain('1\u202f234,50');
    expect(tout).toContain('+1,25\u00a0%');
    expect(tout).toContain('Ensoleillé, 19 °C');
    expect(a.moteur).toBe('modeles');
  });

  it('donne les chiffres clés de la journée', () => {
    const c = Object.fromEntries(rediger(agreger(JOUR, journeeRemplie())).chiffres.map(x => [x.id, x.valeur]));
    expect(c).toMatchObject({ 'taches-finies': '3', 'taches-creees': '1', sessions: '1 · 1 h 35', episodes: '3', operations: '1', variation: '+1,25\u00a0%', relances: '1', decisions: '1' });
    expect(c.paiements).toMatch(/^45\s€$/);
  });

  it('met en avant un fait marquant', () => {
    const a = rediger(agreger(JOUR, journeeRemplie()));
    expect(a.marquant).toEqual({ texte: expect.stringContaining('Garder le plan d’épargne mensuel'), famille: 'decisions' });
  });

  it('une journée sans activité : section vide, texte honnête, pas de fait marquant', () => {
    const a = rediger(agreger(JOUR, []));
    expect(a.sections).toEqual([]);
    expect(a.chiffres).toEqual([]);
    expect(a.marquant).toBeUndefined();
    expect(a.intro).toMatch(/silencieuses|pause|ailleurs/);
    expect(a.accroche).toMatch(/tranquille|légère|sans bruit/);
  });

  it('est reproductible : même journée, même texte', () => {
    expect(texteDe(JOUR)).toBe(texteDe(JOUR));
  });

  it('varie les tournures d’un jour à l’autre (au moins 4 formulations d’intro différentes sur 28 jours)', () => {
    const intros = new Set<string>();
    for (let i = 1; i <= 28; i++) {
      const jour = `2026-10-${String(i).padStart(2, '0')}`;
      intros.add(rediger(agreger(jour, journeeRemplie(jour))).intro.replace(/^[^.]*\.\s/, '').replace(/\d+/g, 'N').replace(/\s(Météo du jour|Côté ciel|Dehors).*/, ''));
    }
    expect(intros.size).toBeGreaterThanOrEqual(4);
    const clotures = new Set<string>();
    for (let i = 1; i <= 28; i++) {
      const jour = `2026-10-${String(i).padStart(2, '0')}`;
      clotures.add(rediger(agreger(jour, journeeRemplie(jour))).cloture);
    }
    expect(clotures.size).toBeGreaterThanOrEqual(4);
  });

  it('accorde les phrases : une seule tâche, une seule session', () => {
    const a = rediger(agreger(JOUR, [ev({ id: 't', famille: 'taches', genre: 'tache-terminee', titre: 'Payer la taxe' }), ev({ id: 's', famille: 'office', genre: 'session-office', titre: 'Corriger le bug', nombre: 12 })]));
    const taches = a.sections.find(s => s.id === 'taches')!.paragraphes.join(' ');
    expect(taches).toContain('« Payer la taxe »');
    expect(taches).not.toMatch(/\b1 tâches/);
    const office = a.sections.find(s => s.id === 'office')!.paragraphes.join(' ');
    expect(office).not.toMatch(/\b1 sessions/);
    expect(office).not.toMatch(/Elles ont/);
  });

  it('plafonne les listes longues (« et 3 autres »)', () => {
    const taches = Array.from({ length: 8 }, (_, i) => ev({ id: `t${i}`, famille: 'taches', genre: 'tache-terminee', titre: `Tâche ${i}` }));
    const p = rediger(agreger(JOUR, taches)).sections[0].paragraphes.join(' ');
    expect(p).toContain('et 4 autres');
    expect(p).toContain('8 tâches');
  });

  it('décrit une baisse et une quasi-stabilité du portefeuille', () => {
    const baisse = rediger(agreger(JOUR, [ev({ id: 'v', famille: 'portefeuille', genre: 'variation-portefeuille', titre: 'v', pourcentage: -2.5 })]));
    expect(baisse.sections[0].paragraphes.join(' ')).toMatch(/cède|recul|froid/);
    const stable = rediger(agreger(JOUR, [ev({ id: 'v', famille: 'portefeuille', genre: 'variation-portefeuille', titre: 'v', pourcentage: 0.02 })]));
    expect(stable.sections[0].paragraphes.join(' ')).toMatch(/presque pas bougé|sans relief/);
  });

  it('écrit les épisodes : un seul, plusieurs, non contigus, film', () => {
    expect(episodes([4])).toBe('ép. 4');
    expect(episodes([4, 5, 6])).toBe('ép. 4 à 6');
    expect(episodes([1, 3, 9])).toBe('ép. 1, 3 et 9');
    const film = rediger(agreger(JOUR, [ev({ id: 'f', famille: 'tsuzuku', genre: 'episode-vu', titre: 'Film exemple', groupe: 'Film exemple', detail: 'film' })]));
    expect(film.sections[0].paragraphes.join(' ')).toContain('« Film exemple »');
  });

  it('précise qu’une page demandée avant la fin de la journée peut être réécrite', () => {
    expect(rediger(agreger(JOUR, []), { enCours: true }).cloture).toContain('avant la fin de la journée');
    expect(rediger(agreger(JOUR, [])).cloture).not.toContain('avant la fin');
  });
});

describe('rédaction par IA (point d’extension, désactivé par défaut)', () => {
  const resume = agreger(JOUR, journeeRemplie());
  const base = rediger(resume);

  it('ne fait rien sans rédacteur : les modèles écrivent', async () => {
    expect(await redigerAvecExterne(resume, base, undefined)).toBeUndefined();
  });

  it('ne reçoit que des faits : aucun montant, aucun identifiant', () => {
    const r = JSON.stringify(resumePourRedacteur(resume));
    expect(r).not.toMatch(/1234|montant|"id"|310/);
    expect(r).toContain('Relire le contrat Atelier Lune');
  });

  it('remplace l’intro, les sections et la clôture, et garde les chiffres et le fait marquant des modèles', async () => {
    const redacteur: RedacteurExterne = {
      id: 'x',
      nom: 'Rédacteur de test',
      rediger: async () => ({ intro: 'Une belle journée.', sections: [{ id: 's', titre: 'Résumé', paragraphes: ['Tout va bien.'] }], cloture: 'Bonne nuit.' }),
    };
    const r = await redigerAvecExterne(resume, base, redacteur);
    expect(r).toMatchObject({ moteur: 'ia', cloture: 'Bonne nuit.', chiffres: base.chiffres, marquant: base.marquant });
    expect(r?.intro).toBe('Mardi 13 octobre 2026. Une belle journée.');
    expect(r?.sections).toEqual([{ id: 's', titre: 'Résumé', paragraphes: ['Tout va bien.'] }]);
  });

  it('retombe sur les modèles si le rédacteur échoue, est trop lent ou répond n’importe quoi', async () => {
    const echec: RedacteurExterne = { id: 'e', nom: 'e', rediger: async () => { throw new Error('hors ligne'); } };
    const lent: RedacteurExterne = { id: 'l', nom: 'l', rediger: () => new Promise(() => undefined) };
    const vide: RedacteurExterne = { id: 'v', nom: 'v', rediger: async () => undefined };
    const faux: RedacteurExterne = { id: 'f', nom: 'f', rediger: async () => ({ intro: '', sections: [] }) };
    expect(await redigerAvecExterne(resume, base, echec)).toBeUndefined();
    expect(await redigerAvecExterne(resume, base, lent, 30)).toBeUndefined();
    expect(await redigerAvecExterne(resume, base, vide)).toBeUndefined();
    expect(await redigerAvecExterne(resume, base, faux)).toBeUndefined();
  });
});

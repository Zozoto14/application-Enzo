import { planningVersJson, PLANNING_DEFAUT } from './planification';
import { rappelsDus, retenirRappels } from './rappelVerrouille';

describe('rappel de briefing, application verrouillée', () => {
  const planning = planningVersJson({ ...PLANNING_DEFAUT, lundi: { actif: true, matin: '08:00', soir: '18:00' } });
  const lundi8h05 = new Date(2026, 8, 21, 8, 5);

  it('prévient à l’heure du briefing, sans aucun chiffre', () => {
    const [rappel] = rappelsDus(planning, lundi8h05, []);
    expect(rappel.identifiant).toBe('rappel-briefing-2026-09-21-matin');
    expect(rappel.titre).toMatch(/briefing du matin est prêt/);
    expect(rappel.corps).not.toMatch(/\d/);
  });

  it('ne répète pas un rappel déjà envoyé', () => {
    expect(rappelsDus(planning, lundi8h05, ['rappel-briefing-2026-09-21-matin'])).toEqual([]);
  });

  it('se tait sans planning recopié', () => {
    expect(rappelsDus(undefined, lundi8h05, [])).toEqual([]);
  });

  it('ne garde que les derniers identifiants', () => {
    expect(retenirRappels(Array.from({ length: 10 }, (_, i) => `r${i}`), ['n'])).toHaveLength(8);
  });
});

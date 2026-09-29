import { aElaguer, estAutomatique, joursAvantProchaine, sauvegardeDue } from './automatique';
import { nomDeFichier } from './fichiers';

const sauvegarde = (date: string, suffixe?: string) => ({
  nom: nomDeFichier(date, suffixe),
  chemin: `/x/${nomDeFichier(date, suffixe)}`,
  description: '',
  date,
});

describe('sauvegarde automatique', () => {
  it('part une fois par semaine', () => {
    expect(sauvegardeDue(undefined, '2026-09-26')).toBe(true);
    expect(sauvegardeDue('2026-09-20', '2026-09-26')).toBe(false);
    expect(sauvegardeDue('2026-09-19', '2026-09-26')).toBe(true);
    expect(joursAvantProchaine('2026-09-24', '2026-09-26')).toBe(5);
  });

  it('ne garde que les huit dernières automatiques, jamais les manuelles', () => {
    const automatiques = Array.from({ length: 10 }, (_, i) => sauvegarde(`2026-0${(i % 9) + 1}-1${i % 9}`, 'auto'));
    const manuelle = sauvegarde('2025-01-01');
    expect(estAutomatique(automatiques[0])).toBe(true);
    expect(estAutomatique(manuelle)).toBe(false);
    const supprimees = aElaguer([...automatiques, manuelle]);
    expect(supprimees).toHaveLength(2);
    expect(supprimees).not.toContain(manuelle);
    expect(supprimees.every(s => s.nom < automatiques.map(a => a.nom).sort().reverse()[7])).toBe(true);
  });
});

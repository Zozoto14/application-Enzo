/**
 * Recherche dans le journal : sans casse ni accents, tous les mots, notes comprises.
 */

import { agreger } from './agregation';
import type { PageJournal } from './modele';
import { chercher, normaliser } from './recherche';
import { rediger } from './redaction';
import { journeeRemplie } from './__fixtures__/outils';

const page = (jour: string, extra: Partial<PageJournal> = {}): PageJournal => {
  const r = agreger(jour, journeeRemplie(jour));
  return { v: 1, jour, auto: rediger(r), compteurs: r.compteurs, nbEvenements: r.evenements.length, ecritLe: `${jour}T21:00:00.000Z`, ...extra };
};
const pages = [page('2026-10-12'), page('2026-10-13', { note: 'Rendez-vous chez le médecin demain', epingle: true }), page('2026-10-14')];

describe('recherche', () => {
  it('normalise : sans accents ni majuscules', () => {
    expect(normaliser('Épisodes À Vérifier')).toBe('episodes a verifier');
  });

  it('trouve un titre de tâche, les plus récentes pages d’abord', () => {
    const r = chercher(pages, 'contrat atelier');
    expect(r.map(x => x.jour)).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    expect(r[0].extrait.toLowerCase()).toContain('contrat');
  });

  it('ignore la casse et les accents', () => {
    expect(chercher(pages, 'AVENTURE du phare')).toHaveLength(3);
    expect(chercher(pages, 'medecin')).toHaveLength(1);
    expect(chercher(pages, 'MÉDECIN')[0]).toMatchObject({ jour: '2026-10-13', dans: 'note', epingle: true });
  });

  it('exige tous les mots, dans la même page', () => {
    expect(chercher(pages, 'médecin phare')).toHaveLength(1);
    expect(chercher(pages, 'médecin inexistant')).toEqual([]);
  });

  it('une recherche vide ne trouve rien ; le nombre de résultats est borné', () => {
    expect(chercher(pages, '   ')).toEqual([]);
    expect(chercher(pages, 'phare', 2)).toHaveLength(2);
  });

  it('cherche aussi dans les chiffres clés et le fait marquant', () => {
    expect(chercher(pages, 'plan d’épargne').length).toBe(3);
    expect(chercher(pages, 'sessions claude').length).toBe(3);
  });
});

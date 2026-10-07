import { systemeMemoire } from '../fichiers/systeme';
import type { Rapport } from './annuel';
import { DOSSIER_RAPPORTS, ecrireRapport, listerRapports } from './fichiers';

function rapport(annee: number, html = '<!doctype html><p>x</p>'): Rapport {
  return { nom: `rapport-${annee}.html`, html, anneeVide: false };
}

describe('ecrireRapport', () => {
  it('dépose le rapport dans le dossier des rapports', async () => {
    const fichiers = systemeMemoire();

    const ecrit = await ecrireRapport(fichiers, rapport(2026));

    expect(ecrit.chemin).toBe(`/Documents/${DOSSIER_RAPPORTS}/rapport-2026.html`);
    expect(ecrit.nom).toBe('rapport-2026.html');
    expect(await fichiers.lireTexte(ecrit.chemin)).toContain('<!doctype html>');
  });

  it('crée le dossier au premier rapport', async () => {
    const fichiers = systemeMemoire();

    await ecrireRapport(fichiers, rapport(2026));

    expect(await listerRapports(fichiers)).toEqual(['rapport-2026.html']);
  });

  it('remplace le rapport d’une année déjà générée', async () => {
    // Deux versions d'un meme rapport fiscal sont un piege : on ne garde que
    // la derniere.
    const fichiers = systemeMemoire();
    await ecrireRapport(fichiers, rapport(2026, '<!doctype html><p>ancien</p>'));

    const ecrit = await ecrireRapport(fichiers, rapport(2026, '<!doctype html><p>neuf</p>'));

    expect(await fichiers.lireTexte(ecrit.chemin)).toContain('neuf');
    expect(await listerRapports(fichiers)).toHaveLength(1);
  });
});

describe('listerRapports', () => {
  it('ne rend rien avant le premier rapport', async () => {
    expect(await listerRapports(systemeMemoire())).toEqual([]);
  });

  it('classe du plus récent au plus ancien', async () => {
    const fichiers = systemeMemoire();
    await ecrireRapport(fichiers, rapport(2024));
    await ecrireRapport(fichiers, rapport(2026));
    await ecrireRapport(fichiers, rapport(2025));

    expect(await listerRapports(fichiers)).toEqual([
      'rapport-2026.html',
      'rapport-2025.html',
      'rapport-2024.html',
    ]);
  });

  it('ignore ce qui n’est pas un rapport', async () => {
    const fichiers = systemeMemoire();
    await ecrireRapport(fichiers, rapport(2026));
    await fichiers.ecrireTexte(`/Documents/${DOSSIER_RAPPORTS}/notes.txt`, 'x');

    expect(await listerRapports(fichiers)).toEqual(['rapport-2026.html']);
  });
});

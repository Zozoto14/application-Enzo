import { executerDiagnostic, rapportTexte } from './verifications';

describe('diagnostic', () => {
  it('teste chaque service indépendamment, et dit pourquoi un échec', async () => {
    let temps = 0;
    const vus: string[] = [];
    const resultats = await executerDiagnostic(
      [
        { cle: 'cours', libelle: 'Cours Yahoo', executer: async () => ((temps += 400), 'Air Liquide : 177 €') },
        { cle: 'voix', libelle: 'Voix naturelles', executer: async () => { throw new Error('connexion refusée'); } },
        { cle: 'lent', libelle: 'Service lent', executer: () => new Promise<string>(() => undefined) },
        { cle: 'notif', libelle: 'Notifications', motifAbsence: 'Uniquement sur l’ordinateur.' },
      ],
      verification => vus.push(verification.cle),
      50,
      () => temps,
    );
    expect(resultats.map(r => r.statut)).toEqual(['ok', 'echec', 'echec', 'absent']);
    expect(resultats[0].dureeMs).toBe(400);
    expect(resultats[1].detail).toBe('connexion refusée');
    expect(resultats[2].detail).toMatch(/pas de réponse/);
    expect(vus).toHaveLength(4);

    const texte = rapportTexte(resultats, '26/09/2026 14:00');
    expect(texte.split('\n')[0]).toBe('Diagnostic AppliBourse — 26/09/2026 14:00');
    expect(texte).toContain('❌ Voix naturelles : connexion refusée');
    expect(texte).toContain('➖ Notifications : Uniquement sur l’ordinateur.');
  });
});

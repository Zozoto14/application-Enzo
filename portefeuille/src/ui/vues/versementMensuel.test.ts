import { identifiantVersement, messageVersement, reglageVersementDepuisJson, versementDu } from './versementMensuel';

describe('rappel de versement mensuel', () => {
  const reglage = { actif: true, jour: 5, montant: 200 };

  it('part une fois par mois, le jour choisi ou après, dès 9 heures', () => {
    expect(versementDu(reglage, new Date(2026, 9, 4, 12), new Set())).toBe(false);
    expect(versementDu(reglage, new Date(2026, 9, 5, 8), new Set())).toBe(false);
    expect(versementDu(reglage, new Date(2026, 9, 5, 9), new Set())).toBe(true);
    expect(versementDu(reglage, new Date(2026, 9, 12, 9), new Set())).toBe(true);
    expect(versementDu(reglage, new Date(2026, 9, 12, 9), new Set([identifiantVersement(new Date(2026, 9, 1))]))).toBe(false);
    expect(versementDu({ ...reglage, actif: false }, new Date(2026, 9, 5, 10), new Set())).toBe(false);
  });

  it('propose les achats qui rapprochent de la cible', () => {
    const message = messageVersement(reglage, [
      { titreId: 'a', nom: 'Air Liquide', montant: 120, poidsAvant: 30, poidsApres: 32, cible: 35 },
      { titreId: 'b', nom: 'MSCI World', montant: 80, poidsAvant: 70, poidsApres: 68, cible: 65 },
      { titreId: 'c', nom: 'Stellantis', montant: 0, poidsAvant: 0, poidsApres: 0, cible: 0 },
    ]);
    expect(message.titre).toBe('💰 C’est le 5 : vous versez vos 200 € ?');
    expect(message.corps).toBe('Pour rester sur votre cible : Air Liquide +120 € · MSCI World +80 €.');
  });

  it('relit un réglage abîmé avec des valeurs sûres', () => {
    expect(reglageVersementDepuisJson('{"actif":true,"jour":40,"montant":-3}')).toEqual({ actif: true, jour: 28, montant: 200, compteId: undefined });
    expect(reglageVersementDepuisJson('pas du json').actif).toBe(false);
  });
});

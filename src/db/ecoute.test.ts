import { DepotComptes, DepotParametres, DepotWatchlist, PARAMETRES } from './depots';
import { compte } from '../core/testing/fixtures';
import { ecouterEcritures, ecritureSynchronisee } from './ecoute';
import { ouvrirBaseNode } from './pilotes/node';
import { migrer } from './schema';

describe('écoute des écritures synchronisées', () => {
  it('prévient pour les données partagées, pas pour les cours ni l’état de la synchro', () => {
    const brut = ouvrirBaseNode();
    migrer(brut);
    const rappels = new Set<() => void>();
    const pilote = ecouterEcritures(brut, rappels);
    let n = 0;
    rappels.add(() => n++);
    new DepotComptes(pilote).enregistrer(compte());
    expect(n).toBe(1);
    new DepotParametres(pilote).ecrire(PARAMETRES.etatSynchro, '{}');
    new DepotParametres(pilote).ecrire(PARAMETRES.relaisSynchro, '{}');
    new DepotParametres(pilote).ecrire('cours.historique_charge_le', '2026-01-01');
    pilote.executer('DELETE FROM cours');
    expect(n).toBe(1);
    new DepotParametres(pilote).ecrire('hub.theme', 'ivoire');
    new DepotParametres(pilote).ecrire(PARAMETRES.theme, 'clair');
    new DepotParametres(pilote).ecrire('hub.devblog', '{}');
    expect(n).toBe(4);
    expect(new DepotWatchlist(pilote).lister()).toEqual([]);
    brut.fermer();
  });

  it('reconnaît les tables et paramètres partagés', () => {
    expect(ecritureSynchronisee('INSERT INTO transactions (a) VALUES (?)', [1])).toBe(true);
    expect(ecritureSynchronisee('DELETE FROM watchlist WHERE titre_id = ?', ['x'])).toBe(true);
    expect(ecritureSynchronisee('INSERT INTO parametres (cle, valeur) VALUES (?, ?)', ['sync.etat', 'x'])).toBe(false);
    expect(ecritureSynchronisee('INSERT INTO cours (a) VALUES (?)', [1])).toBe(false);
  });
});

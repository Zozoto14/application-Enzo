import { appsVisibles, ID_ADMINISTRATION, type ContexteHub } from '@hub';
import { nettoyerApps, type Profil } from '../profils/profils';
import { APP_PORTEFEUILLE, ID_PORTEFEUILLE, REGISTRE, infoPortefeuille } from './registreHub';

const admin: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
const ami: Profil = { id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps: [ID_PORTEFEUILLE, ID_ADMINISTRATION], actif: true };
const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];

describe('branchement du portefeuille sur le hub', () => {
  it('enregistre le portefeuille puis l’administration', () => {
    expect(REGISTRE.map(app => app.id)).toEqual([ID_PORTEFEUILLE, ID_ADMINISTRATION]);
    expect(appsVisibles(REGISTRE, { profil: admin, profils: controle }).map(a => a.id)).toEqual([ID_PORTEFEUILLE, ID_ADMINISTRATION]);
    expect(appsVisibles(REGISTRE, { profil: ami, profils: controle }).map(a => a.id)).toEqual([ID_PORTEFEUILLE]);
  });

  it('la tuile lit le résumé publié dans le contexte', () => {
    const resume = { valeur: '12 345 €', sansCompte: false, variation: { pourcentage: '+1,2 %', montant: '+150 €', tendance: 'hausse' as const, date: '28/09' } };
    expect(APP_PORTEFEUILLE.info?.({ donnees: { [ID_PORTEFEUILLE]: resume } })).toEqual(infoPortefeuille(resume));
    expect(infoPortefeuille(resume)?.indicateurs[0]).toEqual({ libelle: 'Valeur', valeur: '12 345 €' });
    expect(infoPortefeuille({ valeur: '0 €', sansCompte: true })?.indicateurs).toEqual([]);
    expect(APP_PORTEFEUILLE.info?.({})).toBeUndefined();
  });

  it('migre l’ancien identifiant « portfolio » dans les autorisations', () => {
    expect(nettoyerApps(['portfolio', 'portefeuille'])).toEqual(['portefeuille']);
  });
});

/**
 * Site et app PC : le dictionnaire anglais et la table des erreurs du serveur sont téléchargés à la demande
 * (anglais.web.ts). Avant leur arrivée, les textes restent en français (jamais une clé brute ni une erreur) ; à leur
 * arrivée, les écrans abonnés sont prévenus et passent à l'anglais.
 */

jest.mock('./anglais', () => jest.requireActual('./anglais.web'));

import { definirLangue, preparerLangue, abonnerLangue, tr } from './index';
import { traduireServeur } from './erreurs';
import { dictionnaireAnglais } from './anglais';
import { chargeurs } from './anglais.web';

// Le module mocké est le même que anglais.web : on remplace seulement les import() par des require().
const web = jest.requireMock('./anglais') as { chargeurs: typeof chargeurs };
web.chargeurs.dictionnaire = async () => jest.requireActual('./en');
web.chargeurs.table = async () => jest.requireActual('../../../esport/noyau/erreurs.json');

afterEach(() => definirLangue('fr'));

it('français : rien à télécharger, prêt tout de suite', async () => {
  definirLangue('fr');
  await preparerLangue('fr');
  expect(dictionnaireAnglais()).toBeUndefined();
  expect(tr('client.le_serveur_esport_ne')).toBe('Le serveur Esport ne répond pas.');
});

it('anglais : français en attendant, puis anglais, et les abonnés sont prévenus à l’arrivée', async () => {
  const prevenu = jest.fn();
  const desabonner = abonnerLangue(prevenu);
  definirLangue('en');
  // Pas encore téléchargé : le texte français, jamais la clé.
  expect(tr('client.le_serveur_esport_ne')).toBe('Le serveur Esport ne répond pas.');
  expect(traduireServeur('Requête trop volumineuse.')).toBe('Requête trop volumineuse.');
  await preparerLangue('en');
  expect(tr('client.le_serveur_esport_ne')).toBe('The Esport server isn’t responding.');
  expect(traduireServeur('Requête trop volumineuse.')).toBe('Request too large.');
  // Une fois au changement de langue, une fois à l'arrivée du dictionnaire.
  expect(prevenu).toHaveBeenCalledTimes(2);
  desabonner();
});

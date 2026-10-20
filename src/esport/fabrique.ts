/**
 * Fabrique du client Esport de cet appareil (relais relié + client HTTP),
 * remplaçable par les tests. Partagée par l'app Esport et par
 * l'Administration (retrait d'un compte supprimé, `synchroAdmin.ts`).
 */

import { relaisDuCompte } from '../sync/relais/actif';
import { clientEsport } from './client';

export const fabrique = {
  relais: () => relaisDuCompte(),
  client: clientEsport,
};

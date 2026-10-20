/**
 * Site et app PC : l'Esport est chargé à la demande, dans un fichier séparé
 * du bundle principal (Vite découpe l'`import()`). Le hub s'affiche sans
 * attendre son code.
 */

import type { PropsRacineApp } from '../../hub/types';
import { differe } from './attente';

export const EsportDiffere = differe<PropsRacineApp>(async () => (await import('./RacineEsport')).Esport);

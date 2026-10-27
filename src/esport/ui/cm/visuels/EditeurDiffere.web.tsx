/**
 * Site et app PC : l'éditeur de visuels (Konva, polices embarquées) est chargé à la demande, dans un
 * fichier séparé, seulement quand on l'ouvre.
 */

import React, { Suspense } from 'react';
import { Text } from 'react-native';
import { trVi } from '../../../i18n/visuels';
import { attenue } from '../../design';
import type { PropsEditeurVisuel } from './typesEditeur';

const Editeur = React.lazy(async () => ({ default: (await import('./Editeur.web')).EditeurVisuel }));

export function EditeurDiffere(p: PropsEditeurVisuel) {
  return (
    <Suspense fallback={<Text style={attenue(p.theme)}>{trVi('editeur.chargement')}</Text>}>
      <Editeur {...p} />
    </Suspense>
  );
}

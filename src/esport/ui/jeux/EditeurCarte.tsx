/** Plan d'une map (app mobile) : l'édition des maps (image, calibrage, callouts) se fait sur le site ou l'app PC. */

import React from 'react';
import { Text } from 'react-native';
import type { CarteJeu } from '../../jeux/api';
import { trJc } from '../../i18n/jeuxCartes';

export interface PropsPlanCarte {
  carte: CarteJeu;
  url: string | null;
  largeur?: number;
  hauteur?: number;
  taille: number;
  points: number[];
  fermer: boolean;
  onPoint(x: number, y: number): void;
}

export const planDisponible = false;

export default function PlanCarte(_: PropsPlanCarte) {
  return <Text testID="esport-jeu-plan-indisponible">{trJc('carte.image_web')}</Text>;
}

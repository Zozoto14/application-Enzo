/**
 * Choix de la langue de l'Esport (Français / English), dans le profil de l'utilisateur et, pour les
 * messages Discord, dans les réglages Discord de la team. Les noms des langues sont écrits dans leur
 * propre langue (ils ne se traduisent pas).
 */

import React from 'react';
import type { ThemeHub } from '../../hub/themes';
import { LANGUES, NOM_LANGUE, type Langue } from '../i18n';
import { Choix } from './commun';

export function ChoixLangue({ theme, libelle, valeur, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: Langue; onChoisir(l: Langue): void; testID: string }) {
  return <Choix<Langue> theme={theme} libelle={libelle} valeur={valeur} options={LANGUES.map(l => ({ id: l, nom: NOM_LANGUE[l] }))} onChoisir={onChoisir} testID={testID} />;
}

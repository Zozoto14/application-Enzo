/**
 * Formulaire d'un badge du catalogue (nom, icône / emoji facultatif, couleur de la palette ou libre, « Réservé au
 * Fondateur » pour lui seul) avec aperçu de la puce. Partagé par le gestionnaire du catalogue (GestionBadges.tsx) et
 * par le panneau d'attribution d'une fiche (EditeurBadges.tsx).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trTb } from '../../i18n/trombi';
import { trCm } from '../../i18n/cm';
import { styles } from '../commun';
import { ESP, attenue } from '../design';
import { PALETTE, Teinte } from '../cm/commun';
import { PuceBadge } from './commun';

export const COULEUR_VALIDE = /^#[0-9a-fA-F]{6}$/;

export type BrouillonBadge = { id: string; nom: string; couleur: string; libre: string; icone: string; reserve: boolean };

export const brouillonVide = (): BrouillonBadge => ({ id: '', nom: '', couleur: PALETTE[5][0], libre: '', icone: '', reserve: false });
export const libreOk = (b: BrouillonBadge) => !b.libre || COULEUR_VALIDE.test(b.libre);
/** Enregistrable : un nom et une couleur libre valide. */
export const brouillonValide = (b: BrouillonBadge) => libreOk(b) && Boolean(b.nom.trim());

export function FormulaireBadge({ theme, brouillon: b, maj, prefixe, fondateur }: { theme: ThemeHub; brouillon: BrouillonBadge; maj(b: BrouillonBadge): void; prefixe: string; fondateur: boolean }) {
  return (
    <View style={{ gap: ESP.xs }}>
      <PuceBadge theme={theme} badge={{ nom: b.nom || trTb('badges.nom'), couleur: b.couleur, icone: b.icone, teamNom: null }} />
      <Champ theme={theme} libelle={trTb('badges.nom')} valeur={b.nom} onChanger={nom => maj({ ...b, nom })} maxLength={32} testID={`${prefixe}-nom`} />
      <Champ theme={theme} libelle={trTb('badges.icone')} valeur={b.icone} placeholder="★" onChanger={icone => maj({ ...b, icone })} maxLength={16} testID={`${prefixe}-icone`} />
      <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trTb('badges.couleur')}>
        {PALETTE.map(([couleur, cle]) => (
          <Teinte key={couleur} theme={theme} couleur={couleur} choisie={b.couleur.toLowerCase() === couleur} libelle={trCm(cle)} onPress={() => maj({ ...b, couleur, libre: '' })} testID={`${prefixe}-couleur-${couleur.slice(1)}`} />
        ))}
      </View>
      <Champ theme={theme} libelle={trTb('badges.couleur_libre')} valeur={b.libre} placeholder={b.couleur} onChanger={libre => maj({ ...b, libre, couleur: COULEUR_VALIDE.test(libre) ? libre.toLowerCase() : b.couleur })} maxLength={7} testID={`${prefixe}-libre`} />
      {!libreOk(b) ? <Text style={{ color: theme.critique, fontSize: 13 }}>{trTb('badges.couleur_invalide')}</Text> : null}
      {fondateur ? (
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Interrupteur theme={theme} libelle={trTb('badges.reserve')} valeur={b.reserve} onChanger={reserve => maj({ ...b, reserve })} testID={`${prefixe}-reserve`} />
          <Text style={attenue(theme)}>{`${trTb('badges.reserve')} — ${trTb('badges.reserve_aide')}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

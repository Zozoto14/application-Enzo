/**
 * Pastille de l'en-tête du hub (Fondateur, ou compte qui a la permission du club deploiement.voir) :
 * « Mise à jour en cours… (≈ X min) », puis « À jour » ; en cas d'échec du workflow GitHub, alerte « Mise à jour non
 * publiée » (tests en échec) à signaler au développeur. Un clic ouvre la page Paramètres › Administration › Mises à jour.
 * « À jour » ne reste affiché que 2 minutes après une mise à jour suivie : ensuite, la pastille disparaît.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLangue } from '../../esport/i18n';
import { police, teinteTransparente, type ThemeHub } from '../themes';
import { tt } from '../../ui/mobile/jetons';
import { pastillePour, useEtatDeploiement, type Ton } from './deploiement';

const A_JOUR_VISIBLE_MS = 2 * 60_000;

export function couleurTon(theme: ThemeHub, ton: Ton): string {
  return ton === 'alerte' ? theme.critique : ton === 'attente' ? theme.alerte : theme.ok;
}

export function PastilleDeploiement({ theme, actif, onOuvrir }: { theme: ThemeHub; actif: boolean; onOuvrir?(): void }) {
  useLangue();
  const { etat } = useEtatDeploiement(actif);
  const pastille = pastillePour(etat);
  // « À jour » : seulement juste après une mise à jour qu'on a vue passer (sinon la pastille encombrerait l'en-tête).
  const vuEnCours = useRef(false);
  const [aJourJusqua, setAJourJusqua] = useState(0);
  useEffect(() => {
    if (etat?.etat === 'en-cours') vuEnCours.current = true;
    else if (etat?.etat === 'a-jour' && vuEnCours.current) {
      vuEnCours.current = false;
      setAJourJusqua(Date.now() + A_JOUR_VISIBLE_MS);
      const t = setTimeout(() => setAJourJusqua(0), A_JOUR_VISIBLE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [etat?.etat]);
  if (!pastille || (pastille.ton === 'ok' && Date.now() > aJourJusqua)) return null;
  const couleur = couleurTon(theme, pastille.ton);
  return (
    <View>
      <Pressable
        testID={`hub-pastille-deploiement-${etat?.etat}`}
        accessibilityRole="button"
        accessibilityLabel={`${pastille.texte}. ${pastille.titre}`}
        accessibilityLiveRegion="polite"
        // Infobulle au survol (web).
        {...({ title: pastille.titre } as object)}
        onPress={onOuvrir}
        style={(e: { pressed: boolean; hovered?: boolean }) => [
          styles.pastille,
          { borderColor: couleur, backgroundColor: teinteTransparente(couleur, e.hovered ? 0.18 : 0.1), borderRadius: 999 },
        ]}>
        <View style={[styles.point, { backgroundColor: couleur }]} />
        <Text style={{ color: theme.texte, fontSize: tt(13), fontWeight: '600', ...police(theme.policeTexte) }} numberOfLines={1}>
          {pastille.texte}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pastille: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1 },
  point: { width: 8, height: 8, borderRadius: 4 },
});

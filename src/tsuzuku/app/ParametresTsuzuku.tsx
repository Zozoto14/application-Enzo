/**
 * Paramètres › Tsuzuku (tous les rangs) : réglages de CONFORT seulement —
 * doublage préféré, épisode suivant automatique, masquer les déjà vus. Rangés
 * dans la base du profil. Tout ce qui est technique (sources, clés d'API,
 * options du moteur) est en Administration › Tsuzuku (`AdminTsuzuku.tsx`).
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
import { ct, tt } from '../../ui/mobile/jetons';
import { modeTelephoneCourant } from '../../ui/mobile/useMobile';
import { LANGUES, type Langue } from '../moteur/sources';
import { CLES, type BasePrefs } from '../plateforme/stockage';
import { ecrireReglages, lireReglages, type ReglagesTsuzuku } from './reglages';

const LIBELLE_LANGUE: Record<Langue, string> = { vf: 'VF', vostfr: 'VOSTFR', indifferent: 'Peu importe' };

function useReglages(base: BasePrefs) {
  const [r, setR] = useState<ReglagesTsuzuku>(() => lireReglages(base.lire(CLES.reglages)));
  const [erreur, setErreur] = useState(false);
  const maj = (suite: Partial<ReglagesTsuzuku>) => {
    // Toujours à partir de ce qui est enregistré : une synchro entre-temps n'est pas écrasée.
    const nouveau = { ...lireReglages(base.lire(CLES.reglages)), ...suite };
    try {
      base.ecrire(CLES.reglages, ecrireReglages(nouveau));
      setErreur(false);
    } catch {
      setErreur(true);
    }
    setR(nouveau);
  };
  return { r, maj, erreur };
}

function Segments<T extends string>({ theme, libelle, valeur, options, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: T; options: ReadonlyArray<readonly [T, string]>; onChoisir(v: T): void; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      {options.map(([cle, texte]) => {
        const actif = cle === valeur;
        return (
          <Pressable
            key={cle}
            testID={`${testID}-${cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${libelle} : ${texte}`}
            onPress={() => onChoisir(cle)}
            style={[st.segment, modeTelephoneCourant() && { flexGrow: 1 }, { minHeight: ct(40), borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: actif ? theme.accent : 'transparent', borderColor: actif ? theme.accent : theme.ligne }]}>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: tt(13), ...police(theme.policeTexte) }}>{texte}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const texte = (theme: ThemeHub) => ({ color: theme.texte, fontSize: modeTelephoneCourant() ? 16 : 14, ...police(theme.policeTexte) });

/** Réglage « Lecture et catalogue » : doublage, épisode suivant automatique, déjà vus. */
export function ReglageLectureTsuzuku({ theme, base }: { theme: ThemeHub; base: BasePrefs }) {
  const { r, maj } = useReglages(base);
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <Text style={texte(theme)}>Doublage préféré</Text>
        <Segments theme={theme} libelle="Doublage préféré" valeur={r.langue} options={LANGUES.map(l => [l, LIBELLE_LANGUE[l]] as const)} onChoisir={langue => maj({ langue })} testID="tsuzuku-langue" />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={texte(theme)}>Épisode suivant automatique</Text>
        <Segments theme={theme} libelle="Épisode suivant automatique" valeur={r.suivantAuto ? 'oui' : 'non'} options={[['oui', 'Oui'], ['non', 'Non']] as const} onChoisir={v => maj({ suivantAuto: v === 'oui' })} testID="tsuzuku-suivant" />
      </View>
      <View style={{ gap: 6 }}>
        <Text style={texte(theme)}>Masquer les titres déjà vus dans le catalogue</Text>
        <Segments theme={theme} libelle="Masquer les déjà vus" valeur={r.masquerVus ? 'oui' : 'non'} options={[['oui', 'Oui'], ['non', 'Non']] as const} onChoisir={v => maj({ masquerVus: v === 'oui' })} testID="tsuzuku-masquer" />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  segment: { minHeight: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

/**
 * Paramètres › Tsuzuku : clé TMDB (facultative), doublage préféré, épisode suivant
 * automatique, masquer les déjà vus. Rangés dans la base du profil ; il n'y a pas
 * d'écran de réglages séparé dans l'app.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { police, type ThemeHub } from '../../hub/themes';
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
            style={[st.segment, { borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: actif ? theme.accent : 'transparent', borderColor: actif ? theme.accent : theme.ligne }]}>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{texte}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const texte = (theme: ThemeHub) => ({ color: theme.texte, fontSize: 14, ...police(theme.policeTexte) });
const attenue = (theme: ThemeHub) => ({ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) });

/** Réglage « Clé TMDB ». */
export function ReglageCleTmdb({ theme, base }: { theme: ThemeHub; base: BasePrefs }) {
  const { r, maj, erreur } = useReglages(base);
  const [saisie, setSaisie] = useState('');
  return (
    <View style={{ gap: 10 }}>
      <Text style={attenue(theme)}>
        Facultative. Sans clé, les films viennent de Jikan (films d’animation seulement) ; avec une clé TMDB (gratuite, v3 ou jeton), tout le catalogue de films est disponible. Elle reste dans la base chiffrée de ce compte.
      </Text>
      <TextInput
        testID="tsuzuku-cle-tmdb"
        accessibilityLabel="Clé TMDB"
        value={saisie}
        onChangeText={setSaisie}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={r.cleTmdb ? '•••••••• (clé enregistrée)' : 'Coller la clé TMDB'}
        placeholderTextColor={theme.attenue}
        style={[st.champ, { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), ...police(theme.policeTexte) }]}
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable
          testID="tsuzuku-cle-enregistrer"
          accessibilityRole="button"
          accessibilityLabel="Enregistrer la clé TMDB"
          disabled={!saisie.trim()}
          onPress={() => {
            maj({ cleTmdb: saisie.trim() });
            setSaisie('');
          }}
          style={[st.bouton, { backgroundColor: theme.accent, borderColor: theme.accent, opacity: saisie.trim() ? 1 : 0.45, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
          <Text style={{ color: theme.surAccent, fontWeight: '600' }}>Enregistrer</Text>
        </Pressable>
        {r.cleTmdb ? (
          <Pressable testID="tsuzuku-cle-effacer" accessibilityRole="button" accessibilityLabel="Effacer la clé TMDB" onPress={() => maj({ cleTmdb: '' })} style={[st.bouton, { borderColor: theme.critique, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
            <Text style={{ color: theme.critique, fontWeight: '600' }}>Effacer</Text>
          </Pressable>
        ) : null}
      </View>
      <Text testID="tsuzuku-cle-etat" style={texte(theme)} accessibilityLiveRegion="polite">
        {erreur ? 'Impossible d’enregistrer (base indisponible).' : r.cleTmdb ? '✓ Clé enregistrée.' : 'Aucune clé enregistrée.'}
      </Text>
    </View>
  );
}

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
  champ: { minHeight: 44, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  bouton: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  segment: { minHeight: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

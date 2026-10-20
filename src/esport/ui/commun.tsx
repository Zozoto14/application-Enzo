/**
 * Briques communes des écrans de l'Esport : actions asynchrones avec avis,
 * en-tête de section, pastille de rôle, confirmation en deux temps. Couleurs
 * et polices du thème du hub (8 thèmes, clair et sombre).
 */

import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Avis, BoutonHub } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { ErreurEsport } from '../client';
import { ESP, TYPO, ombre, rayonCarte, titre as styleTitreEsport } from './design';
import { tr } from '../i18n';

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Action asynchrone : indicateur, erreur et avis de réussite. */
export function useAgir() {
  const [enCours, setEnCours] = useState<string | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const vivant = useRef(true);
  React.useEffect(
    () => () => {
      vivant.current = false;
    },
    [],
  );
  const agir = useCallback(async (libelle: string, action: () => Promise<string | void>): Promise<boolean> => {
    setEnCours(libelle);
    setErreur(undefined);
    setAvis(undefined);
    try {
      const fait = await action();
      if (vivant.current && fait) setAvis(fait);
      return true;
    } catch (e) {
      if (vivant.current) setErreur(e instanceof ErreurEsport ? e.message : message(e));
      return false;
    } finally {
      if (vivant.current) setEnCours(undefined);
    }
  }, []);
  return { enCours, erreur, avis, agir, setErreur, setAvis };
}

export function Retours({ theme, erreur, avis, prefixe }: { theme: ThemeHub; erreur?: string; avis?: string; prefixe: string }) {
  return (
    <>
      {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID={`${prefixe}-erreur`} /> : null}
      {avis ? <Avis theme={theme} genre="ok" texte={avis} testID={`${prefixe}-avis`} /> : null}
    </>
  );
}

/** Titre d'une page ou d'un écran de module (voir aussi `EnTetePage` dans design.tsx). */
export function TitreSection({ theme, titre, sous }: { theme: ThemeHub; titre: string; sous?: string }) {
  return (
    <View style={{ gap: ESP.xxs, flexShrink: 1, minWidth: 0 }}>
      <Text accessibilityRole="header" style={styleTitreEsport(theme, 24)}>
        {titre}
      </Text>
      {sous ? <Text style={{ color: theme.attenue, fontSize: TYPO.sousTitre, lineHeight: 21, ...police(theme.policeTexte) }}>{sous}</Text> : null}
    </View>
  );
}

/** Carte de l'Esport (même usage que le Panneau du hub) : rayon, ombre douce, plus d'air. */
export function Panneau({ theme, children, style, testID }: { theme: ThemeHub; children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View
      testID={testID}
      style={[
        { borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonCarte(theme), padding: ESP.l, gap: ESP.m, minWidth: 0, ...ombre(theme) },
        style,
      ]}>
      {children}
    </View>
  );
}

/** Titre d'un bloc dans une carte : lisible (16 px, gras), pas en petites capitales. */
export function Intertitre({ theme, children }: { theme: ThemeHub; children: string }) {
  return (
    <Text accessibilityRole="header" style={{ color: theme.texte, fontSize: 16, fontWeight: '700', textTransform: theme.majuscules ? 'uppercase' : 'none', ...police(theme.policeTexte) }}>
      {children}
    </Text>
  );
}

export function PastilleRole({ theme, nom, couleur, testID }: { theme: ThemeHub; nom: string; couleur: string; testID?: string }) {
  return (
    <View testID={testID} style={[styles.pastille, { borderColor: couleur, backgroundColor: teinteTransparente(couleur, 0.16), borderRadius: theme.rayonGrand ? 999 : 4 }]}>
      <View style={[styles.point, { backgroundColor: couleur }]} />
      <Text style={{ color: theme.texte, fontSize: 13, fontWeight: '600', ...police(theme.policeTexte) }}>{nom}</Text>
    </View>
  );
}

/** Bouton dangereux confirmé par un second appui. */
export function BoutonConfirme({
  theme,
  titre,
  confirmation,
  onConfirme,
  testID,
  desactive,
}: {
  theme: ThemeHub;
  titre: string;
  confirmation: string;
  onConfirme(): void;
  testID: string;
  desactive?: boolean;
}) {
  const [arme, setArme] = useState(false);
  if (!arme) return <BoutonHub theme={theme} titre={titre} variante="danger" onPress={() => setArme(true)} testID={testID} desactive={desactive} />;
  return (
    <View style={styles.ligne}>
      <BoutonHub
        theme={theme}
        titre={confirmation}
        variante="danger"
        onPress={() => {
          setArme(false);
          onConfirme();
        }}
        testID={`${testID}-confirmer`}
      />
      <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setArme(false)} testID={`${testID}-annuler`} />
    </View>
  );
}

/** Choix dans une courte liste (rôles…), en pastilles qui passent à la ligne. */
export function Choix<T extends string>({
  theme,
  libelle,
  valeur,
  options,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: T | undefined;
  options: ReadonlyArray<{ id: T; nom: string; couleur?: string; desactive?: boolean }>;
  onChoisir(v: T): void;
  testID: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{libelle}</Text>
      <View style={styles.ligne} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
        {options.map(o => {
          const actif = o.id === valeur;
          return (
            <Pressable
              key={o.id}
              testID={`${testID}-${o.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif, disabled: o.desactive }}
              accessibilityLabel={`${libelle} : ${o.nom}`}
              disabled={o.desactive}
              onPress={() => onChoisir(o.id)}
              style={[
                styles.choix,
                {
                  borderColor: actif ? (o.couleur ?? theme.accent) : theme.ligne,
                  backgroundColor: actif ? teinteTransparente(o.couleur ?? theme.accent, 0.2) : theme.surface,
                  borderRadius: Math.min(theme.rayonMoyen, 10),
                  opacity: o.desactive ? 0.4 : 1,
                },
              ]}>
              {o.couleur ? <View style={[styles.point, { backgroundColor: o.couleur }]} /> : null}
              <Text style={{ color: theme.texte, fontSize: 13, fontWeight: actif ? '700' : '500', ...police(theme.policeTexte) }}>{o.nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  pastille: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  point: { width: 8, height: 8, borderRadius: 4 },
  // Cible tactile de 44 px (pastilles de choix, utilisées aussi sur téléphone).
  choix: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, minWidth: 44 },
});

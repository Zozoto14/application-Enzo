/**
 * Briques d'interface du Journal : onglets, pastilles, page rédigée, chiffres
 * clés, sélecteur d'humeur. Couleurs et polices du thème du hub (8 thèmes,
 * clair et sombre) ; téléphone : cibles de 44 px au moins, texte de 15 px au
 * moins. Le mode « valeurs masquées » est appliqué par `masquer` à tout texte
 * qui peut porter un montant.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../hub/themes';
import { jourCourt, jourLongMaj } from './dates';
import { HUMEURS, type ChiffreCle, type Humeur, type PageJournal, type SectionPage } from './modele';
import type { Masqueur } from './export';

export interface StyleCommun {
  theme: ThemeHub;
  mobile: boolean;
  masquer: Masqueur;
}

/** Taille de texte : 15 px au moins sur téléphone. */
export const taille = (n: number, mobile: boolean): number => (mobile ? Math.max(n, 15) : n);

export function Onglets<T extends string>({ theme, mobile, valeur, options, onChoisir, testID }: { theme: ThemeHub; mobile: boolean; valeur: T; options: ReadonlyArray<readonly [T, string]>; onChoisir(v: T): void; testID: string }) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  return (
    <View style={[styles.onglets, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="tablist" testID={testID}>
      {options.map(([cle, libelle]) => {
        const actif = cle === valeur;
        return (
          <Pressable
            key={cle}
            testID={`${testID}-${cle}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            aria-selected={actif}
            onPress={() => onChoisir(cle)}
            style={[styles.onglet, { backgroundColor: actif ? theme.accent : 'transparent', minHeight: mobile ? 44 : 38 }]}>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: taille(14, mobile), ...police(theme.policeTexte) }}>{libelle}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bouton d'icône ou de flèche, zone tactile de 44 px. */
export function BoutonRond({ theme, mobile, titre, libelle, onPress, testID, desactive, actif }: { theme: ThemeHub; mobile: boolean; titre: string; libelle: string; onPress(): void; testID?: string; desactive?: boolean; actif?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: Boolean(desactive), selected: actif }}
      disabled={desactive}
      onPress={onPress}
      style={[
        styles.rond,
        { borderColor: actif ? theme.accent : theme.ligne, backgroundColor: actif ? teinteTransparente(theme.accent, 0.16) : theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12), opacity: desactive ? 0.4 : 1 },
      ]}>
      <Text style={{ color: theme.texte, fontSize: taille(18, mobile), ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
}

/** Interrupteur : toute la ligne est la zone tactile (44 px au moins), avec un libellé visible. */
export function Basculeur({ theme, mobile, libelle, valeur, onChanger, desactive, testID }: { theme: ThemeHub; mobile: boolean; libelle: string; valeur: boolean; onChanger(v: boolean): void; desactive?: boolean; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={libelle}
      accessibilityState={{ checked: valeur, disabled: Boolean(desactive) }}
      aria-checked={valeur}
      disabled={desactive}
      onPress={() => onChanger(!valeur)}
      style={[styles.basculeur, { opacity: desactive ? 0.5 : 1 }]}>
      <Text style={{ flex: 1, color: theme.texte, fontSize: taille(15, mobile), ...police(theme.policeTexte) }}>{libelle}</Text>
      <View style={[styles.piste, { backgroundColor: valeur ? theme.accent : theme.ligne, justifyContent: 'center', alignItems: valeur ? 'flex-end' : 'flex-start' }]}>
        <View style={[styles.bouton, { backgroundColor: valeur ? theme.surAccent : theme.surface }]} />
      </View>
    </Pressable>
  );
}

export function SelecteurHumeur({ theme, mobile, valeur, onChoisir }: { theme: ThemeHub; mobile: boolean; valeur?: Humeur; onChoisir(h: Humeur | null): void }) {
  return (
    <View style={styles.humeurs} accessibilityRole="radiogroup" accessibilityLabel="Humeur du jour" testID="journal-humeur">
      {HUMEURS.map(h => {
        const actif = valeur === h.valeur;
        return (
          <Pressable
            key={h.valeur}
            testID={`journal-humeur-${h.valeur}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            aria-checked={actif}
            accessibilityLabel={`Humeur : ${h.libelle}`}
            onPress={() => onChoisir(actif ? null : h.valeur)}
            style={[styles.humeur, { borderColor: actif ? theme.accent : theme.ligne, backgroundColor: actif ? teinteTransparente(theme.accent, 0.2) : theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
            <Text style={{ fontSize: mobile ? 24 : 22 }}>{h.emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chiffres({ theme, mobile, chiffres, masquer }: StyleCommun & { chiffres: readonly ChiffreCle[] }) {
  if (chiffres.length === 0) return null;
  return (
    <View style={styles.chiffres} testID="journal-chiffres">
      {chiffres.map(c => (
        <View key={c.id} testID={`journal-chiffre-${c.id}`} style={[styles.chiffre, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
          <Text style={{ color: theme.texte, fontSize: taille(20, mobile), fontWeight: theme.poidsTitre, ...police(theme.policeChiffres) }}>{masquer(c.valeur)}</Text>
          <Text style={{ color: theme.attenue, fontSize: taille(12, mobile), ...police(theme.policeTexte) }}>{c.libelle}</Text>
        </View>
      ))}
    </View>
  );
}

export function Sections({ theme, mobile, sections, masquer }: StyleCommun & { sections: readonly SectionPage[] }) {
  return (
    <>
      {sections.map(s => (
        <View key={s.id || s.titre} style={styles.section} testID={`journal-section-${s.id}`}>
          <Text accessibilityRole="header" style={{ color: theme.accent, fontSize: taille(13, mobile), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>
            {s.titre}
          </Text>
          {s.paragraphes.map((p, i) => (
            <Text key={i} style={{ color: theme.texte, fontSize: taille(16, mobile), lineHeight: taille(16, mobile) * 1.55, ...police(theme.policeTexte) }}>
              {masquer(p)}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

/** Le texte rédigé d'une page : accroche, intro, fait marquant, sections, chiffres, clôture. */
export function TextePage({ theme, mobile, page, masquer }: StyleCommun & { page: PageJournal }) {
  const a = page.auto;
  const corps = { color: theme.texte, fontSize: taille(16, mobile), lineHeight: taille(16, mobile) * 1.55, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 14 }} testID="journal-texte">
      {a.accroche ? (
        <Text style={{ color: theme.attenue, fontSize: taille(15, mobile), fontStyle: 'italic', ...police(theme.policeTexte) }}>{a.accroche}</Text>
      ) : null}
      {a.intro ? <Text style={corps}>{masquer(a.intro)}</Text> : null}
      {a.marquant ? (
        <View style={[styles.marquant, { borderLeftColor: theme.accent, backgroundColor: teinteTransparente(theme.accent, 0.12), borderRadius: Math.min(theme.rayonMoyen, 10) }]} testID="journal-marquant">
          <Text style={{ color: theme.accent, fontSize: taille(12, mobile), fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>Fait marquant</Text>
          <Text style={{ ...corps, fontWeight: '600' }}>{masquer(a.marquant.texte)}</Text>
        </View>
      ) : null}
      <Chiffres theme={theme} mobile={mobile} chiffres={a.chiffres} masquer={masquer} />
      <Sections theme={theme} mobile={mobile} sections={a.sections} masquer={masquer} />
      {a.cloture ? <Text style={{ color: theme.attenue, fontSize: taille(15, mobile), fontStyle: 'italic', ...police(theme.policeTexte) }}>{masquer(a.cloture)}</Text> : null}
    </View>
  );
}

/** Ligne d'une journée dans une liste (semaine, mois, épinglées, recherche). */
export function LigneJour({ theme, mobile, jour, texte, humeur, epingle, onPress, testID }: { theme: ThemeHub; mobile: boolean; jour: string; texte: string; humeur?: string; epingle?: boolean; onPress(): void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir la page du ${jourLongMaj(jour)}`}
      onPress={onPress}
      style={[styles.ligne, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12), minHeight: mobile ? 52 : 44 }]}>
      <Text style={{ color: theme.accent, fontSize: taille(14, mobile), fontWeight: '700', width: mobile ? 78 : 86, ...police(theme.policeChiffres) }}>{jourCourt(jour)}</Text>
      <Text numberOfLines={2} style={{ flex: 1, color: theme.texte, fontSize: taille(14, mobile), ...police(theme.policeTexte) }}>
        {texte}
      </Text>
      <Text style={{ fontSize: taille(16, mobile) }}>{`${epingle ? '📌' : ''}${humeur ?? ''}`}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  onglets: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start', maxWidth: '100%' },
  onglet: { paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center', alignItems: 'center', minWidth: 44 },
  rond: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  humeurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  humeur: { width: 48, height: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chiffres: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chiffre: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, gap: 2, minWidth: 120, flexGrow: 1, flexBasis: 120 },
  section: { gap: 6 },
  marquant: { borderLeftWidth: 4, padding: 12, gap: 4 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  basculeur: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  piste: { width: 48, height: 28, borderRadius: 14, paddingHorizontal: 3 },
  bouton: { width: 22, height: 22, borderRadius: 11 },
});

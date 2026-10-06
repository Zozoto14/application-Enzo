/**
 * Portefeuille, en version téléphone (< 768 px, ou natif en portrait).
 *
 * Une colonne : carte de synthèse (valeur totale, variation du jour, total return, +/-), sélecteur de
 * compte, onglets en contrôle segmenté défilant (collant), puis le contenu de l'onglet. Les actions
 * (nouvelle opération, import, compte…) sont dans une feuille basse ; « Actualiser les cours » reste
 * sous le pouce, et tirer l'écran vers le bas actualise aussi. Un appui long sur la valeur masque les
 * montants (mode discret).
 */

import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text } from '../mobile/adaptatif';
import { useTirerPourActualiser } from '../mobile/actualiser';
import { BoutonPrincipal } from '../mobile/BoutonPrincipal';
import { FeuilleBasse } from '../mobile/FeuilleBasse';
import { ESPACE, GOUTTIERE, TEXTE, nombres, rayonCarte, rayonControle, themeActif } from '../mobile/jetons';
import { Cellule, GroupeCellules } from '../mobile/ListeCellules';
import { Platform } from 'react-native';
import { Pastille, Selecteur, Signe, type OptionSelecteur } from '../elements';
import { usePalette } from '../composants';
import { palettePour } from '../theme';
import type { OngletPortefeuille, PortefeuilleProps } from './Portefeuille';

export interface PortefeuilleMobileProps extends PortefeuilleProps {
  onglets: ReadonlyArray<{ cle: OngletPortefeuille; libelle: string }>;
  /** Contenu de l'onglet actif. */
  rendreOnglet(cle: OngletPortefeuille): React.ReactNode;
  /** Mode discret (montants masqués) et sa bascule. */
  discret?: boolean;
  onBasculerDiscretion?(): void;
}

export function PortefeuilleMobile(props: PortefeuilleMobileProps) {
  const palette = usePalette();
  const theme = themeActif();
  const [interne, setInterne] = useState<OngletPortefeuille>('resume');
  const [actions, setActions] = useState(false);
  const actif = props.onglet ?? interne;
  const { dashboard, resume } = props;
  const tirer = useTirerPourActualiser(props.onRafraichirCours);
  const comptes: OptionSelecteur[] = [{ valeur: 'tous', libelle: 'Tous' }, ...(props.optionsComptes ?? [])];
  const rayon = rayonCarte(theme);

  const changer = (cle: OngletPortefeuille) => {
    setInterne(cle);
    props.onChangerOnglet?.(cle);
  };
  const lancer = (action?: () => void) => () => {
    setActions(false);
    action?.();
  };

  const hero = (
    <View style={styles.colonne}>
      {tirer.tirage > 0 ? (
        <Text style={{ color: palette.texteSecondaire, textAlign: 'center', height: tirer.tirage }}>
          {tirer.tirage >= 32 ? 'Relâchez pour actualiser les cours' : 'Tirez pour actualiser les cours'}
        </Text>
      ) : null}
      <Pressable
        testID="carte-synthese"
        accessibilityRole="button"
        accessibilityLabel="Valeur totale. Appui long : masquer ou afficher les montants"
        onLongPress={props.onBasculerDiscretion}
        delayLongPress={450}
        style={[styles.hero, { backgroundColor: palette.surface, borderColor: palette.bordure, borderRadius: rayon }]}>
        <View style={styles.ligne}>
          <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>Valeur totale</Text>
          {props.onBasculerDiscretion ? (
            <Pressable
              testID="bouton-discretion"
              accessibilityRole="switch"
              accessibilityLabel="Masquer les montants"
              accessibilityState={{ checked: Boolean(props.discret) }}
              onPress={props.onBasculerDiscretion}>
              <Text style={{ color: palette.accent, fontSize: TEXTE.legende, fontWeight: '700' }}>{props.discret ? '👁 Afficher' : '🙈 Masquer'}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={{ color: palette.texte, fontSize: 36, fontWeight: '800', ...nombres() }} testID="synthese-valeur" adjustsFontSizeToFit numberOfLines={1}>
          {resume?.valeurTotale ?? dashboard.valeurTotale}
        </Text>
        {resume?.variationSeance ? (
          <View style={styles.ligneSimple} testID="variation-seance">
            <Pastille texte={resume.variationSeance.pourcentage.texte} tendance={resume.variationSeance.pourcentage.tendance} taille={15} />
            <Signe texte={resume.variationSeance.montant.texte} tendance={resume.variationSeance.montant.tendance} taille={16} />
            <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>séance du {resume.variationSeance.date}</Text>
          </View>
        ) : null}
        <View style={styles.tuiles}>
          <View style={styles.tuile}>
            <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>Plus-value latente</Text>
            <Signe texte={dashboard.plusValueLatente} tendance={dashboard.tendance} taille={18} />
          </View>
          <View style={styles.tuile}>
            <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>Total return</Text>
            {resume ? <Signe texte={resume.totalReturnPct.texte} tendance={resume.totalReturnPct.tendance} taille={18} /> : <Text style={{ color: palette.texte }}>—</Text>}
          </View>
          <View style={styles.tuile}>
            <Text style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>Liquidités</Text>
            <Text style={{ color: palette.texte, fontSize: 18, fontWeight: '700', ...nombres() }}>{dashboard.cash}</Text>
          </View>
        </View>
      </Pressable>

      <View style={styles.ligneSimple}>
        {dashboard.sansCompte ? (
          <View style={{ flex: 1 }}>
            <BoutonPrincipal theme={theme} titre="Créer un compte" testID="bouton-creer-compte-depuis-tableau" onPress={() => props.onCreerCompte?.()} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <BoutonPrincipal
              theme={theme}
              titre={props.rafraichissementEnCours ? 'Récupération…' : 'Actualiser les cours'}
              testID="bouton-rafraichir-cours"
              enCours={props.rafraichissementEnCours}
              onPress={() => props.onRafraichirCours?.()}
            />
          </View>
        )}
        <Pressable
          testID="bouton-actions"
          accessibilityRole="button"
          accessibilityLabel="Plus d’actions : opération, import, compte, sauvegarde"
          onPress={() => setActions(true)}
          style={[styles.plus, { borderColor: palette.bordure, backgroundColor: palette.surface, borderRadius: rayonControle(theme) === 999 ? 24 : rayonControle(theme) }]}>
          <Text style={{ color: palette.texte, fontSize: 24, fontWeight: '700' }}>⋯</Text>
        </Pressable>
      </View>
      {props.coursActualisesA || props.messageCours ? (
        <Text accessibilityLiveRegion="polite" testID="cours-actualises" style={{ color: palette.texteSecondaire, fontSize: TEXTE.legende }}>
          {props.messageCours ?? `Cours à jour à ${props.coursActualisesA}`}
        </Text>
      ) : null}
      {props.onChoisirCompte && comptes.length > 2 ? (
        <Selecteur etiquette="Compte" valeur={props.compteActif ?? 'tous'} options={comptes} onChoisir={props.onChoisirCompte} testID="selecteur-compte" />
      ) : null}
    </View>
  );

  const barre = (
    <View style={[styles.barreOnglets, { backgroundColor: palettePour().fond, borderBottomColor: palette.bordure }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.onglets} accessibilityRole="tablist">
        {props.onglets.map(onglet => {
          const selectionne = onglet.cle === actif;
          return (
            <Pressable
              key={onglet.cle}
              testID={`onglet-${onglet.cle}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: selectionne }}
              onPress={() => changer(onglet.cle)}
              style={[
                styles.onglet,
                { borderRadius: rayonControle(theme) === 999 ? 24 : Math.max(rayonControle(theme), 8), backgroundColor: selectionne ? palette.accentFond : palette.surfaceHaute, borderColor: selectionne ? palette.accent : palette.bordure },
              ]}>
              <Text style={{ color: selectionne ? palette.accent : palette.texte, fontWeight: selectionne ? '800' : '600', fontSize: TEXTE.corps }}>{onglet.libelle}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.racine, { backgroundColor: palettePour().fond }]} testID="portefeuille-mobile" {...tirer.poignees}>
      <ScrollView
        stickyHeaderIndices={[1]}
        onScroll={tirer.surDefilement}
        scrollEventThrottle={32}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={props.onRafraichirCours && Platform.OS !== 'web' ? <RefreshControl refreshing={Boolean(props.rafraichissementEnCours)} onRefresh={props.onRafraichirCours} tintColor={theme.accent} /> : undefined}>
        {hero}
        {barre}
        <View style={styles.contenu}>{props.rendreOnglet(actif)}</View>
      </ScrollView>

      <FeuilleBasse theme={theme} visible={actions} titre="Actions" onFermer={() => setActions(false)} testID="feuille-actions-portefeuille">
        <GroupeCellules theme={theme}>
          {props.onAjouterTransaction && !dashboard.sansCompte ? <Cellule theme={theme} glyphe="+" titre="Nouvelle opération" chevron testID="bouton-ajouter" onPress={lancer(props.onAjouterTransaction)} /> : null}
          {props.onImporter && !dashboard.sansCompte ? <Cellule theme={theme} glyphe="↓" titre="Importer" chevron testID="bouton-importer-positions" onPress={lancer(props.onImporter)} /> : null}
          {props.onCreerCompte ? <Cellule theme={theme} glyphe="▦" titre={dashboard.sansCompte ? 'Créer un compte' : 'Nouveau compte'} chevron testID="bouton-creer-compte-feuille" onPress={lancer(props.onCreerCompte)} /> : null}
        </GroupeCellules>
        <GroupeCellules theme={theme}>
          {props.onSauvegarder ? <Cellule theme={theme} glyphe="⇪" titre="Sauvegarde" chevron testID="bouton-sauvegarde" onPress={lancer(props.onSauvegarder)} /> : null}
          {props.onReglages ? <Cellule theme={theme} glyphe="⚙" titre="Paramètres" chevron testID="bouton-reglages" onPress={lancer(props.onReglages)} /> : null}
        </GroupeCellules>
      </FeuilleBasse>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { paddingBottom: ESPACE.xxl },
  colonne: { gap: ESPACE.s + 4, paddingHorizontal: GOUTTIERE, paddingTop: ESPACE.m, paddingBottom: ESPACE.s, width: '100%', maxWidth: 640, alignSelf: 'center' },
  hero: { borderWidth: 1, padding: ESPACE.m, gap: ESPACE.s },
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ligneSimple: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: ESPACE.s },
  tuiles: { flexDirection: 'row', flexWrap: 'wrap', columnGap: ESPACE.m, rowGap: ESPACE.s, paddingTop: ESPACE.xs },
  tuile: { gap: 2, flexGrow: 1, flexBasis: 100 },
  plus: { width: 52, minHeight: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  barreOnglets: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: ESPACE.xs + 2 },
  onglets: { gap: ESPACE.xs + 2, paddingHorizontal: GOUTTIERE },
  onglet: { minHeight: 44, paddingHorizontal: ESPACE.m, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  contenu: { gap: ESPACE.m, paddingHorizontal: GOUTTIERE, paddingTop: ESPACE.m, width: '100%', maxWidth: 640, alignSelf: 'center' },
});

/**
 * Projections d'épargne et d'indépendance financière.
 *
 * L'écran est bâti pour décourager la lecture d'un chiffre isolé : la
 * fourchette est affichée avant le résultat central, et les hypothèses restent
 * sous les yeux, modifiables, à côté de ce qu'elles produisent.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { ECART_AFFICHE, type ChampsProjection, type VueProjection } from '../vues/projection';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { Jauge } from '../indicateurs';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';

export interface ProjectionProps {
  champs: ChampsProjection;
  vue: VueProjection;
  onChanger(champ: keyof ChampsProjection, valeur: string): void;
  onRetour(): void;
  /** Valeur actuelle du portefeuille, affichée comme valeur reprise par défaut. */
  capitalActuel: string;
}

export function Projection({
  champs,
  vue,
  onChanger,
  onRetour,
  capitalActuel,
}: ProjectionProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();

  const champNombre = (
    cle: keyof ChampsProjection,
    etiquette: string,
    placeholder?: string,
  ) => (
    <View style={styles.moitie}>
      <Champ
        etiquette={etiquette}
        testID={`projection-${cle}`}
        value={champs[cle]}
        onChangeText={valeur => onChanger(cle, valeur)}
        keyboardType="decimal-pad"
        placeholder={placeholder}
      />
      {vue.erreurs[cle] ? <Alerte message={vue.erreurs[cle]!} /> : null}
    </View>
  );

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.formulaire, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Projection</Titre>
      <SousTitre>
        Une projection n’est pas une prévision. Elle répond à « si le rendement
        moyen était de tant, où serais-je dans quinze ans ? » — une question sur
        une hypothèse, pas sur l’avenir.
      </SousTitre>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Hypothèses</Text>
        <View style={styles.paire}>
          {champNombre('capital', 'Capital de départ', capitalActuel)}
          {champNombre('versementMensuel', 'Versement mensuel')}
        </View>
        <SousTitre>
          Laissé vide, le capital de départ reprend la valeur actuelle de votre
          portefeuille ({capitalActuel}).
        </SousTitre>
        <View style={styles.paire}>
          {champNombre('rendementAnnuel', 'Rendement annuel %')}
          {champNombre('fraisAnnuels', 'Frais annuels %')}
        </View>
        <View style={styles.paire}>
          {champNombre('inflation', 'Inflation %')}
          {champNombre('annees', 'Durée (années)')}
        </View>
        <SousTitre>
          Rendement net de frais : {vue.rendementNet}. Les frais se retranchent
          du rendement chaque année et composent comme lui : un demi-point sur
          trente ans coûte près d’un dixième du capital final.
        </SousTitre>
      </Carte>

      {vue.calculable ? (
        <>
          <Carte>
            <Text style={[styles.sectionTitre, { color: palette.texte }]}>
              Dans {champs.annees} ans
            </Text>
            <SousTitre>Fourchette, en euros d’aujourd’hui</SousTitre>
            <Text style={[styles.fourchette, { color: palette.texte }]}>
              {vue.fourchette}
            </Text>
            <SousTitre>
              Selon que le rendement moyen soit inférieur ou supérieur de{' '}
              {ECART_AFFICHE} points à votre hypothèse. L’écart entre ces deux
              bornes est l’information principale : il dit à quel point le
              résultat dépend de ce que vous ne maîtrisez pas.
            </SousTitre>

            <View style={styles.courbe}>
              {vue.courbe.map(point => (
                <View key={point.annee} style={styles.colonne}>
                  <View
                    style={[
                      styles.bande,
                      {
                        backgroundColor: palette.bordure,
                        height: `${Math.max(1, (point.fractionHaute - point.fractionBasse) * 100)}%`,
                        bottom: `${point.fractionBasse * 100}%`,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.trait,
                      {
                        backgroundColor: palette.accent,
                        bottom: `${point.fraction * 100}%`,
                      },
                    ]}
                  />
                </View>
              ))}
            </View>
            <View style={stylesPartages.ligne}>
              <SousTitre>aujourd’hui</SousTitre>
              <SousTitre>{champs.annees} ans</SousTitre>
            </View>
          </Carte>

          <Carte>
            <Text style={[styles.sectionTitre, { color: palette.texte }]}>
              Scénario central
            </Text>
            <View style={styles.paire}>
              <View style={styles.moitie}>
                <SousTitre>En euros d’aujourd’hui</SousTitre>
                <Text style={[styles.grand, { color: palette.texte }]}>
                  {vue.centralReel}
                </Text>
              </View>
              <View style={styles.moitie}>
                <SousTitre>En euros courants</SousTitre>
                <Text style={[styles.grand, { color: palette.texteSecondaire }]}>
                  {vue.centralNominal}
                </Text>
              </View>
            </View>
            <SousTitre>
              Les deux diffèrent par l’inflation. Le premier est celui qui
              compte : c’est ce que vous pourrez acheter.
            </SousTitre>
            <View style={styles.paire}>
              <View style={styles.moitie}>
                <SousTitre>Vous aurez versé</SousTitre>
                <Text style={{ color: palette.texte, fontWeight: '600' }}>{vue.verse}</Text>
              </View>
              <View style={styles.moitie}>
                <SousTitre>Intérêts</SousTitre>
                <Text style={{ color: palette.hausse, fontWeight: '600' }}>
                  {vue.interets}
                </Text>
              </View>
            </View>
            <SousTitre>{vue.commentaireInterets}</SousTitre>
            {vue.anneeBascule ? <SousTitre>{vue.anneeBascule}</SousTitre> : null}
          </Carte>
        </>
      ) : (
        <Carte>
          <Text style={{ color: palette.texte }}>{vue.commentaireInterets}</Text>
        </Carte>
      )}

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>
          Indépendance financière
        </Text>
        <SousTitre>
          Quel capital couvrirait vos dépenses sans avoir à travailler. Laissez
          vide si la question ne vous intéresse pas.
        </SousTitre>
        <View style={styles.paire}>
          {champNombre('depensesAnnuelles', 'Dépenses annuelles')}
          {champNombre('tauxRetrait', 'Taux de retrait %')}
        </View>

        {vue.objectif ? (
          <>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texte }}>Capital nécessaire</Text>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {vue.objectif.capitalNecessaire}
              </Text>
            </View>
            <Jauge fraction={vue.objectif.fraction} />
            <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
              {vue.objectif.resume}
            </Text>
          </>
        ) : null}

        <SousTitre>
          Le taux de 4 % vient d’une étude américaine sur trente ans de
          retraite, en dollars, sans impôt français ni prélèvements sociaux. Il
          sert de repère, pas de garantie — et une retraite plus longue, ou une
          mauvaise séquence de rendements dans les premières années, le rend
          trop optimiste. Un taux de 3 % est le choix prudent.
        </SousTitre>
      </Carte>

      <Actions>
        <Bouton titre="Retour" variante="discret" onPress={onRetour} />
      </Actions>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  moitie: { flex: 1, minWidth: 130 },
  grand: { fontSize: 22, fontWeight: '700' },
  fourchette: { fontSize: 19, fontWeight: '700' },
  courbe: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: 110 },
  colonne: { flex: 1, height: '100%', minWidth: 2 },
  bande: { position: 'absolute', left: 0, right: 0, borderRadius: 1 },
  trait: { position: 'absolute', left: 0, right: 0, height: 2 },
});

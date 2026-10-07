/**
 * Comparateur de valeurs.
 *
 * Deux ou trois lignes côte à côte, sur la période où elles ont toutes un
 * historique. L'écran affiche cette période avant les chiffres : comparer une
 * valeur suivie depuis deux ans à une autre suivie depuis trois semaines
 * produirait des nombres parfaitement lisibles et parfaitement faux.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { ColonneComparaison, VueComparateur } from '../vues/comparateur';
import { Bouton, Carte, SousTitre, Titre, Variation, usePalette } from '../composants';
import { Explication } from '../indicateurs';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';

export interface ComparateurProps {
  vue: VueComparateur;
  onBasculer(titreId: string): void;
  onRetour(): void;
}

export function Comparateur({ vue, onBasculer, onRetour }: ComparateurProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}>
      <Titre>Comparer</Titre>
      <SousTitre>
        Deux valeurs, trois au maximum. Les mesures portent sur la période où
        elles ont toutes un historique.
      </SousTitre>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Valeurs</Text>
        <View style={styles.choix}>
          {vue.candidats.map(candidat => (
            <Pressable
              key={candidat.titreId}
              testID={`comparer-${candidat.titreId}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: candidat.retenu }}
              disabled={vue.complet && !candidat.retenu}
              onPress={() => onBasculer(candidat.titreId)}
              style={[
                styles.puce,
                {
                  borderColor: candidat.retenu ? palette.accent : palette.bordure,
                  backgroundColor: candidat.retenu ? palette.accentPlein : 'transparent',
                  opacity: vue.complet && !candidat.retenu ? 0.4 : 1,
                },
              ]}>
              <Text
                style={{
                  fontSize: 13,
                  color: candidat.retenu ? palette.surAccent : palette.texte,
                }}>
                {candidat.nom}
                {candidat.detenue ? '' : ' · suivie'}
              </Text>
            </Pressable>
          ))}
        </View>
        {vue.complet ? (
          <SousTitre>
            Trois valeurs comparées : retirez-en une pour en ajouter une autre.
          </SousTitre>
        ) : null}
      </Carte>

      {vue.message ? (
        <Carte>
          <Text style={{ color: palette.texte }}>{vue.message}</Text>
        </Carte>
      ) : null}

      {vue.periode ? (
        <Carte>
          <SousTitre>{vue.periode}</SousTitre>
        </Carte>
      ) : null}

      {vue.colonnes.map(colonne => (
        <Colonne key={colonne.titreId} colonne={colonne} />
      ))}

      {vue.paires.length > 0 ? (
        <Carte>
          <View style={styles.ligneEnTete}>
            <Text style={[styles.sectionTitre, { color: palette.texte }]}>
              Bougent-elles ensemble ?
            </Text>
            <Explication cle="correlation" />
          </View>
          {vue.paires.map((paire, index) => (
            <View
              key={`${paire.a}-${paire.b}-${index}`}
              testID={`paire-${index}`}
              style={[styles.bloc, { borderColor: palette.bordure }]}>
              <View style={stylesPartages.ligne}>
                <Text style={styles.nom} numberOfLines={1}>
                  <Text style={{ color: palette.texte }}>
                    {paire.a} · {paire.b}
                  </Text>
                </Text>
                <Text style={{ color: palette.texte, fontWeight: '600' }}>
                  {paire.correlation.valeur ?? '—'}
                </Text>
              </View>
              {paire.correlation.motif ? (
                <SousTitre>{paire.correlation.motif}</SousTitre>
              ) : null}
              {paire.commentaire ? <SousTitre>{paire.commentaire}</SousTitre> : null}
            </View>
          ))}
        </Carte>
      ) : null}

      <Bouton titre="Retour" variante="discret" onPress={onRetour} />
    </ScrollView>
  );
}

function Colonne({ colonne }: { colonne: ColonneComparaison }) {
  const palette = usePalette();

  const ligne = (etiquette: string, valeur?: string, motif?: string) => (
    <View style={[styles.bloc, { borderColor: palette.bordure }]}>
      <View style={stylesPartages.ligne}>
        <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>{etiquette}</Text>
        <Text style={{ color: palette.texte, fontWeight: '600' }}>{valeur ?? '—'}</Text>
      </View>
      {motif ? <SousTitre>{motif}</SousTitre> : null}
    </View>
  );

  return (
    <Carte>
      <View style={stylesPartages.ligne}>
        <Text style={styles.nom} numberOfLines={1}>
          <Text style={{ color: palette.texte, fontSize: 17 }}>{colonne.nom}</Text>
        </Text>
        {colonne.detenue ? null : (
          <View style={[styles.pastille, { borderColor: palette.bordure }]}>
            <Text style={{ fontSize: 11, color: palette.texteSecondaire }}>
              Non détenue
            </Text>
          </View>
        )}
      </View>
      <SousTitre>
        {colonne.ticker ? `${colonne.ticker} · ` : ''}
        {colonne.secteur} · {colonne.zone}
        {colonne.eligiblePEA ? ' · éligible PEA' : ''}
      </SousTitre>

      {ligne('Cours', colonne.cours.valeur ?? undefined, colonne.cours.motif)}

      <View style={[styles.bloc, { borderColor: palette.bordure }]}>
        <View style={stylesPartages.ligne}>
          <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
            Performance sur la période
          </Text>
          {colonne.performance.valeur ? (
            <Variation
              valeur={colonne.performance.valeur}
              tendance={colonne.tendancePerformance}
              taille={15}
            />
          ) : (
            <Text style={{ color: palette.texteSecondaire }}>—</Text>
          )}
        </View>
        {colonne.performance.motif ? <SousTitre>{colonne.performance.motif}</SousTitre> : null}
      </View>

      {ligne('Volatilité', colonne.volatilite.valeur ?? undefined, colonne.volatilite.motif)}

      {colonne.detenue ? (
        <>
          {ligne('Poids du portefeuille', colonne.poids)}
          {ligne('Prix de revient', colonne.pru)}
          <View style={[styles.bloc, { borderColor: palette.bordure }]}>
            <View style={stylesPartages.ligne}>
              <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>
                Plus-value latente
              </Text>
              {colonne.plusValue ? (
                <Variation
                  valeur={colonne.plusValue}
                  tendance={colonne.tendancePlusValue ?? 'neutre'}
                  taille={15}
                />
              ) : (
                <Text style={{ color: palette.texteSecondaire }}>—</Text>
              )}
            </View>
          </View>
          {ligne('Dividendes sur douze mois', colonne.dividendesDouzeMois)}
          {ligne(
            'Rendement sur prix de revient',
            colonne.rendementSurRevient?.valeur ?? undefined,
            colonne.rendementSurRevient?.motif,
          )}
        </>
      ) : (
        <SousTitre>
          Valeur suivie sans être détenue : ni prix de revient, ni plus-value,
          ni rendement à rapporter.
        </SousTitre>
      )}
    </Carte>
  );
}

const styles = StyleSheet.create({
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  nom: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
  ligneEnTete: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  bloc: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
  },
  choix: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  puce: {
    borderWidth: 1,
    borderRadius: RAYON.l,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
  },
  pastille: {
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.s,
    paddingVertical: 2,
  },
});

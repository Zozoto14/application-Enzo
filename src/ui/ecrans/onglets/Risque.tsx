/**
 * Onglet Risque : concentration, agitation, baisses, et ce qui bouge ensemble.
 *
 * Les sections les plus sûres — la concentration, lisible dès le premier
 * jour — restent en place ; les analyses qui demandent un historique de cours
 * s'y ajoutent, et disent ce qui leur manque quand il leur manque quelque
 * chose.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SousTitre, usePalette } from '../../composants';
import { CarteSection, Metrique, Rangee, Vide } from '../../elements';
import { GraphiqueLignes, Nuage } from '../../graphiques/Graphiques';
import { Explication, Indicateur, Jauge } from '../../indicateurs';
import { ESPACEMENT } from '../../theme';
import { construireRisqueAvance, type EntreesAnalyse } from '../../vues/analyses';
import type { VueRisque } from '../../vues/risque';

const pourcent = (valeur: number) =>
  `${valeur.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;

export function OngletRisque({ vue, analyse }: { vue: VueRisque; analyse?: EntreesAnalyse }) {
  const palette = usePalette();
  const avance = useMemo(() => (analyse ? construireRisqueAvance(analyse) : undefined), [analyse]);

  if (vue.aucunePosition) {
    return (
      <CarteSection>
        <Text style={{ color: palette.texte }}>Aucune position à analyser.</Text>
        <SousTitre>
          La concentration se mesure dès la première ligne, sans attendre le moindre historique de
          cours.
        </SousTitre>
      </CarteSection>
    );
  }

  return (
    <>
      {avance ? (
        <>
          <Rangee>
            <CarteSection titre="Métriques clés" explication="volatilite">
              <View style={styles.grille}>
                {avance.metriques.map(metrique => (
                  <Metrique
                    key={metrique.libelle}
                    libelle={metrique.libelle}
                    valeur={metrique.valeur}
                    tendance={metrique.alerte ? 'baisse' : metrique.tendance}
                  />
                ))}
              </View>
              {avance.periode ? <Vide>{avance.periode}</Vide> : null}
            </CarteSection>

            <CarteSection titre="Frontière efficiente" poids={1.4}>
              {avance.frontiere ? (
                <>
                  <Nuage
                    points={[
                      ...avance.frontiere.actifs.map((actif, index) => ({
                        x: actif.volatilite,
                        y: actif.rendement,
                        libelle: actif.libelle,
                        couleur: palette.series[(index + 2) % palette.series.length],
                      })),
                      {
                        x: avance.frontiere.actuel.volatilite,
                        y: avance.frontiere.actuel.rendement,
                        libelle: 'Actuel',
                        couleur: palette.hausse,
                        forme: 'triangle' as const,
                      },
                      {
                        x: avance.frontiere.tangence.volatilite,
                        y: avance.frontiere.tangence.rendement,
                        libelle: 'Tangence',
                        couleur: palette.reference,
                        forme: 'losange' as const,
                      },
                    ]}
                    lignes={[
                      {
                        points: avance.frontiere.courbe.map(point => ({ x: point.volatilite, y: point.rendement })),
                        couleur: palette.accent,
                      },
                      {
                        points: [
                          { x: 0, y: 0 },
                          {
                            x: avance.frontiere.tangence.volatilite * 1.3,
                            y: avance.frontiere.tangence.rendement * 1.3,
                          },
                        ],
                        couleur: palette.texteSecondaire,
                        pointilles: true,
                      },
                    ]}
                    formaterX={pourcent}
                    formaterY={pourcent}
                    hauteur={300}
                    legende={[
                      { couleur: palette.accent, texte: 'Frontière efficiente' },
                      { couleur: palette.hausse, texte: 'Portefeuille actuel' },
                      { couleur: palette.texteSecondaire, texte: 'Droite de marché (CAL)' },
                      { couleur: palette.reference, texte: 'Portefeuille de tangence' },
                    ]}
                  />
                  <Vide>
                    Volatilité et rendement annualisés sur {avance.frontiere.observations} séances. La
                    frontière décrit le passé : elle ne promet rien pour la suite.
                  </Vide>
                </>
              ) : (
                <Vide>{avance.motifFrontiere}</Vide>
              )}
            </CarteSection>
          </Rangee>

          <Rangee>
            <CarteSection titre="Drawdown" explication="drawdown" poids={1.6}>
              {avance.drawdown.length > 1 ? (
                <GraphiqueLignes
                  series={[{ nom: 'Drawdown', couleur: palette.baisse, points: avance.drawdown, aire: true }]}
                  formater={pourcent}
                  hauteur={280}
                  etiquettesFinales={false}
                />
              ) : (
                <Vide>Le drawdown se trace dès que le portefeuille a un historique de valorisation.</Vide>
              )}
            </CarteSection>
            <CarteSection titre="Métriques de drawdown">
              <View style={styles.grille}>
                {avance.metriquesDrawdown.map(metrique => (
                  <Metrique
                    key={metrique.libelle}
                    libelle={metrique.libelle}
                    valeur={metrique.valeur}
                    tendance={metrique.tendance}
                  />
                ))}
              </View>
              {avance.phraseDrawdown ? (
                <Text style={{ color: palette.accent, fontSize: 12, lineHeight: 18 }}>{avance.phraseDrawdown}</Text>
              ) : null}
            </CarteSection>
          </Rangee>

          {avance.matrice.noms.length > 1 ? (
            <CarteSection titre="Matrice de corrélation" explication="correlation">
              <ScrollView horizontal>
                <View>
                  <View style={styles.ligneMatrice}>
                    <View style={styles.enteteMatrice} />
                    {avance.matrice.noms.map(nom => (
                      <View key={nom} style={styles.celluleMatrice}>
                        <Text style={[styles.texteMatrice, { color: palette.texteSecondaire }]}>{nom}</Text>
                      </View>
                    ))}
                  </View>
                  {avance.matrice.valeurs.map((ligne, i) => (
                    <View key={avance.matrice.noms[i]} style={styles.ligneMatrice}>
                      <View style={styles.enteteMatrice}>
                        <Text style={[styles.texteMatrice, { color: palette.texteSecondaire }]}>
                          {avance.matrice.noms[i]}
                        </Text>
                      </View>
                      {ligne.map((valeur, j) => (
                        <View
                          key={`${i}-${j}`}
                          style={[
                            styles.celluleMatrice,
                            {
                              backgroundColor:
                                valeur === null
                                  ? 'transparent'
                                  : `rgba(77, 140, 245, ${(0.12 + Math.abs(valeur) * 0.5).toFixed(2)})`,
                              borderColor: i === j ? palette.accent : palette.bordure,
                            },
                          ]}>
                          <Text style={[styles.texteMatrice, { color: palette.texte }]}>
                            {valeur === null ? '—' : valeur.toFixed(2).replace('.', ',')}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </CarteSection>
          ) : null}
        </>
      ) : null}

      <Rangee>
        <CarteSection titre="Concentration" explication="concentration">
          {vue.concentration ? (
            <>
              <View style={styles.paire}>
                <Indicateur
                  etiquette="Lignes équivalentes"
                  valeur={vue.concentration.lignesEquivalentes}
                  grand
                />
                <Indicateur etiquette="Lignes détenues" valeur={`${vue.concentration.nombreLignes}`} />
              </View>
              <Jauge fraction={vue.concentration.fraction} />
              <SousTitre>{vue.concentration.verdict}</SousTitre>
              <SousTitre>
                {vue.concentration.premiereLigne} pèse {vue.concentration.premierePart}. Il suffit de{' '}
                {vue.concentration.lignesPourMoitie} ligne(s) pour atteindre la moitié du portefeuille.
              </SousTitre>
            </>
          ) : null}
          {vue.sansCours.length > 0 ? (
            <View style={styles.ligneEnTete}>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {vue.sansCours.length} ligne(s) exclue(s) : {vue.sansCours.join(', ')}
              </Text>
              <Explication cle="coursInconnu" />
            </View>
          ) : null}
        </CarteSection>

        <CarteSection titre="D’où vient l’agitation" explication="contributionRisque">
          {vue.contributions.length > 0 ? (
            vue.contributions.map(ligne => (
              <View key={ligne.titreId} style={[styles.position, { borderColor: palette.bordure }]}>
                <View style={styles.ligne}>
                  <Text style={[styles.nom, { color: palette.texte }]} numberOfLines={1}>
                    {ligne.nom}
                  </Text>
                  <Text style={{ color: palette.texte, fontWeight: '600' }}>{ligne.part}</Text>
                </View>
                <Jauge fraction={ligne.fraction} />
                <SousTitre>
                  {ligne.poids} du capital · volatilité {ligne.volatilite}
                </SousTitre>
                {ligne.disproportionnee ? (
                  <SousTitre>Cette ligne pèse nettement plus dans le risque que dans le capital.</SousTitre>
                ) : null}
              </View>
            ))
          ) : (
            <SousTitre>{vue.motifContributions}</SousTitre>
          )}
        </CarteSection>
      </Rangee>

      <CarteSection titre="Vos lignes bougent-elles ensemble ?" explication="correlation">
        {vue.motifCorrelations ? <SousTitre>{vue.motifCorrelations}</SousTitre> : null}
        {vue.correlations.map((paire, index) => (
          <View
            key={`${paire.a}-${paire.b}-${index}`}
            testID={`correlation-${index}`}
            style={[styles.position, { borderColor: palette.bordure }]}>
            <View style={styles.ligne}>
              <Text style={[styles.nom, { color: palette.texte }]} numberOfLines={1}>
                {paire.a} · {paire.b}
              </Text>
              <Text
                style={{
                  color: paire.brute !== undefined && paire.brute >= 0.7 ? palette.danger : palette.texte,
                  fontWeight: '600',
                }}>
                {paire.valeur ?? '—'}
              </Text>
            </View>
            {paire.commentaire ? <SousTitre>{paire.commentaire}</SousTitre> : null}
          </View>
        ))}
      </CarteSection>

      <Rangee>
        <RepartitionListe titre="Par secteur" lignes={vue.parSecteur} />
        <RepartitionListe titre="Par zone géographique" lignes={vue.parZone} />
      </Rangee>
    </>
  );
}

function RepartitionListe({
  titre,
  lignes,
}: {
  titre: string;
  lignes: VueRisque['parSecteur'];
}) {
  const palette = usePalette();
  return (
    <CarteSection titre={titre}>
      {lignes.map(ligne => (
        <View key={ligne.cle} style={{ gap: ESPACEMENT.xs }}>
          <View style={styles.ligne}>
            <Text style={{ color: palette.texte }}>{ligne.cle}</Text>
            <Text style={{ color: palette.texte, fontWeight: '600' }}>{ligne.pourcentage}</Text>
          </View>
          <Jauge fraction={ligne.fraction} />
          <SousTitre>{ligne.valeur}</SousTitre>
        </View>
      ))}
    </CarteSection>
  );
}

const styles = StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESPACEMENT.s },
  ligneEnTete: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  position: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: ESPACEMENT.s, gap: ESPACEMENT.xs },
  nom: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
  ligneMatrice: { flexDirection: 'row' },
  enteteMatrice: { width: 90, minHeight: 34, justifyContent: 'center', paddingHorizontal: 6 },
  celluleMatrice: {
    width: 90,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    margin: 1,
    borderRadius: 4,
  },
  texteMatrice: { fontSize: 12, fontWeight: '700' },
});

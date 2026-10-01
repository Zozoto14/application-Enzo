/**
 * Onglet Exposition : ce que vous détenez vraiment, ETF décomposés, et ce
 * que coûtent leurs frais.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../mobile/adaptatif';
import { Decimal } from '../../../core/money/decimal';
import { valoriserPositions } from '../../../core/portfolio/valorisation';
import { Champ, SousTitre, usePalette } from '../../composants';
import { CarteSection, Metrique, Rangee, Vide } from '../../elements';
import { Barres, Donut } from '../../graphiques/Graphiques';
import { formaterMontant } from '../../format';
import { ESPACEMENT } from '../../theme';
import type { EntreesAnalyse } from '../../vues/analyses';
import { construireTransparence, type LigneTransparence } from '../../vues/transparence';

const euros = (valeur: number) => formaterMontant(Decimal.de(valeur.toFixed(2)), { decimales: 0 });
const pct = (valeur: number, decimales = 1) => `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: decimales })} %`;

export function OngletExposition({
  analyse,
  fraisSaisis,
  onChangerFrais,
}: {
  analyse?: EntreesAnalyse;
  fraisSaisis?: Readonly<Record<string, number>>;
  onChangerFrais?(titreId: string, taux: string): void;
}) {
  const palette = usePalette();
  const lignes: LigneTransparence[] = useMemo(() => {
    if (!analyse) return [];
    const titres = new Map(analyse.titres.map(titre => [titre.id, titre]));
    const { valorisees } = valoriserPositions(analyse.etat.positions, analyse.cours);
    const parTitre = new Map<string, number>();
    for (const position of valorisees) {
      parTitre.set(position.titreId, (parTitre.get(position.titreId) ?? 0) + position.valeurMarche.toNumber());
    }
    return [...parTitre.entries()].map(([titreId, valeur]) => {
      const titre = titres.get(titreId);
      return { titreId, nom: titre?.nom ?? titreId, isin: titre?.isin, valeur, secteur: titre?.secteur, zone: titre?.zoneGeographique };
    });
  }, [analyse]);
  const vue = useMemo(() => construireTransparence(lignes, fraisSaisis), [lignes, fraisSaisis]);
  const [saisies, setSaisies] = useState<Record<string, string>>({});

  if (lignes.length === 0) {
    return (
      <CarteSection>
        <Vide>Aucune ligne valorisée : importez vos positions et chargez les cours.</Vide>
      </CarteSection>
    );
  }

  const entreprisesNommees = vue.entreprises.filter(part => !part.nom.startsWith('Autres entreprises'));
  const autres = vue.entreprises.filter(part => part.nom.startsWith('Autres entreprises'));

  return (
    <>
      <CarteSection>
        <SousTitre>
          {vue.partEtf > 0
            ? `${pct(vue.partEtf, 0)} de vos titres passent par des ETF : ils sont ici décomposés en entreprises, pays et secteurs, d’après la composition typique de leur indice (ordres de grandeur 2025).`
            : 'Vous ne détenez pas d’ETF reconnu : l’exposition est celle de vos actions en direct.'}
        </SousTitre>
      </CarteSection>

      <Rangee>
        <CarteSection titre="Entreprises" poids={1.3} testID="exposition-entreprises">
          <Barres
            horizontal
            barres={entreprisesNommees.slice(0, 12).map(part => ({
              libelle: part.nom,
              valeur: part.poids,
              detail: `via ${part.via.join(', ')}`,
            }))}
            formater={valeur => pct(valeur)}
          />
          {autres.map(part => (
            <SousTitre key={part.nom}>
              Et {pct(part.poids)} répartis sur les autres entreprises de l’indice, via {part.via.join(', ')}.
            </SousTitre>
          ))}
        </CarteSection>
        <CarteSection titre="Pays" testID="exposition-pays">
          <Donut
            parts={vue.pays.slice(0, 8).map(part => ({ libelle: part.nom, valeur: part.poids, detail: pct(part.poids) }))}
            formater={valeur => pct(valeur)}
            hauteur={240}
          />
        </CarteSection>
      </Rangee>

      <Rangee>
        <CarteSection titre="Secteurs" testID="exposition-secteurs">
          <Barres
            horizontal
            barres={vue.secteurs.slice(0, 11).map(part => ({ libelle: part.nom, valeur: part.poids, detail: `via ${part.via.join(', ')}` }))}
            formater={valeur => pct(valeur)}
          />
        </CarteSection>

        <CarteSection titre="Frais de vos ETF" testID="frais-etf">
          {vue.frais.length === 0 ? (
            <Vide>Aucun ETF reconnu : pas de frais courants à chiffrer.</Vide>
          ) : (
            <>
              <View style={styles.grille}>
                <Metrique libelle="Par an" valeur={euros(vue.fraisAnnuels)} />
                <Metrique libelle="Sur 20 ans" valeur={euros(vue.fraisVingtAns)} tendance="baisse" />
                <Metrique libelle="Frais moyens" valeur={pct(vue.fraisMoyens, 2)} />
              </View>
              {vue.frais.map(ligne => (
                <View key={ligne.titreId} style={[styles.ligneFrais, { borderColor: palette.bordure }]}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Text style={{ color: palette.texte, fontWeight: '600' }} numberOfLines={1}>
                      {ligne.nom}
                    </Text>
                    <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                      {euros(ligne.annuel)} par an · {euros(ligne.vingtAns)} sur 20 ans
                      {ligne.connu ? '' : ' · taux typique, à vérifier'}
                    </Text>
                  </View>
                  <View style={{ width: 110 }}>
                    <Champ
                      etiquette="Frais %/an"
                      value={saisies[ligne.titreId] ?? String(ligne.taux).replace('.', ',')}
                      onChangeText={texte => {
                        setSaisies(precedentes => ({ ...precedentes, [ligne.titreId]: texte }));
                        onChangerFrais?.(ligne.titreId, texte);
                      }}
                      keyboardType="decimal-pad"
                      editable={Boolean(onChangerFrais)}
                      testID={`frais-${ligne.titreId}`}
                    />
                  </View>
                </View>
              ))}
              <SousTitre>
                Les frais sont prélevés chaque jour dans le cours de l’ETF : vous ne les voyez jamais passer.
                Sur 20 ans, à 5 % par an de rendement, voilà ce qu’ils retirent à votre épargne actuelle.
              </SousTitre>
            </>
          )}
        </CarteSection>
      </Rangee>
    </>
  );
}

const styles = StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
  ligneFrais: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

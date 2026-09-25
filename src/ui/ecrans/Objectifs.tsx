/**
 * Objectifs : un montant à atteindre, une répartition visée, et quoi
 * acheter avec le prochain versement.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Decimal } from '../../core/money/decimal';
import { Actions, Alerte, Bouton, Champ, LigneChamps, SousTitre, usePalette } from '../composants';
import { CarteSection, Metrique, Rangee, Vide } from '../elements';
import { GraphiqueLignes } from '../graphiques/Graphiques';
import { Jauge } from '../indicateurs';
import { formaterMontant } from '../format';
import { ESPACEMENT, palettePour, stylesPartages } from '../theme';
import { repartirVersement, suivreObjectif, type LigneCible, type Objectif } from '../vues/objectifs';

export interface ObjectifsProps {
  objectif?: Objectif;
  valeurActuelle: number;
  aujourdhui: string;
  onEnregistrerObjectif(objectif: Objectif | undefined): void;
  lignes: readonly LigneCible[];
  onChangerCible(titreId: string, cible: string): void;
}

const euros = (valeur: number) => formaterMontant(Decimal.de(valeur.toFixed(2)), { decimales: 0 });
const pct = (valeur: number) => `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const nombre = (texte: string) => Number(texte.replace(/\s/g, '').replace(',', '.'));

function versIso(texte: string): string | undefined {
  const morceaux = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texte.trim());
  if (!morceaux) return undefined;
  const iso = `${morceaux[3]}-${morceaux[2].padStart(2, '0')}-${morceaux[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

function versFrancais(iso: string): string {
  const [annee, mois, jour] = iso.split('-');
  return `${jour}/${mois}/${annee}`;
}

export function Objectifs({
  objectif,
  valeurActuelle,
  aujourdhui,
  onEnregistrerObjectif,
  lignes,
  onChangerCible,
}: ObjectifsProps) {
  const palette = usePalette();
  const [montant, setMontant] = useState(objectif ? String(objectif.montant) : '');
  const [echeance, setEcheance] = useState(objectif ? versFrancais(objectif.date) : '');
  const [rendement, setRendement] = useState(objectif ? String(objectif.rendement).replace('.', ',') : '5');
  const [erreur, setErreur] = useState<string | undefined>();
  const [versement, setVersement] = useState('500');
  const [cibles, setCibles] = useState<Record<string, string>>(
    Object.fromEntries(lignes.map(ligne => [ligne.titreId, String(ligne.cible).replace('.', ',')])),
  );

  const vue = objectif ? suivreObjectif(objectif, valeurActuelle, aujourdhui) : undefined;
  const lignesCibles = lignes.map(ligne => ({ ...ligne, cible: nombre(cibles[ligne.titreId] ?? '0') || 0 }));
  const sommeCibles = lignesCibles.reduce((total, ligne) => total + ligne.cible, 0);
  const achats = repartirVersement(lignesCibles, nombre(versement) || 0);

  const enregistrer = () => {
    const date = versIso(echeance);
    const valeur = nombre(montant);
    const taux = nombre(rendement);
    if (!(valeur > 0)) return setErreur('Indiquez un montant à atteindre.');
    if (!date || date <= aujourdhui) return setErreur('Indiquez une échéance future, au format JJ/MM/AAAA.');
    if (!Number.isFinite(taux) || taux < -10 || taux > 20) return setErreur('Rendement supposé entre -10 et 20 %.');
    setErreur(undefined);
    onEnregistrerObjectif({ montant: valeur, date, rendement: taux });
  };

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
          Objectifs
        </Text>

        <Rangee>
          <CarteSection titre="Objectif d’épargne" testID="carte-objectif">
            <LigneChamps>
              <Champ etiquette="Montant visé (€)" value={montant} onChangeText={setMontant} keyboardType="decimal-pad" placeholder="50000" testID="champ-objectif-montant" />
              <Champ etiquette="Échéance" value={echeance} onChangeText={setEcheance} placeholder="JJ/MM/AAAA" testID="champ-objectif-date" />
              <Champ etiquette="Rendement supposé (%/an)" value={rendement} onChangeText={setRendement} keyboardType="decimal-pad" testID="champ-objectif-rendement" />
            </LigneChamps>
            {erreur ? <Alerte message={erreur} /> : null}
            <Actions>
              <Bouton titre="Enregistrer l’objectif" onPress={enregistrer} testID="bouton-enregistrer-objectif" />
              {objectif ? (
                <Bouton titre="Supprimer" variante="discret" onPress={() => onEnregistrerObjectif(undefined)} />
              ) : null}
            </Actions>
          </CarteSection>

          <CarteSection titre="Où vous en êtes" poids={1.4}>
            {vue && objectif ? (
              <View style={{ gap: ESPACEMENT.s }} testID="suivi-objectif">
                <View style={styles.grille}>
                  <Metrique libelle="Aujourd’hui" valeur={euros(valeurActuelle)} />
                  <Metrique libelle="Objectif" valeur={euros(objectif.montant)} />
                  <Metrique libelle="Chemin parcouru" valeur={pct(vue.progression * 100)} tendance="hausse" />
                  <Metrique libelle="Mois restants" valeur={String(vue.moisRestants)} />
                </View>
                <Jauge fraction={vue.progression} />
                <Text style={{ color: palette.texte, fontSize: 15, lineHeight: 22 }}>
                  {vue.atteint
                    ? 'Objectif atteint : bravo.'
                    : vue.versementMensuel === 0
                      ? `Au rendement supposé de ${pct(objectif.rendement)}, votre épargne actuelle suffit : elle atteindrait environ ${euros(vue.valeurSansVersement)}.`
                      : `Il faut verser environ ${euros(vue.versementMensuel)} par mois pendant ${vue.moisRestants} mois, avec un rendement supposé de ${pct(objectif.rendement)} par an.`}
                </Text>
                <GraphiqueLignes
                  series={[{ nom: 'Trajectoire', couleur: palette.series[0], points: vue.trajectoire, aire: true }]}
                  formater={valeur => euros(valeur)}
                  hauteur={200}
                  repere={{ valeur: objectif.montant, libelle: 'Objectif' }}
                />
                <SousTitre>Une trajectoire régulière, pour fixer les idées : les marchés, eux, ne le sont pas.</SousTitre>
              </View>
            ) : (
              <Vide>Fixez un montant et une échéance : l’application calcule le versement mensuel qu’il faut.</Vide>
            )}
          </CarteSection>
        </Rangee>

        <Rangee>
          <CarteSection titre="Répartition cible">
            {lignes.length === 0 ? (
              <Vide>Aucune ligne détenue.</Vide>
            ) : (
              <>
                <SousTitre>Le poids que vous visez pour chaque ligne. Par défaut, le poids actuel.</SousTitre>
                {lignesCibles.map(ligne => {
                  const total = lignes.reduce((somme, l) => somme + l.valeur, 0);
                  return (
                    <View key={ligne.titreId} style={[styles.ligneCible, { borderColor: palette.bordure }]}>
                      <View style={{ flex: 1, minWidth: 160 }}>
                        <Text style={{ color: palette.texte, fontWeight: '600' }} numberOfLines={1}>
                          {ligne.nom}
                        </Text>
                        <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                          Actuel : {pct(total > 0 ? (ligne.valeur / total) * 100 : 0)}
                        </Text>
                      </View>
                      <View style={{ width: 110 }}>
                        <Champ
                          etiquette="Cible %"
                          value={cibles[ligne.titreId] ?? ''}
                          onChangeText={texte => {
                            setCibles(precedentes => ({ ...precedentes, [ligne.titreId]: texte }));
                            onChangerCible(ligne.titreId, texte);
                          }}
                          keyboardType="decimal-pad"
                          testID={`cible-${ligne.titreId}`}
                        />
                      </View>
                    </View>
                  );
                })}
                <Text style={{ color: Math.abs(sommeCibles - 100) < 0.05 ? palette.texteSecondaire : palette.danger }}>
                  Total : {pct(sommeCibles)}
                  {Math.abs(sommeCibles - 100) < 0.05 ? '' : ' — les cibles seront ramenées à 100 %.'}
                </Text>
              </>
            )}
          </CarteSection>

          <CarteSection titre="Prochain versement" poids={1.4}>
            <View style={{ maxWidth: 240 }}>
              <Champ etiquette="Montant à investir (€)" value={versement} onChangeText={setVersement} keyboardType="decimal-pad" testID="champ-versement" />
            </View>
            {achats.length === 0 ? (
              <Vide>Indiquez un montant et au moins une cible.</Vide>
            ) : (
              <View testID="achats-conseilles">
                {achats.map(achat => (
                  <View key={achat.titreId} style={[styles.ligneCible, { borderColor: palette.bordure }]}>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <Text style={{ color: palette.texte, fontWeight: '600' }} numberOfLines={1}>
                        {achat.nom}
                      </Text>
                      <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                        {pct(achat.poidsAvant)} → {pct(achat.poidsApres)} (cible {pct(achat.cible)})
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: achat.montant > 0 ? palette.hausse : palette.texteSecondaire, fontWeight: '700' }}>
                        {achat.montant > 0 ? `+${euros(achat.montant)}` : '—'}
                      </Text>
                      {achat.parts !== undefined && achat.montant > 0 ? (
                        <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                          {achat.parts === 0 ? 'moins d’une part' : `≈ ${achat.parts} part${achat.parts > 1 ? 's' : ''}`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
                <SousTitre>Uniquement des achats : on rééquilibre avec les versements, sans vendre.</SousTitre>
              </View>
            )}
          </CarteSection>
        </Rangee>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
  ligneCible: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

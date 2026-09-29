/**
 * Mon carnet : une thèse écrite à froid pour chaque valeur détenue ou
 * suivie — pourquoi, jusqu'où, et ce qui ferait changer d'avis.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Actions, Bouton, Champ, SousTitre, usePalette } from '../composants';
import { CarteSection, Rangee, Signe, Vide } from '../elements';
import { Jauge } from '../indicateurs';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';
import type { LigneCarnet, These } from '../vues/carnet';

export interface CarnetProps {
  lignes: readonly LigneCarnet[];
  aujourdhui: string;
  onEnregistrer(titreId: string, these: These | undefined): void;
}

const nombre = (texte: string): number | undefined => {
  const valeur = Number(texte.replace(/\s/g, '').replace(',', '.'));
  return texte.trim() && Number.isFinite(valeur) && valeur > 0 ? valeur : undefined;
};
const fr = (valeur: number) => valeur.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const dateFr = (iso: string) => iso.split('-').reverse().join('/');

const ETATS: Record<LigneCarnet['etat'], { libelle: string; couleur: 'hausse' | 'baisse' | 'texteSecondaire' | 'accent' }> = {
  'objectif-atteint': { libelle: '🎯 Objectif atteint', couleur: 'hausse' },
  'a-revoir': { libelle: '⚠️ À revoir', couleur: 'baisse' },
  'en-cours': { libelle: 'En cours', couleur: 'accent' },
  'sans-cours': { libelle: 'Cours inconnu', couleur: 'texteSecondaire' },
};

export function Carnet({ lignes, aujourdhui, onEnregistrer }: CarnetProps) {
  const palette = usePalette();
  const [edition, setEdition] = useState<string | undefined>();
  const avecThese = lignes.filter(ligne => ligne.these);
  const sansThese = lignes.filter(ligne => !ligne.these);

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
          Mon carnet
        </Text>
        <SousTitre>
          Écrivez à froid pourquoi vous détenez chaque valeur, où vous visez, et ce qui vous ferait changer d’avis.
          L’application vous relit votre thèse quand le cours atteint l’objectif ou passe sous votre seuil.
        </SousTitre>

        {lignes.length === 0 ? <Vide>Aucune valeur détenue ou suivie pour l’instant.</Vide> : null}

        <Rangee>
          <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 300, gap: ESPACEMENT.m }}>
            {avecThese.map(ligne =>
              edition === ligne.titreId ? (
                <Editeur key={ligne.titreId} ligne={ligne} aujourdhui={aujourdhui} onEnregistrer={onEnregistrer} onFermer={() => setEdition(undefined)} />
              ) : (
                <CarteThese key={ligne.titreId} ligne={ligne} onModifier={() => setEdition(ligne.titreId)} />
              ),
            )}
          </View>
        </Rangee>

        {sansThese.length > 0 ? (
          <CarteSection titre="Sans thèse écrite">
            {sansThese.map(ligne =>
              edition === ligne.titreId ? (
                <Editeur key={ligne.titreId} ligne={ligne} aujourdhui={aujourdhui} onEnregistrer={onEnregistrer} onFermer={() => setEdition(undefined)} />
              ) : (
                <View key={ligne.titreId} style={[styles.ligneSans, { borderColor: palette.bordure }]}>
                  <Text style={{ color: palette.texte, flex: 1 }} numberOfLines={1}>
                    {ligne.nom}
                  </Text>
                  <Bouton titre="Écrire ma thèse" variante="discret" onPress={() => setEdition(ligne.titreId)} testID={`ecrire-${ligne.titreId}`} />
                </View>
              ),
            )}
          </CarteSection>
        ) : null}
      </ScrollView>
    </View>
  );
}

function CarteThese({ ligne, onModifier }: { ligne: LigneCarnet; onModifier(): void }) {
  const palette = usePalette();
  const these = ligne.these!;
  const etat = ETATS[ligne.etat];
  return (
    <CarteSection
      titre={ligne.nom}
      actions={<Text style={{ color: palette[etat.couleur], fontWeight: '700' }}>{etat.libelle}</Text>}
      testID={`these-${ligne.titreId}`}>
      <View style={styles.chiffres}>
        <Text style={{ color: palette.texte }}>
          Cours : <Text style={{ fontWeight: '700' }}>{ligne.cours === undefined ? '—' : fr(ligne.cours)}</Text>
        </Text>
        {these.objectif ? <Text style={{ color: palette.texte }}>Objectif : <Text style={{ fontWeight: '700' }}>{fr(these.objectif)}</Text></Text> : null}
        {these.revoirSous ? <Text style={{ color: palette.texte }}>Revoir sous : <Text style={{ fontWeight: '700' }}>{fr(these.revoirSous)}</Text></Text> : null}
        {ligne.depuisEcriture !== undefined ? (
          <Signe
            texte={`${ligne.depuisEcriture >= 0 ? '+' : ''}${fr(ligne.depuisEcriture)} % depuis le ${dateFr(these.ecriteLe)}`}
            tendance={ligne.depuisEcriture >= 0 ? 'hausse' : 'baisse'}
            taille={13}
          />
        ) : null}
      </View>
      {ligne.progression !== undefined ? <Jauge fraction={ligne.progression} /> : null}
      <Text style={[styles.etiquette, { color: palette.texteSecondaire }]}>POURQUOI</Text>
      <Text style={{ color: palette.texte, lineHeight: 21 }}>{these.pourquoi || '—'}</Text>
      {these.venteSi ? (
        <>
          <Text style={[styles.etiquette, { color: palette.texteSecondaire }]}>JE VENDS SI</Text>
          <Text style={{ color: palette.texte, lineHeight: 21 }}>{these.venteSi}</Text>
        </>
      ) : null}
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton titre="Modifier" variante="discret" onPress={onModifier} testID={`modifier-these-${ligne.titreId}`} />
      </View>
    </CarteSection>
  );
}

function Editeur({
  ligne,
  aujourdhui,
  onEnregistrer,
  onFermer,
}: {
  ligne: LigneCarnet;
  aujourdhui: string;
  onEnregistrer(titreId: string, these: These | undefined): void;
  onFermer(): void;
}) {
  const palette = usePalette();
  const [pourquoi, setPourquoi] = useState(ligne.these?.pourquoi ?? '');
  const [venteSi, setVenteSi] = useState(ligne.these?.venteSi ?? '');
  const [objectif, setObjectif] = useState(ligne.these?.objectif ? String(ligne.these.objectif).replace('.', ',') : '');
  const [revoirSous, setRevoirSous] = useState(ligne.these?.revoirSous ? String(ligne.these.revoirSous).replace('.', ',') : '');
  return (
    <View style={[styles.editeur, { borderColor: palette.accent, backgroundColor: palette.surface }]} testID={`editeur-${ligne.titreId}`}>
      <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 16 }}>{ligne.nom}</Text>
      <Champ
        etiquette="Pourquoi je détiens cette valeur"
        value={pourquoi}
        onChangeText={setPourquoi}
        multiline
        style={{ minHeight: 90, textAlignVertical: 'top' }}
        placeholder="Leader de son marché, dette faible, croissance régulière…"
        testID="champ-pourquoi"
      />
      <View style={styles.paire}>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Champ etiquette="Objectif de cours" value={objectif} onChangeText={setObjectif} keyboardType="decimal-pad" testID="champ-objectif-these" />
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <Champ etiquette="Je relis ma thèse sous" value={revoirSous} onChangeText={setRevoirSous} keyboardType="decimal-pad" testID="champ-revoir-these" />
        </View>
      </View>
      <Champ
        etiquette="Ce qui me ferait vendre"
        value={venteSi}
        onChangeText={setVenteSi}
        multiline
        style={{ minHeight: 60, textAlignVertical: 'top' }}
        placeholder="La marge baisse deux ans de suite, le dirigeant fondateur part…"
        testID="champ-vente-si"
      />
      <Actions>
        {ligne.these ? (
          <Bouton
            titre="Supprimer la thèse"
            variante="discret"
            onPress={() => {
              onEnregistrer(ligne.titreId, undefined);
              onFermer();
            }}
          />
        ) : null}
        <Bouton titre="Annuler" variante="discret" onPress={onFermer} />
        <Bouton
          titre="Enregistrer"
          testID="enregistrer-these"
          onPress={() => {
            onEnregistrer(ligne.titreId, {
              pourquoi: pourquoi.trim(),
              venteSi: venteSi.trim(),
              objectif: nombre(objectif),
              revoirSous: nombre(revoirSous),
              // Le point de départ reste celui de la première écriture.
              ecriteLe: ligne.these?.ecriteLe ?? aujourdhui,
              coursEcriture: ligne.these?.coursEcriture ?? ligne.cours,
            });
            onFermer();
          }}
        />
      </Actions>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  chiffres: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: ESPACEMENT.l, rowGap: ESPACEMENT.xs },
  etiquette: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: ESPACEMENT.s },
  ligneSans: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s, paddingVertical: ESPACEMENT.xs, borderTopWidth: StyleSheet.hairlineWidth },
  editeur: { borderWidth: 1, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
});

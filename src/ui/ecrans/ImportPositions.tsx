/**
 * Import d'un export de positions.
 *
 * Sur l'ordinateur, le fichier se glisse dans l'écran ; sur le téléphone, son
 * contenu se colle (un sélecteur de fichiers demanderait un module natif de
 * plus). Un guide rappelle où trouver l'export chez le courtier.
 *
 * Rien n'est enregistré avant que l'aperçu n'ait été affiché. Un import de
 * portefeuille se défait mal : une étape de plus vaut mieux qu'un journal à
 * nettoyer à la main.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable, Text } from '../mobile/adaptatif';
import type { PositionImportee } from '../../core/import/positions';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON, stylesPartages } from '../theme';
import { BoutonPrincipal } from '../mobile/BoutonPrincipal';
import { PageFormulaire } from '../mobile/PageFormulaire';
import { useMobile } from '../mobile/useMobile';
import { apercuPositions } from '../vues/import';
import { DepotFichier } from '../DepotFichier';
import { Segments } from '../elements';
import { ImportOperations } from './ImportOperations';
import type { ApercuOperations, ContexteApercu } from '../vues/importOperations';

export interface ImportPositionsProps {
  onImporter(positions: PositionImportee[]): void;
  onAnnuler(): void;
  /** Import de l'historique : proposé quand l'application en fournit le contexte. */
  operations?: {
    contexte: ContexteApercu;
    onImporter(apercu: ApercuOperations, remplacerReprise: boolean): void;
  };
}

type Mode = 'Positions' | 'Opérations';

export function ImportPositions({ onImporter, onAnnuler, operations }: ImportPositionsProps) {
  const palette = usePalette();
  const mobile = useMobile();
  const [contenu, setContenu] = useState('');
  const [mode, setMode] = useState<Mode>('Positions');

  const bascule = operations ? (
    <Segments<Mode>
      options={['Positions', 'Opérations']}
      actif={mode}
      onChoisir={valeur => setMode(valeur)}
      prefixeTest="mode-import"
    />
  ) : null;

  if (operations && mode === 'Opérations') {
    return (
      <ImportOperations
        contexte={operations.contexte}
        onImporter={operations.onImporter}
        onAnnuler={onAnnuler}
        bascule={bascule}
      />
    );
  }

  const apercu = apercuPositions(contenu);

  return (
    <PageFormulaire
      onRetour={onAnnuler}
      pied={
        <>
          <BoutonPrincipal titre="Importer" testID="bouton-importer" desactive={!apercu.pret} onPress={() => onImporter(apercu.positions)} />
          <BoutonPrincipal titre="Annuler" variante="discret" onPress={onAnnuler} />
        </>
      }>
      {mobile ? null : <Titre>Importer vos positions</Titre>}
      {bascule}
      <SousTitre>
        Déposez l'export « positions instantanées » de votre courtier, ou
        copiez son contenu entier et collez-le ci-dessous.
      </SousTitre>

      <GuideExport ouvertAuDepart={contenu.trim() === ''} />

      <DepotFichier onContenu={texte => setContenu(texte)} />

      <Champ
        etiquette="Contenu du fichier"
        value={contenu}
        onChangeText={setContenu}
        multiline
        numberOfLines={6}
        nature="multiligne"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="name;isin;quantity;buyingPrice;…"
        style={styles.zoneTexte}
      />

      {apercu.avertissements.map(message => (
        <Alerte key={message} message={message} />
      ))}

      {apercu.lignes.length > 0 ? (
        <Carte>
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            {apercu.lignes.length} position(s) détectée(s)
          </Text>
          {apercu.lignes.map(ligne => (
            <View key={ligne.isin} style={[styles.ligne, { borderColor: palette.bordure }]}>
              <View style={stylesPartages.ligne}>
                <Text
                  style={[styles.nom, { color: palette.texte }]}
                  numberOfLines={1}>
                  {ligne.nom}
                </Text>
                <Text style={{ color: palette.texte, fontWeight: '600' }}>
                  {ligne.coutTotal}
                </Text>
              </View>
              <SousTitre>
                {ligne.quantite} × PRU {ligne.pru}
                {ligne.approche ? ' · prix de revient approché' : ''}
              </SousTitre>
            </View>
          ))}
          <View style={[stylesPartages.ligne, { paddingTop: ESPACEMENT.s }]}>
            <Text style={{ color: palette.texte, fontWeight: '700' }}>
              Prix de revient total
            </Text>
            <Text style={{ color: palette.texte, fontWeight: '700' }}>
              {apercu.total}
            </Text>
          </View>
        </Carte>
      ) : null}

      {apercu.anomalies.length > 0 ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>
            Lignes ignorées
          </Text>
          {apercu.anomalies.map(anomalie => (
            <SousTitre key={`${anomalie.ligne}-${anomalie.message}`}>
              Ligne {anomalie.ligne} : {anomalie.message}
            </SousTitre>
          ))}
        </Carte>
      ) : null}

      {mobile ? null : (
        <Actions>
          <Bouton
            titre="Importer"
            testID="bouton-importer"
            desactive={!apercu.pret}
            onPress={() => onImporter(apercu.positions)}
          />
          <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} />
        </Actions>
      )}
    </PageFormulaire>
  );
}

const ETAPES_BOURSOBANK = [
  'Sur votre ordinateur, allez sur boursobank.com et connectez-vous (l’application mobile ne propose pas l’export).',
  'Dans « Mes comptes », cliquez sur votre PEA ou votre compte-titres.',
  'Ouvrez la liste de vos lignes : la partie « Positions » ou « Portefeuille ».',
  'Au-dessus du tableau, en haut à droite, cliquez sur « Exporter » ou « Télécharger » (petite flèche vers le bas), puis choisissez CSV.',
  'Le fichier arrive dans votre dossier Téléchargements : glissez-le dans le cadre ci-dessous.',
];

/** Où trouver l'export chez BoursoBank : ouvert tant qu'aucun fichier n'est chargé. */
function GuideExport({ ouvertAuDepart }: { ouvertAuDepart: boolean }) {
  const palette = usePalette();
  const [ouvert, setOuvert] = useState<boolean | undefined>();
  const deplie = ouvert ?? ouvertAuDepart;
  return (
    <View style={[styles.guide, { borderColor: palette.bordure, backgroundColor: palette.surface }]}>
      <Pressable
        testID="guide-export"
        accessibilityRole="button"
        accessibilityState={{ expanded: deplie }}
        onPress={() => setOuvert(!deplie)}
        style={stylesPartages.ligne}>
        <Text style={[styles.sectionTitre, { color: palette.texte, flex: 1 }]}>
          Où trouver ce fichier chez BoursoBank ?
        </Text>
        <Text style={{ color: palette.accent, fontWeight: '700' }}>{deplie ? 'Masquer' : 'Afficher'}</Text>
      </Pressable>
      {deplie ? (
        <View style={{ gap: ESPACEMENT.s, marginTop: ESPACEMENT.s }}>
          <Text style={{ color: palette.texteSecondaire }}>
            Il vous faut l’export « positions instantanées » : la liste de ce que vous détenez
            aujourd’hui, pas un relevé d’opérations.
          </Text>
          {ETAPES_BOURSOBANK.map((etape, rang) => (
            <View key={etape} style={styles.etape}>
              <View style={[styles.numero, { backgroundColor: palette.accentFond }]}>
                <Text style={{ color: palette.accent, fontWeight: '800' }}>{rang + 1}</Text>
              </View>
              <Text style={{ color: palette.texte, flex: 1, lineHeight: 20 }}>{etape}</Text>
            </View>
          ))}
          <Text style={{ color: palette.texteSecondaire }}>
            Pour vérifier : ouvert avec le Bloc-notes, le fichier commence par
          </Text>
          <Text
            selectable
            style={[styles.code, { color: palette.texte, backgroundColor: palette.surfaceHaute }]}>
            name;isin;quantity;buyingPrice;lastPrice;…
          </Text>
          <Text style={{ color: palette.texteSecondaire }}>
            Importez-le une seule fois : un second import ajouterait les lignes en double. Ensuite,
            l’application trouve seule les symboles boursiers et charge l’historique des cours.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  guide: { borderWidth: 1, borderRadius: RAYON.m, padding: ESPACEMENT.m },
  etape: { flexDirection: 'row', gap: ESPACEMENT.s, alignItems: 'flex-start' },
  numero: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  code: { fontFamily: 'monospace', fontSize: 12, padding: ESPACEMENT.s, borderRadius: RAYON.s },
  zoneTexte: { minHeight: 120, textAlignVertical: 'top' },
  sectionTitre: { fontSize: 17, fontWeight: '700' },
  ligne: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.xs,
  },
  nom: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
});

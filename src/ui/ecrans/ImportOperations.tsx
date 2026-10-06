/**
 * Import de l'historique des opérations : achats, ventes, dividendes,
 * versements. Rien n'est enregistré avant l'aperçu.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '../mobile/adaptatif';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { DepotFichier } from '../DepotFichier';
import { formaterDate } from '../format';
import { ESPACEMENT, stylesPartages } from '../theme';
import { BoutonPrincipal } from '../mobile/BoutonPrincipal';
import { themeActif } from '../mobile/jetons';
import { Cellule, GroupeCellules } from '../mobile/ListeCellules';
import { PageFormulaire } from '../mobile/PageFormulaire';
import { useMobile } from '../mobile/useMobile';
import { apercuOperations, type ApercuOperations, type ContexteApercu } from '../vues/importOperations';

const LIBELLES: Record<string, string> = {
  ACHAT: 'achat',
  VENTE: 'vente',
  DIVIDENDE: 'dividende',
  VERSEMENT: 'versement',
  RETRAIT: 'retrait',
  FRAIS: 'frais',
};

export interface ImportOperationsProps {
  contexte: ContexteApercu;
  onImporter(apercu: ApercuOperations, remplacerReprise: boolean): void;
  onAnnuler(): void;
  /** Bascule Positions / Opérations, affichée en tête. */
  bascule?: React.ReactNode;
}

export function ImportOperations({ contexte, onImporter, onAnnuler, bascule }: ImportOperationsProps) {
  const palette = usePalette();
  const mobile = useMobile();
  const [contenu, setContenu] = useState('');
  const [remplacer, setRemplacer] = useState(true);
  const apercu = useMemo(() => apercuOperations(contenu, contexte), [contenu, contexte]);
  const nombre = apercu.transactions.length;

  return (
    <PageFormulaire
      onRetour={onAnnuler}
      pied={
        <>
          <BoutonPrincipal
            titre="Importer"
            testID="bouton-importer-operations"
            desactive={nombre === 0}
            onPress={() => onImporter(apercu, remplacer && apercu.reprise.length > 0)}
          />
          <BoutonPrincipal titre="Annuler" variante="discret" onPress={onAnnuler} />
        </>
      }>
      {mobile ? null : <Titre>Importer vos opérations</Titre>}
      {bascule}
      <SousTitre>
        L’historique complet (achats, ventes, dividendes, versements) rend exacts vos performances, votre
        TRI et vos impôts depuis le premier jour, au lieu de partir de la date d’import.
      </SousTitre>

      <Carte>
        <Text style={[styles.sectionTitre, { color: palette.texte }]}>Où trouver ce fichier ?</Text>
        <SousTitre>
          Sur boursobank.com, dans votre PEA ou compte-titres : la liste des mouvements ou de l’historique
          des opérations, puis « Exporter » au format CSV. Le fichier des positions ne suffit pas : il faut
          celui des opérations.
        </SousTitre>
        <SousTitre>
          Format générique accepté aussi : colonnes date, operation, libelle, isin, ticker, quantite,
          prix_unitaire, montant, frais, devise.
        </SousTitre>
      </Carte>

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
        placeholder="Date opération;Libellé;Débit;Crédit…"
        style={styles.zoneTexte}
      />

      {contenu.trim() && !apercu.modele ? (
        <Alerte
          message={`Format non reconnu. Colonnes attendues introuvables : ${apercu.colonnesManquantes.join(', ')}. Envoyez-moi les noms de colonnes de votre fichier pour que je l’ajoute.`}
        />
      ) : null}

      {apercu.modele ? (
        <Carte testID="apercu-operations">
          <Text style={[styles.sectionTitre, { color: palette.texte }]}>
            {nombre} opération{nombre > 1 ? 's' : ''} à importer
          </Text>
          <SousTitre>
            Format : {apercu.modele.libelle}
            {apercu.periode
              ? ` · du ${formaterDate(apercu.periode.debut)} au ${formaterDate(apercu.periode.fin)}`
              : ''}
          </SousTitre>
          {apercu.modele.provisoire ? (
            <Alerte message="Ce format n’a pas encore été vérifié sur un vrai fichier : contrôlez l’aperçu avant d’importer." />
          ) : null}
          <SousTitre>
            {Object.entries(apercu.parType)
              .map(([type, n]) => `${n} ${LIBELLES[type] ?? type}${n > 1 && type !== 'FRAIS' ? 's' : ''}`)
              .join(' · ')}
          </SousTitre>
          {apercu.doublons > 0 ? (
            <SousTitre>{apercu.doublons} opération(s) déjà présente(s), ignorée(s).</SousTitre>
          ) : null}
          {apercu.nouveauxTitres.length > 0 ? (
            <SousTitre>
              Valeurs créées : {apercu.nouveauxTitres.map(titre => titre.nom).join(', ')}. Leurs symboles
              boursiers seront cherchés automatiquement.
            </SousTitre>
          ) : null}
        </Carte>
      ) : null}

      {apercu.reprise.length > 0 && mobile ? (
        <GroupeCellules
          theme={themeActif()}
          titre="Reprise de positions"
          note={`Vos positions ont été importées d’un bloc (${apercu.reprise.length} ligne(s) « reprise d’antériorité »). Garder les deux compterait vos actions deux fois. Recommandé : remplacer.`}>
          <Cellule theme={themeActif()} titre="Remplacer la reprise de positions" interrupteur={{ valeur: remplacer, onChanger: setRemplacer }} />
        </GroupeCellules>
      ) : apercu.reprise.length > 0 ? (
        <Carte>
          <View style={stylesPartages.ligne}>
            <Text style={{ color: palette.texte, fontWeight: '600', flex: 1 }}>
              Remplacer la reprise de positions
            </Text>
            <Switch value={remplacer} onValueChange={setRemplacer} accessibilityLabel="Remplacer la reprise de positions" />
          </View>
          <SousTitre>
            Vos positions ont été importées d’un bloc ({apercu.reprise.length} ligne(s) « reprise
            d’antériorité »). L’historique contient les vrais achats : garder les deux compterait vos
            actions deux fois. Recommandé : remplacer.
          </SousTitre>
        </Carte>
      ) : null}

      {apercu.anomalies.length > 0 ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>
            {apercu.anomalies.length} ligne(s) ignorée(s)
          </Text>
          {apercu.anomalies.slice(0, 10).map(anomalie => (
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
            testID="bouton-importer-operations"
            desactive={nombre === 0}
            onPress={() => onImporter(apercu, remplacer && apercu.reprise.length > 0)}
          />
          <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} />
        </Actions>
      )}
    </PageFormulaire>
  );
}

const styles = StyleSheet.create({
  zoneTexte: { minHeight: 120, textAlignVertical: 'top' },
  sectionTitre: { fontSize: 17, fontWeight: '700' },
});

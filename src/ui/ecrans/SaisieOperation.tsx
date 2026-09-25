/**
 * Saisie d'une opération.
 *
 * L'écran n'applique aucune règle : il affiche les champs que
 * `vues/saisie.ts` déclare pertinents pour le type choisi, et rend les
 * messages d'erreur champ par champ.
 *
 * Les champs inutiles disparaissent plutôt que d'être grisés : un versement
 * n'a ni quantité ni cours, et les afficher vides invite à les remplir.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { Compte, Position, Titre, Transaction, TypeTransaction } from '../../core/domain/types';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre as TitreEcran, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import { formaterMontant } from '../format';
import {
  FORMULAIRE_VIDE,
  LIBELLES_TYPE,
  champsVisibles,
  resumeOperation,
  validerOperation,
  type ErreursSaisie,
  type FormulaireOperation,
} from '../vues/saisie';

export interface SaisieOperationProps {
  comptes: readonly Compte[];
  titres: readonly Titre[];
  positions: readonly Position[];
  onEnregistrer(transaction: Transaction): void;
  onAnnuler(): void;
  /** Ouvre la creation d'une valeur absente de la liste. */
  onCreerTitre?(): void;
  genererId?(): string;
}

const TYPES: TypeTransaction[] = [
  'ACHAT',
  'VENTE',
  'DIVIDENDE',
  'VERSEMENT',
  'RETRAIT',
  'FRAIS',
];

export function SaisieOperation({
  comptes,
  titres,
  positions,
  onEnregistrer,
  onAnnuler,
  onCreerTitre,
  genererId,
}: SaisieOperationProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();

  const [formulaire, setFormulaire] = useState<FormulaireOperation>({
    ...FORMULAIRE_VIDE,
    compteId: comptes[0]?.id ?? '',
  });
  const [erreurs, setErreurs] = useState<ErreursSaisie>({});

  const modifier = (champ: keyof FormulaireOperation, valeur: string) => {
    setFormulaire(precedent => ({ ...precedent, [champ]: valeur }));
    setErreurs(precedent => ({ ...precedent, [champ]: undefined }));
  };

  const visibles = new Set(champsVisibles(formulaire.type));
  const resume = resumeOperation(formulaire);

  const enregistrer = () => {
    const resultat = validerOperation(formulaire, {
      comptes,
      titres,
      positions,
      genererId: genererId ?? (() => `op-${Date.now()}`),
    });
    setErreurs(resultat.erreurs);
    if (resultat.transaction) {
      onEnregistrer(resultat.transaction);
    }
  };

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <TitreEcran>Nouvelle opération</TitreEcran>

      <Carte>
        <SousTitre>Type d'opération</SousTitre>
        <Choix
          options={TYPES.map(type => ({ cle: type, libelle: LIBELLES_TYPE[type] }))}
          selection={formulaire.type}
          onSelection={cle => modifier('type', cle)}
          prefixe="type"
        />
      </Carte>

      <Carte>
        <SousTitre>Compte</SousTitre>
        <Choix
          options={comptes.map(compte => ({ cle: compte.id, libelle: compte.nom }))}
          selection={formulaire.compteId}
          onSelection={cle => modifier('compteId', cle)}
          prefixe="compte"
        />
        {erreurs.compteId ? <Alerte message={erreurs.compteId} /> : null}
      </Carte>

      {visibles.has('titreId') ? (
        <Carte>
          <SousTitre>Valeur</SousTitre>
          <Choix
            options={titres.map(titre => ({ cle: titre.id, libelle: titre.nom }))}
            selection={formulaire.titreId}
            onSelection={cle => modifier('titreId', cle)}
            prefixe="titre"
          />
          {erreurs.titreId ? <Alerte message={erreurs.titreId} /> : null}
          {onCreerTitre ? (
            <Bouton
              titre={titres.length === 0 ? 'Creer une valeur' : 'Valeur absente ?'}
              testID="bouton-creer-titre-depuis-saisie"
              variante="discret"
              onPress={onCreerTitre}
            />
          ) : null}
        </Carte>
      ) : null}

      <Champ
        etiquette="Date"
        value={formulaire.date}
        onChangeText={texte => modifier('date', texte)}
        placeholder="JJ/MM/AAAA"
        keyboardType="numbers-and-punctuation"
      />
      {erreurs.date ? <Alerte message={erreurs.date} /> : null}

      {visibles.has('quantite') ? (
        <>
          <Champ
            etiquette="Quantité"
            value={formulaire.quantite}
            onChangeText={texte => modifier('quantite', texte)}
            keyboardType="decimal-pad"
          />
          {erreurs.quantite ? <Alerte message={erreurs.quantite} /> : null}
        </>
      ) : null}

      {visibles.has('prixUnitaire') ? (
        <>
          <Champ
            etiquette="Cours unitaire"
            value={formulaire.prixUnitaire}
            onChangeText={texte => modifier('prixUnitaire', texte)}
            keyboardType="decimal-pad"
          />
          {erreurs.prixUnitaire ? <Alerte message={erreurs.prixUnitaire} /> : null}
        </>
      ) : null}

      {visibles.has('frais') ? (
        <>
          <Champ
            etiquette="Frais"
            value={formulaire.frais}
            onChangeText={texte => modifier('frais', texte)}
            keyboardType="decimal-pad"
            indication="Commission et taxe sur les transactions financières comprises."
          />
          {erreurs.frais ? <Alerte message={erreurs.frais} /> : null}
        </>
      ) : null}

      {visibles.has('montant') ? (
        <>
          <Champ
            etiquette="Montant"
            value={formulaire.montant}
            onChangeText={texte => modifier('montant', texte)}
            keyboardType="decimal-pad"
          />
          {erreurs.montant ? <Alerte message={erreurs.montant} /> : null}
        </>
      ) : null}

      <Champ
        etiquette="Note"
        value={formulaire.note}
        onChangeText={texte => modifier('note', texte)}
        placeholder="Facultatif"
      />

      {resume ? (
        <Carte>
          <View style={stylesPartages.ligne}>
            <SousTitre>{resume.libelle}</SousTitre>
            <Text style={{ color: palette.texte, fontSize: 18, fontWeight: '700' }}>
              {formaterMontant(resume.total)}
            </Text>
          </View>
        </Carte>
      ) : null}

      <Bouton titre="Enregistrer" testID="bouton-enregistrer" onPress={enregistrer} />
      <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} />
    </ScrollView>
  );
}

interface OptionChoix {
  cle: string;
  libelle: string;
}

/** Rangée de pastilles sélectionnables, à la place d'une liste déroulante. */
function Choix({
  options,
  selection,
  onSelection,
  prefixe,
}: {
  options: OptionChoix[];
  selection: string;
  onSelection(cle: string): void;
  prefixe: string;
}) {
  const palette = usePalette();
  return (
    <View style={styles.pastilles}>
      {options.map(option => {
        const actif = option.cle === selection;
        return (
          <Pressable
            key={option.cle}
            testID={`${prefixe}-${option.cle}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: actif }}
            onPress={() => onSelection(option.cle)}
            style={[
              styles.pastille,
              {
                backgroundColor: actif ? palette.accentPlein : 'transparent',
                borderColor: actif ? palette.accent : palette.bordure,
              },
            ]}>
            <Text style={{ color: actif ? palette.surAccent : palette.texte }}>
              {option.libelle}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  pastille: {
    borderRadius: RAYON.l,
    borderWidth: 1,
    paddingVertical: ESPACEMENT.xs + 2,
    paddingHorizontal: ESPACEMENT.m - 4,
  },
});

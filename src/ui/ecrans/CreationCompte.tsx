/**
 * Création d'un compte.
 *
 * Premier écran utile après le déverrouillage initial : sans compte, ni
 * saisie ni import ne sont possibles.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable, Text } from '../mobile/adaptatif';
import type { Compte, TypeCompte } from '../../core/domain/types';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import { Segments } from '../elements';
import { BoutonPrincipal } from '../mobile/BoutonPrincipal';
import { FeuilleBasse } from '../mobile/FeuilleBasse';
import { themeActif } from '../mobile/jetons';
import { PageFormulaire } from '../mobile/PageFormulaire';
import { useMobile } from '../mobile/useMobile';
import {
  FORMULAIRE_COMPTE_VIDE,
  LIBELLES_TYPE_COMPTE,
  formulaireDepuisCompte,
  indicationDate,
  validerCompte,
  type ErreursCompte,
  type FormulaireCompte,
} from '../vues/compte';

export interface CreationCompteProps {
  comptesExistants: readonly Compte[];
  onCreer(compte: Compte): void;
  onAnnuler?: () => void;
  genererId?(): string;
  /** Présent : l'écran modifie ce compte au lieu d'en créer un. */
  compteAModifier?: Compte;
  /** Nombre d'opérations du compte modifié, supprimées avec lui. */
  nombreOperations?: number;
  onSupprimer?(): void;
}

const TYPES: TypeCompte[] = ['PEA', 'PEA_PME', 'CTO'];

export function CreationCompte({
  comptesExistants,
  onCreer,
  onAnnuler,
  genererId,
  compteAModifier,
  nombreOperations = 0,
  onSupprimer,
}: CreationCompteProps) {
  const [confirmation, setConfirmation] = useState(false);
  // La devise d'un compte qui a déjà des opérations ne change plus : tous ses
  // montants sont exprimés dedans.
  const deviseFigee = Boolean(compteAModifier) && nombreOperations > 0;
  const palette = usePalette();
  const mobile = useMobile();
  const [formulaire, setFormulaire] = useState<FormulaireCompte>(
    compteAModifier ? formulaireDepuisCompte(compteAModifier) : FORMULAIRE_COMPTE_VIDE,
  );
  const [erreurs, setErreurs] = useState<ErreursCompte>({});

  const modifier = (champ: keyof FormulaireCompte, valeur: string) => {
    setFormulaire(precedent => ({ ...precedent, [champ]: valeur }));
    setErreurs(precedent => ({ ...precedent, [champ]: undefined }));
  };

  const creer = () => {
    const resultat = validerCompte(
      formulaire,
      comptesExistants,
      genererId ?? (() => `compte-${Date.now()}`),
      compteAModifier,
    );
    setErreurs(resultat.erreurs);
    if (resultat.compte) {
      onCreer(resultat.compte);
    }
  };

  return (
    <PageFormulaire
      onRetour={onAnnuler}
      pied={
        <>
          <BoutonPrincipal
            titre={compteAModifier ? 'Enregistrer' : 'Créer le compte'}
            testID={compteAModifier ? 'bouton-enregistrer-compte' : 'bouton-creer-compte'}
            onPress={creer}
          />
          {onAnnuler ? <BoutonPrincipal titre="Annuler" variante="discret" onPress={onAnnuler} /> : null}
        </>
      }>
      {mobile ? null : <Titre>{compteAModifier ? 'Modifier le compte' : 'Nouveau compte'}</Titre>}

      {mobile ? (
        <View style={{ gap: ESPACEMENT.xs + 2 }}>
          <Text style={{ color: palette.texte, fontSize: 15, fontWeight: '600' }}>Enveloppe</Text>
          <Segments<TypeCompte> options={TYPES} actif={formulaire.type} onChoisir={type => modifier('type', type)} libelle={type => LIBELLES_TYPE_COMPTE[type]} prefixeTest="type-compte" />
        </View>
      ) : (
      <Carte>
        <SousTitre>Enveloppe</SousTitre>
        <View style={styles.pastilles}>
          {TYPES.map(type => {
            const actif = type === formulaire.type;
            return (
              <Pressable
                key={type}
                testID={`type-compte-${type}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: actif }}
                onPress={() => modifier('type', type)}
                style={[
                  styles.pastille,
                  {
                    backgroundColor: actif ? palette.accentPlein : 'transparent',
                    borderColor: actif ? palette.accent : palette.bordure,
                  },
                ]}>
                <Text style={{ color: actif ? palette.surAccent : palette.texte }}>
                  {LIBELLES_TYPE_COMPTE[type]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Carte>
      )}

      <Champ
        etiquette="Nom"
        value={formulaire.nom}
        onChangeText={texte => modifier('nom', texte)}
        placeholder="PEA BoursoBank"
        nature="texte"
      />
      {erreurs.nom ? <Alerte message={erreurs.nom} /> : null}

      <Champ
        etiquette="Date d'ouverture"
        value={formulaire.dateOuverture}
        onChangeText={texte => modifier('dateOuverture', texte)}
        placeholder="JJ/MM/AAAA"
        keyboardType="numbers-and-punctuation"
        nature="date"
        testID="champ-date-ouverture"
        indication={indicationDate(formulaire.type)}
      />
      {erreurs.dateOuverture ? <Alerte message={erreurs.dateOuverture} /> : null}

      <Champ
        etiquette="Devise"
        value={formulaire.devise}
        onChangeText={texte => modifier('devise', texte)}
        autoCapitalize="characters"
        maxLength={3}
        editable={!deviseFigee}
        indication={deviseFigee ? 'Le compte a déjà des opérations : sa devise ne peut plus changer.' : undefined}
      />
      {erreurs.devise ? <Alerte message={erreurs.devise} /> : null}

      {mobile ? null : (
        <Actions>
          <Bouton
            titre={compteAModifier ? 'Enregistrer' : 'Créer le compte'}
            testID={compteAModifier ? 'bouton-enregistrer-compte' : 'bouton-creer-compte'}
            onPress={creer}
          />
          {onAnnuler ? <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} /> : null}
        </Actions>
      )}

      {compteAModifier && onSupprimer ? (
        <Carte>
          <Text style={{ color: palette.danger, fontWeight: '700', fontSize: 16 }}>Supprimer ce compte</Text>
          <SousTitre>
            {nombreOperations > 0
              ? `Le compte et ses ${nombreOperations} opération${nombreOperations > 1 ? 's' : ''} seront effacés. C’est définitif : seule une sauvegarde permettrait de les retrouver.`
              : 'Le compte est vide : rien d’autre ne sera effacé.'}
          </SousTitre>
          {mobile ? (
            <>
              <BoutonPrincipal variante="danger" titre="Supprimer le compte…" testID="bouton-supprimer-compte" onPress={() => setConfirmation(true)} />
              <FeuilleBasse
                theme={themeActif()}
                visible={confirmation}
                titre="Supprimer ce compte ?"
                description={`« ${compteAModifier.nom} »${nombreOperations > 0 ? ` et ses ${nombreOperations} opération(s)` : ''} seront effacés. C’est définitif.`}
                onFermer={() => setConfirmation(false)}
                pied={
                  <>
                    <BoutonPrincipal variante="danger" titre="Oui, supprimer" testID="bouton-confirmer-suppression-compte" onPress={onSupprimer} />
                    <BoutonPrincipal variante="discret" titre="Non" onPress={() => setConfirmation(false)} />
                  </>
                }
              />
            </>
          ) : confirmation ? (
            <View style={{ gap: ESPACEMENT.s }}>
              <Alerte message={`Supprimer « ${compteAModifier.nom} »${nombreOperations > 0 ? ` et ses ${nombreOperations} opération(s)` : ''} ?`} />
              <View style={styles.pastilles}>
                <Bouton titre="Oui, supprimer" testID="bouton-confirmer-suppression-compte" onPress={onSupprimer} />
                <Bouton titre="Non" variante="discret" onPress={() => setConfirmation(false)} />
              </View>
            </View>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton
                titre="Supprimer le compte…"
                variante="discret"
                testID="bouton-supprimer-compte"
                onPress={() => setConfirmation(true)}
              />
            </View>
          )}
        </Carte>
      ) : null}
    </PageFormulaire>
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

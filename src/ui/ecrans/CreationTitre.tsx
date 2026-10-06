/**
 * Création d'une valeur.
 *
 * L'ISIN est vérifié clé de contrôle comprise, et le message le dit quand elle
 * ne tombe pas juste : sur douze caractères recopiés, c'est le contrôle qui
 * attrape la faute de frappe avant qu'elle ne crée un doublon silencieux.
 */

import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { Text } from '../mobile/adaptatif';
import type { Titre as TitreDomaine } from '../../core/domain/types';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, stylesPartages } from '../theme';
import { BoutonPrincipal } from '../mobile/BoutonPrincipal';
import { themeActif } from '../mobile/jetons';
import { Cellule, GroupeCellules } from '../mobile/ListeCellules';
import { PageFormulaire } from '../mobile/PageFormulaire';
import { useMobile } from '../mobile/useMobile';
import {
  FORMULAIRE_TITRE_VIDE,
  paysDeLIsin,
  validerTitre,
  type ErreursTitre,
  type FormulaireTitre,
} from '../vues/titre';

export interface CreationTitreProps {
  titresExistants: readonly TitreDomaine[];
  onCreer(titre: TitreDomaine): void;
  onAnnuler(): void;
  genererId?(): string;
}

export function CreationTitre({
  titresExistants,
  onCreer,
  onAnnuler,
  genererId,
}: CreationTitreProps) {
  const palette = usePalette();
  const mobile = useMobile();
  const [formulaire, setFormulaire] = useState<FormulaireTitre>(FORMULAIRE_TITRE_VIDE);
  const [erreurs, setErreurs] = useState<ErreursTitre>({});

  const modifier = <C extends keyof FormulaireTitre>(
    champ: C,
    valeur: FormulaireTitre[C],
  ) => {
    setFormulaire(precedent => ({ ...precedent, [champ]: valeur }));
    setErreurs(precedent => ({ ...precedent, [champ]: undefined }));
  };

  const creer = () => {
    const resultat = validerTitre(
      formulaire,
      titresExistants,
      genererId ?? (() => `titre-${Date.now()}`),
    );
    setErreurs(resultat.erreurs);
    if (resultat.titre) {
      onCreer(resultat.titre);
    }
  };

  const pays = paysDeLIsin(formulaire.isin);

  return (
    <PageFormulaire
      onRetour={onAnnuler}
      pied={
        <>
          <BoutonPrincipal titre="Créer la valeur" testID="bouton-creer-titre" onPress={creer} />
          <BoutonPrincipal titre="Annuler" variante="discret" onPress={onAnnuler} />
        </>
      }>
      {mobile ? null : <Titre>Nouvelle valeur</Titre>}

      <Champ
        etiquette="Nom"
        value={formulaire.nom}
        onChangeText={texte => modifier('nom', texte)}
        placeholder="Stellantis"
        nature="texte"
      />
      {erreurs.nom ? <Alerte message={erreurs.nom} /> : null}

      <Champ
        etiquette="ISIN"
        value={formulaire.isin}
        onChangeText={texte => modifier('isin', texte)}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
        placeholder="NL00150001Q9"
        nature="codeLiaison"
        spellCheck={false}
        indication={pays ? `Pays d'émission : ${pays}` : '12 caractères.'}
      />
      {erreurs.isin ? <Alerte message={erreurs.isin} /> : null}

      <Champ
        etiquette="Ticker"
        value={formulaire.ticker}
        onChangeText={texte => modifier('ticker', texte)}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        placeholder="Facultatif"
      />

      <Champ
        etiquette="Devise de cotation"
        value={formulaire.deviseCotation}
        onChangeText={texte => modifier('deviseCotation', texte)}
        autoCapitalize="characters"
        maxLength={3}
      />
      {erreurs.deviseCotation ? <Alerte message={erreurs.deviseCotation} /> : null}

      <Champ
        etiquette="Secteur"
        value={formulaire.secteur}
        onChangeText={texte => modifier('secteur', texte)}
        placeholder="Facultatif"
      />

      <Champ
        etiquette="Zone géographique"
        value={formulaire.zoneGeographique}
        onChangeText={texte => modifier('zoneGeographique', texte)}
        placeholder="Facultatif"
      />

      {mobile ? (
        <GroupeCellules
          theme={themeActif()}
          note="Une valeur non éligible logée dans un PEA expose à la clôture du plan.">
          <Cellule
            theme={themeActif()}
            titre="Éligible au PEA"
            interrupteur={{ valeur: formulaire.eligiblePEA, onChanger: valeur => modifier('eligiblePEA', valeur) }}
          />
        </GroupeCellules>
      ) : (
      <Carte>
        <View style={[stylesPartages.ligne, { gap: ESPACEMENT.m }]}>
          <Text style={{ color: palette.texte, flex: 1 }}>Éligible au PEA</Text>
          <Switch
            value={formulaire.eligiblePEA}
            onValueChange={valeur => modifier('eligiblePEA', valeur)}
            accessibilityLabel="Éligible au PEA"
          />
        </View>
        <SousTitre>
          Une valeur non éligible logée dans un PEA expose à la clôture du plan.
        </SousTitre>
      </Carte>
      )}

      {mobile ? null : (
        <Actions>
          <Bouton titre="Créer la valeur" testID="bouton-creer-titre" onPress={creer} />
          <Bouton titre="Annuler" variante="discret" onPress={onAnnuler} />
        </Actions>
      )}
    </PageFormulaire>
  );
}

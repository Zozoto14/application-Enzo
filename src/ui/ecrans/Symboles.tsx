/**
 * Attribution des symboles de cotation.
 *
 * Un export de courtier donne un ISIN et un libellé, jamais un symbole. Sans
 * cet écran, le rafraîchissement des cours ne trouve rien à interroger.
 *
 * Le parti pris tient en une phrase : **l'application propose, elle ne choisit
 * pas**. Un ISIN peut renvoyer trois places de cotation pour la même société,
 * et en retenir une au hasard valoriserait le portefeuille sur un marché qui
 * n'est pas le sien — sans que rien ne le signale.
 */

import React, { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import type { CandidatSymbole } from '../../cours/symboles';
// `Titre` designe ici le composant d'interface : la valeur du domaine est
// importee sous un autre nom pour que la collision saute aux yeux.
import type { Titre as ValeurDomaine } from '../../core/domain/types';
import { erreurLien, liensDe } from '../vues/liens';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';

export interface TitreASymbole {
  titreId: string;
  nom: string;
  isin: string;
  /** Symbole actuellement enregistré, vide s'il n'y en a pas. */
  symbole: string;
  /** Vrai si la valeur est détenue : c'est elle qui bloque le rafraîchissement. */
  detenue: boolean;
  /** Adresse de la fiche externe, collée par l'utilisateur. */
  lien: string;
}

export interface SymbolesProps {
  titres: readonly TitreASymbole[];
  /** Candidats de la dernière recherche, pour le titre en cours. */
  recherche?: {
    titreId: string;
    candidats: readonly CandidatSymbole[];
    avertissement?: string;
    enCours?: boolean;
  };
  onChercher(titreId: string, requete: string): void;
  onRetenir(titreId: string, symbole: string): void;
  onEffacer(titreId: string): void;
  onChangerLien(titreId: string, lien: string): void;
  /** Ouvre une adresse. Injectable pour les tests. */
  onOuvrir?(url: string): void;
  onRetour(): void;
  erreur?: string;
}

export function Symboles({
  titres,
  recherche,
  onChercher,
  onRetenir,
  onEffacer,
  onChangerLien,
  onOuvrir,
  onRetour,
  erreur,
}: SymbolesProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const ouvrir = onOuvrir ?? ((url: string) => void Linking.openURL(url));

  const sansSymbole = titres.filter(titre => titre.detenue && titre.symbole === '');

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.formulaire, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      <Titre>Symboles</Titre>
      <SousTitre>
        Le symbole dit à quel marché demander le cours. Votre courtier ne le
        fournit pas dans l’export : il faut le désigner une fois par valeur.
      </SousTitre>

      {sansSymbole.length > 0 ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            {sansSymbole.length} valeur(s) détenue(s) sans symbole
          </Text>
          <SousTitre>
            Leurs cours ne peuvent pas être rafraîchis tant qu’elles n’en ont
            pas. Elles restent valorisées au dernier cours connu.
          </SousTitre>
        </Carte>
      ) : null}

      {erreur ? <Alerte message={erreur} /> : null}

      {titres.map(titre => {
        const actif = recherche?.titreId === titre.titreId;
        const saisie = saisies[titre.titreId] ?? titre.isin;

        return (
          <Carte key={titre.titreId}>
            <View style={stylesPartages.ligne}>
              <Text style={styles.nom} numberOfLines={1}>
                <Text style={{ color: palette.texte }}>{titre.nom}</Text>
              </Text>
              {titre.symbole ? (
                <Text style={{ color: palette.accent, fontWeight: '700' }}>
                  {titre.symbole}
                </Text>
              ) : (
                <Text style={{ color: palette.texteSecondaire }}>aucun</Text>
              )}
            </View>
            <SousTitre>
              {titre.isin}
              {titre.detenue ? ' · détenue' : ''}
            </SousTitre>

            <Champ
              etiquette="Chercher par ISIN, nom ou ticker"
              testID={`recherche-${titre.titreId}`}
              value={saisie}
              onChangeText={valeur =>
                setSaisies(precedent => ({ ...precedent, [titre.titreId]: valeur }))
              }
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <View style={styles.actions}>
              <Bouton
                titre={actif && recherche?.enCours ? 'Recherche…' : 'Chercher'}
                testID={`chercher-${titre.titreId}`}
                variante="discret"
                desactive={recherche?.enCours}
                onPress={() => onChercher(titre.titreId, saisie)}
              />
              {titre.symbole ? (
                <Bouton
                  titre="Retirer"
                  testID={`effacer-${titre.titreId}`}
                  variante="discret"
                  onPress={() => onEffacer(titre.titreId)}
                />
              ) : null}
            </View>


            <Liens
              titre={titre}
              onChangerLien={onChangerLien}
              onOuvrir={ouvrir}
            />
            {actif && recherche ? (
              <>
                {recherche.avertissement ? (
                  <SousTitre>{recherche.avertissement}</SousTitre>
                ) : null}

                {recherche.candidats.map(candidat => (
                  <Pressable
                    key={candidat.symbole}
                    testID={`retenir-${candidat.symbole}`}
                    accessibilityRole="button"
                    onPress={() => onRetenir(titre.titreId, candidat.symbole)}
                    style={[styles.candidat, { borderColor: palette.bordure }]}>
                    <View style={stylesPartages.ligne}>
                      <Text style={{ color: palette.texte, fontWeight: '600' }}>
                        {candidat.symbole}
                      </Text>
                      {candidat.paris ? (
                        <View style={[styles.pastille, { borderColor: palette.accent }]}>
                          <Text style={{ fontSize: 11, color: palette.accent }}>
                            Euronext Paris
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <SousTitre>
                      {candidat.nom} · {candidat.place}
                      {candidat.type ? ` · ${candidat.type}` : ''}
                    </SousTitre>
                  </Pressable>
                ))}
              </>
            ) : null}
          </Carte>
        );
      })}

      {titres.length === 0 ? (
        <Carte>
          <Text style={{ color: palette.texte }}>Aucune valeur enregistrée.</Text>
          <SousTitre>
            Importez vos positions ou créez une valeur : les symboles se
            règlent ensuite.
          </SousTitre>
        </Carte>
      ) : null}

      <Actions>
        <Bouton titre="Retour" variante="discret" onPress={onRetour} />
      </Actions>
    </ScrollView>
  );
}


/**
 * Liens vers les fiches externes.
 *
 * L'application ne dira jamais si une action est chere, ce que pensent les
 * analystes, ni comment se porte le bilan : ces donnees demandent des flux
 * payants qu'elle n'a pas. Plutot que de faire semblant, elle renvoie la ou
 * l'information existe.
 */
function Liens({
  titre,
  onChangerLien,
  onOuvrir,
}: {
  titre: TitreASymbole;
  onChangerLien(titreId: string, lien: string): void;
  onOuvrir(url: string): void;
}) {
  const [saisie, setSaisie] = useState(titre.lien);
  const erreur = erreurLien(saisie);

  // `liensDe` travaille sur un titre du domaine : on lui donne le minimum
  // dont il a besoin, sans faire remonter le titre entier jusqu'ici.
  const valeur = {
    id: titre.titreId,
    isin: titre.isin,
    nom: titre.nom,
    ticker: titre.symbole,
    deviseCotation: 'EUR',
    eligiblePEA: true,
    lienExterne: titre.lien,
  } as ValeurDomaine;

  return (
    <View style={styles.liens}>
      <SousTitre>Pour en savoir plus sur cette valeur</SousTitre>

      <View style={styles.actions}>
        {liensDe(valeur).map(lien => (
          <Bouton
            key={lien.cle}
            titre={lien.direct ? lien.libelle : `${lien.libelle}…`}
            testID={`lien-${lien.cle}-${titre.titreId}`}
            variante="discret"
            onPress={() => onOuvrir(lien.url)}
          />
        ))}
      </View>

      <Champ
        etiquette="Adresse de la fiche Baggr"
        testID={`fiche-${titre.titreId}`}
        value={saisie}
        onChangeText={valeurSaisie => {
          setSaisie(valeurSaisie);
          if (!erreurLien(valeurSaisie)) {
            onChangerLien(titre.titreId, valeurSaisie.trim());
          }
        }}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://app.baggr.fr/screener/…"
      />
      {erreur ? <Alerte message={erreur} /> : null}
      <SousTitre>
        Une fiche Baggr porte un identifiant qui ne se devine pas : collez son
        adresse une fois, et le bouton y mènera directement.
      </SousTitre>
    </View>
  );
}

const styles = StyleSheet.create({
  nom: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: ESPACEMENT.s },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  liens: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingTop: ESPACEMENT.s,
    gap: ESPACEMENT.s,
  },
  candidat: {
    borderWidth: 1,
    borderRadius: RAYON.s,
    padding: ESPACEMENT.s,
    gap: 2,
  },
  pastille: {
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.s,
    paddingVertical: 2,
  },
});

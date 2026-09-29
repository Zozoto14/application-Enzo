/**
 * Réglages : fournisseur de cours et clé d'API.
 *
 * La clé est stockée dans la base chiffrée, donc illisible sans
 * déverrouillage. Le champ est masqué à la saisie et n'affiche jamais la clé
 * enregistrée en clair : on peut la remplacer, pas la relire.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Actions, Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { CLES_THEMES, ESPACEMENT, RAYON, THEMES, palettePour, stylesPartages, type CleTheme } from '../theme';
import { Segments } from '../elements';
import { INTERVALLES_ACTUALISATION, INTERVALLE_PAR_DEFAUT_S, libelleIntervalle } from '../../cours/marche';
import type { FournisseurCours } from '../../cours/fournisseur';

export type EtatVerificationMaj =
  | { etat: 'a-jour'; commit?: string }
  | { etat: 'disponible'; commit?: string; nouveautes: string[]; echecPrecedent?: string }
  | { etat: 'erreur'; motif: string };

/** Réponse de « Installer et redémarrer » : un échec est affiché tel quel. */
export interface ResultatRedemarrage {
  ok: boolean;
  motif?: string;
}

export interface ReglagesProps {
  fournisseurs: readonly FournisseurCours[];
  fournisseurActuel?: string;
  /** Vrai si une clé est déjà enregistrée. Sa valeur n'est jamais transmise. */
  cleEnregistree: boolean;
  onEnregistrer(fournisseurId: string, cle?: string): void;
  /** Ouvre l'attribution des symboles de cotation. */
  onSymboles?(): void;
  /** Nombre de valeurs détenues sans symbole, qui bloquent le rafraîchissement. */
  sansSymbole?: number;
  /** Charge l'historique des cours des valeurs qui ont un symbole. */
  onChargerHistorique?(): void;
  /** Nombre de valeurs prêtes à être chargées. */
  avecSymbole?: number;
  chargementEnCours?: boolean;
  messageHistorique?: string;
  /** Secondes entre deux actualisations des cours ; 0 : jamais. */
  intervalleActualisation?: number;
  onChoisirIntervalle?(secondes: number): void;
  /** Thème actif et changement de thème. */
  theme?: CleTheme;
  onChoisirTheme?(theme: CleTheme): void;
  /** Remplace les codes de récupération et rend les nouveaux, à noter. */
  onRenouvelerCodes?(): string[];
  /** Relance la visite guidée des nouveautés. */
  onRevoirVisite?(): void;
  /** Interroge GitHub maintenant (bureau). */
  onChercherMiseAJour?(): Promise<EtatVerificationMaj>;
  /** Récupère la mise à jour puis redémarre l'application. */
  onRedemarrerPourMaj?(): Promise<ResultatRedemarrage>;
  /** Exporte le portefeuille dans un fichier Excel. */
  onExporterExcel?(): void;
  messageExport?: string;
  /** Carte de synchronisation entre appareils, composée par l'application. */
  carteSynchro?: React.ReactNode;
  /** Carte des profils (administrateur : ajouter un ami). */
  carteProfils?: React.ReactNode;
  onAnnuler(): void;
}

export function Reglages({
  fournisseurs,
  fournisseurActuel,
  cleEnregistree,
  onSymboles,
  sansSymbole,
  onChargerHistorique,
  avecSymbole,
  chargementEnCours,
  messageHistorique,
  intervalleActualisation,
  onChoisirIntervalle,
  theme,
  onChoisirTheme,
  onRenouvelerCodes,
  onRevoirVisite,
  onExporterExcel,
  messageExport,
  onChercherMiseAJour,
  onRedemarrerPourMaj,
  carteSynchro,
  carteProfils,
  onEnregistrer,
  onAnnuler,
}: ReglagesProps) {
  const sombre = useColorScheme() === 'dark';
  const palette = usePalette();
  const [choisi, setChoisi] = useState(fournisseurActuel ?? fournisseurs[0]?.id ?? '');
  const [cle, setCle] = useState('');
  const [confirmerCodes, setConfirmerCodes] = useState(false);
  const [nouveauxCodes, setNouveauxCodes] = useState<string[] | undefined>();

  const fournisseur = fournisseurs.find(candidat => candidat.id === choisi);
  const cleManquante = Boolean(fournisseur?.cleRequise) && !cleEnregistree && cle === '';

  return (
    <ScrollView
      style={[stylesPartages.ecran, { backgroundColor: palettePour(sombre).fond }]}
      contentContainerStyle={[stylesPartages.contenu, stylesPartages.formulaire, { paddingTop: ESPACEMENT.l }]}
      keyboardShouldPersistTaps="handled">
      {onChercherMiseAJour ? (
        <CarteMiseAJour chercher={onChercherMiseAJour} redemarrer={onRedemarrerPourMaj} />
      ) : null}

      {carteSynchro}
      {carteProfils}

      {onChoisirTheme ? (
        <>
          <Titre>Apparence</Titre>
          <View style={styles.themes}>
            {CLES_THEMES.map(cle => {
              const choix = THEMES[cle];
              const actif = cle === theme;
              return (
                <Pressable
                  key={cle}
                  testID={`theme-${cle}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: actif }}
                  accessibilityLabel={`Thème ${choix.nom}`}
                  onPress={() => onChoisirTheme(cle)}
                  style={[
                    styles.theme,
                    {
                      backgroundColor: choix.palette.fond,
                      borderColor: actif ? palette.accent : palette.bordure,
                      borderWidth: actif ? 2 : 1,
                    },
                  ]}>
                  <View style={[styles.apercuTheme, { backgroundColor: choix.palette.surface, borderColor: choix.palette.bordure }]}>
                    <Text style={{ color: choix.palette.texte, fontWeight: '700', fontSize: 15 }}>{choix.nom}</Text>
                    <View style={styles.pastillesTheme}>
                      {choix.palette.series.slice(0, 4).map(couleur => (
                        <View key={couleur} style={[styles.pastilleTheme, { backgroundColor: couleur }]} />
                      ))}
                    </View>
                  </View>
                  <Text style={{ color: choix.palette.texteSecondaire, fontSize: 12 }}>{choix.description}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Titre>Cours automatiques</Titre>

      {onChoisirIntervalle ? (
        <Carte>
          <Text style={{ color: palette.texte, fontSize: 16, fontWeight: '700' }}>Actualisation des cours</Text>
          <SousTitre>
            Tant que la fenêtre est ouverte, les cours de vos valeurs sont relus à ce rythme,
            pendant les séances de Paris et de New York.
          </SousTitre>
          <Segments<string>
            options={INTERVALLES_ACTUALISATION.map(String)}
            actif={String(intervalleActualisation ?? INTERVALLE_PAR_DEFAUT_S)}
            libelle={valeur => libelleIntervalle(Number(valeur))}
            onChoisir={valeur => onChoisirIntervalle(Number(valeur))}
            prefixeTest="intervalle"
          />
        </Carte>
      ) : null}
      <SousTitre>
        Choisissez un fournisseur de cotations et renseignez sa clé d'API.
      </SousTitre>

      <Carte>
        <SousTitre>Fournisseur</SousTitre>
        <View style={styles.pastilles}>
          {fournisseurs.map(candidat => {
            const actif = candidat.id === choisi;
            return (
              <Pressable
                key={candidat.id}
                testID={`fournisseur-${candidat.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: actif }}
                onPress={() => setChoisi(candidat.id)}
                style={[
                  styles.pastille,
                  {
                    backgroundColor: actif ? palette.accentPlein : 'transparent',
                    borderColor: actif ? palette.accent : palette.bordure,
                  },
                ]}>
                <Text style={{ color: actif ? palette.surAccent : palette.texte }}>
                  {candidat.libelle}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Carte>

      {fournisseur?.provisoire ? (
        <Alerte
          message={
            "Ce fournisseur n'a jamais été confronté à une vraie réponse : son " +
            'mapping est une hypothèse. Comparez le premier cours obtenu à ' +
            "celui de votre courtier avant de vous y fier."
          }
        />
      ) : null}

      <Champ
        etiquette="Clé d'API"
        value={cle}
        onChangeText={setCle}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={cleEnregistree ? 'Clé enregistrée — saisir pour remplacer' : ''}
        indication="Conservée dans la base chiffrée, illisible sans déverrouillage."
      />

      {cleManquante ? (
        <Alerte message="Ce fournisseur exige une clé d'API." />
      ) : null}

      {onSymboles ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            Symboles de cotation
          </Text>
          <SousTitre>
            {sansSymbole
              ? `${sansSymbole} valeur(s) détenue(s) n’ont pas de symbole : leurs cours ne peuvent pas être rafraîchis.`
              : 'Le symbole dit à quel marché demander le cours. Une même société cote parfois sur plusieurs places, à des cours différents.'}
          </SousTitre>
          <Bouton
            titre="Régler les symboles"
            testID="bouton-symboles"
            variante="discret"
            onPress={onSymboles}
          />
        </Carte>
      ) : null}

      {onChargerHistorique ? (
        <Carte>
          <Text style={{ color: palette.texte, fontWeight: '600' }}>
            Historique des cours
          </Text>
          <SousTitre>
            Sans historique, les onglets Performances et Risque restent muets
            plusieurs mois : il faut trente relevés pour une corrélation et
            quatre-vingt-dix jours pour annualiser un rendement. Ce chargement
            reprend deux ans d’un coup.
          </SousTitre>
          <SousTitre>
            Les cours retenus sont les clôtures brutes, pas les clôtures
            ajustées : vos dividendes sont déjà saisis comme opérations, et les
            compter deux fois gonflerait la performance.
          </SousTitre>
          <Bouton
            titre={chargementEnCours ? 'Chargement…' : 'Charger deux ans d’historique'}
            testID="bouton-charger-historique"
            variante="discret"
            desactive={chargementEnCours || avecSymbole === 0}
            onPress={onChargerHistorique}
          />
          {avecSymbole === 0 ? (
            <SousTitre>
              Aucune valeur n’a de symbole : réglez-les d’abord.
            </SousTitre>
          ) : null}
          {messageHistorique ? (
            <Text accessibilityLiveRegion="polite" style={{ color: palette.texte }}>
              {messageHistorique}
            </Text>
          ) : null}
        </Carte>
      ) : null}

      {onExporterExcel ? (
        <>
          <Titre>Exporter</Titre>
          <Carte>
            <SousTitre>
              Tout votre portefeuille dans un fichier Excel : positions, opérations, dividendes et comptes, une
              feuille chacun, avec des nombres qu’on peut trier et additionner.
            </SousTitre>
            <View style={{ alignSelf: 'flex-start' }}>
              <Bouton titre="Exporter vers Excel (.xlsx)" onPress={onExporterExcel} testID="bouton-export-excel" />
            </View>
            {messageExport ? <Text style={{ color: palette.texte }} testID="message-export">{messageExport}</Text> : null}
          </Carte>
        </>
      ) : null}

      {onRenouvelerCodes ? (
        <>
          <Titre>Codes de récupération</Titre>
          <Carte>
            <SousTitre>
              Ils servent si vous oubliez votre mot de passe : à l’écran de déverrouillage, « Mot de passe
              oublié ». Chacun ne sert qu’une fois. Générez-en de nouveaux si vous les avez perdus ou presque
              tous utilisés : les anciens cesseront de fonctionner.
            </SousTitre>
            {nouveauxCodes ? (
              <View style={{ gap: ESPACEMENT.s }} testID="nouveaux-codes">
                <Alerte message="Notez-les maintenant, sur papier ou dans votre gestionnaire de mots de passe : ils ne seront plus jamais affichés." />
                {nouveauxCodes.map(code => (
                  <Text key={code} selectable style={[styles.code, { color: palette.texte, borderColor: palette.bordure }]}>
                    {code}
                  </Text>
                ))}
                <View style={{ alignSelf: 'flex-start' }}>
                  <Bouton titre="C’est noté" variante="discret" onPress={() => setNouveauxCodes(undefined)} />
                </View>
              </View>
            ) : confirmerCodes ? (
              <View style={{ gap: ESPACEMENT.s }}>
                <Text style={{ color: palette.danger }}>Les codes actuels ne marcheront plus. Continuer ?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s }}>
                  <Bouton
                    titre="Générer de nouveaux codes"
                    testID="bouton-confirmer-codes"
                    onPress={() => {
                      setNouveauxCodes(onRenouvelerCodes());
                      setConfirmerCodes(false);
                    }}
                  />
                  <Bouton titre="Annuler" variante="discret" onPress={() => setConfirmerCodes(false)} />
                </View>
              </View>
            ) : (
              <View style={{ alignSelf: 'flex-start' }}>
                <Bouton
                  titre="Générer de nouveaux codes…"
                  variante="discret"
                  testID="bouton-renouveler-codes"
                  onPress={() => setConfirmerCodes(true)}
                />
              </View>
            )}
          </Carte>
        </>
      ) : null}

      {onRevoirVisite ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton titre="Revoir la visite des nouveautés" variante="discret" onPress={onRevoirVisite} testID="revoir-visite" />
        </View>
      ) : null}

      <Actions>
        <Bouton
          titre="Enregistrer"
          testID="bouton-enregistrer-reglages"
          desactive={cleManquante || choisi === ''}
          onPress={() => onEnregistrer(choisi, cle || undefined)}
        />
        <Bouton titre="Retour" variante="discret" onPress={onAnnuler} />
      </Actions>
    </ScrollView>
  );
}

/** Vérifier les mises à jour sans relancer l'application. */
function CarteMiseAJour({
  chercher,
  redemarrer,
}: {
  chercher(): Promise<EtatVerificationMaj>;
  redemarrer?(): Promise<ResultatRedemarrage>;
}) {
  const palette = usePalette();
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<EtatVerificationMaj | undefined>();
  const [redemarrage, setRedemarrage] = useState(false);
  const [echec, setEchec] = useState<string | undefined>();
  const verifier = () => {
    setEnCours(true);
    chercher()
      .then(setResultat)
      .catch((e: unknown) => setResultat({ etat: 'erreur', motif: e instanceof Error ? e.message : String(e) }))
      .finally(() => setEnCours(false));
  };
  return (
    <>
      <Titre>Mises à jour</Titre>
      <Carte>
        <SousTitre>
          L’application se met à jour à chaque lancement. Ce bouton regarde tout de suite si une nouvelle version
          est disponible, sans avoir à la fermer.
        </SousTitre>
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton
            titre={enCours ? 'Vérification…' : 'Vérifier les mises à jour'}
            desactive={enCours || redemarrage}
            onPress={verifier}
            testID="bouton-verifier-maj"
          />
        </View>
        {resultat?.etat === 'a-jour' ? (
          <Text style={{ color: palette.hausse, fontWeight: '600' }} testID="maj-a-jour">
            ✅ Vous avez la dernière version{resultat.commit ? ` (${resultat.commit})` : ''}.
          </Text>
        ) : null}
        {resultat?.etat === 'erreur' ? (
          <Alerte message={`Vérification impossible : ${resultat.motif}`} />
        ) : null}
        {resultat?.etat === 'disponible' ? (
          <View style={{ gap: ESPACEMENT.s }} testID="maj-disponible">
            <Text style={{ color: palette.accent, fontWeight: '700' }}>
              🆕 Nouvelle version disponible : {resultat.nouveautes.length} nouveauté{resultat.nouveautes.length > 1 ? 's' : ''}
            </Text>
            {resultat.echecPrecedent ? (
              <Alerte message={`La mise à jour automatique au lancement a échoué : ${resultat.echecPrecedent}`} />
            ) : null}
            {resultat.nouveautes.slice(0, 8).map(titre => (
              <Text key={titre} style={{ color: palette.texte }}>
                • {titre}
              </Text>
            ))}
            {resultat.nouveautes.length > 8 ? (
              <SousTitre>…et {resultat.nouveautes.length - 8} autre(s).</SousTitre>
            ) : null}
            {redemarrer ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Bouton
                  titre={redemarrage ? 'Redémarrage…' : 'Installer et redémarrer'}
                  desactive={redemarrage}
                  onPress={() => {
                    setRedemarrage(true);
                    setEchec(undefined);
                    redemarrer()
                      .then(resultat => {
                        if (!resultat.ok) {
                          setRedemarrage(false);
                          setEchec(resultat.motif ?? 'La mise à jour n’a pas pu être récupérée.');
                        }
                      })
                      .catch((e: unknown) => {
                        setRedemarrage(false);
                        setEchec(e instanceof Error ? e.message : String(e));
                      });
                  }}
                  testID="bouton-redemarrer-maj"
                />
              </View>
            ) : null}
            {echec ? <Alerte message={`Mise à jour impossible : ${echec}`} /> : null}
            <SousTitre>
              L’application se ferme et se rouvre à jour ; la première ouverture prend une ou deux minutes. Vos
              données ne sont pas touchées.
            </SousTitre>
          </View>
        ) : null}
      </Carte>
    </>
  );
}

const styles = StyleSheet.create({
  code: {
    fontFamily: 'monospace',
    fontSize: 17,
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s,
    alignSelf: 'flex-start',
  },
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  theme: { flexGrow: 1, flexBasis: 200, borderRadius: RAYON.m, padding: ESPACEMENT.m - 4, gap: ESPACEMENT.s },
  apercuTheme: { borderRadius: RAYON.s, borderWidth: 1, padding: ESPACEMENT.m - 4, gap: ESPACEMENT.s },
  pastillesTheme: { flexDirection: 'row', gap: 6 },
  pastilleTheme: { width: 22, height: 10, borderRadius: 5 },
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  pastille: {
    borderRadius: RAYON.l,
    borderWidth: 1,
    paddingVertical: ESPACEMENT.xs + 2,
    paddingHorizontal: ESPACEMENT.m - 4,
  },
});

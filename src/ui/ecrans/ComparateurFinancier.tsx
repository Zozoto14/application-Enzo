/**
 * Comparateur : les comptes de plusieurs sociétés côte à côte.
 *
 * Jusqu'à cinq sociétés et dix postes cochés ; chaque couple devient une
 * courbe. Le tableau montre les comptes de la société active, avec la
 * variation d'un exercice à l'autre. Le second onglet reprend la
 * comparaison des cours des valeurs détenues.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePalette } from '../composants';
import { CarteSection, Segments, Selecteur, Vide } from '../elements';
import { GraphiqueLignes } from '../graphiques/Graphiques';
import { Cellule, Tableau, type Colonne } from '../tableau';
import { ESPACEMENT, RAYON, palettePour, stylesPartages } from '../theme';
import type { CandidatSymbole } from '../../cours/symboles';
import type { LigneFinance } from '../vues/fiche';
import {
  POSTES_MAXIMUM,
  SOCIETES_MAXIMUM,
  etatsDe,
  formaterCellule,
  seriesComparees,
  type SocieteComparee,
  type Unite,
} from '../vues/comparaisonFinanciere';

type Onglet = 'comptes' | 'cours';

export interface ComparateurFinancierProps {
  societes: readonly SocieteComparee[];
  /** Valeurs détenues ou surveillées qui ont un symbole : ajout en un clic. */
  suggestions: readonly { symbole: string; nom: string }[];
  onAjouter(symbole: string): void;
  onRetirer(symbole: string): void;
  onRechercher(texte: string): Promise<readonly CandidatSymbole[]>;
  onRetour(): void;
  /** Comparaison des cours des valeurs détenues. */
  comparaisonCours: React.ReactNode;
}

const compact = (valeur: number) => {
  const absolu = Math.abs(valeur);
  const format = (v: number, d: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
  if (absolu >= 1e9) return `${format(valeur / 1e9, 1)} Md`;
  if (absolu >= 1e6) return `${format(valeur / 1e6, 1)} M`;
  return format(valeur, 2);
};

export function ComparateurFinancier(props: ComparateurFinancierProps) {
  const palette = usePalette();
  const [onglet, setOnglet] = useState<Onglet>('comptes');

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <View style={styles.entete}>
        <Pressable accessibilityRole="button" onPress={props.onRetour} style={styles.retour}>
          <Text style={{ color: palette.accent, fontWeight: '700' }}>← Portefeuille</Text>
        </Pressable>
        <View style={styles.ligneTitre}>
          <Text style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
            Comparateur
          </Text>
        </View>
        <Text style={{ color: palette.texteSecondaire }}>
          Comparez jusqu’à {POSTES_MAXIMUM} postes des comptes de {SOCIETES_MAXIMUM} sociétés.
        </Text>
        <View style={[styles.onglets, { borderBottomColor: palette.bordure }]}>
          {(
            [
              { cle: 'comptes', libelle: 'États financiers' },
              { cle: 'cours', libelle: 'Cours de vos valeurs' },
            ] as const
          ).map(element => {
            const actif = element.cle === onglet;
            return (
              <Pressable
                key={element.cle}
                testID={`comparateur-onglet-${element.cle}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: actif }}
                onPress={() => setOnglet(element.cle)}
                style={[styles.onglet, actif && { borderBottomColor: palette.accent }]}>
                <Text style={{ color: actif ? palette.accent : palette.texte, fontWeight: actif ? '700' : '600' }}>
                  {element.libelle}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {onglet === 'cours' ? (
        <View style={{ flex: 1 }}>{props.comparaisonCours}</View>
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          <Comptes {...props} />
        </ScrollView>
      )}
    </View>
  );
}

function Comptes(props: ComparateurFinancierProps) {
  const palette = usePalette();
  const [actif, setActif] = useState<string | undefined>();
  const [titreEtat, setTitreEtat] = useState('Compte de résultat');
  const [unite, setUnite] = useState<Unite>('M');
  const [decimales, setDecimales] = useState(0);
  const [postes, setPostes] = useState<string[]>(['Chiffre d’affaires']);
  const [base100, setBase100] = useState(false);

  // Par défaut, la première société qui a vraiment des comptes : un ETF n'en a pas.
  const societeActive =
    props.societes.find(societe => societe.symbole === actif) ??
    props.societes.find(aDesComptes) ??
    props.societes[0];
  const etats = etatsDe(societeActive);
  const etat = etats?.etats.find(element => element.titre === titreEtat) ?? etats?.etats[0];
  const series = useMemo(
    () => seriesComparees(props.societes, etat?.titre ?? titreEtat, postes, base100),
    [props.societes, etat?.titre, titreEtat, postes, base100],
  );

  const basculerPoste = (libelle: string) =>
    setPostes(precedents =>
      precedents.includes(libelle)
        ? precedents.filter(p => p !== libelle)
        : precedents.length >= POSTES_MAXIMUM
          ? precedents
          : [...precedents, libelle],
    );

  const colonnes: Colonne<LigneFinance>[] = [
    {
      cle: 'poste',
      titre: etat?.titre ?? '',
      largeur: 270,
      rendu: ligne => {
        const coche = postes.includes(ligne.libelle);
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: coche }}
            onPress={() => basculerPoste(ligne.libelle)}
            style={styles.poste}>
            <View
              style={[
                styles.case,
                { borderColor: coche ? palette.accentPlein : palette.texteSecondaire, backgroundColor: coche ? palette.accentPlein : 'transparent' },
              ]}>
              {coche ? <Text style={{ color: palette.surAccent, fontSize: 11, fontWeight: '900' }}>✓</Text> : null}
            </View>
            <Cellule gras={ligne.important}>{ligne.libelle}</Cellule>
          </Pressable>
        );
      },
    },
    ...(etats?.annees ?? []).map((annee, index) => ({
      cle: annee,
      titre: annee,
      largeur: 92,
      extensible: 1,
      alignement: 'droite' as const,
      rendu: (ligne: LigneFinance) => (
        <View style={{ alignItems: 'flex-end' }}>
          <Cellule gras={ligne.important}>
            {formaterCellule(ligne.brut[index], unite, decimales, ligne.libelle.startsWith('BPA'))}
          </Cellule>
          {ligne.variations[index] ? (
            <Text style={{ color: ligne.variations[index]!.tendance === 'hausse' ? palette.hausse : palette.baisse, fontSize: 10.5 }}>
              {ligne.variations[index]!.texte}
            </Text>
          ) : null}
        </View>
      ),
    })),
  ];

  return (
    <>
      <CarteSection>
        <View style={styles.societes}>
          {props.societes.map((societe, index) => {
            const choisie = societe.symbole === societeActive?.symbole;
            return (
              <View
                key={societe.symbole}
                style={[
                  styles.societe,
                  { borderColor: choisie ? palette.accent : palette.bordure, backgroundColor: choisie ? palette.accentFond : 'transparent' },
                ]}>
                <View style={[styles.pastille, { backgroundColor: palette.series[index % palette.series.length] }]} />
                <Pressable accessibilityRole="button" onPress={() => setActif(societe.symbole)} style={{ flexShrink: 1 }}>
                  <Text style={{ color: choisie ? palette.accent : palette.texte, fontWeight: '700', fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
                    {societe.nom}
                    {societe.chargement ? ' · chargement…' : ''}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${societe.nom}`} onPress={() => props.onRetirer(societe.symbole)} hitSlop={8}>
                  <Text style={{ color: palette.texteSecondaire, fontSize: 15 }}>×</Text>
                </Pressable>
              </View>
            );
          })}
          {props.societes.length < SOCIETES_MAXIMUM ? <Ajout {...props} /> : null}
        </View>
        {props.societes.filter(s => s.erreur).map(s => (
          <Text key={s.symbole} style={{ color: palette.danger, fontSize: 12 }}>
            {s.nom} : {s.erreur}
          </Text>
        ))}
        {props.societes.length === 0 ? (
          <Vide>Ajoutez une société par son nom ou son symbole, ou choisissez parmi vos valeurs ci-dessous.</Vide>
        ) : null}
        {props.suggestions.length > 0 && props.societes.length < SOCIETES_MAXIMUM ? (
          <View style={styles.societes}>
            {props.suggestions
              .filter(suggestion => !props.societes.some(s => s.symbole === suggestion.symbole))
              .map(suggestion => (
                <Pressable
                  key={suggestion.symbole}
                  accessibilityRole="button"
                  onPress={() => props.onAjouter(suggestion.symbole)}
                  style={[styles.suggestion, { borderColor: palette.bordure }]}>
                  <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>+ {suggestion.nom}</Text>
                </Pressable>
              ))}
          </View>
        ) : null}
      </CarteSection>

      {etats && etat ? (
        <>
          <CarteSection
            titre="Graphique"
            actions={<Segments<'Valeurs' | 'Base 100'> options={['Valeurs', 'Base 100']} actif={base100 ? 'Base 100' : 'Valeurs'} onChoisir={valeur => setBase100(valeur === 'Base 100')} />}>
            {series.length > 0 ? (
              <GraphiqueLignes
                series={series.map((serie, index) => ({
                  nom: serie.nom,
                  couleur: palette.series[index % palette.series.length],
                  points: serie.points,
                }))}
                formater={base100 ? valeur => valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : compact}
                hauteur={320}
                etiquettesFinales={series.length <= 4}
                legende={series.map((serie, index) => ({ couleur: palette.series[index % palette.series.length], texte: serie.nom }))}
              />
            ) : (
              <Vide>Cochez des postes dans le tableau pour les tracer.</Vide>
            )}
          </CarteSection>

          <CarteSection>
            <View style={[styles.reglages, { zIndex: 20 }]}>
              <Selecteur
                etiquette="Type de données financières"
                valeur={etat.titre}
                options={etats.etats.map(element => ({ valeur: element.titre, libelle: element.titre }))}
                onChoisir={valeur => {
                  setTitreEtat(valeur);
                  setPostes([]);
                }}
                largeur={230}
              />
              <Selecteur
                etiquette="Unité"
                valeur={unite}
                options={[
                  { valeur: 'M', libelle: 'Millions' },
                  { valeur: 'Md', libelle: 'Milliards' },
                  { valeur: 'auto', libelle: 'Automatique' },
                ]}
                onChoisir={valeur => setUnite(valeur as Unite)}
                largeur={140}
              />
              <Selecteur
                etiquette="Décimales"
                valeur={String(decimales)}
                options={['0', '1', '2'].map(valeur => ({ valeur, libelle: valeur }))}
                onChoisir={valeur => setDecimales(Number(valeur))}
                largeur={100}
              />
              <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
                {postes.length}/{POSTES_MAXIMUM} postes cochés · {societeActive?.nom}
              </Text>
            </View>
            <Tableau colonnes={colonnes} lignes={etat.lignes} cle={ligne => ligne.libelle} />
          </CarteSection>
        </>
      ) : props.societes.some(s => s.chargement) ? (
        <CarteSection>
          <Vide>Chargement des comptes…</Vide>
        </CarteSection>
      ) : societeActive ? (
        <CarteSection testID="comparateur-sans-comptes">
          <Vide>
            {estFonds(societeActive.nom)
              ? `${societeActive.nom} est un fonds (ETF) : il n’a pas de comptes de société — chiffre d’affaires, bénéfices — à comparer. Ajoutez des entreprises, comme Air Liquide ou Stellantis, ou comparez son cours dans l’onglet « Cours de vos valeurs ».`
              : `Yahoo Finance n’a pas renvoyé les comptes de ${societeActive.nom}. Réessayez plus tard, ou retirez-la et ajoutez-la de nouveau.`}
          </Vide>
        </CarteSection>
      ) : null}
    </>
  );
}

/** Une société dont au moins un poste des comptes est connu. */
function aDesComptes(societe: SocieteComparee): boolean {
  return Boolean(societe.comptes && Object.values(societe.comptes).some(points => points && points.length > 0));
}

/** ETF, fonds, tracker : pas de comptes de société. */
function estFonds(nom: string): boolean {
  return /\b(etf|ucits|index|fund|fonds|tracker|sicav|msci|s&p 500|nasdaq|stoxx)\b/i.test(nom);
}

function Ajout({ onRechercher, onAjouter }: ComparateurFinancierProps) {
  const palette = usePalette();
  const [texte, setTexte] = useState('');
  const [resultats, setResultats] = useState<readonly CandidatSymbole[]>([]);
  const [message, setMessage] = useState<string | undefined>();

  const chercher = () => {
    if (!texte.trim()) {
      return;
    }
    setMessage('Recherche…');
    onRechercher(texte)
      .then(candidats => {
        setResultats(candidats);
        setMessage(candidats.length === 0 ? 'Aucune valeur trouvée.' : undefined);
      })
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)));
  };

  return (
    <View style={{ gap: 4, minWidth: 240 }}>
      <TextInput
        accessibilityLabel="Ajouter une société"
        placeholder="+ Ajouter (nom ou symbole)"
        placeholderTextColor={palette.texteSecondaire}
        value={texte}
        onChangeText={setTexte}
        onSubmitEditing={chercher}
        returnKeyType="search"
        style={[styles.champ, { color: palette.texte, borderColor: palette.accent }]}
      />
      {message ? <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{message}</Text> : null}
      {resultats.slice(0, 6).map(candidat => (
        <Pressable
          key={candidat.symbole}
          accessibilityRole="button"
          onPress={() => {
            onAjouter(candidat.symbole);
            setResultats([]);
            setTexte('');
          }}
          style={[styles.resultat, { borderColor: palette.bordure }]}>
          <Text style={{ color: palette.texte, fontSize: 12, flex: 1 }} numberOfLines={1}>
            {candidat.nom}
          </Text>
          <Text style={{ color: palette.accent, fontSize: 12 }}>{candidat.symbole}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  entete: { paddingHorizontal: ESPACEMENT.m + 4, paddingTop: ESPACEMENT.m, gap: ESPACEMENT.s },
  retour: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' },
  ligneTitre: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s },
  titre: { fontSize: 26, fontWeight: '800' },
  onglets: { flexDirection: 'row', gap: ESPACEMENT.l, borderBottomWidth: 1, marginTop: ESPACEMENT.s },
  onglet: { paddingVertical: ESPACEMENT.m - 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  societes: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s, alignItems: 'flex-start' },
  societe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    borderWidth: 1,
    borderRadius: RAYON.s,
    paddingHorizontal: ESPACEMENT.m - 4,
    minHeight: 40,
    maxWidth: 280,
  },
  pastille: { width: 10, height: 10, borderRadius: 5 },
  suggestion: { borderWidth: 1, borderRadius: 16, paddingHorizontal: ESPACEMENT.m - 4, paddingVertical: 6 },
  champ: { borderWidth: 1, borderRadius: 20, paddingHorizontal: ESPACEMENT.m, minHeight: 40, fontSize: 13 },
  resultat: { flexDirection: 'row', gap: ESPACEMENT.s, borderBottomWidth: 1, paddingVertical: 6 },
  reglages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m },
  poste: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s, minHeight: 36 },
  case: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});

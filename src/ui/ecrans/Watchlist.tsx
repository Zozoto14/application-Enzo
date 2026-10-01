/**
 * Watchlist : les valeurs que vous suivez sans forcément les détenir.
 *
 * Quatre onglets, sur le modèle des watchlists en ligne :
 * - **Résumé** : la liste à gauche, triable ; à droite, la valeur choisie
 *   — cours, graphique, prix juste, informations — et votre suivi (seuils
 *   d'alerte, écart depuis l'ajout) ;
 * - **Tableau** : toutes les valeurs en colonnes triables ;
 * - **Thèses** et **Actualités** : ce qu'on dit de vos valeurs suivies.
 *
 * Une valeur suivie n'est pas une position : elle n'entre dans aucun total.
 * Celles que vous détenez aussi sont marquées, pour que la confusion soit
 * impossible.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Pressable, Text } from '../mobile/adaptatif';
import type { LigneSurveillee, VueWatchlist } from '../vues/watchlist';
import { calculerPrixJuste, type VueFiche } from '../vues/fiche';
import { Bouton, Champ, SousTitre, usePalette } from '../composants';
import { CarteSection, Pastille, Pile, Rangee, Segments, Selecteur, Signe, Vide } from '../elements';
import { GraphiqueLignes } from '../graphiques/Graphiques';
import { Tableau, type Colonne } from '../tableau';
import { FilTheses, type ChargerTheses } from '../theses';
import { useEnEuros } from '../../cours/change';
import { libellesEnEuros } from '../devises';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';

export interface WatchlistProps {
  vue: VueWatchlist;
  onAjouter(titreId: string): void;
  onRetirer(titreId: string): void;
  onChangerSeuil(titreId: string, champ: 'haut' | 'bas', valeur: string): void;
  onCreerTitre?(): void;
  /** Mène à l'écran Recherche, pour trouver une nouvelle valeur. */
  onRechercher?(): void;
  chargerTheses?: ChargerTheses;
  /** Données de la fiche d'un symbole : graphique, prix juste, informations. */
  chargerFiche?(symbole: string): Promise<VueFiche>;
  onOuvrirFiche?(symbole: string): void;
  /** Conservé pour le téléphone ; l'ordinateur a sa barre latérale. */
  onRetour?(): void;
}

type Onglet = 'resume' | 'tableau' | 'theses' | 'actualites';
const ONGLETS: Array<{ cle: Onglet; libelle: string }> = [
  { cle: 'resume', libelle: 'Résumé' },
  { cle: 'tableau', libelle: 'Tableau' },
  { cle: 'theses', libelle: 'Thèses' },
  { cle: 'actualites', libelle: 'Actualités' },
];

type Tri = 'ecart' | 'nom' | 'ajout';
const TRIS: Array<{ valeur: Tri; libelle: string }> = [
  { valeur: 'ecart', libelle: 'Écart depuis l’ajout' },
  { valeur: 'nom', libelle: 'Nom' },
  { valeur: 'ajout', libelle: 'Ordre d’ajout' },
];

const nombreFr = (valeur: number, decimales = 2) =>
  valeur.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

function initiales(nom: string, ticker: string): string {
  const base = ticker.replace(/\..*$/, '');
  if (base) return base.slice(0, 4).toUpperCase();
  return nom
    .split(/\s+/)
    .slice(0, 2)
    .map(mot => mot[0]?.toUpperCase() ?? '')
    .join('');
}

function Logo({ nom, ticker, taille = 34 }: { nom: string; ticker: string; taille?: number }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.logo,
        { width: taille, height: taille, backgroundColor: palette.surfaceHaute, borderColor: palette.bordure },
      ]}>
      <Text style={{ color: palette.accent, fontWeight: '800', fontSize: taille > 40 ? 13 : 10 }}>{initiales(nom, ticker)}</Text>
    </View>
  );
}

// ---------------------------------------------------------- Fiches en cache

const DUREE_CACHE_MS = 10 * 60 * 1000;
const fiches = new Map<string, { quand: number; promesse: Promise<VueFiche> }>();

function ficheDe(symbole: string, charger: (symbole: string) => Promise<VueFiche>): Promise<VueFiche> {
  const connue = fiches.get(symbole);
  if (connue && Date.now() - connue.quand < DUREE_CACHE_MS) return connue.promesse;
  const promesse = charger(symbole);
  promesse.catch(() => fiches.delete(symbole));
  fiches.set(symbole, { quand: Date.now(), promesse });
  return promesse;
}

// ------------------------------------------------------------------ Écran

export function Watchlist(props: WatchlistProps) {
  const { vue, chargerTheses } = props;
  const palette = usePalette();
  const [onglet, setOnglet] = useState<Onglet>('resume');
  const [tri, setTri] = useState<Tri>('ecart');
  const [choisi, setChoisi] = useState<string | undefined>();

  const lignes = useMemo(() => {
    const copie = [...vue.lignes];
    if (tri === 'nom') copie.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    if (tri === 'ecart') copie.sort((a, b) => (b.ecartPct ?? -Infinity) - (a.ecartPct ?? -Infinity));
    return copie;
  }, [vue.lignes, tri]);
  const selection = lignes.find(ligne => ligne.titreId === choisi) ?? lignes[0];
  const valeurs = useMemo(
    () => vue.lignes.map(ligne => ({ nom: ligne.nom, symbole: ligne.ticker || undefined })),
    [vue.lignes],
  );

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.entete}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text {...POLICE_TITRE} style={[styles.titre, { color: palette.texte }]} accessibilityRole="header">
              Watchlist
            </Text>
            <Text style={{ color: palette.texteSecondaire }}>
              {vue.lignes.length === 0
                ? 'Aucune valeur suivie.'
                : `${vue.lignes.length} valeur${vue.lignes.length > 1 ? 's' : ''} suivie${vue.lignes.length > 1 ? 's' : ''}, hors portefeuille.`}
            </Text>
          </View>
          {props.onRechercher ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onRechercher}
              testID="bouton-vers-recherche"
              style={[styles.boutonPlein, { backgroundColor: palette.accentPlein }]}>
              <Text style={{ color: palette.surAccent, fontWeight: '700' }}>⌕ Ajouter une valeur</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.ongletsBarre, { borderBottomColor: palette.bordure }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.onglets}>
            {ONGLETS.map(element => {
              const actif = element.cle === onglet;
              return (
                <Pressable
                  key={element.cle}
                  testID={`onglet-surveillance-${element.cle}`}
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
          </ScrollView>
        </View>

        {onglet === 'resume' ? (
          <Rangee>
            <CarteSection poids={1} style={{ maxWidth: 440 }}>
              {vue.lignes.length > 1 ? (
                <Selecteur
                  etiquette="Trier par"
                  valeur={tri}
                  options={TRIS}
                  onChoisir={valeur => setTri(valeur as Tri)}
                  largeur={260}
                  testID="tri-watchlist"
                />
              ) : null}
              {vue.message ? <Vide>{vue.message}</Vide> : null}
              <View>
                {lignes.map(ligne => (
                  <LigneListe
                    key={ligne.titreId}
                    ligne={ligne}
                    selectionnee={ligne.titreId === selection?.titreId}
                    onPress={() => setChoisi(ligne.titreId)}
                  />
                ))}
              </View>
              <Candidats {...props} />
            </CarteSection>
            {selection ? (
              <Pile poids={2.4}>
                <Panneau key={selection.titreId} ligne={selection} {...props} />
              </Pile>
            ) : null}
          </Rangee>
        ) : null}

        {onglet === 'tableau' ? <TableauWatchlist {...props} /> : null}

        {onglet === 'theses' || onglet === 'actualites' ? (
          <CarteSection titre={onglet === 'theses' ? 'Thèses — Watchlist' : 'Actualités — Watchlist'}>
            {vue.lignes.length === 0 ? (
              <Vide>Surveillez d’abord une valeur : ses thèses et son actualité s’afficheront ici.</Vide>
            ) : chargerTheses ? (
              <FilTheses valeurs={valeurs} chargerTheses={chargerTheses} mode={onglet} testID={`fil-${onglet}`} />
            ) : (
              <Vide>Les thèses et actualités se lisent dans l’application de bureau.</Vide>
            )}
          </CarteSection>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------ Liste de gauche

function LigneListe({ ligne, selectionnee, onPress }: { ligne: LigneSurveillee; selectionnee: boolean; onPress(): void }) {
  const palette = usePalette();
  const enEuros = useEnEuros();
  const prix = libellesEnEuros(ligne.coursBrut, ligne.devise, enEuros);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selectionnee }}
      onPress={onPress}
      testID={`ligne-watchlist-${ligne.titreId}`}
      style={({ pressed }) => [
        styles.ligneListe,
        { backgroundColor: selectionnee ? palette.accentFond : pressed ? palette.surfaceHaute : 'transparent' },
      ]}>
      <Logo nom={ligne.nom} ticker={ligne.ticker} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: selectionnee ? palette.accent : palette.texte, fontWeight: '700' }}>
          {ligne.nom}
        </Text>
        <Text numberOfLines={1} style={{ color: palette.accent, fontSize: 12 }}>
          {ligne.ticker || 'sans symbole'}
          {ligne.detenue ? <Text style={{ color: palette.texteSecondaire }}> · détenue</Text> : null}
          {ligne.seuilAtteint ? <Text style={{ color: palette.danger }}> · seuil franchi</Text> : null}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: palette.texte, fontWeight: '700' }}>{ligne.coursBrut === undefined ? '—' : prix.principal}</Text>
        {prix.origine ? <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>{prix.origine}</Text> : null}
        {ligne.ecartPourcent ? (
          <Signe texte={ligne.ecartPourcent} tendance={ligne.tendance} taille={12} />
        ) : (
          <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>—</Text>
        )}
      </View>
    </Pressable>
  );
}

function Candidats({ vue, onAjouter, onCreerTitre }: WatchlistProps) {
  const palette = usePalette();
  if (vue.candidats.length === 0 && !onCreerTitre) return null;
  return (
    <View style={{ gap: ESPACEMENT.s, marginTop: ESPACEMENT.s }}>
      {vue.candidats.length > 0 ? (
        <>
          <Text style={{ color: palette.texteSecondaire, fontSize: 12, fontWeight: '700' }}>AJOUTER DEPUIS VOS VALEURS</Text>
          <SousTitre>Le cours du jour est figé à l’ajout : c’est lui qui sert de point de comparaison.</SousTitre>
          <View style={styles.choix}>
            {vue.candidats.map(candidat => (
              <Pressable
                key={candidat.titreId}
                testID={`surveiller-${candidat.titreId}`}
                accessibilityRole="button"
                onPress={() => onAjouter(candidat.titreId)}
                style={[styles.puce, { borderColor: palette.accent }]}>
                <Text style={{ fontSize: 13, color: palette.accent }}>
                  {candidat.nom}
                  {candidat.detenue ? ' · détenue' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {onCreerTitre ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton titre="Créer une valeur" testID="bouton-creer-titre-watchlist" variante="discret" onPress={onCreerTitre} />
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------ Panneau de droite

type Periode = '1A' | '3A' | '5A' | 'MAX';

function Panneau({ ligne, ...props }: WatchlistProps & { ligne: LigneSurveillee }) {
  const palette = usePalette();
  const [fiche, setFiche] = useState<{ vue?: VueFiche; chargement: boolean; erreur?: string }>({
    chargement: Boolean(props.chargerFiche && ligne.ticker),
  });
  const [periode, setPeriode] = useState<Periode>('5A');

  useEffect(() => {
    if (!props.chargerFiche || !ligne.ticker) return;
    let actif = true;
    ficheDe(ligne.ticker, props.chargerFiche)
      .then(vue => {
        if (actif) setFiche({ vue, chargement: false });
      })
      .catch((e: unknown) => {
        if (actif) setFiche({ chargement: false, erreur: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      actif = false;
    };
  }, [ligne.ticker, props.chargerFiche]);

  const vue = fiche.vue;
  const enEuros = useEnEuros();
  const prixPanneau = libellesEnEuros(vue?.entete.coursBrut ?? ligne.coursBrut, vue?.entete.deviseCode ?? ligne.devise, enEuros);
  const cours = useMemo(() => {
    const serie = vue?.cours ?? [];
    if (periode === 'MAX' || serie.length === 0) return serie;
    const annees = { '1A': 1, '3A': 3, '5A': 5 }[periode];
    const dernier = Date.parse(serie[serie.length - 1].date);
    return serie.filter(point => Date.parse(point.date) >= dernier - annees * 365.25 * 86_400_000);
  }, [vue, periode]);

  const dernierCours = vue?.cours[vue.cours.length - 1]?.valeur ?? null;
  const prixJuste =
    vue && vue.valorisation.parametres.bpa > 0 ? calculerPrixJuste(vue.valorisation.parametres, dernierCours) : undefined;
  const perf = cours.length > 1 ? (cours[cours.length - 1].valeur / cours[0].valeur - 1) * 100 : undefined;
  const ansPeriode =
    cours.length > 1 ? (Date.parse(cours[cours.length - 1].date) - Date.parse(cours[0].date)) / (365.25 * 86_400_000) : 0;
  const cagr = perf !== undefined && ansPeriode >= 1 ? ((1 + perf / 100) ** (1 / ansPeriode) - 1) * 100 : undefined;
  const bloc = (titre: string) => vue?.informations.find(element => element.titre === titre)?.lignes ?? [];
  const pct = (valeur: number) => `${valeur >= 0 ? '+' : ''}${nombreFr(valeur, 1)} %`;

  return (
    <>
      <CarteSection testID="panneau-watchlist">
        <View style={styles.enTetePanneau}>
          <Logo nom={ligne.nom} ticker={ligne.ticker} taille={52} />
          <View style={{ flex: 1, minWidth: 160 }}>
            <Text {...POLICE_TITRE} style={{ color: palette.texte, fontSize: 20, fontWeight: '800' }}>
              {ligne.nom}
            </Text>
            <Text style={{ color: palette.accent }}>
              {vue?.entete.bourse ? `${vue.entete.bourse}:` : ''}
              {ligne.ticker || 'sans symbole'}
            </Text>
          </View>
          {prixJuste && vue ? (
            <View style={styles.metriques}>
              <Metrique libelle="PRIX JUSTE" valeur={`${nombreFr(prixJuste.prix)} ${vue.entete.devise}`} couleur={palette.accent} />
              {prixJuste.rendementAttendu !== null ? (
                <Metrique
                  libelle="RENDEMENT ESTIMÉ"
                  valeur={`${nombreFr(prixJuste.rendementAttendu)} %/an`}
                  couleur={prixJuste.rendementAttendu >= 0 ? palette.hausse : palette.baisse}
                />
              ) : null}
              {prixJuste.margeSecurite !== null ? (
                <Metrique
                  libelle="MARGE DE SÉCURITÉ"
                  valeur={`${nombreFr(prixJuste.margeSecurite)} %`}
                  couleur={prixJuste.margeSecurite >= 0 ? palette.hausse : palette.baisse}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={[styles.graphique, { borderColor: palette.bordure }]}>
          <View style={styles.enTeteGraphique}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: ESPACEMENT.s }}>
              <Text style={{ color: palette.texte, fontSize: 20, fontWeight: '800' }}>{prixPanneau.principal}</Text>
              {prixPanneau.origine ? (
                <Text style={{ fontSize: 12, color: palette.texteSecondaire }}>{prixPanneau.origine}</Text>
              ) : null}
              {vue?.entete.variation ? (
                <Signe texte={vue.entete.variation.texte} tendance={vue.entete.variation.tendance} taille={13} />
              ) : null}
            </View>
            {vue && vue.cours.length > 1 ? (
              <Segments<Periode> options={['1A', '3A', '5A', 'MAX']} actif={periode} onChoisir={setPeriode} prefixeTest="periode-watchlist" />
            ) : null}
          </View>
          {fiche.chargement ? (
            <View style={styles.centre}>
              <ActivityIndicator color={palette.accent} />
            </View>
          ) : cours.length > 1 ? (
            <>
              <GraphiqueLignes
                series={[{ nom: ligne.ticker, couleur: palette.hausse, points: cours, aire: true }]}
                formater={valeur => `${nombreFr(valeur)} ${vue?.entete.devise ?? ''}`}
                hauteur={260}
              />
              <View style={styles.pastilles}>
                {perf !== undefined ? <Pastille texte={`Perf : ${pct(perf)}`} tendance={perf >= 0 ? 'hausse' : 'baisse'} /> : null}
                {cagr !== undefined ? <Pastille texte={`CAGR : ${pct(cagr)}`} tendance={cagr >= 0 ? 'hausse' : 'baisse'} /> : null}
              </View>
            </>
          ) : (
            <Vide>
              {!ligne.ticker
                ? 'Cette valeur n’a pas de symbole boursier : renseignez-le dans Paramètres › Portefeuille › Symboles de cotation pour voir son graphique.'
                : fiche.erreur
                  ? `Graphique indisponible : ${fiche.erreur}`
                  : props.chargerFiche
                    ? 'Pas d’historique de cours.'
                    : 'Le graphique se charge dans l’application de bureau.'}
            </Vide>
          )}
        </View>
      </CarteSection>

      {vue ? (
        <Rangee>
          <CarteInfos titre="Informations" lignes={[...bloc('Profil').slice(0, 3), ...bloc('Marché').slice(0, 1)]} />
          <CarteInfos
            titre="Prix"
            lignes={[
              ...(vue.entete.variation
                ? [{ libelle: 'Variation jour', valeur: vue.entete.variation.texte, tendance: vue.entete.variation.tendance }]
                : []),
              ...bloc('Marché').slice(2, 4),
              ...(vue.objectifs ? [{ libelle: 'Objectif analystes', valeur: `${nombreFr(vue.objectifs.moyen)} ${vue.entete.devise}` }] : []),
            ]}
          />
          <CarteInfos titre="Valorisation" lignes={bloc('Valorisation').slice(0, 4)} />
        </Rangee>
      ) : null}

      <CarteSection titre="Votre suivi">
        {ligne.detenue || ligne.seuilAtteint ? (
          <View style={styles.etiquettes}>
            {ligne.detenue ? (
              <View style={[styles.etiquette, { borderColor: palette.bordure }]}>
                <Text style={{ fontSize: 11, color: palette.texteSecondaire }}>Aussi détenue</Text>
              </View>
            ) : null}
            {ligne.seuilAtteint ? (
              <View style={[styles.etiquette, { borderColor: palette.danger }]}>
                <Text style={{ fontSize: 11, color: palette.danger }}>Seuil franchi</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Text style={{ color: palette.texte }}>{ligne.depuis}</Text>
        {ligne.ecart ? (
          <Signe texte={`${ligne.ecart} (${ligne.ecartPourcent}) depuis l’ajout`} tendance={ligne.tendance} taille={14} />
        ) : null}
        {ligne.motifEcart ? <SousTitre>{ligne.motifEcart}</SousTitre> : null}
        {ligne.note ? <SousTitre>{ligne.note}</SousTitre> : null}
        <View style={styles.paire}>
          <View style={styles.moitie}>
            <Champ
              etiquette="Alerte si le cours passe sous"
              testID={`surveillance-bas-${ligne.titreId}`}
              value={ligne.seuilBas}
              onChangeText={valeur => props.onChangerSeuil(ligne.titreId, 'bas', valeur)}
              keyboardType="decimal-pad"
              placeholder="—"
            />
          </View>
          <View style={styles.moitie}>
            <Champ
              etiquette="Alerte si le cours dépasse"
              testID={`surveillance-haut-${ligne.titreId}`}
              value={ligne.seuilHaut}
              onChangeText={valeur => props.onChangerSeuil(ligne.titreId, 'haut', valeur)}
              keyboardType="decimal-pad"
              placeholder="—"
            />
          </View>
        </View>
        <View style={styles.etiquettes}>
          {props.onOuvrirFiche && ligne.ticker ? (
            <Bouton titre="Ouvrir la fiche" variante="discret" onPress={() => props.onOuvrirFiche!(ligne.ticker)} />
          ) : null}
          <Bouton
            titre="Ne plus surveiller"
            testID={`retirer-${ligne.titreId}`}
            variante="discret"
            onPress={() => props.onRetirer(ligne.titreId)}
          />
        </View>
      </CarteSection>
    </>
  );
}

/** Prix en euros, avec la devise d'origine en dessous quand elle diffère. */
function PrixEnEuros({ montant, devise }: { montant?: number; devise: string }) {
  const palette = usePalette();
  const prix = libellesEnEuros(montant, devise, useEnEuros());
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={{ color: palette.texte }}>{prix.principal}</Text>
      {prix.origine ? <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>{prix.origine}</Text> : null}
    </View>
  );
}

function Metrique({ libelle, valeur, couleur }: { libelle: string; valeur: string; couleur: string }) {
  const palette = usePalette();
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={{ color: palette.texteSecondaire, fontSize: 10.5, fontWeight: '700' }}>{libelle}</Text>
      <Text style={{ color: couleur, fontSize: 15, fontWeight: '800' }}>{valeur}</Text>
    </View>
  );
}

function CarteInfos({
  titre,
  lignes,
}: {
  titre: string;
  lignes: ReadonlyArray<{ libelle: string; valeur: string; tendance?: 'hausse' | 'baisse' | 'neutre' }>;
}) {
  const palette = usePalette();
  return (
    <CarteSection titre={titre}>
      {lignes.length === 0 ? (
        <Vide>—</Vide>
      ) : (
        lignes.map(ligne => (
          <View key={ligne.libelle} style={[styles.ligneInfo, { borderColor: palette.bordure }]}>
            <Text style={{ color: palette.texteSecondaire, fontSize: 13, flexShrink: 1 }}>{ligne.libelle}</Text>
            <Text
              numberOfLines={1}
              style={{
                color: ligne.tendance === 'hausse' ? palette.hausse : ligne.tendance === 'baisse' ? palette.baisse : palette.texte,
                fontWeight: '700',
                fontSize: 13,
                flexShrink: 1,
              }}>
              {ligne.valeur}
            </Text>
          </View>
        ))
      )}
    </CarteSection>
  );
}

// ------------------------------------------------------------- Tableau

function TableauWatchlist({ vue, onRetirer, onOuvrirFiche }: WatchlistProps) {
  const palette = usePalette();
  const colonnes: Colonne<LigneSurveillee>[] = [
    {
      cle: 'nom',
      titre: 'Nom',
      largeur: 220,
      extensible: 1,
      tri: ligne => ligne.nom,
      rendu: ligne => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s }}>
          <Logo nom={ligne.nom} ticker={ligne.ticker} taille={28} />
          <View style={{ flexShrink: 1 }}>
            <Text numberOfLines={1} style={{ color: palette.texte, fontWeight: '600' }}>
              {ligne.nom}
            </Text>
            <Text style={{ color: palette.accent, fontSize: 11 }}>{ligne.ticker}</Text>
          </View>
        </View>
      ),
    },
    {
      cle: 'ecart',
      titre: 'Depuis l’ajout',
      largeur: 120,
      alignement: 'droite',
      tri: ligne => ligne.ecartPct ?? null,
      rendu: ligne =>
        ligne.ecartPourcent ? (
          <Pastille texte={ligne.ecartPourcent} tendance={ligne.tendance} />
        ) : (
          <Text style={{ color: palette.texteSecondaire }}>—</Text>
        ),
    },
    {
      cle: 'cours',
      titre: 'Cours',
      largeur: 110,
      alignement: 'droite',
      rendu: ligne => <PrixEnEuros montant={ligne.coursBrut} devise={ligne.devise} />,
    },
    {
      cle: 'bas',
      titre: 'Seuil bas',
      largeur: 90,
      alignement: 'droite',
      rendu: ligne => <Text style={{ color: palette.texteSecondaire }}>{ligne.seuilBas || '—'}</Text>,
    },
    {
      cle: 'haut',
      titre: 'Seuil haut',
      largeur: 90,
      alignement: 'droite',
      rendu: ligne => <Text style={{ color: palette.texteSecondaire }}>{ligne.seuilHaut || '—'}</Text>,
    },
    {
      cle: 'statut',
      titre: 'Statut',
      largeur: 120,
      alignement: 'centre',
      rendu: ligne => (
        <Text style={{ color: ligne.seuilAtteint ? palette.danger : palette.texteSecondaire, fontSize: 12 }}>
          {ligne.seuilAtteint ? 'Seuil franchi' : ligne.detenue ? 'Détenue' : 'Suivie'}
        </Text>
      ),
    },
    {
      cle: 'actions',
      titre: 'Actions',
      largeur: 90,
      alignement: 'centre',
      rendu: ligne => (
        <View style={{ flexDirection: 'row', gap: ESPACEMENT.m }}>
          {onOuvrirFiche && ligne.ticker ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Fiche de ${ligne.nom}`} onPress={() => onOuvrirFiche(ligne.ticker)}>
              <Text style={{ color: palette.texte, fontSize: 16 }}>↗</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ne plus surveiller ${ligne.nom}`}
            onPress={() => onRetirer(ligne.titreId)}>
            <Text style={{ color: palette.danger, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>
      ),
    },
  ];
  return (
    <CarteSection>
      <Tableau colonnes={colonnes} lignes={vue.lignes} cle={ligne => ligne.titreId} vide="Aucune valeur suivie." testID="tableau-watchlist" />
    </CarteSection>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m },
  titre: { fontSize: 26, fontWeight: '800' },
  entete: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: ESPACEMENT.m },
  boutonPlein: { borderRadius: 999, paddingHorizontal: ESPACEMENT.l, paddingVertical: ESPACEMENT.s + 4 },
  ongletsBarre: { borderBottomWidth: 1 },
  onglets: { gap: ESPACEMENT.l },
  onglet: { paddingVertical: ESPACEMENT.s + 2, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  logo: { borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ligneListe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.m,
    paddingVertical: ESPACEMENT.s + 2,
    paddingHorizontal: ESPACEMENT.s,
    borderRadius: RAYON.s,
  },
  choix: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  puce: { borderWidth: 1, borderRadius: RAYON.l, paddingHorizontal: ESPACEMENT.m, paddingVertical: ESPACEMENT.s },
  enTetePanneau: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m },
  metriques: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l },
  graphique: { borderWidth: 1, borderRadius: RAYON.m, padding: ESPACEMENT.m, gap: ESPACEMENT.s },
  enTeteGraphique: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: ESPACEMENT.s },
  centre: { alignItems: 'center', paddingVertical: ESPACEMENT.xl },
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: ESPACEMENT.s },
  etiquettes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.s },
  etiquette: { borderWidth: 1, borderRadius: RAYON.s, paddingHorizontal: ESPACEMENT.s, paddingVertical: 2 },
  ligneInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: ESPACEMENT.s,
    paddingVertical: ESPACEMENT.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  paire: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.m },
  moitie: { flex: 1, minWidth: 160 },
});

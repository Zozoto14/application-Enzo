/**
 * Fiche d'une valeur : profil, comptes, dividendes, consensus, états
 * financiers, valorisation et actionnariat, depuis Yahoo Finance.
 *
 * L'onglet « Thèses & actus » rassemble ce qu'on dit de la valeur : analyses
 * d'investisseurs, avis de particuliers, articles de presse.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Bouton, usePalette } from '../composants';
import { CarteSection, Metrique, Pile, Rangee, Segments, Selecteur, Signe, Vide } from '../elements';
import { Barres, Donut, GraphiqueLignes, Radar } from '../graphiques/Graphiques';
import { Cellule, Tableau, type Colonne } from '../tableau';
import { ESPACEMENT, RAYON, palettePour, stylesPartages, POLICE_TITRE } from '../theme';
import { FilTheses, type ChargerTheses } from '../theses';
import { useEnEuros } from '../../cours/change';
import { libellesEnEuros } from '../devises';
import { calculerPrixJuste, type GraphiqueAnnuel, type ParametresPrixJuste, type VueFiche } from '../vues/fiche';

type OngletFiche =
  | 'resume'
  | 'quantitatif'
  | 'dividende'
  | 'resultats'
  | 'finances'
  | 'valorisation'
  | 'societe'
  | 'theses';

const ONGLETS: Array<{ cle: OngletFiche; libelle: string }> = [
  { cle: 'resume', libelle: 'Résumé' },
  { cle: 'quantitatif', libelle: 'Quantitatif' },
  { cle: 'dividende', libelle: 'Dividende' },
  { cle: 'resultats', libelle: 'Résultats' },
  { cle: 'finances', libelle: 'Finances' },
  { cle: 'valorisation', libelle: 'Valorisation' },
  { cle: 'societe', libelle: 'Société' },
  { cle: 'theses', libelle: 'Thèses & actus' },
];

const nombreFr = (valeur: number, decimales = 2) =>
  valeur.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const compact = (valeur: number) => {
  const absolu = Math.abs(valeur);
  if (absolu >= 1e9) return `${nombreFr(valeur / 1e9, 1)} Md`;
  if (absolu >= 1e6) return `${nombreFr(valeur / 1e6, 1)} M`;
  if (absolu >= 1e4) return `${nombreFr(valeur / 1e3, 1)} k`;
  return nombreFr(valeur, absolu < 10 ? 2 : 0);
};
const pourcent = (valeur: number) => `${nombreFr(valeur, 1)} %`;

export interface FicheValeurProps {
  symbole: string;
  vue?: VueFiche;
  chargement?: boolean;
  erreur?: string;
  onRetour(): void;
  onRecharger?(): void;
  /** Ajouter la valeur à la surveillance, si elle ne l'est pas déjà. */
  onSurveiller?(): void;
  surveillee?: boolean;
  /** Thèses et actualités de la valeur (bureau). */
  chargerTheses?: ChargerTheses;
  /** Fiche Baggr de la valeur si elle est connue, sinon l'accueil de Baggr. */
  lienBaggr?: string;
}

function ThesesValeur({
  nom,
  symbole,
  chargerTheses,
}: {
  nom: string;
  symbole: string;
  chargerTheses?: ChargerTheses;
}) {
  const [mode, setMode] = useState<'theses' | 'actualites'>('theses');
  const valeurs = useMemo(() => [{ nom, symbole }], [nom, symbole]);
  return (
    <CarteSection titre="Ce qu’on en dit" testID="fiche-theses-contenu">
      <Segments<'theses' | 'actualites'>
        options={['theses', 'actualites']}
        actif={mode}
        onChoisir={setMode}
        libelle={option => (option === 'theses' ? 'Thèses' : 'Actualités')}
        prefixeTest="fiche-mode"
      />
      {chargerTheses ? (
        <FilTheses valeurs={valeurs} chargerTheses={chargerTheses} mode={mode} />
      ) : (
        <Vide>Les thèses et actualités se lisent dans l’application de bureau.</Vide>
      )}
    </CarteSection>
  );
}

export function FicheValeur(props: FicheValeurProps) {
  const palette = usePalette();
  const [onglet, setOnglet] = useState<OngletFiche>('resume');
  const { vue } = props;

  return (
    <View style={[stylesPartages.ecran, { backgroundColor: palettePour().fond }]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.barre}>
          <Pressable accessibilityRole="button" onPress={props.onRetour} testID="bouton-retour-fiche" style={styles.retour}>
            <Text style={{ color: palette.accent, fontWeight: '700' }}>← Portefeuille</Text>
          </Pressable>
          {props.lienBaggr ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL(props.lienBaggr!).catch(() => undefined)}
              testID="bouton-baggr-fiche"
              style={styles.retour}>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>
                {props.lienBaggr.includes('/screener/') ? 'Fiche Baggr ↗' : 'Ouvrir Baggr ↗'}
              </Text>
            </Pressable>
          ) : null}
          {props.onRecharger ? (
            <Pressable accessibilityRole="button" onPress={props.onRecharger} style={styles.retour}>
              <Text style={{ color: palette.texteSecondaire }}>Recharger</Text>
            </Pressable>
          ) : null}
        </View>

        {vue ? (
          <EnTete vue={vue} surveillee={props.surveillee} onSurveiller={props.onSurveiller} />
        ) : (
          <Text style={[styles.nom, { color: palette.texte }]}>{props.symbole}</Text>
        )}

        {props.chargement ? (
          <View style={styles.centre}>
            <ActivityIndicator color={palette.accent} />
            <Text style={{ color: palette.texteSecondaire }}>Chargement des données de {props.symbole}…</Text>
          </View>
        ) : null}

        {props.erreur ? (
          <CarteSection titre="Données indisponibles">
            <Vide>{props.erreur}</Vide>
            {props.onRecharger ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Bouton titre="Réessayer" onPress={props.onRecharger} />
              </View>
            ) : null}
          </CarteSection>
        ) : null}

        {vue ? (
          <>
            <View style={[styles.ongletsBarre, { borderBottomColor: palette.bordure }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.onglets}>
                {ONGLETS.map(element => {
                  const actif = element.cle === onglet;
                  return (
                    <Pressable
                      key={element.cle}
                      testID={`fiche-${element.cle}`}
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

            {vue.manques.length > 0 ? <Vide>{vue.manques.join(' · ')}</Vide> : null}

            {onglet === 'resume' ? <Resume vue={vue} /> : null}
            {onglet === 'quantitatif' ? <Quantitatif vue={vue} /> : null}
            {onglet === 'dividende' ? <Dividende vue={vue} /> : null}
            {onglet === 'resultats' ? <Resultats vue={vue} /> : null}
            {onglet === 'finances' ? <Finances vue={vue} /> : null}
            {onglet === 'valorisation' ? <Valorisation vue={vue} /> : null}
            {onglet === 'societe' ? <Societe vue={vue} /> : null}
            {onglet === 'theses' ? (
              <ThesesValeur nom={vue.entete.nom} symbole={props.symbole} chargerTheses={props.chargerTheses} />
            ) : null}

            <Text style={[styles.source, { color: palette.texteSecondaire }]}>
              Données Yahoo Finance, fournies telles quelles. Thèses : Seeking Alpha, Reddit et la presse, via
              Google Actualités.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function EnTete({ vue, surveillee, onSurveiller }: { vue: VueFiche; surveillee?: boolean; onSurveiller?(): void }) {
  const palette = usePalette();
  const { entete } = vue;
  const enEuros = useEnEuros();
  const enEurosEntete = libellesEnEuros(entete.coursBrut, entete.deviseCode, enEuros);
  return (
    <View style={styles.entete}>
      <View style={[styles.logo, { backgroundColor: palette.surfaceHaute, borderColor: palette.bordure }]}>
        <Text style={{ color: palette.texte, fontWeight: '800', fontSize: 12 }}>
          {entete.symbole.replace(/\..*$/, '').slice(0, 4)}
        </Text>
      </View>
      <View style={{ gap: 4, flexShrink: 1 }}>
        <Text {...POLICE_TITRE} style={[styles.nom, { color: palette.texte }]} accessibilityRole="header">
          {entete.nom}
        </Text>
        <View style={[styles.pillule, { backgroundColor: palette.accentFond }]}>
          <Text style={{ color: palette.accent, fontSize: 12, fontWeight: '700' }}>
            {entete.bourse ? `${entete.bourse} : ` : ''}
            {entete.symbole}
          </Text>
        </View>
      </View>
      <View style={[styles.separateur, { backgroundColor: palette.bordure }]} />
      <View style={{ gap: 2 }}>
        {enEurosEntete.origine ? (
          <>
            <Text style={{ color: palette.texte, fontSize: 22, fontWeight: '800' }} testID="cours-en-euros">
              {enEurosEntete.principal}
            </Text>
            <Text style={{ fontSize: 12, color: palette.texteSecondaire }}>{enEurosEntete.origine} à la cotation</Text>
          </>
        ) : (
          <Text style={{ color: palette.texte, fontSize: 22, fontWeight: '800' }}>
            {entete.cours} <Text style={{ fontSize: 12, color: palette.texteSecondaire }}>{entete.devise}</Text>
          </Text>
        )}
        {entete.variation ? <Signe texte={entete.variation.texte} tendance={entete.variation.tendance} taille={13} /> : null}
      </View>
      <View style={[styles.note, { backgroundColor: palette.hausseFond }]} accessibilityLabel="Note maison, moyenne du profil quantitatif">
        <Text style={{ color: palette.hausse, fontWeight: '800' }}>{entete.note}</Text>
      </View>
      <View style={{ flexGrow: 1 }} />
      {onSurveiller ? (
        <Pressable
          accessibilityRole="button"
          disabled={surveillee}
          onPress={onSurveiller}
          testID="bouton-surveiller-fiche"
          style={[styles.suivre, { backgroundColor: surveillee ? palette.surfaceHaute : palette.accentPlein }]}>
          <Text style={{ color: surveillee ? palette.texteSecondaire : palette.surAccent, fontWeight: '700' }}>
            {surveillee ? '★ Dans ma watchlist' : '☆ Ajouter à ma watchlist'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Résumé

function Resume({ vue }: { vue: VueFiche }) {
  const palette = usePalette();
  const [periode, setPeriode] = useState<'1A' | '3A' | '5A' | 'MAX'>('5A');
  const cours = useMemo(() => {
    if (periode === 'MAX' || vue.cours.length === 0) {
      return vue.cours;
    }
    const annees = { '1A': 1, '3A': 3, '5A': 5 }[periode];
    const dernier = Date.parse(vue.cours[vue.cours.length - 1].date);
    return vue.cours.filter(point => Date.parse(point.date) >= dernier - annees * 365.25 * 86_400_000);
  }, [vue.cours, periode]);

  return (
    <>
      <Rangee>
        <CarteSection titre="Informations" poids={1.6}>
          <View style={styles.blocs}>
            {vue.informations.map(bloc => (
              <View key={bloc.titre} style={styles.bloc}>
                <Text style={[styles.titreBloc, { color: palette.texteSecondaire }]}>{bloc.titre.toUpperCase()}</Text>
                {bloc.lignes.map(ligne => (
                  <View key={ligne.libelle} style={styles.ligneInfo}>
                    <Text style={{ color: palette.texteSecondaire, fontSize: 12, flexShrink: 1 }}>{ligne.libelle}</Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        color:
                          ligne.tendance === 'hausse' ? palette.hausse : ligne.tendance === 'baisse' ? palette.baisse : palette.texte,
                        fontSize: 12,
                        fontWeight: '700',
                        flexShrink: 1,
                      }}>
                      {ligne.valeur}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </CarteSection>
        <Pile>
          <CarteSection
            titre="Cours"
            actions={
              <Segments<'1A' | '3A' | '5A' | 'MAX'>
                options={['1A', '3A', '5A', 'MAX']}
                actif={periode}
                onChoisir={valeur => setPeriode(valeur)}
              />
            }>
            {cours.length > 1 ? (
              <GraphiqueLignes
                series={[{ nom: vue.entete.symbole, couleur: palette.hausse, points: cours, aire: true }]}
                formater={valeur => `${nombreFr(valeur)} ${vue.entete.devise}`}
                hauteur={240}
              />
            ) : (
              <Vide>Pas d’historique de cours.</Vide>
            )}
          </CarteSection>
          <CarteSection titre="Profil quantitatif" actions={<Text style={{ color: palette.hausse, fontWeight: '800' }}>{vue.entete.note}</Text>}>
            <Radar axes={vue.profil} couleur={palette.hausse} hauteur={250} />
            <Vide>Note maison : moyenne des six axes, chacun ramené entre 0 et 1 selon des bornes usuelles.</Vide>
          </CarteSection>
        </Pile>
      </Rangee>

      {vue.objectifs ? (
        <CarteSection titre="Objectifs des analystes" actions={<Signe texte={vue.objectifs.potentiel.texte} tendance={vue.objectifs.potentiel.tendance} taille={13} />}>
          <Barres
            horizontal
            barres={[
              { libelle: 'Cours actuel', valeur: vue.objectifs.cours, couleur: palette.accent },
              { libelle: 'Objectif bas', valeur: vue.objectifs.bas, couleur: palette.baisse },
              { libelle: 'Objectif moyen', valeur: vue.objectifs.moyen, couleur: palette.reference },
              { libelle: 'Objectif haut', valeur: vue.objectifs.haut, couleur: palette.hausse },
            ]}
            formater={valeur => `${nombreFr(valeur)} ${vue.entete.devise}`}
            repere={{ valeur: vue.objectifs.cours }}
          />
          <Vide>{vue.objectifs.texte}</Vide>
        </CarteSection>
      ) : null}

      {vue.description ? (
        <CarteSection titre="Activité">
          <Text style={{ color: palette.texte, lineHeight: 21, fontSize: 13.5 }}>{vue.description}</Text>
        </CarteSection>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------- Quantitatif

function formatPour(graphique: GraphiqueAnnuel): (valeur: number) => string {
  return graphique.unite === 'pourcentage' ? pourcent : graphique.unite === 'nombre' ? (v: number) => nombreFr(v) : compact;
}

function Quantitatif({ vue }: { vue: VueFiche }) {
  const palette = usePalette();
  if (vue.quantitatif.length === 0) {
    return (
      <CarteSection>
        <Vide>Aucun compte annuel disponible pour cette valeur.</Vide>
      </CarteSection>
    );
  }
  const rangees: GraphiqueAnnuel[][] = [];
  for (let i = 0; i < vue.quantitatif.length; i += 3) {
    rangees.push(vue.quantitatif.slice(i, i + 3));
  }
  return (
    <>
      {rangees.map((rangee, index) => (
        <Rangee key={index}>
          {rangee.map((graphique, rang) => (
            <CarteSection
              key={graphique.titre}
              titre={graphique.titre}
              actions={graphique.cagr ? <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>CAGR {graphique.cagr}</Text> : null}>
              <Barres
                barres={graphique.barres.map(barre => ({
                  ...barre,
                  couleur: barre.valeur < 0 ? palette.baisse : palette.series[(index * 3 + rang) % palette.series.length],
                }))}
                formater={formatPour(graphique)}
                hauteur={200}
                valeursVisibles
              />
            </CarteSection>
          ))}
        </Rangee>
      ))}
    </>
  );
}

// --------------------------------------------------------------- Dividende

function Dividende({ vue }: { vue: VueFiche }) {
  const palette = usePalette();
  const d = vue.dividende;
  return (
    <>
      <Rangee>
        <CarteSection titre="Métriques clés">
          <View style={styles.grille}>
            {d.metriques.map(m => (
              <Metrique key={m.libelle} libelle={m.libelle} valeur={m.valeur} />
            ))}
          </View>
        </CarteSection>
        <CarteSection titre="Dividende / action">
          {d.parAnnee.length > 0 ? (
            <Barres barres={d.parAnnee} formater={valeur => nombreFr(valeur)} hauteur={220} valeursVisibles />
          ) : (
            <Vide>Aucun dividende versé sur les dix dernières années.</Vide>
          )}
        </CarteSection>
        <CarteSection titre="Rendement du dividende">
          {d.rendement.length > 1 ? (
            <GraphiqueLignes
              series={[{ nom: 'Rendement', couleur: palette.accent, points: d.rendement }]}
              formater={pourcent}
              hauteur={220}
              repere={d.rendementMedian !== null ? { valeur: d.rendementMedian, libelle: `Médiane : ${pourcent(d.rendementMedian)}` } : undefined}
            />
          ) : (
            <Vide>Pas d’historique de rendement.</Vide>
          )}
        </CarteSection>
      </Rangee>
      <Rangee>
        <CarteSection titre="Croissance du dividende">
          {d.croissance.length > 0 ? (
            <Barres
              barres={d.croissance.map(barre => ({ ...barre, couleur: barre.valeur >= 0 ? palette.hausse : palette.baisse }))}
              formater={pourcent}
              hauteur={220}
              valeursVisibles
            />
          ) : (
            <Vide>Au moins deux années de versements sont nécessaires.</Vide>
          )}
        </CarteSection>
        <CarteSection titre="Historique des versements">
          <Tableau
            colonnes={[
              { cle: 'date', titre: 'Date', largeur: 110, rendu: (l: { date: string; montant: string }) => <Cellule>{l.date}</Cellule> },
              {
                cle: 'montant',
                titre: 'Dividende',
                largeur: 120,
                extensible: 1,
                alignement: 'droite',
                rendu: (l: { date: string; montant: string }) => <Cellule gras>{l.montant}</Cellule>,
              },
            ]}
            lignes={d.versements.slice(0, 20)}
            cle={l => l.date}
            vide="Aucun versement."
          />
        </CarteSection>
      </Rangee>
    </>
  );
}

// --------------------------------------------------------------- Résultats

const COULEURS_RECO = {
  'fort-achat': '#1f9d63',
  achat: '#3fbf7f',
  conserver: '#f5c542',
  vente: '#f08a3c',
  'forte-vente': '#f05252',
} as const;

function Resultats({ vue }: { vue: VueFiche }) {
  const palette = usePalette();
  const r = vue.resultats;
  return (
    <>
      {r.prochaineDate ? (
        <CarteSection>
          <Text style={{ color: palette.texte }}>
            Prochains résultats : <Text style={{ color: palette.accent, fontWeight: '700' }}>{r.prochaineDate}</Text>
          </Text>
        </CarteSection>
      ) : null}
      <Rangee>
        <CarteSection titre="Surprises des BPA">
          {r.surprises.length > 0 ? (
            <>
              <Barres
                barres={r.surprises.map(s => ({
                  libelle: s.libelle,
                  valeur: s.reel ?? 0,
                  couleur: (s.reel ?? 0) >= (s.estime ?? 0) ? palette.hausse : palette.baisse,
                  detail: `Estimé : ${s.estime === null ? '—' : nombreFr(s.estime)}${s.ecart ? ` · écart ${s.ecart.texte}` : ''}`,
                }))}
                formater={valeur => nombreFr(valeur)}
                hauteur={200}
                valeursVisibles
              />
              <Vide>Vert : BPA publié au-dessus du consensus. Rouge : en dessous.</Vide>
            </>
          ) : (
            <Vide>Aucun historique de résultats trimestriels.</Vide>
          )}
        </CarteSection>
        <CarteSection titre="Notes des analystes" actions={r.consensus ? <Text style={{ color: palette.texte, fontWeight: '700' }}>{r.consensus}</Text> : null}>
          {r.recommandations.length > 0 ? (
            <Donut
              parts={r.recommandations.map(reco => ({
                libelle: reco.libelle,
                valeur: reco.valeur,
                couleur: COULEURS_RECO[reco.couleur],
              }))}
              formater={valeur => `${valeur} analyste(s)`}
              hauteur={220}
            />
          ) : (
            <Vide>Aucune recommandation publiée.</Vide>
          )}
        </CarteSection>
      </Rangee>
      <CarteSection titre="Prévisions du consensus">
        <Tableau
          colonnes={[
            { cle: 'p', titre: 'Période', largeur: 220, extensible: 2, rendu: (l: VueFiche['resultats']['estimations'][number]) => <Cellule gras>{l.periode}</Cellule> },
            { cle: 'b', titre: 'BPA estimé', largeur: 110, alignement: 'droite', rendu: l => <Cellule>{l.bpa}</Cellule> },
            { cle: 'c', titre: 'CA estimé', largeur: 120, alignement: 'droite', rendu: l => <Cellule>{l.ca}</Cellule> },
            { cle: 'g', titre: 'Croissance', largeur: 100, alignement: 'droite', rendu: l => <Cellule>{l.croissance}</Cellule> },
          ]}
          lignes={r.estimations}
          cle={l => l.periode}
          vide="Aucune prévision disponible."
        />
      </CarteSection>
    </>
  );
}

// ---------------------------------------------------------------- Finances

export function TableauFinances({ vue }: { vue: VueFiche['finances'] }) {
  const palette = usePalette();
  const [etat, setEtat] = useState(vue.etats[0]?.titre ?? '');
  const choisi = vue.etats.find(element => element.titre === etat) ?? vue.etats[0];
  if (!choisi) {
    return <Vide>Aucun état financier disponible.</Vide>;
  }
  const colonnes: Colonne<(typeof choisi.lignes)[number]>[] = [
    {
      cle: 'libelle',
      titre: choisi.titre,
      largeur: 240,
      rendu: ligne => <Cellule gras={ligne.important}>{ligne.libelle}</Cellule>,
    },
    ...vue.annees.map((annee, index) => ({
      cle: annee,
      titre: annee,
      largeur: 96,
      extensible: 1,
      alignement: 'droite' as const,
      rendu: (ligne: (typeof choisi.lignes)[number]) => (
        <View style={{ alignItems: 'flex-end' }}>
          <Cellule gras={ligne.important}>{ligne.valeurs[index]}</Cellule>
          {ligne.variations[index] ? (
            <Text
              style={{
                color: ligne.variations[index]!.tendance === 'hausse' ? palette.hausse : palette.baisse,
                fontSize: 10.5,
              }}>
              {ligne.variations[index]!.texte}
            </Text>
          ) : null}
        </View>
      ),
    })),
  ];
  return (
    <View style={{ gap: ESPACEMENT.m }}>
      <View style={{ alignSelf: 'flex-start', zIndex: 20 }}>
        <Selecteur
          etiquette="Type de données financières"
          valeur={choisi.titre}
          options={vue.etats.map(element => ({ valeur: element.titre, libelle: element.titre }))}
          onChoisir={setEtat}
          largeur={240}
        />
      </View>
      <Tableau colonnes={colonnes} lignes={choisi.lignes} cle={ligne => ligne.libelle} />
    </View>
  );
}

function Finances({ vue }: { vue: VueFiche }) {
  return (
    <CarteSection titre="États financiers annuels">
      <TableauFinances vue={vue.finances} />
    </CarteSection>
  );
}

// ------------------------------------------------------------ Valorisation

function ChampNombre({ libelle, valeur, onChange }: { libelle: string; valeur: string; onChange(texte: string): void }) {
  const palette = usePalette();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{libelle}</Text>
      <TextInput
        accessibilityLabel={libelle}
        value={valeur}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        style={[styles.champ, { color: palette.texte, borderColor: palette.bordure, backgroundColor: palette.surfaceHaute }]}
      />
    </View>
  );
}

function Valorisation({ vue }: { vue: VueFiche }) {
  const palette = usePalette();
  const defaut = vue.valorisation.parametres;
  const [champs, setChamps] = useState({
    bpa: String(defaut.bpa).replace('.', ','),
    croissance: String(defaut.croissance).replace('.', ','),
    annees: String(defaut.annees),
    perSortie: String(defaut.perSortie).replace('.', ','),
    rendementExige: String(defaut.rendementExige).replace('.', ','),
  });
  const [dividendes, setDividendes] = useState(defaut.inclureDividendes);
  const lire = (texte: string) => Number(texte.replace(/\s/g, '').replace(',', '.'));
  const parametres: ParametresPrixJuste = {
    bpa: lire(champs.bpa),
    croissance: lire(champs.croissance),
    annees: lire(champs.annees),
    perSortie: lire(champs.perSortie),
    rendementExige: lire(champs.rendementExige),
    distribution: defaut.distribution,
    inclureDividendes: dividendes,
  };
  const valide = Object.values(parametres).every(valeur => typeof valeur === 'boolean' || Number.isFinite(valeur)) && parametres.annees >= 1;
  const cours = vue.objectifs?.cours ?? Number(vue.entete.cours.replace(/\s/g, '').replace(',', '.'));
  const resultat = valide ? calculerPrixJuste(parametres, Number.isFinite(cours) ? cours : null) : undefined;
  const maj = (cle: keyof typeof champs) => (texte: string) => setChamps(precedent => ({ ...precedent, [cle]: texte }));

  return (
    <>
      <Rangee>
        <CarteSection titre="Calculatrice de prix juste" poids={1.6}>
          {resultat ? (
            <>
              <View style={styles.grille}>
                <Metrique libelle="Prix juste estimé" valeur={`${nombreFr(resultat.prix)} ${vue.entete.devise}`} />
                <Metrique
                  libelle="Rendement attendu"
                  valeur={resultat.rendementAttendu === null ? '—' : `${nombreFr(resultat.rendementAttendu)} %/an`}
                  tendance={resultat.rendementAttendu !== null && resultat.rendementAttendu >= 0 ? 'hausse' : 'baisse'}
                />
                <Metrique
                  libelle="Marge de sécurité"
                  valeur={resultat.margeSecurite === null ? '—' : `${nombreFr(resultat.margeSecurite)} %`}
                  tendance={resultat.margeSecurite !== null && resultat.margeSecurite >= 0 ? 'hausse' : 'baisse'}
                />
              </View>
              <Barres
                barres={resultat.projection.map(point => ({
                  libelle: `+${point.annee}a`,
                  valeur: point.prix,
                  couleur: palette.series[1],
                  detail: `BPA ${nombreFr(point.bpa)}`,
                }))}
                formater={valeur => nombreFr(valeur, 0)}
                hauteur={220}
                repere={Number.isFinite(cours) ? { valeur: cours, libelle: `Cours : ${nombreFr(cours)}` } : undefined}
              />
            </>
          ) : (
            <Vide>Complétez les paramètres avec des nombres.</Vide>
          )}
          <Vide>
            Prix de l’action dans {parametres.annees || '…'} ans (BPA projeté × PER de sortie), ramené à aujourd’hui au
            rendement exigé. Un calcul d’hypothèses, pas une prévision.
          </Vide>
        </CarteSection>
        <CarteSection titre="Paramètres">
          <ChampNombre libelle="Bénéfice par action de départ" valeur={champs.bpa} onChange={maj('bpa')} />
          <ChampNombre libelle="Croissance annuelle du BPA (%)" valeur={champs.croissance} onChange={maj('croissance')} />
          <ChampNombre libelle="Durée (années)" valeur={champs.annees} onChange={maj('annees')} />
          <ChampNombre libelle="PER de sortie" valeur={champs.perSortie} onChange={maj('perSortie')} />
          <ChampNombre libelle="Rendement exigé (%/an)" valeur={champs.rendementExige} onChange={maj('rendementExige')} />
          <View style={styles.ligneInfo}>
            <Text style={{ color: palette.texte }}>Inclure les dividendes</Text>
            <Switch value={dividendes} onValueChange={setDividendes} />
          </View>
        </CarteSection>
      </Rangee>
      <Rangee>
        <CarteSection titre="Métriques clés">
          <View style={styles.grille}>
            {vue.valorisation.metriques.map(m => (
              <Metrique key={m.libelle} libelle={m.libelle} valeur={m.valeur} />
            ))}
          </View>
        </CarteSection>
        <CarteSection titre="Historique du PER" poids={1.6}>
          {vue.valorisation.per.length > 1 ? (
            <GraphiqueLignes
              series={[{ nom: 'PER', couleur: palette.accent, points: vue.valorisation.per }]}
              formater={valeur => nombreFr(valeur, 1)}
              hauteur={220}
              repere={
                vue.valorisation.perMedian !== null
                  ? { valeur: vue.valorisation.perMedian, libelle: `Médiane : ${nombreFr(vue.valorisation.perMedian, 1)}` }
                  : undefined
              }
            />
          ) : (
            <Vide>Il faut un historique de cours et des bénéfices publiés pour tracer le PER.</Vide>
          )}
        </CarteSection>
      </Rangee>
    </>
  );
}

// ----------------------------------------------------------------- Société

function Societe({ vue }: { vue: VueFiche }) {
  const s = vue.societe;
  return (
    <>
      <Rangee>
        <CarteSection titre="Répartition du capital">
          {s.capital.length > 0 ? (
            <Donut parts={s.capital} formater={pourcent} hauteur={240} />
          ) : (
            <Vide>Répartition du capital non publiée.</Vide>
          )}
        </CarteSection>
        <CarteSection titre="Principaux actionnaires" poids={1.6}>
          <Tableau
            colonnes={[
              { cle: 'n', titre: 'Actionnaire', largeur: 200, extensible: 2, rendu: (l: (typeof s.actionnaires)[number]) => <Cellule gras>{l.nom}</Cellule> },
              { cle: 'p', titre: '% détenu', largeur: 90, alignement: 'droite', rendu: l => <Cellule>{l.part}</Cellule> },
              { cle: 'a', titre: 'Actions', largeur: 90, alignement: 'droite', rendu: l => <Cellule>{l.actions}</Cellule> },
              { cle: 'v', titre: 'Valeur', largeur: 100, alignement: 'droite', rendu: l => <Cellule>{l.valeur}</Cellule> },
              { cle: 'd', titre: 'Au', largeur: 100, alignement: 'droite', rendu: l => <Cellule>{l.date}</Cellule> },
            ]}
            lignes={s.actionnaires}
            cle={l => l.nom}
            vide="Aucun actionnaire publié."
          />
        </CarteSection>
      </Rangee>
      <CarteSection titre="Transactions d’initiés">
        <Tableau
          colonnes={[
            { cle: 'n', titre: 'Initié', largeur: 170, extensible: 1, rendu: (l: (typeof s.inities)[number]) => <Cellule gras>{l.nom}</Cellule> },
            { cle: 'f', titre: 'Fonction', largeur: 180, extensible: 1, rendu: l => <Cellule>{l.fonction}</Cellule> },
            { cle: 'o', titre: 'Opération', largeur: 200, extensible: 2, rendu: l => <Cellule>{l.operation}</Cellule> },
            { cle: 'a', titre: 'Actions', largeur: 90, alignement: 'droite', rendu: l => <Cellule>{l.actions}</Cellule> },
            { cle: 'v', titre: 'Valeur', largeur: 100, alignement: 'droite', rendu: l => <Cellule>{l.valeur}</Cellule> },
            { cle: 'd', titre: 'Date', largeur: 100, alignement: 'droite', rendu: l => <Cellule>{l.date}</Cellule> },
          ]}
          lignes={s.inities}
          cle={l => `${l.nom}-${l.date}-${l.actions}`}
          vide="Aucune transaction d’initié publiée."
        />
      </CarteSection>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: ESPACEMENT.m + 4, gap: ESPACEMENT.m, paddingBottom: ESPACEMENT.xl },
  barre: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  retour: { minHeight: 44, justifyContent: 'center' },
  entete: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESPACEMENT.m },
  logo: { width: 56, height: 56, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nom: { fontSize: 22, fontWeight: '800' },
  pillule: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  separateur: { width: 1, height: 40 },
  note: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  suivre: { borderRadius: 20, paddingHorizontal: ESPACEMENT.l, minHeight: 40, justifyContent: 'center' },
  centre: { alignItems: 'center', gap: ESPACEMENT.s, padding: ESPACEMENT.l },
  ongletsBarre: { borderBottomWidth: 1 },
  onglets: { gap: ESPACEMENT.l },
  onglet: { paddingVertical: ESPACEMENT.m - 4, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  blocs: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l },
  bloc: { minWidth: 200, flexGrow: 1, flexBasis: 200, gap: 6 },
  titreBloc: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  ligneInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: ESPACEMENT.s },
  grille: { flexDirection: 'row', flexWrap: 'wrap', rowGap: ESPACEMENT.m, columnGap: ESPACEMENT.l },
  champ: { borderWidth: 1, borderRadius: RAYON.s, paddingHorizontal: ESPACEMENT.m - 4, minHeight: 40, fontSize: 14 },
  source: { fontSize: 11, lineHeight: 16 },
});

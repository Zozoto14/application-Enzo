/**
 * Briques de l'Administration en mode téléphone : cadre d'écran avec retour, feuilles de choix
 * (remplacent les listes déroulantes), feuille de filtres, confirmation forte (saisie du nom), tuile
 * de chiffre. Tout est composé avec le socle `src/ui/mobile/` et le thème unique du hub.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  BoutonPrincipal,
  Cellule,
  ChampMobile,
  EcranMobile,
  EnTeteMobile,
  ESPACE,
  FeuilleBasse,
  GroupeCellules,
  TEXTE,
  rayonCarte,
  type ActionEnTete,
} from '../../../../ui/mobile';
import { police, type ThemeHub } from '../../../themes';

/** Écran de sous-page : en-tête « ‹ Parent » + titre, une colonne, pied collant. */
export function CadreAdmin({
  theme,
  titre,
  libelleRetour,
  onRetour,
  actions,
  pied,
  children,
  testID,
  testIDRetour,
}: {
  theme: ThemeHub;
  titre: string;
  libelleRetour: string;
  /** Absent : écran sans retour (identifiants affichés une seule fois). */
  onRetour?(): void;
  actions?: readonly ActionEnTete[];
  pied?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
  testIDRetour?: string;
}) {
  return (
    <EcranMobile
      theme={theme}
      testID={testID}
      onRetour={onRetour}
      pied={pied}
      entete={<EnTeteMobile theme={theme} titre={titre} onRetour={onRetour} libelleRetour={onRetour ? libelleRetour : undefined} actions={actions} testIDRetour={testIDRetour ?? 'admin-retour'} />}>
      {children}
    </EcranMobile>
  );
}

export interface OptionChoix {
  cle: string;
  titre: string;
  sousTitre?: string;
}

/** Feuille basse de choix unique (cellules à coche), avec recherche au-delà de 7 options. */
export function FeuilleChoix({
  theme,
  visible,
  titre,
  description,
  options,
  valeur,
  onChoisir,
  onFermer,
  testID = 'admin-choix',
}: {
  theme: ThemeHub;
  visible: boolean;
  titre: string;
  description?: string;
  options: readonly OptionChoix[];
  valeur: string | undefined;
  onChoisir(cle: string): void;
  onFermer(): void;
  testID?: string;
}) {
  const [recherche, setRecherche] = useState('');
  const avecRecherche = options.length > 7;
  const filtrees = recherche.trim() ? options.filter(o => `${o.titre} ${o.sousTitre ?? ''}`.toLowerCase().includes(recherche.trim().toLowerCase())) : options;
  return (
    <FeuilleBasse
      theme={theme}
      visible={visible}
      titre={titre}
      description={description}
      onFermer={() => {
        setRecherche('');
        onFermer();
      }}
      testID={testID}>
      {avecRecherche ? <ChampMobile theme={theme} etiquette="Rechercher" nature="recherche" value={recherche} onChangeText={setRecherche} testID={`${testID}-recherche`} /> : null}
      {filtrees.length === 0 ? (
        <Text style={{ color: theme.attenue, fontSize: TEXTE.corps, ...police(theme.policeTexte) }}>Aucun résultat.</Text>
      ) : (
        <GroupeCellules theme={theme}>
          {filtrees.map(o => (
            <Cellule
              key={o.cle}
              theme={theme}
              titre={o.titre}
              sousTitre={o.sousTitre}
              coche={o.cle === valeur}
              testID={`${testID}-${o.cle}`}
              onPress={() => {
                setRecherche('');
                onChoisir(o.cle);
              }}
            />
          ))}
        </GroupeCellules>
      )}
    </FeuilleBasse>
  );
}

/** Cellule qui affiche le choix courant et ouvre la feuille de choix. */
export function CelluleChoix({
  theme,
  titre,
  options,
  valeur,
  onChoisir,
  description,
  testID,
  sousTitre,
  desactive,
}: {
  theme: ThemeHub;
  titre: string;
  options: readonly OptionChoix[];
  valeur: string | undefined;
  onChoisir(cle: string): void;
  description?: string;
  testID: string;
  sousTitre?: string;
  desactive?: boolean;
}) {
  const [ouverte, setOuverte] = useState(false);
  const courant = options.find(o => o.cle === valeur);
  return (
    <>
      <Cellule theme={theme} titre={titre} sousTitre={sousTitre} valeur={courant?.titre} chevron desactive={desactive} onPress={() => setOuverte(true)} testID={testID} />
      <FeuilleChoix
        theme={theme}
        visible={ouverte}
        titre={titre}
        description={description}
        options={options}
        valeur={valeur}
        testID={`${testID}-feuille`}
        onFermer={() => setOuverte(false)}
        onChoisir={cle => {
          setOuverte(false);
          onChoisir(cle);
        }}
      />
    </>
  );
}

export interface ChampFiltre {
  id: string;
  libelle: string;
  valeur: string;
  options: readonly OptionChoix[];
}

/**
 * Feuille de filtres : une cellule par critère (valeur courante à droite) ; toucher un critère
 * affiche ses choix dans la même feuille (« ‹ Filtres » pour revenir). Pied : « Réinitialiser ».
 */
export function FeuilleFiltres({
  theme,
  visible,
  titre = 'Filtres',
  champs,
  onChoisir,
  onReinitialiser,
  onFermer,
  testID = 'admin-filtres',
  enfants,
}: {
  theme: ThemeHub;
  visible: boolean;
  titre?: string;
  champs: readonly ChampFiltre[];
  onChoisir(id: string, cle: string): void;
  onReinitialiser(): void;
  onFermer(): void;
  testID?: string;
  /** Champs libres sous les critères (dates…). */
  enfants?: React.ReactNode;
}) {
  const [etape, setEtape] = useState<string | undefined>();
  const [recherche, setRecherche] = useState('');
  const champ = champs.find(c => c.id === etape);
  const fermer = () => {
    setEtape(undefined);
    setRecherche('');
    onFermer();
  };
  const options = champ ? (recherche.trim() ? champ.options.filter(o => o.titre.toLowerCase().includes(recherche.trim().toLowerCase())) : champ.options) : [];
  return (
    <FeuilleBasse
      theme={theme}
      visible={visible}
      titre={champ ? champ.libelle : titre}
      onFermer={fermer}
      testID={testID}
      pied={
        champ ? undefined : (
          <>
            <BoutonPrincipal theme={theme} titre="Voir les résultats" onPress={fermer} testID={`${testID}-appliquer`} />
            <BoutonPrincipal theme={theme} variante="discret" titre="Réinitialiser les filtres" onPress={onReinitialiser} testID={`${testID}-reinitialiser`} />
          </>
        )
      }>
      {champ ? (
        <>
          <Cellule theme={theme} titre="‹ Filtres" onPress={() => { setEtape(undefined); setRecherche(''); }} testID={`${testID}-retour`} />
          {champ.options.length > 7 ? <ChampMobile theme={theme} etiquette="Rechercher" nature="recherche" value={recherche} onChangeText={setRecherche} testID={`${testID}-recherche`} /> : null}
          <GroupeCellules theme={theme}>
            {options.map(o => (
              <Cellule
                key={o.cle}
                theme={theme}
                titre={o.titre}
                coche={o.cle === champ.valeur}
                testID={`${testID}-${champ.id}-${o.cle}`}
                onPress={() => {
                  onChoisir(champ.id, o.cle);
                  setEtape(undefined);
                  setRecherche('');
                }}
              />
            ))}
          </GroupeCellules>
        </>
      ) : (
        <>
          <GroupeCellules theme={theme}>
            {champs.map(c => (
              <Cellule key={c.id} theme={theme} titre={c.libelle} valeur={c.options.find(o => o.cle === c.valeur)?.titre} chevron onPress={() => setEtape(c.id)} testID={`${testID}-${c.id}`} />
            ))}
          </GroupeCellules>
          {enfants}
        </>
      )}
    </FeuilleBasse>
  );
}

/**
 * Confirmation forte : feuille basse, texte d'explication, saisie du nom pour valider (si `mot`),
 * action destructrice en bas. Rien ne part sans cette saisie.
 */
export function FeuilleConfirmation({
  theme,
  visible,
  titre,
  description,
  mot,
  libelleAction,
  danger = true,
  desactive,
  onConfirmer,
  onFermer,
  enfants,
  testID = 'admin-confirmation',
  testIDAction = 'admin-confirmer',
}: {
  theme: ThemeHub;
  visible: boolean;
  titre: string;
  description: string;
  /** Texte à saisir pour valider (le prénom du compte). */
  mot?: string;
  libelleAction: string;
  danger?: boolean;
  desactive?: boolean;
  onConfirmer(): void;
  onFermer(): void;
  enfants?: React.ReactNode;
  testID?: string;
  testIDAction?: string;
}) {
  const [saisie, setSaisie] = useState('');
  const fermer = () => {
    setSaisie('');
    onFermer();
  };
  const valide = mot === undefined || saisie.trim() === mot;
  return (
    <FeuilleBasse
      theme={theme}
      visible={visible}
      titre={titre}
      onFermer={fermer}
      testID={testID}
      pied={
        <>
          <BoutonPrincipal
            theme={theme}
            variante={danger ? 'danger' : 'plein'}
            titre={libelleAction}
            desactive={!valide || desactive}
            testID={testIDAction}
            onPress={() => {
              setSaisie('');
              onConfirmer();
            }}
          />
          <BoutonPrincipal theme={theme} variante="discret" titre="Annuler" onPress={fermer} testID={`${testID}-annuler`} />
        </>
      }>
      <Text style={{ color: theme.texte, fontSize: TEXTE.corps, lineHeight: 24, ...police(theme.policeTexte) }}>{description}</Text>
      {mot !== undefined ? <ChampMobile theme={theme} etiquette={`Pour confirmer, saisissez « ${mot} »`} value={saisie} onChangeText={setSaisie} nature="prenom" autoCapitalize="none" enterKeyHint="done" testID={`${testID}-nom`} /> : null}
      {enfants}
    </FeuilleBasse>
  );
}

/** Tuile de chiffre clé (2 par ligne), toute la tuile est un bouton si `onPress`. */
export function TuileChiffre({ theme, libelle, valeur, onPress, testID }: { theme: ThemeHub; libelle: string; valeur: number | string; onPress?(): void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${libelle} : ${valeur}`}
      disabled={!onPress}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: '45%',
        minHeight: 84,
        padding: ESPACE.m,
        gap: 2,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.ligne,
        backgroundColor: theme.surface,
        borderRadius: rayonCarte(theme),
      }}>
      <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>{libelle}</Text>
      <Text style={{ color: theme.texte, fontSize: 30, fontWeight: theme.poidsTitre === '400' ? '600' : theme.poidsTitre, ...police(theme.policeChiffres) }}>{valeur}</Text>
    </Pressable>
  );
}

/** Texte d'aide ou de contexte (15 px, atténué). */
export function Aide({ theme, children, testID }: { theme: ThemeHub; children: React.ReactNode; testID?: string }) {
  return (
    <Text testID={testID} style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, paddingHorizontal: ESPACE.xxs, ...police(theme.policeTexte) }}>
      {children}
    </Text>
  );
}

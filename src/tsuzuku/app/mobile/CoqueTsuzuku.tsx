/**
 * Coque de Tsuzuku sur téléphone.
 *
 *  - écrans de premier niveau (Accueil, Catalogue, Bibliothèque) : en-tête compact « ‹ Accueil »
 *    (synchro, Réglages), sélecteur Animés | Films collé en haut (l'accent change), UNE colonne qui
 *    défile, pied de page honnête en fin de défilement, barre basse Accueil · Catalogue ·
 *    Bibliothèque · Plus ;
 *  - écrans plein cadre (fiche, lecteur, import) : ils posent eux-mêmes leur en-tête « ‹ Retour »,
 *    leur action principale collée en bas, et n'ont pas de barre basse (le pouce sert au contenu).
 *
 * L'état (mode, pile d'écrans) est tenu par `Racine.tsx` : tourner le téléphone ne ramène pas à l'accueil.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RetourHub } from '../../../hub/Hub';
import type { ThemeHub } from '../../../hub/themes';
import type { PropsRacineApp } from '../../../hub/types';
import { BarreOnglets, type EntreeOnglet } from '../../../ui/mobile/BarreOnglets';
import { EcranMobile } from '../../../ui/mobile/EcranMobile';
import { FeuilleBasse } from '../../../ui/mobile/FeuilleBasse';
import { ESPACE, GOUTTIERE } from '../../../ui/mobile/jetons';
import { Cellule, GroupeCellules } from '../../../ui/mobile/ListeCellules';
import { margesSecurite } from '../../../ui/mobile/ZoneSecurite';
import { MESSAGE_SITE } from '../../plateforme/reseauWeb';
import { useTsuzuku, type Route } from '../contexte';
import { PiedTsuzuku } from '../PiedTsuzuku';
import type { Mode } from '../themeTsuzuku';
import { Avis } from '../ui';
import { SelecteurModeMobile } from './ElementsMobile';

const ENTREES: readonly EntreeOnglet[] = [
  { cle: 'accueil', libelle: 'Accueil', glyphe: '⌂', description: 'Accueil de Tsuzuku' },
  { cle: 'catalogue', libelle: 'Catalogue', glyphe: '⌕', description: 'Catalogue et recherche' },
  { cle: 'bibliotheque', libelle: 'Bibliothèque', glyphe: '▤', description: 'Ma bibliothèque' },
  { cle: 'plus', libelle: 'Plus', glyphe: '☰', description: 'Plus : réglages, import, mentions légales' },
];

/** Routes qui posent leur propre en-tête et leur pied (pas de coque autour). */
const PLEIN_CADRE: ReadonlySet<Route['t']> = new Set(['fiche', 'lecteur', 'import']);

export function CoqueTsuzukuMobile({
  theme,
  themeHub,
  mode,
  route,
  ongletActif,
  peutRevenir,
  estAdmin,
  siteSeulement,
  onRetourHub,
  onParametres,
  choisirMode,
  onglet,
  retour,
  children,
}: {
  theme: ThemeHub;
  themeHub: ThemeHub;
  mode: Mode;
  route: Route;
  ongletActif: Route['t'];
  peutRevenir: boolean;
  estAdmin: boolean;
  siteSeulement: boolean;
  onRetourHub(): void;
  onParametres?: PropsRacineApp['onParametres'];
  choisirMode(m: Mode): void;
  onglet(t: Route['t']): void;
  retour(): void;
  children: React.ReactNode;
}) {
  const { aller } = useTsuzuku();
  const [plus, setPlus] = useState(false);
  const plein = PLEIN_CADRE.has(route.t);
  const choisir = (cle: string) => (cle === 'plus' ? setPlus(true) : onglet(cle as Route['t']));
  const ouvrirParametres = (section: 'tsuzuku' | 'apropos') => {
    setPlus(false);
    onParametres?.(section);
  };

  return (
    <View style={[st.racine, { backgroundColor: theme.fond }]} testID="tsuzuku-racine">
      {plein ? (
        <View style={st.racine} testID={`ecran-${route.t}`}>
          {children}
        </View>
      ) : (
        <>
          <EcranMobile
            theme={theme}
            onRetour={peutRevenir ? retour : undefined}
            entete={
              <View style={[margesSecurite(['haut']), st.entete, { backgroundColor: theme.fond, borderBottomColor: theme.ligne }]} testID="tsuzuku-entete">
                <RetourHub theme={themeHub} onRetour={onRetourHub} titre="Tsuzuku" />
                <SelecteurModeMobile mode={mode} themeHub={themeHub} onChoisir={choisirMode} />
              </View>
            }>
            {siteSeulement ? <Avis texte={MESSAGE_SITE} testID="tsuzuku-site" /> : null}
            <View testID={`ecran-${route.t}`} style={{ gap: ESPACE.m }}>
              {children}
            </View>
            <PiedTsuzuku theme={theme} onEnSavoirPlus={onParametres ? () => ouvrirParametres('apropos') : undefined} />
          </EcranMobile>
          <BarreOnglets theme={theme} entrees={ENTREES} actif={plus ? 'plus' : ongletActif} onChoisir={choisir} testID="onglet-app" />
        </>
      )}
      <FeuilleBasse theme={theme} visible={plus} titre="Plus" onFermer={() => setPlus(false)} testID="tsuzuku-plus">
        <GroupeCellules theme={theme}>
          {onParametres ? <Cellule theme={theme} glyphe="⚙︎" titre="Réglages de Tsuzuku" sousTitre="Doublage, épisode suivant, sources partagées" chevron onPress={() => ouvrirParametres('tsuzuku')} testID="tsuzuku-reglages" /> : null}
          {estAdmin ? (
            <Cellule
              theme={theme}
              glyphe="⇪"
              titre="Importer ma bibliothèque"
              sousTitre="Depuis l’ancien Tsuzuku"
              chevron
              onPress={() => {
                setPlus(false);
                aller({ t: 'import' });
              }}
              testID="plus-importer"
            />
          ) : null}
          {onParametres ? <Cellule theme={theme} glyphe="§" titre="Mentions légales" sousTitre="Conditions d’utilisation et droit d’auteur" chevron onPress={() => ouvrirParametres('apropos')} testID="plus-mentions" /> : null}
          <Cellule
            theme={theme}
            glyphe="‹"
            titre="Retour au hub"
            chevron
            onPress={() => {
              setPlus(false);
              onRetourHub();
            }}
            testID="plus-hub"
          />
        </GroupeCellules>
      </FeuilleBasse>
    </View>
  );
}

const st = StyleSheet.create({
  racine: { flex: 1 },
  entete: { paddingHorizontal: GOUTTIERE, paddingBottom: ESPACE.xs, gap: ESPACE.xxs, borderBottomWidth: StyleSheet.hairlineWidth },
});

/**
 * Coque de navigation du mode téléphone, au niveau du hub.
 *
 * Barre basse retenue (4 entrées) :
 *
 *     ⌂ Accueil   ·   ? Support   ·   ⚙ Réglages   ·   ◉ Compte
 *
 *  - Accueil : le hub (changer d'app = revenir ici) ;
 *  - Support : écrire à l'équipe ;
 *  - Réglages : LA page Paramètres (liste → sous-pages) ;
 *  - Compte : feuille basse avec l'état de synchronisation détaillé (« Synchroniser maintenant »),
 *    le compte ouvert, « Changer de compte » et « Verrouiller ». Sa pastille prend la couleur de la
 *    synchro (point orange : en attente, rouge : erreur).
 *
 * L'hôte (App.tsx) fournit les actions par `NavigationMobileContexte` ; chaque page de premier niveau
 * (hub, Paramètres, Support) pose `<BarreBasseHub actif="…" />` en bas d'elle-même. Les apps (Portefeuille,
 * Administration, Tsuzuku) ont leur propre barre basse : leurs sections (voir docs/mobile/guide-ecrans.md).
 */

import React, { createContext, useContext, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IndicateurSynchro, type SynchroHub } from '../../hub/IndicateurSynchro';
import { resumerSynchro } from '../../hub/etatSynchro';
import { police, type ThemeHub } from '../../hub/themes';
import { BarreOnglets, type EntreeOnglet } from './BarreOnglets';
import { FeuilleBasse } from './FeuilleBasse';
import { ESPACE, TEXTE, themeActif } from './jetons';
import { Cellule, GroupeCellules } from './ListeCellules';

export interface NavigationMobile {
  theme: ThemeHub;
  onAccueil(): void;
  onSupport?(): void;
  onParametres(): void;
  onVerrouiller?(): void;
  onChangerProfil?(): void;
  synchro?: SynchroHub;
  /** Nom du compte ouvert. */
  compte?: string;
  /** Recharger l'app (site : vide les caches) ; absent ailleurs. */
  onRecharger?(): void;
}

export const NavigationMobileContexte = createContext<NavigationMobile | undefined>(undefined);

export function useNavigationMobile(): NavigationMobile | undefined {
  return useContext(NavigationMobileContexte);
}

export type EntreeHub = 'accueil' | 'support' | 'parametres' | 'compte';

/** Entrées de la barre basse du hub (pures, testées). */
export function entreesBarreHub(nav: Pick<NavigationMobile, 'onSupport' | 'synchro'>, maintenant = Date.now()): EntreeOnglet[] {
  const niveau = nav.synchro ? resumerSynchro(nav.synchro.vue, maintenant).niveau : undefined;
  return [
    { cle: 'accueil', libelle: 'Accueil', glyphe: '⌂', description: 'Accueil : toutes les apps' },
    ...(nav.onSupport ? [{ cle: 'support', libelle: 'Support', glyphe: '?', description: 'Support : écrire à l’équipe' }] : []),
    { cle: 'parametres', libelle: 'Réglages', glyphe: '⚙︎', description: 'Paramètres' },
    {
      cle: 'compte',
      libelle: 'Compte',
      glyphe: '◉',
      description: `Compte, synchronisation et verrouillage${niveau === 'erreur' ? ' (synchronisation impossible)' : niveau === 'attente' ? ' (envoi en attente)' : ''}`,
      pastille: niveau === 'erreur' || niveau === 'attente' ? '•' : undefined,
    },
  ];
}

export function BarreBasseHub({ actif }: { actif?: EntreeHub }) {
  const nav = useNavigationMobile();
  const [compteOuvert, setCompteOuvert] = useState(false);
  if (!nav) {
    return null;
  }
  const theme = nav.theme;
  const entrees = entreesBarreHub(nav).map(e =>
    e.cle === 'compte' && e.pastille ? { ...e, couleurPastille: resumerSynchro(nav.synchro!.vue, Date.now()).niveau === 'erreur' ? theme.critique : theme.alerte } : e,
  );
  const choisir = (cle: string) => {
    if (cle === 'accueil') nav.onAccueil();
    else if (cle === 'support') nav.onSupport?.();
    else if (cle === 'parametres') nav.onParametres();
    else if (cle === 'compte') setCompteOuvert(true);
  };
  return (
    <>
      <BarreOnglets theme={theme} entrees={entrees} actif={compteOuvert ? 'compte' : actif} onChoisir={choisir} />
      <FeuilleCompte nav={nav} visible={compteOuvert} onFermer={() => setCompteOuvert(false)} />
    </>
  );
}

export function FeuilleCompte({ nav, visible, onFermer }: { nav: NavigationMobile; visible: boolean; onFermer(): void }) {
  const theme = themeActif(nav.theme);
  const fermerPuis = (action?: () => void) => () => {
    onFermer();
    action?.();
  };
  return (
    <FeuilleBasse theme={theme} visible={visible} titre="Compte" onFermer={onFermer} testID="feuille-compte">
      {nav.compte ? (
        <View style={styles.compte}>
          <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
            <Text style={{ color: theme.surAccent, fontSize: 20, fontWeight: '800' }}>{nav.compte.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>Compte ouvert</Text>
            <Text testID="feuille-compte-nom" style={{ color: theme.texte, fontSize: TEXTE.section, fontWeight: '700', ...police(theme.policeTexte) }} numberOfLines={1}>
              {nav.compte}
            </Text>
          </View>
        </View>
      ) : null}
      {nav.synchro ? (
        <View style={[styles.synchro, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonGrand, 20) }]}>
          <IndicateurSynchro theme={theme} synchro={nav.synchro} detaille />
        </View>
      ) : null}
      <GroupeCellules theme={theme}>
        {nav.onChangerProfil ? <Cellule theme={theme} titre="Changer de compte" glyphe="⇄" chevron onPress={fermerPuis(nav.onChangerProfil)} testID="feuille-compte-changer" /> : null}
        {nav.onRecharger ? <Cellule theme={theme} titre="Recharger l’app" sousTitre="Récupère la dernière version publiée." glyphe="⟳" onPress={fermerPuis(nav.onRecharger)} testID="feuille-compte-recharger" /> : null}
        {nav.onVerrouiller ? <Cellule theme={theme} titre="Verrouiller" glyphe="⏻" teinte={theme.critique} danger onPress={fermerPuis(nav.onVerrouiller)} testID="feuille-compte-verrouiller" /> : null}
      </GroupeCellules>
    </FeuilleBasse>
  );
}

const styles = StyleSheet.create({
  compte: { flexDirection: 'row', alignItems: 'center', gap: ESPACE.s, paddingVertical: ESPACE.xxs },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  synchro: { borderWidth: StyleSheet.hairlineWidth, padding: ESPACE.m },
});

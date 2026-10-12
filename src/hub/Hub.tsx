/**
 * Le hub : l'écran d'arrivée après le déverrouillage. Une grille de tuiles,
 * une par app ouverte au profil, d'après le registre. Mise en page et thèmes
 * repris de la maquette (hub-mockup.html).
 *
 * « Personnaliser » passe le hub en mode édition : chaque tuile reçoit sa
 * barre d'outils (déplacer, taille, épingler, masquer), on peut aussi la
 * glisser-déposer sur le web, et l'aperçu est la vraie mise en page, en
 * direct. Les préférences (`PrefsHub`) ne servent qu'à ordonner et mettre en
 * forme les apps déjà autorisées : elles ne peuvent en montrer aucune autre.
 */

import { BandeauAbonnement } from './abonnements/BandeauAbonnement';
import { ID_ABONNEMENTS } from './abonnements/actionsAbo';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { etatTuile, type EtatTuile } from './permissions';
import { PAGES_HUB, appsDePage, pageEffective, pagesVisibles } from './pages';
import { BoutonMiseAJour, useMiseAJour } from './ParametresHub';
import { useBarreApp } from './BarreApp';
import type { IdSection } from './recensement';
import { IndicateurSynchro, type SynchroHub } from './IndicateurSynchro';
import { salutation } from './infos';
import { LogoHub } from './LogoHub';
import {
  LIBELLES_TAILLE,
  TAILLES,
  appliquerPrefs,
  basculerEpinglee,
  basculerMasquee,
  definirDensite,
  definirDisposition,
  definirTaille,
  deplacer,
  deplacerVers,
  empan,
  reinitialiser,
  sontParDefaut,
  type PrefsHub,
  type TailleTuile,
  type TuilePrefs,
} from './personnalisation';
import { THEMES_HUB, police, teinteTransparente, type IdThemeHub, type ThemeHub } from './themes';
import { ecouterTouche, mouvementReduit, surLeWeb } from './web';
import { useMobile } from '../ui/mobile/useMobile';
import { HubMobile } from './HubMobile';
import { BoutonIcone } from '../ui/mobile/EnTeteMobile';
import { useNavigationMobile } from '../ui/mobile/NavigationMobile';
import type { AppHub, CategorieApp, ContexteHub, InfoLive } from './types';

export interface HubProps {
  registre: readonly AppHub[];
  contexte: ContexteHub;
  theme: ThemeHub;
  onTheme(id: IdThemeHub): void;
  onOuvrir(id: string): void;
  /** Personnalisation du profil ; absente : le hub ne se personnalise pas. */
  prefs?: PrefsHub;
  onPrefs?(prefs: PrefsHub): void;
  onVerrouiller?(): void;
  /** Revenir à « Qui utilise AppDashboard ? », quand il y a plusieurs profils. */
  onChangerProfil?(): void;
  /** Ouvre la page Paramètres (unique, pour tout le hub), sur une section. */
  onParametres?(section?: IdSection): void;
  /** Ouvre la page Support (ticket vers l'équipe) ; absent : pas de bouton. */
  onSupport?(): void;
  /** État de la synchronisation PC ↔ site ; absent : pas d'indicateur (compte non relié). */
  synchro?: SynchroHub;
  /**
   * Demande d'ouverture venue d'ailleurs (« Essayer » du devblog) : la
   * page Paramètres ou le mode personnalisation. Le compteur la rend unique.
   */
  demande?: { genre: 'parametres' | 'personnaliser'; n: number };
  /** Heure locale, injectable pour les tests. */
  heure?: number;
  /**
   * Page affichée (« Applications » ou « Administration », voir `pages.ts`),
   * tenue par l'hôte pour qu'elle survive à l'ouverture d'une app. Absente :
   * le hub la tient lui-même.
   */
  page?: CategorieApp;
  onPage?(page: CategorieApp): void;
}

/** Page courante du hub : celle de l'hôte, sinon un état local ; jamais une page non permise. */
export function usePageHub(registre: readonly AppHub[], contexte: ContexteHub, page?: CategorieApp, onPage?: (page: CategorieApp) => void) {
  const [locale, setLocale] = useState<CategorieApp>('publique');
  const pages = pagesVisibles(registre, contexte);
  const courante = pageEffective(page ?? locale, pages);
  const choisir = (suivante: CategorieApp) => (onPage ? onPage(suivante) : setLocale(suivante));
  return { pages, page: courante, choisir };
}

/** Phrase d'accroche quand la page n'a aucune app. */
export function accrochePageVide(page: CategorieApp, pages: readonly CategorieApp[]): string {
  if (page === 'administration') return 'Aucune app d’administration ne vous est ouverte.';
  return pages.includes('administration')
    ? 'Aucune app publique ne vous est encore ouverte : vos outils sont dans l’onglet Administration.'
    : 'Aucune app ne vous est encore ouverte : demandez à l’administrateur de cet appareil.';
}

type EtatPresse = { pressed: boolean; hovered?: boolean; focused?: boolean };

const SUR_LE_WEB = surLeWeb();
/**
 * Rappel « Échap » : seulement là où un clavier est probable (souris ou pavé tactile). Sur une
 * tablette ou un téléphone (pointeur tactile seul), la touche n'existe pas : on ne l'annonce pas.
 */
const CLAVIER_PROBABLE =
  SUR_LE_WEB &&
  !(globalThis as { matchMedia?: (requete: string) => { matches: boolean } }).matchMedia?.('(hover: none) and (pointer: coarse)').matches;

function colonnesPour(largeur: number): number {
  return largeur >= 1100 ? 4 : largeur >= 820 ? 3 : largeur >= 560 ? 2 : 1;
}

/** Transitions CSS des tuiles : le réordonnancement et les changements de taille glissent. */
const TRANSITION_WEB: object = SUR_LE_WEB
  ? { transitionProperty: 'width, opacity, transform, min-height', transitionDuration: '260ms', transitionTimingFunction: 'ease' }
  : {};

/**
 * Aiguille : le hub du téléphone (`HubMobile`) ou celui du bureau, selon `useMobile()`. Les deux
 * versions ont leurs propres hooks : on ne branche jamais les hooks d'un même composant sur le mode.
 */
export function Hub(props: HubProps) {
  return useMobile() ? <HubMobile {...props} /> : <HubBureau {...props} />;
}

function HubBureau({ registre, contexte, theme, onTheme, onOuvrir, prefs, onPrefs, onVerrouiller, onChangerProfil, onParametres, onSupport, synchro, demande, heure, page: pageDemandee, onPage }: HubProps) {
  const { width } = useWindowDimensions();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const maj = useMiseAJour();
  const [edition, setEdition] = useState(false);
  const [annonce, setAnnonce] = useState('');
  const glisse = useRef<string | undefined>(undefined);
  const personnalisable = Boolean(prefs && onPrefs);
  useEffect(() => {
    if (!demande) {
      return;
    }
    if (demande.genre === 'parametres') {
      onParametres?.();
    } else if (personnalisable) {
      setEdition(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule une nouvelle demande compte.
  }, [demande?.n]);
  const modifie = edition && personnalisable;
  const courantes = prefs ?? reinitialiser();
  const { pages, page, choisir: choisirPage } = usePageHub(registre, contexte, pageDemandee, onPage);
  const autorisees = appsDePage(registre, contexte, page);
  const tuiles = appliquerPrefs(autorisees, courantes);
  const affichees = modifie ? tuiles : tuiles.filter(tuile => !tuile.masquee);
  const masquees = tuiles.filter(tuile => tuile.masquee).length;
  const ids = tuiles.map(tuile => tuile.app.id);
  const colonnes = colonnesPour(width);
  const liste = courantes.disposition === 'liste';
  const compact = courantes.densite === 'compact';
  const titre = salutation(heure ?? new Date().getHours(), contexte.profil?.nom);
  const [debut, nom] = titre.includes(', ') ? titre.split(', ') : [titre.replace(/\.$/, ''), undefined];

  const changer = (suivant: PrefsHub, message?: string) => {
    onPrefs?.(suivant);
    if (message) {
      setAnnonce(message);
    }
  };

  // Échap ferme d'abord le menu des thèmes, puis le mode édition.
  useEffect(() => {
    if (!menuOuvert && !edition) {
      return undefined;
    }
    return ecouterTouche('Escape', () => {
      if (menuOuvert) {
        setMenuOuvert(false);
      } else {
        setEdition(false);
      }
    });
  }, [menuOuvert, edition]);

  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const titreStyle = {
    color: theme.texte,
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
    ...police(theme.policeTitre),
  };

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub">
      <ScrollView contentContainerStyle={styles.defilement}>
        <View style={[styles.page, compact && { paddingTop: 20, paddingBottom: 32 }]}>
          <View style={[styles.entete, { zIndex: 10 }]}>
            <View style={styles.marque}>
              <LogoHub taille={32} fond={theme.accent} trait={theme.surAccent} rayon={Math.min(theme.rayonMoyen, 10)} testID="hub-logo" />
              <Text style={[titreStyle, { fontSize: 16 }]}>AppDashboard</Text>
            </View>
            <View style={styles.actionsEntete}>
              {synchro ? <IndicateurSynchro theme={theme} synchro={synchro} onPress={() => onParametres?.('synchro')} /> : null}
              {personnalisable ? (
                <BoutonHub
                  theme={theme}
                  titre={edition ? '✓ Terminé' : '✎ Personnaliser'}
                  variante={edition ? 'plein' : 'normal'}
                  testID={edition ? 'hub-edition-termine' : 'hub-personnaliser'}
                  onPress={() => {
                    setMenuOuvert(false);
                    setEdition(e => !e);
                  }}
                />
              ) : null}
              <BoutonMiseAJour theme={theme} maj={maj} />
              <BoutonHub
                theme={theme}
                titre={width >= 520 ? '⚙︎ Paramètres' : '⚙︎'}
                testID="hub-parametres-ouvrir"
                libelle="Paramètres du hub"
                onPress={() => {
                  setMenuOuvert(false);
                  onParametres?.();
                }}
              />
              {onSupport ? (
                <BoutonHub
                  theme={theme}
                  titre={width >= 520 ? '? Support' : '?'}
                  testID="hub-support-ouvrir"
                  libelle="Support : écrire à l’équipe"
                  onPress={() => {
                    setMenuOuvert(false);
                    onSupport();
                  }}
                />
              ) : null}
              <SelecteurTheme theme={theme} ouvert={menuOuvert} onBasculer={() => setMenuOuvert(o => !o)} onChoisir={id => {
                setMenuOuvert(false);
                onTheme(id);
              }} />
              {onChangerProfil ? (
                <BoutonHub theme={theme} titre="Changer de compte" onPress={onChangerProfil} testID="hub-changer-profil" />
              ) : null}
              {onVerrouiller ? (
                <BoutonHub theme={theme} titre="⏻ Verrouiller" onPress={onVerrouiller} testID="hub-verrouiller" />
              ) : null}
            </View>
          </View>

          <View style={[styles.intro, compact && { marginTop: 24, marginBottom: 16 }]}>
            <Text style={[titreStyle, styles.salut, compact && { fontSize: 32, lineHeight: 38 }]} accessibilityRole="header">
              {debut}
              {nom ? (
                <>
                  ,{compact ? ' ' : '\n'}
                  <Text style={{ color: theme.accent }}>{nom}</Text>
                </>
              ) : (
                '.'
              )}
            </Text>
            {!compact || modifie ? (
              <Text style={[texte, styles.accroche, { color: theme.attenue }]}>
                {modifie
                  ? 'Mode personnalisation : réordonnez, redimensionnez, épinglez ou masquez vos tuiles. L’aperçu est en direct.'
                  : autorisees.length === 0
                    ? accrochePageVide(page, pages)
                    : page === 'administration'
                      ? 'Les apps réservées à l’administration de ce hub.'
                      : 'Reprenez là où vous en étiez.'}
              </Text>
            ) : null}
          </View>

          {pages.length > 1 ? <OngletsPages theme={theme} pages={pages} page={page} onChoisir={choisirPage} /> : null}

          {modifie ? null : <BandeauAbonnement contexte={contexte} theme={theme} onOuvrirAbonnements={() => onOuvrir(ID_ABONNEMENTS)} />}

          {modifie ? (
            <BarrePersonnalisation
              theme={theme}
              prefs={courantes}
              onChanger={changer}
              onTerminer={() => setEdition(false)}
            />
          ) : null}

          <View style={styles.grille} accessibilityLabel={PAGES_HUB.find(p => p.id === page)?.libelle ?? 'Applications'} testID={`hub-grille-${page}`}>
            {affichees.map(tuile => (
              <Cellule
                key={tuile.app.id}
                tuile={tuile}
                theme={theme}
                colonnes={colonnes}
                liste={liste}
                compact={compact}
                edition={modifie}
                contexte={contexte}
                position={ids.indexOf(tuile.app.id)}
                total={ids.length}
                onOuvrir={() => onOuvrir(tuile.app.id)}
                onDeplacer={delta => {
                  const suivant = deplacer(courantes, ids, tuile.app.id, delta);
                  changer(suivant, suivant === courantes ? undefined : `${tuile.app.nom} déplacée.`);
                }}
                onTaille={taille => changer(definirTaille(courantes, tuile.app.id, taille), `${tuile.app.nom} : taille ${LIBELLES_TAILLE[taille].toLowerCase()}.`)}
                onEpingler={() =>
                  changer(
                    basculerEpinglee(courantes, ids, tuile.app.id, !tuile.epinglee),
                    tuile.epinglee ? `${tuile.app.nom} n’est plus épinglée.` : `${tuile.app.nom} épinglée en premier.`,
                  )
                }
                onMasquer={() =>
                  changer(basculerMasquee(courantes, tuile.app.id, !tuile.masquee), tuile.masquee ? `${tuile.app.nom} affichée.` : `${tuile.app.nom} masquée.`)
                }
                glisse={glisse}
                onDeposer={cible => changer(deplacerVers(courantes, ids, glisse.current ?? '', cible))}
              />
            ))}
            {page === 'publique' && (!liste || !modifie) ? (
              <View style={[styles.cellule, { width: liste ? '100%' : `${100 / colonnes}%` }]}>
                <TuileNouvelle theme={theme} compact={compact} liste={liste} />
              </View>
            ) : null}
          </View>

          {!modifie && masquees > 0 && personnalisable ? (
            <Text style={[texte, styles.pied, { color: theme.attenue }]} testID="hub-masquees">
              {masquees} tuile{masquees > 1 ? 's' : ''} masquée{masquees > 1 ? 's' : ''} : « Personnaliser » permet de les réafficher.
            </Text>
          ) : null}

          {CLAVIER_PROBABLE ? (
            <Text style={[texte, styles.pied, { color: theme.attenue }]}>
              Appuyez sur Échap pour revenir au Hub depuis n’importe quelle app.
            </Text>
          ) : null}
          <Text accessibilityLiveRegion="polite" style={styles.annonce} testID="hub-annonce">
            {annonce}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Onglets « Applications · Administration » en haut du hub (bureau). Le
 * second n'est rendu que si l'hôte le permet (`pagesVisibles`).
 */
function OngletsPages({ theme, pages, page, onChoisir }: { theme: ThemeHub; pages: readonly CategorieApp[]; page: CategorieApp; onChoisir(page: CategorieApp): void }) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  return (
    <View style={[styles.pages, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="tablist" accessibilityLabel="Pages du hub" testID="hub-pages">
      {PAGES_HUB.filter(p => pages.includes(p.id)).map(p => {
        const actif = p.id === page;
        return (
          <Pressable
            key={p.id}
            testID={`hub-page-${p.id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: actif }}
            aria-selected={actif}
            accessibilityLabel={p.description}
            onPress={() => onChoisir(p.id)}
            style={(etat: EtatPresse) => [
              styles.pageOnglet,
              { backgroundColor: actif ? theme.accent : etat.hovered ? teinteTransparente(theme.accent, 0.1) : 'transparent', borderRadius: Math.max(rayon - 3, 0) },
            ]}>
            <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: actif ? '700' : '600', fontSize: 15, ...police(theme.policeTexte) }}>
              {p.glyphe} {p.libelle}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Barre du mode édition : densité, disposition, réinitialisation. */
function BarrePersonnalisation({
  theme,
  prefs,
  onChanger,
  onTerminer,
}: {
  theme: ThemeHub;
  prefs: PrefsHub;
  onChanger(prefs: PrefsHub, annonce?: string): void;
  onTerminer(): void;
}) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  const groupe = <T extends string>(
    libelle: string,
    valeur: T,
    options: ReadonlyArray<readonly [T, string]>,
    onChoisir: (v: T) => void,
    testID: string,
  ) => (
    <View style={styles.groupe}>
      <Text style={[styles.libelleGroupe, { color: theme.attenue }]}>{libelle.toUpperCase()}</Text>
      <View style={[styles.segments, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup">
        {options.map(([cle, texte]) => {
          const actif = cle === valeur;
          return (
            <Pressable
              key={cle}
              testID={`${testID}-${cle}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={`${libelle} : ${texte}`}
              onPress={() => onChoisir(cle)}
              style={[styles.segment, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{texte}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  return (
    <View
      testID="hub-barre-edition"
      style={[styles.barreEdition, { backgroundColor: theme.surface, borderColor: theme.accent, borderRadius: theme.rayonMoyen }]}>
      {groupe('Disposition', prefs.disposition, [['grille', '▦ Grille'], ['liste', '☰ Liste']] as const, valeur => onChanger(definirDisposition(prefs, valeur), `Disposition : ${valeur}.`), 'hub-disposition')}
      {groupe('Densité', prefs.densite, [['aere', 'Aéré'], ['compact', 'Compact']] as const, valeur => onChanger(definirDensite(prefs, valeur), `Densité : ${valeur === 'aere' ? 'aérée' : 'compacte'}.`), 'hub-densite')}
      <View style={styles.actionsBarre}>
        <BoutonHub
          theme={theme}
          titre="Réinitialiser"
          testID="hub-reinitialiser"
          desactive={sontParDefaut(prefs)}
          onPress={() => onChanger(reinitialiser(), 'Disposition par défaut rétablie.')}
        />
        <BoutonHub theme={theme} variante="plein" titre="Terminé" testID="hub-terminer" onPress={onTerminer} />
      </View>
    </View>
  );
}

/** Une cellule de la grille : barre d'outils (édition) + tuile, animées. */
function Cellule({
  tuile,
  theme,
  colonnes,
  liste,
  compact,
  edition,
  contexte,
  position,
  total,
  onOuvrir,
  onDeplacer,
  onTaille,
  onEpingler,
  onMasquer,
  glisse,
  onDeposer,
}: {
  tuile: TuilePrefs<AppHub>;
  theme: ThemeHub;
  colonnes: number;
  liste: boolean;
  compact: boolean;
  edition: boolean;
  contexte: ContexteHub;
  position: number;
  total: number;
  onOuvrir(): void;
  onDeplacer(delta: number): void;
  onTaille(taille: TailleTuile): void;
  onEpingler(): void;
  onMasquer(): void;
  glisse: React.MutableRefObject<string | undefined>;
  onDeposer(cibleId: string): void;
}) {
  const { app, taille, masquee, epinglee } = tuile;
  const largeur = liste ? '100%' : `${(100 * empan(taille, colonnes)) / colonnes}%`;
  const noeud = useRef<unknown>(null);
  const [survol, setSurvol] = useState(false);
  const entree = useRef(new Animated.Value(mouvementReduit() ? 1 : 0)).current;
  const deposer = useRef(onDeposer);
  deposer.current = onDeposer;
  const deplacement = useRef(onDeplacer);
  deplacement.current = onDeplacer;

  useEffect(() => {
    Animated.timing(entree, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [entree]);

  // Glisser-déposer (web) et Alt + flèches : le clavier a les mêmes moyens que la souris.
  useEffect(() => {
    const element = noeud.current as HTMLElementWeb | null;
    if (!SUR_LE_WEB || !edition || !element || typeof element.addEventListener !== 'function') {
      return undefined;
    }
    element.setAttribute('draggable', 'true');
    const debut = (e: EvenementWeb) => {
      glisse.current = app.id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', app.id);
      }
    };
    const dessus = (e: EvenementWeb) => {
      if (glisse.current && glisse.current !== app.id) {
        e.preventDefault();
        setSurvol(true);
      }
    };
    const quitte = () => setSurvol(false);
    const depose = (e: EvenementWeb) => {
      e.preventDefault();
      setSurvol(false);
      if (glisse.current && glisse.current !== app.id) {
        deposer.current(app.id);
      }
      glisse.current = undefined;
    };
    const fin = () => {
      glisse.current = undefined;
      setSurvol(false);
    };
    const touche = (e: EvenementWeb) => {
      if (!e.altKey) {
        return;
      }
      const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
      if (delta !== 0) {
        e.preventDefault();
        deplacement.current(delta);
      }
    };
    element.addEventListener('dragstart', debut);
    element.addEventListener('dragover', dessus);
    element.addEventListener('dragleave', quitte);
    element.addEventListener('drop', depose);
    element.addEventListener('dragend', fin);
    element.addEventListener('keydown', touche);
    return () => {
      element.removeAttribute('draggable');
      element.removeEventListener('dragstart', debut);
      element.removeEventListener('dragover', dessus);
      element.removeEventListener('dragleave', quitte);
      element.removeEventListener('drop', depose);
      element.removeEventListener('dragend', fin);
      element.removeEventListener('keydown', touche);
    };
  }, [edition, app.id, glisse]);

  return (
    <Animated.View
      ref={noeud as React.Ref<never>}
      testID={`cellule-${app.id}`}
      style={[
        styles.cellule,
        TRANSITION_WEB,
        {
          width: largeur,
          opacity: masquee ? Animated.multiply(entree, 0.45) : entree,
          transform: [
            { translateY: entree.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            { scale: survol ? 1.02 : 1 },
          ],
        },
        survol && { outlineColor: theme.accent, outlineStyle: 'dashed', outlineWidth: 2 },
      ]}>
      {edition ? (
        <BarreTuile
          theme={theme}
          app={app}
          taille={taille}
          epinglee={epinglee}
          masquee={masquee}
          liste={liste}
          premier={position === 0}
          dernier={position === total - 1}
          onDeplacer={onDeplacer}
          onTaille={onTaille}
          onEpingler={onEpingler}
          onMasquer={onMasquer}
        />
      ) : null}
      <Tuile
        app={app}
        etat={etatTuile(app, contexte)}
        info={app.info?.(contexte)}
        theme={theme}
        taille={taille}
        liste={liste}
        compact={compact}
        epinglee={epinglee}
        edition={edition}
        onPress={onOuvrir}
      />
    </Animated.View>
  );
}

interface EvenementWeb {
  key: string;
  altKey: boolean;
  dataTransfer?: { effectAllowed: string; setData(type: string, valeur: string): void };
  preventDefault(): void;
}
interface HTMLElementWeb {
  setAttribute(nom: string, valeur: string): void;
  removeAttribute(nom: string): void;
  addEventListener(type: string, rappel: (e: EvenementWeb) => void): void;
  removeEventListener(type: string, rappel: (e: EvenementWeb) => void): void;
}

/** Outils d'une tuile en mode édition. Chaque commande est un vrai bouton, au clavier comme au toucher. */
function BarreTuile({
  theme,
  app,
  taille,
  epinglee,
  masquee,
  liste,
  premier,
  dernier,
  onDeplacer,
  onTaille,
  onEpingler,
  onMasquer,
}: {
  theme: ThemeHub;
  app: AppHub;
  taille: TailleTuile;
  epinglee: boolean;
  masquee: boolean;
  liste: boolean;
  premier: boolean;
  dernier: boolean;
  onDeplacer(delta: number): void;
  onTaille(taille: TailleTuile): void;
  onEpingler(): void;
  onMasquer(): void;
}) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  const puce = (
    testID: string,
    titre: string,
    libelle: string,
    onPress: () => void,
    options: { actif?: boolean; desactive?: boolean } = {},
  ) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: Boolean(options.desactive), selected: Boolean(options.actif) }}
      disabled={options.desactive}
      onPress={onPress}
      style={(etat: EtatPresse) => [
        styles.puce,
        {
          borderRadius: rayon,
          borderColor: options.actif || etat.hovered ? theme.accent : theme.ligne,
          backgroundColor: options.actif ? theme.accent : theme.surface,
          opacity: options.desactive ? 0.35 : 1,
        },
      ]}>
      <Text style={{ color: options.actif ? theme.surAccent : theme.texte, fontSize: 12.5, fontWeight: '600', ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.barreTuile, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: rayon }]} accessibilityLabel={`Réglages de ${app.nom}`}>
      {puce(`edit-${app.id}-avant`, liste ? '▲' : '◀', `Déplacer ${app.nom} avant`, () => onDeplacer(-1), { desactive: premier })}
      {puce(`edit-${app.id}-apres`, liste ? '▼' : '▶', `Déplacer ${app.nom} après`, () => onDeplacer(1), { desactive: dernier })}
      <View style={styles.separateur} />
      {TAILLES.map(t => puce(`edit-${app.id}-${t}`, t === 'petite' ? 'P' : t === 'moyenne' ? 'M' : 'G', `Taille ${LIBELLES_TAILLE[t].toLowerCase()} pour ${app.nom}`, () => onTaille(t), { actif: t === taille }))}
      <View style={styles.separateur} />
      {puce(`edit-${app.id}-epingler`, epinglee ? '★ Épinglée' : '☆ Épingler', epinglee ? `Désépingler ${app.nom}` : `Épingler ${app.nom} en premier`, onEpingler, { actif: epinglee })}
      {puce(`edit-${app.id}-masquer`, masquee ? 'Afficher' : 'Masquer', masquee ? `Afficher ${app.nom}` : `Masquer ${app.nom}`, onMasquer)}
    </View>
  );
}

function Tuile({
  app,
  etat: etatApp,
  info,
  theme,
  taille,
  liste,
  compact,
  epinglee,
  edition,
  onPress,
}: {
  app: AppHub;
  etat?: EtatTuile;
  info?: InfoLive;
  theme: ThemeHub;
  taille: TailleTuile;
  liste: boolean;
  compact: boolean;
  epinglee: boolean;
  edition: boolean;
  onPress(): void;
}) {
  const couleur = theme.teintes[app.teinte];
  const fond = theme.fondsTuiles?.[app.teinte] ?? theme.surface;
  const blocs = Boolean(theme.blocs);
  const hautTexte = blocs ? '#FFFFFF' : theme.texte;
  const hautAttenue = blocs ? 'rgba(255,255,255,0.82)' : theme.attenue;
  const petite = taille === 'petite';
  const grande = taille === 'grande';
  const marge = compact ? 14 : 24;
  const titre = {
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
    ...police(theme.policeTitre),
  };
  const { width: largeurEcran } = useWindowDimensions();
  // Une ligne de liste étroite (téléphone) n'a de place que pour le nom et l'étiquette.
  const etroit = liste && largeurEcran < 640;
  const indicateurs = info && !etroit ? (petite ? info.indicateurs.slice(0, 1) : info.indicateurs) : [];
  const hauteur = liste ? 0 : petite ? (compact ? 150 : 200) : compact ? 250 : 340;

  const icone = (
    <View
      style={[
        styles.icone,
        (petite || liste || compact) && { width: 48, height: 48 },
        {
          borderRadius: theme.rayonMoyen,
          backgroundColor: blocs ? 'rgba(255,255,255,0.18)' : teinteTransparente(couleur, 0.14),
        },
      ]}>
      <Text style={{ color: blocs ? '#FFFFFF' : couleur, fontSize: petite || liste || compact ? 22 : 28, fontWeight: '700' }}>{app.icone}</Text>
    </View>
  );
  const valeurs = (
    <View style={[styles.indicateurs, liste ? styles.indicateursListe : { borderTopColor: theme.ligne }, grande && !liste && { gap: 40 }]}>
      {indicateurs.map(indicateur => (
        <View key={indicateur.libelle} style={styles.indicateur}>
          <Text style={[styles.libelleIndicateur, { color: blocs && liste ? hautAttenue : theme.attenue }]}>{indicateur.libelle.toUpperCase()}</Text>
          <Text
            testID={`tuile-${app.id}-${indicateur.libelle}`}
            style={[
              styles.valeurIndicateur,
              grande && { fontSize: 26 },
              petite && { fontSize: 17 },
              police(theme.policeChiffres),
              {
                color:
                  indicateur.tendance === 'hausse' ? theme.ok : indicateur.tendance === 'baisse' ? theme.critique : blocs && liste ? hautTexte : theme.texte,
              },
            ]}>
            {indicateur.valeur}
          </Text>
        </View>
      ))}
    </View>
  );
  const ouvrable = etatApp?.ouvrable ?? true;
  const bandeau = etatApp?.maintenance || etatApp?.desactivee ? (
    <Text
      testID={`tuile-${app.id}-statut`}
      style={[
        styles.bandeauTuile,
        {
          color: theme.texte,
          backgroundColor: theme.surface,
          borderColor: etatApp.maintenance ? theme.alerte : theme.critique,
          borderRadius: Math.min(theme.rayonMoyen, 8),
          ...police(theme.policeTexte),
        },
      ]}>
      {etatApp.maintenance ? `🛠 ${etatApp.maintenance}` : 'Désactivée pour les autres utilisateurs'}
      {etatApp.maintenance && ouvrable ? ' (visible par vous seul·e : vous pouvez l’ouvrir)' : ''}
    </Text>
  ) : null;
  const etiquette = (
    <View style={styles.etiquettes}>
      {etatApp?.niveau === 'lecture' ? (
        <Text style={[styles.etiquette, { color: hautAttenue, borderColor: blocs ? 'rgba(255,255,255,0.4)' : theme.ligne, borderRadius: theme.rayonGrand ? 999 : 0 }]}>
          LECTURE SEULE
        </Text>
      ) : null}
      {epinglee ? <Text style={{ color: hautAttenue, fontSize: 12 }} accessibilityLabel="Épinglée">★</Text> : null}
      <Text
        style={[
          styles.etiquette,
          { color: hautAttenue, borderColor: blocs ? 'rgba(255,255,255,0.4)' : theme.ligne, borderRadius: theme.rayonGrand ? 999 : 0 },
        ]}>
        {app.categorie.toUpperCase()}
      </Text>
    </View>
  );

  return (
    <Pressable
      testID={`tuile-${app.id}`}
      accessibilityRole="button"
      accessibilityLabel={
        edition
          ? `${app.nom}, en cours de personnalisation`
          : ouvrable
            ? `Ouvrir ${app.nom}${etatApp?.maintenance ? ` (en maintenance : ${etatApp.maintenance})` : ''}`
            : `${app.nom} : en maintenance. ${etatApp?.maintenance ?? ''}`
      }
      accessibilityState={{ disabled: edition || !ouvrable }}
      disabled={edition || !ouvrable}
      onPress={onPress}
      style={(etat: EtatPresse) => [
        styles.tuile,
        TRANSITION_WEB,
        {
          backgroundColor: fond,
          borderColor: !edition && (etat.hovered || etat.focused) ? couleur : theme.ligne,
          borderRadius: theme.rayonGrand,
          minHeight: hauteur,
          transform: [{ scale: etat.pressed && !edition ? 0.99 : etat.hovered && !edition && ouvrable ? 1.03 : 1 }],
          opacity: ouvrable ? 1 : 0.72,
        },
        edition && SUR_LE_WEB && ({ cursor: 'grab' } as object),
        liste && styles.tuileListe,
      ]}>
      {(etat: EtatPresse) =>
        liste ? (
          <>
            <View style={[styles.ligneListe, { padding: marge }, blocs && { backgroundColor: couleur }]}>
              {icone}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[titre, styles.nomApp, { color: hautTexte, fontSize: petite ? 17 : 20 }]} numberOfLines={1}>
                  {app.nom}
                </Text>
                {!petite ? (
                  <Text style={[styles.sous, { color: hautAttenue, ...police(theme.policeTexte) }]} numberOfLines={grande ? 2 : 1}>
                    {info?.sousTitre ?? app.description}
                  </Text>
                ) : null}
              </View>
              {indicateurs.length > 0 ? valeurs : null}
              {etiquette}
            </View>
            {bandeau ? <View style={{ paddingHorizontal: marge, paddingBottom: marge }}>{bandeau}</View> : null}
          </>
        ) : (
          <>
            <View style={[styles.tuileHaut, { padding: marge, gap: compact ? 16 : 32 }, blocs && { backgroundColor: couleur }]}>
              <View style={styles.tuileTete}>
                {icone}
                {etiquette}
              </View>
              <View>
                {info ? (
                  <View style={styles.direct}>
                    <View style={[styles.point, { backgroundColor: blocs ? '#FFFFFF' : couleur }]} />
                    <Text style={[styles.directTexte, { color: blocs ? '#FFFFFF' : couleur }]}>{info.pastille ?? 'EN DIRECT'}</Text>
                  </View>
                ) : null}
                <Text style={[titre, styles.nomApp, { color: hautTexte, fontSize: petite ? 20 : grande ? 32 : 26 }]}>{app.nom}</Text>
                {!petite ? (
                  <Text style={[styles.sous, { color: hautAttenue, ...police(theme.policeTexte) }]}>
                    {info?.sousTitre ?? app.description}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.tuileBas, { paddingHorizontal: marge, paddingBottom: marge }]}>
              {bandeau}
              {indicateurs.length > 0 ? valeurs : null}
              {!petite && !edition && ouvrable ? (
                <Text style={[styles.ouvrir, { color: couleur, opacity: etat.hovered || !SUR_LE_WEB ? 1 : 0 }]}>Ouvrir →</Text>
              ) : null}
            </View>
          </>
        )
      }
    </Pressable>
  );
}

function TuileNouvelle({ theme, compact, liste }: { theme: ThemeHub; compact: boolean; liste: boolean }) {
  return (
    <View
      testID="tuile-nouvelle"
      accessibilityLabel="Ta prochaine app, emplacement libre"
      style={[
        styles.tuile,
        styles.nouvelle,
        {
          borderColor: theme.ligne,
          borderRadius: theme.rayonGrand,
          backgroundColor: theme.fondsTuiles?.nouveau ?? 'transparent',
          minHeight: liste ? 72 : compact ? 250 : 340,
        },
        liste && { flexDirection: 'row', padding: 14, gap: 16 },
      ]}>
      <View style={[styles.plus, liste && { width: 40, height: 40 }, { borderColor: theme.attenue, borderRadius: theme.rayonGrand ? 32 : 0 }]}>
        <Text style={{ color: theme.attenue, fontSize: 28 }}>+</Text>
      </View>
      <View>
        <Text
          style={[
            styles.nomApp,
            { color: theme.texte, fontWeight: theme.poidsTitre, textAlign: liste ? 'left' : 'center', ...police(theme.policeTitre) },
            theme.majuscules && { textTransform: 'uppercase' },
          ]}>
          Ta prochaine app
        </Text>
        {!liste ? (
          <Text style={[styles.sous, { color: theme.attenue, textAlign: 'center', ...police(theme.policeTexte) }]}>
            Une place est prête dans ton hub.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Pastille de thème : fond, filet et accents, comme dans la maquette. */
function Pastille({ theme }: { theme: ThemeHub }) {
  return (
    <View style={[styles.pastille, { backgroundColor: theme.fond, borderColor: theme.ligne }]}>
      {[theme.accent, theme.teintes.portefeuille, theme.teintes.admin, theme.teintes.quatre].map((couleur, index) => (
        <View key={index} style={[styles.pastillePoint, { backgroundColor: couleur, borderRadius: theme.rayonGrand ? 4 : 0 }]} />
      ))}
    </View>
  );
}

function SelecteurTheme({
  theme,
  ouvert,
  onBasculer,
  onChoisir,
}: {
  theme: ThemeHub;
  ouvert: boolean;
  onBasculer(): void;
  onChoisir(id: IdThemeHub): void;
}) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.selecteur}>
      <Pressable
        testID="hub-theme"
        accessibilityRole="button"
        accessibilityLabel={`Choisir un thème, actuel : ${theme.nom}`}
        accessibilityState={{ expanded: ouvert }}
        onPress={onBasculer}
        style={[styles.boutonTheme, { backgroundColor: theme.surface, borderColor: ouvert ? theme.accent : theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
        <Pastille theme={theme} />
        {width >= 640 ? <Text style={{ color: theme.texte, fontWeight: '500', ...police(theme.policeTexte) }}>{theme.nom}</Text> : null}
        <Text style={{ color: theme.attenue }}>{ouvert ? '▴' : '▾'}</Text>
      </Pressable>
      {ouvert ? (
        <View
          accessibilityRole="menu"
          style={[styles.menu, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
          <Text style={[styles.menuTitre, { color: theme.attenue }]}>THÈME</Text>
          {THEMES_HUB.map(candidat => {
            const choisi = candidat.id === theme.id;
            return (
              <Pressable
                key={candidat.id}
                testID={`hub-theme-${candidat.id}`}
                accessibilityRole="menuitem"
                accessibilityState={{ checked: choisi }}
                onPress={() => onChoisir(candidat.id)}
                style={(etat: EtatPresse) => [
                  styles.menuLigne,
                  { borderRadius: Math.min(theme.rayonMoyen, 10) },
                  (etat.hovered || etat.pressed) && { backgroundColor: teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.06) },
                ]}>
                <Pastille theme={candidat} />
                <Text style={{ color: theme.texte, flex: 1, fontWeight: '500', ...police(theme.policeTexte) }}>{candidat.nom}</Text>
                <Text style={{ color: theme.accent, opacity: choisi ? 1 : 0 }}>✓</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Bouton discret aux couleurs du hub. */
export function BoutonHub({
  theme,
  titre,
  onPress,
  testID,
  variante = 'normal',
  desactive = false,
  couleur,
  libelle,
}: {
  theme: ThemeHub;
  titre: string;
  onPress(): void;
  testID?: string;
  /** Nom accessible, quand le titre visible est abrégé (pictogramme). */
  libelle?: string;
  variante?: 'normal' | 'plein' | 'danger';
  desactive?: boolean;
  /** Accent du bouton plein ; celui du thème à défaut. */
  couleur?: string;
}) {
  const accent = couleur ?? theme.accent;
  // Téléphone : 44 px de haut au moins, texte de 15 px.
  const mobile = useMobile();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: desactive }}
      disabled={desactive}
      onPress={onPress}
      style={(etat: EtatPresse) => [
        styles.bouton,
        mobile && styles.boutonMobile,
        {
          borderRadius: theme.id === 'sauge' ? 999 : Math.min(theme.rayonMoyen, 10),
          backgroundColor: variante === 'plein' ? accent : theme.surface,
          borderColor: variante === 'plein' ? accent : variante === 'danger' ? theme.critique : etat.hovered ? accent : theme.ligne,
          opacity: desactive ? 0.45 : 1,
        },
      ]}>
      <Text
        style={{
          color: variante === 'plein' ? theme.surAccent : variante === 'danger' ? theme.critique : theme.texte,
          fontWeight: '600',
          fontSize: mobile ? 15 : 14,
          ...police(theme.policeTexte),
        }}>
        {titre}
      </Text>
    </Pressable>
  );
}

/** Barre « ← Hub » des apps qui n'ont pas leur propre navigation. */
export function RetourHub({ theme, onRetour, titre }: { theme: ThemeHub; onRetour(): void; /** Nom de l'app (en-tête du téléphone). */ titre?: string }) {
  // Pastille de synchro et bouton « Paramètres » : les mêmes que dans l'en-tête du hub.
  const barre = useBarreApp();
  const nav = useNavigationMobile();
  if (useMobile()) {
    // Téléphone : une ligne compacte, « ‹ Accueil » à gauche, synchro condensée et Réglages à droite.
    return (
      <View style={styles.retourMobile} testID="retour-hub-mobile">
        <Pressable testID="retour-hub" accessibilityRole="button" accessibilityLabel="Retour à l’accueil" onPress={onRetour} style={styles.retourBouton}>
          <Text style={{ color: theme.accent, fontSize: 26, lineHeight: 28, marginTop: -2 }}>‹</Text>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '500', ...police(theme.policeTexte) }}>Accueil</Text>
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.texte, fontSize: 17, fontWeight: '600', textAlign: 'center', ...police(theme.policeTexte) }}>
          {titre ?? ''}
        </Text>
        {nav?.synchro ? <IndicateurSynchro theme={theme} synchro={nav.synchro} condense onPress={() => nav.onParametres()} /> : null}
        {nav ? <BoutonIcone theme={theme} titre="⚙︎" libelle="Paramètres" onPress={nav.onParametres} testID="app-parametres-ouvrir" /> : null}
      </View>
    );
  }
  return (
    <View style={styles.retour}>
      <View style={styles.retourGauche}>
        <BoutonHub theme={theme} titre="← Hub" onPress={onRetour} testID="retour-hub" />
        {CLAVIER_PROBABLE ? <Text style={[styles.echap, { color: theme.attenue }]}>ÉCHAP POUR FERMER</Text> : null}
      </View>
      {barre}
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  defilement: { flexGrow: 1 },
  page: { width: '100%', maxWidth: 1200, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48, flexGrow: 1 },
  entete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  marque: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionsEntete: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  intro: { marginTop: 48, marginBottom: 32 },
  pages: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, padding: 3, gap: 3, marginBottom: 20 },
  pageOnglet: { paddingVertical: 9, paddingHorizontal: 18, minHeight: 40, justifyContent: 'center' },
  salut: { fontSize: 44, lineHeight: 50, letterSpacing: -1 },
  accroche: { marginTop: 16, fontSize: 18 },
  grille: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  cellule: { padding: 8 },
  tuile: { minHeight: 340, flexGrow: 1, borderWidth: 1, overflow: 'hidden' },
  tuileHaut: { flex: 1, justifyContent: 'space-between', gap: 32, padding: 24 },
  tuileTete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  icone: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  etiquette: { fontSize: 11, fontWeight: '600', letterSpacing: 1.1, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, overflow: 'hidden' },
  direct: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  point: { width: 6, height: 6, borderRadius: 3 },
  directTexte: { fontSize: 11, fontWeight: '600', letterSpacing: 1.1 },
  nomApp: { fontSize: 26, letterSpacing: -0.6 },
  sous: { marginTop: 6, fontSize: 14, lineHeight: 20 },
  tuileBas: { paddingHorizontal: 24, paddingBottom: 24 },
  indicateurs: { flexDirection: 'row', gap: 24, marginTop: 16, paddingTop: 16, borderTopWidth: 1, flexWrap: 'wrap' },
  indicateur: { gap: 4 },
  libelleIndicateur: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1 },
  valeurIndicateur: { fontSize: 20, fontWeight: '500', letterSpacing: -0.6 },
  ouvrir: { marginTop: 16, fontSize: 13, fontWeight: '600' },
  nouvelle: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, borderStyle: 'dashed' },
  plus: { width: 64, height: 64, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  pied: { marginTop: 48, fontSize: 12, textAlign: 'center' },
  selecteur: { position: 'relative' },
  boutonTheme: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingLeft: 8, paddingRight: 12, borderWidth: 1 },
  pastille: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 5, paddingHorizontal: 6, borderWidth: 1, borderRadius: 8 },
  pastillePoint: { width: 8, height: 8 },
  menu: {
    position: 'absolute',
    right: 0,
    top: 48,
    width: 280,
    padding: 6,
    borderWidth: 1,
    zIndex: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  menuTitre: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, fontSize: 11, fontWeight: '600', letterSpacing: 1.1 },
  menuLigne: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 10 },
  bouton: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  boutonMobile: { minHeight: 44, minWidth: 44, paddingHorizontal: 16 },
  tuileListe: { minHeight: 0 },
  ligneListe: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  indicateursListe: { marginTop: 0, paddingTop: 0, borderTopWidth: 0, gap: 24, flexWrap: 'nowrap' },
  etiquettes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  annonce: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  barreEdition: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 20, padding: 14, borderWidth: 1, marginBottom: 16 },
  groupe: { gap: 6 },
  libelleGroupe: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1 },
  segments: { flexDirection: 'row', borderWidth: 1, overflow: 'hidden' },
  segment: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  actionsBarre: { flexDirection: 'row', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' },
  barreTuile: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 6, borderWidth: 1, marginBottom: 8 },
  puce: { minWidth: 36, minHeight: 36, paddingHorizontal: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  separateur: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(128,128,128,0.35)', marginHorizontal: 2 },
  retour: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  retourGauche: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  retourMobile: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 52, marginHorizontal: -8 },
  retourBouton: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, minWidth: 44, paddingHorizontal: 6 },
  echap: { fontSize: 11, letterSpacing: 0.9 },
  bandeauTuile: { fontSize: 13, lineHeight: 18, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderLeftWidth: 4, marginTop: 12, overflow: 'hidden' },
});

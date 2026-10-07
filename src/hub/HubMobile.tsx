/**
 * Le hub sur téléphone.
 *
 *  - en-tête compact : logo, nom, pastille de synchro condensée (→ Paramètres › Synchronisation),
 *    bouton « Personnaliser » ;
 *  - salutation courte, bandeaux (abonnement, mise à jour disponible) lisibles en pleine largeur ;
 *  - tuiles compactes avec leur info en direct : 2 colonnes (grille) ou lignes (liste) ; une tuile
 *    « grande » prend toute la largeur ;
 *  - personnalisation TACTILE : une liste où chaque app a ses boutons (monter, descendre, épingler,
 *    masquer, taille), 44 px chacun — pas de glisser-déposer à deviner ;
 *  - barre basse du hub (Accueil · Admin · Support · Réglages · Compte) : « Admin » ouvre la page
 *    « Administration » du hub, seulement pour les rangs qui y ont au moins une app (`pages.ts`).
 *
 * Même logique que le hub de bureau (`personnalisation.ts`, `permissions.ts`), autre mise en page.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BandeauAbonnement } from './abonnements/BandeauAbonnement';
import { accrochePageVide, usePageHub, type HubProps } from './Hub';
import { ID_ABONNEMENTS } from './abonnements/actionsAbo';
import { appsDePage } from './pages';
import { IndicateurSynchro } from './IndicateurSynchro';
import { salutation } from './infos';
import { LogoHub } from './LogoHub';
import { BoutonMiseAJour, useMiseAJour } from './ParametresHub';
import { etatTuile, type EtatTuile } from './permissions';
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
  reinitialiser,
  sontParDefaut,
  type PrefsHub,
  type TuilePrefs,
} from './personnalisation';
import { police, teinteTransparente, type ThemeHub } from './themes';
import type { AppHub, InfoLive } from './types';
import { BoutonPrincipal } from '../ui/mobile/BoutonPrincipal';
import { BoutonIcone } from '../ui/mobile/EnTeteMobile';
import { CONTROLE, ESPACE, GOUTTIERE, TEXTE, rayonCarte, rayonControle } from '../ui/mobile/jetons';
import { GroupeCellules } from '../ui/mobile/ListeCellules';
import { BarreBasseHub } from '../ui/mobile/NavigationMobile';
import { margesSecurite } from '../ui/mobile/ZoneSecurite';

/** Colonnes de la grille du téléphone (pure, testée) : 2 dès 340 px, sinon 1. */
export function colonnesMobile(largeur: number, disposition: 'grille' | 'liste'): number {
  return disposition === 'liste' || largeur < 340 ? 1 : 2;
}

export function HubMobile({ registre, contexte, theme, onOuvrir, prefs, onPrefs, onParametres, synchro, demande, heure, page: pageDemandee, onPage }: HubProps) {
  const { width } = useWindowDimensions();
  const [edition, setEdition] = useState(false);
  const [annonce, setAnnonce] = useState('');
  const maj = useMiseAJour();
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
  const courantes = prefs ?? reinitialiser();
  // Page « Applications » ou « Administration » : on en change par la barre basse (entrée « Admin »).
  const { pages, page } = usePageHub(registre, contexte, pageDemandee, onPage);
  const autorisees = appsDePage(registre, contexte, page);
  const tuiles = appliquerPrefs(autorisees, courantes);
  const ids = tuiles.map(t => t.app.id);
  const affichees = tuiles.filter(t => !t.masquee);
  const masquees = tuiles.length - affichees.length;
  const colonnes = colonnesMobile(width, courantes.disposition);
  const compact = courantes.densite === 'compact';
  const titre = salutation(heure ?? new Date().getHours(), contexte.profil?.nom);
  const [debut, nom] = titre.includes(', ') ? titre.split(', ') : [titre.replace(/\.$/, ''), undefined];
  const modifie = edition && personnalisable;

  const changer = (suivant: PrefsHub, message?: string) => {
    onPrefs?.(suivant);
    if (message) {
      setAnnonce(message);
    }
  };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const titreStyle = {
    color: theme.texte,
    fontWeight: theme.poidsTitre,
    textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const),
    ...police(theme.policeTitre),
  };

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub">
      <View style={[styles.entete, margesSecurite(['haut']), { backgroundColor: theme.fond, borderBottomColor: theme.ligne }]} testID="hub-entete-mobile">
        <View style={styles.marque}>
          <LogoHub taille={28} fond={theme.accent} trait={theme.surAccent} rayon={Math.min(theme.rayonMoyen, 8)} testID="hub-logo" />
          <Text style={[titreStyle, { fontSize: theme.majuscules ? 15 : 17 }]} numberOfLines={1}>
            AppDashboard
          </Text>
        </View>
        {synchro ? <IndicateurSynchro theme={theme} synchro={synchro} condense onPress={() => onParametres?.('synchro')} /> : null}
        {personnalisable && !modifie ? (
          <BoutonIcone theme={theme} titre="✎" libelle="Personnaliser l’accueil" onPress={() => setEdition(true)} testID="hub-personnaliser" />
        ) : null}
      </View>

      <ScrollView style={styles.defilement} contentContainerStyle={styles.contenu} keyboardShouldPersistTaps="handled">
        {modifie ? null : page === 'administration' ? (
          <View style={[styles.intro, compact && { marginTop: ESPACE.xs }]} testID="hub-titre-administration">
            <Text style={[titreStyle, styles.salut]} accessibilityRole="header">
              Administration
            </Text>
            <Text style={[texte, styles.accroche, { color: theme.attenue }]}>
              {autorisees.length > 0 ? 'Les apps réservées à l’administration de ce hub.' : accrochePageVide(page, pages)}
            </Text>
          </View>
        ) : (
          <View style={[styles.intro, compact && { marginTop: ESPACE.xs }]}>
            <Text style={[titreStyle, styles.salut]} accessibilityRole="header">
              {debut}
              {nom ? (
                <>
                  , <Text style={{ color: theme.accent }}>{nom}</Text>
                </>
              ) : (
                '.'
              )}
            </Text>
            {!compact ? (
              <Text style={[texte, styles.accroche, { color: theme.attenue }]}>
                {autorisees.length > 0 ? 'Reprenez là où vous en étiez.' : accrochePageVide(page, pages)}
              </Text>
            ) : null}
          </View>
        )}

        {modifie ? null : <BandeauAbonnement contexte={contexte} theme={theme} onOuvrirAbonnements={() => onOuvrir(ID_ABONNEMENTS)} />}
        {!modifie && maj.etat.phase === 'disponible' ? (
          <View style={styles.maj}>
            <BoutonMiseAJour theme={theme} maj={maj} />
          </View>
        ) : null}

        {modifie ? (
          <Personnalisation theme={theme} prefs={courantes} tuiles={tuiles} ids={ids} onChanger={changer} />
        ) : (
          <View style={styles.grille} accessibilityLabel={page === 'administration' ? 'Administration' : 'Applications'} testID={`hub-grille-${page}`}>
            {affichees.map(tuile => (
              <View
                key={tuile.app.id}
                testID={`cellule-${tuile.app.id}`}
                style={{ width: colonnes === 1 || tuile.taille === 'grande' ? '100%' : '50%', padding: ESPACE.xxs + 2 }}>
                <TuileMobile
                  tuile={tuile}
                  theme={theme}
                  etat={etatTuile(tuile.app, contexte)}
                  info={tuile.app.info?.(contexte)}
                  ligne={colonnes === 1}
                  compact={compact}
                  onPress={() => onOuvrir(tuile.app.id)}
                />
              </View>
            ))}
          </View>
        )}

        {!modifie && masquees > 0 && personnalisable ? (
          <Text style={[texte, styles.pied, { color: theme.attenue }]} testID="hub-masquees">
            {masquees} app{masquees > 1 ? 's' : ''} masquée{masquees > 1 ? 's' : ''} : ✎ en haut à droite pour les réafficher.
          </Text>
        ) : null}
        <Text accessibilityLiveRegion="polite" style={styles.annonce} testID="hub-annonce">
          {annonce}
        </Text>
      </ScrollView>

      {modifie ? (
        <View style={[styles.piedEdition, margesSecurite(['bas'], { bas: ESPACE.s }), { borderTopColor: theme.ligne, backgroundColor: theme.fond }]}>
          <BoutonPrincipal theme={theme} titre="Terminé" onPress={() => setEdition(false)} testID="hub-terminer" />
        </View>
      ) : (
        <BarreBasseHub actif={page === 'administration' ? 'administration' : 'accueil'} />
      )}
    </View>
  );
}

/** Tuile compacte : pictogramme, nom, phrase en direct, premier indicateur. */
function TuileMobile({
  tuile,
  theme,
  etat,
  info,
  ligne,
  compact,
  onPress,
}: {
  tuile: TuilePrefs<AppHub>;
  theme: ThemeHub;
  etat?: EtatTuile;
  info?: InfoLive;
  ligne: boolean;
  compact: boolean;
  onPress(): void;
}) {
  const { app, taille, epinglee } = tuile;
  const couleur = theme.teintes[app.teinte];
  const blocs = Boolean(theme.blocs);
  const fond = blocs ? couleur : theme.fondsTuiles?.[app.teinte] ?? theme.surface;
  const texteHaut = blocs ? '#FFFFFF' : theme.texte;
  const attenueHaut = blocs ? 'rgba(255,255,255,0.85)' : theme.attenue;
  const ouvrable = etat?.ouvrable ?? true;
  const indicateur = info?.indicateurs[0];
  const sous = etat?.maintenance ? `🛠 ${etat.maintenance}` : etat?.desactivee ? 'Désactivée pour les autres utilisateurs' : info?.sousTitre ?? app.description;
  const grande = taille === 'grande';
  const icone = (
    <View style={[styles.icone, { borderRadius: Math.min(theme.rayonMoyen, 12), backgroundColor: blocs ? 'rgba(255,255,255,0.2)' : teinteTransparente(couleur, 0.16) }]}>
      <Text style={{ color: blocs ? '#FFFFFF' : couleur, fontSize: 20, fontWeight: '700' }}>{app.icone}</Text>
    </View>
  );
  const valeur = indicateur ? (
    <View style={{ gap: 0 }}>
      <Text style={{ color: attenueHaut, fontSize: TEXTE.legende, ...police(theme.policeTexte) }} numberOfLines={1}>
        {indicateur.libelle}
      </Text>
      <Text
        testID={`tuile-${app.id}-${indicateur.libelle}`}
        numberOfLines={1}
        style={{
          fontSize: grande ? 22 : 18,
          fontWeight: '600',
          color: indicateur.tendance === 'hausse' && !blocs ? theme.ok : indicateur.tendance === 'baisse' && !blocs ? theme.critique : texteHaut,
          ...police(theme.policeChiffres),
        }}>
        {indicateur.valeur}
      </Text>
    </View>
  ) : null;
  return (
    <Pressable
      testID={`tuile-${app.id}`}
      accessibilityRole="button"
      accessibilityLabel={ouvrable ? `Ouvrir ${app.nom}${etat?.maintenance ? ` (en maintenance : ${etat.maintenance})` : ''}` : `${app.nom} : en maintenance. ${etat?.maintenance ?? ''}`}
      accessibilityState={{ disabled: !ouvrable }}
      disabled={!ouvrable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tuile,
        ligne ? styles.tuileLigne : { minHeight: compact ? 132 : 164 },
        {
          backgroundColor: fond,
          borderColor: etat?.maintenance ? theme.alerte : theme.ligne,
          borderRadius: rayonCarte(theme),
          opacity: ouvrable ? (pressed ? 0.85 : 1) : 0.7,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}>
      {ligne ? (
        <>
          {icone}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[styles.nom, { color: texteHaut, fontWeight: theme.poidsTitre === '400' ? '600' : theme.poidsTitre, ...police(theme.policeTitre) }]} numberOfLines={1}>
              {epinglee ? '★ ' : ''}
              {app.nom}
            </Text>
            {!compact || grande ? (
              <Text style={{ color: attenueHaut, fontSize: TEXTE.legende, lineHeight: 20, ...police(theme.policeTexte) }} numberOfLines={2}>
                {sous}
              </Text>
            ) : null}
          </View>
          {valeur}
          <Text style={{ color: attenueHaut, fontSize: 24 }}>›</Text>
        </>
      ) : (
        <>
          <View style={styles.teteTuile}>
            {icone}
            {epinglee ? (
              <Text style={{ color: attenueHaut, fontSize: TEXTE.legende }} accessibilityLabel="Épinglée">
                ★
              </Text>
            ) : null}
          </View>
          <View style={{ gap: 2 }}>
            <Text style={[styles.nom, { color: texteHaut, fontWeight: theme.poidsTitre === '400' ? '600' : theme.poidsTitre, ...police(theme.policeTitre) }]} numberOfLines={1}>
              {app.nom}
            </Text>
            {!compact || grande ? (
              <Text style={{ color: attenueHaut, fontSize: TEXTE.legende, lineHeight: 20, ...police(theme.policeTexte) }} numberOfLines={grande ? 2 : 3}>
                {sous}
              </Text>
            ) : null}
          </View>
          {valeur}
        </>
      )}
    </Pressable>
  );
}

/** Personnalisation tactile : disposition, densité, puis une ligne d'outils par app. */
function Personnalisation({
  theme,
  prefs,
  tuiles,
  ids,
  onChanger,
}: {
  theme: ThemeHub;
  prefs: PrefsHub;
  tuiles: ReadonlyArray<TuilePrefs<AppHub>>;
  ids: readonly string[];
  onChanger(prefs: PrefsHub, annonce?: string): void;
}) {
  const segments = <T extends string>(libelle: string, valeur: T, options: ReadonlyArray<readonly [T, string]>, onChoisir: (v: T) => void, testID: string) => (
    <View style={{ gap: ESPACE.xs }}>
      <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>{libelle}</Text>
      <View style={[styles.segments, { borderColor: theme.ligne, borderRadius: rayonControle(theme) === 999 ? 24 : rayonControle(theme), backgroundColor: theme.surface }]} accessibilityRole="radiogroup">
        {options.map(([cle, texte]) => {
          const actif = cle === valeur;
          return (
            <Pressable
              key={cle}
              testID={`${testID}-${cle}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              aria-checked={actif}
              accessibilityLabel={`${libelle} : ${texte}`}
              onPress={() => onChoisir(cle)}
              style={[styles.segment, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: TEXTE.legende + 1, ...police(theme.policeTexte) }}>{texte}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  return (
    <View style={{ gap: ESPACE.l, paddingHorizontal: 6 }} testID="hub-barre-edition">
      <Text style={{ color: theme.attenue, fontSize: TEXTE.legende + 1, lineHeight: 23, ...police(theme.policeTexte) }}>
        Réordonnez avec ▲ ▼, épinglez ★, masquez 👁 ou changez la taille de chaque app. L’accueil se met à jour en direct.
      </Text>
      <View style={{ gap: ESPACE.m }}>
        {segments('Disposition', prefs.disposition, [['grille', '▦ Grille'], ['liste', '☰ Liste']] as const, v => onChanger(definirDisposition(prefs, v), `Disposition : ${v}.`), 'hub-disposition')}
        {segments('Densité', prefs.densite, [['aere', 'Aérée'], ['compact', 'Compacte']] as const, v => onChanger(definirDensite(prefs, v), `Densité : ${v === 'aere' ? 'aérée' : 'compacte'}.`), 'hub-densite')}
      </View>
      <GroupeCellules theme={theme} titre="Apps" note="La taille « Grande » occupe toute la largeur de l’écran.">
        {tuiles.map((tuile, rang) => (
          <LigneEdition
            key={tuile.app.id}
            theme={theme}
            tuile={tuile}
            premier={rang === 0}
            dernier={rang === tuiles.length - 1}
            onDeplacer={delta => {
              const suivant = deplacer(prefs, ids, tuile.app.id, delta);
              onChanger(suivant, suivant === prefs ? undefined : `${tuile.app.nom} déplacée.`);
            }}
            onEpingler={() =>
              onChanger(basculerEpinglee(prefs, ids, tuile.app.id, !tuile.epinglee), tuile.epinglee ? `${tuile.app.nom} n’est plus épinglée.` : `${tuile.app.nom} épinglée en premier.`)
            }
            onMasquer={() => onChanger(basculerMasquee(prefs, tuile.app.id, !tuile.masquee), tuile.masquee ? `${tuile.app.nom} affichée.` : `${tuile.app.nom} masquée.`)}
            onTaille={() => {
              const suivante = TAILLES[(TAILLES.indexOf(tuile.taille) + 1) % TAILLES.length];
              onChanger(definirTaille(prefs, tuile.app.id, suivante), `${tuile.app.nom} : taille ${LIBELLES_TAILLE[suivante].toLowerCase()}.`);
            }}
          />
        ))}
      </GroupeCellules>
      <BoutonPrincipal theme={theme} variante="discret" titre="Réinitialiser l’accueil" desactive={sontParDefaut(prefs)} onPress={() => onChanger(reinitialiser(), 'Disposition par défaut rétablie.')} testID="hub-reinitialiser" />
    </View>
  );
}

function LigneEdition({
  theme,
  tuile,
  premier,
  dernier,
  onDeplacer,
  onEpingler,
  onMasquer,
  onTaille,
}: {
  theme: ThemeHub;
  tuile: TuilePrefs<AppHub>;
  premier: boolean;
  dernier: boolean;
  onDeplacer(delta: number): void;
  onEpingler(): void;
  onMasquer(): void;
  onTaille(): void;
}) {
  const { app } = tuile;
  const outil = (testID: string, titre: string, libelle: string, onPress: () => void, options: { actif?: boolean; desactive?: boolean; large?: boolean } = {}) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: Boolean(options.desactive), selected: Boolean(options.actif) }}
      disabled={options.desactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.outil,
        options.large && { paddingHorizontal: ESPACE.xs },
        {
          borderRadius: Math.min(theme.rayonMoyen, 10),
          borderColor: options.actif ? theme.accent : theme.ligne,
          backgroundColor: options.actif ? teinteTransparente(theme.accent, 0.16) : pressed ? theme.ligne : 'transparent',
          opacity: options.desactive ? 0.3 : 1,
        },
      ]}>
      <Text style={{ color: options.actif ? theme.accent : theme.texte, fontSize: TEXTE.legende + 1, fontWeight: '700', ...police(theme.policeTexte) }}>{titre}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.ligneEdition, { opacity: tuile.masquee ? 0.6 : 1 }]} testID={`edition-${app.id}`}>
      <View style={styles.ligneEditionTete}>
        <Text style={{ color: theme.teintes[app.teinte], fontSize: 18, width: 24, textAlign: 'center' }}>{app.icone}</Text>
        <Text style={{ flex: 1, color: theme.texte, fontSize: TEXTE.corps, fontWeight: '600', ...police(theme.policeTexte) }} numberOfLines={1}>
          {app.nom}
          {tuile.masquee ? ' (masquée)' : ''}
        </Text>
      </View>
      <View style={styles.outils} accessibilityLabel={`Réglages de ${app.nom}`}>
        {outil(`edit-${app.id}-avant`, '▲', `Monter ${app.nom}`, () => onDeplacer(-1), { desactive: premier })}
        {outil(`edit-${app.id}-apres`, '▼', `Descendre ${app.nom}`, () => onDeplacer(1), { desactive: dernier })}
        {outil(`edit-${app.id}-epingler`, tuile.epinglee ? '★' : '☆', tuile.epinglee ? `Désépingler ${app.nom}` : `Épingler ${app.nom} en premier`, onEpingler, { actif: tuile.epinglee })}
        {outil(`edit-${app.id}-masquer`, tuile.masquee ? '◌' : '👁', tuile.masquee ? `Afficher ${app.nom}` : `Masquer ${app.nom}`, onMasquer, { actif: tuile.masquee })}
        {outil(`edit-${app.id}-taille`, LIBELLES_TAILLE[tuile.taille], `Taille de ${app.nom} : ${LIBELLES_TAILLE[tuile.taille].toLowerCase()} (toucher pour changer)`, onTaille, { large: true })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: ESPACE.xxs, paddingHorizontal: GOUTTIERE - 4, minHeight: CONTROLE.entete, borderBottomWidth: StyleSheet.hairlineWidth },
  marque: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ESPACE.xs, paddingLeft: 4 },
  defilement: { flex: 1 },
  contenu: { paddingHorizontal: GOUTTIERE - 6, paddingTop: ESPACE.m, paddingBottom: ESPACE.xxl, gap: ESPACE.s, width: '100%', maxWidth: 640, alignSelf: 'center' },
  intro: { paddingHorizontal: 6, marginTop: ESPACE.xs, marginBottom: ESPACE.xs, gap: ESPACE.xxs },
  salut: { fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  accroche: { fontSize: TEXTE.corps, lineHeight: 24 },
  maj: { paddingHorizontal: 6, alignItems: 'flex-start' },
  grille: { flexDirection: 'row', flexWrap: 'wrap' },
  tuile: { borderWidth: 1, padding: ESPACE.m - 2, gap: ESPACE.s, justifyContent: 'space-between', overflow: 'hidden' },
  tuileLigne: { flexDirection: 'row', alignItems: 'center', minHeight: 76, justifyContent: 'flex-start' },
  teteTuile: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  icone: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  nom: { fontSize: 19, letterSpacing: -0.3 },
  pied: { marginTop: ESPACE.m, fontSize: TEXTE.legende, textAlign: 'center', paddingHorizontal: ESPACE.m },
  annonce: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  piedEdition: { paddingHorizontal: GOUTTIERE, paddingTop: ESPACE.s, borderTopWidth: StyleSheet.hairlineWidth },
  segments: { flexDirection: 'row', borderWidth: 1, overflow: 'hidden' },
  segment: { flex: 1, minHeight: CONTROLE.cible + 2, alignItems: 'center', justifyContent: 'center' },
  ligneEdition: { paddingHorizontal: ESPACE.m, paddingVertical: ESPACE.s, gap: ESPACE.xs },
  ligneEditionTete: { flexDirection: 'row', alignItems: 'center', gap: ESPACE.xs },
  outils: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACE.xs },
  outil: { minWidth: CONTROLE.cible, minHeight: CONTROLE.cible, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

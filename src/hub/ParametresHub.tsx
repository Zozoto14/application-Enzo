/**
 * Deux boutons de l'en-tête du hub :
 *
 *  - « Mettre à jour » : pilote le mécanisme de mise à jour existant de la
 *    plateforme (voir `miseAJour.ts`) et affiche son état ;
 *  - « Paramètres » : panneau des réglages du hub (thème, personnalisation,
 *    version, mises à jour, raccourcis vers les Paramètres du portefeuille,
 *    verrouillage). Échap le ferme ; le focus y entre à l'ouverture.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BoutonHub } from './Hub';
import {
  libelleBouton,
  messageEtat,
  plateformeMaj,
  transition,
  type EtatMaj,
  type EvenementMaj,
  type PlateformeMaj,
  type ReponseVerification,
} from './miseAJour';
import { definirDensite, definirDisposition, reinitialiser, sontParDefaut, type PrefsHub } from './personnalisation';
import { THEMES_HUB, police, teinteTransparente, type IdThemeHub, type ThemeHub } from './themes';
import { versionApp } from './version';
import { ecouterTouche, rechargerApp, surLeWeb } from './web';

interface PontMaj {
  chercher?(): Promise<ReponseVerification>;
  redemarrer?(): Promise<{ ok: boolean; motif?: string } | boolean>;
}

function pontMaj(): PontMaj | undefined {
  return (globalThis as { applibourse?: { maj?: PontMaj } }).applibourse?.maj;
}

function motif(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

/** État et commandes de la mise à jour, pour le bouton et le panneau. */
export function useMiseAJour() {
  const [etat, setEtat] = useState<EtatMaj>({ phase: 'repos' });
  const plateforme: PlateformeMaj = plateformeMaj(globalThis, surLeWeb());
  const vivant = useRef(true);
  useEffect(
    () => () => {
      vivant.current = false;
    },
    [],
  );
  const envoyer = useCallback((evenement: EvenementMaj) => {
    if (vivant.current) {
      setEtat(courant => transition(courant, evenement));
    }
  }, []);

  const verifier = useCallback(() => {
    const pont = pontMaj();
    if (plateforme === 'bureau' && pont?.chercher) {
      envoyer({ type: 'verifier' });
      pont
        .chercher()
        .then(reponse => envoyer({ type: 'reponse', reponse }))
        .catch(e => envoyer({ type: 'echec', motif: motif(e) }));
    } else if (plateforme === 'web') {
      envoyer({ type: 'info', message: `Version en service : ${versionApp()}. L’actualisation recharge l’app depuis le site (il faudra la déverrouiller à nouveau).` });
    } else {
      envoyer({
        type: 'info',
        message: `Version en service : ${versionApp()}. Sur iPhone et iPad, les mises à jour signées s’installent depuis Paramètres › Mises à jour du portefeuille.`,
      });
    }
  }, [envoyer, plateforme]);

  const installer = useCallback(() => {
    const pont = pontMaj();
    if (!pont?.redemarrer) {
      envoyer({ type: 'echec', motif: 'Cette version de l’application ne sait pas redémarrer seule : relancez-la.' });
      return;
    }
    envoyer({ type: 'installer' });
    pont
      .redemarrer()
      .then(resultat => envoyer({ type: 'installe', ...(typeof resultat === 'boolean' ? { ok: resultat } : resultat) }))
      .catch(e => envoyer({ type: 'echec', motif: motif(e) }));
  }, [envoyer]);

  const actualiser = useCallback(() => {
    envoyer({ type: 'recharger' });
    rechargerApp()
      .then(fait => {
        if (!fait) {
          envoyer({ type: 'echec', motif: 'Actualisation impossible sur cette plateforme.' });
        }
      })
      .catch(e => envoyer({ type: 'echec', motif: motif(e) }));
  }, [envoyer]);

  const fermer = useCallback(() => envoyer({ type: 'fermer' }), [envoyer]);

  return { etat, plateforme, verifier, installer, actualiser, fermer };
}

type MiseAJour = ReturnType<typeof useMiseAJour>;

/** Détail de l'état de mise à jour, avec l'action qui suit. */
export function DetailMiseAJour({ theme, maj, testID }: { theme: ThemeHub; maj: MiseAJour; testID?: string }) {
  const { etat, plateforme } = maj;
  const couleur =
    etat.phase === 'erreur' ? theme.critique : etat.phase === 'a-jour' ? theme.ok : etat.phase === 'disponible' ? theme.accent : theme.attenue;
  return (
    <View style={{ gap: 10 }} testID={testID}>
      <Text accessibilityLiveRegion="polite" style={{ color: couleur, fontSize: 14, ...police(theme.policeTexte) }} testID="maj-etat">
        {messageEtat(etat, plateforme)}
      </Text>
      {etat.phase === 'disponible'
        ? etat.nouveautes.slice(0, 5).map((ligne, index) => (
            <Text key={`${index}-${ligne}`} numberOfLines={1} style={{ color: theme.attenue, fontSize: 13 }}>
              • {ligne}
            </Text>
          ))
        : null}
      <View style={styles.actions}>
        {plateforme === 'bureau' && etat.phase !== 'disponible' ? (
          <BoutonHub
            theme={theme}
            titre={etat.phase === 'verification' ? 'Vérification…' : 'Vérifier maintenant'}
            desactive={etat.phase === 'verification' || etat.phase === 'telechargement' || etat.phase === 'redemarrage'}
            onPress={maj.verifier}
            testID="maj-verifier"
          />
        ) : null}
        {etat.phase === 'disponible' ? (
          <BoutonHub theme={theme} variante="plein" titre="Installer et redémarrer" onPress={maj.installer} testID="maj-installer" />
        ) : null}
        {plateforme === 'web' ? (
          <BoutonHub
            theme={theme}
            variante="plein"
            titre={etat.phase === 'rechargement' ? 'Actualisation…' : 'Actualiser l’app'}
            desactive={etat.phase === 'rechargement'}
            onPress={maj.actualiser}
            testID="maj-actualiser"
          />
        ) : null}
      </View>
    </View>
  );
}

/** Bouton « Mettre à jour » de l'en-tête et sa bulle d'état. */
export function BoutonMiseAJour({ theme, maj }: { theme: ThemeHub; maj: MiseAJour }) {
  const [ouvert, setOuvert] = useState(false);
  const { width } = useWindowDimensions();
  useEffect(() => {
    if (!ouvert) {
      return undefined;
    }
    return ecouterTouche('Escape', () => {
      setOuvert(false);
      maj.fermer();
    });
  }, [ouvert, maj]);
  const signal = maj.etat.phase === 'disponible';
  return (
    <View style={styles.ancre}>
      <Pressable
        testID="hub-mettre-a-jour"
        accessibilityRole="button"
        accessibilityLabel={`Mettre à jour. ${messageEtat(maj.etat, maj.plateforme)}`}
        accessibilityState={{ expanded: ouvert }}
        onPress={() => {
          const suivant = !ouvert;
          setOuvert(suivant);
          if (suivant && maj.etat.phase !== 'disponible' && maj.etat.phase !== 'telechargement' && maj.etat.phase !== 'redemarrage') {
            maj.verifier();
          }
        }}
        style={(etat: { pressed: boolean; hovered?: boolean }) => [
          styles.bouton,
          {
            backgroundColor: signal ? theme.accent : theme.surface,
            borderColor: signal || etat.hovered || ouvert ? theme.accent : theme.ligne,
            borderRadius: theme.id === 'sauge' ? 999 : Math.min(theme.rayonMoyen, 10),
          },
        ]}>
        <Text style={{ color: signal ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 14, ...police(theme.policeTexte) }}>
          ⟳ {width >= 520 || signal ? (maj.etat.phase === 'repos' || maj.etat.phase === 'info' ? 'Mettre à jour' : libelleBouton(maj.etat)) : ''}
        </Text>
      </Pressable>
      {ouvert ? (
        <View
          testID="hub-maj-bulle"
          accessibilityRole="alert"
          style={[
            styles.bulle,
            { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen, width: Math.min(340, width - 32) },
          ]}>
          <Text style={{ color: theme.attenue, fontSize: 11, fontWeight: '600', letterSpacing: 1.1 }}>MISE À JOUR</Text>
          <DetailMiseAJour theme={theme} maj={maj} />
          <View style={styles.actions}>
            <BoutonHub
              theme={theme}
              titre="Fermer"
              testID="hub-maj-fermer"
              onPress={() => {
                setOuvert(false);
                maj.fermer();
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export interface PanneauParametresProps {
  theme: ThemeHub;
  prefs?: PrefsHub;
  onPrefs?(prefs: PrefsHub): void;
  onTheme(id: IdThemeHub): void;
  onPersonnaliser?(): void;
  onReglagesPortefeuille?(): void;
  onAdministration?(): void;
  onVerrouiller?(): void;
  onChangerProfil?(): void;
  nomProfil?: string;
  maj: MiseAJour;
  onFermer(): void;
}

/** Panneau « Paramètres » du hub, en surimpression. */
export function PanneauParametres(props: PanneauParametresProps) {
  const { theme, prefs, onPrefs, maj, onFermer } = props;
  const { width, height } = useWindowDimensions();
  const fermer = useRef<unknown>(null);
  useEffect(() => ecouterTouche('Escape', onFermer), [onFermer]);
  useEffect(() => {
    // Le focus entre dans le panneau : le clavier y est aussitôt.
    const noeud = fermer.current as unknown as { focus?(): void } | null;
    noeud?.focus?.();
  }, []);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const rayon = Math.min(theme.rayonMoyen, 10);
  const section = (titre: string) => (
    <Text style={[styles.section, { color: theme.attenue }]} accessibilityRole="header">
      {titre.toUpperCase()}
    </Text>
  );
  const segments = <T extends string>(libelle: string, valeur: T, options: ReadonlyArray<readonly [T, string]>, choisir: (v: T) => void, testID: string) => (
    <View style={{ gap: 6 }}>
      <Text style={[attenue, { fontSize: 13 }]}>{libelle}</Text>
      <View style={[styles.segments, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup">
        {options.map(([cle, nom]) => {
          const actif = cle === valeur;
          return (
            <Pressable
              key={cle}
              testID={`${testID}-${cle}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={`${libelle} : ${nom}`}
              onPress={() => choisir(cle)}
              style={[styles.segment, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  const etroit = width < 640;
  return (
    <View style={[StyleSheet.absoluteFill, styles.voile, { backgroundColor: teinteTransparente('#000000', 0.45) }]} testID="hub-parametres">
      <Pressable accessibilityLabel="Fermer les paramètres" style={StyleSheet.absoluteFill} onPress={onFermer} />
      <View
        accessibilityRole={'dialog' as never}
        accessibilityLabel="Paramètres du hub"
        aria-modal
        style={[
          styles.panneau,
          {
            backgroundColor: theme.surface,
            borderColor: theme.ligne,
            borderRadius: etroit ? 0 : theme.rayonMoyen,
            width: etroit ? width : Math.min(480, width - 48),
            maxHeight: etroit ? height : height - 48,
          },
          etroit && { alignSelf: 'stretch', height },
        ]}>
        <View style={styles.tete}>
          <Text style={[texte, { fontSize: 22, fontWeight: theme.poidsTitre, ...police(theme.policeTitre) }]} accessibilityRole="header">
            Paramètres
          </Text>
          <Pressable
            ref={fermer as React.Ref<never>}
            testID="hub-parametres-fermer"
            accessibilityRole="button"
            accessibilityLabel="Fermer (Échap)"
            onPress={onFermer}
            style={[styles.bouton, { borderColor: theme.ligne, borderRadius: rayon, backgroundColor: theme.surface }]}>
            <Text style={texte}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
          {section('Apparence')}
          <View style={styles.themes} accessibilityRole="radiogroup" accessibilityLabel="Thème du hub">
            {THEMES_HUB.map(candidat => {
              const choisi = candidat.id === theme.id;
              return (
                <Pressable
                  key={candidat.id}
                  testID={`parametres-theme-${candidat.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: choisi }}
                  accessibilityLabel={`Thème ${candidat.nom}`}
                  onPress={() => props.onTheme(candidat.id)}
                  style={[
                    styles.theme,
                    { borderColor: choisi ? theme.accent : theme.ligne, borderRadius: rayon, backgroundColor: candidat.fond },
                    choisi && { borderWidth: 2 },
                  ]}>
                  <View style={{ flexDirection: 'row', gap: 3 }}>
                    {[candidat.accent, candidat.teintes.portefeuille, candidat.teintes.admin].map((c, i) => (
                      <View key={i} style={{ width: 10, height: 10, backgroundColor: c, borderRadius: 3 }} />
                    ))}
                  </View>
                  <Text style={{ color: candidat.texte, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                    {candidat.nom}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {prefs && onPrefs ? (
            <>
              {segments('Disposition', prefs.disposition, [['grille', '▦ Grille'], ['liste', '☰ Liste']] as const, v => onPrefs(definirDisposition(prefs, v)), 'parametres-disposition')}
              {segments('Densité', prefs.densite, [['aere', 'Aéré'], ['compact', 'Compact']] as const, v => onPrefs(definirDensite(prefs, v)), 'parametres-densite')}
              <View style={styles.actions}>
                {props.onPersonnaliser ? (
                  <BoutonHub theme={theme} titre="✎ Personnaliser les tuiles" onPress={props.onPersonnaliser} testID="parametres-personnaliser" />
                ) : null}
                <BoutonHub
                  theme={theme}
                  titre="Réinitialiser la disposition"
                  desactive={sontParDefaut(prefs)}
                  onPress={() => onPrefs(reinitialiser())}
                  testID="parametres-reinitialiser"
                />
              </View>
            </>
          ) : null}

          {section('Application')}
          <Text style={[texte, { fontSize: 14 }]} testID="parametres-version">
            Version : <Text style={police(theme.policeChiffres)}>{versionApp()}</Text>
          </Text>
          <Text style={[attenue, { fontSize: 13 }]}>
            {maj.plateforme === 'bureau'
              ? 'Mises à jour automatiques : l’application vérifie à chaque lancement puis toutes les heures, et propose d’installer (réglage géré par le système de mise à jour du PC).'
              : maj.plateforme === 'web'
                ? 'Site web : il prend la dernière version publiée à chaque chargement ; « Actualiser l’app » vide le cache.'
                : 'iPhone / iPad : les mises à jour signées s’installent depuis les Paramètres du portefeuille.'}
          </Text>
          <DetailMiseAJour theme={theme} maj={maj} testID="parametres-maj" />

          {props.onReglagesPortefeuille || props.onAdministration ? section('Raccourcis') : null}
          <View style={styles.actions}>
            {props.onReglagesPortefeuille ? (
              <BoutonHub theme={theme} titre="Paramètres du portefeuille →" onPress={props.onReglagesPortefeuille} testID="parametres-portefeuille" />
            ) : null}
            {props.onAdministration ? (
              <BoutonHub theme={theme} titre="Administration →" onPress={props.onAdministration} testID="parametres-administration" />
            ) : null}
          </View>

          {section('Session')}
          {props.nomProfil ? <Text style={[attenue, { fontSize: 13 }]}>Profil ouvert : {props.nomProfil}</Text> : null}
          <View style={styles.actions}>
            {props.onChangerProfil ? <BoutonHub theme={theme} titre="Changer de profil" onPress={props.onChangerProfil} testID="parametres-changer-profil" /> : null}
            {props.onVerrouiller ? <BoutonHub theme={theme} titre="⏻ Verrouiller maintenant" onPress={props.onVerrouiller} testID="parametres-verrouiller" /> : null}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ancre: { position: 'relative' },
  bouton: { minHeight: 40, minWidth: 40, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bulle: {
    position: 'absolute',
    right: 0,
    top: 48,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    zIndex: 30,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  voile: { zIndex: 50, alignItems: 'center', justifyContent: 'center' },
  panneau: { borderWidth: 1, padding: 18, gap: 12 },
  tete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginTop: 6 },
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  theme: { width: 100, padding: 8, gap: 6, borderWidth: 1 },
  segments: { flexDirection: 'row', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  segment: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
});

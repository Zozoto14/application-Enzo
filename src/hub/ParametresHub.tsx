/**
 * Mise à jour, dans l'en-tête du hub : le bouton « Mettre à jour » pilote le
 * mécanisme de mise à jour existant de la plateforme (voir `miseAJour.ts`) et
 * affiche son état. Le détail (`DetailMiseAJour`) est aussi montré dans la page
 * Paramètres › À propos ; les réglages eux-mêmes sont dans `PageParametres.tsx`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { police, type ThemeHub } from './themes';
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
        message: `Version en service : ${versionApp()}. Sur iPhone et iPad, les mises à jour signées s’installent d’elles-mêmes à la réouverture (Paramètres › À propos).`,
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

export type MiseAJour = ReturnType<typeof useMiseAJour>;

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

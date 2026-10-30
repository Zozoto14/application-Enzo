/**
 * Bandeau « Nouvelle version disponible — Mettre à jour » (hub entier) : docs/mises-a-jour.md.
 *
 *  - **Site** : `src/hub/maj/version.ts` relit `version.json` (sans cache) au démarrage, au retour au premier plan et
 *    toutes les 3 minutes. Une version plus récente en ligne : ce bandeau ; un clic recharge proprement (caches vidés,
 *    page redemandée au serveur). Avec « Mettre à jour automatiquement » (Paramètres › À propos, activé par défaut),
 *    l'app se recharge d'elle-même quand elle est inactive ou en arrière-plan et qu'aucune saisie n'est en cours.
 *  - **App PC (Electron)** : l'interface est compilée sur le PC ; le pont `applibourse.maj.chercher()` regarde GitHub
 *    (toutes les 15 minutes, et au retour sur la fenêtre au plus toutes les 5 minutes) ; « Mettre à jour » récupère
 *    le code et redémarre l'app (le processus principal le fait déjà seul quand la fenêtre est cachée).
 */

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ESPACEMENT, type Palette } from '../src/ui/theme';
import { useLangue } from '../src/esport/i18n';
import { majAutoActive, surveillanceSite, type EtatSurveillance } from '../src/hub/maj/version';
import { tm } from '../src/hub/maj/textes';

const VIDE: EtatSurveillance = { rechargement: false };
const sansAbonnement = () => () => undefined;
const etatVide = () => VIDE;
const INTERVALLE_BUREAU_MS = 15 * 60_000;
const ECART_BUREAU_MS = 5 * 60_000;

interface PontMaj {
  chercher?(): Promise<{ etat: string }>;
  redemarrer?(): Promise<unknown>;
}
const pontMaj = (): PontMaj | undefined => (globalThis as { applibourse?: { maj?: PontMaj } }).applibourse?.maj;

/** App PC : nouvelle version sur GitHub (le code se récupère et se recompile au redémarrage). */
function useMajBureau(): { disponible: boolean; installer(): void; enCours: boolean } {
  const [disponible, setDisponible] = useState(false);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    const pont = pontMaj();
    if (!pont?.chercher) return undefined;
    let vivant = true;
    let derniere = -Infinity;
    const verifier = (forcer = false) => {
      if (!forcer && Date.now() - derniere < ECART_BUREAU_MS) return;
      derniere = Date.now();
      pont
        .chercher!()
        .then(r => {
          if (vivant && r?.etat === 'disponible') setDisponible(true);
        })
        .catch(() => undefined);
    };
    // Premier essai après 2 minutes : le lancement vient de récupérer le code (bandeau « Application mise à jour »).
    const premier = setTimeout(() => verifier(true), 2 * 60_000);
    const minuterie = setInterval(() => verifier(true), INTERVALLE_BUREAU_MS);
    const surFocus = () => verifier();
    window.addEventListener('focus', surFocus);
    return () => {
      vivant = false;
      clearTimeout(premier);
      clearInterval(minuterie);
      window.removeEventListener('focus', surFocus);
    };
  }, []);
  return {
    disponible,
    enCours,
    installer: () => {
      setEnCours(true);
      void pontMaj()
        ?.redemarrer?.()
        .catch(() => setEnCours(false));
    },
  };
}

export function BandeauNouvelleVersion({ palette }: { palette: Palette }) {
  useLangue();
  const surveillance = surveillanceSite();
  const etat = useSyncExternalStore(surveillance?.abonner ?? sansAbonnement, surveillance?.etat ?? etatVide, surveillance?.etat ?? etatVide);
  const bureau = useMajBureau();
  const [masque, setMasque] = useState<string | undefined>();

  const site = Boolean(etat.disponible) && masque !== etat.disponible?.id;
  if (!site && !(bureau.disponible && masque !== 'bureau')) return null;
  const enCours = site ? etat.rechargement : bureau.enCours;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" testID="bandeau-nouvelle-version" style={[styles.bandeau, { backgroundColor: palette.accentFond, borderColor: palette.accent }]}>
      <View style={styles.texte}>
        <Text style={{ color: palette.texte, fontSize: 14, fontWeight: '700' }}>✨ {tm('bandeau.texte')}</Text>
        {site && majAutoActive() ? <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{tm('bandeau.auto')}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tm('bandeau.texte')} — ${tm('bandeau.bouton')}`}
        testID="nouvelle-version-recharger"
        disabled={enCours}
        onPress={() => (site ? void surveillance?.mettreAJour() : bureau.installer())}
        style={({ pressed }) => [styles.bouton, { backgroundColor: palette.accentPlein, borderColor: palette.accentPlein, opacity: pressed || enCours ? 0.8 : 1 }]}>
        <Text style={{ color: palette.surAccent, fontWeight: '700', fontSize: 13 }}>{enCours ? tm('bandeau.encours') : site ? tm('bandeau.bouton') : tm('bandeau.bouton_bureau')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="nouvelle-version-plus-tard"
        onPress={() => setMasque(site ? etat.disponible?.id : 'bureau')}
        style={({ pressed }) => [styles.bouton, { borderColor: palette.bordure, opacity: pressed ? 0.8 : 1 }]}>
        <Text style={{ color: palette.texte, fontSize: 13 }}>{tm('bandeau.plus_tard')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bandeau: { flexDirection: 'row', alignItems: 'center', gap: ESPACEMENT.s, paddingVertical: 8, paddingHorizontal: ESPACEMENT.m, borderBottomWidth: 1, flexWrap: 'wrap' },
  texte: { flex: 1, minWidth: 200, gap: 2 },
  bouton: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' },
});

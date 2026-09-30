/**
 * Verrouillage automatique de toute l'application (toutes les pages).
 *
 * `GardeInactivite` entoure l'application : il écoute les vraies actions de
 * l'utilisateur (souris, clavier, toucher, défilement, focus et visibilité sur
 * le web et Electron ; touchers et retour au premier plan en natif), vérifie
 * l'horloge chaque seconde et à chaque reprise (mise en veille, onglet masqué),
 * et appelle `onVerrouiller` à l'échéance. La logique de décision est pure :
 * voir `securite/verrouAuto.ts`.
 *
 * Pendant une lecture (film, épisode), un lecteur le déclare avec
 * `utiliserLectureEnCours(true)` (ou `utiliserPresence().declarerLecture`).
 * À l'échéance, au lieu de verrouiller, on demande « Êtes-vous toujours là ? »
 * avec un compte à rebours de 60 s ; sans réponse, l'application se verrouille.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { DELAI_PRESENCE_SECONDES, SAUT_VEILLE_MS, confirmerPresence, etatInitial, evaluer, noterActivite, type MotifVerrou } from '../securite/verrouAuto';
import { ContextePresence, type Presence } from '../securite/presence';
import { BoutonHub } from './Hub';
import { police, type ThemeHub } from './themes';
import { ecouterTouche } from './web';

export { utiliserLectureEnCours, utiliserPresence } from '../securite/presence';

interface CibleEvenements {
  addEventListener(type: string, rappel: () => void, options?: unknown): void;
  removeEventListener(type: string, rappel: () => void, options?: unknown): void;
}

const EVENEMENTS_ACTIVITE = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'pointerdown', 'scroll', 'focus'] as const;

export interface PropsGardeInactivite {
  theme: ThemeHub;
  /** Faux quand l'application est verrouillée : rien n'est mesuré. */
  actif: boolean;
  /** Délai en minutes ; 0 : jamais. */
  delaiMinutes: number;
  onVerrouiller(motif: MotifVerrou): void;
  /** Horloge (ms), injectable pour les tests ; `Date.now` à défaut. */
  horloge?: () => number;
  /** Période de vérification, 1 s à défaut. */
  pasMs?: number;
  presenceSecondes?: number;
  /** Cible des événements (document à défaut) : injectable pour les tests. */
  cible?: CibleEvenements;
  children?: React.ReactNode;
}

export function GardeInactivite({ theme, actif, delaiMinutes, onVerrouiller, horloge = Date.now, pasMs = 1000, presenceSecondes = DELAI_PRESENCE_SECONDES, cible, children }: PropsGardeInactivite) {
  const etat = useRef(etatInitial(horloge()));
  const lectures = useRef(0);
  const [restantes, setRestantes] = useState<number | undefined>();
  // Les valeurs courantes sont lues par les écouteurs sans les réinscrire.
  const courant = useRef({ actif, delaiMinutes, onVerrouiller, horloge, presenceSecondes });
  courant.current = { actif, delaiMinutes, onVerrouiller, horloge, presenceSecondes };

  const verifier = useCallback(() => {
    const c = courant.current;
    if (!c.actif) {
      return;
    }
    const maintenant = c.horloge();
    const { etat: suivant, decision } = evaluer(etat.current, maintenant, { delaiMinutes: c.delaiMinutes, lecture: lectures.current > 0, presenceSecondes: c.presenceSecondes });
    etat.current = suivant;
    if (decision.action === 'verrouiller') {
      etat.current = etatInitial(maintenant);
      setRestantes(undefined);
      c.onVerrouiller(decision.motif);
    } else {
      setRestantes(decision.action === 'demander' ? decision.secondesRestantes : undefined);
    }
  }, []);

  const activite = useCallback(() => {
    const c = courant.current;
    if (!c.actif) {
      return;
    }
    const maintenant = c.horloge();
    // Après une longue pause (veille), l'échéance est jugée AVANT de compter ce geste comme une activité :
    // l'évènement de reprise (focus, souris) ne doit pas faire oublier le délai dépassé.
    if (maintenant - etat.current.verifieLe >= SAUT_VEILLE_MS) {
      verifier();
      if (!courant.current.actif) {
        return;
      }
    }
    etat.current = noterActivite(etat.current, maintenant);
  }, [verifier]);

  // Repart de zéro à chaque déverrouillage (et à chaque changement de délai : le nouveau se compte depuis maintenant).
  useEffect(() => {
    etat.current = etatInitial(horloge());
    setRestantes(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `horloge` est stable pour un montage.
  }, [actif, delaiMinutes]);

  useEffect(() => {
    if (!actif) {
      return undefined;
    }
    const minuterie = setInterval(verifier, pasMs);
    // Natif : `document` et `window` n'existent pas, ou sans `addEventListener` (simulations).
    const valide = (c: CibleEvenements | undefined) => (c && typeof c.addEventListener === 'function' && typeof c.removeEventListener === 'function' ? c : undefined);
    const document = valide(cible ?? (globalThis as { document?: CibleEvenements }).document);
    const fenetre = valide(cible ?? (globalThis as { window?: CibleEvenements }).window);
    const options = { capture: true, passive: true };
    for (const nom of EVENEMENTS_ACTIVITE) {
      (nom === 'focus' ? fenetre : document)?.addEventListener(nom, activite, options);
    }
    document?.addEventListener('visibilitychange', verifier);
    let abonnement: { remove(): void } | undefined;
    try {
      abonnement = AppState.addEventListener('change', etatApp => {
        if (etatApp === 'active') {
          verifier();
        }
      });
    } catch {
      abonnement = undefined;
    }
    return () => {
      clearInterval(minuterie);
      for (const nom of EVENEMENTS_ACTIVITE) {
        (nom === 'focus' ? fenetre : document)?.removeEventListener(nom, activite, options);
      }
      document?.removeEventListener('visibilitychange', verifier);
      abonnement?.remove();
    };
  }, [actif, pasMs, cible, verifier, activite]);

  const declarerLecture = useCallback((enCours: boolean) => {
    lectures.current = Math.max(0, lectures.current + (enCours ? 1 : -1));
  }, []);
  const presence = useMemo<Presence>(() => ({ declarerLecture }), [declarerLecture]);

  const jeSuisLa = useCallback(() => {
    etat.current = confirmerPresence(etat.current, courant.current.horloge());
    setRestantes(undefined);
  }, []);
  const verrouillerMaintenant = useCallback(() => {
    etat.current = etatInitial(courant.current.horloge());
    setRestantes(undefined);
    courant.current.onVerrouiller('manuel');
  }, []);
  const dialogue = actif && restantes !== undefined;
  useEffect(() => (dialogue ? ecouterTouche('Enter', jeSuisLa) : undefined), [dialogue, jeSuisLa]);

  return (
    <ContextePresence.Provider value={presence}>
      {/* Natif : un toucher, où qu'il tombe, compte comme une activité (sans prendre la main sur l'enfant). */}
      <View style={styles.racine} onTouchStart={activite} onTouchMove={activite}>
        {children}
        {dialogue ? (
          <View style={[StyleSheet.absoluteFill, styles.voile]} accessibilityViewIsModal testID="presence-voile">
            <View
              accessibilityRole="alert"
              accessibilityLabel="Êtes-vous toujours là ?"
              style={[styles.boite, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonGrand }]}
              testID="presence-dialogue">
              <Text style={{ color: theme.texte, fontSize: 20, fontWeight: theme.poidsTitre, ...police(theme.policeTitre) }} accessibilityRole="header">
                Êtes-vous toujours là ?
              </Text>
              <Text style={{ color: theme.attenue, fontSize: 14, lineHeight: 20, ...police(theme.policeTexte) }}>
                Une lecture est en cours et vous n’avez rien touché depuis un moment. Sans réponse, l’application se verrouille.
              </Text>
              <Text accessibilityLiveRegion="polite" style={{ color: theme.alerte, fontSize: 16, fontWeight: '700', ...police(theme.policeTexte) }} testID="presence-compte">
                Verrouillage dans {restantes} s
              </Text>
              <View style={styles.actions}>
                <BoutonHub theme={theme} variante="plein" titre="Je suis là" onPress={jeSuisLa} testID="presence-suis-la" />
                <BoutonHub theme={theme} titre="Verrouiller maintenant" onPress={verrouillerMaintenant} testID="presence-verrouiller" />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </ContextePresence.Provider>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  voile: { backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 },
  boite: { width: '100%', maxWidth: 420, borderWidth: 1, padding: 20, gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

/**
 * Indicateur de connexion au serveur : petit point coloré + pictogramme + texte
 * (l'état ne repose jamais sur la seule couleur). Il n'y a plus de réglage de
 * synchronisation (tout est sur le serveur) : la version détaillée (Paramètres ›
 * Général) n'offre qu'un bouton « Réessayer », quand quelque chose attend ou a échoué.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BoutonHub } from './Hub';
import { useMobile } from '../ui/mobile/useMobile';
import { resumerSynchro, type NiveauSynchro, type VueSynchroHub } from './etatSynchro';
import { police, type ThemeHub } from './themes';

export interface SynchroHub {
  vue: VueSynchroHub;
  onSynchroniser(): void;
}

function couleur(theme: ThemeHub, niveau: NiveauSynchro): string {
  return niveau === 'ok' ? theme.ok : niveau === 'erreur' ? theme.critique : niveau === 'attente' ? theme.alerte : theme.accent;
}

/** Heure courante, rafraîchie chaque 20 s pour que « il y a 2 min » avance. */
function useMaintenant(): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  return maintenant;
}

/** Libellé court de la version condensée (téléphone) : « À jour », « 2 à envoyer », « Hors ligne »… */
export function libelleCondense(resume: { niveau: NiveauSynchro; libelle: string }): string {
  const nombre = /^(\d+) élément/.exec(resume.libelle)?.[1];
  if (resume.niveau === 'encours') return 'Synchro…';
  if (resume.niveau === 'erreur') return 'Échec synchro';
  if (resume.niveau === 'attente') return /hors ligne/i.test(resume.libelle) ? 'Hors ligne' : nombre ? `${nombre} à envoyer` : 'En attente';
  return resume.libelle.startsWith('Pas encore') ? 'Non synchronisé' : 'À jour';
}

export function IndicateurSynchro({
  theme,
  synchro,
  detaille = false,
  condense = false,
  onPress,
}: {
  theme: ThemeHub;
  synchro: SynchroHub;
  detaille?: boolean;
  /** Version de l'en-tête du téléphone : point + libellé court, zone tactile de 44 px. */
  condense?: boolean;
  onPress?(): void;
}) {
  const maintenant = useMaintenant();
  const resume = resumerSynchro(synchro.vue, maintenant);
  const mobile = useMobile();
  const taille = mobile ? 15 : 13;
  const teinte = couleur(theme, resume.niveau);
  const rayon = Math.min(theme.rayonMoyen, 10);
  // Cliquable (« ouvrir Paramètres › Général › Connexion au serveur ») quand l'hôte donne `onPress`.
  const Pastille: React.ComponentType<Record<string, unknown>> = onPress ? Pressable : View;
  return (
    <View style={detaille ? { gap: 10 } : undefined}>
      <Pastille
        testID="synchro-indicateur"
        accessible
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Serveur : ${resume.libelle}${onPress ? ' (ouvrir l’état de la connexion)' : ''}`}
        onPress={onPress}
        title={resume.detail} // infobulle (web)
        style={[
          styles.pastille,
          { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: detaille ? rayon : 999 },
          mobile && onPress && styles.pastilleMobile,
          condense && styles.condense,
        ]}>
        <View style={[styles.point, { backgroundColor: teinte }]} />
        {condense ? null : <Text style={{ color: teinte, fontWeight: '800', fontSize: taille }}>{resume.icone}</Text>}
        <Text testID="synchro-libelle" style={{ color: theme.texte, fontSize: taille, fontWeight: '600', flexShrink: 1, ...police(theme.policeTexte) }} numberOfLines={detaille ? 3 : 1}>
          {condense ? libelleCondense(resume) : resume.libelle}
        </Text>
      </Pastille>
      {detaille ? (
        <>
          {resume.detail ? (
            <Text testID="synchro-detail" style={{ color: theme.attenue, fontSize: taille, ...police(theme.policeTexte) }}>
              {resume.detail}
            </Text>
          ) : null}
          {resume.niveau === 'erreur' || resume.niveau === 'attente' ? (
            <View style={styles.actions}>
              <BoutonHub theme={theme} titre="Réessayer" onPress={synchro.onSynchroniser} testID="synchro-maintenant" />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pastille: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  point: { width: 8, height: 8, borderRadius: 4 },
  pastilleMobile: { minHeight: 44 },
  condense: { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 8, maxWidth: 170 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

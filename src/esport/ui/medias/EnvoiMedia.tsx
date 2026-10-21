/**
 * Envoi d'une vidéo ou d'un enregistrement depuis l'interface : choix du fichier, barre de progression
 * (pourcentage, Mo envoyés, débit, nouvel essai après une coupure), annulation, et avertissement de
 * format (« peu compatible avec iPhone »). La logique est dans src/esport/medias/envoi.ts.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { InfosMedia } from '../../client';
import { envoyerFichier, tailleMedia, type EtatEnvoi, type OptionsEnvoi, type Progression } from '../../medias/envoi';
import { langueCourante, tr } from '../../i18n';

export function useEnvoi() {
  const [progression, setProgression] = useState<Progression | undefined>();
  const [enCours, setEnCours] = useState(false);
  const controleur = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controleur.current?.abort(), []);
  const lancer = useCallback(async (options: Omit<OptionsEnvoi, 'onProgression' | 'signal'>): Promise<{ etat: EtatEnvoi; oublier(): void }> => {
    const c = new AbortController();
    controleur.current = c;
    setEnCours(true);
    try {
      return await envoyerFichier({ ...options, signal: c.signal, onProgression: setProgression });
    } finally {
      setEnCours(false);
      if (controleur.current === c) controleur.current = undefined;
    }
  }, []);
  const annuler = useCallback(() => controleur.current?.abort(), []);
  const effacer = useCallback(() => setProgression(undefined), []);
  return { progression, enCours, lancer, annuler, effacer };
}

const pourcent = (p: Progression) => (p.total > 0 ? Math.min(100, Math.floor((p.octets / p.total) * 100)) : 0);

export function BarreEnvoi({ theme, progression: p, enCours, onAnnuler, testID = 'esport-envoi' }: { theme: ThemeHub; progression?: Progression; enCours: boolean; onAnnuler(): void; testID?: string }) {
  if (!p) return null;
  const l = langueCourante();
  const pc = pourcent(p);
  const phase =
    p.phase === 'preparation'
      ? tr('medias.envoi.preparation')
      : p.phase === 'reprise'
        ? tr('medias.envoi.reprise', { v: pc })
        : p.phase === 'verification'
          ? tr('medias.envoi.verification')
          : p.phase === 'termine'
            ? tr('medias.envoi.termine')
            : tr('medias.envoi.en_cours', { v: pc, envoye: tailleMedia(p.octets, l), total: tailleMedia(p.total, l) });
  return (
    <View testID={testID} style={{ gap: 6 }}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={tr('medias.envoi.progression')}
        accessibilityValue={{ min: 0, max: 100, now: pc }}
        style={{ height: 10, borderRadius: 999, backgroundColor: teinteTransparente(theme.accent, 0.18), overflow: 'hidden' }}>
        <View testID={`${testID}-barre`} style={{ width: `${pc}%`, height: '100%', backgroundColor: p.phase === 'termine' ? theme.ok : theme.accent }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text testID={`${testID}-etat`} style={{ color: theme.texte, fontSize: 13, flex: 1, minWidth: 180, ...police(theme.policeTexte) }}>
          {phase}
          {p.debit && p.phase === 'envoi' ? ` · ${tr('medias.envoi.debit', { v: tailleMedia(p.debit, l) })}` : ''}
          {p.essai ? ` · ${tr('medias.envoi.nouvel_essai', { v: p.essai })}` : ''}
        </Text>
        {enCours ? <BoutonHub theme={theme} titre={tr('medias.envoi.annuler')} onPress={onAnnuler} testID={`${testID}-annuler`} /> : null}
      </View>
    </View>
  );
}

/** Résumé du fichier choisi ou envoyé : nom, taille, format et avertissement iPhone. */
export function InfosFichier({ theme, nom, taille, media, testID }: { theme: ThemeHub; nom: string; taille: number; media?: InfosMedia | null; testID?: string }) {
  const l = langueCourante();
  const details = [tailleMedia(taille, l), media?.nomFormat, media?.codecVideo ? media.codecVideo.toUpperCase() : null, media?.duree ? `${Math.round(media.duree)} s` : null].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: 2 }} testID={testID}>
      <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }} numberOfLines={1}>
        {nom}
      </Text>
      <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{details}</Text>
      {media?.peuCompatibleIphone ? (
        <Text testID={testID ? `${testID}-iphone` : undefined} style={{ color: theme.alerte, fontSize: 12, ...police(theme.policeTexte) }}>
          {tr('medias.peu_compatible_iphone')}
        </Text>
      ) : null}
    </View>
  );
}

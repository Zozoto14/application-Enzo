/**
 * Drapeau d'urgence d'une carte (docs/esport/cm.md, « Urgences ») : icône drapeau monochrome colorée par niveau
 * (couleurs de contraste AA en thème clair et sombre), et sélecteur rapide à cinq choix (aucun, faible, moyen, urgent,
 * critique). La couleur n'est jamais seule : chaque niveau a son libellé (lecteurs d'écran, infobulle, sélecteur).
 */

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, Text, View } from 'react-native';
import { Segments } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { Urgence } from '../../cm/api';
import { NIVEAUX_URGENCE, barresUrgence, cleLibelleUrgence, couleurUrgence, jetonUrgence, melanger } from '../../cm/urgence';
import { encreSur } from '../../contraste';
import { trCm, type CleCm } from '../../i18n/cm';
import { Icone } from '../../../ui/icones';
import { ESP, texte, type EtatPresse } from '../design';

export const libelleUrgence = (n: Urgence | null | undefined): string => (n ? trCm(cleLibelleUrgence(n)) : trCm('urgence.aucune'));

/** Vrai quand le système demande moins d'animations (`prefers-reduced-motion` sur le web). */
export function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(false);
  useEffect(() => {
    let vivant = true;
    AccessibilityInfo.isReduceMotionEnabled?.()?.then(v => vivant && setReduit(Boolean(v)), () => undefined);
    const abo = AccessibilityInfo.addEventListener?.('reduceMotionChanged', v => setReduit(Boolean(v)));
    return () => {
      vivant = false;
      abo?.remove?.();
    };
  }, []);
  return reduit;
}

/** Barres du niveau (1 à 4, de plus en plus hautes) : la forme porte l'information en plus de la couleur. */
export function BarresUrgence({ niveau, encre, hauteur = 10 }: { niveau: Urgence; encre: string; hauteur?: number }) {
  const n = barresUrgence(niveau);
  const unite = hauteur / 4;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: hauteur }} testID={`urgence-barres-${niveau}`} {...({ 'data-barres': n } as object)}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={{ width: Math.max(2, Math.round(hauteur / 4)), height: Math.round(unite * i), borderRadius: 1, backgroundColor: encre, opacity: i <= n ? 1 : 0.3 }} />
      ))}
    </View>
  );
}

/**
 * Pastille texte du niveau : fond plein, drapeau, libellé en petites capitales et barres (texte AA sur le fond).
 * `grande` : fiche et sélecteur ; sinon carte compacte, Accueil CM, calendrier.
 */
export function PastilleUrgence({ theme, niveau, grande = false, testID, sansLibelleAccessible }: { theme: ThemeHub; niveau: Urgence; grande?: boolean; testID?: string; sansLibelleAccessible?: boolean }) {
  const j = jetonUrgence(niveau, theme.sombre);
  const taille = grande ? 14 : 11;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={sansLibelleAccessible ? undefined : trCm('urgence.carte', { niveau: libelleUrgence(niveau) })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: grande ? 6 : 4, alignSelf: 'flex-start', backgroundColor: j.fond, borderRadius: 4, paddingHorizontal: grande ? 8 : 5, height: grande ? 24 : 18 }}
      {...({ title: trCm('urgence.carte', { niveau: libelleUrgence(niveau) }) } as object)}>
      <Icone nom="drapeau" taille={taille + 1} couleur={j.encre} />
      <Text style={{ color: j.encre, fontSize: taille, fontWeight: '800', letterSpacing: grande ? 0.8 : 0.6, lineHeight: taille + 3 }} numberOfLines={1}>
        {libelleUrgence(niveau).toUpperCase()}
      </Text>
      <BarresUrgence niveau={niveau} encre={j.encre} hauteur={grande ? 12 : 9} />
    </View>
  );
}

/** Bande verticale épaisse du bord gauche de la carte ; pulsation douce pour Critique (jamais avec `prefers-reduced-motion`). */
export function BandeUrgence({ theme, niveau, testID }: { theme: ThemeHub; niveau: Urgence; testID?: string }) {
  const reduit = useMouvementReduit();
  const pulse = useRef(new Animated.Value(1)).current;
  const pulse_ = niveau === 'critique' && !reduit;
  useEffect(() => {
    if (!pulse_) {
      pulse.setValue(1);
      return undefined;
    }
    const boucle = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      ]),
    );
    boucle.start();
    return () => boucle.stop();
  }, [pulse_, pulse]);
  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: couleurUrgence(niveau, theme.sombre), opacity: pulse }}
      {...({ 'data-pulsation': pulse_ ? 'oui' : 'non' } as object)}
    />
  );
}

/** Compteur d'en-tête de colonne et de tableau : pastille colorée, drapeau et nombre (libellé lu en toutes lettres). */
export function CompteurUrgence({ theme, niveau, n, libelle, testID }: { theme: ThemeHub; niveau: Urgence; n: number; libelle: string; testID: string }) {
  const j = jetonUrgence(niveau, theme.sombre);
  return (
    <View accessible accessibilityLabel={libelle} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: j.fond, borderRadius: 9, paddingHorizontal: 6, height: 18, minWidth: 30, justifyContent: 'center' }} testID={testID}>
      <Icone nom="drapeau" taille={11} couleur={j.encre} />
      <Text style={{ color: j.encre, fontSize: 12, fontWeight: '800', lineHeight: 15 }}>{String(n)}</Text>
    </View>
  );
}

/** Bandeau du haut de la fiche : niveau en grand sur toute la largeur (rien si la carte n'a pas de drapeau). */
export function BandeauUrgence({ theme, niveau, testID = 'esport-cm-fiche-urgence-bandeau' }: { theme: ThemeHub; niveau: Urgence | null | undefined; testID?: string }) {
  if (!niveau) return null;
  const j = jetonUrgence(niveau, theme.sombre);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="header"
      accessibilityLabel={trCm('urgence.carte', { niveau: libelleUrgence(niveau) })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, backgroundColor: j.fond, borderRadius: 10, paddingHorizontal: ESP.m, paddingVertical: ESP.s, minHeight: 56 }}>
      <Icone nom="drapeau" taille={26} couleur={j.encre} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: j.encre, fontSize: 22, fontWeight: '800', letterSpacing: 1.2, lineHeight: 28 }} numberOfLines={1}>
          {libelleUrgence(niveau).toUpperCase()}
        </Text>
        <Text style={{ color: j.encre, fontSize: 13, fontWeight: '500' }} numberOfLines={2}>
          {trCm(`urgence.sens.${niveau}` as CleCm)}
        </Text>
      </View>
      <BarresUrgence niveau={niveau} encre={j.encre} hauteur={22} />
    </View>
  );
}

/** Légende des couleurs : une pastille et son sens par niveau, et l'explication des barres. */
export function LegendeUrgence({ theme, testID = 'esport-cm-urgence-legende' }: { theme: ThemeHub; testID?: string }) {
  return (
    <View testID={testID} style={{ gap: ESP.xs, padding: ESP.s, borderRadius: 10, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
      <Text accessibilityRole="header" style={{ ...texte(theme, 13), fontWeight: '700' }}>
        {trCm('urgence.legende')}
      </Text>
      {([...NIVEAUX_URGENCE].reverse() as Urgence[]).map(n => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
          <PastilleUrgence theme={theme} niveau={n} sansLibelleAccessible testID={`${testID}-${n}`} />
          <Text style={{ ...texte(theme, 13), flexShrink: 1 }}>{trCm(`urgence.sens.${n}` as CleCm)}</Text>
        </View>
      ))}
      <Text style={{ ...texte(theme, 12), color: theme.attenue }}>{trCm('urgence.legende_aide')}</Text>
    </View>
  );
}

/** Drapeau seul (décoratif : le libellé est porté par le parent, ou par `libelle` quand il est isolé). */
export function Drapeau({ theme, niveau, taille = 15, libelle, testID }: { theme: ThemeHub; niveau: Urgence; taille?: number; libelle?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={{ width: taille + 2, height: taille + 2, alignItems: 'center', justifyContent: 'center' }} {...({ title: trCm('urgence.carte', { niveau: libelleUrgence(niveau) }) } as object)}>
      <Icone nom="drapeau" taille={taille} couleur={couleurUrgence(niveau, theme.sombre)} libelle={libelle ? trCm('urgence.carte', { niveau: libelleUrgence(niveau) }) : undefined} />
    </View>
  );
}

/** Sélecteur rapide du niveau (fiche de la carte, volet du menu ⋯). `editer` faux : lecture seule du niveau actuel. */
export function SelecteurUrgence({ theme, valeur, editer, onChoisir, testID = 'esport-cm-urgence' }: { theme: ThemeHub; valeur: Urgence | null | undefined; editer: boolean; onChoisir(n: Urgence | null): void; testID?: string }) {
  const options: Array<Urgence | null> = [null, ...NIVEAUX_URGENCE];
  if (!editer && !valeur) return null;
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('urgence.regler')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }} accessibilityRole="radiogroup" accessibilityLabel={trCm('urgence.regler')}>
        {options.map(n => {
          if (!editer && n !== (valeur ?? null)) return null;
          const actif = (valeur ?? null) === n;
          const j = n ? jetonUrgence(n, theme.sombre) : null;
          const couleur = j ? j.trait : theme.attenue;
          return (
            <Pressable
              key={n ?? 'aucune'}
              disabled={!editer}
              testID={`${testID}-${n ?? 'aucune'}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif, disabled: !editer }}
              accessibilityLabel={libelleUrgence(n)}
              onPress={() => onChoisir(n)}
              style={(e: EtatPresse) => ({
                minHeight: 52,
                minWidth: n ? 112 : 84,
                flexGrow: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 2,
                borderColor: couleur,
                backgroundColor: actif ? (j ? j.fond : theme.attenue) : melanger(theme.surface, couleur, e.hovered || e.focused ? 0.2 : 0.1),
              })}>
              {n && j ? <Icone nom="drapeau" taille={18} couleur={actif ? j.encre : j.trait} /> : null}
              <Text style={{ color: actif ? (j ? j.encre : encreSur(theme.attenue)) : theme.texte, fontSize: 14, fontWeight: '800', letterSpacing: n ? 0.6 : 0 }}>{n ? libelleUrgence(n).toUpperCase() : libelleUrgence(n)}</Text>
              {n && j ? <BarresUrgence niveau={n} encre={actif ? j.encre : j.trait} hauteur={14} /> : null}
              {actif ? <Text style={{ color: j ? j.encre : encreSur(theme.attenue), fontSize: 16, fontWeight: '800' }}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Valeur d'un filtre d'urgence à choix unique ('' : toutes). */
export type FiltreUrgence = Urgence | 'aucune' | '';

/** La carte passe-t-elle le filtre d'urgence ? */
export const passeFiltreUrgence = (filtre: FiltreUrgence, urgence: Urgence | null | undefined): boolean => !filtre || (urgence ?? 'aucune') === filtre;

/** Filtre par niveau (À valider, calendrier éditorial) : un seul niveau à la fois, et bouton « ? » qui déplie la légende. */
export function FiltreUrgenceCm({ theme, valeur, onChoisir, testID }: { theme: ThemeHub; valeur: FiltreUrgence; onChoisir(v: FiltreUrgence): void; testID: string }) {
  const [legende, setLegende] = useState(false);
  return (
    <View style={{ gap: ESP.xs }}>
      <View style={{ gap: ESP.xs }}>
        <Segments
          theme={theme}
          libelle={trCm('urgence.filtre')}
          valeur={valeur}
          options={[
            ['', trCm('filtres.echeance.toutes')],
            ...([...NIVEAUX_URGENCE].reverse().map(n => [n, libelleUrgence(n)]) as Array<[FiltreUrgence, string]>),
            ['aucune', trCm('urgence.filtre_aucune')],
          ]}
          onChoisir={v => onChoisir(v as FiltreUrgence)}
          testID={testID}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: legende }}
          accessibilityLabel={legende ? trCm('urgence.legende_masquer') : trCm('urgence.legende')}
          onPress={() => setLegende(v => !v)}
          testID={`${testID}-legende-bouton`}
          style={{ alignSelf: 'flex-start', width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...texte(theme, 16), fontWeight: '800' }}>?</Text>
        </Pressable>
      </View>
      {legende ? <LegendeUrgence theme={theme} testID={`${testID}-legende`} /> : null}
    </View>
  );
}

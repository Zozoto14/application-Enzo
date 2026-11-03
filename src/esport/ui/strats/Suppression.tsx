/**
 * Briques de la suppression des strats : bouton poubelle visible, confirmation qui nomme la strat, toast
 * « Supprimée — Annuler » (restauration possible quelques secondes), et corbeille de 30 jours.
 * La suppression est « douce » côté serveur : restaurer remet la strat (et ses entrées du playbook) telle quelle.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View, type ViewStyle } from 'react-native';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import type { apiStrats, StratCorbeille } from '../../strats/api';
import { LIBELLES_SIDE, LIBELLES_TYPE_STRAT } from '../../strats/libelles';
import { trSs } from '../../i18n/stratsSuppr';
import { Etiquette, Miniature } from './commun';
import { Retours, styles, useAgir, Intertitre, Panneau } from '../commun';
import { Carte, ESP, EtatVide, Grille, ombre, rayonControle } from '../design';

/** Durée d'affichage du toast « Annuler ». */
export const DUREE_TOAST_MS = 8000;

/** Bouton poubelle (44 px au toucher), rouge, avec le nom de la strat pour les lecteurs d'écran. */
export function BoutonPoubelle({ theme, libelle, onPress, testID }: { theme: ThemeHub; libelle: string; onPress(): void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      onPress={onPress}
      style={(etat: { pressed: boolean; hovered?: boolean }) => ({
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.critique,
        backgroundColor: etat.hovered || etat.pressed ? `${theme.critique}22` : theme.surface,
        borderRadius: rayonControle(theme),
      })}>
      <Text style={{ fontSize: 18, color: theme.critique }} accessible={false}>
        🗑︎
      </Text>
    </Pressable>
  );
}

/** Confirmation claire : nomme ce qui sera supprimé et rappelle la corbeille. */
export function ConfirmationSuppression({
  theme,
  titre,
  texte,
  details,
  oui,
  onConfirmer,
  onAnnuler,
  desactive,
  testID,
}: {
  theme: ThemeHub;
  titre: string;
  texte: string;
  /** Noms des strats concernées (sélection multiple). */
  details?: string[];
  oui: string;
  onConfirmer(): void;
  onAnnuler(): void;
  desactive?: boolean;
  testID: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      testID={testID}
      style={{ gap: ESP.xs, padding: ESP.s, borderWidth: 1, borderColor: theme.critique, borderRadius: rayonControle(theme) === 999 ? 18 : rayonControle(theme), backgroundColor: `${theme.critique}12` }}>
      <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }} testID={`${testID}-titre`}>
        {titre}
      </Text>
      {details?.length ? (
        <Text style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }} testID={`${testID}-noms`}>
          {details.slice(0, 6).map(n => `« ${n} »`).join(', ')}
          {details.length > 6 ? ` +${details.length - 6}` : ''}
        </Text>
      ) : null}
      <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{texte}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre={oui} variante="danger" desactive={desactive} onPress={onConfirmer} testID={`${testID}-confirmer`} />
        <BoutonHub theme={theme} titre={trSs('confirm.non')} onPress={onAnnuler} testID={`${testID}-annuler`} />
      </View>
    </View>
  );
}

/**
 * Toast bas de page : message, bouton « Annuler » (facultatif) et fermeture ; disparaît seul après quelques
 * secondes. `cle` change à chaque nouveau toast (la minuterie repart).
 */
export function ToastAnnuler({
  theme,
  cle,
  texte,
  action,
  onFermer,
  duree = DUREE_TOAST_MS,
  testID = 'esport-toast',
}: {
  theme: ThemeHub;
  cle: string;
  texte: string;
  action?: { titre: string; onPress(): void };
  onFermer(): void;
  duree?: number;
  testID?: string;
}) {
  useEffect(() => {
    const t = setTimeout(onFermer, duree);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la minuterie ne repart que pour un nouveau toast
  }, [cle, duree]);
  const position = (Platform.OS === 'web' ? { position: 'fixed', bottom: 16, left: 16, right: 16 } : { position: 'absolute', bottom: 12, left: 12, right: 12 }) as ViewStyle;
  return (
    <View pointerEvents="box-none" style={[position, { alignItems: 'center', zIndex: 1000 }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={testID}
        style={[
          { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: ESP.s, maxWidth: 560, width: '100%', paddingVertical: ESP.xs, paddingLeft: ESP.m, paddingRight: ESP.xs, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: rayonControle(theme) === 999 ? 24 : rayonControle(theme) + 4 },
          ombre(theme, true),
        ]}>
        <Text style={{ flex: 1, minWidth: 160, color: theme.texte, fontSize: 14, fontWeight: '600', ...police(theme.policeTexte) }} testID={`${testID}-texte`}>
          {texte}
        </Text>
        {action ? <BoutonHub theme={theme} titre={action.titre} variante="plein" onPress={action.onPress} testID={`${testID}-annuler`} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={trSs('toast.fermer')} onPress={onFermer} testID={`${testID}-fermer`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.attenue, fontSize: 16 }} accessible={false}>
            ✕
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Corbeille des strats : celles que l'on peut restaurer, avec la date d'effacement définitif. */
export function CorbeilleStrats({ theme, api, teamId, large, onRestauree }: { theme: ThemeHub; api: ReturnType<typeof apiStrats>; teamId: string; large: boolean; onRestauree(titre: string): void }) {
  const [strats, setStrats] = useState<StratCorbeille[] | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setStrats(await api.corbeille(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: ESP.m }} testID="esport-strats-corbeille-vue">
      <Retours theme={theme} erreur={erreur} prefixe="esport-strats-corbeille" />
      <Text style={{ ...attenue, fontSize: 13 }}>{trSs('corbeille.aide')}</Text>
      {strats && strats.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="🗑︎" titre={trSs('corbeille.vide')} />
        </Carte>
      ) : null}
      <Grille min={large ? 260 : 280}>
        {strats?.map(s => (
          <Panneau key={s.id} theme={theme} style={{ gap: ESP.s, height: '100%' }} testID={`esport-corbeille-${s.id}`}>
            <Miniature theme={theme} url={s.miniature?.url} carte={s.carte.nom} taille={large ? 110 : 150} />
            <Intertitre theme={theme}>{s.titre}</Intertitre>
            <View style={[styles.ligne, { gap: 4 }]}>
              <Etiquette theme={theme} texte={s.carte.nom} />
              <Etiquette theme={theme} texte={LIBELLES_SIDE[s.side]} />
              <Etiquette theme={theme} texte={LIBELLES_TYPE_STRAT[s.type]} />
            </View>
            <Text style={attenue}>{trSs('corbeille.par', { qui: s.supprimePar?.pseudo ?? trSs('corbeille.inconnu'), date: dateCourte(s.supprimeLe) })}</Text>
            <Text style={attenue}>{trSs('corbeille.expire', { date: dateCourte(s.expireLe) })}</Text>
            <View style={{ flex: 1 }} />
            <BoutonHub
              theme={theme}
              titre={trSs('corbeille.restaurer')}
              variante="plein"
              onPress={() =>
                void agir('restauration', async () => {
                  await api.restaurer(teamId, s.id);
                  await charger();
                  onRestauree(s.titre);
                })
              }
              testID={`esport-corbeille-${s.id}-restaurer`}
            />
          </Panneau>
        ))}
      </Grille>
    </View>
  );
}

/**
 * Éléments visibles du temps réel (docs/esport/temps-reel.md) :
 *  - `IndicateurDirect` : pastille discrète « En direct » / « Reconnexion… » (rien si le serveur n'a pas le
 *    temps réel ou que la page est masquée) ;
 *  - `PastillePresence` : « Léa est en train de modifier » sur une fiche ouverte par un autre ;
 *  - `BandeauConflit` : « X a modifié cet élément il y a N s » (avant d'enregistrer), ou « Pas enregistré : … »
 *    (409), avec Recharger, Voir la différence, Copier mes modifications. Rien n'est jamais écrasé.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avis, BoutonHub } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import { ilYA, trTr, trnTr } from '../i18n/tempsReel';
import { ESP } from '../ui/design';
import type { ClientEsport } from '../client';
import { useEtatTempsReel, type Editeur, type VerrouOptimiste } from './hooks';

/** Pastille d'état du canal. */
export function IndicateurDirect({ theme, client, testID = 'esport-temps-reel' }: { theme: ThemeHub; client: ClientEsport | undefined; testID?: string }) {
  const etat = useEtatTempsReel(client);
  if (etat === 'indisponible' || etat === 'arret') return null;
  const couleur = etat === 'direct' ? theme.ok : etat === 'sondage' ? theme.accent : theme.alerte;
  const libelle = etat === 'direct' ? trTr('etat.direct') : etat === 'sondage' ? trTr('etat.sondage') : trTr('etat.reconnexion');
  const aide = etat === 'direct' ? trTr('etat.direct_aide') : etat === 'sondage' ? trTr('etat.sondage_aide') : trTr('etat.reconnexion_aide');
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={`${libelle}. ${aide}`}
      accessibilityLiveRegion="polite"
      {...({ title: aide } as object)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: teinteTransparente(couleur, 0.12), alignSelf: 'flex-start' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: couleur }} />
      <Text style={{ color: theme.texte, fontSize: 12, ...police(theme.policeTexte) }}>{libelle}</Text>
    </View>
  );
}

/** « X est en train de modifier » (rien si personne d'autre). */
export function PastillePresence({ theme, presences, testID = 'esport-presence' }: { theme: ThemeHub; presences: readonly Editeur[]; testID?: string }) {
  if (!presences.length) return null;
  const premier = presences[0].pseudo ?? trTr('presence.inconnu');
  const texte = presences.length === 1 ? trTr('presence.un', { pseudo: premier }) : trnTr('presence.plusieurs', presences.length - 1, { pseudo: premier });
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: teinteTransparente(theme.alerte, 0.14), alignSelf: 'flex-start' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.alerte }} />
      <Text style={{ color: theme.texte, fontSize: 12, ...police(theme.policeTexte) }}>{texte}</Text>
    </View>
  );
}

/** Copie dans le presse-papiers (web) ; faux si impossible. */
async function copier(texte: string): Promise<boolean> {
  try {
    const pp = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    if (!pp) return false;
    await pp.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

const enTexte = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Bandeau de changement distant ou de conflit. `mesModifications` : champs modifiés ici (copie, différence) ;
 * `chargerServeur` : relit la version enregistrée (différence) ; `onRecharger` : remplace le formulaire.
 */
export function BandeauConflit({
  theme,
  verrou,
  mesModifications,
  chargerServeur,
  onRecharger,
  testID = 'esport-conflit',
}: {
  theme: ThemeHub;
  verrou: VerrouOptimiste;
  mesModifications?: Record<string, unknown>;
  chargerServeur?: () => Promise<Record<string, unknown>>;
  onRecharger(): void | Promise<void>;
  testID?: string;
}) {
  const info = verrou.conflit ?? verrou.distant;
  const [, rafraichir] = useState(0);
  const [difference, setDifference] = useState<Array<{ champ: string; miens: string; serveur: string }> | undefined>();
  const [copie, setCopie] = useState(false);
  // « il y a N s » qui avance.
  useEffect(() => {
    if (!info) return undefined;
    const id = setInterval(() => rafraichir(n => n + 1), 5_000);
    return () => clearInterval(id);
  }, [info]);
  useEffect(() => {
    setDifference(undefined);
    setCopie(false);
  }, [info?.version, info?.le]);
  if (!info) return null;
  const pseudo = info.pseudo ?? trTr('presence.inconnu');
  const quand = ilYA(Date.now() - info.le);
  const titre = verrou.conflit ? trTr('conflit.titre', { pseudo, quand }) : info.supprime ? trTr('distant.supprime', { pseudo, quand }) : trTr('distant.titre', { pseudo, quand });
  const champs = mesModifications ? Object.keys(mesModifications) : [];
  const voirDifference = async () => {
    if (difference) {
      setDifference(undefined);
      return;
    }
    const serveur = chargerServeur ? await chargerServeur().catch(() => ({}) as Record<string, unknown>) : {};
    setDifference(champs.map(champ => ({ champ, miens: enTexte(mesModifications?.[champ]), serveur: enTexte(serveur[champ]) })).filter(d => d.miens !== d.serveur));
  };
  return (
    <View testID={testID} style={{ gap: ESP.xs, padding: ESP.s, borderRadius: 10, borderWidth: 1, borderColor: verrou.conflit ? theme.critique : theme.alerte, backgroundColor: teinteTransparente(verrou.conflit ? theme.critique : theme.alerte, 0.08) }}>
      <Text accessibilityRole="alert" style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>
        {titre}
      </Text>
      {verrou.conflit ? <Text style={{ color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) }}>{trTr('conflit.aide')}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={trTr('action.recharger')}
          testID={`${testID}-recharger`}
          onPress={() => {
            void Promise.resolve(onRecharger()).then(() => verrou.recharger());
          }}
        />
        {champs.length && chargerServeur && !info.supprime ? <BoutonHub theme={theme} titre={difference ? trTr('action.masquer_difference') : trTr('action.difference')} testID={`${testID}-difference`} onPress={() => void voirDifference()} /> : null}
        {champs.length ? (
          <BoutonHub
            theme={theme}
            titre={copie ? trTr('action.copie') : trTr('action.copier')}
            testID={`${testID}-copier`}
            onPress={() => {
              void copier(champs.map(c => `${c} : ${enTexte(mesModifications?.[c])}`).join('\n')).then(setCopie);
            }}
          />
        ) : null}
        {!verrou.conflit ? (
          <Pressable accessibilityRole="button" testID={`${testID}-ignorer`} onPress={verrou.ignorer} style={{ justifyContent: 'center', paddingHorizontal: ESP.xs, minHeight: 44 }}>
            <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>{trTr('action.fermer')}</Text>
          </Pressable>
        ) : null}
      </View>
      {difference ? (
        difference.length ? (
          <View testID={`${testID}-diff`} style={{ gap: ESP.xxs }}>
            {difference.map(d => (
              <View key={d.champ} style={{ gap: 2 }}>
                <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{d.champ}</Text>
                <Text style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>{`${trTr('difference.miennes')} : ${d.miens}`}</Text>
                <Text style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>{`${trTr('difference.serveur')} : ${d.serveur}`}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Avis theme={theme} genre="info" texte={trTr('difference.vide')} />
        )
      ) : null}
    </View>
  );
}

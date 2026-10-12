/**
 * Sélecteur segmenté « VF | VOSTFR » (fiche et lecteur) : cibles de 48 px,
 * textes de 15 px et plus, groupe radio pour les lecteurs d'écran, flèches et
 * espace au clavier, thèmes clair et sombre (couleurs du thème du hub).
 *
 * Une langue indisponible est grisée avec « non disponible sur vos sources »
 * et sa raison ; une langue « à vérifier » (absente de la source de la fiche,
 * d'autres sources activées) reste choisissable. Si la source ne distingue
 * pas la langue : pas de sélecteur, seulement « Langue inconnue ».
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../hub/themes';
import { autreLangue, LANGUES_VERSION, LIBELLE_LANGUE_VERSION, type LangueVersion } from '../moteur/langues';
import { useTsuzuku } from './contexte';
import type { EtatLangues } from './resoudre';

export const NON_DISPONIBLE = 'non disponible sur vos sources';

export function SelecteurLangue({
  etat,
  valeur,
  onChoisir,
  enCours,
  note,
  testID = 'langue',
}: {
  etat: EtatLangues;
  /** Langue affichée comme choisie (celle jouée, ou celle des épisodes listés). */
  valeur: LangueVersion | null;
  onChoisir(langue: LangueVersion): void;
  enCours?: boolean;
  /** « Choix retenu pour cette série », « Pour cette séance »… */
  note?: string;
  testID?: string;
}) {
  const { theme, large } = useTsuzuku();
  const texte = { color: theme.texte, fontSize: 15, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 15, ...police(theme.policeTexte) };
  if (etat.inconnue) {
    return (
      <Text testID={`${testID}-inconnue`} accessibilityRole="text" style={attenue}>
        Langue inconnue : la source ne précise pas VF ou VOSTFR.
      </Text>
    );
  }
  const choisissable = (l: LangueVersion) => etat.options[l].etat !== 'absente';
  const rayon = Math.min(theme.rayonMoyen, 12);
  const absentes = LANGUES_VERSION.filter(l => etat.options[l].etat === 'absente');
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Langue de l’épisode"
        style={{ flexDirection: 'row', alignSelf: large ? 'flex-start' : 'stretch', minWidth: large ? 320 : undefined, borderWidth: 1, borderColor: theme.ligne, borderRadius: rayon, overflow: 'hidden', backgroundColor: theme.surface }}>
        {LANGUES_VERSION.map((l, i) => {
          const o = etat.options[l];
          const actif = valeur === l;
          const possible = choisissable(l);
          const sous = o.etat === 'absente' ? NON_DISPONIBLE : o.etat === 'a-verifier' ? 'chercher sur vos autres sources' : o.source ? `sur « ${o.source} »` : null;
          const libelle = `${LIBELLE_LANGUE_VERSION[l]}${actif ? ', choisie' : ''}${o.etat === 'absente' ? `, ${NON_DISPONIBLE}${o.raison ? ` : ${o.raison}` : ''}` : ''}${o.etat === 'a-verifier' ? ', à chercher sur vos autres sources' : ''}${o.presumee ? ', langue présumée' : ''}`;
          const clavier = {
            onKeyDown: (e: { key?: string; nativeEvent?: { key?: string }; preventDefault?(): void }) => {
              const k = e.key ?? e.nativeEvent?.key;
              if (k === ' ' && possible) {
                e.preventDefault?.();
                onChoisir(l);
              } else if ((k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') && choisissable(autreLangue(l))) {
                e.preventDefault?.();
                onChoisir(autreLangue(l));
              }
            },
          };
          return (
            <Pressable
              key={l}
              testID={`${testID}-${l}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif, disabled: !possible, busy: Boolean(enCours && actif) }}
              aria-checked={actif}
              aria-disabled={!possible}
              accessibilityLabel={libelle}
              accessibilityHint={o.etat === 'absente' ? undefined : actif ? undefined : `Recharger l’épisode en ${LIBELLE_LANGUE_VERSION[l]}`}
              disabled={!possible || enCours}
              onPress={() => !actif && onChoisir(l)}
              {...(clavier as object)}
              style={(p: { hovered?: boolean; focused?: boolean; pressed: boolean }) => ({
                flex: 1,
                minHeight: 48,
                minWidth: 120,
                paddingHorizontal: 14,
                paddingVertical: 8,
                alignItems: 'center',
                justifyContent: 'center',
                borderLeftWidth: i ? 1 : 0,
                borderLeftColor: theme.ligne,
                backgroundColor: actif ? theme.accent : p.hovered || p.pressed ? teinteTransparente(theme.texte, 0.06) : 'transparent',
                opacity: possible ? 1 : 0.55,
                outlineColor: theme.accent,
                outlineWidth: p.focused ? 2 : 0,
                outlineStyle: 'solid',
              })}>
              <Text style={{ ...texte, fontSize: 16, fontWeight: '800', letterSpacing: 0.6, color: actif ? theme.surAccent : possible ? theme.texte : theme.attenue, textDecorationLine: possible ? 'none' : 'line-through' }}>{LIBELLE_LANGUE_VERSION[l]}</Text>
              {sous ? (
                <Text testID={`${testID}-${l}-etat`} style={{ ...attenue, color: actif ? theme.surAccent : theme.attenue, textAlign: 'center' }}>
                  {sous}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {absentes.map(l =>
        etat.options[l].raison ? (
          <Text key={l} testID={`${testID}-${l}-raison`} style={attenue}>
            {LIBELLE_LANGUE_VERSION[l]} {NON_DISPONIBLE} : {etat.options[l].raison}
          </Text>
        ) : null,
      )}
      {note ? (
        <Text testID={`${testID}-note`} style={attenue} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

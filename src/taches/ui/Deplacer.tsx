/**
 * Déplacer des tâches (une ou plusieurs) : sélecteur « Emplacement » avec
 * recherche (espace › projet › liste, ou « sous-tâche de… »), statuts
 * d'arrivée à choisir, étiquettes conservées ou créées, avertissement de
 * visibilité (projet partagé), refus lisible. Aussi : la case carrée de la
 * multi-sélection et la barre « N tâches sélectionnées ».
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import {
  analyserDeplacement,
  cheminTache,
  destinations,
  racinesDe,
  type Cote,
  type Destination,
  type OptionsDeplacement,
} from '../deplacer';
import { LIBELLES_DROIT, statutsDe, type Tache } from '../modele';
import type { Actions } from './actions';
import {
  attenueDe,
  Bouton,
  Champ,
  Dialogue,
  Libelle,
  Options,
  Puce,
  texteDe,
} from './atomes';

export const coteDe = (a: Pick<Actions, 'etat'>): Cote => ({
  role: a.etat.role,
  moi: a.etat.moi,
});

const cleDest = (x: { listeId: string; parentId?: string | null }) =>
  `${x.listeId}|${x.parentId ?? ''}`;

/** Case carrée de sélection (multi-sélection), 44 px au doigt. */
export function CaseSelection({
  a,
  coche,
  onPress,
  libelle,
  testID,
}: {
  a: Actions;
  coche: boolean;
  onPress(e?: unknown): void;
  libelle: string;
  testID?: string;
}) {
  const theme = a.theme;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: coche }}
      accessibilityLabel={libelle}
      onPress={onPress}
      hitSlop={8}
      style={[styles.caseZone, a.mobile && styles.caseZoneMobile]}
    >
      <View
        style={[
          styles.caseCarree,
          {
            borderColor: coche ? theme.accent : theme.attenue,
            backgroundColor: coche ? theme.accent : 'transparent',
            borderRadius: theme.id === 'terminal' ? 0 : 5,
          },
        ]}
      >
        {coche ? (
          <Text
            style={{
              color: theme.surAccent,
              fontSize: 14,
              fontWeight: '800',
              lineHeight: 16,
            }}
          >
            ✓
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Barre de la multi-sélection : « 3 tâches sélectionnées · Déplacer 3 tâches… · Tout désélectionner ». */
export function BarreSelection({
  a,
  onDeplacer,
}: {
  a: Actions;
  onDeplacer(): void;
}) {
  const sel = a.selection;
  if (!sel || !sel.ids.length) return null;
  const n = sel.ids.length;
  const theme = a.theme;
  return (
    <View
      testID="barre-selection"
      accessibilityRole="toolbar"
      style={[
        styles.barre,
        {
          backgroundColor: teinteTransparente(theme.accent, 0.12),
          borderColor: theme.accent,
          borderRadius: Math.min(theme.rayonMoyen, 12),
        },
      ]}
    >
      <Text
        style={[texteDe(theme), { fontWeight: '700', flexShrink: 1 }]}
        accessibilityLiveRegion="polite"
      >
        {n} tâche{n > 1 ? 's' : ''} sélectionnée{n > 1 ? 's' : ''}
      </Text>
      <View style={styles.rangee}>
        <Bouton
          theme={theme}
          compact={!a.mobile}
          variante="plein"
          titre={`↦ Déplacer ${n > 1 ? `${n} tâches` : 'la tâche'}…`}
          onPress={onDeplacer}
          testID="selection-deplacer"
        />
        <Bouton
          theme={theme}
          compact={!a.mobile}
          titre="Tout désélectionner"
          onPress={sel.vider}
          testID="selection-vider"
        />
      </View>
    </View>
  );
}

/**
 * Fenêtre « Déplacer » : choisir l'emplacement, puis (si besoin) le statut
 * d'arrivée et le sort des étiquettes ; les avertissements de visibilité
 * sont dits avant de valider.
 */
export function DialogueDeplacer({
  a,
  ids,
  initiale,
  mode = 'auto',
  onFermer,
  onDeplacer,
}: {
  a: Actions;
  ids: readonly string[];
  initiale?: Destination;
  /** « parents » : convertir en sous-tâche (liste des tâches qui peuvent l'accueillir). */
  mode?: 'auto' | 'parents';
  onFermer(): void;
  onDeplacer(dest: Destination, o: OptionsDeplacement): void;
}) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const cote = coteDe(a);
  const racines = useMemo(() => racinesDe(d, ids), [d, ids]);
  const [recherche, setRecherche] = useState('');
  const [dest, setDest] = useState<Destination | undefined>(initiale);
  const [statuts, setStatuts] = useState<Record<string, string>>({});
  const [etiquettes, setEtiquettes] = useState<'conserver' | 'creer'>(
    'conserver',
  );
  const entrees = destinations(d, cote, recherche, racines, 60, mode);
  const an = dest
    ? analyserDeplacement(d, ids, dest, cote, a.etat.noms)
    : undefined;
  const seule = racines.length === 1 ? racines[0] : undefined;
  const titre =
    mode === 'parents'
      ? `Convertir « ${seule?.titre ?? ''} » en sous-tâche`
      : seule
      ? `Déplacer « ${seule.titre} »`
      : `Déplacer ${racines.length} tâches`;
  const nomProjet = an ? d.projets[an.projetCible]?.nom : '';
  const options = entrees.map(e => ({
    valeur: cleDest(e),
    texte: e.libelle,
    detail: e.detail,
    couleur: e.couleur,
  }));
  // La destination choisie reste visible même si la recherche l'écarte.
  if (dest && !options.some(o => o.valeur === cleDest(dest))) {
    const l = d.listes[dest.listeId];
    if (l)
      options.unshift({
        valeur: cleDest(dest),
        texte: dest.parentId
          ? `↳ Sous-tâche de « ${d.taches[dest.parentId]?.titre ?? ''} »`
          : `${d.projets[l.projetId]?.nom ?? ''} › ${l.nom}`,
        detail: 'Choisi',
        couleur: d.projets[l.projetId]?.couleur,
      });
  }
  const valider = () => {
    if (!dest || !an || an.refus || an.rien) return;
    onDeplacer(dest, {
      statuts: Object.fromEntries(
        an.statuts.map(s => [s.cle, statuts[s.cle] ?? s.propose]),
      ),
      etiquettes,
    });
  };
  const pied = (
    <>
      <Bouton
        theme={theme}
        titre="Annuler"
        onPress={onFermer}
        testID="deplacer-annuler"
      />
      <Bouton
        theme={theme}
        variante="plein"
        titre={
          an && an.racines.length > 1
            ? `Déplacer ${an.racines.length} tâches`
            : mode === 'parents'
            ? 'Convertir'
            : 'Déplacer'
        }
        desactive={!an || Boolean(an.refus) || an.rien}
        onPress={valider}
        testID="deplacer-valider"
      />
    </>
  );
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre={titre}
      description={
        seule
          ? `Emplacement actuel : ${cheminTache(d, seule)}`
          : `${racines.length} tâches (leurs sous-tâches suivent).`
      }
      onFermer={onFermer}
      pied={pied}
      testID="dialogue-deplacer"
    >
      <View style={{ gap: 10 }}>
        <Champ
          theme={theme}
          mobile={a.mobile}
          value={recherche}
          onChangeText={setRecherche}
          autoFocus={!a.mobile}
          placeholder={
            mode === 'parents'
              ? 'Rechercher la tâche parente'
              : 'Rechercher un espace, un projet, une liste ou une tâche parente'
          }
          accessibilityLabel="Rechercher un emplacement"
          testID="deplacer-recherche"
        />
        {seule?.parentId && mode !== 'parents' ? (
          <Bouton
            theme={theme}
            titre="↑ En faire une tâche principale (dans sa liste)"
            onPress={() => setDest({ listeId: seule.listeId, parentId: null })}
            testID="deplacer-principale"
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        <Libelle theme={theme}>
          {mode === 'parents' ? 'TÂCHE PARENTE' : 'EMPLACEMENT'}
        </Libelle>
        <ScrollView
          testID="deplacer-destinations"
          style={a.mobile ? undefined : { maxHeight: 300 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {options.length ? (
            <Options
              theme={theme}
              options={options}
              valeur={dest ? cleDest(dest) : undefined}
              onChoisir={v => {
                const [listeId, parentId] = v.split('|');
                setDest({ listeId, ...(parentId ? { parentId } : {}) });
              }}
              testID="deplacer-option"
            />
          ) : (
            <Text style={attenueDe(theme)}>
              {recherche.trim()
                ? 'Aucun emplacement ne correspond.'
                : 'Aucun projet où vous pouvez écrire.'}
            </Text>
          )}
        </ScrollView>
        {an ? (
          <View style={{ gap: 10 }} testID="deplacer-analyse">
            {an.refus ? (
              <Text
                style={[texteDe(theme), { color: theme.critique }]}
                testID="deplacer-refus"
                accessibilityLiveRegion="polite"
              >
                {an.refus}
              </Text>
            ) : an.rien ? (
              <Text style={attenueDe(theme)}>Déjà à cet endroit.</Text>
            ) : null}
            {!an.refus && an.statuts.length ? (
              <View style={{ gap: 6 }} testID="deplacer-statuts">
                <Libelle theme={theme}>{`STATUT D’ARRIVÉE DANS « ${(
                  nomProjet ?? ''
                ).toUpperCase()} »`}</Libelle>
                {an.statuts.map(s => (
                  <View key={s.cle} style={{ gap: 4 }}>
                    <Text style={texteDe(theme)}>
                      « {s.nom} » n’existe pas ici
                      {s.nb > 1 ? ` (${s.nb} tâches)` : ''} :
                    </Text>
                    <View style={styles.rangee}>
                      {statutsDe(d, an.projetCible).map(c => (
                        <Puce
                          key={c.id}
                          theme={theme}
                          grand={a.mobile}
                          texte={c.nom}
                          couleur={c.couleur}
                          actif={(statuts[s.cle] ?? s.propose) === c.id}
                          onPress={() =>
                            setStatuts(x => ({ ...x, [s.cle]: c.id }))
                          }
                          libelle={`« ${s.nom} » devient « ${c.nom} »`}
                          testID={`deplacer-statut-${c.id}`}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            {!an.refus && an.etiquettes.length ? (
              <View style={{ gap: 6 }} testID="deplacer-etiquettes">
                <Libelle theme={theme}>ÉTIQUETTES</Libelle>
                <Text style={texteDe(theme)}>
                  {an.etiquettes.map(e => `#${e}`).join(' ')}{' '}
                  {an.etiquettes.length > 1 ? 'ne sont pas' : 'n’est pas'} dans
                  les étiquettes de « {nomProjet} ».
                </Text>
                <Options
                  theme={theme}
                  options={[
                    {
                      valeur: 'conserver' as const,
                      texte: 'Les garder sur la tâche',
                    },
                    ...(an.peutCreerEtiquettes
                      ? [
                          {
                            valeur: 'creer' as const,
                            texte: `Les créer dans « ${nomProjet} »`,
                          },
                        ]
                      : []),
                  ]}
                  valeur={etiquettes}
                  onChoisir={v =>
                    setEtiquettes(v === 'creer' ? 'creer' : 'conserver')
                  }
                  testID="deplacer-etiquettes"
                />
              </View>
            ) : null}
            {!an.refus && !an.rien && an.visibles.length ? (
              <Avertissement
                a={a}
                testID="deplacer-visibilite"
                texte={`Visibilité : « ${nomProjet} » est partagé. ${
                  an.racines.length > 1
                    ? 'Ces tâches seront visibles'
                    : 'Elle sera visible'
                } par ${an.visibles
                  .map(
                    p => `${p.nom} (${LIBELLES_DROIT[p.droit].toLowerCase()})`,
                  )
                  .join(', ')}.`}
              />
            ) : null}
            {!an.refus && !an.rien && an.disparus.length ? (
              <Avertissement
                a={a}
                testID="deplacer-disparition"
                texte={`${
                  an.racines.length > 1
                    ? 'Elles disparaîtront'
                    : 'Elle disparaîtra'
                } chez ${an.disparus.map(p => p.nom).join(', ')}, qui ne ${
                  an.disparus.length > 1 ? 'voient' : 'voit'
                } pas « ${nomProjet} ».`}
              />
            ) : null}
            {!an.refus && an.appsCachees ? (
              <Text style={attenueDe(theme)}>
                Les tâches venues d’une autre app ne sont jamais montrées aux
                membres, même dans un projet partagé.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Dialogue>
  );
}

function Avertissement({
  a,
  texte,
  testID,
}: {
  a: Actions;
  texte: string;
  testID: string;
}) {
  const theme = a.theme;
  return (
    <View
      testID={testID}
      style={[
        styles.avert,
        {
          borderColor: theme.alerte,
          backgroundColor: teinteTransparente(theme.alerte, 0.12),
          borderRadius: Math.min(theme.rayonMoyen, 10),
        },
      ]}
    >
      <Text style={{ color: theme.alerte, fontSize: 17, fontWeight: '800' }}>
        ⚠
      </Text>
      <Text style={[texteDe(theme), { flex: 1 }]}>{texte}</Text>
    </View>
  );
}

/** Éléments du menu « ⋯ » d'une tâche. */
export function elementsMenuTache(
  a: Actions,
  t: Tache,
  o: {
    onDeplacer(): void;
    onParent(): void;
    onPrincipale(): void;
    onSelectionner?(): void;
    onSupprimer(): void;
  },
): Array<{ texte: string; testID: string; danger?: boolean; action(): void }> {
  const m = a.droits(t.projetId).modifier;
  if (!m) return [];
  return [
    {
      texte: '↦ Déplacer… (espace, projet, liste)',
      testID: 'menu-tache-deplacer',
      action: o.onDeplacer,
    },
    t.parentId
      ? {
          texte: '↑ En faire une tâche principale',
          testID: 'menu-tache-principale',
          action: o.onPrincipale,
        }
      : {
          texte: '↳ Convertir en sous-tâche de…',
          testID: 'menu-tache-sous',
          action: o.onParent,
        },
    ...(o.onSelectionner
      ? [
          {
            texte: '☑ Sélectionner (plusieurs tâches)',
            testID: 'menu-tache-selectionner',
            action: o.onSelectionner,
          },
        ]
      : []),
    {
      texte: `Supprimer « ${t.titre} »…`,
      testID: 'menu-tache-supprimer',
      danger: true,
      action: o.onSupprimer,
    },
  ];
}

const styles = StyleSheet.create({
  rangee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  barre: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  caseZone: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caseZoneMobile: { width: 44, height: 44 },
  caseCarree: {
    width: 20,
    height: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avert: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderWidth: 1,
    padding: 10,
  },
});

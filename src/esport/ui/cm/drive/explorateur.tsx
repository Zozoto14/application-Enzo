/**
 * Briques communes aux explorateurs de dossiers (Drive et dossiers des visuels, docs/esport/drive.md et
 * visuels.md) : fil d'Ariane et arborescence latérale (cibles du glisser-déposer, pastilles de nouveautés), style
 * d'une cible survolée, choix d'un dossier dans un arbre (menu « Déplacer vers… »).
 */

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { trDr } from '../../../i18n/drive';
import { styles } from '../../commun';
import { Compteur, ESP, attenue, texte, type EtatPresse } from '../../design';
import type { Glisser } from './typesGlisser';

export interface NoeudArbre {
  id: string;
  parentId: string | null;
  nom: string;
  restreint?: boolean;
}

/** Style d'une cible du glisser-déposer survolée : accent si l'on peut lâcher, rouge sinon. */
export function styleCible(theme: ThemeHub, g: Glisser, cle: string): ViewStyle | undefined {
  if (g.survol?.cible !== cle) return undefined;
  const c = g.survol.refus ? theme.critique : theme.accent;
  return { borderColor: c, borderWidth: 2, borderStyle: 'dashed', backgroundColor: teinteTransparente(c, 0.12) };
}

/** Fil d'Ariane : racine, puis chaque dossier ; chaque maillon (sauf le dossier ouvert) est une cible. */
export function FilAriane({
  theme,
  racine,
  chemin,
  onOuvrir,
  glisser: g,
  masquerRacine,
  testID,
}: {
  theme: ThemeHub;
  racine: string;
  chemin: ReadonlyArray<{ id: string; nom: string }>;
  onOuvrir(id: string | null): void;
  glisser: Glisser;
  masquerRacine?: boolean;
  testID: string;
}) {
  const maillon = (id: string | null, nom: string, dernier: boolean) => {
    const cle = id ?? 'racine';
    return (
      <View key={cle} {...(dernier ? {} : g.marque({ cible: cle }))} style={[{ borderRadius: 10, borderWidth: 2, borderColor: 'transparent' }, dernier ? undefined : styleCible(theme, g, cle)]}>
        {dernier ? <Text style={{ ...texte(theme, 15), fontWeight: '700', paddingHorizontal: 6 }}>{nom}</Text> : <BoutonHub theme={theme} titre={id ? nom : `⌂ ${nom}`} onPress={() => onOuvrir(id)} testID={`${testID}-${id ?? 'racine'}`} />}
      </View>
    );
  };
  return (
    <View style={[styles.ligne, { gap: 2, flexShrink: 1 }]} accessibilityLabel={trDr('detail.emplacement')} testID={testID}>
      {masquerRacine ? null : maillon(null, racine, !chemin.length)}
      {chemin.map((m, i) => (
        <React.Fragment key={m.id}>
          {masquerRacine && i === 0 ? null : <Text style={attenue(theme)}>›</Text>}
          {maillon(m.id, m.nom, i === chemin.length - 1)}
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * Arborescence latérale (écran large) : déplier / replier, dossier ouvert en évidence, pastille de nouveautés,
 * chaque ligne est une cible du glisser-déposer.
 */
export function ArbreDossiers({
  theme,
  titre,
  racine,
  dossiers,
  courant,
  onOuvrir,
  compteurs,
  glisser: g,
  testID,
}: {
  theme: ThemeHub;
  titre: string;
  racine: string;
  dossiers: readonly NoeudArbre[];
  courant: string | null;
  onOuvrir(id: string | null): void;
  compteurs?: Record<string, number>;
  glisser: Glisser;
  testID: string;
}) {
  const [replies, setReplies] = useState<Set<string>>(new Set());
  const enfants = useMemo(() => {
    const m = new Map<string | null, NoeudArbre[]>();
    for (const d of dossiers) {
      const p = d.parentId && dossiers.some(x => x.id === d.parentId) ? d.parentId : null;
      if (!m.has(p)) m.set(p, []);
      m.get(p)?.push(d);
    }
    for (const l of m.values()) l.sort((a, b) => a.nom.localeCompare(b.nom));
    return m;
  }, [dossiers]);
  const ligne = (id: string | null, nom: string, niveau: number, restreint?: boolean) => {
    const cle = id ?? 'racine';
    const sous = enfants.get(id) ?? [];
    const replie = id ? replies.has(id) : false;
    const n = id ? (compteurs?.[id] ?? 0) : 0;
    return (
      <View key={cle}>
        <View {...g.marque({ cible: cle })} style={[{ flexDirection: 'row', alignItems: 'center', borderRadius: 8, borderWidth: 2, borderColor: 'transparent' }, styleCible(theme, g, cle)]}>
          <View style={{ width: 8 + niveau * 14 }} />
          {id && sous.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={replie ? trDr('arbre.deplier', { nom }) : trDr('arbre.replier', { nom })}
              onPress={() =>
                setReplies(r => {
                  const x = new Set(r);
                  if (x.has(id)) x.delete(id);
                  else x.add(id);
                  return x;
                })
              }
              testID={`${testID}-${cle}-plier`}
              style={{ width: 24, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={attenue(theme, 12)}>{replie ? '▸' : '▾'}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 24 }} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: courant === id }}
            accessibilityLabel={trDr('arbre.ouvrir', { nom })}
            onPress={() => onOuvrir(id)}
            testID={`${testID}-${cle}`}
            style={(e: EtatPresse) => ({ flex: 1, minWidth: 0, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6, borderRadius: 6, backgroundColor: courant === id ? teinteTransparente(theme.accent, 0.16) : e.hovered ? teinteTransparente(theme.accent, 0.06) : 'transparent' })}>
            <Text style={{ ...texte(theme, 13), fontWeight: courant === id ? '700' : '500', flex: 1 }} numberOfLines={1}>{`${id ? '📁' : '⌂'} ${nom}${restreint ? ' 🔒' : ''}`}</Text>
            <Compteur theme={theme} n={n} testID={`${testID}-${cle}-nouveautes`} />
          </Pressable>
        </View>
        {replie ? null : sous.map(d => ligne(d.id, d.nom, niveau + 1, d.restreint))}
      </View>
    );
  };
  return (
    <View style={{ gap: 2 }} accessibilityLabel={titre} testID={testID}>
      <Text style={{ ...attenue(theme, 12), fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: ESP.xs }}>{titre}</Text>
      {ligne(null, racine, 0)}
    </View>
  );
}

/** Arbre aplati (profondeur d'abord), sans les dossiers exclus ni leurs descendants. */
export function aplatir(dossiers: readonly NoeudArbre[], exclure: readonly string[] = []): Array<NoeudArbre & { niveau: number }> {
  const sortie: Array<NoeudArbre & { niveau: number }> = [];
  const parcourir = (parent: string | null, niveau: number) => {
    for (const d of dossiers.filter(x => x.parentId === parent && !exclure.includes(x.id)).sort((a, b) => a.nom.localeCompare(b.nom))) {
      sortie.push({ ...d, niveau });
      if (niveau < 14) parcourir(d.id, niveau + 1);
    }
  };
  parcourir(null, 1);
  return sortie;
}

/** Choix d'un dossier dans un arbre (racine comprise) : menu « Déplacer vers… ». */
export function ChoixDansArbre({
  theme,
  racine,
  dossiers,
  exclure = [],
  titreBouton,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  racine: string;
  dossiers: readonly NoeudArbre[];
  exclure?: readonly string[];
  titreBouton: string;
  onChoisir(dossierId: string | null): void;
  testID: string;
}) {
  const [choisi, setChoisi] = useState<string | null>(null);
  const lignes = [{ id: null as string | null, nom: racine, niveau: 0, restreint: false }, ...aplatir(dossiers, exclure)];
  return (
    <View style={{ gap: ESP.s }} testID={testID}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trDr('dialogue.destination')}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={trDr('dialogue.destination')} style={{ gap: 2 }}>
        {lignes.map(l => {
          const actif = choisi === l.id;
          return (
            <Pressable
              key={l.id ?? 'racine'}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={l.nom}
              onPress={() => setChoisi(l.id)}
              testID={`${testID}-${l.id ?? 'racine'}`}
              style={(e: EtatPresse) => ({ minHeight: 40, justifyContent: 'center', paddingLeft: ESP.s + l.niveau * 16, borderRadius: 8, backgroundColor: actif ? teinteTransparente(theme.accent, 0.18) : e.hovered ? teinteTransparente(theme.accent, 0.08) : 'transparent' })}>
              <Text style={{ ...texte(theme, 14), fontWeight: actif ? '700' : '500' }} numberOfLines={1}>{`${l.id ? '📁' : '⌂'} ${l.nom}${l.restreint ? ' 🔒' : ''}`}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={titreBouton} variante="plein" onPress={() => onChoisir(choisi)} testID={`${testID}-ok`} />
      </View>
    </View>
  );
}

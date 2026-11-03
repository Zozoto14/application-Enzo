/**
 * Fil de thèses et d'actualités, pour une ou plusieurs valeurs.
 *
 * Chaque élément dit d'où il vient et qui l'a écrit, et le fil rappelle ce
 * que sont ces textes : des opinions, pas des conseils. Un clic ouvre
 * l'article dans le navigateur.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ResultatTheses, These, ValeurCherchee } from '../fondamentaux/theses';
import type { ArticleMedia } from '../podcast/medias';
import { usePalette } from './composants';
import { Segments, Vide } from './elements';
import { ESPACEMENT, RAYON } from './theme';

export type ChargerTheses = (valeur: ValeurCherchee) => Promise<ResultatTheses>;

type Filtre = 'tout' | 'analyse' | 'discussion' | 'presse';
const LIBELLES_FILTRES: Record<Filtre, string> = {
  tout: 'Tout',
  analyse: 'Analyses',
  discussion: 'Particuliers',
  presse: 'Presse',
};
const LIBELLES_GENRES: Record<These['genre'], string> = {
  analyse: 'Analyse',
  discussion: 'Avis de particulier',
  presse: 'Article d’analyse',
};

/** Un quart d'heure : changer d'onglet ne relance pas tout. */
const DUREE_CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { quand: number; promesse: Promise<ResultatTheses> }>();

function cleValeur(valeur: ValeurCherchee): string {
  return `${valeur.symbole ?? ''}|${valeur.nom}`;
}

function charger(valeur: ValeurCherchee, chargeur: ChargerTheses): Promise<ResultatTheses> {
  const cle = cleValeur(valeur);
  const connu = cache.get(cle);
  if (connu && Date.now() - connu.quand < DUREE_CACHE_MS) return connu.promesse;
  const promesse = chargeur(valeur);
  promesse.catch(() => cache.delete(cle));
  cache.set(cle, { quand: Date.now(), promesse });
  return promesse;
}

/** Vide le cache : utile aux tests, et au bouton « Actualiser ». */
export function oublierTheses(): void {
  cache.clear();
}

function dateCourte(iso: string): string {
  if (!iso) return '';
  const [annee, mois, jour] = iso.split('-');
  return `${jour}/${mois}/${annee.slice(2)}`;
}

function initiales(nom: string): string {
  return (
    nom
      .split(/\s+/)
      .filter(mot => /^[A-Za-zÀ-ÿ0-9]/.test(mot))
      .slice(0, 2)
      .map(mot => mot[0].toUpperCase())
      .join('') || '•'
  );
}

interface EtatFil {
  chargement: boolean;
  theses: These[];
  actualites: Array<ArticleMedia & { valeur: string }>;
  echecs: number;
  sources: number;
  erreur?: string;
}

export function FilTheses({
  valeurs,
  chargerTheses,
  mode,
  testID,
}: {
  valeurs: readonly ValeurCherchee[];
  chargerTheses: ChargerTheses;
  mode: 'theses' | 'actualites';
  testID?: string;
}) {
  const palette = usePalette();
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [version, setVersion] = useState(0);
  const [etat, setEtat] = useState<EtatFil>({ chargement: true, theses: [], actualites: [], echecs: 0, sources: 0 });
  const cle = useMemo(() => valeurs.map(cleValeur).join('§'), [valeurs]);

  useEffect(() => {
    let actif = true;
    if (valeurs.length === 0) {
      setEtat({ chargement: false, theses: [], actualites: [], echecs: 0, sources: 0 });
      return;
    }
    setEtat(precedent => ({ ...precedent, chargement: true, erreur: undefined }));
    Promise.allSettled(valeurs.map(valeur => charger(valeur, chargerTheses))).then(resultats => {
      if (!actif) return;
      const suivant: EtatFil = { chargement: false, theses: [], actualites: [], echecs: 0, sources: 0 };
      let erreur: string | undefined;
      resultats.forEach((resultat, rang) => {
        if (resultat.status === 'rejected') {
          erreur = resultat.reason instanceof Error ? resultat.reason.message : String(resultat.reason);
          return;
        }
        suivant.theses.push(...resultat.value.theses);
        suivant.actualites.push(...resultat.value.actualites.map(article => ({ ...article, valeur: valeurs[rang].nom })));
        suivant.echecs += resultat.value.echecs;
        suivant.sources += resultat.value.sources;
      });
      const recents = (a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date);
      suivant.theses.sort(recents);
      suivant.actualites.sort(recents);
      if (suivant.theses.length === 0 && suivant.actualites.length === 0) suivant.erreur = erreur;
      setEtat(suivant);
    });
    return () => {
      actif = false;
    };
    // La clé résume les valeurs ; `version` relance à la demande.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, version, chargerTheses]);

  const actualiser = () => {
    valeurs.forEach(valeur => cache.delete(cleValeur(valeur)));
    setVersion(v => v + 1);
  };

  const plusieurs = valeurs.length > 1;
  const elements: Array<ArticleMedia & { valeur: string; genre?: These['genre']; auteur?: string; ton?: These['ton'] }> =
    mode === 'theses'
      ? etat.theses.filter(these => filtre === 'tout' || these.genre === filtre)
      : etat.actualites;

  return (
    <View style={{ gap: ESPACEMENT.s }} testID={testID}>
      <View style={styles.entete}>
        {mode === 'theses' ? (
          <Segments<Filtre>
            options={['tout', 'analyse', 'discussion', 'presse']}
            actif={filtre}
            onChoisir={setFiltre}
            libelle={option => LIBELLES_FILTRES[option]}
            prefixeTest="filtre-theses"
          />
        ) : (
          <View />
        )}
        <Pressable accessibilityRole="button" onPress={actualiser} testID="actualiser-theses">
          <Text style={{ color: palette.accent, fontWeight: '600' }}>↻ Actualiser</Text>
        </Pressable>
      </View>
      {mode === 'theses' ? (
        <Text style={{ color: palette.texteSecondaire, fontSize: 12, lineHeight: 17 }}>
          Des avis d’investisseurs, de particuliers et de journalistes : des opinions, pas des conseils ni des faits
          vérifiés. Le ton (optimiste ou prudent) est estimé d’après les mots employés.
        </Text>
      ) : null}

      {etat.chargement ? (
        <View style={styles.centre}>
          <ActivityIndicator color={palette.accent} />
          <Text style={{ color: palette.texteSecondaire }}>Recherche des {mode === 'theses' ? 'thèses' : 'actualités'}…</Text>
        </View>
      ) : elements.length === 0 ? (
        <Vide>
          {etat.erreur
            ? `Impossible de charger les sources : ${etat.erreur}`
            : mode === 'theses'
              ? 'Aucune thèse trouvée récemment sur cette valeur.'
              : 'Aucune actualité sur les sept derniers jours.'}
        </Vide>
      ) : (
        elements.map((element, rang) => (
          <Pressable
            key={`${element.lien ?? element.titre}-${rang}`}
            accessibilityRole={element.lien ? 'link' : undefined}
            disabled={!element.lien}
            onPress={() => (element.lien ? Linking.openURL(element.lien).catch(() => undefined) : undefined)}
            style={({ pressed }) => [
              styles.ligne,
              { borderColor: palette.bordure, backgroundColor: pressed ? palette.surfaceHaute : 'transparent' },
            ]}
            testID={`${mode === 'theses' ? 'these' : 'actualite'}-${rang}`}>
            <View style={[styles.logo, { backgroundColor: palette.accentFond }]}>
              <Text style={{ color: palette.accent, fontWeight: '800', fontSize: 13 }}>{initiales(element.valeur)}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.meta}>
                {plusieurs ? (
                  <Text style={{ color: palette.accent, fontSize: 12, fontWeight: '600' }}>{element.valeur}</Text>
                ) : null}
                {element.genre ? (
                  <View style={[styles.badge, { borderColor: palette.bordure }]}>
                    <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>{LIBELLES_GENRES[element.genre]}</Text>
                  </View>
                ) : null}
                {element.langue === 'en' ? (
                  <Text style={{ color: palette.texteSecondaire, fontSize: 11 }}>EN</Text>
                ) : null}
              </View>
              <Text style={{ color: palette.texte, fontWeight: '700', fontSize: 15 }}>{element.titre}</Text>
              <View style={styles.meta}>
                {element.auteur ? (
                  <Text style={{ color: palette.accent, fontSize: 12 }}>{element.auteur}</Text>
                ) : null}
                <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>{element.source}</Text>
                {element.date ? (
                  <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>▢ {dateCourte(element.date)}</Text>
                ) : null}
                {element.ton ? (
                  <Text
                    style={{
                      color: element.ton === 'optimiste' ? palette.hausse : palette.baisse,
                      fontSize: 12,
                      fontWeight: '600',
                    }}>
                    {element.ton === 'optimiste' ? '↗︎ plutôt optimiste' : '↘︎ plutôt prudent'}
                  </Text>
                ) : null}
              </View>
              {element.resume ? (
                <Text style={{ color: palette.texteSecondaire, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>
                  {element.resume}
                </Text>
              ) : null}
            </View>
            {element.lien ? <Text style={{ color: palette.texteSecondaire }}>↗︎</Text> : null}
          </Pressable>
        ))
      )}
      {!etat.chargement && etat.echecs > 0 ? (
        <Text style={{ color: palette.texteSecondaire, fontSize: 12 }}>
          {etat.echecs} source{etat.echecs > 1 ? 's' : ''} sur {etat.sources} n’{etat.echecs > 1 ? 'ont' : 'a'} pas répondu.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  entete: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: ESPACEMENT.s },
  centre: { alignItems: 'center', gap: ESPACEMENT.s, paddingVertical: ESPACEMENT.l },
  ligne: {
    flexDirection: 'row',
    gap: ESPACEMENT.m,
    alignItems: 'flex-start',
    paddingVertical: ESPACEMENT.m,
    paddingHorizontal: ESPACEMENT.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: RAYON.s,
  },
  logo: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: ESPACEMENT.s, rowGap: 2 },
  badge: { borderWidth: 1, borderRadius: RAYON.s, paddingHorizontal: 6, paddingVertical: 1 },
});

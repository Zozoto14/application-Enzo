/** Fiche d'un film : synopsis, bibliothèque, lecture, lien direct, « vu ailleurs ». */

import React from 'react';
import { Image, Text, View } from 'react-native';
import { trouver } from '../moteur/bibliotheque';
import { ouvrirExterne } from './externe';
import { useCharger, useTsuzuku } from './contexte';
import { BlocBibliotheque, BlocVuAilleurs, LiensLegaux, Meta, Synopsis, type FicheMin } from './FicheCommune';
import { LienFilm } from './LienFilm';
import { Bouton, Etat, LIBELLE_STATUT, Titre, styleAttenue, styleTexte } from './ui';

export function FicheFilmEcran({ id }: { id: string }) {
  const { s, theme, aller, retour, version, large } = useTsuzuku();
  const fiche = useCharger(async () => (await s.catalogue.films.parId(id)).film, [s, id]);
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const f = fiche.donnees;
  const entree = lib.donnees ? trouver(lib.donnees, 'movie', id) : null;
  const min: FicheMin | undefined = f ? { kind: 'movie', id, title: f.title, image: f.image, year: f.year, runtime: f.runtime } : undefined;
  return (
    <View style={{ gap: 18 }} testID="tsuzuku-fiche-film">
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton titre="← Retour" onPress={retour} testID="fiche-retour" />
      </View>
      <Etat enCours={fiche.enCours} erreur={fiche.erreur} onRecharger={fiche.recharger}>
        {f && min ? (
          <View style={{ gap: 18 }}>
            <View style={{ flexDirection: large ? 'row' : 'column', gap: 16 }}>
              {f.image ? <Image source={{ uri: f.image }} accessibilityIgnoresInvertColors accessibilityLabel={`Affiche de ${f.title}`} style={{ width: 150, height: 225, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.attenue }} /> : null}
              <View style={{ flex: 1, gap: 8 }}>
                <Titre taille={26} testID="fiche-titre">{f.title}</Titre>
                {f.originalTitle && f.originalTitle !== f.title ? <Text style={styleAttenue(theme)}>{f.originalTitle}</Text> : null}
                {f.tagline ? <Text style={[styleAttenue(theme, 14), { fontStyle: 'italic' }]}>{f.tagline}</Text> : null}
                <Meta lignes={[f.year, f.runtime ? `${f.runtime} min` : null, f.score ? `★ ${f.score}` : null, f.genres.slice(0, 4).join(', ')]} />
                {entree ? <Text style={[styleTexte(theme, 13), { fontWeight: '700', color: theme.accent }]} testID="fiche-statut">{LIBELLE_STATUT[entree.status]}</Text> : null}
                <Synopsis texte={f.synopsis} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <Bouton titre="▶ Lire le film" variante="plein" onPress={() => aller({ t: 'lecteur', kind: 'movie', id })} testID="fiche-lire" />
                  {f.trailer ? <Bouton titre="Bande-annonce ↗" onPress={() => void ouvrirExterne(f.trailer!)} /> : null}
                </View>
              </View>
            </View>
            <BlocBibliotheque fiche={min} entree={entree} />
            <BlocVuAilleurs fiche={min} entree={entree} />
            <LienFilm id={id} />
            <LiensLegaux liens={f.streamingLinks} />
          </View>
        ) : null}
      </Etat>
    </View>
  );
}

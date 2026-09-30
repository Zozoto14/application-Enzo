/** Fiche d'un film : synopsis, bibliothèque, lecture, lien direct, « vu ailleurs ». */

import React from 'react';
import { Text, View } from 'react-native';
import { trouver } from '../moteur/bibliotheque';
import { ouvrirExterne } from './externe';
import { useCharger, useTsuzuku } from './contexte';
import { BandeauFiche, BlocBibliotheque, BlocVuAilleurs, LiensLegaux, type FicheMin } from './FicheCommune';
import { LienFilm } from './LienFilm';
import { Bouton, Etat, LIBELLE_STATUT, styleTexte } from './ui';

export function FicheFilmEcran({ id }: { id: string }) {
  const { s, theme, aller, retour, version } = useTsuzuku();
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
            <BandeauFiche
              image={f.image}
              banniere={f.banner}
              etiquette="FILM"
              statut={entree?.status}
              score={f.score}
              titre={f.title}
              sousTitre={[f.originalTitle && f.originalTitle !== f.title ? f.originalTitle : null, f.tagline].filter(Boolean).join(' — ') || null}
              meta={[f.year, f.runtime ? `${f.runtime} min` : null]}
              genres={f.genres}
              synopsis={f.synopsis}>
              {entree ? (
                <Text style={[styleTexte(theme, 13), { fontWeight: '700', color: theme.accent }]} testID="fiche-statut">
                  {LIBELLE_STATUT[entree.status]}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Bouton titre="▶ Lire le film" variante="plein" onPress={() => aller({ t: 'lecteur', kind: 'movie', id })} testID="fiche-lire" />
                {f.trailer ? <Bouton titre="Bande-annonce ↗" onPress={() => void ouvrirExterne(f.trailer!)} /> : null}
              </View>
            </BandeauFiche>
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

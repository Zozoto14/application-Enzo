/** Fiche d'un animé : synopsis, bibliothèque, épisodes, lecture, lien manuel, « vu ailleurs ». */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { trouver } from '../moteur/bibliotheque';
import { useCharger, useTsuzuku } from './contexte';
import { BlocBibliotheque, BlocVuAilleurs, LiensLegaux, Meta, Synopsis, type FicheMin } from './FicheCommune';
import { LienAnime, prochainEpisode } from './LienAnime';
import { Bouton, Etat, LIBELLE_STATUT, Titre, styleAttenue, styleTexte } from './ui';

const PAR_PAGE = 30;

export function FicheAnimeEcran({ id }: { id: string }) {
  const { s, theme, aller, retour, version, large } = useTsuzuku();
  const fiche = useCharger(async () => (await s.catalogue.animes.parId(id)).data, [s, id]);
  const eps = useCharger(async () => (await s.catalogue.animes.episodes(id)).data, [s, id]);
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const [visibles, setVisibles] = useState(PAR_PAGE);
  const f = fiche.donnees;
  const entree = lib.donnees ? trouver(lib.donnees, 'anime', id) : null;
  const min: FicheMin | undefined = f ? { kind: 'anime', id, title: f.title, image: f.image, year: f.year, totalEpisodes: f.totalEpisodes } : undefined;
  const suivant = prochainEpisode(lib.donnees, id);
  const listeEps = eps.donnees?.length ? eps.donnees : f?.totalEpisodes ? Array.from({ length: f.totalEpisodes }, (_, i) => ({ number: i + 1, title: null, aired: null, filler: false, url: null })) : [];

  return (
    <View style={{ gap: 18 }} testID="tsuzuku-fiche-anime">
      <View style={{ alignSelf: 'flex-start' }}>
        <Bouton titre="← Retour" onPress={retour} testID="fiche-retour" />
      </View>
      <Etat enCours={fiche.enCours} erreur={fiche.erreur} onRecharger={fiche.recharger}>
        {f && min ? (
          <View style={{ gap: 18 }}>
            <View style={{ flexDirection: large ? 'row' : 'column', gap: 16 }}>
              {f.image ? <Image source={{ uri: f.image }} accessibilityIgnoresInvertColors accessibilityLabel={`Affiche de ${f.title}`} style={{ width: 150, height: 218, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }} /> : null}
              <View style={{ flex: 1, gap: 8 }}>
                <Titre taille={26} testID="fiche-titre">{f.title}</Titre>
                {f.titleJapanese ? <Text style={styleAttenue(theme)}>{f.titleJapanese}</Text> : null}
                <Meta lignes={[f.type, f.year, f.totalEpisodes ? `${f.totalEpisodes} épisodes` : null, f.airingStatus, f.score ? `★ ${f.score}` : null, f.studios.slice(0, 2).join(', ')]} />
                <Meta lignes={[f.genres.slice(0, 5).join(', ')]} />
                {entree ? <Text style={[styleTexte(theme, 13), { fontWeight: '700', color: theme.accent }]} testID="fiche-statut">{LIBELLE_STATUT[entree.status]}{entree.currentEpisode ? ` · épisode ${entree.currentEpisode}` : ''}</Text> : null}
                <Synopsis texte={f.synopsis} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  <Bouton titre={`▶ Lire l’épisode ${suivant}`} variante="plein" onPress={() => aller({ t: 'lecteur', kind: 'anime', id, numero: suivant })} testID="fiche-lire" />
                </View>
              </View>
            </View>
            <BlocBibliotheque fiche={min} entree={entree} />
            <BlocVuAilleurs fiche={min} entree={entree} />
            <LienAnime id={id} numeroCourant={suivant} catalogue={listeEps} />
            <LiensLegaux liens={f.streamingLinks} />
            <View style={{ gap: 8 }} testID="fiche-episodes">
              <Titre taille={18}>Épisodes</Titre>
              <Etat enCours={eps.enCours && !eps.donnees} erreur={eps.erreur} onRecharger={eps.recharger} vide={!listeEps.length && !eps.enCours ? 'Aucune liste d’épisodes : utilisez « Lire l’épisode » ou un lien manuel.' : undefined}>
                <ScrollView scrollEnabled={false}>
                  {listeEps.slice(0, visibles).map(ep => {
                    const vu = (entree?.currentEpisode ?? 0) >= ep.number;
                    return (
                      <Pressable
                        key={ep.number}
                        testID={`episode-${ep.number}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Lire l’épisode ${ep.number}${ep.title ? `, ${ep.title}` : ''}${vu ? ', vu' : ''}`}
                        onPress={() => aller({ t: 'lecteur', kind: 'anime', id, numero: ep.number })}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
                        <Text style={[styleTexte(theme, 14), { width: 34, fontWeight: '700', color: vu ? theme.attenue : theme.accent }]}>{ep.number}</Text>
                        <Text numberOfLines={1} style={[styleTexte(theme, 14), { flex: 1, opacity: vu ? 0.6 : 1 }]}>{ep.title ?? `Épisode ${ep.number}`}</Text>
                        {ep.filler ? <Text style={styleAttenue(theme, 11)}>Filler</Text> : null}
                        <Text style={{ color: theme.accent, fontWeight: '700' }}>{vu ? '✓' : '▶'}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {listeEps.length > visibles ? <Bouton titre={`Afficher la suite (${listeEps.length - visibles})`} onPress={() => setVisibles(v => v + PAR_PAGE)} testID="episodes-plus" style={{ alignSelf: 'center' }} /> : null}
              </Etat>
            </View>
          </View>
        ) : null}
      </Etat>
    </View>
  );
}

/** Catalogue et recherche : champ, genres, résultats en grille. */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police } from '../../hub/themes';
import { FeuilleBasse } from '../../ui/mobile/FeuilleBasse';
import { Cellule, GroupeCellules } from '../../ui/mobile/ListeCellules';
import { ChampRecherche } from './mobile/ElementsMobile';
import type { FicheAnime, FicheFilm } from '../moteur/catalogue';
import { carteAnime, carteFilm, sansVus } from './elements';
import { useCharger, useTsuzuku } from './contexte';
import { Grille } from './listes';
import { Bouton, Champ, Etat, EtatVide, Puce, Titre } from './ui';

export function Catalogue({ q: qInitial, genre: genreInitial }: { q?: string; genre?: string }) {
  const { s, theme, mode, aller, version, mobile } = useTsuzuku();
  const [filtres, setFiltres] = useState(false);
  const [saisie, setSaisie] = useState(qInitial ?? '');
  const [q, setQ] = useState(qInitial ?? '');
  const [genre, setGenre] = useState<string | undefined>(genreInitial);
  const [page, setPage] = useState(1);
  const [plus, setPlus] = useState<(FicheAnime | FicheFilm)[]>([]);

  // Le mode change (Animés ↔ Films) : on repart d'une recherche vide.
  useEffect(() => {
    setGenre(undefined);
    setPage(1);
    setPlus([]);
  }, [mode]);
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const reg = useCharger(() => s.reglages(), [s, version]);
  const genres = useCharger<{ id: string; nom: string }[]>(
    async () => (mode === 'anime' ? (await s.catalogue.animes.genres()).slice(0, 40).map(g => ({ id: g, nom: g })) : (await s.catalogue.films.genres()).genres.map(g => ({ id: String(g.id), nom: g.name }))),
    [s, mode],
  );
  const resultats = useCharger<{ items: (FicheAnime | FicheFilm)[]; suite: boolean }>(async () => {
    if (mode === 'anime') {
      if (q) return { items: (await s.catalogue.animes.rechercher(q, page * 24)).data, suite: page < 2 };
      if (genre) return { items: (await s.catalogue.animes.parcourir({ genre, page })).items, suite: true };
      return { items: (await s.catalogue.animes.populaires(24 * page)).data, suite: page < 2 };
    }
    const r = q ? await s.catalogue.films.rechercher(q, page) : await s.catalogue.films.parcourir({ genre, page });
    return { items: r.items, suite: r.pageInfo.hasNextPage };
  }, [s, mode, q, genre, page]);

  const donnees = resultats.donnees;
  // Films et parcours d'animés par genre : les pages s'ajoutent ; sinon la liste est déjà complète.
  const accumule = mode === 'movie' || (mode === 'anime' && !q && Boolean(genre));
  const items = donnees ? (accumule && page > 1 ? [...plus, ...donnees.items] : donnees.items) : [];

  const chercher = () => {
    setQ(saisie.trim());
    setPage(1);
    setPlus([]);
  };
  const cartes = items
    .filter((f, i, l) => l.findIndex(g => String(g.id) === String(f.id)) === i)
    .map(f =>
    mode === 'anime'
      ? carteAnime(f as FicheAnime, lib.donnees, id => aller({ t: 'fiche', kind: 'anime', id }))
      : carteFilm(f as FicheFilm, lib.donnees, id => aller({ t: 'fiche', kind: 'movie', id })),
  );

  const choisirGenre = (id: string | undefined) => {
    setGenre(id);
    setQ('');
    setSaisie('');
    setPage(1);
    setPlus([]);
  };
  if (mobile) {
    const nomGenre = genre ? (genres.donnees?.find(g => g.id === genre)?.nom ?? genre) : undefined;
    return (
      <View style={{ gap: 16 }} testID="tsuzuku-catalogue">
        <Titre taille={28}>{q ? `Résultats pour « ${q} »` : mode === 'anime' ? 'Catalogue des animés' : 'Catalogue des films'}</Titre>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <ChampRecherche libelle="Rechercher" valeur={saisie} onChanger={setSaisie} onValider={chercher} testID="catalogue-recherche" placeholder="Titre" />
          <Pressable
            testID="catalogue-filtres"
            accessibilityRole="button"
            accessibilityLabel={nomGenre ? `Filtres, genre : ${nomGenre}` : 'Filtres'}
            onPress={() => setFiltres(true)}
            style={{ minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: Math.min(theme.rayonMoyen, 12), borderColor: nomGenre ? theme.accent : theme.ligne, backgroundColor: theme.surface }}>
            <Text style={{ color: nomGenre ? theme.accent : theme.texte, fontSize: 17, fontWeight: '600', ...police(theme.policeTexte) }}>⚲ Filtres</Text>
          </Pressable>
        </View>
        {nomGenre ? (
          <Pressable testID="catalogue-genre-actif" accessibilityRole="button" accessibilityLabel={`Retirer le filtre ${nomGenre}`} onPress={() => choisirGenre(undefined)} style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: theme.accent }}>
            <Text style={{ color: theme.surAccent, fontSize: 15, fontWeight: '700', ...police(theme.policeTexte) }}>{nomGenre}  ✕</Text>
          </Pressable>
        ) : null}
        <Etat enCours={resultats.enCours && !donnees} erreur={resultats.erreur} onRecharger={resultats.recharger} squelette="affiches">
          {donnees && !items.length ? (
            <EtatVide icone="⌕" titre="Aucun résultat">
              Essayez une autre orthographe, le titre original ou un mot-clé plus court.
            </EtatVide>
          ) : null}
          <Grille elements={sansVus(cartes, Boolean(reg.donnees?.masquerVus))} testID="catalogue-grille" />
          {donnees?.suite && items.length ? (
            <Bouton
              titre={resultats.enCours ? 'Chargement…' : 'Plus de résultats'}
              desactive={resultats.enCours}
              onPress={() => {
                setPlus(items);
                setPage(p => p + 1);
              }}
              testID="catalogue-plus"
              style={{ minHeight: 48 }}
            />
          ) : null}
        </Etat>
        <FeuilleBasse theme={theme} visible={filtres} titre="Filtrer par genre" onFermer={() => setFiltres(false)} testID="catalogue-feuille-genres">
          {genres.donnees?.length ? (
            <GroupeCellules theme={theme}>
              <Cellule theme={theme} titre="Tous les genres" coche={!genre} onPress={() => { choisirGenre(undefined); setFiltres(false); }} testID="genre-tous" />
              {genres.donnees.map(g => (
                <Cellule key={g.id} theme={theme} titre={g.nom} coche={genre === g.id} onPress={() => { choisirGenre(g.id); setFiltres(false); }} testID={`genre-${g.id}`} />
              ))}
            </GroupeCellules>
          ) : (
            <Text style={{ color: theme.attenue, fontSize: 16, ...police(theme.policeTexte) }}>Les genres ne sont pas disponibles pour le moment.</Text>
          )}
        </FeuilleBasse>
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }} testID="tsuzuku-catalogue">
      <Titre taille={30}>{q ? `Résultats pour « ${q} »` : mode === 'anime' ? 'Catalogue des animés' : 'Catalogue des films'}</Titre>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <Champ libelle="Rechercher" valeur={saisie} onChanger={setSaisie} onValider={chercher} testID="catalogue-recherche" style={{ flex: 1 }} placeholder="Titre" />
        <Bouton titre="Chercher" onPress={chercher} variante="plein" testID="catalogue-chercher" />
      </View>
      {genres.donnees?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Genres">
          <Puce titre="Tous" actif={!genre} onPress={() => { setGenre(undefined); setQ(''); setSaisie(''); setPage(1); setPlus([]); }} testID="genre-tous" />
          {genres.donnees.map(g => (
            <Puce key={g.id} titre={g.nom} actif={genre === g.id} onPress={() => { setGenre(g.id); setQ(''); setSaisie(''); setPage(1); setPlus([]); }} testID={`genre-${g.id}`} />
          ))}
        </View>
      ) : null}
      <Etat enCours={resultats.enCours && !donnees} erreur={resultats.erreur} onRecharger={resultats.recharger} squelette="affiches">
        {donnees && !items.length ? (
          <EtatVide icone="⌕" titre="Aucun résultat">
            Essayez une autre orthographe, le titre original ou un mot-clé plus court.
          </EtatVide>
        ) : null}
        <Grille elements={sansVus(cartes, Boolean(reg.donnees?.masquerVus))} testID="catalogue-grille" />
        {donnees?.suite && items.length ? (
          <Bouton
            titre={resultats.enCours ? 'Chargement…' : 'Plus de résultats'}
            desactive={resultats.enCours}
            onPress={() => {
              setPlus(items);
              setPage(p => p + 1);
            }}
            testID="catalogue-plus"
            style={{ alignSelf: 'center' }}
          />
        ) : null}
      </Etat>
    </View>
  );
}

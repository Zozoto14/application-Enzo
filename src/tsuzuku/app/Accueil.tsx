/** Accueil : reprendre, puis les rangées du catalogue (animés ou films selon le mode). */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { FicheAnime, FicheFilm, Rangee as RangeeCatalogue } from '../moteur/catalogue';
import { carteAnime, carteFilm, sansVus } from './elements';
import { useCharger, useTsuzuku } from './contexte';
import { Avis, Bouton, Champ, Etat, Rangee, elementDepuisEntree, styleAttenue } from './ui';

type Donnees = { anime?: RangeeCatalogue<FicheAnime>[]; films?: RangeeCatalogue<FicheFilm>[]; source?: 'tmdb' | 'jikan' };

export function Accueil() {
  const { s, mode, aller, theme, version } = useTsuzuku();
  const [q, setQ] = useState('');
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const reg = useCharger(() => s.reglages(), [s, version]);
  const cat = useCharger<Donnees>(
    async () => (mode === 'anime' ? { anime: await s.catalogue.animes.decouvrir() } : ((r: { rows: RangeeCatalogue<FicheFilm>[]; source: 'tmdb' | 'jikan' }) => ({ films: r.rows, source: r.source }))(await s.catalogue.films.decouvrir())),
    [s, mode],
  );
  const db = lib.donnees;
  const masquer = Boolean(reg.donnees?.masquerVus);
  const reprendre = (db ? (mode === 'anime' ? db.anime : db.movies) : []).filter(e => e.status === 'en_cours' || e.status === 'a_reprendre').sort((a, b) => String(b.lastWatched ?? '').localeCompare(String(a.lastWatched ?? '')));
  const chercher = () => aller({ t: 'catalogue', q: q.trim() });

  return (
    <View style={{ gap: 22 }} testID="tsuzuku-accueil">
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <Champ libelle={mode === 'anime' ? 'Rechercher un animé' : 'Rechercher un film'} valeur={q} onChanger={setQ} onValider={chercher} testID="accueil-recherche" placeholder={mode === 'anime' ? 'Frieren, One Piece…' : 'Titre du film'} style={{ flex: 1 }} />
        <Bouton titre="Chercher" onPress={chercher} variante="plein" testID="accueil-chercher" />
      </View>
      {reprendre.length ? (
        <Rangee titre="Reprendre" testID="rangee-reprendre" elements={reprendre.slice(0, 12).map(e => elementDepuisEntree(e, () => aller({ t: 'fiche', kind: e.kind, id: e.id })))} />
      ) : null}
      {mode === 'movie' && cat.donnees?.source === 'jikan' ? (
        <Avis texte="Sans clé TMDB, seuls les films d’animation (Jikan) sont proposés. Ajoutez une clé dans Paramètres › Tsuzuku pour tout le catalogue." />
      ) : null}
      <Etat enCours={cat.enCours} erreur={cat.erreur} onRecharger={cat.recharger}>
        {cat.donnees?.anime?.map(r => (
          <Rangee key={r.key} titre={r.title} testID={`rangee-${r.key}`} elements={sansVus(r.items.map(f => carteAnime(f, db, id => aller({ t: 'fiche', kind: 'anime', id }))), masquer)} />
        ))}
        {cat.donnees?.films?.map(r => (
          <Rangee key={r.key} titre={r.title} testID={`rangee-${r.key}`} elements={sansVus(r.items.map(f => carteFilm(f, db, id => aller({ t: 'fiche', kind: 'movie', id }))), masquer)} />
        ))}
      </Etat>
      {!cat.enCours && !cat.erreur && !cat.donnees?.anime?.length && !cat.donnees?.films?.length ? <Text style={styleAttenue(theme, 14)}>Le catalogue est vide pour le moment.</Text> : null}
    </View>
  );
}

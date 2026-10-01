/**
 * Accueil (« Découvrir ») : comme l'ancienne version de Tsuzuku — bandeau « à la
 * une », rangée « Reprendre » en tuiles larges, rangées du catalogue (animés ou
 * films selon le mode), puis « Ma bibliothèque ». Squelettes au chargement.
 */

import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../hub/themes';
import { ajouterOuMettreAJour, trouver, type Entree } from '../moteur/bibliotheque';
import type { FicheAnime, FicheFilm, Rangee as RangeeCatalogue } from '../moteur/catalogue';
import { carteAnime, carteFilm, sansVus } from './elements';
import { CarteSansSource } from './EtatSources';
import { useCharger, useTsuzuku } from './contexte';
import { Avis, Bouton, Champ, Etat, EtatVide, Rangee, RangeeReprendre, elementDepuisEntree, styleAttenue } from './ui';

type Donnees = { anime?: RangeeCatalogue<FicheAnime>[]; films?: RangeeCatalogue<FicheFilm>[]; source?: 'tmdb' | 'jikan' };
type Une = { id: string; titre: string; image: string | null; banniere: string | null; score: number | null; meta: string; genres: string[]; synopsis: string | null; annee: number | null; total: number | null; duree: number | null };

function uneDepuis(d: Donnees | undefined): Une | undefined {
  const a = d?.anime?.find(r => r.items.length)?.items[0];
  if (a) {
    return { id: String(a.id), titre: a.title, image: a.image, banniere: a.banner ?? null, score: a.score, meta: [a.type, a.year, a.totalEpisodes ? `${a.totalEpisodes} ép.` : null].filter(Boolean).join(' · '), genres: a.genres, synopsis: a.synopsis, annee: a.year, total: a.totalEpisodes, duree: null };
  }
  const f = d?.films?.find(r => r.items.length)?.items[0];
  if (f) {
    return { id: f.id, titre: f.title, image: f.image, banniere: f.banner, score: f.score, meta: [f.type, f.year, f.runtime ? `${f.runtime} min` : null].filter(Boolean).join(' · '), genres: f.genres, synopsis: f.synopsis, annee: f.year, total: null, duree: f.runtime };
  }
  return undefined;
}

/** Bandeau « à la une » : visuel plein cadre fondu dans le fond, titre, genres, synopsis, actions. */
function BandeauUne({ une, entree }: { une: Une; entree: Entree | null }) {
  const { s, theme, mode, aller, changee, large } = useTsuzuku();
  const film = mode === 'movie';
  const visuel = une.banniere || une.image;
  const ajouter = () =>
    void s.depot
      .modifier(db => void ajouterOuMettreAJour(db, film ? 'movie' : 'anime', { id: une.id, title: une.titre, image: une.image, year: une.annee, totalEpisodes: une.total, runtime: une.duree, status: 'a_voir' }))
      .then(changee, () => undefined);
  return (
    <View testID="tsuzuku-une" accessibilityLabel="À la une" style={{ borderRadius: Math.max(theme.rayonGrand, 12), overflow: 'hidden', borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, minHeight: large ? 380 : 330, justifyContent: 'flex-end' }}>
      {visuel ? <Image source={{ uri: visuel }} accessibilityIgnoresInvertColors style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.85 }} resizeMode="cover" /> : null}
      {/* Voiles : le texte reste lisible sur n'importe quelle image, dans les 8 thèmes. */}
      {/* Fondu par paliers (pas de dégradé natif) : plus opaque à gauche, sous le texte. */}
      {(large ? ['45%', '60%', '75%', '90%'] : ['100%']).map(l => (
        <View key={l} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: l as `${number}%`, backgroundColor: teinteTransparente(theme.fond, large ? 0.22 : 0.62) }} />
      ))}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: teinteTransparente(theme.fond, 0.25) }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', backgroundColor: teinteTransparente(theme.fond, 0.35) }} />
      <View style={{ padding: large ? 36 : 20, gap: 12, maxWidth: 680 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <View style={{ backgroundColor: theme.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Math.min(theme.rayonMoyen, 4) }}>
            <Text style={{ color: theme.surAccent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, ...police(theme.policeTexte) }}>{film ? 'FILM À L’AFFICHE' : 'ANIMÉ À LA UNE'}</Text>
          </View>
          {une.score ? <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '800' }}>★ {une.score.toFixed(1)} / 10</Text> : null}
          {une.meta ? <Text style={[styleAttenue(theme, 13), { color: theme.texte, fontWeight: '600' }]}>{une.meta}</Text> : null}
        </View>
        <Text accessibilityRole="header" numberOfLines={2} testID="une-titre" style={{ color: theme.texte, fontSize: large ? 44 : 32, lineHeight: large ? 50 : 38, fontWeight: theme.poidsTitre === '400' ? '600' : '800', letterSpacing: -0.5, ...police(theme.policeTitre) }}>
          {une.titre}
        </Text>
        {une.genres.length ? <Text style={{ color: theme.texte, opacity: 0.8, fontSize: 11, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', ...police(theme.policeTexte) }}>{une.genres.slice(0, 4).join(' · ')}</Text> : null}
        {une.synopsis ? (
          <Text numberOfLines={3} style={{ color: theme.texte, opacity: 0.88, fontSize: 15, lineHeight: 22, ...police(theme.policeTexte) }}>
            {une.synopsis}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <Bouton titre={film ? '▶ Regarder' : '▶ Voir la fiche'} variante="plein" onPress={() => aller(film ? { t: 'lecteur', kind: 'movie', id: une.id } : { t: 'fiche', kind: 'anime', id: une.id })} testID="une-principal" />
          {film ? <Bouton titre="Voir la fiche" onPress={() => aller({ t: 'fiche', kind: 'movie', id: une.id })} testID="une-fiche" /> : null}
          {entree ? (
            <Text style={[styleAttenue(theme, 14), { color: theme.texte, fontWeight: '700' }]}>Déjà dans ta bibliothèque</Text>
          ) : (
            <Bouton titre={film ? '+ À voir' : '+ Ma bibliothèque'} onPress={ajouter} testID="une-ajouter" />
          )}
        </View>
      </View>
    </View>
  );
}

export function Accueil() {
  const { s, mode, aller, version } = useTsuzuku();
  const [q, setQ] = useState('');
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const reg = useCharger(() => s.reglages(), [s, version]);
  const cat = useCharger<Donnees>(
    async () => (mode === 'anime' ? { anime: await s.catalogue.animes.decouvrir() } : ((r: { rows: RangeeCatalogue<FicheFilm>[]; source: 'tmdb' | 'jikan' }) => ({ films: r.rows, source: r.source }))(await s.catalogue.films.decouvrir())),
    [s, mode],
  );
  const db = lib.donnees;
  const masquer = Boolean(reg.donnees?.masquerVus);
  const kind = mode === 'anime' ? 'anime' : 'movie';
  const miens = db ? (mode === 'anime' ? db.anime : db.movies) : [];
  const reprendre = miens
    .filter(e => (mode === 'anime' ? e.status === 'en_cours' || e.status === 'a_reprendre' : e.status === 'a_voir' || e.status === 'en_cours'))
    .sort((a, b) => String(b.lastWatched ?? b.dateAdded ?? '').localeCompare(String(a.lastWatched ?? a.dateAdded ?? '')));
  const chercher = () => aller({ t: 'catalogue', q: q.trim() });
  const une = uneDepuis(cat.donnees);
  const vide = !cat.enCours && !cat.erreur && !cat.donnees?.anime?.some(r => r.items.length) && !cat.donnees?.films?.some(r => r.items.length);

  return (
    <View style={{ gap: 28 }} testID="tsuzuku-accueil">
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <Champ libelle={mode === 'anime' ? 'Rechercher un animé' : 'Rechercher un film'} cacherLibelle valeur={q} onChanger={setQ} onValider={chercher} testID="accueil-recherche" placeholder={mode === 'anime' ? '⌕  Rechercher un animé…' : '⌕  Rechercher un film…'} style={{ flex: 1 }} />
        <Bouton titre="Chercher" onPress={chercher} variante="plein" testID="accueil-chercher" />
      </View>
      <CarteSansSource lieu="accueil" />
      <Etat enCours={cat.enCours} erreur={cat.erreur} onRecharger={cat.recharger} squelette="heros">
        <View style={{ gap: 34 }}>
          {une ? <BandeauUne une={une} entree={db ? trouver(db, kind, une.id) : null} /> : null}
          <RangeeReprendre
            titre={mode === 'anime' ? 'Reprendre' : 'À voir ce soir'}
            entrees={reprendre.slice(0, 12)}
            onLire={e => aller(e.kind === 'movie' ? { t: 'lecteur', kind: 'movie', id: e.id } : { t: 'lecteur', kind: 'anime', id: e.id, numero: (e.currentEpisode || 0) + 1 })}
          />
          {mode === 'movie' && cat.donnees?.source === 'jikan' ? <Avis texte="Sans clé TMDB, seuls les films d’animation (Jikan) sont proposés. L’administration peut ajouter une clé pour tout le catalogue." /> : null}
          {cat.donnees?.anime?.map(r => (
            <Rangee key={r.key} titre={r.title} testID={`rangee-${r.key}`} elements={sansVus(r.items.map(f => carteAnime(f, db, id => aller({ t: 'fiche', kind: 'anime', id }))), masquer)} />
          ))}
          {cat.donnees?.films?.map(r => (
            <Rangee key={r.key} titre={r.title} testID={`rangee-${r.key}`} elements={sansVus(r.items.map(f => carteFilm(f, db, id => aller({ t: 'fiche', kind: 'movie', id }))), masquer)} />
          ))}
          <Rangee titre="Ma bibliothèque" testID="rangee-bibliotheque" elements={miens.slice(0, 20).map(e => elementDepuisEntree(e, () => aller({ t: 'fiche', kind: e.kind, id: e.id })))} />
        </View>
      </Etat>
      {vide ? (
        <EtatVide icone="◌" titre="Le catalogue est vide pour le moment">
          Réessayez plus tard : votre bibliothèque et votre progression restent accessibles.
        </EtatVide>
      ) : null}
    </View>
  );
}

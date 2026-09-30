/** Bibliothèque : onglets par statut, « vu ailleurs », statistiques, historique, export. */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { collection, exporterEnTexte, statistiques, type Statut } from '../moteur/bibliotheque';
import { messageDe } from '../moteur/erreurs';
import { jourDe } from '../moteur/outils';
import { useCharger, useTsuzuku } from './contexte';
import { Avis, Bouton, Champ, Etat, Grille, LIBELLE_STATUT, Puce, Titre, elementDepuisEntree, styleAttenue, styleTexte } from './ui';

type Onglet = 'tous' | Statut | 'favoris';

const ONGLETS: ReadonlyArray<readonly [Onglet, string]> = [
  ['tous', 'Tous'],
  ['a_voir', LIBELLE_STATUT.a_voir],
  ['en_cours', LIBELLE_STATUT.en_cours],
  ['a_reprendre', LIBELLE_STATUT.a_reprendre],
  ['vu', LIBELLE_STATUT.vu],
  ['vu_ailleurs', LIBELLE_STATUT.vu_ailleurs],
  ['favoris', '♥ Favoris'],
];

export function Bibliotheque() {
  const { s, mode, aller, theme, version, enregistrerFichier } = useTsuzuku();
  const [onglet, setOnglet] = useState<Onglet>('tous');
  const [export_, setExport] = useState<string | undefined>();
  const [avis, setAvis] = useState<{ texte: string; genre: 'ok' | 'critique' } | undefined>();
  const lib = useCharger(() => s.depot.lire(), [s, version]);
  const db = lib.donnees;
  const liste = db ? collection(db, mode) : [];
  const filtrees = liste
    .filter(e => (onglet === 'tous' ? true : onglet === 'favoris' ? e.favorite : e.status === onglet))
    .sort((a, b) => String(b.lastWatched ?? b.dateAdded ?? '').localeCompare(String(a.lastWatched ?? a.dateAdded ?? '')));
  const stats = db ? statistiques(db) : undefined;
  const bloc = mode === 'anime' ? stats?.anime : stats?.movies;
  const compte = (o: Onglet) => (o === 'tous' ? liste.length : o === 'favoris' ? liste.filter(e => e.favorite).length : liste.filter(e => e.status === o).length);

  const exporter = async () => {
    if (!db) return;
    try {
      const texte = exporterEnTexte(db);
      const nom = `tsuzuku-bibliotheque-${jourDe()}.json`;
      if (enregistrerFichier && (await enregistrerFichier(nom, texte, 'application/json'))) {
        setAvis({ texte: `Bibliothèque exportée (${nom}).`, genre: 'ok' });
        setExport(undefined);
      } else {
        setExport(texte);
      }
    } catch (e) {
      setAvis({ texte: messageDe(e), genre: 'critique' });
    }
  };

  return (
    <View style={{ gap: 16 }} testID="tsuzuku-bibliotheque">
      <Titre>{mode === 'anime' ? 'Ma bibliothèque d’animés' : 'Ma bibliothèque de films'}</Titre>
      {bloc && stats ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} testID="bibliotheque-stats" accessibilityLabel="Statistiques">
          {[
            ['Titres', String(bloc.total)],
            ['Vus', String(bloc.seen)],
            ['Vus ailleurs', String(bloc.watchedElsewhere)],
            mode === 'anime' ? ['Épisodes vus', String(stats.anime.episodesWatched)] : ['Heures vues', String(Math.round((stats.movies.minutesWatched / 60) * 10) / 10)],
            ['Note moyenne', bloc.averageRating == null ? '—' : String(bloc.averageRating)],
          ].map(([l, v]) => (
            <View key={l} style={{ minWidth: 92, padding: 10, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }}>
              <Text style={styleAttenue(theme, 11)}>{l.toUpperCase()}</Text>
              <Text style={[styleTexte(theme, 20), { fontWeight: '600' }]}>{v}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Statut">
        {ONGLETS.map(([cle, titre]) => (
          <Puce key={cle} titre={`${titre} (${compte(cle)})`} actif={onglet === cle} onPress={() => setOnglet(cle)} testID={`onglet-${cle}`} />
        ))}
      </View>
      <Etat enCours={lib.enCours && !db} erreur={lib.erreur} onRecharger={lib.recharger} vide={db && !filtrees.length ? (liste.length ? 'Rien dans cet onglet.' : 'Votre bibliothèque est vide : ajoutez des titres depuis leur fiche.') : undefined}>
        <Grille elements={filtrees.map(e => elementDepuisEntree(e, () => aller({ t: 'fiche', kind: e.kind, id: e.id })))} testID="bibliotheque-grille" />
      </Etat>
      {db?.history.length ? (
        <View style={{ gap: 6 }} testID="bibliotheque-historique">
          <Titre taille={16}>Historique récent</Titre>
          {db.history.slice(0, 8).map((h, i) => (
            <Text key={`${h.animeId}-${h.episode}-${i}`} style={styleAttenue(theme, 13)}>
              {String(h.watchedAt).slice(0, 10)} · {h.title}
              {h.kind === 'anime' ? ` · Ép. ${h.episode}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 10 }}>
        <Titre taille={16}>Sauvegarde</Titre>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Bouton titre="Exporter (JSON)" onPress={() => void exporter()} testID="bibliotheque-exporter" />
          {s.estAdmin ? <Bouton titre="Importer ma bibliothèque Tsuzuku" onPress={() => aller({ t: 'import' })} testID="bibliotheque-importer" /> : null}
        </View>
        {avis ? <Avis genre={avis.genre} texte={avis.texte} testID="bibliotheque-avis" /> : null}
        {export_ ? <Champ libelle="Export à copier" valeur={export_} onChanger={() => undefined} multiligne testID="bibliotheque-export-texte" /> : null}
      </View>
    </View>
  );
}

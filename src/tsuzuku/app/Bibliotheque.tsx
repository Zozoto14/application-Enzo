/** Bibliothèque : onglets par statut, « vu ailleurs », statistiques, historique, export. */

import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { police } from '../../hub/themes';
import { collection, exporterEnTexte, statistiques, type Statut } from '../moteur/bibliotheque';
import { messageDe } from '../moteur/erreurs';
import { jourDe } from '../moteur/outils';
import { useCharger, useTsuzuku } from './contexte';
import { Grille, RangeeReprendre } from './listes';
import { BibliothequeMobile } from './mobile/BibliothequeMobile';
import { Avis, Bouton, Champ, Etat, EtatVide, LIBELLE_STATUT, Puce, Titre, TitreSection, couleurStatut, elementDepuisEntree, styleAttenue, styleTexte } from './ui';

type Onglet = 'tous' | Statut | 'favoris';

const STATUTS_ORDRE: readonly Statut[] = ['en_cours', 'a_reprendre', 'a_voir', 'vu', 'vu_ailleurs'];

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
  const { s, mode, aller, theme, version, enregistrerFichier, mobile } = useTsuzuku();
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

  if (mobile) {
    const tuiles: (readonly [string, string, string])[] = bloc && stats
      ? [
          ['Titres', String(bloc.total), `${liste.filter(e => e.favorite).length} favori(s)`],
          ['Vus (ici + ailleurs)', String(bloc.seen), bloc.total ? `${Math.round((bloc.seen / bloc.total) * 100)} % de la liste` : ''],
          ['Vus ailleurs', String(bloc.watchedElsewhere), ''],
          mode === 'anime' ? (['Épisodes vus', String(stats.anime.episodesWatched), ''] as const) : (['Heures vues', String(Math.round((stats.movies.minutesWatched / 60) * 10) / 10), ''] as const),
          ['Note moyenne', bloc.averageRating == null ? '—' : `${bloc.averageRating}/10`, ''],
        ]
      : [];
    return (
      <BibliothequeMobile
        titre={mode === 'anime' ? 'Ma bibliothèque d’animés' : 'Ma bibliothèque de films'}
        tuiles={tuiles}
        repartition={liste.length ? STATUTS_ORDRE.map(st => [st, compte(st)] as const) : null}
        reprendre={liste.filter(e => e.status === 'en_cours' || e.status === 'a_reprendre').slice(0, 10)}
        onLire={e => aller(e.kind === 'movie' ? { t: 'lecteur', kind: 'movie', id: e.id } : { t: 'lecteur', kind: 'anime', id: e.id, numero: (e.currentEpisode || 0) + 1 })}
        onglets={ONGLETS.map(([cle, titre]) => [cle, titre, compte(cle)] as const)}
        onglet={onglet}
        onOnglet={cle => setOnglet(cle as Onglet)}
        chargement={{ enCours: lib.enCours, erreur: lib.erreur, recharger: lib.recharger, aDonnees: Boolean(db) }}
        elements={filtrees.map(e => elementDepuisEntree(e, () => aller({ t: 'fiche', kind: e.kind, id: e.id })))}
        vide={db && !filtrees.length ? { icone: liste.length ? '◌' : '＋', titre: liste.length ? 'Rien dans cet onglet' : 'Votre bibliothèque est vide', texte: liste.length ? 'Choisissez un autre statut.' : 'Ajoutez des titres depuis leur fiche ou depuis « Accueil ».' } : null}
        historique={db?.history ?? []}
        estAdmin={s.estAdmin}
        onExporter={() => void exporter()}
        onImporter={() => aller({ t: 'import' })}
        exportTexte={export_}
        avis={avis}
      />
    );
  }
  return (
    <View style={{ gap: 16 }} testID="tsuzuku-bibliotheque">
      <Titre taille={32}>{mode === 'anime' ? 'Ma bibliothèque d’animés' : 'Ma bibliothèque de films'}</Titre>
      {bloc && stats ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} testID="bibliotheque-stats" accessibilityLabel="Statistiques">
          {[
            ['Titres', String(bloc.total), `${liste.filter(e => e.favorite).length} favori(s)`],
            ['Vus (ici + ailleurs)', String(bloc.seen), bloc.total ? `${Math.round((bloc.seen / bloc.total) * 100)} % de la liste` : ''],
            ['Vus ailleurs', String(bloc.watchedElsewhere), ''],
            mode === 'anime' ? ['Épisodes vus', String(stats.anime.episodesWatched), ''] : ['Heures vues', String(Math.round((stats.movies.minutesWatched / 60) * 10) / 10), ''],
            ['Note moyenne', bloc.averageRating == null ? '—' : `${bloc.averageRating}/10`, ''],
          ].map(([l, v, d]) => (
            <View key={l} style={{ flexGrow: 1, minWidth: 140, padding: 16, gap: 4, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.max(theme.rayonMoyen, 8) + 2 }}>
              <Text style={[styleTexte(theme, 30), { fontWeight: '800', ...police(theme.policeChiffres ?? theme.policeTitre) }]}>{v}</Text>
              <Text style={{ color: theme.attenue, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, ...police(theme.policeTexte) }}>{l.toUpperCase()}</Text>
              {d ? <Text style={styleAttenue(theme, 12)}>{d}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {liste.length ? (
        <View style={{ gap: 10, padding: 16, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.max(theme.rayonMoyen, 8) + 2 }} testID="bibliotheque-repartition" accessibilityLabel="Répartition par statut">
          <Text style={{ color: theme.attenue, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, ...police(theme.policeTexte) }}>RÉPARTITION</Text>
          <View style={{ flexDirection: 'row', height: 8, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
            {STATUTS_ORDRE.filter(st => compte(st)).map(st => (
              <View key={st} style={{ flexGrow: compte(st), backgroundColor: couleurStatut(theme, st) }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {STATUTS_ORDRE.map(st => (
              <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: couleurStatut(theme, st) }} />
                <Text style={styleTexte(theme, 13)}>
                  {LIBELLE_STATUT[st]} <Text style={{ fontWeight: '800' }}>{compte(st)}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <RangeeReprendre titre="Reprendre la lecture" testID="bibliotheque-reprendre" entrees={liste.filter(e => e.status === 'en_cours' || e.status === 'a_reprendre').slice(0, 10)} onLire={e => aller(e.kind === 'movie' ? { t: 'lecteur', kind: 'movie', id: e.id } : { t: 'lecteur', kind: 'anime', id: e.id, numero: (e.currentEpisode || 0) + 1 })} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Statut">
        {ONGLETS.map(([cle, titre]) => (
          <Puce key={cle} titre={`${titre} (${compte(cle)})`} actif={onglet === cle} onPress={() => setOnglet(cle)} testID={`onglet-${cle}`} />
        ))}
      </View>
      <Etat enCours={lib.enCours && !db} erreur={lib.erreur} onRecharger={lib.recharger} squelette="affiches">
        {db && !filtrees.length ? (
          <EtatVide icone={liste.length ? '◌' : '＋'} titre={liste.length ? 'Rien dans cet onglet' : 'Votre bibliothèque est vide'}>
            {liste.length ? 'Choisissez un autre statut.' : 'Ajoutez des titres depuis leur fiche ou depuis « Découvrir ».'}
          </EtatVide>
        ) : null}
        <Grille elements={filtrees.map(e => elementDepuisEntree(e, () => aller({ t: 'fiche', kind: e.kind, id: e.id })))} testID="bibliotheque-grille" />
      </Etat>
      {db?.history.length ? (
        <View style={{ gap: 12 }} testID="bibliotheque-historique">
          <TitreSection>Historique</TitreSection>
          <View style={{ borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.max(theme.rayonMoyen, 8) + 2, overflow: 'hidden' }}>
            {db.history.slice(0, 8).map((h, i) => (
              <View key={`${h.animeId}-${h.episode}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: theme.ligne }}>
                <View style={{ width: 32, height: 46, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.fond }}>{h.image ? <Image source={{ uri: h.image }} accessibilityIgnoresInvertColors style={{ width: 32, height: 46 }} /> : null}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styleTexte(theme, 14)}>{h.title}</Text>
                  {h.kind === 'anime' ? <Text style={styleAttenue(theme, 12)}>Épisode {h.episode}</Text> : null}
                </View>
                <Text style={styleAttenue(theme, 12)}>{String(h.watchedAt).slice(0, 10)}</Text>
              </View>
            ))}
          </View>
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

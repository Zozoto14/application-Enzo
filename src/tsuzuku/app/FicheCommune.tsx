/** Blocs communs aux fiches d'animés et de films : bibliothèque, « vu ailleurs », liens légaux. */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import {
  ajouterOuMettreAJour,
  marquerVuAilleurs,
  modifierEntree,
  supprimerEntree,
  STATUTS,
  type Entree,
  type Genre,
  type Statut,
} from '../moteur/bibliotheque';
import type { LienStreaming } from '../moteur/catalogue';
import { messageDe } from '../moteur/erreurs';
import { jourDe } from '../moteur/outils';
import { useTsuzuku } from './contexte';
import { ouvrirExterne } from './externe';
import { Avis, Bouton, Champ, LIBELLE_STATUT, Puce, styleAttenue, styleTexte, styleTitre } from './ui';

export interface FicheMin {
  kind: Genre;
  id: string;
  title: string;
  image: string | null;
  year: number | null;
  totalEpisodes?: number | null;
  runtime?: number | null;
}

/** Exécute une écriture de bibliothèque, prévient les écrans, montre l'erreur éventuelle. */
export function useAgir() {
  const { changee } = useTsuzuku();
  const [erreur, setErreur] = useState<string | undefined>();
  const agir = async (fn: () => Promise<unknown>) => {
    try {
      setErreur(undefined);
      await fn();
      changee();
      return true;
    } catch (e) {
      setErreur(messageDe(e));
      return false;
    }
  };
  return { agir, erreur, setErreur };
}

export function BlocBibliotheque({ fiche, entree }: { fiche: FicheMin; entree: Entree | null }) {
  const { s, theme } = useTsuzuku();
  const { agir, erreur } = useAgir();
  const statut = (st: Statut) =>
    agir(() =>
      s.depot.modifier(db => {
        ajouterOuMettreAJour(db, fiche.kind, { id: fiche.id, title: fiche.title, image: fiche.image, year: fiche.year, totalEpisodes: fiche.totalEpisodes ?? null, runtime: fiche.runtime ?? null, status: st });
        // « year » n'est pas gardé par ajouterOuMettreAJour à la mise à jour : on le complète.
        const e = db[fiche.kind === 'movie' ? 'movies' : 'anime'].find(x => x.id === fiche.id);
        if (e && !e.year && fiche.year) e.year = fiche.year;
      }),
    );
  return (
    <View style={{ gap: 10 }} testID="bloc-bibliotheque">
      <Text accessibilityRole="header" style={styleTitre(theme, 16)}>
        Ma bibliothèque
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {STATUTS.filter(x => x !== 'vu_ailleurs').map(st => (
          <Puce key={st} titre={LIBELLE_STATUT[st]} actif={entree?.status === st} onPress={() => void statut(st)} testID={`statut-${st}`} />
        ))}
        {entree?.status === 'vu_ailleurs' ? <Puce titre="Vu ailleurs" actif onPress={() => undefined} testID="statut-vu_ailleurs" /> : null}
      </View>
      {entree ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityLabel="Note sur 10">
            <Text style={[styleAttenue(theme), { alignSelf: 'center' }]}>Note</Text>
            {[2, 4, 5, 6, 7, 8, 9, 10].map(n => (
              <Puce key={n} titre={String(n)} actif={entree.rating === n} onPress={() => void agir(() => s.depot.modifier(db => void modifierEntree(db, fiche.kind, fiche.id, { rating: entree.rating === n ? null : n })))} testID={`note-${n}`} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton titre={entree.favorite ? '♥ Favori' : '♡ Favori'} onPress={() => void agir(() => s.depot.modifier(db => void modifierEntree(db, fiche.kind, fiche.id, { favorite: !entree.favorite })))} testID="favori" />
            <Bouton titre="Retirer de la bibliothèque" variante="danger" onPress={() => void agir(() => s.depot.modifier(db => void supprimerEntree(db, fiche.kind, fiche.id)))} testID="retirer" />
          </View>
        </View>
      ) : null}
      {erreur ? <Avis genre="critique" texte={erreur} /> : null}
    </View>
  );
}

/** « Vu ailleurs » : marque le titre comme vu hors de la plateforme (date, note, commentaire, épisodes). */
export function BlocVuAilleurs({ fiche, entree }: { fiche: FicheMin; entree: Entree | null }) {
  const { s, theme } = useTsuzuku();
  const { agir, erreur } = useAgir();
  const [ouvert, setOuvert] = useState(false);
  const deja = entree?.watchedElsewhere;
  const [date, setDate] = useState(deja?.date ?? jourDe());
  const [note, setNote] = useState(deja?.rating != null ? String(deja.rating) : '');
  const [commentaire, setCommentaire] = useState(deja?.comment ?? '');
  const [episodes, setEpisodes] = useState(deja?.episodesWatched != null ? String(deja.episodesWatched) : '');
  const enregistrer = async () => {
    const ok = await agir(() =>
      s.depot.modifier(db => {
        marquerVuAilleurs(db, {
          kind: fiche.kind,
          id: fiche.id,
          title: fiche.title,
          image: fiche.image,
          year: fiche.year,
          totalEpisodes: fiche.totalEpisodes ?? null,
          runtime: fiche.runtime ?? null,
          date,
          rating: note.trim() === '' ? null : Number(note.replace(',', '.')),
          comment: commentaire,
          episodesWatched: fiche.kind === 'anime' && episodes.trim() !== '' ? Number(episodes) : undefined,
        });
      }),
    );
    if (ok) setOuvert(false);
  };
  return (
    <View style={{ gap: 10 }} testID="bloc-vu-ailleurs">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Bouton titre={deja ? '✓ Vu ailleurs (modifier)' : 'Déjà vu ailleurs'} onPress={() => setOuvert(o => !o)} testID="vu-ailleurs-ouvrir" />
        <Text style={[styleAttenue(theme), { flexShrink: 1 }]}>Vu sur une autre plateforme ou au cinéma : compté comme vu, sans lecture ici.</Text>
      </View>
      {ouvert ? (
        <View style={{ gap: 10 }} testID="vu-ailleurs-formulaire" accessibilityLabel="Marquer comme vu ailleurs">
          <Champ libelle="Date (AAAA-MM-JJ)" valeur={date} onChanger={setDate} testID="vu-ailleurs-date" />
          <Champ libelle="Note sur 10 (facultative)" valeur={note} onChanger={setNote} testID="vu-ailleurs-note" />
          {fiche.kind === 'anime' ? <Champ libelle={`Épisodes vus${fiche.totalEpisodes ? ` (sur ${fiche.totalEpisodes})` : ''}, vide = tous`} valeur={episodes} onChanger={setEpisodes} testID="vu-ailleurs-episodes" /> : null}
          <Champ libelle="Commentaire" valeur={commentaire} onChanger={setCommentaire} multiligne testID="vu-ailleurs-commentaire" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton titre="Enregistrer" variante="plein" onPress={() => void enregistrer()} testID="vu-ailleurs-enregistrer" />
            <Bouton titre="Annuler" onPress={() => setOuvert(false)} />
          </View>
        </View>
      ) : null}
      {erreur ? <Avis genre="critique" texte={erreur} /> : null}
    </View>
  );
}

/** Plateformes légales annoncées par le catalogue : de simples liens, sans intégration. */
export function LiensLegaux({ liens }: { liens?: LienStreaming[] }) {
  const { theme } = useTsuzuku();
  if (!liens?.length) {
    return null;
  }
  return (
    <View style={{ gap: 8 }} testID="liens-legaux">
      <Text accessibilityRole="header" style={styleTitre(theme, 16)}>
        Où le regarder légalement
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {liens.slice(0, 10).map(l => (
          <Bouton key={`${l.site}-${l.url}`} titre={`${l.site} ↗`} libelle={`Ouvrir ${l.site} dans le navigateur`} onPress={() => void ouvrirExterne(l.url)} />
        ))}
      </View>
    </View>
  );
}

export function Meta({ lignes }: { lignes: (string | number | null | undefined | false)[] }) {
  const { theme } = useTsuzuku();
  const utiles = lignes.filter(Boolean).map(String);
  return utiles.length ? <Text style={styleAttenue(theme, 14)}>{utiles.join(' · ')}</Text> : null;
}

export function Synopsis({ texte }: { texte: string | null }) {
  const { theme } = useTsuzuku();
  const [tout, setTout] = useState(false);
  if (!texte) {
    return null;
  }
  return (
    <Text onPress={() => setTout(t => !t)} accessibilityRole="button" accessibilityLabel={tout ? 'Réduire le synopsis' : 'Lire tout le synopsis'} numberOfLines={tout ? undefined : 4} style={[styleTexte(theme, 14), { lineHeight: 21 }]}>
      {texte}
    </Text>
  );
}

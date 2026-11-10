/** Blocs communs aux fiches d'animés et de films : bibliothèque, « vu ailleurs », liens légaux. */

import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../hub/themes';
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
import { Avis, Bouton, Champ, LIBELLE_STATUT, PastilleStatut, Puce, styleAttenue, styleTexte, styleTitre } from './ui';
import { ChampDate, aujourdhui } from '../../ui/dates';

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
            <Bouton titre={entree.favorite ? '♥︎ Favori' : '♡ Favori'} onPress={() => void agir(() => s.depot.modifier(db => void modifierEntree(db, fiche.kind, fiche.id, { favorite: !entree.favorite })))} testID="favori" />
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
          <ChampDate theme={theme} libelle="Date" valeur={date} onChanger={setDate} max={aujourdhui()} testID="vu-ailleurs-date" />
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
          <Bouton key={`${l.site}-${l.url}`} titre={`${l.site} ↗︎`} libelle={`Ouvrir ${l.site} dans le navigateur`} onPress={() => void ouvrirExterne(l.url)} />
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

/**
 * Bandeau immersif d'une fiche (comme l'ancienne version) : visuel plein cadre
 * fondu dans le fond, affiche à gauche, étiquette, statut, note, titre,
 * métadonnées, genres en puces, synopsis, actions et progression.
 */
export function BandeauFiche({
  image,
  banniere,
  etiquette,
  statut,
  score,
  titre,
  sousTitre,
  meta,
  genres,
  synopsis,
  progression,
  children,
}: {
  image: string | null;
  banniere?: string | null;
  etiquette: string;
  statut?: Statut | null;
  score?: number | null;
  titre: string;
  sousTitre?: string | null;
  meta: (string | number | null | undefined | false)[];
  genres: string[];
  synopsis: string | null;
  progression?: { vus: number; total: number } | null;
  children?: React.ReactNode;
}) {
  const { theme, large } = useTsuzuku();
  const visuel = banniere || image;
  const rayon = Math.max(theme.rayonGrand, 12);
  return (
    <View testID="fiche-bandeau" style={{ borderRadius: rayon, overflow: 'hidden', borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
      {visuel ? <Image source={{ uri: visuel }} accessibilityIgnoresInvertColors style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5 }} resizeMode="cover" /> : null}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: teinteTransparente(theme.fond, 0.62) }} />
      <View style={{ flexDirection: large ? 'row' : 'column', gap: large ? 30 : 18, padding: large ? 32 : 18, paddingTop: large ? 56 : 24 }}>
        {image ? (
          <Image
            source={{ uri: image }}
            accessibilityIgnoresInvertColors
            accessibilityLabel={`Affiche de ${titre}`}
            style={{ width: large ? 210 : 130, height: large ? 315 : 195, borderRadius: Math.max(theme.rayonMoyen, 6), borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}
          />
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <View style={{ backgroundColor: theme.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Math.min(theme.rayonMoyen, 4) }}>
              <Text style={{ color: theme.surAccent, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>{etiquette}</Text>
            </View>
            {statut ? <PastilleStatut statut={statut} /> : null}
            {score ? <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '800' }}>★ {score.toFixed(2)} / 10</Text> : null}
          </View>
          <Text accessibilityRole="header" testID="fiche-titre" style={{ color: theme.texte, fontSize: large ? 40 : 28, lineHeight: large ? 46 : 34, fontWeight: theme.poidsTitre === '400' ? '600' : '800', letterSpacing: -0.4, ...police(theme.policeTitre) }}>
            {titre}
          </Text>
          {sousTitre ? <Text style={styleAttenue(theme, 14)}>{sousTitre}</Text> : null}
          <Meta lignes={meta} />
          {genres.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {genres.slice(0, 6).map(g => (
                <View key={g} style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: teinteTransparente(theme.texte, 0.1) }}>
                  <Text style={{ color: theme.texte, fontSize: 12, fontWeight: '700', ...police(theme.policeTexte) }}>{g}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Synopsis texte={synopsis} />
          {children}
          {progression && progression.total ? (
            <View style={{ gap: 6, maxWidth: 380 }} testID="fiche-progression">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styleAttenue(theme, 12)}>Progression</Text>
                <Text style={styleAttenue(theme, 12)}>
                  {progression.vus} / {progression.total}
                </Text>
              </View>
              <View style={{ height: 5, borderRadius: 999, overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.12) }}>
                <View style={{ width: `${Math.min(100, Math.round((progression.vus / progression.total) * 100))}%`, height: 5, backgroundColor: theme.accent }} />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

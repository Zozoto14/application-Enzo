/**
 * Fiche d'un animé ou d'un film sur téléphone.
 *
 *  - visuel immersif en tête (affiche fondue dans le fond), titre, statut, genres, progression ;
 *  - synopsis replié sur 4 lignes (« Lire la suite ») ;
 *  - actions principales collées en bas, sous le pouce : lire (ou reprendre), « Ma bibliothèque »
 *    (statut, note, favori), « Coller un lien » de source ;
 *  - « Déjà vu ailleurs », bibliothèque et lien de source s'ouvrent en feuilles basses : plus de
 *    formulaire qui s'ouvre au milieu de la page ;
 *  - liste d'épisodes en cellules de 60 px (animés).
 */

import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../../hub/themes';
import { BoutonPrincipal } from '../../../ui/mobile/BoutonPrincipal';
import { EcranMobile } from '../../../ui/mobile/EcranMobile';
import { EnTeteMobile } from '../../../ui/mobile/EnTeteMobile';
import { FeuilleBasse } from '../../../ui/mobile/FeuilleBasse';
import { CONTROLE, ESPACE, TEXTE, rayonCarte, rayonControle } from '../../../ui/mobile/jetons';
import { ChampMobile } from '../../../ui/mobile/ChampMobile';
import { Cellule, GroupeCellules } from '../../../ui/mobile/ListeCellules';
import { STATUTS, type Entree, type Statut } from '../../moteur/bibliotheque';
import type { LienStreaming } from '../../moteur/catalogue';
import { MARQUEUR } from '../../moteur/liensManuels';
import { useTsuzuku, type Chargement } from '../contexte';
import { ouvrirExterne } from '../externe';
import { useBibliotheque, useVuAilleurs, type FicheMin } from '../FicheCommune';
import { useLienAnime } from '../LienAnime';
import { useLienFilm } from '../LienFilm';
import { Avis, Etat, LIBELLE_STATUT, styleTitre } from '../ui';

const SYNOPSIS_LONG = 170;

export interface FicheMobileProps {
  fiche?: FicheMin;
  chargement: Pick<Chargement<unknown>, 'enCours' | 'erreur' | 'recharger'>;
  entree: Entree | null;
  etiquette: string;
  image?: string | null;
  banniere?: string | null;
  titre?: string;
  sousTitre?: string | null;
  meta?: (string | number | null | undefined | false)[];
  genres?: string[];
  synopsis?: string | null;
  score?: number | null;
  progression?: { vus: number; total: number } | null;
  /** Libellé et action de l'action principale (lire / reprendre). */
  libelleLire?: string;
  onLire?(): void;
  trailer?: string | null;
  liens?: LienStreaming[];
  /** Lien de source : animé (numéro courant, épisodes connus) ou film. */
  lien?: { kind: 'anime'; numeroCourant: number; catalogue: { number: number; title?: string | null }[] } | { kind: 'movie' };
  /** Liste d'épisodes (animés). */
  children?: React.ReactNode;
}

type Feuille = 'biblio' | 'vu' | 'lien' | null;

export function FicheMobile(p: FicheMobileProps) {
  const { theme, retour } = useTsuzuku();
  const [feuille, setFeuille] = useState<Feuille>(null);
  const fermer = () => setFeuille(null);
  const { fiche, entree } = p;
  const kind = fiche?.kind ?? 'anime';
  const statutCourt = entree ? LIBELLE_STATUT[entree.status] : undefined;
  const pied = fiche && p.onLire ? (
    <>
      <BoutonPrincipal theme={theme} titre={p.libelleLire ?? '▶ Lire'} onPress={p.onLire} testID="fiche-lire" />
      <View style={st.ligneActions}>
        <View style={{ flex: 1 }}>
          <BoutonPrincipal theme={theme} variante="discret" titre={entree ? `✓ ${statutCourt}` : '＋ Bibliothèque'} libelle={entree ? `Ma bibliothèque : ${statutCourt}` : 'Ajouter à ma bibliothèque'} onPress={() => setFeuille('biblio')} testID="fiche-biblio" />
        </View>
        {p.lien ? (
          <View style={{ flex: 1 }}>
            <BoutonPrincipal theme={theme} variante="discret" titre="⛓ Coller un lien" libelle="Coller un lien de source" onPress={() => setFeuille('lien')} testID={kind === 'movie' ? 'lien-film-ouvrir' : 'lien-anime-ouvrir'} />
          </View>
        ) : null}
      </View>
    </>
  ) : undefined;

  return (
    <EcranMobile
      theme={theme}
      onRetour={retour}
      entete={<EnTeteMobile theme={theme} titre={p.etiquette} onRetour={retour} libelleRetour="Retour" testIDRetour="fiche-retour" />}
      pied={pied}>
      <Etat enCours={p.chargement.enCours} erreur={p.chargement.erreur} onRecharger={p.chargement.recharger} squelette="heros">
        {fiche && p.titre ? (
          <View style={{ gap: ESPACE.l }}>
            <Hero {...p} titre={p.titre} />
            <Corps {...p} fiche={fiche} onVu={() => setFeuille('vu')} />
            {p.children}
            <LiensLegauxMobile liens={p.liens} />
          </View>
        ) : null}
      </Etat>
      {fiche && feuille === 'biblio' ? <FeuilleBiblio fiche={fiche} entree={entree} onFermer={fermer} /> : null}
      {fiche && feuille === 'vu' ? <FeuilleVu fiche={fiche} entree={entree} onFermer={fermer} /> : null}
      {fiche && feuille === 'lien' && p.lien?.kind === 'anime' ? <FeuilleLienAnime id={fiche.id} numeroCourant={p.lien.numeroCourant} catalogue={p.lien.catalogue} onFermer={fermer} /> : null}
      {fiche && feuille === 'lien' && p.lien?.kind === 'movie' ? <FeuilleLienFilm id={fiche.id} onFermer={fermer} /> : null}
    </EcranMobile>
  );
}

/** Visuel immersif : affiche plein cadre, fondu vers le fond, étiquette, note et titre dessus. */
function Hero({ image, banniere, etiquette, titre, sousTitre, score, entree }: FicheMobileProps & { titre: string }) {
  const { theme } = useTsuzuku();
  const visuel = image || banniere;
  return (
    <View testID="fiche-bandeau" style={[st.hero, { borderRadius: rayonCarte(theme), borderColor: theme.ligne, backgroundColor: theme.surface }]}>
      {visuel ? <Image source={{ uri: visuel }} accessibilityIgnoresInvertColors accessibilityLabel={`Affiche de ${titre}`} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: teinteTransparente(theme.fond, 0.15) }]} />
      {['66%', '46%', '28%'].map(h => (
        <View key={h} pointerEvents="none" style={[st.palier, { height: h as `${number}%`, backgroundColor: teinteTransparente(theme.fond, 0.5) }]} />
      ))}
      <View style={st.heroTexte}>
        <View style={st.ligne}>
          <View style={{ backgroundColor: theme.accent, paddingHorizontal: 10, paddingVertical: 3, borderRadius: Math.min(theme.rayonMoyen, 6) }}>
            <Text style={{ color: theme.surAccent, fontSize: TEXTE.legende, fontWeight: '800', ...police(theme.policeTexte) }}>{etiquette}</Text>
          </View>
          {score ? <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '800' }}>★ {score.toFixed(2)} / 10</Text> : null}
        </View>
        <Text accessibilityRole="header" testID="fiche-titre" style={{ color: theme.texte, fontSize: 30, lineHeight: 36, fontWeight: theme.poidsTitre === '400' ? '600' : '800', letterSpacing: -0.4, ...police(theme.policeTitre) }}>
          {titre}
        </Text>
        {sousTitre ? <Text style={{ color: theme.texte, opacity: 0.85, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>{sousTitre}</Text> : null}
      </View>
    </View>
  );
}

function Corps({ fiche, entree, meta = [], genres = [], synopsis, progression, trailer, onVu }: FicheMobileProps & { fiche: FicheMin; onVu(): void }) {
  const { theme } = useTsuzuku();
  const [tout, setTout] = useState(false);
  const utiles = meta.filter(Boolean).map(String);
  const long = (synopsis?.length ?? 0) > SYNOPSIS_LONG;
  return (
    <View style={{ gap: ESPACE.m }}>
      {entree ? (
        <Text style={{ color: theme.accent, fontSize: TEXTE.corps, fontWeight: '700', ...police(theme.policeTexte) }} testID="fiche-statut">
          {LIBELLE_STATUT[entree.status]}
          {fiche.kind === 'anime' && entree.currentEpisode ? ` · épisode ${entree.currentEpisode}` : ''}
        </Text>
      ) : null}
      {utiles.length ? <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 22, ...police(theme.policeTexte) }}>{utiles.join(' · ')}</Text> : null}
      {genres.length ? (
        <View style={st.genres}>
          {genres.slice(0, 6).map(g => (
            <View key={g} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: teinteTransparente(theme.texte, 0.1) }}>
              <Text style={{ color: theme.texte, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>{g}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {progression && progression.total ? (
        <View style={{ gap: 6 }} testID="fiche-progression">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>Progression</Text>
            <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>
              {progression.vus} / {progression.total}
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: teinteTransparente(theme.texte, 0.12) }}>
            <View style={{ width: `${Math.min(100, Math.round((progression.vus / progression.total) * 100))}%`, height: 6, backgroundColor: theme.accent }} />
          </View>
        </View>
      ) : null}
      {synopsis ? (
        <View style={{ gap: 2 }}>
          <Text testID="fiche-synopsis" numberOfLines={tout ? undefined : 4} style={{ color: theme.texte, fontSize: 16, lineHeight: 24, ...police(theme.policeTexte) }}>
            {synopsis}
          </Text>
          {long ? (
            <Pressable testID="fiche-synopsis-plus" accessibilityRole="button" accessibilityState={{ expanded: tout }} accessibilityLabel={tout ? 'Réduire le synopsis' : 'Lire tout le synopsis'} onPress={() => setTout(t => !t)} style={{ minHeight: CONTROLE.cible, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Text style={{ color: theme.accent, fontSize: TEXTE.corps, fontWeight: '700', ...police(theme.policeTexte) }}>{tout ? 'Réduire ▴' : 'Lire la suite ▾'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <GroupeCellules theme={theme} titre="Suivi">
        <Cellule theme={theme} glyphe="◉" titre={entree?.watchedElsewhere ? 'Vu ailleurs (modifier)' : 'Déjà vu ailleurs'} sousTitre="Autre plateforme ou cinéma : compté comme vu" chevron onPress={onVu} testID="vu-ailleurs-ouvrir" />
        {trailer ? <Cellule theme={theme} glyphe="▶" titre="Bande-annonce" valeur="↗" onPress={() => void ouvrirExterne(trailer)} testID="fiche-bande-annonce" /> : null}
      </GroupeCellules>
    </View>
  );
}

function LiensLegauxMobile({ liens }: { liens?: LienStreaming[] }) {
  const { theme } = useTsuzuku();
  if (!liens?.length) return null;
  return (
    <View testID="liens-legaux">
      <GroupeCellules theme={theme} titre="Où le regarder légalement">
        {liens.slice(0, 10).map(l => (
          <Cellule key={`${l.site}-${l.url}`} theme={theme} titre={l.site} valeur="↗" onPress={() => void ouvrirExterne(l.url)} />
        ))}
      </GroupeCellules>
    </View>
  );
}

// ------------------------------------------------------------------ Épisodes

export interface EpisodeAffiche {
  number: number;
  title: string | null;
  aired: string | null;
  filler: boolean;
}

/** Liste d'épisodes en cellules de 60 px : numéro, titre, date, vu / à lire. */
export function EpisodesMobile({ id, episodes, entree, chargement, vide, onLire }: { id: string; episodes: EpisodeAffiche[]; entree: Entree | null; chargement: Pick<Chargement<unknown>, 'enCours' | 'erreur' | 'recharger'> & { aDonnees: boolean }; vide?: string; onLire(numero: number): void }) {
  const { theme } = useTsuzuku();
  const PAR_PAGE = 30;
  const [visibles, setVisibles] = useState(PAR_PAGE);
  void id;
  return (
    <View style={{ gap: ESPACE.s }} testID="fiche-episodes">
      <Text accessibilityRole="header" style={styleTitre(theme, TEXTE.section)}>
        Épisodes
      </Text>
      <Etat enCours={chargement.enCours && !chargement.aDonnees} erreur={chargement.erreur} onRecharger={chargement.recharger} vide={vide}>
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.ligne, borderRadius: rayonCarte(theme), overflow: 'hidden', backgroundColor: theme.surface }}>
          {episodes.slice(0, visibles).map((ep, i) => {
            const vu = (entree?.currentEpisode ?? 0) >= ep.number;
            return (
              <Pressable
                key={ep.number}
                testID={`episode-${ep.number}`}
                accessibilityRole="button"
                accessibilityLabel={`Lire l’épisode ${ep.number}${ep.title ? `, ${ep.title}` : ''}${vu ? ', vu' : ''}`}
                onPress={() => onLire(ep.number)}
                style={({ pressed }) => [st.episode, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.ligne, backgroundColor: pressed ? teinteTransparente(theme.texte, 0.06) : 'transparent' }]}>
                <View style={{ width: 40, height: 40, borderRadius: Math.min(theme.rayonMoyen, 10), alignItems: 'center', justifyContent: 'center', backgroundColor: vu ? theme.accent : teinteTransparente(theme.texte, 0.08) }}>
                  <Text style={{ color: vu ? theme.surAccent : theme.texte, fontWeight: '800', fontSize: TEXTE.legende }}>{ep.number}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.texte, fontSize: TEXTE.corps, ...police(theme.policeTexte) }}>
                    {ep.title ?? `Épisode ${ep.number}`}
                  </Text>
                  {ep.aired || ep.filler ? (
                    <Text numberOfLines={1} style={{ color: theme.attenue, fontSize: TEXTE.legende, ...police(theme.policeTexte) }}>
                      {[ep.aired ? String(ep.aired).slice(0, 10) : null, ep.filler ? 'filler' : null].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: vu ? theme.accent : theme.attenue, fontWeight: '800', fontSize: 20 }}>{vu ? '✓' : '▶'}</Text>
              </Pressable>
            );
          })}
        </View>
        {episodes.length > visibles ? <BoutonPrincipal theme={theme} variante="discret" titre={`Afficher la suite (${episodes.length - visibles})`} onPress={() => setVisibles(v => v + PAR_PAGE)} testID="episodes-plus" /> : null}
      </Etat>
    </View>
  );
}

// ------------------------------------------------------------------ Feuilles

const NOTES = [2, 4, 5, 6, 7, 8, 9, 10];

function FeuilleBiblio({ fiche, entree, onFermer }: { fiche: FicheMin; entree: Entree | null; onFermer(): void }) {
  const { theme } = useTsuzuku();
  const { statut, noter, basculerFavori, retirer, erreur } = useBibliotheque(fiche, entree);
  const liste: Statut[] = STATUTS.filter(x => x !== 'vu_ailleurs');
  return (
    <FeuilleBasse theme={theme} visible titre="Ma bibliothèque" description={fiche.title} onFermer={onFermer} testID="fiche-feuille-biblio" pied={<BoutonPrincipal theme={theme} titre="Terminé" onPress={onFermer} testID="fiche-feuille-biblio-ok" />}>
      <GroupeCellules theme={theme} titre="Statut">
        {liste.map(s => (
          <Cellule key={s} theme={theme} titre={LIBELLE_STATUT[s]} coche={entree?.status === s} onPress={() => void statut(s)} testID={`statut-${s}`} />
        ))}
        {entree?.status === 'vu_ailleurs' ? <Cellule theme={theme} titre="Vu ailleurs" coche testID="statut-vu_ailleurs" /> : null}
      </GroupeCellules>
      {entree ? (
        <>
          <View style={{ gap: ESPACE.xs }} accessibilityLabel="Note sur 10">
            <Text accessibilityRole="header" style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '600', ...police(theme.policeTexte) }}>
              Ma note sur 10
            </Text>
            <View style={st.notes}>
              {NOTES.map(n => {
                const actif = entree.rating === n;
                return (
                  <Pressable key={n} testID={`note-${n}`} accessibilityRole="radio" accessibilityState={{ checked: actif }} accessibilityLabel={`Note ${n} sur 10`} onPress={() => void noter(n)} style={[st.note, { borderRadius: rayonControle(theme) === 999 ? 22 : rayonControle(theme), backgroundColor: actif ? theme.accent : 'transparent', borderColor: actif ? theme.accent : theme.ligne }]}>
                    <Text style={{ color: actif ? theme.surAccent : theme.texte, fontSize: TEXTE.corps, fontWeight: '700' }}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <GroupeCellules theme={theme}>
            <Cellule theme={theme} titre="Favori" interrupteur={{ valeur: Boolean(entree.favorite), onChanger: () => void basculerFavori() }} testID="favori" />
            <Cellule
              theme={theme}
              titre="Retirer de la bibliothèque"
              danger
              onPress={() => {
                void retirer().then(ok => ok && onFermer());
              }}
              testID="retirer"
            />
          </GroupeCellules>
        </>
      ) : null}
      {erreur ? <Avis genre="critique" texte={erreur} /> : null}
    </FeuilleBasse>
  );
}

function FeuilleVu({ fiche, entree, onFermer }: { fiche: FicheMin; entree: Entree | null; onFermer(): void }) {
  const { theme } = useTsuzuku();
  const v = useVuAilleurs(fiche, entree, onFermer);
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre="Déjà vu ailleurs"
      description="Vu sur une autre plateforme ou au cinéma : compté comme vu, sans lecture ici."
      onFermer={onFermer}
      testID="vu-ailleurs-formulaire"
      pied={<BoutonPrincipal theme={theme} titre="Enregistrer" onPress={() => void v.enregistrer()} testID="vu-ailleurs-enregistrer" />}>
      <ChampMobile theme={theme} etiquette="Date (AAAA-MM-JJ)" value={v.date} onChangeText={v.setDate} testID="vu-ailleurs-date" />
      <ChampMobile theme={theme} etiquette="Note sur 10 (facultative)" nature="decimal" value={v.note} onChangeText={v.setNote} testID="vu-ailleurs-note" />
      {fiche.kind === 'anime' ? <ChampMobile theme={theme} etiquette="Épisodes vus" indication={`Vide = tous${fiche.totalEpisodes ? ` (sur ${fiche.totalEpisodes})` : ''}`} nature="nombre" value={v.episodes} onChangeText={v.setEpisodes} testID="vu-ailleurs-episodes" /> : null}
      <ChampMobile theme={theme} etiquette="Commentaire" nature="multiligne" value={v.commentaire} onChangeText={v.setCommentaire} testID="vu-ailleurs-commentaire" />
      {v.erreur ? <Avis genre="critique" texte={v.erreur} /> : null}
    </FeuilleBasse>
  );
}

function FeuilleLienAnime({ id, numeroCourant, catalogue, onFermer }: { id: string; numeroCourant: number; catalogue: { number: number; title?: string | null }[]; onFermer(): void }) {
  const { theme } = useTsuzuku();
  const l = useLienAnime(id, numeroCourant, catalogue);
  const aUneAdresse = Boolean(l.adresse.trim());
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre="Lien de source"
      description="Collez l’adresse d’UN épisode : Tsuzuku en tire le lien des suivants."
      onFermer={onFermer}
      testID="lien-feuille"
      pied={l.motif.includes(MARQUEUR) ? <BoutonPrincipal theme={theme} titre="Enregistrer pour cet épisode et les suivants" onPress={() => void l.enregistrerMotif()} testID="lien-anime-enregistrer" /> : undefined}>
      {l.resume ? (
        <Text style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }} testID="lien-anime-resume">
          {l.resume}
        </Text>
      ) : null}
      <ChampMobile theme={theme} etiquette="Adresse (page ou fichier vidéo)" nature="url" placeholder="https://…/episode-5" value={l.adresse} onChangeText={l.setAdresse} testID="lien-anime-adresse" />
      <ChampMobile theme={theme} etiquette="Numéro de cet épisode" nature="nombre" value={l.episode} onChangeText={l.setEpisode} testID="lien-anime-episode" />
      <BoutonPrincipal theme={theme} variante="discret" titre="Analyser l’adresse" desactive={!aUneAdresse} onPress={l.analyser} testID="lien-anime-analyser" />
      <BoutonPrincipal theme={theme} variante="discret" titre="Cet épisode seulement" desactive={!aUneAdresse} onPress={() => void l.seulementCeluiLa()} testID="lien-anime-seul" />
      {l.lectureSources ? <BoutonPrincipal theme={theme} variante="discret" titre="Lire la page de série" desactive={!aUneAdresse} onPress={() => void l.lirePageSerie()} testID="lien-anime-serie" /> : null}
      {l.motif ? (
        <>
          <ChampMobile theme={theme} etiquette={`Motif (${MARQUEUR} = numéro d’épisode)`} value={l.motif} onChangeText={l.setMotif} testID="lien-anime-motif" />
          {l.apercu.map(a => (
            <Text key={a.number} style={{ color: theme.attenue, fontSize: TEXTE.legende, lineHeight: 21, ...police(theme.policeTexte) }} testID={`apercu-${a.number}`}>
              Ép. {a.number} → {a.url ?? '—'}
            </Text>
          ))}
        </>
      ) : null}
      {l.assoc ? <BoutonPrincipal theme={theme} variante="danger" titre="Retirer le lien manuel" onPress={() => void l.retirer()} testID="lien-anime-retirer" /> : null}
      {l.info ? <Avis texte={l.info} /> : null}
      {l.problemes ? <Avis genre="alerte" texte={l.problemes} /> : null}
      {l.erreur ? <Avis genre="critique" texte={l.erreur} /> : null}
    </FeuilleBasse>
  );
}

function FeuilleLienFilm({ id, onFermer }: { id: string; onFermer(): void }) {
  const { theme } = useTsuzuku();
  const l = useLienFilm(id);
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre="Lien direct du film"
      description="Une adresse (page, fichier vidéo, flux) retrouvée à chaque lecture."
      onFermer={onFermer}
      testID="lien-feuille"
      pied={<BoutonPrincipal theme={theme} titre="Enregistrer" desactive={!l.adresse.trim()} onPress={() => void l.enregistrer().then(ok => ok && onFermer())} testID="lien-film-enregistrer" />}>
      {l.lien ? (
        <Text numberOfLines={2} style={{ color: theme.accent, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }} testID="lien-film-resume">
          {l.lien.label ? `${l.lien.label} · ` : ''}
          {l.lien.kind === 'iframe' ? 'page' : l.lien.kind === 'hls' ? 'flux HLS' : 'fichier vidéo'}
        </Text>
      ) : null}
      <ChampMobile theme={theme} etiquette="Adresse du film" nature="url" placeholder="https://…" value={l.adresse} onChangeText={l.setAdresse} testID="lien-film-adresse" />
      <ChampMobile theme={theme} etiquette="Nom (facultatif)" value={l.nom} onChangeText={l.setNom} testID="lien-film-nom" />
      {l.lien ? <BoutonPrincipal theme={theme} variante="danger" titre="Retirer le lien" onPress={() => void l.retirer()} testID="lien-film-retirer" /> : null}
      {l.erreur ? <Avis genre="critique" texte={l.erreur} /> : null}
    </FeuilleBasse>
  );
}

const st = StyleSheet.create({
  hero: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, minHeight: 400, justifyContent: 'flex-end' },
  palier: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  heroTexte: { padding: 16, gap: 8 },
  ligne: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  ligneActions: { flexDirection: 'row', gap: 8 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  episode: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

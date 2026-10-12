/** Lecteur : trouve les lecteurs (lien manuel puis sources), joue, note la progression, enchaîne. */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police } from '../../hub/themes';
import { ajouterOuMettreAJour, enregistrerProgression, trouver, type Genre } from '../moteur/bibliotheque';
import type { Lecteur } from '../moteur/resolution';
import { useCharger, useTsuzuku } from './contexte';
import { utiliserLectureEnCours } from '../../securite/presence';
import { ouvrirExterne } from './externe';
import { LecteurMedia } from './LecteurMedia';
import { LienGererSources } from './EtatSources';
import { enregistrerTitrePerso, lireAnime, lireFilm, lireTitresPerso, titresPourSources, type Lecture } from './resoudre';
import { PanneauEchec } from './DiagnosticSources';
import { choisirLangue, langueVoulue, type OrigineLangue } from './langues';
import { SelecteurLangue } from './SelecteurLangue';
import { LIBELLE_LANGUE_VERSION, type LangueVersion } from '../moteur/langues';
import { Avis, Bouton, Etat, Puce, Titre, styleAttenue } from './ui';

interface Meta {
  titre: string;
  titres: string[];
  image: string | null;
  total: number | null;
  annee: number | null;
  duree: number | null;
}

async function chargerMeta(s: ReturnType<typeof useTsuzuku>['s'], kind: Genre, id: string): Promise<Meta> {
  try {
    if (kind === 'anime') {
      const f = (await s.catalogue.animes.parId(id)).data;
      return { titre: f.title, titres: titresPourSources(f), image: f.image, total: f.totalEpisodes, annee: f.year, duree: null };
    }
    const f = (await s.catalogue.films.parId(id)).film;
    return { titre: f.title, titres: titresPourSources(f), image: f.image, total: null, annee: f.year, duree: f.runtime };
  } catch (erreur) {
    // Catalogue injoignable : la bibliothèque connaît déjà le titre, et un lien manuel peut suffire.
    const e = trouver(await s.depot.lire(), kind, id);
    if (!e) throw erreur;
    return { titre: e.title, titres: [e.title], image: e.image, total: e.totalEpisodes, annee: e.year, duree: e.runtime };
  }
}

export function LecteurEcran({ kind, id, numero }: { kind: Genre; id: string; numero?: number }) {
  const { s, theme, remplacer, retour, changee } = useTsuzuku();
  const n = kind === 'anime' ? Math.max(1, numero ?? 1) : 1;
  const [choix, setChoix] = useState(0);
  // « Réessayer » et « Chercher avec un autre titre » relancent la recherche (sans le cache).
  const [essai, setEssai] = useState(0);
  // Langue choisie dans CE lecteur (VF / VOSTFR) ; sinon celle de la série, de la séance ou des réglages.
  const [langueChoisie, setLangueChoisie] = useState<LangueVersion | null>(null);
  const [origine, setOrigine] = useState<OrigineLangue | null>(null);
  // Position de la vidéo directe au moment de changer de langue (reprise au même endroit).
  const position = useRef(0);
  const [debut, setDebut] = useState<number | undefined>();
  const [bascule, setBascule] = useState(false);
  const charge = useCharger<{ meta: Meta; lecture: Lecture; suivantAuto: boolean; perso?: string; origine: OrigineLangue; auChoix: boolean }>(async () => {
    const meta = await chargerMeta(s, kind, id);
    const voulue = await langueVoulue(s, `${kind}:${id}`);
    const langue = langueChoisie ?? voulue.langue;
    const lecture = kind === 'anime' ? await lireAnime(s, { id, titres: meta.titres, numero: n, forcer: essai > 0, langue }) : await lireFilm(s, { id, titres: meta.titres, annee: meta.annee });
    return { meta, lecture, suivantAuto: (await s.reglages()).suivantAuto, perso: (await lireTitresPerso(s))[`${kind}:${id}`], origine: langueChoisie ? origine ?? voulue.origine : voulue.origine, auChoix: voulue.auChoix };
  }, [s, kind, id, n, essai, langueChoisie]);
  useEffect(() => setChoix(0), [id, n, langueChoisie]);
  // Autre épisode : la position ne se reporte pas.
  useEffect(() => {
    setDebut(undefined);
    setBascule(false);
    position.current = 0;
  }, [id, n]);
  const changerLangue = (l: LangueVersion) => {
    setDebut(position.current > 5 ? position.current : undefined);
    setBascule(true);
    void choisirLangue(s, `${kind}:${id}`, l).then(o => {
      setOrigine(o);
      setLangueChoisie(l);
    });
  };
  const { meta, lecture, suivantAuto } = charge.donnees ?? {};
  const lecteurs: Lecteur[] = lecture?.lecteurs ?? [];
  const courant = lecteurs[Math.min(choix, Math.max(0, lecteurs.length - 1))];
  // Lecteur ouvert : le verrouillage automatique demande « Êtes-vous toujours là ? » au lieu de verrouiller.
  utiliserLectureEnCours(Boolean(courant));

  // Progression : un épisode ouvert est noté « en cours » (une fois par épisode ouvert).
  const note = useRef<string>('');
  useEffect(() => {
    if (kind !== 'anime' || !meta || !courant || note.current === `${id}:${n}`) return;
    note.current = `${id}:${n}`;
    void s.depot
      .modifier(db => {
        if (!trouver(db, 'anime', id)) {
          ajouterOuMettreAJour(db, 'anime', { id, title: meta.titre, image: meta.image, year: meta.annee, totalEpisodes: meta.total, status: 'en_cours' });
        }
        enregistrerProgression(db, 'anime', id, n);
      })
      .then(changee, () => undefined);
  }, [s, kind, id, n, meta, courant, changee]);

  const marquerFilmVu = () =>
    meta &&
    s.depot
      .modifier(db => {
        if (!trouver(db, 'movie', id)) {
          ajouterOuMettreAJour(db, 'movie', { id, title: meta.titre, image: meta.image, year: meta.annee, runtime: meta.duree, status: 'a_voir' });
        }
        enregistrerProgression(db, 'movie', id, 1);
      })
      .then(changee, () => undefined);

  const aSuivant = kind === 'anime' && (!meta?.total || n < meta.total);
  const suivant = () => remplacer({ t: 'lecteur', kind, id, numero: n + 1 });
  const fin = () => {
    if (kind === 'movie') void marquerFilmVu();
    else if (suivantAuto && aSuivant) suivant();
  };

  return (
    <View style={{ gap: 14 }} testID="tsuzuku-lecteur">
      {/* En-tête du lecteur (comme l'ancienne version) : retour à la fiche, « Épisode n sur N », titre, Précédent / Suivant. */}
      <Pressable testID="lecteur-retour" accessibilityRole="link" accessibilityLabel="Retour à la fiche" onPress={retour} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
        <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '800', ...police(theme.policeTexte) }}>← {meta?.titre ?? 'Fiche'}</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text style={{ color: theme.attenue, fontSize: 11, fontWeight: '800', letterSpacing: 1.6, ...police(theme.policeTexte) }}>
            {kind === 'anime' ? `ÉPISODE ${n}${meta?.total ? ` SUR ${meta.total}` : ''}` : `FILM${meta?.annee ? ` · ${meta.annee}` : ''}${meta?.duree ? ` · ${meta.duree} MIN` : ''}`}
          </Text>
          <Titre taille={28} testID="lecteur-titre">{meta ? `${meta.titre}${kind === 'anime' ? ` · Épisode ${n}` : ''}` : 'Lecture'}</Titre>
        </View>
        {kind === 'anime' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton titre="‹ Précédent" desactive={n <= 1} onPress={() => remplacer({ t: 'lecteur', kind, id, numero: n - 1 })} testID="lecteur-precedent" />
            <Bouton titre="Suivant ›" variante="plein" desactive={!aSuivant} onPress={suivant} testID="lecteur-suivant" />
          </View>
        ) : null}
      </View>
      <Etat enCours={charge.enCours} erreur={charge.erreur} onRecharger={charge.recharger}>
        {lecture && meta ? (
          <View style={{ gap: 12 }}>
            {lecteurs.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Lecteurs disponibles">
                {lecteurs.map((l, i) => (
                  <Puce key={`${l.url}-${i}`} titre={l.label || `Lecteur ${i + 1}`} actif={i === choix} onPress={() => setChoix(i)} testID={`lecteur-choix-${i}`} />
                ))}
              </View>
            ) : null}
            {kind === 'anime' && lecture.langues ? (
              <SelecteurLangue
                testID="lecteur-langue"
                etat={lecture.langues}
                valeur={lecture.langue ?? null}
                enCours={charge.enCours}
                onChoisir={changerLangue}
                note={
                  lecture.langues.inconnue
                    ? undefined
                    : charge.donnees?.auChoix
                      ? 'Au choix à chaque fois (Paramètres › Tsuzuku) : ce choix vaut pour cette séance.'
                      : charge.donnees?.origine === 'serie'
                        ? `${lecture.langue ? LIBELLE_LANGUE_VERSION[lecture.langue] : 'Langue'} retenue pour cette série (sur cet appareil). Vu / reprendre restent communs aux deux langues.`
                        : 'Langue par défaut : Paramètres › Tsuzuku. Vu / reprendre restent communs aux deux langues.'
                }
              />
            ) : null}
            {lecture.avisLangue ? <Avis genre="alerte" texte={lecture.avisLangue} testID="lecteur-langue-avis" /> : null}
            {courant ? <LecteurMedia key={`${courant.url}|${lecture.langue ?? ''}`} lecteur={courant} titre={meta.titre} onFin={fin} debut={debut} onPosition={t => (position.current = t)} /> : null}
            {bascule && courant && courant.kind === 'iframe' ? (
              <Text style={styleAttenue(theme, 15)} testID="lecteur-langue-position">
                Lecteur intégré d’un autre site : la position ne peut pas être reprise, l’épisode repart du début.
              </Text>
            ) : null}
            {lecture.message ? <Avis genre={courant ? 'alerte' : 'info'} texte={lecture.message} testID="lecteur-message" /> : null}
            {!courant && lecture.diagnostic ? (
              <PanneauEchec
                testID="lecteur-diagnostic"
                diagnostic={lecture.diagnostic}
                oeuvre={meta.titre}
                titrePerso={charge.donnees?.perso}
                enCours={charge.enCours}
                onReessayer={() => setEssai(v => v + 1)}
                onAutreTitre={t => void enregistrerTitrePerso(s, `${kind}:${id}`, t).then(() => setEssai(v => v + 1))}
              />
            ) : null}
            {!courant ? (
              <View style={{ gap: 8 }}>
                <Text style={styleAttenue(theme, 14)}>Vous pouvez coller un lien direct depuis la fiche.</Text>
                <Bouton titre="Aller à la fiche" onPress={retour} testID="lecteur-vers-fiche" style={{ alignSelf: 'flex-start' }} />
                <LienGererSources testID="lecteur-gerer-sources" />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {kind === 'movie' ? <Bouton titre="Marquer comme vu" onPress={() => void marquerFilmVu()} testID="lecteur-marquer-vu" /> : null}
                <Bouton titre="Ouvrir dans le navigateur ↗" onPress={() => void ouvrirExterne(courant.url)} testID="lecteur-externe" />
              </View>
            )}
          </View>
        ) : null}
      </Etat>
    </View>
  );
}

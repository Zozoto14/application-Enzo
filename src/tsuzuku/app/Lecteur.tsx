/** Lecteur : trouve les lecteurs (lien manuel puis sources), joue, note la progression, enchaîne. */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police } from '../../hub/themes';
import { creerControleur, messageBascule, MESSAGE_TOUS_ECHOUES, nomLecteur, type Controleur } from '../moteur/basculeLecteurs';
import { ajouterOuMettreAJour, enregistrerProgression, trouver, type Genre } from '../moteur/bibliotheque';
import type { Lecteur } from '../moteur/resolution';
import { useCharger, useTsuzuku } from './contexte';
import { utiliserLectureEnCours } from '../../securite/presence';
import { ouvrirExterne } from './externe';
import { LecteurMedia } from './LecteurMedia';
import { LienGererSources } from './EtatSources';
import { enregistrerTitrePerso, lireAnime, lireFilm, lireTitresPerso, titresPourSources, type Lecture } from './resoudre';
import { lecteursParFiabilite, noterLecteur } from './fiabiliteLecteurs';
import { prechargerSuite } from './prechargeSuite';
import { texteMesure } from './diagnosticTexte';
import { texteDiagnosticLecteurs } from '../moteur/lecteursEpisode';
import { PanneauEchec } from './DiagnosticSources';
import { choisirLangue, langueVoulue, type OrigineLangue } from './langues';
import { enregistrerPosition, INTERVALLE_ENREGISTREMENT_MS, positionReprise } from './positions';
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

const AUCUN_LECTEUR: Lecteur[] = [];

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
  // Bascule automatique : message discret, et « tous ont échoué » (bouton Réessayer).
  const [avisAuto, setAvisAuto] = useState<string | null>(null);
  const [tousEchoues, setTousEchoues] = useState(false);
  const charge = useCharger<{ meta: Meta; lecture: Lecture; lecteurs: Lecteur[]; suivantAuto: boolean; perso?: string; origine: OrigineLangue; auChoix: boolean }>(async () => {
    const meta = await chargerMeta(s, kind, id);
    const voulue = await langueVoulue(s, `${kind}:${id}`);
    const langue = langueChoisie ?? voulue.langue;
    const lecture = kind === 'anime' ? await lireAnime(s, { id, titres: meta.titres, numero: n, forcer: essai > 0, langue }) : await lireFilm(s, { id, titres: meta.titres, annee: meta.annee });
    // Les lecteurs qui ont le mieux marché sur cette source passent en premier.
    const lecteurs = await lecteursParFiabilite(s, lecture.sourceId, lecture.lecteurs);
    return { meta, lecture, lecteurs, suivantAuto: (await s.reglages()).suivantAuto, perso: (await lireTitresPerso(s))[`${kind}:${id}`], origine: langueChoisie ? origine ?? voulue.origine : voulue.origine, auChoix: voulue.auChoix };
  }, [s, kind, id, n, essai, langueChoisie]);
  // Autre épisode : la position ne se reporte pas ; celle enregistrée (cet appareil ou un autre du compte) est reprise.
  const duree = useRef<number | undefined>(undefined);
  const enregistreLe = useRef(0);
  useEffect(() => {
    setDebut(undefined);
    setBascule(false);
    position.current = 0;
    duree.current = undefined;
    enregistreLe.current = Date.now();
    let actif = true;
    void positionReprise(s, `${kind}:${id}`, n).then(p => {
      if (actif && p !== undefined && position.current === 0) setDebut(p);
    });
    return () => {
      actif = false;
      // En quittant l'épisode (ou le lecteur) : la position est retenue pour la reprise.
      if (position.current > 0) void enregistrerPosition(s, `${kind}:${id}`, n, position.current, duree.current);
    };
  }, [s, kind, id, n]);
  const surPosition = (t: number, d?: number) => {
    position.current = t;
    duree.current = d;
    if (Date.now() - enregistreLe.current >= INTERVALLE_ENREGISTREMENT_MS) {
      enregistreLe.current = Date.now();
      void enregistrerPosition(s, `${kind}:${id}`, n, t, d);
    }
  };
  const changerLangue = (l: LangueVersion) => {
    setDebut(position.current > 5 ? position.current : undefined);
    setBascule(true);
    void choisirLangue(s, `${kind}:${id}`, l).then(o => {
      setOrigine(o);
      setLangueChoisie(l);
    });
  };
  const { meta, lecture, suivantAuto } = charge.donnees ?? {};
  const lecteurs: Lecteur[] = charge.donnees?.lecteurs ?? AUCUN_LECTEUR;
  const indiceCourant = Math.min(choix, Math.max(0, lecteurs.length - 1));
  const courant = lecteurs[indiceCourant];
  // Autre épisode, autre langue, nouvelle liste de lecteurs : on repart du premier.
  const controle = useRef<{ pour: Lecteur[]; c: Controleur } | null>(null);
  if (!controle.current || controle.current.pour !== lecteurs) controle.current = { pour: lecteurs, c: creerControleur(lecteurs.length) };
  const reussis = useRef(new Set<string>());
  useEffect(() => {
    setChoix(0);
    setAvisAuto(null);
    setTousEchoues(false);
    reussis.current = new Set();
  }, [id, n, langueChoisie, lecteurs]);
  // Le lecteur affiché a échoué : le suivant non essayé le remplace, sinon on le dit.
  const echecLecteur = (i: number) => {
    const l = lecteurs[i];
    const c = controle.current?.c;
    if (!l || !c) return;
    const d = c.echec(i);
    if (d.type === 'ignore') return;
    void noterLecteur(s, lecture?.sourceId, l, false);
    if (d.type === 'suivant') {
      setChoix(d.vers);
      setAvisAuto(messageBascule(nomLecteur(l, i), nomLecteur(lecteurs[d.vers], d.vers)));
    } else {
      setAvisAuto(null);
      setTousEchoues(true);
    }
  };
  // Signe de vie : ce lecteur est retenu comme fiable pour cette source (une fois par lecteur et par lecture).
  const vivantLecteur = (i: number) => {
    const l = lecteurs[i];
    if (!l || reussis.current.has(l.url)) return;
    reussis.current.add(l.url);
    void noterLecteur(s, lecture?.sourceId, l, true);
  };
  const choisirLecteur = (i: number) => {
    controle.current?.c.choisir(i);
    setChoix(i);
    setAvisAuto(null);
    setTousEchoues(false);
  };
  const reessayerLecteurs = () => {
    controle.current?.c.reessayer();
    setChoix(0);
    setAvisAuto(null);
    setTousEchoues(false);
    // La liste gardée n'est peut-être plus bonne : la page de l'épisode est relue.
    setEssai(v => v + 1);
  };
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

  // Lecteur trouvé : on prépare, sans l'afficher ni lancer de vidéo, la même page dans l'autre langue
  // (bascule VF/VOSTFR immédiate, dès que la liste de l'autre langue est lue) puis l'épisode suivant
  // (une page chacun, lecteurs gardés 20 min). Une requête à la fois, après un temps de calme, rien en
  // économie de données, annulé si l'on change d'épisode ou d'animé (`prechargeSuite.ts`).
  const [languesMaj, setLanguesMaj] = useState<{ pour: Lecture; etat: Lecture['langues'] } | null>(null);
  useEffect(() => {
    if (kind !== 'anime' || !meta || !lecture || lecture.origine !== 'source') return undefined;
    let actif = true;
    let annuler = () => undefined as void;
    void (async () => {
      let etat = lecture.langues;
      if (lecture.languesAJour) {
        etat = await lecture.languesAJour.catch(() => lecture.langues);
        if (!actif) return;
        setLanguesMaj({ pour: lecture, etat });
      }
      if (!actif) return;
      const autreLangue = lecture.langue ? (['vf', 'vostfr'] as const).find(l => l !== lecture.langue && etat?.options[l].etat === 'disponible') : undefined;
      annuler = prechargerSuite(s, { id, titres: meta.titres, numero: n, langue: lecture.langue ?? null, autreLangue, suivant: aSuivant });
    })();
    return () => {
      actif = false;
      annuler();
    };
  }, [s, kind, id, n, meta, lecture, aSuivant]);
  const languesAffichees = languesMaj && languesMaj.pour === lecture ? languesMaj.etat : lecture?.langues;

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
                  <Puce key={`${l.url}-${i}`} titre={l.label || `Lecteur ${i + 1}`} actif={i === choix} onPress={() => choisirLecteur(i)} testID={`lecteur-choix-${i}`} />
                ))}
              </View>
            ) : null}
            {kind === 'anime' && languesAffichees ? (
              <SelecteurLangue
                testID="lecteur-langue"
                etat={languesAffichees}
                valeur={lecture.langue ?? null}
                enCours={charge.enCours}
                onChoisir={changerLangue}
                note={
                  languesAffichees.inconnue
                    ? undefined
                    : charge.donnees?.auChoix
                      ? 'Au choix à chaque fois (Paramètres › Tsuzuku) : ce choix vaut pour cette séance.'
                      : charge.donnees?.origine === 'serie'
                        ? `${lecture.langue ? LIBELLE_LANGUE_VERSION[lecture.langue] : 'Langue'} retenue pour cette série (sur tous vos appareils). Vu / reprendre restent communs aux deux langues.`
                        : 'Langue par défaut : Paramètres › Tsuzuku. Vu / reprendre restent communs aux deux langues.'
                }
              />
            ) : null}
            {lecture.avisLangue ? <Avis genre="alerte" texte={lecture.avisLangue} testID="lecteur-langue-avis" /> : null}
            {courant && !tousEchoues ? (
              <LecteurMedia
                key={`${courant.url}|${lecture.langue ?? ''}`}
                lecteur={courant}
                titre={meta.titre}
                onFin={fin}
                debut={debut}
                onPosition={surPosition}
                onVivant={() => vivantLecteur(indiceCourant)}
                onEchec={() => echecLecteur(indiceCourant)}
              />
            ) : null}
            {avisAuto && !tousEchoues ? (
              <Text style={styleAttenue(theme, 13)} accessibilityLiveRegion="polite" testID="lecteur-bascule-avis">
                {avisAuto}
              </Text>
            ) : null}
            {tousEchoues ? (
              <View style={{ gap: 8 }} testID="lecteur-tous-echoues" accessibilityRole="alert">
                <Avis genre="critique" texte={`${MESSAGE_TOUS_ECHOUES} Les ${lecteurs.length > 1 ? `${lecteurs.length} lecteurs ont échoué` : 'lecteur a échoué'} : réessayez, ou choisissez-en un à la main.`} />
                <Bouton titre="Réessayer" variante="plein" onPress={reessayerLecteurs} testID="lecteur-reessayer" style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : null}
            {bascule && courant && courant.kind === 'iframe' ? (
              <Text style={styleAttenue(theme, 15)} testID="lecteur-langue-position">
                Lecteur intégré d’un autre site : la position ne peut pas être reprise, l’épisode repart du début.
              </Text>
            ) : null}
            {lecture.message ? <Avis genre={courant ? 'alerte' : 'info'} texte={lecture.message} testID="lecteur-message" /> : null}
            {!courant && lecture.diagnostic?.urlPage ? (
              <View style={{ gap: 8 }} testID="lecteur-introuvable" accessibilityRole="alert">
                <Text style={{ color: theme.texte, fontSize: 17, fontWeight: '800', ...police(theme.policeTexte) }}>Lecteur introuvable sur cette page</Text>
                <Text style={styleAttenue(theme, 14)}>Aucun lecteur vidéo n’a pu être extrait de la page de l’épisode ; la page du site n’est jamais affichée à la place du lecteur.</Text>
                {lecture.diagnostic.lecteurs ? (
                  <Text style={styleAttenue(theme, 12)} testID="lecteur-introuvable-diagnostic" selectable>
                    {texteDiagnosticLecteurs(lecture.diagnostic.lecteurs)}
                  </Text>
                ) : null}
                <Bouton titre="Ouvrir l’épisode sur le site ↗" variante="plein" onPress={() => void ouvrirExterne(lecture.diagnostic!.urlPage!)} testID="lecteur-ouvrir-site" style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : null}
            {courant && lecture.mesure ? (
              <Text style={styleAttenue(theme, 12)} testID="lecteur-mesure">
                {texteMesure(lecture.mesure)}
              </Text>
            ) : null}
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

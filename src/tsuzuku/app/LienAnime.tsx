/**
 * Lien manuel d'un animé : on colle l'adresse d'UN épisode, Tsuzuku en tire un motif
 * `{n}` pour cet épisode ET les suivants (aperçu avant d'enregistrer). Sur PC/iPhone,
 * une adresse de page de série peut aussi être lue pour en tirer la liste des épisodes.
 */

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { trouver } from '../moteur/bibliotheque';
import { messageDe } from '../moteur/erreurs';
import {
  MARQUEUR,
  apercuEpisodes,
  associerParTitre,
  corrigerEpisode,
  definirAssociation,
  deduireMotif,
  deviner,
  extraireLiensEpisodes,
  lireAssociation,
  retirerAssociation,
  type Association,
} from '../moteur/liensManuels';
import { useCharger, useTsuzuku } from './contexte';
import { useAgir } from './FicheCommune';
import { Avis, Bouton, Champ, styleAttenue, styleTitre } from './ui';

/** Logique du lien manuel d'un animé (partagée par l'affichage de bureau et celui du téléphone). */
export function useLienAnime(id: string, numeroCourant: number, catalogue: { number: number; title?: string | null }[]) {
  const { s, version } = useTsuzuku();
  const { agir, erreur } = useAgir();
  const [adresse, setAdresse] = useState('');
  const [episode, setEpisode] = useState(String(numeroCourant));
  const [motif, setMotif] = useState('');
  const [padding, setPadding] = useState(0);
  const [decalage, setDecalage] = useState(0);
  const [info, setInfo] = useState<string | undefined>();
  const [problemes, setProblemes] = useState<string | undefined>();
  const bib = useCharger(() => s.depot.lire(), [s, version]);
  const assoc: Association | null = bib.donnees ? lireAssociation(bib.donnees.manualSources, id) : null;
  const numero = Math.max(1, Math.floor(Number(episode)) || 1);

  const analyser = () => {
    setProblemes(undefined);
    setInfo(undefined);
    try {
      const m = deduireMotif(adresse.trim(), numero);
      if (!m) {
        setMotif('');
        setProblemes('Aucun numéro d’épisode trouvé dans cette adresse : « Cet épisode seulement » reste possible.');
        return;
      }
      const remplace = m.pattern;
      setMotif(remplace);
      setPadding(m.padding);
      setDecalage(m.offset);
      setInfo(deviner(adresse.trim(), numero) === 'series' ? 'Cette adresse ressemble à une page de série : sur PC/iPhone, « Lire la page de série » liste ses épisodes.' : undefined);
    } catch (e) {
      setProblemes(messageDe(e));
    }
  };

  const apercu = useMemo(() => {
    if (!motif.includes(MARQUEUR)) return [];
    try {
      return apercuEpisodes({ type: 'pattern', pattern: motif, padding, offset: decalage, overrides: {}, label: null, createdAt: '', updatedAt: '' }, numero, 3);
    } catch {
      return [];
    }
  }, [motif, padding, decalage, numero]);

  const enregistrerMotif = () =>
    agir(() =>
      s.depot.modifier(db => {
        db.manualSources = definirAssociation(db.manualSources, id, { type: 'pattern', pattern: motif, padding, offset: decalage }).liens;
      }),
    );
  const seulementCeluiLa = () =>
    agir(() =>
      s.depot.modifier(db => {
        const existante = lireAssociation(db.manualSources, id);
        db.manualSources = existante
          ? corrigerEpisode(db.manualSources, id, numero, adresse.trim()).liens
          : definirAssociation(db.manualSources, id, { type: 'series', seriesUrl: adresse.trim(), episodes: [{ number: numero, url: adresse.trim() }] }).liens;
      }),
    );
  const lirePageSerie = async () => {
    setProblemes(undefined);
    await agir(async () => {
      const rep = await s.client.texte(adresse.trim());
      const trouves = extraireLiensEpisodes(rep.corps, rep.url);
      if (!trouves.length) throw new Error('Aucun épisode reconnu dans cette page.');
      const { liens, manquants } = associerParTitre(catalogue, trouves);
      const episodes = liens.length ? liens : trouves;
      await s.depot.modifier(db => {
        db.manualSources = definirAssociation(db.manualSources, id, { type: 'series', seriesUrl: rep.url, episodes }).liens;
      });
      setInfo(`${episodes.length} épisode(s) rattaché(s)${manquants.length ? `, ${manquants.length} sans correspondance` : ''}.`);
    });
  };
  const retirer = () => agir(() => s.depot.modifier(db => void (db.manualSources = retirerAssociation(db.manualSources, id))));

  const resume = assoc ? (assoc.type === 'pattern' ? `Motif : ${assoc.pattern}` : `Liste de ${assoc.episodes.length} épisode(s)`) : undefined;
  return { adresse, setAdresse, episode, setEpisode, motif, setMotif, apercu, assoc, resume, info, problemes, erreur, analyser, enregistrerMotif, seulementCeluiLa, lirePageSerie, retirer, lectureSources: s.lectureSources };
}

export function LienAnime({ id, numeroCourant, catalogue }: { id: string; numeroCourant: number; catalogue: { number: number; title?: string | null }[] }) {
  const { theme } = useTsuzuku();
  const [ouvert, setOuvert] = useState(false);
  const { adresse, setAdresse, episode, setEpisode, motif, setMotif, apercu, assoc, resume, info, problemes, erreur, analyser, enregistrerMotif, seulementCeluiLa, lirePageSerie, retirer, lectureSources } = useLienAnime(id, numeroCourant, catalogue);
  return (
    <View style={{ gap: 10 }} testID="bloc-lien-anime">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Bouton titre={assoc ? 'Lien manuel (modifier)' : 'Ajouter un lien manuel'} onPress={() => setOuvert(o => !o)} testID="lien-anime-ouvrir" />
        {resume ? <Text style={[styleAttenue(theme), { flexShrink: 1 }]} testID="lien-anime-resume">{resume}</Text> : null}
      </View>
      {ouvert ? (
        <View style={{ gap: 10 }} accessibilityLabel="Lien manuel de l’animé">
          <Text style={styleTitre(theme, 15)} accessibilityRole="header">Adresse d’un épisode</Text>
          <Champ libelle="Adresse (page ou fichier vidéo)" valeur={adresse} onChanger={setAdresse} testID="lien-anime-adresse" placeholder="https://…/episode-5" />
          <Champ libelle="Numéro de cet épisode" valeur={episode} onChanger={setEpisode} testID="lien-anime-episode" style={{ maxWidth: 160 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton titre="Analyser l’adresse" onPress={analyser} desactive={!adresse.trim()} testID="lien-anime-analyser" />
            <Bouton titre="Cet épisode seulement" onPress={() => void seulementCeluiLa()} desactive={!adresse.trim()} testID="lien-anime-seul" />
            {lectureSources ? <Bouton titre="Lire la page de série" onPress={() => void lirePageSerie()} desactive={!adresse.trim()} testID="lien-anime-serie" /> : null}
          </View>
          {motif ? (
            <View style={{ gap: 8 }}>
              <Champ libelle={`Motif (${MARQUEUR} = numéro d’épisode)`} valeur={motif} onChanger={setMotif} testID="lien-anime-motif" />
              {apercu.map(a => (
                <Text key={a.number} style={styleAttenue(theme, 12)} testID={`apercu-${a.number}`} numberOfLines={1}>
                  Ép. {a.number} → {a.url ?? '—'}
                </Text>
              ))}
              <Bouton titre="Enregistrer pour cet épisode et les suivants" variante="plein" onPress={() => void enregistrerMotif()} testID="lien-anime-enregistrer" />
            </View>
          ) : null}
          {assoc ? <Bouton titre="Retirer le lien manuel" variante="danger" onPress={() => void retirer()} testID="lien-anime-retirer" style={{ alignSelf: 'flex-start' }} /> : null}
          {info ? <Avis texte={info} /> : null}
          {problemes ? <Avis genre="alerte" texte={problemes} /> : null}
          {erreur ? <Avis genre="critique" texte={erreur} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Numéro de l'épisode suivant à regarder pour une entrée de bibliothèque. */
export function prochainEpisode(db: Parameters<typeof trouver>[0] | undefined, id: string, total?: number | null): number {
  const e = db ? trouver(db, 'anime', id) : null;
  const vus = e?.currentEpisode ?? 0;
  // Tout est vu : on propose de recommencer plutôt qu'un épisode qui n'existe pas.
  return total && vus >= total ? 1 : Math.max(1, vus + 1);
}

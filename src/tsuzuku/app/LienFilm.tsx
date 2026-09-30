/** Lien direct d'un film : une adresse (page, iframe, mp4, m3u8) que l'on retrouve à chaque lecture. */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { definirLienFilm, lireLienFilm, retirerLienFilm } from '../moteur/liensManuels';
import { useCharger, useTsuzuku } from './contexte';
import { useAgir } from './FicheCommune';
import { Avis, Bouton, Champ, styleAttenue } from './ui';

export function LienFilm({ id }: { id: string }) {
  const { s, theme, version } = useTsuzuku();
  const { agir, erreur } = useAgir();
  const [ouvert, setOuvert] = useState(false);
  const [adresse, setAdresse] = useState('');
  const [nom, setNom] = useState('');
  const bib = useCharger(() => s.depot.lire(), [s, version]);
  const lien = bib.donnees ? lireLienFilm(bib.donnees.manualSources, id) : null;
  return (
    <View style={{ gap: 10 }} testID="bloc-lien-film">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Bouton titre={lien ? 'Lien direct (modifier)' : 'Ajouter un lien direct'} onPress={() => setOuvert(o => !o)} testID="lien-film-ouvrir" />
        {lien ? (
          <Text numberOfLines={1} style={[styleAttenue(theme), { flexShrink: 1 }]} testID="lien-film-resume">
            {lien.label ? `${lien.label} · ` : ''}
            {lien.kind === 'iframe' ? 'page' : lien.kind === 'hls' ? 'flux HLS' : 'fichier vidéo'}
          </Text>
        ) : null}
      </View>
      {ouvert ? (
        <View style={{ gap: 10 }} accessibilityLabel="Lien direct du film">
          <Champ libelle="Adresse du film" valeur={adresse} onChanger={setAdresse} testID="lien-film-adresse" placeholder="https://…" />
          <Champ libelle="Nom (facultatif)" valeur={nom} onChanger={setNom} testID="lien-film-nom" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton
              titre="Enregistrer"
              variante="plein"
              desactive={!adresse.trim()}
              testID="lien-film-enregistrer"
              onPress={() =>
                void agir(async () => {
                  await s.depot.modifier(db => {
                    db.manualSources = definirLienFilm(db.manualSources, id, { url: adresse.trim(), label: nom }).liens;
                  });
                  setAdresse('');
                  setOuvert(false);
                })
              }
            />
            {lien ? <Bouton titre="Retirer" variante="danger" testID="lien-film-retirer" onPress={() => void agir(() => s.depot.modifier(db => void (db.manualSources = retirerLienFilm(db.manualSources, id))))} /> : null}
          </View>
        </View>
      ) : null}
      {erreur ? <Avis genre="critique" texte={erreur} /> : null}
    </View>
  );
}

/**
 * « Importer ma bibliothèque Tsuzuku » (rang administrateur) : reprend l'export JSON de
 * l'ancien Tsuzuku ou un fichier backend/data/libraries/{userId}.json dans le profil courant,
 * via la migration du moteur (rien n'est cru sur parole : champs bornés, images http(s)…).
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { importerBibliotheque, migrerFichierHerite, type RapportImport } from '../moteur/bibliotheque';
import { messageDe } from '../moteur/erreurs';
import { useTsuzuku } from './contexte';
import { SelecteurFichier } from './SelecteurFichier';
import { BoutonPrincipal } from '../../ui/mobile/BoutonPrincipal';
import { ChampMobile } from '../../ui/mobile/ChampMobile';
import { EcranMobile } from '../../ui/mobile/EcranMobile';
import { EnTeteMobile } from '../../ui/mobile/EnTeteMobile';
import { Cellule, GroupeCellules } from '../../ui/mobile/ListeCellules';
import { Avis, Bouton, Champ, Puce, Titre, styleAttenue } from './ui';

export function ImportBibliotheque() {
  const { s, theme, aller, changee, mobile, retour } = useTsuzuku();
  const [texte, setTexte] = useState('');
  const [mode, setMode] = useState<'fusion' | 'remplacement'>('fusion');
  const [etat, setEtat] = useState<{ genre: 'ok' | 'critique'; texte: string } | undefined>();
  if (!s.estAdmin && !mobile) {
    return (
      <View style={{ gap: 12 }} testID="tsuzuku-import-interdit">
        <Titre>Importer ma bibliothèque</Titre>
        <Avis genre="info" texte="L’import est réservé à l’administrateur." />
      </View>
    );
  }
  const importer = async () => {
    try {
      // La migration lit les deux formats (export de l'app, ancien fichier de bibliothèque) et refuse un JSON illisible.
      const migree = migrerFichierHerite(texte);
      let rapport: RapportImport | undefined;
      await s.depot.modifier(db => {
        rapport = importerBibliotheque(db, migree, mode);
      });
      changee();
      setEtat({ genre: 'ok', texte: `Importé : ${rapport?.anime ?? 0} animé(s), ${rapport?.movies ?? 0} film(s)${rapport?.skipped ? `, ${rapport.skipped} entrée(s) ignorée(s)` : ''}.` });
      setTexte('');
    } catch (e) {
      setEtat({ genre: 'critique', texte: messageDe(e) });
    }
  };
  if (mobile) {
    const entete = <EnTeteMobile theme={theme} titre="Importer" onRetour={retour} libelleRetour="Bibliothèque" testIDRetour="import-retour" />;
    if (!s.estAdmin) {
      return (
        <EcranMobile theme={theme} entete={entete} onRetour={retour}>
          <View testID="tsuzuku-import-interdit">
            <Avis genre="info" texte="L’import est réservé à l’administrateur." />
          </View>
        </EcranMobile>
      );
    }
    return (
      <View style={{ flex: 1 }} testID="tsuzuku-import">
        <EcranMobile
          theme={theme}
          entete={entete}
          onRetour={retour}
          pied={
            <>
              <BoutonPrincipal theme={theme} titre="Importer" desactive={!texte.trim()} onPress={() => void importer()} testID="import-valider" />
              <BoutonPrincipal theme={theme} variante="discret" titre="Voir la bibliothèque" onPress={() => aller({ t: 'bibliotheque' })} testID="import-vers-bibliotheque" />
            </>
          }>
          <Titre taille={28}>Importer ma bibliothèque</Titre>
          <Text style={[styleAttenue(theme, 15), { lineHeight: 22 }]}>
            Collez l’export JSON de l’ancien Tsuzuku (Bibliothèque › Exporter) ou le fichier backend/data/libraries/{'{'}userId{'}'}.json. Il est ajouté à la bibliothèque du profil ouvert.
          </Text>
          <SelecteurFichier mobile onTexte={t => setTexte(t)} />
          <ChampMobile theme={theme} etiquette="Contenu JSON" nature="multiligne" placeholder="Coller ici le contenu du fichier" value={texte} onChangeText={setTexte} testID="import-texte" />
          <GroupeCellules theme={theme} titre="Mode d’import">
            <Cellule theme={theme} titre="Fusionner avec l’existant" coche={mode === 'fusion'} onPress={() => setMode('fusion')} testID="import-fusion" />
            <Cellule theme={theme} titre="Remplacer ma bibliothèque" coche={mode === 'remplacement'} onPress={() => setMode('remplacement')} testID="import-remplacement" />
          </GroupeCellules>
          {mode === 'remplacement' ? <Avis genre="alerte" texte="Remplacer efface les titres actuels de ce profil (animés et films)." /> : null}
          {etat ? <Avis genre={etat.genre} texte={etat.texte} testID="import-avis" /> : null}
        </EcranMobile>
      </View>
    );
  }
  return (
    <View style={{ gap: 14 }} testID="tsuzuku-import">
      <Titre>Importer ma bibliothèque Tsuzuku</Titre>
      <Text style={styleAttenue(theme, 14)}>
        Collez l’export JSON de l’ancien Tsuzuku (Bibliothèque › Exporter) ou le fichier backend/data/libraries/{'{'}userId{'}'}.json. Il est ajouté à la bibliothèque du profil ouvert.
      </Text>
      <SelecteurFichier onTexte={t => setTexte(t)} />
      <Champ libelle="Contenu JSON" valeur={texte} onChanger={setTexte} multiligne testID="import-texte" />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityLabel="Mode d’import">
        <Puce titre="Fusionner avec l’existant" actif={mode === 'fusion'} onPress={() => setMode('fusion')} testID="import-fusion" />
        <Puce titre="Remplacer ma bibliothèque" actif={mode === 'remplacement'} onPress={() => setMode('remplacement')} testID="import-remplacement" />
      </View>
      {mode === 'remplacement' ? <Avis genre="alerte" texte="Remplacer efface les titres actuels de ce profil (animés et films)." /> : null}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Bouton titre="Importer" variante="plein" desactive={!texte.trim()} onPress={() => void importer()} testID="import-valider" />
        <Bouton titre="Voir la bibliothèque" onPress={() => aller({ t: 'bibliotheque' })} testID="import-vers-bibliotheque" />
      </View>
      {etat ? <Avis genre={etat.genre} texte={etat.texte} testID="import-avis" /> : null}
    </View>
  );
}

/**
 * Formulaire d'un repère : instant (pré-rempli avec le temps courant du
 * lecteur), titre, catégorie, joueur concerné, durée facultative et note en
 * Markdown limité : barre de mise en forme (gras, italique, liste, lien ;
 * Ctrl/Cmd+B et Ctrl/Cmd+I) et aperçu sous le champ.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { CategorieRepere, SaisieRepere } from '../../review/api';
import { CATEGORIES, formatTemps, lireTemps } from '../../review/libelles';
import { ChampNote } from '../ChampNote';
import { Choix, styles, Panneau } from '../commun';

export interface InitialRepere {
  debut: number;
  fin?: number | null;
  titre?: string;
  categorie?: CategorieRepere;
  note?: string;
  cible?: string | null;
}

export function FormulaireRepere({
  theme,
  membres,
  initial,
  edition,
  enCours,
  onEnregistrer,
  onAnnuler,
}: {
  theme: ThemeHub;
  membres: ReadonlyArray<{ compte: string; pseudo: string }>;
  initial: InitialRepere;
  edition?: boolean;
  enCours?: boolean;
  onEnregistrer(saisie: SaisieRepere): void;
  onAnnuler(): void;
}) {
  const [instant, setInstant] = useState(formatTemps(initial.debut));
  const [titre, setTitre] = useState(initial.titre ?? '');
  const [cat, setCat] = useState<CategorieRepere>(initial.categorie ?? 'erreur');
  const [cible, setCible] = useState(initial.cible ?? '');
  const [duree, setDuree] = useState(initial.fin != null ? String(Math.round((initial.fin - initial.debut) * 10) / 10) : '');
  const [note, setNote] = useState(initial.note ?? '');
  const [erreur, setErreur] = useState<string | undefined>();

  const valider = () => {
    const debut = lireTemps(instant);
    if (debut === undefined) return setErreur('Instant invalide : écrivez 1:23, 83 ou 1m23s.');
    if (titre.trim().length < 2) return setErreur('Titre : 2 caractères au moins.');
    let d: number | null = null;
    if (duree.trim() !== '') {
      const n = Number(duree.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > 3600) return setErreur('Durée : un nombre de secondes entre 1 et 3600.');
      d = n;
    }
    setErreur(undefined);
    onEnregistrer({ debut, duree: d, categorie: cat, titre: titre.trim(), note, cible: cible || null });
  };

  return (
    <Panneau theme={theme} testID="esport-repere-form">
      <Text accessibilityRole="header" style={{ color: theme.texte, fontWeight: '800', fontSize: 16, ...police(theme.policeTitre) }}>
        {edition ? 'Modifier le repère' : 'Nouveau repère'}
      </Text>
      <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
        <Champ theme={theme} libelle="Instant (mm:ss)" valeur={instant} onChanger={setInstant} testID="esport-repere-instant" style={{ width: 130 }} />
        <Champ theme={theme} libelle="Durée en secondes (facultatif)" valeur={duree} onChanger={setDuree} testID="esport-repere-duree" clavier="number-pad" style={{ width: 200 }} />
      </View>
      <Champ theme={theme} libelle="Titre" valeur={titre} onChanger={setTitre} testID="esport-repere-titre" maxLength={120} />
      <Choix<CategorieRepere>
        theme={theme}
        libelle="Catégorie"
        valeur={cat}
        options={CATEGORIES.map(c => ({ id: c.cle, nom: `${c.glyphe} ${c.nom}`, couleur: c.couleur }))}
        onChoisir={setCat}
        testID="esport-repere-categorie"
      />
      <Choix
        theme={theme}
        libelle="Joueur concerné"
        valeur={cible}
        options={[{ id: '', nom: 'Aucun' }, ...membres.map(m => ({ id: m.compte, nom: m.pseudo }))]}
        onChoisir={setCible}
        testID="esport-repere-joueur"
      />
      <ChampNote theme={theme} libelle="Note" valeur={note} onChanger={setNote} testID="esport-repere-note" maxLength={4000} apercu="toujours" testIDApercu="esport-repere-apercu" placeholder="**Gras**, *italique*, - listes, [lien](https://…)" />
      {erreur ? (
        <Text accessibilityRole="alert" testID="esport-repere-erreur" style={{ color: theme.critique, ...police(theme.policeTexte) }}>
          {erreur}
        </Text>
      ) : null}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={edition ? 'Enregistrer' : 'Ajouter le repère'} variante="plein" onPress={valider} desactive={enCours} testID="esport-repere-enregistrer" />
        <BoutonHub theme={theme} titre="Annuler" onPress={onAnnuler} testID="esport-repere-annuler" />
      </View>
    </Panneau>
  );
}

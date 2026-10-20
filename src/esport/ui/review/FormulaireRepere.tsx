/**
 * Formulaire d'un repère : instant (pré-rempli avec le temps courant du
 * lecteur), titre, catégorie, joueur concerné, durée facultative et note en
 * Markdown limité : barre de mise en forme complète (voir ChampNote), @mentions des
 * joueurs de la team et aperçu sous le champ.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { CategorieRepere, SaisieRepere } from '../../review/api';
import { decoder } from '../../review/markdown';
import { CATEGORIES, formatTemps, lireTemps } from '../../review/libelles';
import { ChampNote } from '../ChampNote';
import { Choix, styles, Panneau } from '../commun';
import { tr } from '../../i18n';

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
  const [note, setNote] = useState(decoder(initial.note ?? ''));
  const [erreur, setErreur] = useState<string | undefined>();

  const valider = () => {
    const debut = lireTemps(instant);
    if (debut === undefined) return setErreur(tr('review.formulaireRepere.instant_invalide_ecrivez_1'));
    if (titre.trim().length < 2) return setErreur(tr('review.formulaireRepere.titre_2_caracteres_au'));
    let d: number | null = null;
    if (duree.trim() !== '') {
      const n = Number(duree.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > 3600) return setErreur(tr('review.formulaireRepere.duree_un_nombre_de'));
      d = n;
    }
    setErreur(undefined);
    onEnregistrer({ debut, duree: d, categorie: cat, titre: titre.trim(), note, cible: cible || null });
  };

  return (
    <Panneau theme={theme} testID="esport-repere-form">
      <Text accessibilityRole="header" style={{ color: theme.texte, fontWeight: '800', fontSize: 16, ...police(theme.policeTitre) }}>
        {edition ? tr('review.formulaireRepere.modifier_le_repere') : tr('review.formulaireRepere.nouveau_repere')}
      </Text>
      <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
        <Champ theme={theme} libelle={tr('review.formulaireRepere.instant_mm_ss')} valeur={instant} onChanger={setInstant} testID="esport-repere-instant" style={{ width: 130 }} />
        <Champ theme={theme} libelle={tr('review.formulaireRepere.duree_en_secondes_facultatif')} valeur={duree} onChanger={setDuree} testID="esport-repere-duree" clavier="number-pad" style={{ width: 200 }} />
      </View>
      <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={titre} onChanger={setTitre} testID="esport-repere-titre" maxLength={120} />
      <Choix<CategorieRepere>
        theme={theme}
        libelle={tr('review.formulaireRepere.categorie')}
        valeur={cat}
        options={CATEGORIES.map(c => ({ id: c.cle, nom: `${c.glyphe} ${c.nom}`, couleur: c.couleur }))}
        onChoisir={setCat}
        testID="esport-repere-categorie"
      />
      <Choix
        theme={theme}
        libelle={tr('review.formulaireRepere.joueur_concerne')}
        valeur={cible}
        options={[{ id: '', nom: tr('objectifs.aucun') }, ...membres.map(m => ({ id: m.compte, nom: m.pseudo }))]}
        onChoisir={setCible}
        testID="esport-repere-joueur"
      />
      <ChampNote theme={theme} libelle={tr('review.formulaireRepere.note')} valeur={note} onChanger={setNote} testID="esport-repere-note" maxLength={8000} joueurs={membres.map(m => m.pseudo)} apercu="toujours" testIDApercu="esport-repere-apercu" placeholder={tr('review.formulaireRepere.gras_italique_listes_lien')} />
      {erreur ? (
        <Text accessibilityRole="alert" testID="esport-repere-erreur" style={{ color: theme.critique, ...police(theme.policeTexte) }}>
          {erreur}
        </Text>
      ) : null}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={edition ? tr('discord.enregistrer') : tr('review.formulaireRepere.ajouter_le_repere')} variante="plein" onPress={valider} desactive={enCours} testID="esport-repere-enregistrer" />
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={onAnnuler} testID="esport-repere-annuler" />
      </View>
    </Panneau>
  );
}

/**
 * La page Paramètres sur téléphone : une liste de sections (cellules) qui ouvrent chacune une
 * sous-page, une recherche en tête, la barre basse du hub en bas.
 *
 *  - « ‹ Accueil » ferme la page ; dans une sous-page, « ‹ Réglages » revient à la liste (ainsi que le
 *    balayage depuis le bord gauche, et Échap au clavier) ;
 *  - une demande d'ouverture sur une section (pastille de synchro, lien « Ouvrir les Paramètres »
 *    d'une app) ouvre directement sa sous-page ;
 *  - les réglages eux-mêmes viennent de l'hôte (`rendu(id)`), comme sur le bureau.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PageParametresProps } from './PageParametres';
import { REGLAGES, reglagesDeSection, rechercher, section as sectionDef, sectionsVisibles, type IdReglage, type IdSection } from './recensement';
import { police } from './themes';
import { ecouterTouche } from './web';
import { ChampMobile } from '../ui/mobile/ChampMobile';
import { EcranMobile } from '../ui/mobile/EcranMobile';
import { EnTeteMobile } from '../ui/mobile/EnTeteMobile';
import { ESPACE, TEXTE, rayonCarte } from '../ui/mobile/jetons';
import { Cellule, GroupeCellules } from '../ui/mobile/ListeCellules';
import { BarreBasseHub } from '../ui/mobile/NavigationMobile';
import { IndicateurSynchro } from './IndicateurSynchro';

const TITRES = Object.fromEntries(REGLAGES.map(r => [r.id, r.titre])) as Record<IdReglage, string>;

/** Regroupement des sections dans la liste (pur). */
export function groupesSections<T extends { id: IdSection }>(sections: readonly T[]): Array<{ titre: string; sections: T[] }> {
  const apps: IdSection[] = ['portefeuille', 'administration', 'tsuzuku'];
  const aide: IdSection[] = ['nouveautes', 'support', 'apropos'];
  const groupes = [
    { titre: 'Compte et appareil', sections: sections.filter(s => !apps.includes(s.id) && !aide.includes(s.id)) },
    { titre: 'Apps', sections: sections.filter(s => apps.includes(s.id)) },
    { titre: 'Aide', sections: sections.filter(s => aide.includes(s.id)) },
  ];
  return groupes.filter(g => g.sections.length > 0);
}

export function PageParametresMobile({ theme, section, n, disponibles, rendu, synchro, actif = true, onFermer }: PageParametresProps) {
  const sections = useMemo(() => sectionsVisibles(disponibles), [disponibles]);
  const [ouverte, setOuverte] = useState<IdSection | undefined>(section && sections.some(s => s.id === section) ? section : undefined);
  const [requete, setRequete] = useState('');
  useEffect(() => {
    if (section && sections.some(s => s.id === section)) {
      setOuverte(section);
      setRequete('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seule une nouvelle demande compte.
  }, [section, n]);

  const retour = () => {
    if (ouverte) {
      setOuverte(undefined);
    } else if (requete) {
      setRequete('');
    } else {
      onFermer();
    }
  };
  const retourRef = useRef(retour);
  retourRef.current = retour;
  useEffect(() => (actif ? ecouterTouche('Escape', () => retourRef.current(), { ignorerChamps: false }) : undefined), [actif]);

  const enRecherche = requete.trim().length > 0;
  const resultats = useMemo(() => (enRecherche ? rechercher(requete, disponibles) : []), [enRecherche, requete, disponibles]);
  const total = resultats.reduce((somme, groupe) => somme + groupe.reglages.length, 0);
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

  const carte = (id: IdReglage, etiquette?: string) => {
    const contenu = rendu(id);
    if (contenu === null || contenu === undefined) {
      return null;
    }
    return (
      <View key={id} testID={`reglage-${id}`} style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: rayonCarte(theme) }]}>
        <Text style={{ color: theme.texte, fontSize: TEXTE.corps + 1, fontWeight: '700', ...police(theme.policeTitre) }} accessibilityRole="header">
          {TITRES[id]}
        </Text>
        {etiquette ? <Text style={[attenue, { fontSize: TEXTE.legende }]}>{etiquette}</Text> : null}
        <View style={{ gap: ESPACE.s }}>{contenu}</View>
      </View>
    );
  };

  const pied = <BarreBasseHub actif="parametres" />;

  if (ouverte) {
    const def = sectionDef(ouverte);
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-parametres" accessibilityLabel="Paramètres">
        <EcranMobile
          theme={theme}
          onRetour={retour}
          testID={`parametres-panneau-${ouverte}`}
          entete={<EnTeteMobile theme={theme} titre={def.titre} onRetour={retour} libelleRetour="Réglages" testIDRetour="parametres-retour" />}>
          <Text style={[attenue, { fontSize: TEXTE.legende, lineHeight: 21 }]}>{def.description}</Text>
          {reglagesDeSection(ouverte, disponibles).map(r => carte(r.id))}
        </EcranMobile>
        {pied}
      </View>
    );
  }

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-parametres" accessibilityLabel="Paramètres">
      <EcranMobile
        theme={theme}
        onRetour={onFermer}
        entete={
          <EnTeteMobile
            theme={theme}
            titre="Réglages"
            onRetour={onFermer}
            libelleRetour="Accueil"
            testIDRetour="hub-parametres-fermer"
            droite={synchro ? <IndicateurSynchro theme={theme} synchro={synchro} condense onPress={() => setOuverte('synchro')} /> : undefined}
          />
        }>
        <ChampMobile
          theme={theme}
          etiquette="Rechercher un réglage"
          nature="recherche"
          placeholder="Thème, cours, sauvegarde…"
          value={requete}
          onChangeText={setRequete}
          testID="parametres-recherche"
        />
        {enRecherche ? (
          <View style={{ gap: ESPACE.m }} testID="parametres-resultats">
            <Text accessibilityLiveRegion="polite" style={[attenue, { fontSize: TEXTE.legende }]} testID="parametres-nombre">
              {total === 0 ? `Aucun réglage ne correspond à « ${requete.trim()} ».` : `${total} réglage${total > 1 ? 's' : ''} trouvé${total > 1 ? 's' : ''}.`}
            </Text>
            {resultats.map(groupe => (
              <View key={groupe.section.id} style={{ gap: ESPACE.s }}>
                <Text style={[attenue, { fontSize: TEXTE.legende, fontWeight: '700' }]} accessibilityRole="header">
                  {groupe.section.titre}
                </Text>
                {groupe.reglages.map(r => carte(r.id, r.description))}
              </View>
            ))}
          </View>
        ) : (
          groupesSections(sections).map(groupe => (
            <GroupeCellules key={groupe.titre} theme={theme} titre={groupe.titre}>
              {groupe.sections.map(s => (
                <Cellule key={s.id} theme={theme} glyphe={s.icone} titre={s.titre} sousTitre={s.description} chevron onPress={() => setOuverte(s.id)} testID={`parametres-section-${s.id}`} />
              ))}
            </GroupeCellules>
          ))
        )}
      </EcranMobile>
      {pied}
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  carte: { borderWidth: StyleSheet.hairlineWidth, padding: ESPACE.m, gap: ESPACE.s },
});

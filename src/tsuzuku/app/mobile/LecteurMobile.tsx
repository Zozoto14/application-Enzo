/**
 * Lecteur sur téléphone.
 *
 *  - la vidéo (16:9, pleine largeur, fond noir) reste COLLÉE en haut : on peut faire défiler dessous
 *    sans la perdre ; commandes natives du navigateur (larges), `playsInline`, pas de lecture
 *    automatique (Safari la refuse sans geste) ; « Plein écran » passe en paysage ;
 *  - épisode précédent / suivant : deux grands boutons collés en bas, sous le pouce ;
 *  - source de lecture : une cellule qui ouvre une feuille basse (jamais une rangée de petites puces) ;
 *  - « Êtes-vous toujours là ? » : la feuille basse du garde d'inactivité (src/hub/GardeInactivite.tsx).
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { police } from '../../../hub/themes';
import { BoutonPrincipal } from '../../../ui/mobile/BoutonPrincipal';
import { EcranMobile } from '../../../ui/mobile/EcranMobile';
import { EnTeteMobile } from '../../../ui/mobile/EnTeteMobile';
import { FeuilleBasse } from '../../../ui/mobile/FeuilleBasse';
import { ESPACE, TEXTE } from '../../../ui/mobile/jetons';
import { Cellule, GroupeCellules } from '../../../ui/mobile/ListeCellules';
import type { Genre } from '../../moteur/bibliotheque';
import type { Lecteur } from '../../moteur/resolution';
import { useTsuzuku, type Chargement } from '../contexte';
import { ouvrirExterne } from '../externe';
import { LecteurMedia } from '../LecteurMedia';
import { PiedTsuzuku } from '../PiedTsuzuku';
import { Avis, Etat, styleTitre } from '../ui';

export interface LecteurMobileProps {
  kind: Genre;
  n: number;
  meta?: { titre: string; image: string | null; total: number | null; annee: number | null; duree: number | null };
  lecteurs: Lecteur[];
  courant?: Lecteur;
  choix: number;
  onChoisir(i: number): void;
  message?: string;
  charge: Pick<Chargement<unknown>, 'enCours' | 'erreur' | 'recharger'>;
  aSuivant: boolean;
  onPrecedent(): void;
  onSuivant(): void;
  onFin(): void;
  onMarquerVu(): void;
  prete: boolean;
}

export function LecteurMobile(p: LecteurMobileProps) {
  const { theme, themeHub, retour, onParametres } = useTsuzuku();
  const [sources, setSources] = useState(false);
  const { meta, courant, kind, n } = p;
  const enTete = (
    <View>
      <EnTeteMobile
        theme={theme}
        titre="Lecture"
        onRetour={retour}
        libelleRetour="Fiche"
        testIDRetour="lecteur-retour"
      />
      {p.prete && meta && courant ? (
        <LecteurMedia key={courant.url} lecteur={courant} titre={meta.titre} onFin={p.onFin} poster={meta.image} />
      ) : (
        <View style={st.attente} testID={p.charge.erreur ? 'lecteur-attente-erreur' : 'lecteur-attente'}>
          <Text style={{ color: '#FFFFFF', fontSize: 16, textAlign: 'center', paddingHorizontal: 24, ...police(theme.policeTexte) }}>
            {p.charge.enCours ? 'Recherche du lecteur…' : courant ? '' : 'Aucun lecteur pour le moment'}
          </Text>
        </View>
      )}
    </View>
  );
  const pied =
    kind === 'anime' ? (
      <View style={st.ligne}>
        <View style={{ flex: 1 }}>
          <BoutonPrincipal theme={theme} variante="discret" titre="‹ Précédent" libelle="Épisode précédent" desactive={n <= 1} onPress={p.onPrecedent} testID="lecteur-precedent" />
        </View>
        <View style={{ flex: 1 }}>
          <BoutonPrincipal theme={theme} titre="Suivant ›" libelle="Épisode suivant" desactive={!p.aSuivant} onPress={p.onSuivant} testID="lecteur-suivant" />
        </View>
      </View>
    ) : courant ? (
      <BoutonPrincipal theme={theme} titre="✓ Marquer comme vu" onPress={p.onMarquerVu} testID="lecteur-marquer-vu" />
    ) : undefined;
  return (
    <View style={{ flex: 1 }} testID="tsuzuku-lecteur">
      <EcranMobile theme={theme} entete={enTete} pied={pied} onRetour={retour}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: theme.attenue, fontSize: TEXTE.legende, fontWeight: '700', ...police(theme.policeTexte) }}>
            {kind === 'anime' ? `Épisode ${n}${meta?.total ? ` sur ${meta.total}` : ''}` : `Film${meta?.annee ? ` · ${meta.annee}` : ''}${meta?.duree ? ` · ${meta.duree} min` : ''}`}
          </Text>
          <Text accessibilityRole="header" testID="lecteur-titre" style={styleTitre(theme, 26)}>
            {meta ? `${meta.titre}${kind === 'anime' ? ` · Épisode ${n}` : ''}` : 'Lecture'}
          </Text>
        </View>
        <Etat enCours={p.charge.enCours} erreur={p.charge.erreur} onRecharger={p.charge.recharger}>
          {p.prete ? <>{p.message ? <Avis genre={courant ? 'alerte' : 'info'} texte={p.message} testID="lecteur-message" /> : null}
          {p.lecteurs.length > 1 && courant ? (
            <GroupeCellules theme={theme}>
              <Cellule theme={theme} glyphe="⇄" titre="Source de lecture" valeur={courant.label || `Lecteur ${p.choix + 1}`} chevron onPress={() => setSources(true)} testID="lecteur-source" />
            </GroupeCellules>
          ) : null}
          {!courant ? (
            <View style={{ gap: ESPACE.s }}>
              <Text style={{ color: theme.attenue, fontSize: 16, lineHeight: 23, ...police(theme.policeTexte) }}>Vous pouvez coller un lien direct depuis la fiche.</Text>
              <BoutonPrincipal theme={theme} titre="Aller à la fiche" onPress={retour} testID="lecteur-vers-fiche" />
            </View>
          ) : (
            <GroupeCellules theme={theme}>
              <Cellule theme={theme} glyphe="↗" titre="Ouvrir dans le navigateur" sousTitre="Si le lecteur intégré ne démarre pas" chevron onPress={() => void ouvrirExterne(courant.url)} testID="lecteur-externe" />
            </GroupeCellules>
          )}</> : null}
        </Etat>
        <PiedTsuzuku theme={themeHub} onEnSavoirPlus={onParametres ? () => onParametres('apropos') : undefined} />
      </EcranMobile>
      <FeuilleBasse theme={theme} visible={sources} titre="Source de lecture" description="Si une source ne démarre pas, essayez-en une autre." onFermer={() => setSources(false)} testID="lecteur-feuille-sources">
        <GroupeCellules theme={theme}>
          {p.lecteurs.map((l, i) => (
            <Cellule
              key={`${l.url}-${i}`}
              theme={theme}
              titre={l.label || `Lecteur ${i + 1}`}
              coche={i === p.choix}
              onPress={() => {
                p.onChoisir(i);
                setSources(false);
              }}
              testID={`lecteur-choix-${i}`}
            />
          ))}
        </GroupeCellules>
      </FeuilleBasse>
    </View>
  );
}

const st = StyleSheet.create({
  attente: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  ligne: { flexDirection: 'row', gap: 8 },
});

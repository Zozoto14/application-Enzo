/**
 * Claude Office v4 : écran « Équipe » (onglet Suivi) — personnaliser les agents
 * par projet (ou pour une seule session en cours) : surnom, couleur,
 * accessoire du petit catalogue, projet épinglé en favori. Propre à l'appareil.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ThemeHub } from '../hub/themes';
import { FeuilleBasse } from '../ui/mobile/FeuilleBasse';
import { AvatarAgent } from './AvatarAgent';
import {
  apparenceDepuis, CATALOGUE_ACCESSOIRES, COULEURS_EQUIPE, equipeCourante, magasinEnDemo, MAX_SURNOM, modifierPerso, trierProjets, useMagasinSuivi,
  type AccessoireAgent, type Perso,
} from './equipe';
import { masquerAffichage, type Agent } from './logiqueBureau';
import { apparence } from './logiqueScene';
import { Bouton, Carte, TAILLE } from './uiOffice';

interface Cible {
  genre: 'projets' | 'sessions';
  cle: string;
  projet?: string;
  session?: string;
  titre: string;
  /** Nom affiché dans la liste (sinon le titre). */
  nom?: string;
}

const idTest = (t: string) => t.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);

function Editeur({ theme, cible, onFermer }: { theme: ThemeHub; cible: Cible; onFermer(): void }) {
  const e = equipeCourante();
  const depart: Perso = e[cible.genre][cible.cle] ?? {};
  const [perso, setPerso] = useState<Perso>(depart);
  const avant = apparenceDepuis({ ...e, [cible.genre]: { ...e[cible.genre], [cible.cle]: perso } }, cible.projet, cible.session);
  const base = apparence({ cle: cible.session ?? cible.cle, session: cible.session ?? cible.cle, projet: cible.projet });
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 21 };
  const t = { color: theme.texte, fontSize: TAILLE, fontWeight: '700' as const };
  return (
    <FeuilleBasse
      theme={theme}
      visible
      titre={`Personnaliser ${cible.titre}`}
      description={cible.genre === 'sessions' ? 'Pour cette session seulement (l’emporte sur le projet).' : 'Pour toutes les sessions de ce projet.'}
      onFermer={onFermer}
      testID="equipe-editeur"
      pied={(
        <View style={styles.boutons}>
          <Bouton theme={theme} variante="plein" titre="Enregistrer" onPress={() => { modifierPerso(cible.genre, cible.cle, perso); onFermer(); }} testID="equipe-enregistrer" />
          <Bouton theme={theme} titre="Réinitialiser" onPress={() => { modifierPerso(cible.genre, cible.cle, null); onFermer(); }} testID="equipe-reinitialiser" />
        </View>
      )}
    >
      <View style={styles.apercu}>
        <AvatarAgent apparence={{ ...base, haut: avant.couleur }} accessoire={avant.accessoire} favori={avant.favori} taille={72} testID="equipe-apercu" />
        <Text style={[t, { flex: 1 }]} testID="equipe-apercu-nom">{masquerAffichage(avant.surnom ? `${avant.surnom} (${cible.projet ?? cible.titre})` : cible.projet ?? cible.titre)}</Text>
      </View>
      <Text style={t}>Surnom</Text>
      <TextInput
        value={perso.surnom ?? ''}
        onChangeText={v => setPerso(p => ({ ...p, surnom: v.slice(0, MAX_SURNOM) || undefined }))}
        placeholder="Par exemple : Félix"
        placeholderTextColor={theme.attenue}
        maxLength={MAX_SURNOM}
        accessibilityLabel="Surnom de l’agent"
        style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]}
        testID="equipe-surnom"
      />
      <Text style={t}>Couleur</Text>
      <View style={styles.grille} accessibilityRole="radiogroup" accessibilityLabel="Couleur du haut">
        {COULEURS_EQUIPE.map(c => (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityLabel={`Couleur ${c}`}
            accessibilityState={{ checked: perso.couleur === c }}
            onPress={() => setPerso(p => ({ ...p, couleur: p.couleur === c ? undefined : c }))}
            style={[styles.pastilleCouleur, { backgroundColor: c, borderColor: perso.couleur === c ? theme.texte : 'transparent' }]}
            testID={`equipe-couleur-${c.slice(1)}`}
          >
            {perso.couleur === c ? <Text style={styles.coche}>✓</Text> : null}
          </Pressable>
        ))}
      </View>
      <Text style={t}>Accessoire</Text>
      <View style={styles.grille} accessibilityRole="radiogroup" accessibilityLabel="Accessoire">
        {CATALOGUE_ACCESSOIRES.map(x => {
          const choisi = (perso.accessoire ?? 'aucun') === x.id;
          return (
            <Pressable
              key={x.id}
              accessibilityRole="radio"
              accessibilityLabel={x.nom}
              accessibilityState={{ checked: choisi }}
              onPress={() => setPerso(p => ({ ...p, accessoire: x.id === 'aucun' ? undefined : (x.id as AccessoireAgent) }))}
              style={[styles.choixAccessoire, { borderColor: choisi ? theme.accent : theme.ligne, backgroundColor: theme.surface }]}
              testID={`equipe-accessoire-${x.id}`}
            >
              <AvatarAgent apparence={{ ...base, haut: avant.couleur }} accessoire={x.id === 'aucun' ? undefined : (x.id as AccessoireAgent)} taille={44} />
              <Text style={{ color: theme.texte, fontSize: TAILLE }} numberOfLines={1}>{x.nom}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={a}>{magasinEnDemo() ? 'Démo : rien n’est enregistré.' : 'Gardé sur cet appareil seulement (rien n’est envoyé).'}</Text>
    </FeuilleBasse>
  );
}

export function EcranEquipe({ theme, projets, agents }: { theme: ThemeHub; projets: readonly string[]; agents: readonly Agent[] }) {
  useMagasinSuivi();
  const e = equipeCourante();
  const [cible, setCible] = useState<Cible>();
  const liste = useMemo(() => trierProjets([...projets, ...Object.keys(e.projets)], e), [projets, e]);
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 21 };
  const ligne = (c: Cible, ap: ReturnType<typeof apparenceDepuis>, sousTitre: string, base: ReturnType<typeof apparence>) => (
    <View key={`${c.genre}-${c.cle}`} style={[styles.ligne, { borderColor: theme.ligne }]} testID={`equipe-${c.genre === 'projets' ? 'projet' : 'session'}-${idTest(c.cle)}`}>
      <AvatarAgent apparence={{ ...base, haut: ap.couleur }} accessoire={ap.accessoire} favori={ap.favori} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.texte, fontSize: TAILLE + 1, fontWeight: '700' }} numberOfLines={1}>{masquerAffichage(ap.surnom ?? c.nom ?? c.titre)}</Text>
        <Text style={a} numberOfLines={1}>{sousTitre}</Text>
      </View>
      {c.genre === 'projets' ? (
        <Bouton
          theme={theme}
          variante="discret"
          compact
          titre={e.projets[c.cle]?.favori ? '★' : '☆'}
          libelle={e.projets[c.cle]?.favori ? `Retirer ${c.cle} des favoris` : `Épingler ${c.cle} en favori`}
          onPress={() => modifierPerso('projets', c.cle, { favori: !e.projets[c.cle]?.favori })}
          testID={`equipe-favori-${idTest(c.cle)}`}
        />
      ) : null}
      <Bouton theme={theme} compact titre="Modifier" libelle={`Personnaliser ${c.titre}`} onPress={() => setCible(c)} testID={`equipe-modifier-${idTest(c.cle)}`} />
    </View>
  );
  return (
    <View style={styles.colonne} testID="suivi-equipe">
      <Carte theme={theme} titre="Projets">
        <Text style={a}>Un surnom, une couleur, un accessoire par projet ; ★ épingle un projet en favori (en tête des listes).</Text>
        {liste.length === 0 ? <Text style={a} testID="equipe-vide">Aucun projet vu pour l’instant : ils apparaissent ici dès la première session de Claude Code.</Text> : null}
        {liste.map(p => {
          const ap = apparenceDepuis(e, p, undefined);
          return ligne({ genre: 'projets', cle: p, projet: p, titre: p }, ap, ap.surnom ? masquerAffichage(p) : ap.personnalise ? 'Personnalisé' : 'Par défaut', apparence({ cle: p, session: p, projet: p }));
        })}
      </Carte>
      {agents.length ? (
        <Carte theme={theme} titre="Sessions en cours">
          <Text style={a}>Pour distinguer deux sessions du même projet : la personnalisation d’une session l’emporte sur celle du projet.</Text>
          {agents.map(ag => {
            const ap = apparenceDepuis(e, ag.projet, ag.session);
            return ligne(
              { genre: 'sessions', cle: ag.session, projet: ag.projet, session: ag.session, titre: `${ag.projet ?? 'Projet inconnu'} · ${ag.session.slice(0, 8)}`, nom: ag.projet ?? 'Projet inconnu' },
              ap,
              `${ap.surnom ? `${masquerAffichage(ag.projet ?? 'Projet inconnu')} · ` : ''}session ${ag.session.slice(0, 8)}${ag.appareil ? ` · ${masquerAffichage(ag.appareil)}` : ''}`,
              apparence(ag),
            );
          })}
        </Carte>
      ) : null}
      {cible ? <Editeur theme={theme} cible={cible} onFermer={() => setCible(undefined)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  colonne: { gap: 12 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  apercu: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  champ: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pastilleCouleur: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  coche: { color: '#FFFFFF', fontWeight: '900', fontSize: 18 },
  choixAccessoire: { width: 96, minHeight: 88, borderWidth: 2, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 },
});

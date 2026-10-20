/**
 * Briques communes du planning : fuseau d'affichage, pastille de type,
 * réponse RSVP rapide (gros boutons, pensée pour l'iPhone), carte d'une
 * occurrence. Couleurs du thème (8 thèmes, clair et sombre) ; seules les
 * couleurs de type sont fixes (teintes moyennes, posées en transparence).
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { Convocation, MembreConvocable, Occurrence, Rsvp } from '../../planning/api';
import { GROUPES, basculerGroupe, basculerMembre, basculerProprietaire, convocationVide, estConvoque, groupeActif, resumeConvocation } from '../../planning/convocations';
import { dateCourteJour, fuseauAppareil, nomFuseau, typeEvenement } from '../../planning/libelles';
import { styles } from '../commun';
import { tr } from '../../i18n';

// ------------------------------------------------------------------ Fuseau d'affichage

/** Choix gardé le temps de la session (toutes les vues du planning le partagent). */
let choixFuseau: 'team' | 'appareil' = 'team';

/** Fuseau d'affichage : celui de la team par défaut, celui de l'appareil sur demande. */
export function useFuseau(fuseauTeam: string): { fuseau: string; choix: 'team' | 'appareil'; setChoix(c: 'team' | 'appareil'): void; different: boolean } {
  const [choix, setChoixEtat] = useState(choixFuseau);
  const appareil = fuseauAppareil();
  const setChoix = (c: 'team' | 'appareil') => {
    choixFuseau = c;
    setChoixEtat(c);
  };
  return { fuseau: choix === 'appareil' ? appareil : fuseauTeam, choix, setChoix, different: appareil !== fuseauTeam };
}

export function SelecteurFuseau({ theme, fuseauTeam, f }: { theme: ThemeHub; fuseauTeam: string; f: ReturnType<typeof useFuseau> }) {
  if (!f.different) return <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{tr('planning.commun.heures_de', { v: nomFuseau(fuseauTeam) })}</Text>;
  const options: Array<['team' | 'appareil', string]> = [
    ['team', tr('planning.commun.team', { v: nomFuseau(fuseauTeam) })],
    ['appareil', tr('planning.commun.mon_heure', { v: nomFuseau(fuseauAppareil()) })],
  ];
  return (
    <View style={styles.ligne} accessibilityRole="radiogroup" accessibilityLabel={tr('planning.commun.fuseau_horaire')}>
      {options.map(([cle, libelle]) => (
        <Pastille key={cle} theme={theme} actif={f.choix === cle} libelle={libelle} onPress={() => f.setChoix(cle)} testID={`esport-fuseau-${cle}`} role="radio" />
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Petites briques

export function Pastille({
  theme,
  actif,
  libelle,
  onPress,
  couleur,
  testID,
  role = 'button',
}: {
  theme: ThemeHub;
  actif: boolean;
  libelle: string;
  onPress(): void;
  couleur?: string;
  testID?: string;
  role?: 'button' | 'radio' | 'checkbox';
}) {
  const c = couleur ?? theme.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityState={role === 'button' ? { selected: actif } : { checked: actif }}
      accessibilityLabel={libelle}
      onPress={onPress}
      style={[styles.choix, { borderColor: actif ? c : theme.ligne, backgroundColor: actif ? teinteTransparente(c, 0.2) : theme.surface, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
      {couleur ? <View style={[styles.point, { backgroundColor: couleur }]} /> : null}
      <Text style={{ color: theme.texte, fontSize: 13, fontWeight: actif ? '700' : '500', ...police(theme.policeTexte) }}>{libelle}</Text>
    </Pressable>
  );
}

export function PastilleType({ theme, type }: { theme: ThemeHub; type: string }) {
  const t = typeEvenement(type);
  return (
    <View style={[styles.pastille, { borderColor: t.couleur, backgroundColor: teinteTransparente(t.couleur, 0.16), borderRadius: 999 }]}>
      <View style={[styles.point, { backgroundColor: t.couleur }]} />
      <Text style={{ color: theme.texte, fontSize: 11, fontWeight: '700', ...police(theme.policeTexte) }}>{t.nom}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ RSVP rapide

const CHOIX_RSVP: Array<{ cle: Exclude<Rsvp, 'sans_reponse'>; libelle: string; genre: 'ok' | 'alerte' | 'critique' }> = [
  { cle: 'oui', get libelle() {
      return tr('objectifs.oui');
    }, genre: 'ok' },
  { cle: 'peut_etre', get libelle() {
      return tr('planning.libelles.peut_etre');
    }, genre: 'alerte' },
  { cle: 'non', get libelle() {
      return tr('planning.libelles.non');
    }, genre: 'critique' },
];

/** Trois gros boutons (44 px au moins) : un appui suffit, la réponse s'affiche aussitôt. */
export function BoutonsRsvp({
  theme,
  valeur,
  onRepondre,
  testID,
  desactive,
}: {
  theme: ThemeHub;
  valeur: Rsvp | null | undefined;
  onRepondre(r: Exclude<Rsvp, 'sans_reponse'>): Promise<unknown>;
  testID: string;
  desactive?: boolean;
}) {
  const [local, setLocal] = useState<Rsvp | null | undefined>(undefined);
  const [envoi, setEnvoi] = useState(false);
  const actuel = local ?? valeur;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={tr('planning.planning.serez_vous_la')} testID={testID}>
      {CHOIX_RSVP.map(c => {
        const couleur = theme[c.genre];
        const actif = actuel === c.cle;
        return (
          <Pressable
            key={c.cle}
            testID={`${testID}-${c.cle}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif, disabled: desactive || envoi }}
            accessibilityLabel={tr('planning.commun.reponse', { libelle: c.libelle })}
            disabled={desactive || envoi}
            onPress={async () => {
              const avant = actuel;
              setLocal(c.cle);
              setEnvoi(true);
              try {
                await onRepondre(c.cle);
              } catch {
                setLocal(avant ?? null);
              } finally {
                setEnvoi(false);
              }
            }}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: actif ? 2 : 1,
              borderColor: actif ? couleur : theme.ligne,
              backgroundColor: actif ? teinteTransparente(couleur, 0.22) : theme.surface,
              borderRadius: Math.min(theme.rayonMoyen, 12),
              opacity: desactive ? 0.5 : 1,
            }}>
            <Text style={{ color: theme.texte, fontSize: 15, fontWeight: actif ? '800' : '600', ...police(theme.policeTexte) }}>
              {actif ? '✓ ' : ''}
              {c.libelle}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ Carte d'une occurrence

export function CarteOccurrence({
  theme,
  o,
  onOuvrir,
  onRepondre,
  avecDate = true,
  testID,
  extra,
}: {
  theme: ThemeHub;
  o: Occurrence;
  onOuvrir?(): void;
  onRepondre?(r: Exclude<Rsvp, 'sans_reponse'>): Promise<unknown>;
  avecDate?: boolean;
  testID?: string;
  extra?: React.ReactNode;
}) {
  const t = typeEvenement(o.type);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View
      testID={testID}
      style={{
        borderWidth: 1,
        borderColor: theme.ligne,
        borderLeftWidth: 4,
        borderLeftColor: t.couleur,
        backgroundColor: theme.surface,
        borderRadius: Math.min(theme.rayonMoyen, 12),
        padding: 12,
        gap: 8,
      }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('resumes.ouvrir', { titre: o.titre })} onPress={onOuvrir} disabled={!onOuvrir} style={{ gap: 4 }} testID={testID ? `${testID}-ouvrir` : undefined}>
        <View style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
          <Text style={{ flex: 1, color: theme.texte, fontSize: 15, fontWeight: '700', ...police(theme.policeTexte) }} numberOfLines={2}>
            {o.titre}
          </Text>
          <PastilleType theme={theme} type={o.type} />
        </View>
        <Text style={attenue}>
          {avecDate ? `${dateCourteJour(o.jour)} · ` : ''}
          {o.heureDebut}–{o.heureFin}
          {o.jourFin !== o.jour ? tr('planning.planning.lendemain') : ''}
          {o.lieu ? ` · ${o.lieu}` : ''}
          {o.recurrent ? ' · ↻' : ''}
          {o.modifiee ? tr('planning.commun.modifie') : ''}
        </Text>
        {o.reponses ? (
          <Text style={attenue}>
            {tr('planning.commun.oui_peut_etre_non', { oui: o.reponses.oui, peut_etre: o.reponses.peut_etre, non: o.reponses.non })}</Text>
        ) : null}
      </Pressable>
      {onRepondre && !o.termine && o.concerneMoi !== false && o.monRsvp !== null && o.monRsvp !== undefined ? (
        <BoutonsRsvp theme={theme} valeur={o.monRsvp} onRepondre={onRepondre} testID={testID ? `${testID}-rsvp` : 'esport-rsvp'} />
      ) : null}
      {extra}
    </View>
  );
}

// ------------------------------------------------------------------ Convoqués (formulaire)

/**
 * Sélecteur « Convoqués » : raccourcis (Joueurs, Staff, Tout le monde), choix
 * personne par personne, et liste à part « Propriétaires à convoquer » (un
 * Propriétaire n'est jamais convoqué sans être coché). Aucun choix : les joueurs.
 */
export function SelecteurConvocation({
  theme,
  membres,
  valeur,
  onChange,
  testID = 'esport-convocation',
}: {
  theme: ThemeHub;
  membres: readonly MembreConvocable[];
  valeur: Convocation;
  onChange(c: Convocation): void;
  testID?: string;
}) {
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const titre = { color: theme.texte, fontWeight: '600' as const, fontSize: 13, ...police(theme.policeTexte) };
  // Les cases montrent la saisie telle quelle ; sans aucun choix, le résumé annonce le défaut (les joueurs).
  const vide = convocationVide(valeur);
  const affiche = valeur;
  const personnes = membres.filter(m => m.groupe !== 'proprietaire');
  const proprietaires = membres.filter(m => m.groupe === 'proprietaire');
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <Text style={titre}>{tr('planning.commun.convoques')}</Text>
      <View style={styles.ligne} accessibilityLabel={tr('planning.commun.raccourcis_de_convocation')}>
        {GROUPES.map(g => (
          <Pastille
            key={g.cle}
            theme={theme}
            actif={groupeActif(affiche, g.cle)}
            libelle={g.nom}
            role="checkbox"
            onPress={() => onChange(basculerGroupe(affiche, g.cle))}
            testID={`${testID}-groupe-${g.cle}`}
          />
        ))}
      </View>
      {personnes.length ? (
        <View style={styles.ligne} accessibilityLabel={tr('planning.commun.convoques_personne_par_personn')}>
          {personnes.map(m => (
            <Pastille key={m.compte} theme={theme} actif={estConvoque(affiche, m)} libelle={m.pseudo} role="checkbox" onPress={() => onChange(basculerMembre(affiche, m))} testID={`${testID}-membre-${m.compte}`} />
          ))}
        </View>
      ) : null}
      {proprietaires.length ? (
        <View style={{ gap: 6 }}>
          <Text style={titre}>{tr('planning.commun.proprietaires_a_convoquer')}</Text>
          <View style={styles.ligne} accessibilityLabel={tr('planning.commun.proprietaires_a_convoquer')}>
            {proprietaires.map(m => (
              <Pastille
                key={m.compte}
                theme={theme}
                actif={valeur.proprietaires.includes(m.compte) || valeur.membres.includes(m.compte)}
                libelle={m.pseudo}
                role="checkbox"
                onPress={() => onChange(basculerProprietaire(valeur, m.compte))}
                testID={`${testID}-proprietaire-${m.compte}`}
              />
            ))}
          </View>
          <Text style={attenue}>{tr('planning.commun.un_proprietaire_n_est')}</Text>
        </View>
      ) : null}
      <Text style={attenue} testID={`${testID}-resume`}>
        {vide ? tr('planning.commun.aucun_choix_les_joueurs') : ''}
        {resumeConvocation(valeur, membres)}
      </Text>
    </View>
  );
}

/**
 * Choix des personnes et des rôles qui voient un élément restreint, chacun « Aucun », « Peut voir » ou « Peut modifier »,
 * et « Qui voit aujourd'hui ». Partagé par « Accès au tableau » (migration 0046, AccesTableau.tsx) et « Qui voit la
 * ressource » de DATA › Ressources (migration 0048, liens/AccesRessource.tsx). Composant contrôlé : l'appelant garde
 * les niveaux et enregistre ; le serveur décide de tout.
 *
 * Téléphone : chaque ligne passe sur deux rangées (nom, puis le choix du niveau) : rien ne déborde.
 */

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Segments } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { GenreAcces, NiveauAcces, RegleAcces, RoleProposeAcces } from '../../cm/api';
import { trCm } from '../../i18n/cm';
import { styles } from '../commun';
import { Badge, ESP, texte } from '../design';

type Choix = NiveauAcces | 'sans';
const SANS = 'sans' as const;
export const cleAcces = (genre: GenreAcces, cible: string) => `${genre}|${cible}`;

export interface OptionsAcces {
  personnes: Array<{ compte: string; pseudo: string }>;
  rolesCm: RoleProposeAcces[];
  rolesClub: RoleProposeAcces[];
  rolesTeam: RoleProposeAcces[];
}

/** Niveaux (`Map<cle, niveau>`) → règles à envoyer au serveur. */
export function reglesDe(niveaux: Map<string, NiveauAcces>): RegleAcces[] {
  return [...niveaux].map(([k, niveau]) => {
    const [genre, ...reste] = k.split('|');
    return { genre: genre as GenreAcces, cible: reste.join('|'), niveau };
  });
}
export const niveauxDe = (regles: RegleAcces[]) => new Map(regles.map(x => [cleAcces(x.genre, x.cible), x.niveau]));

export function ChoixAcces({
  theme,
  options: o,
  niveaux,
  onChanger,
  exclus = ['principal'],
  testID,
}: {
  theme: ThemeHub;
  options: OptionsAcces;
  niveaux: Map<string, NiveauAcces>;
  onChanger(n: Map<string, NiveauAcces>): void;
  /** Comptes jamais proposés (le Fondateur voit toujours tout ; le créateur d'une ressource aussi). */
  exclus?: string[];
  testID: string;
}) {
  const lignes = useMemo(
    () =>
      [
        { genre: 'compte' as const, titre: trCm('acces.personnes'), items: o.personnes.filter(p => !exclus.includes(p.compte)).map(p => ({ id: p.compte, nom: p.pseudo })) },
        { genre: 'role_cm' as const, titre: trCm('acces.roles_cm'), items: o.rolesCm.map(r => ({ id: r.id, nom: r.nom })) },
        { genre: 'role_club' as const, titre: trCm('acces.roles_club'), items: o.rolesClub.map(r => ({ id: r.id, nom: r.nom })) },
        { genre: 'role_team' as const, titre: trCm('acces.roles_team'), items: o.rolesTeam.map(r => ({ id: r.id, nom: r.team?.nom ? `${r.nom} · ${r.team.nom}` : r.nom })) },
      ].filter(g => g.items.length),
    [o, exclus],
  );
  const choisir = (genre: GenreAcces, cible: string, v: Choix) => {
    const n = new Map(niveaux);
    if (v === SANS) n.delete(cleAcces(genre, cible));
    else n.set(cleAcces(genre, cible), v);
    onChanger(n);
  };
  const choix: ReadonlyArray<readonly [Choix, string]> = [
    [SANS, trCm('acces.aucun')],
    ['voir', trCm('acces.niveau.voir')],
    ['modifier', trCm('acces.niveau.modifier')],
  ];
  return (
    <>
      {lignes.map(g => (
        <View key={g.genre} style={{ gap: ESP.xs }} testID={`${testID}-${g.genre}`}>
          <Text style={{ ...texte(theme, 14), fontWeight: '800' }} accessibilityRole="header">
            {g.titre}
          </Text>
          {g.items.map(x => (
            <View key={x.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'wrap', justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme, 14), flexShrink: 1, minWidth: 120 }} numberOfLines={2}>
                {x.nom}
              </Text>
              <Segments<Choix> theme={theme} libelle={trCm('acces.niveau_de', { nom: x.nom })} valeur={niveaux.get(cleAcces(g.genre, x.id)) ?? SANS} options={choix} onChoisir={v => choisir(g.genre, x.id, v)} testID={`${testID}-${g.genre}-${x.id}`} />
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

/** « Qui voit aujourd'hui » : une pastille par personne (icône monochrome du niveau). */
export function EffectifsAcces({ theme, titre, effectifs, testID }: { theme: ThemeHub; titre: string; effectifs: Array<{ compte: string; pseudo: string; niveau: NiveauAcces }>; testID: string }) {
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Text style={{ ...texte(theme, 14), fontWeight: '800' }}>{titre}</Text>
      <View style={[styles.ligne, { gap: ESP.xs, flexWrap: 'wrap' }]}>
        {effectifs.map(p => (
          <Badge key={p.compte} theme={theme} icone={p.niveau === 'modifier' ? 'crayon' : 'oeil'} texte={`${p.pseudo} · ${p.niveau === 'modifier' ? trCm('acces.niveau.modifier') : trCm('acces.niveau.voir')}`} />
        ))}
      </View>
    </View>
  );
}

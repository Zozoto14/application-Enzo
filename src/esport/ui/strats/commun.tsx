/**
 * Briques communes des écrans Strats et Playbook : assets (chargés une fois),
 * miniature avec repli, choix avec « tous », mention Riot, et le passage
 * d'une strat à ouvrir du Playbook vers l'éditeur.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { MENTION_RIOT, assetsRepli, chargerAssets, initiales, type Assets, type FetchAssets, type StockageAssets } from '../../strats/assets';
import { styles } from '../commun';
import { tr } from '../../i18n';
import type { ClientEsport, DetailTeam } from '../../client';
import type { ProfilJeu } from '../../jeux/api';
import { assetsDepuisProfil, estValorant, profilDeTeam } from '../../jeux/profil';

// ------------------------------------------------------------------ Assets (une fois par session)

let assetsEnCours: Promise<Assets> | undefined;

function stockageWeb(): StockageAssets | undefined {
  const ls = (globalThis as { localStorage?: { getItem(c: string): string | null; setItem(c: string, v: string): void } }).localStorage;
  if (!ls) return undefined;
  return { lire: c => ls.getItem(c), ecrire: (c, v) => ls.setItem(c, v) };
}

/** Charge les assets de Valorant (API, cache local ou repli générique), partagés par tous les écrans. */
export function obtenirAssets(): Promise<Assets> {
  if (!assetsEnCours) {
    const f = (globalThis as { fetch?: FetchAssets }).fetch;
    const web = typeof (globalThis as { document?: unknown }).document !== 'undefined';
    assetsEnCours = chargerAssets({ fetch: f ? (u, i) => f(u, i) : undefined, stockage: stockageWeb(), manifeste: web ? undefined : null }).catch(() => assetsRepli());
  }
  return assetsEnCours;
}

/** Pour les tests : assets imposés (aucun réseau), ou oubliés (`undefined`). */
export function fournirAssets(a: Assets | undefined): void {
  assetsEnCours = a ? Promise.resolve(a) : undefined;
}

/** Assets Riot (Valorant). `actif` faux : rien n'est chargé (jeu d'une team qui n'est pas Valorant). */
export function useAssets(actif = true): Assets | undefined {
  const [assets, setAssets] = useState<Assets | undefined>();
  useEffect(() => {
    if (!actif) return undefined;
    let vivant = true;
    obtenirAssets().then(a => {
      if (vivant) setAssets(a);
    });
    return () => {
      vivant = false;
    };
  }, [actif]);
  return assets;
}

/** Profil du jeu de la team (undefined : en cours ; null : le serveur ne le donne pas). */
export function useProfilJeuTeam(client: ClientEsport, teamId: string): ProfilJeu | null | undefined {
  const [profil, setProfil] = useState<ProfilJeu | null | undefined>();
  useEffect(() => {
    let vivant = true;
    setProfil(undefined);
    profilDeTeam(client, teamId).then(p => {
      if (vivant) setProfil(p);
    });
    return () => {
      vivant = false;
    };
  }, [client, teamId]);
  return profil;
}

/**
 * Maps et personnages des modules de la team (Strats, Playbook, Ressources) : ceux du PROFIL DE JEU de la
 * team, avec les images Riot pour Valorant. Serveur sans profils de jeu : les assets Riot comme avant.
 */
export function useAssetsTeam(client: ClientEsport, team: DetailTeam['team'] | string): Assets | undefined {
  const teamId = typeof team === 'string' ? team : team.id;
  const jeuTeam = typeof team === 'string' ? undefined : team.jeu;
  const profil = useProfilJeuTeam(client, teamId);
  // Sans profil lisible (serveur ancien, réseau) : les assets Riot comme avant, sauf pour une team d'un autre jeu.
  const sansProfilRiot = jeuTeam === undefined || jeuTeam === 'valorant' || jeuTeam === 'autre';
  const valorant = profil ? estValorant(profil) : profil === null ? sansProfilRiot : jeuTeam === 'valorant';
  const riot = useAssets(valorant);
  return useMemo(() => {
    if (profil === undefined) return undefined;
    if (profil === null) return sansProfilRiot ? riot : { jeu: jeuTeam ?? 'autre', source: 'profil', cartes: [], agents: [], majLe: 0 };
    if (valorant && !riot) return undefined;
    return assetsDepuisProfil(profil, riot);
  }, [profil, riot, valorant, sansProfilRiot, jeuTeam]);
}

// ------------------------------------------------------------------ Navigation Playbook → éditeur

let stratDemandee: string | undefined;
/** Le Playbook demande l'ouverture d'une strat avant d'aller à l'onglet Strats. */
export function demanderStrat(id: string): void {
  stratDemandee = id;
}
export function prendreStratDemandee(): string | undefined {
  const id = stratDemandee;
  stratDemandee = undefined;
  return id;
}

// ------------------------------------------------------------------ Affichage

/** Miniature d'une strat (lien signé) ; repli : carte et initiales sur un fond neutre. */
export function Miniature({ theme, url, carte, taille = 160, testID }: { theme: ThemeHub; url?: string | null; carte?: string | null; taille?: number; testID?: string }) {
  const [echec, setEchec] = useState(false);
  const fond = { width: '100%' as const, aspectRatio: 1, maxWidth: taille * 2, borderRadius: Math.min(theme.rayonMoyen, 10), overflow: 'hidden' as const, backgroundColor: teinteTransparente(theme.attenue, 0.18) };
  if (url && !echec) {
    return (
      <View style={fond}>
        <Image testID={testID} source={{ uri: url }} accessibilityLabel={carte ? tr('strats.commun.miniature_2', { carte }) : tr('strats.commun.miniature')} onError={() => setEchec(true)} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      </View>
    );
  }
  return (
    <View testID={testID ? `${testID}-repli` : undefined} style={[fond, { alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: theme.attenue, fontSize: 28, fontWeight: '800', ...police(theme.policeTitre) }}>{initiales(carte ?? '?')}</Text>
      {carte ? <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>{carte}</Text> : null}
    </View>
  );
}

/** Pastilles de filtre avec une option « Tous » (valeur vide). */
export function Filtre<T extends string>({
  theme,
  libelle,
  valeur,
  options,
  onChoisir,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: T | '';
  options: ReadonlyArray<readonly [T | '', string]>;
  onChoisir(v: T | ''): void;
  testID: string;
}) {
  return (
    <View style={[styles.ligne, { gap: 6 }]} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
      <Text style={{ color: theme.attenue, fontSize: 13, fontWeight: '600', minWidth: 44, ...police(theme.policeTexte) }}>{libelle}</Text>
      {options.map(([cle, nom]) => {
        const actif = cle === valeur;
        return (
          <Pressable
            key={cle || '*'}
            testID={`${testID}-${cle || 'defaut'}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: actif }}
            accessibilityLabel={`${libelle} : ${nom}`}
            onPress={() => onChoisir(cle)}
            style={{
              borderWidth: 1,
              borderColor: actif ? theme.accent : theme.ligne,
              backgroundColor: actif ? teinteTransparente(theme.accent, 0.2) : 'transparent',
              borderRadius: theme.rayonGrand ? 999 : 6,
              paddingHorizontal: 12,
              paddingVertical: 6,
              // Cible tactile de 44 px (iPhone, iPad).
              minHeight: 44,
              justifyContent: 'center',
            }}>
            <Text style={{ color: theme.texte, fontSize: 14, fontWeight: actif ? '700' : '500', ...police(theme.policeTexte) }}>{nom}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Etiquette({ theme, texte, couleur }: { theme: ThemeHub; texte: string; couleur?: string }) {
  const c = couleur ?? theme.attenue;
  return (
    <View style={{ borderWidth: 1, borderColor: c, backgroundColor: teinteTransparente(c, 0.14), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color: theme.texte, fontSize: 11, fontWeight: '600', ...police(theme.policeTexte) }}>{texte}</Text>
    </View>
  );
}

/** Mention obligatoire de la politique Riot « Legal Jibber Jabber ». */
/** Mention imposée par la politique Riot : seulement quand des assets Riot sont affichés (Valorant). */
export function MentionRiot({ theme, jeu }: { theme: ThemeHub; jeu?: string }) {
  if (jeu !== undefined && jeu !== 'valorant') return null;
  return (
    <Text testID="esport-mention-riot" style={{ color: theme.attenue, fontSize: 11, ...police(theme.policeTexte) }}>
      {MENTION_RIOT}
    </Text>
  );
}

/**
 * Briques communes des écrans Tournois et Résultats : logo d'adversaire, badge d'issue, sélecteur
 * d'adversaires (fiches du scouting, création rapide, nom libre), pastilles de choix multiple.
 */

import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { Adversaire, Issue } from '../../competition/api';
import { nomIssue, ordinal, tonIssue } from '../../competition/libelles';
import { trC } from '../../i18n/competition';
import { Badge, ESP, attenue, texte, type EtatPresse } from '../design';
import { styles } from '../commun';

export function LogoAdversaire({ theme, nom, url, taille = 32 }: { theme: ThemeHub; nom: string; url?: string | null; taille?: number }) {
  const [casse, setCasse] = useState(false);
  if (url && !casse) {
    return <Image source={{ uri: url }} accessibilityLabel={trC('c.logo_de', { nom })} onError={() => setCasse(true)} style={{ width: taille, height: taille, borderRadius: 6, backgroundColor: theme.fond }} resizeMode="contain" />;
  }
  return (
    <View accessibilityLabel={trC('c.logo_de', { nom })} style={{ width: taille, height: taille, borderRadius: 6, backgroundColor: theme.ligne, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.texte, fontWeight: '800', fontSize: taille / 2.6 }}>{nom.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

/** Badge d'un résultat : « Victoire 2-1 », « Défaite », « 3e ». */
export function BadgeResultat({ theme, issue, place, score, testID }: { theme: ThemeHub; issue: Issue | null; place?: number | null; score?: string; testID?: string }) {
  if (issue) return <Badge theme={theme} ton={tonIssue(issue)} texte={`${nomIssue(issue)}${score ? ` ${score}` : ''}`} testID={testID} />;
  if (place) return <Badge theme={theme} ton={place <= 3 ? 'ok' : 'neutre'} texte={trC('c.place_badge', { place: ordinal(place, true) })} testID={testID} />;
  return <Badge theme={theme} texte={trC('c.a_jouer')} testID={testID} />;
}

export const nomsAdversaires = (a: Adversaire[]): string => a.map(x => x.nom).join(', ');

/** Pastille sélectionnable (choix multiple : joueurs, personnages, adversaires). */
export function Pastille({ theme, libelle, actif, onPress, testID, couleur }: { theme: ThemeHub; libelle: string; actif: boolean; onPress(): void; testID?: string; couleur?: string }) {
  const c = couleur ?? theme.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: actif }}
      accessibilityLabel={libelle}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: ESP.s,
        borderRadius: theme.rayonGrand ? 999 : 6,
        borderWidth: 1,
        borderColor: actif || etat.hovered ? c : theme.ligne,
        backgroundColor: actif ? teinteTransparente(c, 0.18) : theme.surface,
      })}>
      <Text style={{ ...texte(theme, 13), fontWeight: actif ? '700' : '500' }}>{libelle}</Text>
    </Pressable>
  );
}

/**
 * Sélecteur d'adversaires : fiches du scouting (pastilles), création rapide d'une fiche (nom), ou équipe
 * sans fiche (nom libre, pour une manche à plusieurs équipes). `max` : 1 pour un match à deux équipes.
 */
export function ChoixAdversaires({
  theme,
  fiches,
  valeur,
  max,
  onChanger,
  onCreer,
  testID,
}: {
  theme: ThemeHub;
  fiches: Array<{ id: string; nom: string }>;
  valeur: Array<{ id?: string; nom?: string }>;
  max: number;
  onChanger(v: Array<{ id?: string; nom?: string }>): void;
  /** Création rapide d'une fiche (droit requis) ; sans elle, on ajoute un nom libre. */
  onCreer?(nom: string): Promise<{ id: string; nom: string }>;
  testID: string;
}) {
  const [nom, setNom] = useState('');
  const choisi = (id: string) => valeur.some(v => v.id === id);
  const basculer = (f: { id: string; nom: string }) => {
    if (choisi(f.id)) onChanger(valeur.filter(v => v.id !== f.id));
    else onChanger(max === 1 ? [{ id: f.id }] : [...valeur, { id: f.id }].slice(0, max));
  };
  const libres = valeur.filter(v => !v.id && v.nom);
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{max === 1 ? trC('c.adversaire') : trC('c.adversaires_max', { n: max })}</Text>
      {fiches.length ? (
        <View style={[styles.ligne, { gap: ESP.xxs }]}>
          {fiches.map(f => (
            <Pastille key={f.id} theme={theme} libelle={f.nom} actif={choisi(f.id)} onPress={() => basculer(f)} testID={`${testID}-${f.id}`} />
          ))}
        </View>
      ) : (
        <Text style={attenue(theme)}>{trC('c.aucune_fiche')}</Text>
      )}
      {libres.length ? (
        <View style={[styles.ligne, { gap: ESP.xxs }]}>
          {libres.map(v => (
            <Pastille key={v.nom} theme={theme} libelle={`${v.nom} ×`} actif onPress={() => onChanger(valeur.filter(x => x !== v))} testID={`${testID}-libre-${v.nom}`} />
          ))}
        </View>
      ) : null}
      <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={onCreer ? trC('c.nouvel_adversaire') : trC('c.equipe_sans_fiche')} valeur={nom} onChanger={setNom} maxLength={60} testID={`${testID}-nom`} style={{ flexGrow: 1, flexBasis: 200 }} />
        <BoutonHub
          theme={theme}
          titre={onCreer ? trC('c.creer_fiche') : trC('c.ajouter')}
          desactive={nom.trim().length < 2 || valeur.length >= max}
          onPress={() => {
            const n = nom.trim();
            if (!onCreer) {
              onChanger([...valeur, { nom: n }].slice(0, max));
              setNom('');
              return;
            }
            void onCreer(n).then(f => {
              onChanger(max === 1 ? [{ id: f.id }] : [...valeur.filter(v => v.id !== f.id), { id: f.id }].slice(0, max));
              setNom('');
            });
          }}
          testID={`${testID}-creer`}
        />
      </View>
    </View>
  );
}

/** Ligne « libellé : valeur » d'une fiche. */
export function Info({ theme, libelle, valeur, testID }: { theme: ThemeHub; libelle: string; valeur: string; testID?: string }) {
  if (!valeur) return null;
  return (
    <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }} testID={testID}>
      <Text style={attenue(theme, 13)}>{libelle}</Text>
      <Text style={{ ...texte(theme, 14), fontWeight: '600', flexShrink: 1 }}>{valeur}</Text>
    </View>
  );
}

/** Montant en centimes → texte localisé (« 1 500,00 € »). */
export function montant(centimes: number | null | undefined, devise: string, locale: string): string {
  if (centimes === null || centimes === undefined) return '';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: devise }).format(centimes / 100);
  } catch {
    return `${(centimes / 100).toFixed(2)} ${devise}`;
  }
}

/** Instant ISO → date et heure murales dans le fuseau de la team (« 2026-10-24 », « 20:00 »). */
export function murale(iso: string | null | undefined, fuseau: string): { date: string; heure: string } {
  if (!iso) return { date: '', heure: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', heure: '' };
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
  } catch {
    return { date: iso.slice(0, 10), heure: iso.slice(11, 16) };
  }
}

/** « AAAA-MM-JJ HH:MM » (heure murale de la team) ou vide. */
export const instantSaisi = (date: string, heure: string): string | null => (date.trim() ? `${date.trim()} ${heure.trim() || '20:00'}` : null);

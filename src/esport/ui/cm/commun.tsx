/**
 * Briques communes des écrans de la section CM : statut d'un post, pastilles de réseau, copie d'un texte,
 * saisie d'une date et d'une heure, rafraîchissement léger (versions des tableaux), libellés traduits des
 * tableaux et listes par défaut.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Champ } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ApiCm, CleListe, EtatCm, GenreDepot, Reseau, StatutClip, StatutPost } from '../../cm/api';
import { RESEAUX } from '../../cm/reseaux';
import { formaterDate } from '../../i18n';
import { trCm, type CleCm } from '../../i18n/cm';
import { Badge, ESP, rayonControle, texte, type EtatPresse, type Ton } from '../design';
import { SECOURS_MS, useTempsReel } from '../../tempsReel/hooks';
import { Glyphe } from '../../../ui/icones';

export const FUSEAU_CLUB = 'Europe/Paris';
/** Intervalle du rafraîchissement léger (GET /cm/etat : quelques octets). */
export const RAFRAICHISSEMENT_MS = 12_000;

export const TON_STATUT: Record<StatutPost, Ton> = { brouillon: 'neutre', a_valider: 'alerte', valide: 'ok', refuse: 'critique', publie: 'accent' };
export const TON_CLIP: Record<StatutClip, Ton> = { propose: 'alerte', retenu: 'ok', refuse: 'critique', utilise: 'accent' };

export const nomStatut = (s: StatutPost): string => trCm(`statut.${s}` as CleCm);
export const nomStatutClip = (s: StatutClip): string => trCm(`clip.statut.${s}` as CleCm);
export const nomGenreDepot = (g: GenreDepot): string => trCm(`depot.genre.${g}` as CleCm);
/** Nom d'un tableau : le tableau par défaut est traduit tant qu'il n'est pas renommé. */
export const nomTableau = (t: { nom: string | null; cleDefaut?: string | null }): string => t.nom ?? (t.cleDefaut ? trCm('tableau.contenus') : '—');
/** Nom d'une liste : les listes du tableau par défaut sont traduites tant qu'elles ne sont pas renommées. */
export const nomListe = (l: { nom: string | null; cle?: CleListe | null }): string => l.nom ?? (l.cle ? trCm(`liste.${l.cle}` as CleCm) : '—');

export function BadgeStatut({ theme, statut, testID }: { theme: ThemeHub; statut: StatutPost | null; testID?: string }) {
  if (!statut) return null;
  return <Badge theme={theme} ton={TON_STATUT[statut]} texte={nomStatut(statut)} testID={testID} />;
}

/** Pastille d'un réseau (glyphe et nom), cochable si `onPress`. */
export function PastilleReseau({ theme, reseau, actif = true, onPress, testID, compact }: { theme: ThemeHub; reseau: Reseau; actif?: boolean; onPress?(): void; testID?: string; compact?: boolean }) {
  const r = RESEAUX[reseau];
  const contenu = (
    <>
      <Glyphe valeur={r.glyphe} style={{ fontSize: compact ? 12 : 14, color: theme.texte }} />
      {compact ? null : <Text style={{ ...texte(theme, 13), fontWeight: actif ? '700' : '500' }}>{r.nom}</Text>}
    </>
  );
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderWidth: 1,
    borderColor: actif ? theme.accent : theme.ligne,
    backgroundColor: actif ? teinteTransparente(theme.accent, 0.14) : 'transparent',
    borderRadius: rayonControle(theme) === 999 ? 999 : 8,
    paddingHorizontal: compact ? 6 : 10,
    minHeight: compact ? 22 : 44,
    justifyContent: 'center' as const,
  };
  if (!onPress) {
    return (
      <View style={style} testID={testID} accessibilityLabel={r.nom}>
        {contenu}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: actif }} accessibilityLabel={r.nom} onPress={onPress} style={(e: EtatPresse) => [style, (e.hovered || e.focused) && { borderColor: theme.accent }]}>
      {contenu}
    </Pressable>
  );
}

/** Copie un texte dans le presse-papiers (site et PC) ; rend faux si l'appareil ne le permet pas. */
export async function copierTexte(t: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(x: string): Promise<void> } } }).navigator?.clipboard;
  if (!presse) return false;
  try {
    await presse.writeText(t);
    return true;
  } catch {
    return false;
  }
}

/** Parties murales (date AAAA-MM-JJ, heure HH:MM) d'un instant ISO dans un fuseau. */
export function murale(isoTexte: string | null | undefined, fuseau: string): { date: string; heure: string } {
  if (!isoTexte) return { date: '', heure: '' };
  const d = new Date(isoTexte);
  if (Number.isNaN(d.getTime())) return { date: '', heure: '' };
  const parties = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t: string) => parties.find(p => p.type === t)?.value ?? '';
  return { date: `${v('year')}-${v('month')}-${v('day')}`, heure: `${v('hour')}:${v('minute')}` };
}

/** Date et heure lisibles d'un instant (« mar. 3 nov. 18:00 »), dans le fuseau donné. */
export const quand = (isoTexte: string | null | undefined, fuseau: string = FUSEAU_CLUB): string =>
  isoTexte ? formaterDate(isoTexte, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: fuseau }) : '';

/** Saisie d'un instant : date (AAAA-MM-JJ) et heure (HH:MM), envoyés « AAAA-MM-JJ HH:MM » (heure du fuseau). */
export function ChampInstant({
  theme,
  libelle,
  valeur,
  fuseau,
  onChanger,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string | null;
  fuseau: string;
  onChanger(v: string | null): void;
  testID: string;
}) {
  const initial = murale(valeur, fuseau);
  const [date, setDate] = useState(initial.date);
  const [heure, setHeure] = useState(initial.heure);
  // Valeur déjà émise par ce champ (« AAAA-MM-JJ HH:MM ») : on ne la relit pas (ce n'est pas un instant ISO).
  const emise = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (valeur === emise.current) return;
    const m = murale(valeur, fuseau);
    setDate(m.date);
    setHeure(m.heure);
  }, [valeur, fuseau]);
  const emettre = (v: string | null) => {
    emise.current = v;
    onChanger(v);
  };
  const transmettre = (d: string, h: string) => {
    if (!d.trim()) return emettre(null);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.trim()) && (!h.trim() || /^\d{2}:\d{2}$/.test(h.trim()))) emettre(`${d.trim()} ${h.trim() || '12:00'}`);
  };
  return (
    <View style={{ gap: ESP.xxs }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text>
      <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap' }}>
        <Champ
          theme={theme}
          libelle={trCm('c.date')}
          valeur={date}
          placeholder="2026-11-03"
          maxLength={10}
          onChanger={v => {
            setDate(v);
            transmettre(v, heure);
          }}
          testID={`${testID}-date`}
          style={{ minWidth: 130, flexGrow: 1 }}
        />
        <Champ
          theme={theme}
          libelle={trCm('c.heure')}
          valeur={heure}
          placeholder="18:00"
          maxLength={5}
          onChanger={v => {
            setHeure(v);
            transmettre(date, v);
          }}
          testID={`${testID}-heure`}
          style={{ minWidth: 90, flexGrow: 1 }}
        />
      </View>
    </View>
  );
}

/** Pastille de couleur choisissable (étiquettes, couverture). */
export function Teinte({ theme, couleur, choisie, onPress, libelle, testID }: { theme: ThemeHub; couleur: string; choisie: boolean; onPress(): void; libelle: string; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: choisie }}
      accessibilityLabel={libelle}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: couleur, borderWidth: choisie ? 3 : 1, borderColor: choisie ? theme.texte : theme.ligne }} />
    </Pressable>
  );
}

export const PALETTE: ReadonlyArray<readonly [string, CleCm]> = [
  ['#4bce97', 'couleur.vert'],
  ['#e2b203', 'couleur.jaune'],
  ['#faa53d', 'couleur.orange'],
  ['#f87462', 'couleur.rouge'],
  ['#9f8fef', 'couleur.violet'],
  ['#579dff', 'couleur.bleu'],
  ['#6cc3e0', 'couleur.ciel'],
  ['#94c748', 'couleur.citron'],
  ['#e774bb', 'couleur.rose'],
  ['#8590a2', 'couleur.gris'],
];

/** La page est-elle visible (onglet du navigateur au premier plan) ? Toujours vrai hors web. */
const pageVisible = () => Platform.OS !== 'web' || (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState !== 'hidden';

const ecouteursEtat = new Set<() => void>();
/** Fait relire l'état de la section partout où il est affiché (pastilles de commentaires non lus après une ouverture, « Tout marquer comme lu »). */
export function signalerEtatCm(): void {
  for (const f of [...ecouteursEtat]) f();
}

/**
 * Rafraîchissement léger de la section : relit `GET /cm/etat` dès qu'un autre change quelque chose (temps
 * réel), sinon toutes les 60 s (12 s face à un serveur sans temps réel) quand la page est visible
 * (et tout de suite au retour sur l'onglet). Les écrans comparent la version d'un tableau à celle qu'ils ont
 * chargée et ne rechargent que s'il a changé. Une seule requête courte : compatible avec l'hébergement
 * mutualisé (pas de connexion ouverte en permanence).
 */
export function useEtatCm(api: ApiCm | undefined, actif = true): { etat: EtatCm | undefined; relire(): void } {
  const [etat, setEtat] = useState<EtatCm | undefined>();
  const enCours = useRef(false);
  const encore = useRef(false);
  const relire = useCallback(() => {
    if (!api || !pageVisible()) return;
    // Un changement arrivé pendant une lecture : une lecture de plus juste après (jamais perdu, jamais en double).
    if (enCours.current) {
      encore.current = true;
      return;
    }
    enCours.current = true;
    api
      .etat()
      .then(setEtat)
      .catch(() => undefined)
      .finally(() => {
        enCours.current = false;
        if (encore.current) {
          encore.current = false;
          relire();
        }
      });
  }, [api]);
  // Temps réel (docs/esport/temps-reel.md) : tout changement de la section CM fait relire l'état aussitôt ; la
  // relecture périodique ne sert plus que de secours (60 s hors direct ; 12 s face à un serveur sans temps réel).
  const direct = useTempsReel(api?.client, 'cm', relire, { actif: actif && Boolean(api) });
  useEffect(() => {
    if (!actif) return undefined;
    ecouteursEtat.add(relire);
    return () => {
      ecouteursEtat.delete(relire);
    };
  }, [actif, relire]);
  const pas = direct === 'direct' ? 0 : direct === 'indisponible' ? RAFRAICHISSEMENT_MS : SECOURS_MS;
  useEffect(() => {
    if (!actif) return undefined;
    relire();
    const minuterie = pas ? setInterval(relire, pas) : undefined;
    const doc = (globalThis as { document?: { addEventListener?(t: string, f: () => void): void; removeEventListener?(t: string, f: () => void): void } }).document;
    doc?.addEventListener?.('visibilitychange', relire);
    return () => {
      if (minuterie) clearInterval(minuterie);
      doc?.removeEventListener?.('visibilitychange', relire);
    };
  }, [actif, relire, pas]);
  return { etat, relire };
}

/** Petit texte d'aide atténué. */
export function Aide({ theme, children, testID }: { theme: ThemeHub; children: string; testID?: string }) {
  return (
    <Text testID={testID} style={{ color: theme.attenue, fontSize: 13, lineHeight: 18, ...police(theme.policeTexte) }}>
      {children}
    </Text>
  );
}

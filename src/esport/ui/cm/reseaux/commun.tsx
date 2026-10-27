/**
 * Page « Réseaux » de l'espace CM : petits éléments partagés (pastille de réseau, ligne d'interrupteur, formulaire
 * de relevé, formats de nombres dans la langue de l'app).
 */

import React from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { duree, nombreCompact, pourcentage, type EtatReseaux, type FiltresReseaux, type ReseauCompte, type TypeContenu } from '../../../cm/reseauxApi';
import { formaterDate, localeCourante } from '../../../i18n';
import { trRs, trnRs, type CleRs } from '../../../i18n/reseaux';
import { Choix, styles } from '../../commun';
import { ESP, attenue, texte } from '../../design';

export const nb = (n: number | null | undefined): string => nombreCompact(n, localeCourante());
export const pct = (n: number | null | undefined): string => pourcentage(n, localeCourante());
export const dureeTexte = duree;
export const nomType = (t: TypeContenu): string => trRs(`type.${t}` as CleRs);
export const jourCourt = (j: string): string => formaterDate(`${j}T12:00:00Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const jourLong = (j: string): string => formaterDate(`${j}T12:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Nom affiché d'un réseau (catalogue du serveur ; clé brute si inconnue). */
export function nomReseau(etat: EtatReseaux | undefined, cle: string): string {
  return etat?.reseaux.find(r => r.cle === cle)?.nom ?? cle;
}

/** Pastille d'un réseau (glyphe et nom), la couleur du réseau en filet : jamais la couleur seule. */
export function Pastille({ theme, etat, reseau, testID }: { theme: ThemeHub; etat?: EtatReseaux; reseau: ReseauCompte | string; testID?: string }) {
  const r = etat?.reseaux.find(x => x.cle === reseau);
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: teinteTransparente(r?.couleur ?? theme.accent, 0.6), borderRadius: 999, paddingHorizontal: 8, minHeight: 24, alignSelf: 'flex-start' }}>
      <Text style={{ color: theme.texte, fontSize: 12 }}>{r?.glyphe ?? '•'}</Text>
      <Text style={{ ...texte(theme, 12), fontWeight: '700' }}>{r?.nom ?? reseau}</Text>
    </View>
  );
}

/** Ligne « libellé — interrupteur ». */
export function LigneInterrupteur({ theme, libelle, valeur, onChanger, testID, desactive, aide }: { theme: ThemeHub; libelle: string; valeur: boolean; onChanger(v: boolean): void; testID: string; desactive?: boolean; aide?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={[styles.ligne, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
        <Text style={{ ...texte(theme, 14), flexShrink: 1 }}>{libelle}</Text>
        <Interrupteur theme={theme} libelle={libelle} valeur={valeur} onChanger={onChanger} testID={testID} desactive={desactive} />
      </View>
      {aide ? <Text style={attenue(theme)}>{aide}</Text> : null}
    </View>
  );
}

/**
 * Formulaire d'un relevé : date, puis un champ par métrique (texte libre : « 12,5 k », « 1 234 », « 0:45 » ;
 * le serveur valide). `champs` : clés API ; `libelle(champ)`.
 */
export function FormulaireReleve<C extends string>({
  theme,
  champs,
  libelle,
  valeurs,
  onChanger,
  onEnregistrer,
  testID,
  large,
  desactive,
}: {
  theme: ThemeHub;
  champs: readonly C[];
  libelle(c: C): string;
  valeurs: Partial<Record<C | 'jour', string>>;
  onChanger(v: Partial<Record<C | 'jour', string>>): void;
  onEnregistrer(): void;
  testID: string;
  large: boolean;
  desactive?: boolean;
}) {
  const largeur = large ? '31%' : '100%';
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      <Champ theme={theme} libelle={trRs('c.jour')} valeur={valeurs.jour ?? ''} onChanger={jour => onChanger({ ...valeurs, jour })} maxLength={10} placeholder="2026-10-27" testID={`${testID}-jour`} />
      <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-start' }]}>
        {champs.map(c => (
          <Champ key={c} theme={theme} libelle={libelle(c)} valeur={valeurs[c] ?? ''} onChanger={v => onChanger({ ...valeurs, [c]: v })} maxLength={16} testID={`${testID}-${c}`} style={{ width: largeur, minWidth: 140, flexGrow: 1 }} />
        ))}
      </View>
      <BoutonHub theme={theme} titre={trRs('c.enregistrer')} variante="plein" desactive={desactive || champs.every(c => !(valeurs[c] ?? '').trim())} onPress={onEnregistrer} testID={`${testID}-ok`} />
    </View>
  );
}

// ------------------------------------------------------------------ Filtres

const PERIODES = [7, 30, 90, 365] as const;

function jourIso(decalage: number): string {
  return new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);
}

/** Filtres des statistiques : période (7, 30, 90, 365 jours), réseau, team, type de contenu. */
export function Filtres({ theme, etat, filtres, onChanger, periode = true, testID }: { theme: ThemeHub; etat: EtatReseaux; filtres: FiltresReseaux & { jours?: number }; onChanger(f: FiltresReseaux & { jours?: number }): void; periode?: boolean; testID: string }) {
  const teams = etat.teams;
  return (
    <View style={{ gap: ESP.xs }} testID={testID}>
      {periode ? (
        <Choix
          theme={theme}
          libelle={trRs('c.periode')}
          valeur={String(filtres.jours ?? 30)}
          options={PERIODES.map(j => ({ id: String(j), nom: trnRs('tdb.jours_n', j) }))}
          onChoisir={j => onChanger({ ...filtres, jours: Number(j), du: jourIso(-(Number(j) - 1)), au: jourIso(0) })}
          testID={`${testID}-periode`}
        />
      ) : null}
      <Choix theme={theme} libelle={trRs('c.reseau')} valeur={filtres.reseau ?? 'tous'} options={[{ id: 'tous', nom: trRs('c.tous') }, ...etat.reseaux.map(r => ({ id: r.cle, nom: r.nom }))]} onChoisir={r => onChanger({ ...filtres, reseau: r === 'tous' ? undefined : (r as ReseauCompte) })} testID={`${testID}-reseau`} />
      {teams.length ? (
        <Choix
          theme={theme}
          libelle={trRs('c.team')}
          valeur={filtres.team ?? 'toutes'}
          options={[{ id: 'toutes', nom: trRs('c.toutes') }, ...(etat.droits.club ? [{ id: 'club', nom: trRs('c.club') }] : []), ...teams.map(t => ({ id: t.id, nom: t.nom }))]}
          onChoisir={t => onChanger({ ...filtres, team: t === 'toutes' ? undefined : t })}
          testID={`${testID}-team`}
        />
      ) : null}
      <Choix theme={theme} libelle={trRs('c.type')} valeur={filtres.type ?? 'tous'} options={[{ id: 'tous', nom: trRs('c.tous') }, ...etat.typesContenu.map(t => ({ id: t, nom: nomType(t) }))]} onChoisir={t => onChanger({ ...filtres, type: t === 'tous' ? undefined : (t as TypeContenu) })} testID={`${testID}-type`} />
    </View>
  );
}

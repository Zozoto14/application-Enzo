/**
 * Briques du Drive : nom traduit d'un dossier par défaut, libellés des genres, ligne d'infos d'un fichier,
 * vignette, barre d'espace utilisé, choix d'une destination (arbre des dossiers).
 */

import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import { GLYPHES_DRIVE, PORTEE_CLUB, dureeLisible, type ApiDrive, type CleDossier, type FichierDrive, type GenreDrive, type PorteeDrive, type QuotaDrive } from '../../../cm/drive';
import { tailleMedia } from '../../../medias/envoi';
import { langueCourante } from '../../../i18n';
import { trDr, type CleDr } from '../../../i18n/drive';
import { Choix, Retours, styles, useAgir } from '../../commun';
import { ESP, attenue, texte, type EtatPresse } from '../../design';

export const nomDossier = (d: { nom: string | null; cle: CleDossier | null }): string => d.nom ?? (d.cle ? trDr(`dossier.${d.cle}` as CleDr) : trDr('dossier.sans_nom'));
export const nomGenre = (g: GenreDrive | 'dossier'): string => trDr(`genre.${g}` as CleDr);
export const taille = (n: number): string => tailleMedia(n, langueCourante());
export const nomPortee = (p: { portee: string; team: { nom: string | null } | null }): string => (p.portee === PORTEE_CLUB ? trDr('portee.club') : (p.team?.nom ?? '—'));

/** « PNG · 1080×1350 · 2,1 Mo » */
export function infosFichier(f: FichierDrive): string {
  return [
    f.meta.nomFormat ?? nomGenre(f.genre),
    f.meta.largeur && f.meta.hauteur ? `${f.meta.largeur}×${f.meta.hauteur}` : '',
    f.meta.duree ? dureeLisible(f.meta.duree) : '',
    taille(f.taille),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Vignette d'un fichier (image légère) ou son glyphe. */
export function Vignette({ theme, f, cote = 96 }: { theme: ThemeHub; f: FichierDrive | null; cote?: number }) {
  const fond = { width: '100%' as const, height: cote, borderRadius: 10, backgroundColor: teinteTransparente(theme.accent, 0.08), alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const };
  // L'app native n'affiche pas un SVG dans <Image> : le glyphe suffit.
  if (f?.vignette && (f.meta.format !== 'svg' || Platform.OS === 'web')) {
    return (
      <View style={fond}>
        <Image source={{ uri: f.vignette }} resizeMode="contain" style={{ width: '100%', height: cote }} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View style={fond}>
      <Text style={{ fontSize: Math.round(cote / 2.6) }}>{GLYPHES_DRIVE[f ? f.genre : 'dossier']}</Text>
    </View>
  );
}

/** Espace utilisé du Drive (barre, alerte à 80 %). */
export function BarreQuota({ theme, quota, testID = 'esport-drive-quota' }: { theme: ThemeHub; quota: QuotaDrive; testID?: string }) {
  const p = Math.min(100, quota.pourcent);
  return (
    <View style={{ gap: 4, minWidth: 200, flexGrow: 1, maxWidth: 420 }} testID={testID}>
      <Text style={attenue(theme, 12)}>{`${trDr('quota.titre')} · ${trDr('quota.utilise', { u: taille(quota.utilise), l: taille(quota.limite), p: quota.pourcent })}`}</Text>
      <View accessibilityRole="progressbar" accessibilityLabel={trDr('quota.titre')} accessibilityValue={{ min: 0, max: 100, now: Math.round(p) }} style={{ height: 8, borderRadius: 999, backgroundColor: teinteTransparente(theme.accent, 0.16), overflow: 'hidden' }}>
        <View style={{ width: `${p}%`, height: '100%', backgroundColor: quota.alerte ? theme.alerte : theme.accent }} />
      </View>
      {quota.alerte ? <Text style={{ ...texte(theme, 12), color: theme.alerte }} testID={`${testID}-alerte`}>{trDr('quota.alerte', { p: quota.pourcent })}</Text> : null}
    </View>
  );
}

/**
 * Choix d'une destination : Drive (copie seulement, parmi ceux où l'on peut déposer), puis dossier dans l'arbre
 * (racine comprise). `exclure` : dossiers interdits (un dossier ne se range pas dans lui-même).
 */
export function ChoixDestination({
  theme,
  api,
  portees,
  porteeInitiale,
  changerPortee,
  exclure = [],
  titreBouton,
  onChoisir,
  testID = 'esport-drive-destination',
}: {
  theme: ThemeHub;
  api: ApiDrive;
  portees: PorteeDrive[];
  porteeInitiale: string;
  changerPortee: boolean;
  exclure?: string[];
  titreBouton: string;
  onChoisir(portee: string, dossierId: string | null): void;
  testID?: string;
}) {
  const [portee, setPortee] = useState(porteeInitiale);
  const [arbre, setArbre] = useState<Array<{ id: string; parentId: string | null; nom: string | null; cle: CleDossier | null; restreint: boolean }>>([]);
  const [choisi, setChoisi] = useState<string | null>(null);
  const { erreur, agir } = useAgir();
  useEffect(() => {
    setChoisi(null);
    void agir('', async () => setArbre((await api.arbre(portee)).dossiers));
  }, [agir, api, portee]);
  // Arbre aplati, profondeur d'abord ; les dossiers exclus (et leurs descendants) disparaissent.
  const lignes: Array<{ id: string | null; nom: string; niveau: number; restreint: boolean }> = [{ id: null, nom: trDr('racine'), niveau: 0, restreint: false }];
  const enfants = (parent: string | null, niveau: number) => {
    for (const d of arbre.filter(x => x.parentId === parent && !exclure.includes(x.id)).sort((a, b) => nomDossier(a).localeCompare(nomDossier(b)))) {
      lignes.push({ id: d.id, nom: nomDossier(d), niveau, restreint: d.restreint });
      if (niveau < 12) enfants(d.id, niveau + 1);
    }
  };
  enfants(null, 1);
  const deposables = portees.filter(p => p.droits.envoyer);
  return (
    <View style={{ gap: ESP.s }} testID={testID}>
      <Retours theme={theme} erreur={erreur} prefixe={testID} />
      {changerPortee && deposables.length > 1 ? (
        <Choix theme={theme} libelle={trDr('dialogue.destination_drive')} valeur={portee} options={deposables.map(p => ({ id: p.portee, nom: nomPortee(p) }))} onChoisir={setPortee} testID={`${testID}-portee`} />
      ) : null}
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trDr('dialogue.destination')}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={trDr('dialogue.destination')} style={{ gap: 2 }}>
        {lignes.map(l => {
          const actif = choisi === l.id;
          return (
            <Pressable
              key={l.id ?? 'racine'}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={l.nom}
              onPress={() => setChoisi(l.id)}
              testID={`${testID}-${l.id ?? 'racine'}`}
              style={(e: EtatPresse) => ({ minHeight: 40, justifyContent: 'center', paddingLeft: ESP.s + l.niveau * 16, borderRadius: 8, backgroundColor: actif ? teinteTransparente(theme.accent, 0.18) : e.hovered ? teinteTransparente(theme.accent, 0.08) : 'transparent' })}>
              <Text style={{ ...texte(theme, 14), fontWeight: actif ? '700' : '500' }} numberOfLines={1}>{`${l.id ? GLYPHES_DRIVE.dossier : '⌂'} ${l.nom}${l.restreint ? ' 🔒' : ''}`}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={titreBouton} variante="plein" onPress={() => onChoisir(portee, choisi)} testID={`${testID}-ok`} />
      </View>
    </View>
  );
}

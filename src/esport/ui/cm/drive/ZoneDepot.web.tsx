/**
 * Zone de dépôt du Drive sur le site et l'app PC : on y glisse des fichiers depuis l'ordinateur (plusieurs à la
 * fois). Un cadre en pointillés montre où lâcher. Les fichiers ne sont jamais lus en entier ici : ils partent
 * par morceaux (envoi.ts). Les dossiers glissés sont ignorés (seuls les fichiers comptent).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente } from '../../../../hub/themes';
import { depuisFile } from '../../../medias/choixFichier.web';
import { trDr } from '../../../i18n/drive';
import { ESP, texte } from '../../design';
import type { PropsZoneDepot } from './typesDrive';

export type { PropsZoneDepot } from './typesDrive';

export function ZoneDepot({ theme, actif, onFichiers, children, testID }: PropsZoneDepot) {
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [survol, setSurvol] = useState(false);
  const rappel = useRef(onFichiers);
  rappel.current = onFichiers;
  useEffect(() => {
    const noeud = ref.current as unknown as HTMLElement | null;
    if (!actif || !noeud?.addEventListener) return undefined;
    let profondeur = 0;
    const avecFichiers = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const entrer = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      profondeur++;
      setSurvol(true);
    };
    const dessus = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const sortir = () => {
      profondeur = Math.max(0, profondeur - 1);
      if (!profondeur) setSurvol(false);
    };
    const lacher = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      profondeur = 0;
      setSurvol(false);
      const fichiers = Array.from(e.dataTransfer?.files ?? []).filter(f => f.size > 0 || f.type);
      if (fichiers.length) rappel.current(fichiers.map(depuisFile));
    };
    noeud.addEventListener('dragenter', entrer);
    noeud.addEventListener('dragover', dessus);
    noeud.addEventListener('dragleave', sortir);
    noeud.addEventListener('drop', lacher);
    return () => {
      noeud.removeEventListener('dragenter', entrer);
      noeud.removeEventListener('dragover', dessus);
      noeud.removeEventListener('dragleave', sortir);
      noeud.removeEventListener('drop', lacher);
    };
  }, [actif]);
  return (
    <View ref={ref} testID={testID} style={{ position: 'relative' }}>
      {children}
      {survol ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.accent, borderRadius: 14, backgroundColor: teinteTransparente(theme.accent, 0.12), alignItems: 'center', justifyContent: 'center', padding: ESP.l }}>
          <Text style={{ ...texte(theme, 18), fontWeight: '800' }}>{trDr('depot.titre')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Aperçu d'un fichier du Drive sur le site et l'app PC : image (SVG compris, affiché par une balise <img>, qui
 * n'exécute jamais de script), lecteur vidéo / audio HTML5 (lecture par plages, lien signé), police (texte
 * d'exemple), début d'un fichier texte, PDF dans un nouvel onglet (le serveur interdit l'affichage dans un cadre).
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import { police } from '../../../../hub/themes';
import { trDr } from '../../../i18n/drive';
import { ESP, attenue, texte } from '../../design';
import { ouvrirLienDiffere } from '../../ouvrirLien';
import type { PropsApercuDrive } from './typesDrive';

export type { PropsApercuDrive } from './typesDrive';

const IMAGES = ['png', 'jpeg', 'gif', 'webp', 'svg', 'avif'];

export function ApercuDrive({ theme, fichier, obtenirUrl }: PropsApercuDrive) {
  const [url, setUrl] = useState<string | undefined>();
  const [erreur, setErreur] = useState(false);
  const [extrait, setExtrait] = useState<string | undefined>();
  const [familles, setFamilles] = useState<string | undefined>();
  const format = fichier.meta.format ?? '';
  const affichable = IMAGES.includes(format) || fichier.genre === 'video' || fichier.genre === 'audio' || fichier.genre === 'police' || fichier.genre === 'texte';
  useEffect(() => {
    let vivant = true;
    setUrl(undefined);
    setExtrait(undefined);
    setErreur(false);
    if (!affichable) return undefined;
    obtenirUrl().then(
      async u => {
        if (!vivant) return;
        setUrl(u);
        if (fichier.genre === 'texte') {
          const r = await fetch(u, { headers: { Range: 'bytes=0-20000' } });
          const t = await r.text();
          if (vivant) setExtrait(t.slice(0, 20000));
        }
        if (fichier.genre === 'police') {
          const Ff = (globalThis as { FontFace?: new (f: string, s: string) => { load(): Promise<unknown> } }).FontFace;
          const polices = (globalThis as { document?: { fonts?: { add(f: unknown): void } } }).document?.fonts;
          if (Ff && polices) {
            const nom = `apercu-${fichier.id}-${fichier.version}`;
            const f = new Ff(nom, `url(${u})`);
            await f.load();
            polices.add(f);
            if (vivant) setFamilles(nom);
          }
        }
      },
      () => vivant && setErreur(true),
    );
    return () => {
      vivant = false;
    };
  }, [affichable, fichier.genre, fichier.id, fichier.version, obtenirUrl]);

  const cadre = { width: '100%', maxHeight: 420, borderRadius: 10, background: theme.surface } as const;
  return (
    <View style={{ gap: ESP.xs }} testID="esport-drive-apercu">
      {erreur ? <Text style={attenue(theme)}>{trDr('apercu.erreur')}</Text> : null}
      {url && IMAGES.includes(format) ? <img src={url} alt={fichier.nom} style={{ ...cadre, objectFit: 'contain' }} /> : null}
      {url && fichier.genre === 'video' ? <video src={url} controls preload="metadata" style={cadre} aria-label={fichier.nom} /> : null}
      {url && fichier.genre === 'audio' ? <audio src={url} controls preload="metadata" style={{ width: '100%' }} aria-label={fichier.nom} /> : null}
      {fichier.genre === 'police' && familles ? <Text style={{ ...texte(theme, 28), fontFamily: familles }}>{trDr('apercu.police')}</Text> : null}
      {extrait !== undefined ? (
        <Text selectable style={{ ...attenue(theme, 12), ...police('monospace'), maxHeight: 320, overflow: 'hidden' }}>
          {extrait}
        </Text>
      ) : null}
      {format === 'pdf' ? <BoutonHub theme={theme} titre={trDr('apercu.pdf')} variante="plein" onPress={() => void ouvrirLienDiffere(obtenirUrl)} testID="esport-drive-apercu-pdf" /> : null}
      {!affichable && format !== 'pdf' ? <Text style={attenue(theme)}>{trDr('apercu.indisponible')}</Text> : null}
    </View>
  );
}

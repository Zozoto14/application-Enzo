/**
 * « Espace utilisé » de la team (Paramètres, permission `team.manage`) : total, répartition (vidéos,
 * enregistrements, transcriptions, résumés, miniatures, envois en cours), liste des fichiers avec leur
 * taille et leur date, et suppression quand on a la permission du module (vidéo : video_review.delete ;
 * enregistrement, transcription, ancienne version de résumé : meeting_summaries.write_summary).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { police, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { dateCourte } from '../../libelles';
import { apiMedias, type EspaceUtilise, type NatureFichier } from '../../medias/api';
import { tailleMedia } from '../../medias/envoi';
import { BoutonConfirme, Panneau, Retours, styles, useAgir } from '../commun';
import { TitreCarte } from '../design';
import { langueCourante, tr } from '../../i18n';
import { Icone, type NomIcone } from '../../../ui/icones';

const GLYPHES: Record<NatureFichier, NomIcone> = { video: 'video', enregistrement: 'micro', transcription: 'note', resume: 'document', miniature: 'image', autre: 'document' };

export function EspaceTeam({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const api = useMemo(() => apiMedias(client, teamId), [client, teamId]);
  const [espace, setEspace] = useState<EspaceUtilise | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(() => agir('', async () => setEspace(await api.espace())), [agir, api]);
  useEffect(() => {
    void charger();
  }, [charger]);
  const l = langueCourante();
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const natures = espace ? (Object.entries(espace.parNature) as Array<[NatureFichier | 'envois', number]>).filter(([, n]) => n > 0) : [];
  return (
    <Panneau theme={theme} testID="esport-espace">
      <TitreCarte theme={theme} titre={tr('espace.titre')} sous={tr('espace.sous', { v: tailleMedia(espace?.plafond ?? 0, l) })} />
      {espace ? (
        <>
          <Text testID="esport-espace-total" style={[texte, { fontSize: 22, fontWeight: '800' }]}>
            {tailleMedia(espace.total, l)}
          </Text>
          {natures.length ? <Text style={attenue}>{natures.map(([n, o]) => `${tr(`espace.nature.${n}` as 'espace.nature.video')} : ${tailleMedia(o, l)}`).join(' · ')}</Text> : <Text style={attenue}>{tr('espace.vide')}</Text>}
          {espace.fichiers.map(f => (
            <View key={f.id} testID={`esport-espace-fichier-${f.id}`} style={[styles.ligne, { borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 6 }]}>
              <Icone nom={GLYPHES[f.nature] ?? 'document'} taille={18} couleur={theme.attenue} />
              <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
                <Text style={[texte, { fontWeight: '600' }]} numberOfLines={1}>
                  {f.nom}
                </Text>
                <Text style={attenue} numberOfLines={2}>
                  {[tr(`espace.nature.${f.nature}` as 'espace.nature.video'), f.cible.titre, f.ancienneVersion ? tr('espace.ancienne_version') : null, tailleMedia(f.taille, l), dateCourte(f.creeLe), f.deposePar.pseudo ?? null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {f.peutSupprimer ? (
                <BoutonConfirme
                  theme={theme}
                  titre={tr('discord.supprimer')}
                  confirmation={tr('espace.confirmer')}
                  onConfirme={() =>
                    void agir('suppression', async () => {
                      setEspace(await api.supprimerFichier(f.id));
                      return tr('espace.supprime', { nom: f.nom });
                    })
                  }
                  testID={`esport-espace-supprimer-${f.id}`}
                />
              ) : null}
            </View>
          ))}
          {espace.envois.length ? (
            <View style={{ gap: 4 }} testID="esport-espace-envois">
              <Text style={[texte, { fontWeight: '700', marginTop: 6 }]}>{tr('espace.envois')}</Text>
              {espace.envois.map(e => (
                <Text key={e.id} style={attenue}>
                  {e.nom} · {tailleMedia(e.octetsRecus, l)} / {tailleMedia(e.taille, l)} · {e.compte.pseudo ?? '?'} · {dateCourte(e.majLe)}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={attenue}>{tr('espace.menage', { v: espace.delaiAbandonHeures })}</Text>
        </>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-espace" />
    </Panneau>
  );
}

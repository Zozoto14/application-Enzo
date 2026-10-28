/**
 * Gestion des étiquettes (tags) du Drive d'une portée (docs/esport/drive.md) : renommer (fusion si le nom existe
 * déjà) ou supprimer définitivement, sur tous les fichiers d'un coup. Réservé à `cm.drive.gerer`.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { apiDrive } from '../../../cm/drive';
import { trDr, trnDr } from '../../../i18n/drive';
import { Retours, styles, useAgir } from '../../commun';
import { ESP, attenue, texte } from '../../design';

type Api = ReturnType<typeof apiDrive>;

export function GestionTags({ theme, api, portee, onChange }: { theme: ThemeHub; api: Api; portee: string; onChange(): void }) {
  const [tags, setTags] = useState<Array<{ tag: string; n: number }> | undefined>();
  const [renommer, setRenommer] = useState<{ tag: string; nom: string } | undefined>();
  const [suppression, setSuppression] = useState<string | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const relire = async () => setTags((await api.filtres(portee)).tags);
  useEffect(() => {
    void agir('', relire);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portee, api]);
  const fait = (cle: string, action: () => Promise<unknown>, message: string) =>
    agir(cle, async () => {
      await action();
      await relire();
      onChange();
      return message;
    });

  return (
    <View style={{ gap: ESP.s }} testID="esport-drive-tags">
      <Text style={attenue(theme)}>{trDr('tags.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-drive-tags" />
      {tags && !tags.length ? <Text style={attenue(theme)}>{trDr('tags.aucun')}</Text> : null}
      {(tags ?? []).map(t => (
        <View key={t.tag} testID={`esport-drive-tag-${t.tag}`} style={{ gap: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, padding: ESP.s }}>
          <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }} numberOfLines={1}>{`#${t.tag}`}</Text>
              <Text style={attenue(theme, 12)}>{trnDr('tags.fichiers', t.n)}</Text>
            </View>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub theme={theme} titre={trDr('tags.renommer')} libelle={`${trDr('tags.renommer')} #${t.tag}`} onPress={() => setRenommer({ tag: t.tag, nom: t.tag })} testID={`esport-drive-tag-${t.tag}-renommer`} />
              <BoutonHub theme={theme} titre={trDr('tags.supprimer')} variante="danger" onPress={() => setSuppression(t.tag)} testID={`esport-drive-tag-${t.tag}-supprimer`} />
            </View>
          </View>
          {renommer?.tag === t.tag ? (
            <View style={{ gap: ESP.xs }}>
              <Champ theme={theme} libelle={trDr('tags.nom')} valeur={renommer.nom} onChanger={nom => setRenommer({ ...renommer, nom })} maxLength={32} testID="esport-drive-tag-nom" />
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub
                  theme={theme}
                  titre={trDr('tags.renommer')}
                  variante="plein"
                  desactive={!renommer.nom.trim() || Boolean(enCours)}
                  onPress={() =>
                    void fait('renommer', async () => {
                      await api.renommerTag({ portee, tag: t.tag, nom: renommer.nom });
                      setRenommer(undefined);
                    }, trDr('tags.renomme'))
                  }
                  testID="esport-drive-tag-nom-ok"
                />
                <BoutonHub theme={theme} titre={trDr('tags.annuler')} onPress={() => setRenommer(undefined)} testID="esport-drive-tag-nom-annuler" />
              </View>
            </View>
          ) : null}
          {suppression === t.tag ? (
            <View style={{ gap: ESP.xs }} accessibilityRole="alert">
              <Text style={{ ...texte(theme, 13), color: theme.critique, fontWeight: '600' }}>{trnDr('tags.supprimer_question', t.n, { tag: t.tag })}</Text>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub
                  theme={theme}
                  titre={trDr('tags.supprimer')}
                  variante="danger"
                  desactive={Boolean(enCours)}
                  onPress={() =>
                    void fait('supprimer', async () => {
                      await api.supprimerTag(portee, t.tag);
                      setSuppression(undefined);
                    }, trDr('tags.supprime'))
                  }
                  testID={`esport-drive-tag-${t.tag}-supprimer-ok`}
                />
                <BoutonHub theme={theme} titre={trDr('tags.annuler')} onPress={() => setSuppression(undefined)} testID={`esport-drive-tag-${t.tag}-supprimer-annuler`} />
              </View>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

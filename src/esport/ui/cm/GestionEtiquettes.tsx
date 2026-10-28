/**
 * Gestion des étiquettes d'un tableau CM (docs/esport/cm.md) : créer, renommer, changer la couleur (palette ou
 * couleur libre), réordonner, fusionner, supprimer définitivement. Les cartes ne portent que l'identifiant de
 * l'étiquette : un renommage ou un changement de couleur se voit partout (cartes, filtres, fiches), y compris
 * pour les étiquettes importées de Trello.
 *
 * Droits : `cm.editer` modifie et réordonne ; `cm.gerer` fusionne et supprime (définitif, sans corbeille).
 * Le panneau est affiché dans un volet depuis le tableau et en ligne depuis la fiche d'une carte.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ApiCm, Etiquette } from '../../cm/api';
import { trCm, trnCm } from '../../i18n/cm';
import { Choix, Retours, styles, useAgir } from '../commun';
import { ESP, attenue, texte } from '../design';
import { PALETTE, Teinte } from './commun';

const COULEUR_VALIDE = /^#[0-9a-fA-F]{6}$/;

type Brouillon = { id: string; nom: string; couleur: string; libre: string };

export function GestionEtiquettes({
  theme,
  api,
  tableauId,
  etiquettes,
  droits,
  onChange,
  testID = 'esport-cm-etiquettes',
}: {
  theme: ThemeHub;
  api: ApiCm;
  tableauId: string;
  etiquettes: Etiquette[];
  droits: { editer: boolean; gerer: boolean };
  onChange(): unknown;
  testID?: string;
}) {
  const { erreur, avis, agir, enCours } = useAgir();
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();
  const [suppression, setSuppression] = useState<string | undefined>();
  const [fusion, setFusion] = useState<{ id: string; vers?: string } | undefined>();
  const [creation, setCreation] = useState<Brouillon | undefined>();

  const fait = (cle: string, action: () => Promise<unknown>, message?: string) =>
    agir(cle, async () => {
      await action();
      await onChange();
      return message;
    });
  const nomAffiche = (e: Etiquette) => e.nom || trCm('etiquette.sans_nom');

  const deplacer = (index: number, delta: number) => {
    const ids = etiquettes.map(e => e.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + delta, 0, x);
    void fait('ordre', () => api.ordonnerEtiquettes(tableauId, ids), trCm('etiquette.ordonnee'));
  };

  const editeur = (b: Brouillon, maj: (b: Brouillon) => void, prefixe: string) => {
    const libreValide = !b.libre || COULEUR_VALIDE.test(b.libre);
    return (
      <View style={{ gap: ESP.xs }}>
        <Champ theme={theme} libelle={trCm('etiquette.nom')} valeur={b.nom} onChanger={nom => maj({ ...b, nom })} maxLength={40} testID={`${prefixe}-nom`} />
        <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('c.couleur')}>
          {PALETTE.map(([couleur, cle]) => (
            <Teinte key={couleur} theme={theme} couleur={couleur} choisie={b.couleur.toLowerCase() === couleur} libelle={trCm(cle)} onPress={() => maj({ ...b, couleur, libre: '' })} testID={`${prefixe}-couleur-${couleur.slice(1)}`} />
          ))}
        </View>
        <Champ theme={theme} libelle={trCm('etiquette.couleur_libre')} valeur={b.libre} placeholder={b.couleur} onChanger={libre => maj({ ...b, libre, couleur: COULEUR_VALIDE.test(libre) ? libre.toLowerCase() : b.couleur })} maxLength={7} testID={`${prefixe}-libre`} />
        {!libreValide ? <Text style={{ color: theme.critique, fontSize: 13 }}>{trCm('etiquette.couleur_invalide')}</Text> : null}
      </View>
    );
  };
  const libreOk = (b: Brouillon) => !b.libre || COULEUR_VALIDE.test(b.libre);

  return (
    <View style={{ gap: ESP.s }} testID={testID}>
      <Text style={attenue(theme)}>{trCm('etiquette.aide')}</Text>
      {droits.editer && !droits.gerer ? <Text style={attenue(theme)}>{trCm('etiquette.aide_gerer')}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={testID} />
      {!etiquettes.length ? <Text style={attenue(theme)}>{trCm('etiquette.aucune')}</Text> : null}

      {etiquettes.map((e, i) => {
        const pastille = (
          <View style={{ backgroundColor: e.couleur, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', maxWidth: '100%' }}>
            <Text style={{ color: '#172b4d', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
              {e.nom || ' '}
            </Text>
          </View>
        );
        return (
          <View key={e.id} testID={`${testID}-ligne-${e.id}`} style={{ gap: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, padding: ESP.s }}>
            <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
              <View style={{ gap: 2, flexShrink: 1, minWidth: 0 }} accessible accessibilityLabel={nomAffiche(e)}>
                {pastille}
                {typeof e.cartes === 'number' ? <Text style={attenue(theme, 12)}>{trnCm('etiquette.utilisee', e.cartes)}</Text> : null}
              </View>
              {droits.editer ? (
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub theme={theme} titre={trCm('etiquette.modifier')} onPress={() => setBrouillon({ id: e.id, nom: e.nom, couleur: e.couleur, libre: '' })} testID={`${testID}-${e.id}-modifier`} libelle={`${trCm('etiquette.modifier')} ${nomAffiche(e)}`} />
                  <BoutonHub theme={theme} titre="↑" libelle={trCm('etiquette.monter')} desactive={i === 0 || Boolean(enCours)} onPress={() => deplacer(i, -1)} testID={`${testID}-${e.id}-monter`} />
                  <BoutonHub theme={theme} titre="↓" libelle={trCm('etiquette.descendre')} desactive={i === etiquettes.length - 1 || Boolean(enCours)} onPress={() => deplacer(i, 1)} testID={`${testID}-${e.id}-descendre`} />
                </View>
              ) : null}
            </View>

            {brouillon?.id === e.id ? (
              <View style={{ gap: ESP.xs }}>
                {editeur(brouillon, setBrouillon, `${testID}-edition`)}
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub
                    theme={theme}
                    titre={trCm('c.enregistrer')}
                    variante="plein"
                    desactive={!libreOk(brouillon) || Boolean(enCours)}
                    onPress={() =>
                      void fait('modifier', async () => {
                        await api.modifierEtiquette(e.id, { nom: brouillon.nom, couleur: brouillon.couleur });
                        setBrouillon(undefined);
                      }, trCm('etiquette.enregistree'))
                    }
                    testID={`${testID}-edition-ok`}
                  />
                  <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setBrouillon(undefined)} testID={`${testID}-edition-annuler`} />
                </View>
              </View>
            ) : null}

            {droits.gerer && brouillon?.id !== e.id ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                {etiquettes.length > 1 ? <BoutonHub theme={theme} titre={trCm('etiquette.fusionner')} onPress={() => setFusion({ id: e.id })} testID={`${testID}-${e.id}-fusionner`} /> : null}
                <BoutonHub theme={theme} titre={trCm('etiquette.supprimer')} variante="danger" onPress={() => setSuppression(e.id)} testID={`${testID}-${e.id}-supprimer`} />
              </View>
            ) : null}

            {fusion?.id === e.id ? (
              <View style={{ gap: ESP.xs }}>
                <Choix
                  theme={theme}
                  libelle={trCm('etiquette.fusionner_dans', { nom: nomAffiche(e) })}
                  valeur={fusion.vers}
                  options={etiquettes.filter(x => x.id !== e.id).map(x => ({ id: x.id, nom: nomAffiche(x), couleur: x.couleur }))}
                  onChoisir={vers => setFusion({ id: e.id, vers })}
                  testID={`${testID}-fusion`}
                />
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub
                    theme={theme}
                    titre={trCm('etiquette.fusionner_ok')}
                    variante="plein"
                    desactive={!fusion.vers || Boolean(enCours)}
                    onPress={() =>
                      void fait('fusion', async () => {
                        await api.fusionnerEtiquettes(e.id, fusion.vers!);
                        setFusion(undefined);
                      }, trCm('etiquette.fusionnee'))
                    }
                    testID={`${testID}-fusion-ok`}
                  />
                  <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setFusion(undefined)} testID={`${testID}-fusion-annuler`} />
                </View>
              </View>
            ) : null}

            {suppression === e.id ? (
              <View style={{ gap: ESP.xs }} accessibilityRole="alert" testID={`${testID}-suppression`}>
                <Text style={{ ...texte(theme, 13), color: theme.critique, fontWeight: '600' }}>{trnCm('etiquette.supprimer_question', e.cartes ?? 0, { nom: nomAffiche(e) })}</Text>
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub
                    theme={theme}
                    titre={trCm('etiquette.supprimer')}
                    variante="danger"
                    desactive={Boolean(enCours)}
                    onPress={() =>
                      void fait('supprimer', async () => {
                        await api.supprimerEtiquette(e.id);
                        setSuppression(undefined);
                      }, trCm('etiquette.supprimee'))
                    }
                    testID={`${testID}-${e.id}-supprimer-ok`}
                  />
                  <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setSuppression(undefined)} testID={`${testID}-${e.id}-supprimer-annuler`} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}

      {droits.editer ? (
        creation ? (
          <View style={{ gap: ESP.xs }}>
            {editeur(creation, setCreation, `${testID}-creation`)}
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub
                theme={theme}
                titre={trCm('c.creer')}
                variante="plein"
                desactive={!libreOk(creation) || Boolean(enCours)}
                onPress={() =>
                  void fait('creer', async () => {
                    await api.creerEtiquette(tableauId, { nom: creation.nom, couleur: creation.couleur });
                    setCreation(undefined);
                  })
                }
                testID={`${testID}-creation-ok`}
              />
              <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setCreation(undefined)} testID={`${testID}-creation-annuler`} />
            </View>
          </View>
        ) : (
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre={trCm('etiquette.nouvelle')} onPress={() => setCreation({ id: '', nom: '', couleur: PALETTE[5][0], libre: '' })} testID={`${testID}-nouvelle`} />
          </View>
        )
      ) : null}
    </View>
  );
}

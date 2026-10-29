/**
 * Badges du trombinoscope (migration 0032, docs/esport/trombinoscope.md) : le CATALOGUE du club — créer, renommer,
 * couleur (palette ou libre), icône / emoji, ordre d'affichage, suppression définitive (retiré de tous les membres,
 * avec le nombre annoncé). Les badges automatiques (« CEO », « Responsable CM », « Correspondant CM ») se
 * renomment et se recolorent, se désactivent, mais ne s'attribuent pas à la main. Les badges réservés au Fondateur
 * (« Second CEO ») ne se modifient que par lui.
 *
 * Droit : Fondateur, ou affectation CM « club » à un rôle qui porte `membres.badges.gerer` (Responsable CM).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ApiTrombi, BadgeCatalogue } from '../../trombi/api';
import { trTb, trnTb, type CleTb } from '../../i18n/trombi';
import { trCm } from '../../i18n/cm';
import { Retours, styles, useAgir } from '../commun';
import { Badge, ESP, Squelette, attenue, texte } from '../design';
import { PALETTE, Teinte } from '../cm/commun';
import { PuceBadge } from './commun';

const COULEUR_VALIDE = /^#[0-9a-fA-F]{6}$/;

type Brouillon = { id: string; nom: string; couleur: string; libre: string; icone: string; reserve: boolean };

export function GestionBadges({ theme, api, fondateur, onChange, testID = 'esport-trombi-badges' }: { theme: ThemeHub; api: ApiTrombi; fondateur: boolean; onChange?(): unknown; testID?: string }) {
  const { erreur, avis, agir, enCours } = useAgir();
  const [badges, setBadges] = useState<BadgeCatalogue[] | undefined>();
  const [brouillon, setBrouillon] = useState<Brouillon | undefined>();
  const [creation, setCreation] = useState<Brouillon | undefined>();
  const [suppression, setSuppression] = useState<string | undefined>();

  const charger = useCallback(async () => setBadges((await api.catalogueBadges()).badges), [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const fait = (cle: string, action: () => Promise<string | undefined | void>) =>
    agir(cle, async () => {
      const m = await action();
      await charger();
      await onChange?.();
      return m ?? undefined;
    });

  if (!badges) return erreur ? <Retours theme={theme} erreur={erreur} prefixe={testID} /> : <Squelette theme={theme} lignes={5} />;

  const deplacer = (index: number, delta: number) => {
    const ids = badges.map(b => b.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + delta, 0, x);
    void fait('ordre', async () => {
      await api.ordonnerBadges(ids);
      return trTb('badges.ordonne');
    });
  };
  const libreOk = (b: Brouillon) => !b.libre || COULEUR_VALIDE.test(b.libre);

  const editeur = (b: Brouillon, maj: (b: Brouillon) => void, prefixe: string) => (
    <View style={{ gap: ESP.xs }}>
      <PuceBadge theme={theme} badge={{ nom: b.nom || trTb('badges.nom'), couleur: b.couleur, icone: b.icone, teamNom: null }} />
      <Champ theme={theme} libelle={trTb('badges.nom')} valeur={b.nom} onChanger={nom => maj({ ...b, nom })} maxLength={32} testID={`${prefixe}-nom`} />
      <Champ theme={theme} libelle={trTb('badges.icone')} valeur={b.icone} placeholder="★" onChanger={icone => maj({ ...b, icone })} maxLength={16} testID={`${prefixe}-icone`} />
      <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trTb('badges.couleur')}>
        {PALETTE.map(([couleur, cle]) => (
          <Teinte key={couleur} theme={theme} couleur={couleur} choisie={b.couleur.toLowerCase() === couleur} libelle={trCm(cle)} onPress={() => maj({ ...b, couleur, libre: '' })} testID={`${prefixe}-couleur-${couleur.slice(1)}`} />
        ))}
      </View>
      <Champ theme={theme} libelle={trTb('badges.couleur_libre')} valeur={b.libre} placeholder={b.couleur} onChanger={libre => maj({ ...b, libre, couleur: COULEUR_VALIDE.test(libre) ? libre.toLowerCase() : b.couleur })} maxLength={7} testID={`${prefixe}-libre`} />
      {!libreOk(b) ? <Text style={{ color: theme.critique, fontSize: 13 }}>{trTb('badges.couleur_invalide')}</Text> : null}
      {fondateur ? (
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Interrupteur theme={theme} libelle={trTb('badges.reserve')} valeur={b.reserve} onChanger={reserve => maj({ ...b, reserve })} testID={`${prefixe}-reserve`} />
          <Text style={attenue(theme)}>{`${trTb('badges.reserve')} — ${trTb('badges.reserve_aide')}`}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ gap: ESP.s }} testID={testID}>
      <Text style={attenue(theme)}>{trTb('badges.gerer_aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={testID} />
      {!badges.length ? <Text style={attenue(theme)}>{trTb('badges.aucun')}</Text> : null}
      {badges.map((b, i) => {
        const verrou = b.reserve && !fondateur;
        return (
          <View key={b.id} testID={`${testID}-ligne-${b.id}`} style={{ gap: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, padding: ESP.s }}>
            <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
              <View style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
                <View style={[styles.ligne, { gap: ESP.xxs }]}>
                  <PuceBadge theme={theme} badge={{ ...b, teamNom: null }} />
                  {b.auto ? <Badge theme={theme} ton="accent" texte={trTb('badges.auto')} testID={`${testID}-${b.id}-auto`} /> : null}
                  {b.reserve ? <Badge theme={theme} ton="alerte" texte={trTb('badges.reserve')} testID={`${testID}-${b.id}-reserve`} /> : null}
                </View>
                <Text style={attenue(theme, 12)}>{b.auto ? trTb(`badges.auto.${b.auto}` as CleTb) : trnTb('badges.porte', b.membres ?? 0)}</Text>
              </View>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                {!verrou ? <BoutonHub theme={theme} titre={trTb('badges.modifier')} libelle={`${trTb('badges.modifier')} ${b.nom}`} onPress={() => setBrouillon({ id: b.id, nom: b.nom, couleur: b.couleur, libre: '', icone: b.icone, reserve: b.reserve })} testID={`${testID}-${b.id}-modifier`} /> : null}
                <BoutonHub theme={theme} titre="↑" libelle={`${trTb('badges.monter')} ${b.nom}`} desactive={i === 0 || Boolean(enCours)} onPress={() => deplacer(i, -1)} testID={`${testID}-${b.id}-monter`} />
                <BoutonHub theme={theme} titre="↓" libelle={`${trTb('badges.descendre')} ${b.nom}`} desactive={i === badges.length - 1 || Boolean(enCours)} onPress={() => deplacer(i, 1)} testID={`${testID}-${b.id}-descendre`} />
              </View>
            </View>
            {b.auto && !verrou ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Interrupteur
                  theme={theme}
                  libelle={trTb('badges.auto_actif')}
                  valeur={b.autoActif}
                  desactive={Boolean(enCours)}
                  onChanger={autoActif =>
                    void fait('auto', async () => {
                      await api.modifierBadge(b.id, { autoActif });
                      return trTb('badges.enregistre');
                    })
                  }
                  testID={`${testID}-${b.id}-auto-actif`}
                />
                <Text style={texte(theme, 13)}>{trTb('badges.auto_actif')}</Text>
              </View>
            ) : null}

            {brouillon?.id === b.id ? (
              <View style={{ gap: ESP.xs }}>
                {editeur(brouillon, setBrouillon, `${testID}-edition`)}
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub
                    theme={theme}
                    titre={trTb('enregistrer')}
                    variante="plein"
                    desactive={!libreOk(brouillon) || !brouillon.nom.trim() || Boolean(enCours)}
                    onPress={() =>
                      void fait('modifier', async () => {
                        await api.modifierBadge(b.id, { nom: brouillon.nom, couleur: brouillon.couleur, icone: brouillon.icone, ...(fondateur && brouillon.reserve !== b.reserve ? { reserve: brouillon.reserve } : {}) });
                        setBrouillon(undefined);
                        return trTb('badges.enregistre');
                      })
                    }
                    testID={`${testID}-edition-ok`}
                  />
                  <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => setBrouillon(undefined)} testID={`${testID}-edition-annuler`} />
                  <View style={{ flex: 1 }} />
                  <BoutonHub theme={theme} titre={trTb('badges.supprimer')} variante="danger" onPress={() => setSuppression(b.id)} testID={`${testID}-${b.id}-supprimer`} />
                </View>
              </View>
            ) : null}

            {suppression === b.id ? (
              <View style={{ gap: ESP.xs }} accessibilityRole="alert" testID={`${testID}-suppression`}>
                <Text style={{ ...texte(theme, 13), color: theme.critique, fontWeight: '600' }}>{trnTb('badges.supprimer_question', b.membres ?? 0, { nom: b.nom })}</Text>
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub
                    theme={theme}
                    titre={trTb('badges.supprimer')}
                    variante="danger"
                    desactive={Boolean(enCours)}
                    onPress={() =>
                      void fait('supprimer', async () => {
                        const r = await api.supprimerBadge(b.id);
                        setSuppression(undefined);
                        setBrouillon(undefined);
                        return trnTb('badges.supprime', r.retires ?? 0);
                      })
                    }
                    testID={`${testID}-${b.id}-supprimer-ok`}
                  />
                  <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => setSuppression(undefined)} testID={`${testID}-${b.id}-supprimer-annuler`} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}

      {creation ? (
        <View style={{ gap: ESP.xs }}>
          {editeur(creation, setCreation, `${testID}-creation`)}
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trTb('badges.nouveau')}
              variante="plein"
              desactive={!libreOk(creation) || !creation.nom.trim() || Boolean(enCours)}
              onPress={() =>
                void fait('creer', async () => {
                  await api.creerBadge({ nom: creation.nom, couleur: creation.couleur, icone: creation.icone, ...(fondateur && creation.reserve ? { reserve: true } : {}) });
                  setCreation(undefined);
                  return trTb('badges.cree');
                })
              }
              testID={`${testID}-creation-ok`}
            />
            <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => setCreation(undefined)} testID={`${testID}-creation-annuler`} />
          </View>
        </View>
      ) : (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={trTb('badges.nouveau')} onPress={() => setCreation({ id: '', nom: '', couleur: PALETTE[5][0], libre: '', icone: '', reserve: false })} testID={`${testID}-nouveau`} />
        </View>
      )}
    </View>
  );
}

/**
 * Panneau « Visuels » de la fiche d'une carte post : visuels de la carte (miniature du rendu, format, langue,
 * « retouché », signalement « à régénérer » quand les données, la charte ou le modèle ont changé), bouton
 * « Générer le visuel » (genre proposé d'après la suggestion automatique ou les liens de la carte),
 * Retoucher (éditeur plein écran), Régénérer (confirmation si le visuel a été retouché), Télécharger.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Modal, ScrollView, Text, View } from 'react-native';
import { BoutonHub } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ApiCm, TeamCm } from '../../../cm/api';
import { apiVisuels, estRefDefaut, type Visuel, type VisuelsCarte } from '../../../cm/visuels/api';
import { lireCharte } from '../../../cm/visuels/charte';
import { renduDisponible } from '../../../cm/visuels/generateur';
import { genererVisuel } from '../../../cm/visuels/generation';
import type { Charte } from '../../../cm/visuels/types';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { BoutonConfirme, Intertitre, Panneau, Retours, styles, useAgir } from '../../commun';
import { Badge, ESP, attenue, texte } from '../../design';
import { ouvrirLienDiffere } from '../../ouvrirLien';
import { EditeurDiffere } from './EditeurDiffere';
import { GenererVisuel } from './Generer';
import type { CibleEditeur } from './typesEditeur';

function Miniature({ theme, api, v }: { theme: ThemeHub; api: ReturnType<typeof apiVisuels>; v: Visuel }) {
  const [uri, setUri] = useState<string | undefined>();
  useEffect(() => {
    if (!v.fichierId) return;
    let vivant = true;
    void api
      .lienRendu(v.id)
      .then(l => vivant && setUri(l.url))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [api, v.id, v.fichierId, v.renduLe]);
  const ratio = v.format === 'paysage' ? 16 / 9 : v.format === 'story' ? 9 / 16 : v.format === 'portrait' ? 4 / 5 : 1;
  return (
    <View style={{ width: 96, aspectRatio: ratio, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.fond, alignItems: 'center', justifyContent: 'center' }}>
      {uri ? <Image source={{ uri }} accessibilityIgnoresInvertColors style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Text style={attenue(theme, 11)}>{trVi('carte.pas_rendu')}</Text>}
    </View>
  );
}

export function PanneauVisuelsCarte({ theme, apiCm, carteId, teams, onChange }: { theme: ThemeHub; apiCm: ApiCm; carteId: string; teams: TeamCm[]; onChange(): void }) {
  const api = useMemo(() => apiVisuels(apiCm.client), [apiCm]);
  const [r, setR] = useState<VisuelsCarte | undefined>();
  const [charte, setCharte] = useState<Charte | undefined>();
  const [generer, setGenerer] = useState(false);
  const [edition, setEdition] = useState<CibleEditeur | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const charger = useCallback(async () => setR(await api.visuelsCarte(carteId)), [api, carteId]);
  useEffect(() => {
    void agir('', charger);
    void api
      .charte()
      .then(c => setCharte(lireCharte(c.charte)))
      .catch(() => undefined);
  }, [agir, charger, api]);
  // Serveur sans les visuels (ancienne version) : pas de panneau.
  if (!r || !Array.isArray(r.visuels)) return erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-vi-carte" /> : null;
  const modeleDe = async (v: Visuel) => (estRefDefaut(v.modele) ? null : (await api.modele(v.modele).catch(() => null))?.modele ?? null);
  const regenerer = (v: Visuel) =>
    agir(`regenerer-${v.id}`, async () => {
      if (!charte) return undefined;
      await genererVisuel(api, v, charte, await modeleDe(v));
      await charger();
      onChange();
      return trVi('carte.regenere');
    });
  const ouvrir = (v: Visuel) =>
    agir(`ouvrir-${v.id}`, async () => {
      setEdition({ genre: 'visuel', visuel: (await api.visuel(v.id)).visuel, modele: await modeleDe(v) });
      return undefined;
    });
  const telecharger = (v: Visuel) =>
    agir(`telecharger-${v.id}`, async () => {
      await ouvrirLienDiffere(async () => (await api.lienRendu(v.id, true)).url);
      return undefined;
    });
  const typeLibelle = (t: string) => trVi(`type.${t}` as CleVi);

  return (
    <Panneau theme={theme} testID="esport-vi-carte">
      <Intertitre theme={theme}>{trVi('carte.titre')}</Intertitre>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vi-carte" />
      {r.proposition ? <Text style={attenue(theme)}>{r.suggestion ? trVi('carte.suggestion', { type: typeLibelle(r.proposition.type) }) : trVi('carte.proposition', { type: typeLibelle(r.proposition.type) })}</Text> : null}
      {!r.visuels.length ? <Text style={attenue(theme)}>{trVi('carte.aucun')}</Text> : null}
      {r.visuels.map(v => {
        const perime = v.perime && (v.perime.donnees || v.perime.charte || v.perime.modele);
        return (
          <View key={v.id} style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-start' }]} testID={`esport-vi-carte-visuel-${v.id}`}>
            <Miniature theme={theme} api={api} v={v} />
            <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{`${typeLibelle(v.type)} · ${trVi(`format.${v.format}` as CleVi)} · ${v.langue.toUpperCase()}`}</Text>
              <View style={[styles.ligne, { gap: 4 }]}>
                {v.retouche ? <Badge theme={theme} texte={trVi('carte.retouche')} /> : null}
                {!v.fichierId ? <Badge theme={theme} ton="alerte" texte={trVi('carte.pas_rendu')} /> : null}
                {v.erreurDonnees ? <Badge theme={theme} ton="alerte" texte={trVi('carte.donnees_indisponibles')} /> : null}
              </View>
              {v.perime?.donnees ? <Text style={{ ...texte(theme, 13), color: theme.alerte }}>{trVi('carte.perime_donnees')}</Text> : null}
              {v.perime?.charte ? <Text style={{ ...texte(theme, 13), color: theme.alerte }}>{trVi('carte.perime_charte')}</Text> : null}
              {v.perime?.modele ? <Text style={{ ...texte(theme, 13), color: theme.alerte }}>{trVi('carte.perime_modele')}</Text> : null}
              {r.editer ? (
                <View style={[styles.ligne, { gap: 4 }]}>
                  <BoutonHub theme={theme} titre={trVi('carte.ouvrir')} onPress={() => void ouvrir(v)} testID={`esport-vi-carte-ouvrir-${v.id}`} />
                  {renduDisponible && v.donnees ? (
                    v.retouche ? (
                      <BoutonConfirme theme={theme} titre={trVi('carte.regenerer')} confirmation={trVi('carte.regenerer')} onConfirme={() => void regenerer(v)} testID={`esport-vi-carte-regenerer-${v.id}`} />
                    ) : (
                      <BoutonHub theme={theme} titre={trVi('carte.regenerer')} variante={perime || !v.fichierId ? 'plein' : 'normal'} desactive={Boolean(enCours)} onPress={() => void regenerer(v)} testID={`esport-vi-carte-regenerer-${v.id}`} />
                    )
                  ) : null}
                  {v.fichierId ? <BoutonHub theme={theme} titre={trVi('carte.telecharger')} onPress={() => void telecharger(v)} testID={`esport-vi-carte-telecharger-${v.id}`} /> : null}
                </View>
              ) : null}
              {r.editer && v.retouche && renduDisponible ? <Text style={attenue(theme, 12)}>{trVi('carte.regenerer_confirmer')}</Text> : null}
            </View>
          </View>
        );
      })}
      {r.editer ? <BoutonHub theme={theme} titre={trVi('carte.generer')} variante="plein" onPress={() => setGenerer(true)} testID="esport-vi-carte-generer" /> : null}
      {generer ? (
        <GenererVisuel
          theme={theme}
          api={api}
          apiCm={apiCm}
          portee={r.portee}
          carteId={carteId}
          proposition={r.proposition}
          teams={teams}
          charte={charte}
          onFermer={() => setGenerer(false)}
          onCree={() => {
            setGenerer(false);
            void charger();
            onChange();
          }}
        />
      ) : null}
      {edition && charte ? (
        <Modal visible animationType="none" onRequestClose={() => setEdition(undefined)}>
          <ScrollView style={{ flex: 1, backgroundColor: theme.fond }} contentContainerStyle={{ padding: ESP.l }}>
            <EditeurDiffere
              theme={theme}
              api={api}
              large
              charte={charte}
              cible={edition}
              onFermer={change => {
                setEdition(undefined);
                if (change) {
                  void charger();
                  onChange();
                }
              }}
            />
          </ScrollView>
        </Modal>
      ) : null}
    </Panneau>
  );
}

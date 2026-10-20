/**
 * Accueil de la team, volet planning : prochains événements (réponse en un
 * appui) et alertes de présence (à répondre, sans réponse, à marquer).
 * Réglages du planning dans les Paramètres : fuseau de la team, effectif
 * minimum, rappel automatique.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Intertitre, Panneau } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport, DetailTeam } from '../../client';
import { apiPlanning, type AccueilPlanning as Donnees } from '../../planning/api';
import { dateCourteJour, fuseauAppareil } from '../../planning/libelles';
import { Retours, styles, useAgir } from '../commun';
import type { PropsModule } from '../modules';
import { BoutonsRsvp, CarteOccurrence } from './commun';

export function AccueilPlanning({ theme, client, detail, onAller }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; onAller: PropsModule['onAller'] }) {
  const actif = detail.modules.some(m => m.cle === 'planning' && m.active) && detail.moi.permissions.includes('planning.view');
  const api = useMemo(() => apiPlanning(client, detail.team.id), [client, detail.team.id]);
  const [d, setD] = useState<Donnees | undefined>();
  const charger = useCallback(async () => setD(await api.accueil(detail.team.fuseau)), [api, detail.team.fuseau]);
  useEffect(() => {
    if (actif) charger().catch(() => undefined);
  }, [actif, charger]);
  if (!actif) return null;
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const repondre = (evenementId: string, cle: string) => async (r: 'oui' | 'non' | 'peut_etre') => {
    await api.repondre(evenementId, cle, r);
    await charger();
  };
  return (
    <>
      <Panneau theme={theme} testID="esport-accueil-prochains">
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Intertitre theme={theme}>Prochains événements</Intertitre>
          <BoutonHub theme={theme} titre="Planning" onPress={() => onAller('module:planning')} testID="esport-accueil-planning" />
        </View>
        {d && d.prochains.length === 0 ? <Text style={attenue}>Rien de prévu dans les deux semaines.</Text> : null}
        {d?.prochains.map(o => (
          <CarteOccurrence
            key={`${o.evenementId}-${o.cle}`}
            theme={theme}
            o={o}
            onOuvrir={() => onAller('module:planning')}
            onRepondre={d.modules.presence && d.droits.rsvp ? repondre(o.evenementId, o.cle) : undefined}
            testID={`esport-prochain-${o.jour}`}
          />
        ))}
      </Panneau>
      {d && d.alertes.length ? (
        <Panneau theme={theme} testID="esport-accueil-alertes">
          <Intertitre theme={theme}>Alertes de présence</Intertitre>
          {d.alertes.map(a => (
            <View key={`${a.genre}-${a.evenementId}-${a.cle}`} style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-alerte-${a.genre}`}>
              <Text style={texte}>
                {a.genre === 'rsvp'
                  ? `Répondez : ${a.titre}`
                  : a.genre === 'sans-reponse'
                    ? `${a.sansReponse} sans réponse : ${a.titre}`
                    : `${a.nonMarques} présence(s) à marquer : ${a.titre}`}
                <Text style={attenue}>
                  {' '}
                  · {dateCourteJour(a.jour)} {a.heureDebut}
                </Text>
              </Text>
              {a.genre === 'rsvp' && d.droits.rsvp ? <BoutonsRsvp theme={theme} valeur="sans_reponse" onRepondre={repondre(a.evenementId, a.cle)} testID={`esport-alerte-rsvp-${a.jour}`} /> : null}
              {a.genre === 'a-marquer' ? <BoutonHub theme={theme} titre="Marquer" onPress={() => onAller('module:attendance')} testID={`esport-alerte-marquer-${a.jour}`} /> : null}
            </View>
          ))}
        </Panneau>
      ) : null}
    </>
  );
}

export function ReglagesPlanning({ theme, client, detail, onChange }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; onChange(): Promise<void> }) {
  const actif = detail.modules.some(m => ['planning', 'availability', 'attendance'].includes(m.cle) && m.active);
  const peut = detail.moi.permissions.includes('team.manage');
  const api = useMemo(() => apiPlanning(client, detail.team.id), [client, detail.team.id]);
  const [fuseau, setFuseau] = useState(detail.team.fuseau);
  const [effectif, setEffectif] = useState('');
  const [rappel, setRappel] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    if (actif && peut)
      api.reglages().then(
        r => {
          setEffectif(String(r.effectifMin));
          setRappel(String(r.rappelHeures));
        },
        () => undefined,
      );
  }, [actif, peut, api]);
  if (!actif || !peut) return null;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-parametres-planning">
      <Intertitre theme={theme}>Planning</Intertitre>
      <Champ theme={theme} libelle="Fuseau horaire de la team (IANA)" valeur={fuseau} onChanger={setFuseau} maxLength={60} placeholder="Europe/Paris" testID="esport-parametres-fuseau" />
      <Text style={attenue}>Heures affichées par défaut. Cet appareil : {fuseauAppareil()}.</Text>
      <View style={styles.ligne}>
        <Champ theme={theme} libelle="Effectif minimum" valeur={effectif} onChanger={setEffectif} clavier="number-pad" maxLength={2} style={{ width: 150 }} testID="esport-parametres-effectif" />
        <Champ theme={theme} libelle="Rappel (heures avant, 0 = jamais)" valeur={rappel} onChanger={setRappel} clavier="number-pad" maxLength={3} style={{ width: 220 }} testID="esport-parametres-rappel" />
      </View>
      <BoutonHub
        theme={theme}
        titre="Enregistrer"
        variante="plein"
        desactive={Boolean(enCours)}
        onPress={() =>
          void agir('Planning', async () => {
            if (fuseau.trim() !== detail.team.fuseau) await client.requete(`/teams/${encodeURIComponent(detail.team.id)}`, 'PATCH', { fuseau: fuseau.trim() });
            await api.changerReglages({ effectifMin: Number(effectif), rappelHeures: Number(rappel) });
            await onChange();
            return 'Réglages du planning enregistrés.';
          })
        }
        testID="esport-parametres-planning-enregistrer"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-parametres-planning" />
    </Panneau>
  );
}

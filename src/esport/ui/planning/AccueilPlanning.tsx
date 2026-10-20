/**
 * Accueil de la team, volet planning : prochains événements (réponse en un
 * appui) et alertes de présence (à répondre, sans réponse, à marquer).
 * Réglages du planning dans les Paramètres : fuseau de la team, effectif
 * minimum, rappel automatique.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport, DetailTeam } from '../../client';
import { apiPlanning, type AccueilPlanning as Donnees, type Annonce } from '../../planning/api';
import { dateCourteJour, fuseauAppareil } from '../../planning/libelles';
import { Retours, styles, useAgir, Intertitre, Panneau } from '../commun';
import { EtatVide, Squelette, TitreCarte } from '../design';
import type { PropsModule } from '../modules';
import { BoutonsRsvp, CarteOccurrence } from './commun';
import { tr, trn } from '../../i18n';

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
  const annoncer = (evenementId: string, cle: string) => async (r: 'oui' | 'non' | 'peut_etre', a: Partial<Annonce>) => {
    await api.repondre(evenementId, cle, r, a);
    await charger();
  };
  return (
    <>
      <Panneau theme={theme} testID="esport-accueil-prochains">
        <TitreCarte
          theme={theme}
          titre={tr('dashboard.prochains_evenements')}
          sous={d && d.prochains.length > 3 ? tr('planning.accueilPlanning.dans_les_deux_semaines', { length: d.prochains.length }) : undefined}
          droite={<BoutonHub theme={theme} titre={tr('planning.accueilPlanning.tout_le_planning')} onPress={() => onAller('module:planning')} testID="esport-accueil-planning" />}
        />
        {!d ? <Squelette theme={theme} lignes={3} /> : null}
        {d && d.prochains.length === 0 ? <EtatVide theme={theme} glyphe="◷" titre={tr('dashboard.rien_de_prevu')} texte={tr('planning.accueilPlanning.aucun_evenement_dans_les')} /> : null}
        {d?.prochains.slice(0, 3).map(o => (
          <CarteOccurrence
            key={`${o.evenementId}-${o.cle}`}
            theme={theme}
            o={o}
            onOuvrir={() => onAller('module:planning')}
            onRepondre={d.modules.presence && d.droits.rsvp ? repondre(o.evenementId, o.cle) : undefined}
            onAnnoncer={d.modules.presence && d.droits.rsvp ? annoncer(o.evenementId, o.cle) : undefined}
            testID={`esport-prochain-${o.jour}`}
          />
        ))}
      </Panneau>
      {d && d.alertes.length ? (
        <Panneau theme={theme} testID="esport-accueil-alertes">
          <Intertitre theme={theme}>{tr('planning.accueilPlanning.alertes_de_presence')}</Intertitre>
          {d.alertes.map(a => (
            <View key={`${a.genre}-${a.evenementId}-${a.cle}`} style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID={`esport-alerte-${a.genre}`}>
              <Text style={texte}>
                {a.genre === 'rsvp'
                  ? tr('planning.accueilPlanning.repondez', { titre: a.titre })
                  : a.genre === 'sans-reponse'
                    ? tr('planning.accueilPlanning.sans_reponse', { sansReponse: a.sansReponse, titre: a.titre })
                    : tr('planning.accueilPlanning.presence_s_a_marquer', { presences: trn('planning.accueilPlanning.presences', a.nonMarques ?? 0), titre: a.titre })}
                <Text style={attenue}>
                  {' '}
                  · {dateCourteJour(a.jour)} {a.heureDebut}
                </Text>
              </Text>
              {a.genre === 'rsvp' && d.droits.rsvp ? <BoutonsRsvp theme={theme} valeur="sans_reponse" onRepondre={repondre(a.evenementId, a.cle)} testID={`esport-alerte-rsvp-${a.jour}`} /> : null}
              {a.genre === 'a-marquer' ? <BoutonHub theme={theme} titre={tr('planning.accueilPlanning.marquer')} onPress={() => onAller('module:attendance')} testID={`esport-alerte-marquer-${a.jour}`} /> : null}
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
  const [saison, setSaison] = useState('');
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    if (actif && peut)
      api.reglages().then(
        r => {
          setEffectif(String(r.effectifMin));
          setRappel(String(r.rappelHeures));
          setSaison(r.debutSaison ?? '09-01');
        },
        () => undefined,
      );
  }, [actif, peut, api]);
  if (!actif || !peut) return null;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="esport-parametres-planning">
      <Intertitre theme={theme}>{tr('planning.accueilPlanning.planning')}</Intertitre>
      <Champ theme={theme} libelle={tr('planning.accueilPlanning.fuseau_horaire_de_la')} valeur={fuseau} onChanger={setFuseau} maxLength={60} placeholder="Europe/Paris" testID="esport-parametres-fuseau" />
      <Text style={attenue}>{tr('planning.accueilPlanning.heures_affichees_par_defaut', { v: fuseauAppareil() })}</Text>
      <View style={styles.ligne}>
        <Champ theme={theme} libelle={tr('planning.accueilPlanning.effectif_minimum')} valeur={effectif} onChanger={setEffectif} clavier="number-pad" maxLength={2} style={{ width: 150 }} testID="esport-parametres-effectif" />
        <Champ theme={theme} libelle={tr('planning.accueilPlanning.rappel_heures_avant_0')} valeur={rappel} onChanger={setRappel} clavier="number-pad" maxLength={3} style={{ width: 220 }} testID="esport-parametres-rappel" />
        <Champ theme={theme} libelle={tr('presence.debut_de_saison')} valeur={saison} onChanger={setSaison} maxLength={5} placeholder="09-01" style={{ width: 180 }} testID="esport-parametres-saison" />
      </View>
      <BoutonHub
        theme={theme}
        titre={tr('discord.enregistrer')}
        variante="plein"
        desactive={Boolean(enCours)}
        onPress={() =>
          void agir('planning', async () => {
            if (fuseau.trim() !== detail.team.fuseau) await client.requete(`/teams/${encodeURIComponent(detail.team.id)}`, 'PATCH', { fuseau: fuseau.trim() });
            await api.changerReglages({ effectifMin: Number(effectif), rappelHeures: Number(rappel), ...(saison.trim() ? { debutSaison: saison.trim() } : {}) });
            await onChange();
            return tr('planning.accueilPlanning.reglages_du_planning_enregistr');
          })
        }
        testID="esport-parametres-planning-enregistrer"
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-parametres-planning" />
    </Panneau>
  );
}

/**
 * Rôles Discord temporaires d'une team : personnes qui ont le rôle (jusqu'à quand, qui l'a donné, pourquoi), actions
 * Prolonger / Retirer, et formulaire « Donner » (recherche d'une personne du serveur Discord). Page de la team ›
 * Membres et rôles ; visible pour les rôles de la team autorisés à donner le rôle (réglage de la team) et le Fondateur.
 * Le serveur décide de tout (limite de personnes, hiérarchie des rôles…) : ses refus sont affichés tels quels.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trRt } from '../../i18n/rolesTemp';
import { apiRolesTemp, type EtatRolesTemp, type MembreDiscord } from '../../rolesTemp/api';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, Squelette, attenue, texte } from '../design';
import { dateHeure, dureeH, dureeRestante, entier } from './outils';

export function OctroisRolesTemp({ theme, client, teamId, maintenant = () => Date.now() }: { theme: ThemeHub; client: ClientEsport; teamId: string; maintenant?: () => number }) {
  const api = useMemo(() => apiRolesTemp(client, teamId), [client, teamId]);
  const [etat, setEtat] = useState<EtatRolesTemp | undefined>();
  // Sans droit (ou serveur ancien) : la section n'existe pas pour cette personne, sans message d'erreur.
  const [absent, setAbsent] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [trouves, setTrouves] = useState<MembreDiscord[] | undefined>();
  const [choisie, setChoisie] = useState<MembreDiscord | undefined>();
  const [duree, setDuree] = useState('');
  const [raison, setRaison] = useState('');
  const { erreur, avis, agir, enCours } = useAgir();
  const recharger = useCallback(async () => setEtat(await api.etat()), [api]);
  useEffect(() => {
    recharger().catch(() => setAbsent(true));
  }, [recharger]);
  if (absent) return null;
  if (!etat) return <Squelette theme={theme} lignes={3} testID="esport-rto-chargement" />;
  if (!etat.peutGerer) return null;
  const actif = etat.reglages.actif;
  const parDefaut = etat.reglages.dureeDefautH;
  const chercher = () =>
    void agir('chercher', async () => {
      setChoisie(undefined);
      setTrouves((await api.membres(recherche.trim())).membres);
    });
  const donner = () =>
    void agir('donner', async () => {
      if (!choisie) return;
      const r = await api.donner({ membreId: choisie.id, membreNom: choisie.nom, dureeH: duree.trim() ? entier(duree) : undefined, raison: raison.trim() || undefined });
      await recharger();
      setChoisie(undefined);
      setTrouves(undefined);
      setRecherche('');
      setRaison('');
      return trRt(r.prolonge ? 'redonne' : 'donne', { nom: choisie.nom, date: dateHeure(r.octroi.expireLe) });
    });
  return (
    <Panneau theme={theme} testID="esport-rto">
      <Intertitre theme={theme}>{trRt('liste_titre')}</Intertitre>
      <Text style={attenue(theme)}>{trRt('liste_aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rto" />
      {!actif ? <Text style={attenue(theme)} testID="esport-rto-inactif">{trRt('liste_inactif')}</Text> : null}
      {actif ? <Badge theme={theme} texte={`${etat.reglages.roleNom} · ${trRt('liste_compteur', { n: etat.actifs.length, max: etat.reglages.maxSimultanes })}`} testID="esport-rto-compteur" /> : null}
      {actif && !etat.actifs.length ? <Text style={attenue(theme)} testID="esport-rto-vide">{trRt('liste_vide')}</Text> : null}
      {etat.actifs.map(o => {
        const reste = Date.parse(o.expireLe) - maintenant();
        return (
          <View key={o.id} style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8, gap: 6 }} testID={`esport-rto-${o.id}`}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{o.membreNom || o.membreId}</Text>
            <Text style={attenue(theme)}>{`${reste > 0 ? trRt('expire_dans', { duree: dureeRestante(reste) }) : trRt('expire_passe')} · ${trRt('expire_le', { date: dateHeure(o.expireLe) })}`}</Text>
            <Text style={attenue(theme)}>{[o.accordeParNom ? trRt('donne_par', { nom: o.accordeParNom }) : '', o.raison ? trRt('raison', { raison: o.raison }) : ''].filter(Boolean).join(' · ')}</Text>
            {o.erreur ? <Text style={{ ...attenue(theme), color: theme.alerte }}>{trRt('echec_retrait', { n: o.essais, erreur: o.erreur })}</Text> : null}
            <View style={styles.ligne}>
              <BoutonHub
                theme={theme}
                titre={trRt('prolonger', { duree: dureeH(parDefaut) })}
                desactive={Boolean(enCours)}
                onPress={() =>
                  void agir('prolonger', async () => {
                    const r = await api.prolonger(o.id, parDefaut);
                    await recharger();
                    return trRt('prolonge', { date: dateHeure(r.octroi.expireLe) });
                  })
                }
                testID={`esport-rto-prolonger-${o.id}`}
              />
              <BoutonConfirme
                theme={theme}
                titre={trRt('retirer')}
                confirmation={trRt('retirer_confirmer')}
                desactive={Boolean(enCours)}
                onConfirme={() =>
                  void agir('retirer', async () => {
                    const r = await api.retirer(o.id);
                    await recharger();
                    return trRt(r.deja ? 'retire_deja' : 'retire');
                  })
                }
                testID={`esport-rto-retirer-${o.id}`}
              />
            </View>
          </View>
        );
      })}
      {actif ? (
        <View style={{ borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8, gap: 8 }} testID="esport-rto-donner">
          <Text style={{ ...texte(theme), fontWeight: '700' }}>{trRt('donner_titre')}</Text>
          <Champ theme={theme} libelle={trRt('chercher')} valeur={recherche} onChanger={setRecherche} maxLength={32} testID="esport-rto-recherche" />
          <Text style={attenue(theme)}>{trRt('chercher_aide')}</Text>
          <BoutonHub theme={theme} titre={trRt('chercher')} onPress={chercher} desactive={recherche.trim().length < 2 || enCours === 'chercher'} testID="esport-rto-chercher" />
          {trouves && !trouves.length ? <Text style={attenue(theme)} testID="esport-rto-aucun">{trRt('chercher_aucun')}</Text> : null}
          {trouves?.length ? <Choix theme={theme} libelle={trRt('chercher')} valeur={choisie?.id} options={trouves.map(m => ({ id: m.id, nom: m.nom }))} onChoisir={id => setChoisie(trouves.find(m => m.id === id))} testID="esport-rto-membre" /> : null}
          {choisie ? <Text style={texte(theme)} testID="esport-rto-choisie">{trRt('choisie', { nom: choisie.nom })}</Text> : null}
          <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trRt('duree_donner')} valeur={duree} placeholder={String(parDefaut)} onChanger={setDuree} maxLength={3} clavier="number-pad" testID="esport-rto-duree" style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
            <Champ theme={theme} libelle={trRt('raison_champ')} valeur={raison} onChanger={setRaison} maxLength={300} testID="esport-rto-raison" style={{ flexGrow: 3, flexBasis: 240, minWidth: 0 }} />
          </View>
          <BoutonHub theme={theme} variante="plein" titre={trRt('donner')} onPress={donner} desactive={!choisie || enCours === 'donner'} testID="esport-rto-donner-bouton" />
        </View>
      ) : null}
    </Panneau>
  );
}

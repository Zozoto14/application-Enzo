/**
 * Réglages des rôles Discord temporaires d'UNE team (page de la team › Discord, permission « Discord : gérer »;
 * docs/esport/bot-discord.md, « Rôles temporaires ») : rôle à donner (choisi parmi ceux du serveur), durée par défaut,
 * nombre de personnes en même temps, rôles de la team qui peuvent le donner, salon des journaux, message privé. Le
 * serveur valide tout (rôle relu chez Discord, hiérarchie des rôles) ; l'écran affiche ses avertissements.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trRt } from '../../i18n/rolesTemp';
import { apiRolesTemp, type EtatRolesTemp, type ReglagesRolesTemp, type ServeurRolesTemp } from '../../rolesTemp/api';
import { Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import { Squelette, attenue, texte } from '../design';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import { entier } from './outils';
import { SelecteurRole } from './SelecteurRole';

const AUCUN = '-';

const completer = (e: EtatRolesTemp): ReglagesRolesTemp => ({ roleId: null, rolesAutorises: [], salonJournalId: null, mp: true, ...e.reglages });

export function ReglagesRolesTemp({ theme, client, teamId }: { theme: ThemeHub; client: ClientEsport; teamId: string }) {
  const api = useMemo(() => apiRolesTemp(client, teamId), [client, teamId]);
  const [etat, setEtat] = useState<EtatRolesTemp | undefined>();
  const [r, setR] = useState<ReglagesRolesTemp | undefined>();
  const [serveur, setServeur] = useState<ServeurRolesTemp | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const recevoir = useCallback((e: EtatRolesTemp) => {
    setEtat(e);
    setR(completer(e));
  }, []);
  const lireServeur = useCallback(() => agir('discord', async () => setServeur(await api.discord())), [agir, api]);
  useEffect(() => {
    void agir('charger', async () => {
      const e = await api.etat();
      recevoir(e);
      if (e.peutRegler) setServeur(await api.discord().catch(() => undefined));
    });
  }, [agir, api, recevoir]);
  if (!etat || !r) return <Squelette theme={theme} lignes={4} testID="esport-rt-chargement" />;
  if (!etat.peutRegler) return null;
  const roles = (serveur?.roles ?? []).map(x => ({ id: x.id, nom: x.nom, couleur: x.couleur, position: x.position }));
  const choisi = roles.find(x => x.id === r.roleId);
  const salons = [{ id: AUCUN, nom: trRt('journal_aucun') }, ...(serveur?.salons ?? []).map(s => ({ id: s.id, nom: `# ${s.nom}` }))];
  const sousLeBot = Boolean(choisi && serveur?.positionBot !== undefined && choisi.position >= serveur.positionBot);
  const enregistrer = () =>
    void agir('enregistrer', async () => {
      const e = await api.changer({ ...r, roleNom: choisi?.nom ?? r.roleNom });
      recevoir(e);
      if (e.avertissement === 'hierarchie') return trRt('hierarchie_enregistre');
      if (e.avertissement === 'gerer_roles') return trRt('gerer_roles_enregistre');
      return trRt('enregistre');
    });
  return (
    <Panneau theme={theme} testID="esport-rt-reglages">
      <Intertitre theme={theme}>{trRt('titre')}</Intertitre>
      <Text style={attenue(theme)}>{trRt('aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rt" />
      {!etat.bot ? <Avis theme={theme} genre="critique" texte={trRt('sans_bot')} testID="esport-rt-sans-bot" /> : null}
      {!etat.serveur ? <Avis theme={theme} genre="alerte" texte={trRt('sans_serveur')} testID="esport-rt-sans-serveur" /> : null}
      {serveur?.erreur && serveur.erreur !== 'sans-serveur' ? <Avis theme={theme} genre="alerte" texte={trRt('erreur_discord', { code: serveur.erreur })} testID="esport-rt-erreur-discord" /> : null}
      {serveur && serveur.bot && !serveur.erreur && serveur.gererRoles === false ? <Avis theme={theme} genre="alerte" texte={trRt('gerer_roles')} testID="esport-rt-gerer-roles" /> : null}
      {sousLeBot && choisi ? <Avis theme={theme} genre="alerte" texte={trRt('hierarchie', { bot: serveur?.roleBot ?? 'bot', role: choisi.nom })} testID="esport-rt-hierarchie" /> : null}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trRt('actif')}</Text>
        <Interrupteur theme={theme} libelle={trRt('actif')} valeur={r.actif} onChanger={actif => setR({ ...r, actif })} testID="esport-rt-actif" />
      </View>
      <Text style={attenue(theme)}>{trRt('role_aide')}</Text>
      {serveur?.roles ? (
        <SelecteurRole theme={theme} libelle={trRt('role')} valeur={r.roleId} roles={roles} positionBot={serveur.positionBot} onChoisir={roleId => setR({ ...r, roleId, roleNom: roles.find(x => x.id === roleId)?.nom ?? '' })} testID="esport-rt-role" />
      ) : (
        <Text style={texte(theme)} testID="esport-rt-role-actuel">
          {r.roleId ? trRt('role_actuel', { nom: r.roleNom || r.roleId }) : trRt('role_aucun')}
        </Text>
      )}
      {r.roleId && serveur?.roles && choisi ? <Text style={attenue(theme)}>{trRt('role_actuel', { nom: choisi.nom })}</Text> : null}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trRt('duree')} valeur={String(r.dureeDefautH)} onChanger={v => setR({ ...r, dureeDefautH: entier(v) })} maxLength={3} clavier="number-pad" testID="esport-rt-duree" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
        <Champ theme={theme} libelle={trRt('maximum')} valeur={String(r.maxSimultanes)} onChanger={v => setR({ ...r, maxSimultanes: entier(v) })} maxLength={3} clavier="number-pad" testID="esport-rt-maximum" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
      </View>
      <Text style={attenue(theme)}>{trRt('duree_aide', { min: etat.limites.dureeMinH, max: etat.limites.dureeMaxH })}</Text>
      <Text style={attenue(theme)}>{trRt('maximum_aide', { min: etat.limites.maxMin, max: etat.limites.maxMax })}</Text>
      <ChoixMultiple theme={theme} libelle={trRt('autorises')} valeurs={r.rolesAutorises} options={etat.rolesEquipe.map(x => ({ id: x.id, nom: x.nom }))} onChanger={rolesAutorises => setR({ ...r, rolesAutorises })} max={etat.limites.roles} testID="esport-rt-autorises" />
      <Text style={attenue(theme)}>{r.rolesAutorises.length ? trRt('autorises_aide') : `${trRt('autorises_aide')} ${trRt('autorises_defaut')}`}</Text>
      {serveur?.salons ? <SelecteurRepliable theme={theme} nature="salon" libelle={trRt('journal')} valeur={r.salonJournalId ?? AUCUN} options={salons} onChoisir={id => setR({ ...r, salonJournalId: id === AUCUN ? null : id })} testID="esport-rt-journal" /> : null}
      <Text style={attenue(theme)}>{trRt('journal_aide')}</Text>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trRt('mp')}</Text>
        <Interrupteur theme={theme} libelle={trRt('mp')} valeur={r.mp} onChanger={mp => setR({ ...r, mp })} testID="esport-rt-mp" />
      </View>
      <Text style={attenue(theme)}>{trRt('commande')}</Text>
      <View style={styles.ligne}>
        <BoutonHub theme={theme} variante="plein" titre={trRt('enregistrer')} onPress={enregistrer} desactive={enCours === 'enregistrer'} testID="esport-rt-enregistrer" />
        <BoutonHub theme={theme} titre={trRt('lire_serveur')} onPress={() => void lireServeur()} desactive={enCours === 'discord' || !etat.bot} testID="esport-rt-lire" />
      </View>
    </Panneau>
  );
}

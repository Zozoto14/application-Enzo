/**
 * Administration › Événements › fiche › « Rôles staff supplémentaires » (docs/esport/evenements.md) : des rôles Discord
 * qui ont les mêmes droits que le rôle staff de l'événement.
 *  - Choisir un rôle EXISTANT du serveur (sélecteur repliable, ordre de la hiérarchie) : les rôles dangereux sont grisés
 *    avec la raison (Administrateur / Gérer le serveur / Gérer les rôles, gérés, au niveau du bot ou au-dessus). Le
 *    choix demande une confirmation : « Ce rôle existe déjà sur le serveur : il sera SUPPRIMÉ de Discord à la fin de
 *    l'événement, pour tous ses membres » (ajouter en le supprimant à la fin, ou sans le supprimer).
 *  - « Créer un rôle staff » : nom, couleur, libellé, membres (staff de l'événement) ; le rôle appartient à
 *    l'événement et sera supprimé avec lui.
 *  - Par rôle : libellé court du salon du staff (`{role}`), interrupteur « Supprimer ce rôle à la fin de l'événement »,
 *    retrait. Enregistré avec la fiche (bouton « Enregistrer ») ; la création, elle, est immédiate.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trEv, type CleEv } from '../../i18n/evenements';
import type { FicheEvenement, RolesServeur, StaffRoleSup } from '../../evenements/api';
import { etiquetteRole } from '../../evenements/etiquette';
import { Intertitre, styles } from '../commun';
import { Badge, ESP, attenue, texte } from '../design';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import { SelecteurRepliable, optionsRoles } from '../../../ui/selecteurs/SelecteurRepliable';

const LIBELLE_MAX = 40;

export function RolesStaffSup({
  theme,
  valeur,
  onChanger,
  roles,
  onLireRoles,
  lectureRoles,
  fiche,
  nomEvenement,
  onCreer,
  creation,
}: {
  theme: ThemeHub;
  valeur: StaffRoleSup[];
  onChanger(v: StaffRoleSup[]): void;
  roles: RolesServeur | undefined;
  onLireRoles(): void;
  lectureRoles: boolean;
  fiche?: FicheEvenement;
  nomEvenement: string;
  /** « Créer un rôle staff » (fiche existante seulement). */
  onCreer?(c: { nom: string; couleur: string | null; label: string; membres: string[] }): void;
  creation?: boolean;
}) {
  const [aConfirmer, setAConfirmer] = useState<string | undefined>();
  const [nouveau, setNouveau] = useState<{ nom: string; couleur: string; label: string; membres: string[] } | undefined>();
  const pris = new Set([...valeur.map(e => e.id), ...(fiche?.evenement.discord.staffRoleId ? [fiche.evenement.discord.staffRoleId] : [])]);
  const serveur = (roles?.roles ?? []).filter(r => !r.bot && !pris.has(r.id));
  const options = optionsRoles(serveur).map(o => {
    const r = serveur.find(x => x.id === o.id);
    return { ...o, desactive: Boolean(r?.interdit), nom: r?.interdit ? `${o.nom} · ${trEv(`staff.interdit.${r.interdit}` as CleEv)}` : o.nom };
  });
  const role = (id: string) => (roles?.roles ?? []).find(r => r.id === id);
  const maj = (id: string, m: Partial<StaffRoleSup>) => onChanger(valeur.map(e => (e.id === id ? { ...e, ...m } : e)));
  const ajouter = (id: string, supprimerFin: boolean) => {
    const r = role(id);
    onChanger([...valeur, { id, nom: r?.nom ?? id, label: '', couleur: r?.couleur ?? null, supprimerFin, cree: false, membres: [] }]);
    setAConfirmer(undefined);
  };
  const staff = (fiche?.staff ?? []).map(m => ({ id: m.discordId, nom: m.nom || m.discordId }));
  return (
    <View style={{ gap: ESP.xs }} testID="esport-ev-staff-sup">
      <Intertitre theme={theme}>{trEv('staff.roles_sup')}</Intertitre>
      <Text style={attenue(theme)}>{trEv('staff.roles_sup_aide')}</Text>
      {valeur.map(e => (
        <View key={e.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xxs }} testID={`esport-ev-staff-sup-${e.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), fontWeight: '700', flex: 1, minWidth: 0 }} numberOfLines={1}>
              {e.nom || e.id}
            </Text>
            <Badge theme={theme} ton={e.cree ? 'accent' : 'neutre'} texte={trEv(e.cree ? 'staff.sup_cree' : 'staff.sup_existant')} />
          </View>
          <Champ theme={theme} libelle={trEv('staff.sup_label')} valeur={e.label} placeholder={etiquetteRole(e.nom, nomEvenement)} onChanger={label => maj(e.id, { label })} maxLength={LIBELLE_MAX} testID={`esport-ev-staff-sup-${e.id}-label`} />
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trEv('staff.sup_supprimer_fin')}</Text>
            <Interrupteur theme={theme} libelle={trEv('staff.sup_supprimer_fin')} valeur={e.supprimerFin} onChanger={supprimerFin => maj(e.id, { supprimerFin })} testID={`esport-ev-staff-sup-${e.id}-supprimer`} />
          </View>
          {e.supprimerFin && !e.cree ? <Avis theme={theme} genre="critique" texte={trEv('staff.sup_existant_supprime')} testID={`esport-ev-staff-sup-${e.id}-alerte`} /> : null}
          {e.cree && staff.length ? <ChoixMultiple theme={theme} nature="membre" libelle={trEv('staff.sup_membres')} valeurs={e.membres} options={staff} onChanger={membres => maj(e.id, { membres })} max={50} testID={`esport-ev-staff-sup-${e.id}-membres`} /> : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} variante="danger" titre={trEv('staff.sup_retirer')} onPress={() => onChanger(valeur.filter(x => x.id !== e.id))} testID={`esport-ev-staff-sup-${e.id}-retirer`} />
          </View>
        </View>
      ))}
      {aConfirmer ? (
        // Confirmation d'un rôle existant : il sera SUPPRIMÉ de Discord à la fin (désactivable).
        <View style={{ gap: ESP.xs }} testID="esport-ev-staff-sup-confirmation">
          <Avis theme={theme} genre="critique" texte={trEv('staff.sup_confirmer', { nom: role(aConfirmer)?.nom ?? aConfirmer })} />
          <View style={styles.ligne}>
            <BoutonHub theme={theme} variante="danger" titre={trEv('staff.sup_ajouter_supprime')} onPress={() => ajouter(aConfirmer, true)} testID="esport-ev-staff-sup-confirmer" />
            <BoutonHub theme={theme} titre={trEv('staff.sup_ajouter_garde')} onPress={() => ajouter(aConfirmer, false)} testID="esport-ev-staff-sup-garder" />
            <BoutonHub theme={theme} titre={trEv('annuler')} onPress={() => setAConfirmer(undefined)} testID="esport-ev-staff-sup-annuler" />
          </View>
        </View>
      ) : roles?.roles.length ? (
        <SelecteurRepliable theme={theme} nature="role" libelle={trEv('staff.sup_choisir')} options={options} valeur={undefined} onChoisir={setAConfirmer} testID="esport-ev-staff-sup-choisir" />
      ) : (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trEv('staff.roles_sup_lire')} onPress={onLireRoles} desactive={lectureRoles} testID="esport-ev-staff-roles-sup-lire" />
        </View>
      )}
      {onCreer ? (
        nouveau ? (
          <View style={{ gap: ESP.xs }} testID="esport-ev-staff-sup-creation">
            <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
              <Champ theme={theme} libelle={trEv('staff.sup_nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={100} placeholder={`Casteur ${nomEvenement}`.trim()} testID="esport-ev-staff-sup-nom" style={{ flexGrow: 2, flexBasis: 200, minWidth: 0 }} />
              <Champ theme={theme} libelle={trEv('couleur')} valeur={nouveau.couleur} onChanger={couleur => setNouveau({ ...nouveau, couleur })} maxLength={7} placeholder="#e4572e" testID="esport-ev-staff-sup-couleur" style={{ flexGrow: 1, flexBasis: 120, minWidth: 0 }} />
            </View>
            <Champ theme={theme} libelle={trEv('staff.sup_label')} valeur={nouveau.label} placeholder={etiquetteRole(nouveau.nom, nomEvenement)} onChanger={label => setNouveau({ ...nouveau, label })} maxLength={LIBELLE_MAX} testID="esport-ev-staff-sup-nouveau-label" />
            {staff.length ? <ChoixMultiple theme={theme} nature="membre" libelle={trEv('staff.sup_membres')} valeurs={nouveau.membres} options={staff} onChanger={membres => setNouveau({ ...nouveau, membres })} max={50} testID="esport-ev-staff-sup-nouveau-membres" /> : <Text style={attenue(theme)}>{trEv('staff.sup_membres_vide')}</Text>}
            <Text style={attenue(theme)}>{trEv('staff.sup_cree_aide')}</Text>
            <View style={styles.ligne}>
              <BoutonHub
                theme={theme}
                variante="plein"
                titre={trEv('staff.sup_creer_bouton')}
                desactive={!nouveau.nom.trim() || creation}
                onPress={() => {
                  onCreer({ nom: nouveau.nom.trim(), couleur: nouveau.couleur.trim() || null, label: nouveau.label.trim(), membres: nouveau.membres });
                  setNouveau(undefined);
                }}
                testID="esport-ev-staff-sup-creer"
              />
              <BoutonHub theme={theme} titre={trEv('annuler')} onPress={() => setNouveau(undefined)} testID="esport-ev-staff-sup-creer-annuler" />
            </View>
          </View>
        ) : (
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={trEv('staff.sup_creer')} onPress={() => setNouveau({ nom: '', couleur: '', label: '', membres: [] })} testID="esport-ev-staff-sup-nouveau" />
          </View>
        )
      ) : null}
    </View>
  );
}

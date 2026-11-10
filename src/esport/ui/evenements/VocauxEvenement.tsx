/**
 * Administration › Événements › fiche › « Vocaux de l'événement » (docs/esport/evenements.md, docs/esport/vocaux.md) :
 * les hubs vocaux de l'événement se créent, se modifient et se retirent ICI, et seulement ici (Bot Esport HQ les montre
 * en lecture seule). Même stockage que les salons vocaux temporaires (réglages `vocaux`, hubs dont `tournoiId` est
 * l'événement) : aucune deuxième source. Par hub : salon vocal (sélecteur repliable, salons rangés par catégorie),
 * catégorie des salons créés, modèle du nom (`{tag} — {nom}`), places par défaut, rôles autorisés en plus (casters,
 * admins) ; verrouillage implicite. Lignes en lecture seule : le rôle staff de l'événement entre d'office dans tous les
 * vocaux d'équipe (puce « inclus automatiquement » sous les rôles autorisés), chaque salon est verrouillé sur le rôle de
 * son équipe. Lire : evenements.gerer ; modifier : en plus vocaux.configurer (le serveur contrôle).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { trEv } from '../../i18n/evenements';
import type { FicheEvenement, SaisieHubEvenement, VocauxEvenement as Vocaux, apiEvenements } from '../../evenements/api';
import { apiVocaux, type Hub, type ServeurVocaux } from '../../vocaux/api';
import { BoutonConfirme, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte } from '../design';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import { SelecteurRepliable, optionsRoles, optionsSalons } from '../../../ui/selecteurs/SelecteurRepliable';
import { OptionsHub } from '../vocaux/OptionsHub';

type Api = ReturnType<typeof apiEvenements>;
const AUCUN = '-';
const NOUVEAU = '__nouveau__';
const entier = (v: string): number => {
  const n = Number.parseInt(v.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** Puce du rôle staff de l'événement, toujours admis (lecture seule), à côté des rôles autorisés en plus. */
export function PuceStaffAuto({ theme, role, testID }: { theme: ThemeHub; role: { nom: string } | null | undefined; testID?: string }) {
  return <Badge theme={theme} ton="accent" texte={role ? trEv('voc.staff_chip', { nom: role.nom || '?' }) : trEv('voc.staff_chip_absent')} testID={testID} />;
}

export function VocauxEvenement({ theme, api, client, fiche }: { theme: ThemeHub; api: Api; client: ClientEsport; fiche: FicheEvenement }) {
  const id = fiche.evenement.id;
  const vc = useMemo(() => apiVocaux(client), [client]);
  const [v, setV] = useState<Vocaux | undefined>();
  const [serveur, setServeur] = useState<ServeurVocaux | undefined>();
  // Hub en cours d'édition (son salon d'origine, ou NOUVEAU) et sa saisie.
  const [edite, setEdite] = useState<string | undefined>();
  const [saisie, setSaisie] = useState<Hub | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const charger = useCallback(
    () =>
      agir('charger', async () => {
        const x = await api.vocaux(id);
        setV(x);
        if (x.peutModifier) setServeur(await vc.discord().catch(() => undefined));
      }),
    [agir, api, id, vc],
  );
  useEffect(() => {
    void charger();
  }, [charger]);
  if (!v) return erreur ? <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-voc" /> : null;
  const salons = serveur?.salons ?? [];
  const nomSalon = (h: Hub) => salons.find(s => s.id === h.id)?.nom || h.nom || h.id || trEv('voc.salon_a_choisir');
  const roles = optionsRoles(serveur?.roles ?? []);
  const nomRole = (r: string) => roles.find(o => o.id === r)?.nom ?? r;
  const categories = [{ id: AUCUN, nom: trEv('voc.categorie_meme') }, ...optionsSalons(salons, ['categorie'])];
  const ouvrir = (h?: Hub) => {
    setEdite(h ? h.id : NOUVEAU);
    setSaisie(h ? { ...h } : { id: '', nom: '', categorieId: null, modeleNom: v.choix.modeleDefaut, limite: 0, verrouille: true, tournoiId: id, rolesAutorises: [], placerSousHub: true, visibleNonJoignable: false, masquerHub: true, modeleStaff: v.choix.modeleStaffDefaut });
  };
  const fermer = () => {
    setEdite(undefined);
    setSaisie(undefined);
  };
  const enregistrer = () =>
    void agir('enregistrer', async () => {
      if (!saisie?.id) throw new Error(trEv('voc.salon_requis'));
      const c: SaisieHubEvenement = { id: saisie.id, nom: salons.find(s => s.id === saisie.id)?.nom ?? saisie.nom, categorieId: saisie.categorieId, modeleNom: saisie.modeleNom, limite: saisie.limite, rolesAutorises: saisie.rolesAutorises, placerSousHub: saisie.placerSousHub !== false, visibleNonJoignable: saisie.visibleNonJoignable === true, masquerHub: saisie.masquerHub !== false, modeleStaff: saisie.modeleStaff ?? v.choix.modeleStaffDefaut };
      setV(edite === NOUVEAU || !edite ? await api.ajouterHub(id, c) : await api.modifierHub(id, edite, c));
      fermer();
      return trEv('voc.enregistre');
    });
  const formulaire = (h: Hub) => {
    // Salons proposés : les vocaux libres (pas déjà pris par un autre hub, de l'événement ou non).
    const pris = new Set([...v.autresHubs, ...v.hubs.map(x => x.id).filter(x => x !== edite)]);
    const vocaux = optionsSalons(salons, ['vocal']).filter(o => !pris.has(o.id));
    const maj = (m: Partial<Hub>) => setSaisie({ ...h, ...m });
    return (
      <View style={{ gap: ESP.xs }} testID="esport-ev-voc-formulaire">
        {vocaux.length ? <SelecteurRepliable theme={theme} nature="salon" libelle={trEv('voc.salon')} valeur={h.id || undefined} options={vocaux} onChoisir={x => maj({ id: x })} testID="esport-ev-voc-salon" /> : <Avis theme={theme} genre="alerte" texte={trEv('voc.sans_salons')} />}
        {categories.length > 1 ? <SelecteurRepliable theme={theme} nature="categorie" libelle={trEv('voc.categorie')} valeur={h.categorieId ?? AUCUN} options={categories} onChoisir={x => maj({ categorieId: x === AUCUN ? null : x })} testID="esport-ev-voc-categorie" /> : null}
        <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={trEv('voc.modele')} valeur={h.modeleNom} onChanger={modeleNom => maj({ modeleNom })} maxLength={v.choix.limites.modele} testID="esport-ev-voc-modele" style={{ flexGrow: 2, flexBasis: 220, minWidth: 0 }} />
          <Champ theme={theme} libelle={trEv('voc.limite')} valeur={String(h.limite)} onChanger={x => maj({ limite: entier(x) })} maxLength={2} clavier="number-pad" testID="esport-ev-voc-limite" style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
        </View>
        <ChoixMultiple theme={theme} libelle={trEv('voc.roles')} valeurs={h.rolesAutorises} options={roles.filter(o => o.id !== v.staffRole?.id)} onChanger={rolesAutorises => maj({ rolesAutorises })} max={v.choix.limites.roles} testID="esport-ev-voc-roles" />
        <PuceStaffAuto theme={theme} role={v.staffRole} testID="esport-ev-voc-staff-puce" />
        <Text style={attenue(theme)}>{trEv('voc.verrou')}</Text>
        <Champ theme={theme} libelle={trEv('voc.modele_staff')} valeur={h.modeleStaff ?? v.choix.modeleStaffDefaut ?? ''} onChanger={modeleStaff => maj({ modeleStaff })} maxLength={v.choix.limites.modele} testID="esport-ev-voc-modele-staff" />
        <Text style={attenue(theme)}>{trEv('voc.modele_staff_aide')}</Text>
        <OptionsHub theme={theme} hub={h} onChanger={maj} evenement roles={roles} max={v.choix.limites.roles} testID="esport-ev-voc-options" />
        <View style={styles.ligne}>
          <BoutonHub theme={theme} variante="plein" titre={trEv('voc.enregistrer')} onPress={enregistrer} desactive={enCours === 'enregistrer'} testID="esport-ev-voc-enregistrer" />
          <BoutonHub theme={theme} titre={trEv('voc.annuler')} onPress={fermer} testID="esport-ev-voc-annuler" />
        </View>
      </View>
    );
  };
  return (
    <Carte theme={theme} dense testID="esport-ev-vocaux">
      <TitreCarte theme={theme} titre={trEv('voc.titre')} />
      <Text style={attenue(theme, 13)}>{trEv('voc.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-voc" />
      {/* Rôle staff et rôles des équipes : rappels en lecture seule. */}
      <Text style={texte(theme, 14)} testID="esport-ev-voc-staff">
        {v.staffRole ? trEv('voc.staff', { nom: v.staffRole.nom || v.staffRole.id }) : trEv('voc.staff_absent')}
      </Text>
      <Text style={attenue(theme)} testID="esport-ev-voc-equipes">
        {trEv('voc.equipes')}
      </Text>
      {!v.actif && v.hubs.length ? <Avis theme={theme} genre="alerte" texte={trEv('voc.inactif')} testID="esport-ev-voc-inactif" /> : null}
      {!v.peutModifier ? <Avis theme={theme} genre="info" texte={trEv('voc.sans_droit')} testID="esport-ev-voc-sans-droit" /> : null}
      {!v.hubs.length && edite !== NOUVEAU ? <Text style={attenue(theme)}>{trEv('voc.vide')}</Text> : null}
      {v.hubs.map((h, i) => (
        <View key={h.id} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-ev-voc-hub-${h.id}`}>
          {edite === h.id && saisie ? (
            formulaire(saisie)
          ) : (
            <>
              <Pressable disabled={!v.peutModifier} onPress={() => ouvrir(h)} accessibilityRole={v.peutModifier ? 'button' : undefined} style={{ gap: 2 }} testID={`esport-ev-voc-hub-${h.id}-entete`}>
                <Text style={{ ...texte(theme), fontWeight: '700' }}>{trEv('voc.hub', { n: String(i + 1) })}</Text>
                <Text style={attenue(theme)} numberOfLines={2} testID={`esport-ev-voc-hub-${h.id}-resume`}>
                  {trEv('voc.resume', { salon: nomSalon(h), modele: h.modeleNom, places: h.limite ? trEv('voc.places', { n: String(h.limite) }) : trEv('voc.places_illimite') })}
                </Text>
              </Pressable>
              <Text style={attenue(theme)} testID={`esport-ev-voc-hub-${h.id}-roles`}>
                {trEv('voc.roles_lecture', { liste: h.rolesAutorises.length ? h.rolesAutorises.map(nomRole).join(', ') : trEv('voc.aucun') })}
              </Text>
              <PuceStaffAuto theme={theme} role={v.staffRole} testID={`esport-ev-voc-hub-${h.id}-staff`} />
              {v.peutModifier ? (
                <View style={styles.ligne}>
                  <BoutonHub theme={theme} titre={trEv('ouvrir')} onPress={() => ouvrir(h)} testID={`esport-ev-voc-hub-${h.id}-modifier`} />
                  <BoutonConfirme
                    theme={theme}
                    titre={trEv('voc.retirer')}
                    confirmation={trEv('voc.retirer_confirmer')}
                    onConfirme={() =>
                      void agir('retirer', async () => {
                        setV(await api.retirerHub(id, h.id));
                        fermer();
                        return trEv('voc.retire');
                      })
                    }
                    testID={`esport-ev-voc-hub-${h.id}-retirer`}
                  />
                </View>
              ) : null}
            </>
          )}
        </View>
      ))}
      {edite === NOUVEAU && saisie ? (
        <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }}>
          <Text style={{ ...texte(theme), fontWeight: '700' }}>{trEv('voc.nouveau')}</Text>
          {formulaire(saisie)}
        </View>
      ) : v.peutModifier && v.hubs.length < v.choix.limites.hubs ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trEv('voc.ajouter')} onPress={() => ouvrir()} desactive={edite !== undefined} testID="esport-ev-voc-ajouter" />
        </View>
      ) : null}
    </Carte>
  );
}

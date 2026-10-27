/**
 * Équipe CM (cm.gerer) : rôles CM du club et leurs permissions (cm.voir, cm.deposer, cm.editer, cm.valider,
 * cm.gerer, cm.clips.proposer), comme les rôles d'une team ; « Responsable CM » et « Correspondant CM » sont
 * des rôles système (permissions modifiables, « Rétablir ») ; affectations d'un compte à un rôle, pour tout le
 * club ou pour une team (le correspondant, membre actif de la team). Anti-escalade côté serveur.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type Affectation, type ApiCm, type PermissionCm, type RoleCm, type TeamCm } from '../../cm/api';
import { minuscules } from '../../i18n';
import { trCm, type CleCm } from '../../i18n/cm';
import { BoutonConfirme, Choix, PastilleRole, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte } from '../design';
import { PALETTE, Teinte } from './commun';

export const nomPermissionCm = (p: PermissionCm): string => trCm(`perm.${p}` as CleCm);
/** Nom d'un rôle CM : les rôles système sont traduits. */
export const nomRoleCm = (r: { nom: string; cle: string | null }): string => (r.cle ? trCm(`role.${r.cle}` as CleCm) : r.nom);

export function RolesCm({ theme, api, large }: { theme: ThemeHub; api: ApiCm; large: boolean }) {
  const [roles, setRoles] = useState<RoleCm[] | undefined>();
  const [permissions, setPermissions] = useState<PermissionCm[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [edition, setEdition] = useState<Record<string, PermissionCm[]>>({});
  const [nouveau, setNouveau] = useState<{ nom: string; couleur: string; permissions: PermissionCm[] } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const r = await api.roles();
    setRoles(r.roles);
    setPermissions(r.permissions);
    setAffectations((await api.affectations()).affectations);
  }, [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const faire = (cle: string, action: () => Promise<unknown>, message?: string) =>
    agir(cle, async () => {
      await action();
      await charger();
      return message;
    });
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-roles">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-roles" />
      <Carte theme={theme}>
        <TitreCarte theme={theme} titre={trCm('roles.titre')} sous={trCm('roles.aide')} droite={<BoutonHub theme={theme} titre={trCm('roles.nouveau')} onPress={() => setNouveau({ nom: '', couleur: PALETTE[4][0], permissions: ['cm.voir'] })} testID="esport-cm-role-nouveau" />} />
        {roles?.map(r => {
          const choisies = edition[r.id] ?? r.permissions;
          const modifie = Boolean(edition[r.id]) && edition[r.id].slice().sort().join() !== r.permissions.slice().sort().join();
          return (
            <View key={r.id} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID={`esport-cm-role-${r.cle ?? r.id}`}>
              <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <PastilleRole theme={theme} nom={nomRoleCm(r)} couleur={r.couleur} />
                  {r.systeme ? <Badge theme={theme} texte={trCm('roles.systeme')} /> : null}
                  {r.modifie ? <Badge theme={theme} ton="alerte" texte={trCm('roles.modifie')} /> : null}
                  <Text style={attenue(theme)}>{trCm('roles.affectations_n', { n: r.affectations })}</Text>
                </View>
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  {r.systeme && r.modifie ? <BoutonHub theme={theme} titre={trCm('roles.retablir')} onPress={() => void faire('retablir', () => api.retablirRole(r.id))} testID={`esport-cm-role-${r.cle ?? r.id}-retablir`} /> : null}
                  {!r.systeme ? <BoutonConfirme theme={theme} titre={trCm('c.supprimer')} confirmation={trCm('roles.supprimer_confirmer')} onConfirme={() => void faire('supprimer', () => api.supprimerRole(r.id))} testID={`esport-cm-role-${r.id}-supprimer`} /> : null}
                </View>
              </View>
              <View style={{ flexDirection: large ? 'row' : 'column', flexWrap: 'wrap', gap: ESP.xs }}>
                {permissions.map(p => (
                  <View key={p} style={[styles.ligne, { gap: ESP.xs, minWidth: large ? 220 : undefined }]}>
                    <Case
                      theme={theme}
                      coche={choisies.includes(p)}
                      libelle={`${nomRoleCm(r)} : ${nomPermissionCm(p)}`}
                      onChanger={v => setEdition(e => ({ ...e, [r.id]: v ? [...choisies, p] : choisies.filter(x => x !== p) }))}
                      testID={`esport-cm-role-${r.cle ?? r.id}-${p}`}
                    />
                    <Text style={texte(theme, 13)}>{nomPermissionCm(p)}</Text>
                  </View>
                ))}
              </View>
              {modifie ? (
                <View style={[styles.ligne, { gap: ESP.xs }]}>
                  <BoutonHub
                    theme={theme}
                    titre={trCm('c.enregistrer')}
                    variante="plein"
                    onPress={() =>
                      void faire('role', async () => {
                        await api.modifierRole(r.id, { permissions: choisies });
                        setEdition(e => {
                          const reste = { ...e };
                          delete reste[r.id];
                          return reste;
                        });
                      }, trCm('c.enregistre'))
                    }
                    testID={`esport-cm-role-${r.cle ?? r.id}-enregistrer`}
                  />
                  <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setEdition(e => ({ ...e, [r.id]: r.permissions }))} testID={`esport-cm-role-${r.cle ?? r.id}-annuler`} />
                </View>
              ) : null}
            </View>
          );
        })}
        {nouveau ? (
          <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID="esport-cm-role-formulaire">
            <Champ theme={theme} libelle={trCm('c.nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={40} testID="esport-cm-role-nom" />
            <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('c.couleur')}>
              {PALETTE.map(([couleur, cle]) => (
                <Teinte key={couleur} theme={theme} couleur={couleur} choisie={nouveau.couleur === couleur} libelle={trCm(cle)} onPress={() => setNouveau({ ...nouveau, couleur })} />
              ))}
            </View>
            {permissions.map(p => (
              <View key={p} style={[styles.ligne, { gap: ESP.xs }]}>
                <Case theme={theme} coche={nouveau.permissions.includes(p)} libelle={nomPermissionCm(p)} onChanger={v => setNouveau({ ...nouveau, permissions: v ? [...nouveau.permissions, p] : nouveau.permissions.filter(x => x !== p) })} testID={`esport-cm-role-nouveau-${p}`} />
                <Text style={texte(theme, 13)}>{nomPermissionCm(p)}</Text>
              </View>
            ))}
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub
                theme={theme}
                titre={trCm('c.creer')}
                variante="plein"
                desactive={nouveau.nom.trim().length < 2}
                onPress={() =>
                  void faire('creer', async () => {
                    await api.creerRole({ nom: nouveau.nom.trim(), couleur: nouveau.couleur, permissions: nouveau.permissions });
                    setNouveau(undefined);
                  })
                }
                testID="esport-cm-role-creer"
              />
              <BoutonHub theme={theme} titre={trCm('c.annuler')} onPress={() => setNouveau(undefined)} testID="esport-cm-role-creer-annuler" />
            </View>
          </View>
        ) : null}
      </Carte>
      <Affectations theme={theme} api={api} roles={roles ?? []} affectations={affectations} faire={faire} />
    </View>
  );
}

function Affectations({ theme, api, roles, affectations, faire }: { theme: ThemeHub; api: ApiCm; roles: RoleCm[]; affectations: Affectation[]; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const [comptes, setComptes] = useState<Array<{ compte: string; pseudo: string; teams: TeamCm[] }> | undefined>();
  const [q, setQ] = useState('');
  const [choix, setChoix] = useState<{ compte: string; roleId: string; portee: string } | undefined>();
  useEffect(() => {
    api
      .comptes()
      .then(x => setComptes(x.comptes))
      .catch(() => setComptes([]));
  }, [api]);
  const trouves = useMemo(() => (q.trim().length >= 1 ? (comptes ?? []).filter(c => minuscules(c.pseudo).includes(minuscules(q.trim()))).slice(0, 12) : []), [comptes, q]);
  const compte = comptes?.find(c => c.compte === choix?.compte);
  return (
    <Carte theme={theme} testID="esport-cm-affectations">
      <TitreCarte theme={theme} titre={trCm('affectations.titre')} sous={trCm('affectations.aide')} />
      {!affectations.length ? <Text style={attenue(theme)}>{trCm('affectations.vide')}</Text> : null}
      {affectations.map(a => (
        <View key={a.id} style={[styles.ligne, { justifyContent: 'space-between' }]} testID={`esport-cm-affectation-${a.compte}`}>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{a.pseudo ?? a.compte}</Text>
            <PastilleRole theme={theme} nom={nomRoleCm(a.role)} couleur={a.role.couleur} />
            <Badge theme={theme} ton={a.team ? 'neutre' : 'accent'} texte={a.team ? (a.team.nom ?? '') : trCm('portee.club')} />
          </View>
          <BoutonHub theme={theme} titre={trCm('affectations.retirer')} libelle={trCm('affectations.retirer_aria', { pseudo: a.pseudo ?? a.compte })} onPress={() => void faire('retirer', () => api.retirerAffectation(a.id))} testID={`esport-cm-affectation-${a.compte}-retirer`} />
        </View>
      ))}
      <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }}>
        <Champ theme={theme} libelle={trCm('affectations.chercher')} valeur={q} onChanger={setQ} maxLength={24} testID="esport-cm-affectation-q" />
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          {trouves.map(c => (
            <BoutonHub key={c.compte} theme={theme} titre={c.pseudo} variante={choix?.compte === c.compte ? 'plein' : 'normal'} onPress={() => setChoix({ compte: c.compte, roleId: roles[0]?.id ?? '', portee: PORTEE_CLUB })} testID={`esport-cm-affectation-compte-${c.compte}`} />
          ))}
        </View>
        {choix && compte ? (
          <View style={{ gap: ESP.xs }}>
            <Choix theme={theme} libelle={trCm('affectations.role')} valeur={choix.roleId} options={roles.map(r => ({ id: r.id, nom: nomRoleCm(r), couleur: r.couleur }))} onChoisir={roleId => setChoix({ ...choix, roleId })} testID="esport-cm-affectation-role" />
            <Choix theme={theme} libelle={trCm('affectations.portee')} valeur={choix.portee} options={[{ id: PORTEE_CLUB, nom: trCm('portee.club') }, ...compte.teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))]} onChoisir={portee => setChoix({ ...choix, portee })} testID="esport-cm-affectation-portee" />
            <BoutonHub theme={theme} titre={trCm('affectations.ajouter')} variante="plein" desactive={!choix.roleId} onPress={() => void faire('affecter', async () => { await api.affecter(choix); setChoix(undefined); setQ(''); })} testID="esport-cm-affectation-ajouter" />
          </View>
        ) : null}
      </View>
    </Carte>
  );
}

/**
 * Page Membres › « Rôles et permissions » (migration 0033 ; docs/esport/roles-permissions.md) : le Fondateur, et les
 * comptes qui ont la permission du club `roles.gerer`. Quatre sections :
 *  - Club : rôles du club (« Second CEO » et rôles personnalisés), leurs comptes ;
 *  - CM : rôles de la section CM (routes /cm/roles ; les affectations restent dans Espace CM › Équipe CM) ;
 *  - Teams : modèle des rôles des nouvelles teams (Fondateur) et rôles d'une team dont on gère les rôles ;
 *  - Journal des changements.
 * Une même matrice : permissions rangées par catégorie, description FR/EN du catalogue, « Sensible », recherche,
 * changements surlignés, Enregistrer / Annuler, Rétablir, Dupliquer, Supprimer. Le serveur décide de tout
 * (anti-escalade, réservé au Fondateur) : l'app grise seulement ce qu'il refuserait.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { nomRole, type ClientEsport, type Role } from '../../client';
import { apiCm, type RoleCm } from '../../cm/api';
import { dateCourte } from '../../libelles';
import { minuscules } from '../../i18n';
import { trCm } from '../../i18n/cm';
import { trRp, trnRp, type CleRp } from '../../i18n/roles';
import { CATEGORIES, apiRoles, categoriePermission, descriptionPermission, nomCategorie, permissionReservee, permissionSensible, type EntreeJournalRoles, type VueRoles } from '../../roles/api';
import { BoutonConfirme, PastilleRole, Retours, styles as communs, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, Onglets, SqueletteCartes, TitreCarte, attenue, texte } from '../design';
import { PageEsport } from '../CadreEsport';
import { PALETTE, Teinte } from '../cm/commun';
import { nomRoleCm } from '../cm/RolesCm';

type Section = 'club' | 'cm' | 'teams' | 'journal';

/** Un rôle tel que l'éditeur le montre (club, CM ou team). */
interface RoleEdite {
  id: string;
  nom: string;
  couleur: string;
  systeme: boolean;
  cle: string | null;
  permissions: string[];
  permissionsParDefaut?: string[];
  modifie?: boolean;
  /** Personne ne le modifie ici (Propriétaire ; Second CEO pour un délégué ; modèle pour un délégué). */
  lectureSeule?: string;
}


export function RolesPermissions({ theme, client, large }: { theme: ThemeHub; client: ClientEsport; large: boolean }) {
  const api = useMemo(() => apiRoles(client), [client]);
  const [vue, setVue] = useState<VueRoles | undefined>();
  const [section, setSection] = useState<Section>('club');
  const [q, setQ] = useState('');
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setVue(await api.vue()), [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Ce que l'acteur peut accorder : tout pour le Fondateur ; sinon ses permissions du club, jamais celles réservées.
  const accordable = useCallback((p: string) => Boolean(vue?.moi.fondateur) || (Boolean(vue?.moi.permissions.includes(p)) && !permissionReservee(p)), [vue]);

  return (
    <PageEsport large={large} testID="esport-roles-permissions">
      <EnTetePage theme={theme} large={large} titre={trRp('titre')} sous={trRp('sous')} />
      <Onglets
        theme={theme}
        entrees={(['club', 'cm', 'teams', 'journal'] as const).map(id => ({ id, libelle: trRp(`section.${id}`), description: trRp(`section.${id}_description` as CleRp) }))}
        actif={section}
        onChoisir={id => setSection(id as Section)}
        prefixe="esport-rp-section"
        testID="esport-rp-sections"
        pleineLargeur={!large}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rp" />
      {section !== 'journal' ? <Champ theme={theme} libelle={trRp('recherche')} placeholder={trRp('recherche_aide')} valeur={q} onChanger={setQ} maxLength={40} testID="esport-rp-recherche" /> : null}
      {!vue ? <SqueletteCartes theme={theme} n={2} large={large} /> : null}
      {vue && section === 'club' ? <SectionClub theme={theme} api={api} vue={vue} q={q} large={large} accordable={accordable} onChange={charger} /> : null}
      {vue && section === 'cm' ? <SectionCm theme={theme} client={client} vue={vue} q={q} large={large} accordable={accordable} /> : null}
      {vue && section === 'teams' ? <SectionTeams theme={theme} client={client} api={api} vue={vue} q={q} large={large} onChange={charger} /> : null}
      {vue && section === 'journal' ? <Journal theme={theme} api={api} /> : null}
    </PageEsport>
  );
}

// ------------------------------------------------------------------ Club

function SectionClub({ theme, api, vue, q, large, accordable, onChange }: { theme: ThemeHub; api: ReturnType<typeof apiRoles>; vue: VueRoles; q: string; large: boolean; accordable(p: string): boolean; onChange(): Promise<void> }) {
  const [choisi, setChoisi] = useState<string | undefined>(vue.globaux.roles[0]?.id);
  const role = vue.globaux.roles.find(r => r.id === choisi);
  const { erreur, avis, agir } = useAgir();
  const faire = (cle: string, action: () => Promise<unknown>, message?: string) =>
    agir(cle, async () => {
      await action();
      await onChange();
      return message;
    });
  const reserve = (cle: string | null) => !vue.moi.fondateur && cle === 'second_ceo';
  const roles: RoleEdite[] = vue.globaux.roles.map(r => ({ ...r, lectureSeule: reserve(r.cle) ? trRp('lecture_seule') : undefined }));
  return (
    <View style={{ gap: ESP.m }}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rp-club" />
      <Editeur
        theme={theme}
        prefixe="esport-rp-club"
        roles={roles}
        choisi={choisi}
        onChoisir={setChoisi}
        nomDe={r => r.nom}
        aide={r => (r.cle === 'second_ceo' ? trRp('second_ceo.aide') : undefined)}
        permissions={vue.globaux.permissions}
        q={q}
        large={large}
        accordable={accordable}
        onEnregistrer={(r, permissions) => faire('club', () => api.modifier(r.id, { permissions }), trRp('enregistre'))}
        onRetablir={r => faire('club', () => api.retablir(r.id), trRp('retabli'))}
        onSupprimer={r => faire('club', async () => {
          await api.supprimer(r.id);
          setChoisi(undefined);
        }, trRp('supprime'))}
        onCreer={x => faire('club', async () => setChoisi((await api.creer(x)).id), trRp('cree'))}
      />
      {role ? <QuiAUnRoleClub theme={theme} api={api} vue={vue} role={role} lectureSeule={reserve(role.cle)} faire={faire} /> : null}
    </View>
  );
}

function QuiAUnRoleClub({ theme, api, vue, role, lectureSeule, faire }: { theme: ThemeHub; api: ReturnType<typeof apiRoles>; vue: VueRoles; role: VueRoles['globaux']['roles'][number]; lectureSeule: boolean; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const [q, setQ] = useState('');
  const trouves = useMemo(
    () => (q.trim() ? vue.comptes.filter(c => minuscules(c.pseudo).includes(minuscules(q.trim())) && !role.comptes.some(x => x.compte === c.compte)).slice(0, 10) : []),
    [q, vue.comptes, role.comptes],
  );
  return (
    <Carte theme={theme} testID="esport-rp-club-qui">
      <TitreCarte theme={theme} titre={trRp('qui.titre')} sous={trRp('qui.fondateur')} />
      {!role.comptes.length ? <Text style={attenue(theme)}>{trRp('qui.vide')}</Text> : null}
      {role.comptes.map(c => (
        <View key={c.compte} style={[communs.ligne, { justifyContent: 'space-between' }]} testID={`esport-rp-club-qui-${c.compte}`}>
          <View style={[communs.ligne, { gap: ESP.xs }]}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{c.pseudo ?? c.compte}</Text>
            {c.depuis ? <Text style={attenue(theme)}>{dateCourte(c.depuis)}</Text> : null}
          </View>
          {!lectureSeule ? (
            <BoutonHub theme={theme} titre={trRp('qui.retirer')} libelle={trRp('qui.retirer_aria', { pseudo: c.pseudo ?? c.compte })} onPress={() => void faire('retirer', () => api.retirer(role.id, c.compte), trRp('qui.retire', { pseudo: c.pseudo ?? c.compte }))} testID={`esport-rp-club-retirer-${c.compte}`} />
          ) : null}
        </View>
      ))}
      {!lectureSeule ? (
        <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }}>
          <Champ theme={theme} libelle={trRp('qui.chercher')} valeur={q} onChanger={setQ} maxLength={24} testID="esport-rp-club-qui-q" />
          <View style={[communs.ligne, { gap: ESP.xs }]}>
            {trouves.map(c => (
              <BoutonHub
                key={c.compte}
                theme={theme}
                titre={`+ ${c.pseudo}`}
                libelle={`${trRp('qui.ajouter')} : ${c.pseudo}`}
                onPress={() =>
                  void faire('attribuer', async () => {
                    await api.attribuer(role.id, c.compte);
                    setQ('');
                  }, trRp('qui.attribue', { pseudo: c.pseudo }))
                }
                testID={`esport-rp-club-donner-${c.compte}`}
              />
            ))}
          </View>
        </View>
      ) : null}
    </Carte>
  );
}

// ------------------------------------------------------------------ CM

function SectionCm({ theme, client, vue, q, large, accordable }: { theme: ThemeHub; client: ClientEsport; vue: VueRoles; q: string; large: boolean; accordable(p: string): boolean }) {
  const api = useMemo(() => apiCm(client), [client]);
  const [roles, setRoles] = useState<RoleCm[] | undefined>();
  const [titulaires, setTitulaires] = useState<Record<string, string[]>>({});
  const [choisi, setChoisi] = useState<string | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const r = await api.roles();
    setRoles(r.roles);
    setChoisi(c => c ?? r.roles[0]?.id);
    const a = await api.affectations();
    const parRole: Record<string, string[]> = {};
    for (const x of a.affectations) (parRole[x.role.id] ??= []).push(`${x.pseudo ?? x.compte} · ${x.team?.nom ?? trRp('qui.cm_club')}`);
    setTitulaires(parRole);
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
    <View style={{ gap: ESP.m }}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rp-cm" />
      {!roles ? <SqueletteCartes theme={theme} n={1} large={large} /> : null}
      {roles ? (
        <Editeur
          theme={theme}
          prefixe="esport-rp-cm"
          roles={roles.map(r => ({ ...r }))}
          choisi={choisi}
          onChoisir={setChoisi}
          nomDe={nomRoleCm}
          permissions={vue.cm.permissions}
          q={q}
          large={large}
          // Anti-escalade CM : le serveur compte les permissions du club de l'acteur (affectations, rôles du club).
          accordable={accordable}
          onEnregistrer={(r, permissions) => faire('cm', () => api.modifierRole(r.id, { permissions: permissions as RoleCm['permissions'] }), trRp('enregistre'))}
          onRetablir={r => faire('cm', () => api.retablirRole(r.id), trRp('retabli'))}
          onSupprimer={r => faire('cm', async () => {
            await api.supprimerRole(r.id);
            setChoisi(undefined);
          }, trRp('supprime'))}
          onCreer={x => faire('cm', async () => setChoisi((await api.creerRole({ ...x, permissions: x.permissions as RoleCm['permissions'] })).id), trRp('cree'))}
        />
      ) : null}
      {choisi ? (
        <Carte theme={theme} testID="esport-rp-cm-qui">
          <TitreCarte theme={theme} titre={trRp('qui.titre')} sous={trRp('qui.cm_aide')} />
          {(titulaires[choisi] ?? []).length ? (titulaires[choisi] ?? []).map(t => <Text key={t} style={texte(theme)}>{t}</Text>) : <Text style={attenue(theme)}>{trRp('qui.vide')}</Text>}
        </Carte>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Teams

const MODELE = 'modele';

function SectionTeams({ theme, client, api, vue, q, large, onChange }: { theme: ThemeHub; client: ClientEsport; api: ReturnType<typeof apiRoles>; vue: VueRoles; q: string; large: boolean; onChange(): Promise<void> }) {
  const [team, setTeam] = useState<string>(vue.modele.modifiable || !vue.teams.length ? MODELE : vue.teams[0].id);
  const [roles, setRoles] = useState<Role[] | undefined>();
  const [choisi, setChoisi] = useState<string | undefined>();
  const { erreur, avis, agir } = useAgir();
  const chargerTeam = useCallback(async () => {
    if (team === MODELE) return;
    const r = await client.roles(team);
    setRoles(r);
    setChoisi(c => (c && r.some(x => x.id === c) ? c : (r.find(x => x.cle === 'manager') ?? r[0])?.id));
  }, [client, team]);
  useEffect(() => {
    setRoles(undefined);
    if (team === MODELE) setChoisi(c => (vue.modele.roles.some(r => r.cle === c) ? c : vue.modele.roles[0]?.cle));
    else void agir('', chargerTeam);
  }, [agir, chargerTeam, team, vue.modele.roles]);
  const faire = (cle: string, action: () => Promise<unknown>, message?: string) =>
    agir(cle, async () => {
      await action();
      if (team === MODELE) await onChange();
      else await chargerTeam();
      return message;
    });
  const options = [{ id: MODELE, nom: trRp('teams.modele') }, ...vue.teams.map(t => ({ id: t.id, nom: t.nom }))];
  const modele: RoleEdite[] = vue.modele.roles.map(r => ({ id: r.cle, nom: r.nom, couleur: r.couleur, systeme: true, cle: r.cle, permissions: r.permissions, permissionsParDefaut: r.permissionsParDefaut, modifie: r.modifie, lectureSeule: vue.modele.modifiable ? undefined : trRp('teams.modele_lecture') }));
  const deTeam: RoleEdite[] = (roles ?? []).map(r => ({ ...r, permissions: r.verrouille ? [...vue.modele.permissions] : r.permissions, lectureSeule: r.verrouille ? trRp('proprietaire_verrouille') : undefined }));
  return (
    <View style={{ gap: ESP.m }}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rp-teams" />
      <Carte theme={theme}>
        <ChoixListe theme={theme} libelle={trRp('teams.choix')} valeur={team} options={options} onChoisir={setTeam} testID="esport-rp-team" />
        <Text style={attenue(theme)}>{team === MODELE ? trRp('teams.modele_aide') : trRp('qui.team_aide')}</Text>
        {!vue.teams.length && team !== MODELE ? <Text style={attenue(theme)}>{trRp('teams.aucune')}</Text> : null}
      </Carte>
      {team === MODELE ? (
        <Editeur
          theme={theme}
          prefixe="esport-rp-modele"
          roles={modele}
          choisi={choisi}
          onChoisir={setChoisi}
          nomDe={r => nomRole(r.nom)}
          permissions={vue.modele.permissions}
          q={q}
          large={large}
          accordable={() => vue.modele.modifiable}
          onEnregistrer={(r, permissions) => faire('modele', () => api.modifierModele(r.id, permissions), trRp('enregistre'))}
          onRetablir={r => faire('modele', () => api.retablirModele(r.id), trRp('retabli'))}
        />
      ) : roles ? (
        <Editeur
          theme={theme}
          prefixe="esport-rp-team"
          roles={deTeam}
          choisi={choisi}
          onChoisir={setChoisi}
          nomDe={r => nomRole(r.nom)}
          detail={r => trnRp('qui.membres', roles.find(x => x.id === r.id)?.membres ?? 0)}
          permissions={vue.modele.permissions}
          q={q}
          large={large}
          // Anti-escalade de la team : vérifiée par le serveur (permissions de l'acteur DANS la team).
          accordable={() => true}
          onEnregistrer={(r, permissions) => faire('team', () => client.modifierRole(team, r.id, { permissions }), trRp('enregistre'))}
          onRetablir={r => faire('team', () => client.retablirRole(team, r.id), trRp('retabli'))}
          onSupprimer={r => faire('team', async () => {
            await client.supprimerRole(team, r.id);
            setChoisi(undefined);
          }, trRp('supprime'))}
          onCreer={x => faire('team', async () => setChoisi((await client.creerRole(team, x)).id), trRp('cree'))}
        />
      ) : (
        <SqueletteCartes theme={theme} n={1} large={large} />
      )}
    </View>
  );
}

/** Liste de choix (pastilles qui passent à la ligne), pour un nombre quelconque d'options. */
function ChoixListe({ theme, libelle, valeur, options, onChoisir, testID }: { theme: ThemeHub; libelle: string; valeur: string | undefined; options: ReadonlyArray<{ id: string; nom: string; couleur?: string }>; onChoisir(id: string): void; testID: string }) {
  return (
    <View style={{ gap: ESP.xs }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text>
      <View style={[communs.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup" accessibilityLabel={libelle}>
        {options.map(o => {
          const actif = o.id === valeur;
          const c = o.couleur ?? theme.accent;
          return (
            <Pressable
              key={o.id}
              testID={`${testID}-${o.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={`${libelle} : ${o.nom}`}
              onPress={() => onChoisir(o.id)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: Math.min(theme.rayonMoyen, 10), borderColor: actif ? c : theme.ligne, backgroundColor: actif ? teinteTransparente(c, 0.18) : theme.surface }}>
              {o.couleur ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: o.couleur }} /> : null}
              <Text style={{ color: theme.texte, fontSize: 14, fontWeight: actif ? '700' : '500', ...police(theme.policeTexte) }}>{o.nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Éditeur commun (rôles + matrice)

function Editeur({
  theme,
  prefixe,
  roles,
  choisi,
  onChoisir,
  nomDe,
  aide,
  detail,
  permissions,
  q,
  large,
  accordable,
  onEnregistrer,
  onRetablir,
  onSupprimer,
  onCreer,
}: {
  theme: ThemeHub;
  prefixe: string;
  roles: RoleEdite[];
  choisi: string | undefined;
  onChoisir(id: string): void;
  nomDe(r: { nom: string; cle: string | null }): string;
  aide?(r: RoleEdite): string | undefined;
  detail?(r: RoleEdite): string | undefined;
  permissions: readonly string[];
  q: string;
  large: boolean;
  accordable(p: string): boolean;
  onEnregistrer(r: RoleEdite, permissions: string[]): Promise<boolean>;
  onRetablir?(r: RoleEdite): Promise<boolean>;
  onSupprimer?(r: RoleEdite): Promise<boolean>;
  onCreer?(x: { nom: string; couleur: string; permissions: string[] }): Promise<boolean>;
}) {
  const role = roles.find(r => r.id === choisi) ?? roles[0];
  const [edition, setEdition] = useState<string[] | undefined>();
  const [nouveau, setNouveau] = useState<{ nom: string; couleur: string; permissions: string[] } | undefined>();
  const [confirmer, setConfirmer] = useState(false);
  useEffect(() => {
    setEdition(undefined);
    setConfirmer(false);
  }, [role?.id, role?.permissions]);
  const coches = nouveau ? nouveau.permissions : (edition ?? role?.permissions ?? []);
  const changees = role && edition ? [...edition.filter(p => !role.permissions.includes(p)), ...role.permissions.filter(p => !edition.includes(p))] : [];
  const sensiblesAjoutees = role && edition ? edition.filter(p => !role.permissions.includes(p) && permissionSensible(p)) : [];
  const lecture = nouveau ? undefined : role?.lectureSeule;
  const basculer = (p: string, v: boolean) => {
    if (nouveau) setNouveau({ ...nouveau, permissions: v ? [...nouveau.permissions, p] : nouveau.permissions.filter(x => x !== p) });
    else if (role) {
      const base = edition ?? role.permissions;
      setEdition(v ? [...base, p] : base.filter(x => x !== p));
      setConfirmer(false);
    }
  };
  const enregistrer = async () => {
    if (!role || !edition) return;
    if (sensiblesAjoutees.length && !confirmer) {
      setConfirmer(true);
      return;
    }
    if (await onEnregistrer(role, edition)) setEdition(undefined);
    setConfirmer(false);
  };
  return (
    <Carte theme={theme} testID={`${prefixe}-editeur`}>
      <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trRp('roles')}</Text>
        {onCreer && !nouveau ? <BoutonHub theme={theme} titre={trRp('nouveau')} onPress={() => setNouveau({ nom: '', couleur: PALETTE[5][0], permissions: [] })} testID={`${prefixe}-nouveau`} /> : null}
      </View>
      <View style={[communs.ligne, { gap: ESP.xs }]} accessibilityRole="radiogroup" accessibilityLabel={trRp('roles')}>
        {roles.map(r => {
          const actif = !nouveau && r.id === role?.id;
          return (
            <Pressable
              key={r.id}
              testID={`${prefixe}-role-${r.cle ?? r.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={nomDe(r)}
              onPress={() => {
                setNouveau(undefined);
                onChoisir(r.id);
              }}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, borderBottomWidth: 3, borderBottomColor: actif ? r.couleur : 'transparent' }}>
              <PastilleRole theme={theme} nom={`${nomDe(r)}${r.modifie ? ' •' : ''}`} couleur={r.couleur} />
            </Pressable>
          );
        })}
      </View>
      {nouveau ? (
        <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID={`${prefixe}-formulaire`}>
          <Champ theme={theme} libelle={trRp('nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={40} testID={`${prefixe}-nom`} />
          <View style={[communs.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trRp('couleur')}>
            {PALETTE.map(([couleur, cle]) => (
              <Teinte key={couleur} theme={theme} couleur={couleur} choisie={nouveau.couleur === couleur} libelle={trCm(cle)} onPress={() => setNouveau({ ...nouveau, couleur })} />
            ))}
          </View>
          <View style={[communs.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trRp('creer')}
              variante="plein"
              desactive={nouveau.nom.trim().length < 2}
              onPress={() =>
                void onCreer?.({ ...nouveau, nom: nouveau.nom.trim() }).then(ok => {
                  if (ok) setNouveau(undefined);
                })
              }
              testID={`${prefixe}-creer`}
            />
            <BoutonHub theme={theme} titre={trRp('annuler')} onPress={() => setNouveau(undefined)} testID={`${prefixe}-creer-annuler`} />
          </View>
        </View>
      ) : role ? (
        <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }}>
          <View style={[communs.ligne, { gap: ESP.xs }]}>
            <Text style={{ ...texte(theme, 18), fontWeight: '800' }} accessibilityRole="header">
              {nomDe(role)}
            </Text>
            {role.systeme ? <Badge theme={theme} texte={trRp('systeme')} /> : null}
            {role.modifie ? <Badge theme={theme} ton="alerte" texte={trRp('modifie')} testID={`${prefixe}-modifie`} /> : null}
            {lecture ? <Badge theme={theme} texte={trRp('verrouille')} /> : null}
            <Text style={attenue(theme)}>{trnRp('coches', coches.length)}</Text>
            {detail?.(role) ? <Text style={attenue(theme)}>{detail(role)}</Text> : null}
          </View>
          {aide?.(role) ? <Text style={attenue(theme, 14)}>{aide(role)}</Text> : null}
          {lecture ? <Text style={attenue(theme)}>{lecture}</Text> : null}
          {!lecture ? (
            <View style={[communs.ligne, { gap: ESP.xs }]}>
              {role.permissionsParDefaut && role.modifie && onRetablir ? (
                <BoutonConfirme theme={theme} titre={trRp('retablir')} confirmation={trRp('retablir')} onConfirme={() => void onRetablir(role)} testID={`${prefixe}-retablir`} />
              ) : null}
              {onCreer ? (
                <BoutonHub
                  theme={theme}
                  titre={trRp('dupliquer')}
                  onPress={() => setNouveau({ nom: trRp('copie', { nom: nomDe(role) }).slice(0, 40), couleur: role.couleur, permissions: (edition ?? role.permissions).filter(p => accordable(p)) })}
                  testID={`${prefixe}-dupliquer`}
                />
              ) : null}
              {!role.systeme && onSupprimer ? <BoutonConfirme theme={theme} titre={trRp('supprimer')} confirmation={trRp('supprimer_confirmer')} onConfirme={() => void onSupprimer(role)} testID={`${prefixe}-supprimer`} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {role || nouveau ? <Matrice theme={theme} prefixe={prefixe} permissions={permissions} coches={coches} reference={nouveau ? undefined : role?.permissions} q={q} large={large} modifiable={p => !lecture && accordable(p)} onBasculer={basculer} /> : null}
      {changees.length && !nouveau ? (
        <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID={`${prefixe}-barre`}>
          {confirmer ? <Text style={{ ...texte(theme), color: theme.alerte }}>{trRp('confirmer_sensibles', { liste: sensiblesAjoutees.join(', ') })}</Text> : null}
          <View style={[communs.ligne, { gap: ESP.xs }]}>
            <Text style={{ ...texte(theme), fontWeight: '700' }} testID={`${prefixe}-compteur`}>
              {trnRp('changements', changees.length)}
            </Text>
            <BoutonHub theme={theme} titre={confirmer ? trRp('confirmer') : trRp('enregistrer')} variante="plein" onPress={() => void enregistrer()} testID={`${prefixe}-enregistrer`} />
            <BoutonHub
              theme={theme}
              titre={trRp('annuler')}
              onPress={() => {
                setEdition(undefined);
                setConfirmer(false);
              }}
              testID={`${prefixe}-annuler`}
            />
          </View>
        </View>
      ) : null}
    </Carte>
  );
}

/** Matrice : permissions rangées par catégorie (ordre du catalogue), filtrées par la recherche. */
function Matrice({
  theme,
  prefixe,
  permissions,
  coches,
  reference,
  q,
  large,
  modifiable,
  onBasculer,
}: {
  theme: ThemeHub;
  prefixe: string;
  permissions: readonly string[];
  coches: readonly string[];
  reference?: readonly string[];
  q: string;
  large: boolean;
  modifiable(p: string): boolean;
  onBasculer(p: string, v: boolean): void;
}) {
  const filtre = minuscules(q.trim());
  const visibles = permissions.filter(p => !filtre || minuscules(p).includes(filtre) || minuscules(descriptionPermission(p)).includes(filtre) || minuscules(nomCategorie(categoriePermission(p))).includes(filtre));
  const groupes = CATEGORIES.map(c => ({ cle: c.cle, liste: visibles.filter(p => categoriePermission(p) === c.cle) })).filter(g => g.liste.length);
  if (!groupes.length) return <Text style={attenue(theme)}>{trRp('aucune')}</Text>;
  return (
    <View style={{ gap: ESP.m }} testID={`${prefixe}-matrice`}>
      {groupes.map(g => (
        <View key={g.cle} style={{ gap: 2 }} testID={`${prefixe}-categorie-${g.cle}`}>
          <View style={[communs.ligne, { gap: ESP.xs, borderBottomWidth: 1, borderBottomColor: theme.ligne, paddingBottom: 4 }]}>
            <Text style={{ ...texte(theme, 15), fontWeight: '800' }} accessibilityRole="header">
              {nomCategorie(g.cle)}
            </Text>
            <Text style={attenue(theme)}>{`${g.liste.filter(p => coches.includes(p)).length}/${g.liste.length}`}</Text>
          </View>
          <View style={{ flexDirection: large ? 'row' : 'column', flexWrap: 'wrap' }}>
            {g.liste.map(p => (
              <LignePermission key={p} theme={theme} prefixe={prefixe} permission={p} coche={coches.includes(p)} change={Boolean(reference) && coches.includes(p) !== Boolean(reference?.includes(p))} modifiable={modifiable(p)} large={large} onBasculer={v => onBasculer(p, v)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function LignePermission({ theme, prefixe, permission: p, coche, change, modifiable, large, onBasculer }: { theme: ThemeHub; prefixe: string; permission: string; coche: boolean; change: boolean; modifiable: boolean; large: boolean; onBasculer(v: boolean): void }) {
  const description = descriptionPermission(p);
  return (
    <Pressable
      testID={`${prefixe}-perm-${p}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: coche, disabled: !modifiable }}
      accessibilityLabel={description}
      accessibilityHint={!modifiable ? trRp('non_accordable') : undefined}
      disabled={!modifiable}
      onPress={() => onBasculer(!coche)}
      style={{
        flexDirection: 'row',
        gap: ESP.s,
        alignItems: 'flex-start',
        paddingVertical: ESP.xs,
        paddingHorizontal: ESP.xs,
        minHeight: 44,
        width: large ? '50%' : '100%',
        borderRadius: 8,
        backgroundColor: change ? teinteTransparente(theme.accent, 0.12) : 'transparent',
        opacity: modifiable ? 1 : 0.55,
      }}>
      <View style={{ width: 22, height: 22, marginTop: 1, borderRadius: 4, borderWidth: 2, alignItems: 'center', justifyContent: 'center', borderColor: coche ? theme.accent : theme.attenue, backgroundColor: coche ? theme.accent : 'transparent' }}>
        <Text style={{ color: theme.surAccent, fontSize: 13, fontWeight: '800' }}>{coche ? '✓' : ''}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={texte(theme, 14)}>{description}</Text>
        <View style={[communs.ligne, { gap: ESP.xs }]}>
          <Text style={{ ...attenue(theme, 12), fontFamily: 'monospace' }}>{p}</Text>
          {permissionSensible(p) ? <Badge theme={theme} ton="alerte" texte={trRp('sensible')} /> : null}
          {permissionReservee(p) ? <Badge theme={theme} ton="accent" texte={trRp('reservee')} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Journal

function Journal({ theme, api }: { theme: ThemeHub; api: ReturnType<typeof apiRoles> }) {
  const [entrees, setEntrees] = useState<EntreeJournalRoles[] | undefined>();
  const [noms, setNoms] = useState<Record<string, string>>({});
  const { erreur, agir } = useAgir();
  const charger = useCallback(
    async (avant?: string) => {
      const r = await api.journal(avant);
      setEntrees(e => (avant ? [...(e ?? []), ...r.entrees] : r.entrees));
      setNoms(n => ({ ...n, ...r.noms }));
    },
    [api],
  );
  useEffect(() => {
    void agir('', () => charger());
  }, [agir, charger]);
  const nom = (c: string | null | undefined) => (c === 'principal' ? trRp('fondateur') : c ? (noms[c] ?? c) : trRp('inconnu'));
  return (
    <Carte theme={theme} testID="esport-rp-journal">
      <Retours theme={theme} erreur={erreur} prefixe="esport-rp-journal" />
      {entrees && !entrees.length ? <Text style={attenue(theme)}>{trRp('journal.vide')}</Text> : null}
      {entrees?.map(e => {
        const details = [
          e.meta.ajoutees?.length ? trRp('journal.ajout', { liste: e.meta.ajoutees.join(', ') }) : '',
          e.meta.retirees?.length ? trRp('journal.retrait', { liste: e.meta.retirees.join(', ') }) : '',
          e.meta.retabli ? trRp('journal.retabli') : '',
          e.meta.compte ? trRp('journal.compte', { pseudo: nom(e.meta.compte) }) : '',
          e.team?.nom ?? '',
        ].filter(Boolean);
        return (
          <View key={e.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-rp-journal-${e.action}`}>
            <Text style={texte(theme)}>
              <Text style={{ fontWeight: '700' }}>{nom(e.acteur)}</Text>
              {` ${trRp(`action.${e.action}` as CleRp)} `}
              <Text style={{ fontWeight: '700' }}>{e.meta.nom ?? e.meta.role ?? (e.meta.cle ? nomRole(e.meta.cle) : '')}</Text>
            </Text>
            <Text style={attenue(theme)}>{[dateCourte(e.date), ...details].join(' · ')}</Text>
          </View>
        );
      })}
      {entrees && entrees.length >= 100 ? <BoutonHub theme={theme} titre={trRp('journal.plus')} onPress={() => void agir('', () => charger(entrees[entrees.length - 1]?.date))} testID="esport-rp-journal-plus" /> : null}
    </Carte>
  );
}

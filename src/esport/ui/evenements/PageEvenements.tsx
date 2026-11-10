/**
 * Administration › Événements (Fondateur, ou permission du club evenements.gerer ; docs/esport/evenements.md) :
 * les événements et tournois organisés PAR le club (ex. The Nuke End). Liste, création, et la fiche d'un événement :
 * informations (nom, jeu, dates, statut), inscriptions (catégorie de tickets), rôles Discord (rôles automatiques,
 * modèle du nom, couleur, rôle repère : « placer les nouveaux rôles juste en dessous du rôle… », suppression
 * automatique après la fin, rôle staff : nom, catégories de tickets de l'événement), staff (StaffEvenement.tsx) et
 * équipes participantes (EquipesEvenement.tsx). Le serveur valide tout.
 * Les tournois EXTÉRIEURS auxquels une team participe restent dans la team (Compétition › Tournois).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  Avis,
  BoutonHub,
  Champ,
  Interrupteur,
} from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { formaterDate, langueCourante } from '../../i18n';
import { trEv, type CleEv } from '../../i18n/evenements';
import {
  apiEvenements,
  type ChoixEvenements,
  type Evenement,
  type FicheEvenement,
  type RolesServeur,
  type SaisieEvenement,
  type StatutEvenement,
} from '../../evenements/api';
import {
  BoutonConfirme,
  Choix,
  Intertitre,
  Panneau as Bloc,
  Retours,
  styles,
  useAgir,
} from '../commun';
import {
  Badge,
  Carte,
  ESP,
  LARGEUR_CONTENU,
  Squelette,
  attenue,
  texte,
  type Ton,
} from '../design';
import { EquipesEvenement } from './EquipesEvenement';
import { StaffEvenement } from './StaffEvenement';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import { PositionRoles } from './PositionRoles';
import { ChampDate } from '../../../ui/dates';

const AUCUN = '-';
const TON: Record<StatutEvenement, Ton> = {
  a_venir: 'neutre',
  en_cours: 'alerte',
  termine: 'ok',
  annule: 'critique',
};
const quand = (iso: string | null | undefined) =>
  iso ? formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const dates = (e: Pick<Evenement, 'debut' | 'fin'>) =>
  e.debut || e.fin
    ? trEv('dates', { debut: e.debut ?? '?', fin: e.fin ?? '?' })
    : trEv('sans_date');

type Formulaire = {
  nom: string;
  jeu: string | null;
  debut: string;
  fin: string;
  statut: StatutEvenement;
  description: string;
  categorieTicketId: string | null;
  categoriesTickets: string[];
  staffModele: string;
  rolesAuto: boolean;
  modeleRole: string;
  couleur: string;
  roleAncreId: string | null;
  suppressionH: string;
};

const formulaireDe = (e?: Evenement, choix?: ChoixEvenements): Formulaire => ({
  nom: e?.nom ?? '',
  jeu: e?.jeu ?? null,
  debut: e?.debut ?? '',
  fin: e?.fin ?? '',
  statut: e?.statut ?? 'a_venir',
  description: e?.description ?? '',
  categorieTicketId: e?.categorieTicketId ?? null,
  categoriesTickets: e?.categoriesTickets ?? [],
  staffModele: e?.discord.staffModele ?? 'Staff {evenement}',
  rolesAuto: e?.discord.rolesAuto ?? true,
  modeleRole: e?.discord.modeleRole ?? choix?.modeleDefaut ?? '{tag} {nom}',
  couleur: e?.discord.couleur ?? '',
  roleAncreId: e?.discord.roleAncreId ?? null,
  suppressionH: String(
    e?.discord.suppressionH ?? choix?.suppressionDefautH ?? 24,
  ),
});

const saisieDe = (f: Formulaire): SaisieEvenement => ({
  nom: f.nom,
  jeu: f.jeu,
  debut: f.debut || null,
  fin: f.fin || null,
  statut: f.statut,
  description: f.description,
  categorieTicketId: f.categorieTicketId,
  categoriesTickets: f.categoriesTickets,
  discord: {
    staffModele: f.staffModele,
    rolesAuto: f.rolesAuto,
    modeleRole: f.modeleRole,
    couleur: f.couleur || null,
    roleAncreId: f.roleAncreId,
    suppressionH: Number(f.suppressionH || 0),
  },
});

/** Champs d'un événement : informations, inscriptions, rôles Discord. `fiche` : événement existant (catégories…). */
function Editeur({
  theme,
  f,
  setF,
  choix,
  fiche,
  roles,
  onLireRoles,
  lectureRoles,
}: {
  theme: ThemeHub;
  f: Formulaire;
  setF(f: Formulaire): void;
  choix: ChoixEvenements;
  fiche?: FicheEvenement;
  roles: RolesServeur | undefined;
  onLireRoles(): void;
  lectureRoles: boolean;
}) {
  const nomCategorie = (c: { nom: { fr: string; en: string } }) =>
    (langueCourante() === 'fr' ? c.nom.fr : c.nom.en) || c.nom.fr;
  return (
    <View style={{ gap: ESP.s }}>
      <Intertitre theme={theme}>{trEv('infos')}</Intertitre>
      <Champ
        theme={theme}
        libelle={trEv('nom')}
        valeur={f.nom}
        onChanger={nom => setF({ ...f, nom })}
        maxLength={choix.limites.nom}
        testID="esport-ev-nom"
      />
      {choix.jeux.length ? (
        <Choix
          theme={theme}
          libelle={trEv('jeu')}
          valeur={f.jeu ?? AUCUN}
          options={[
            { id: AUCUN, nom: trEv('jeu_aucun') },
            ...choix.jeux.map(j => ({ id: j.cle, nom: j.nom })),
          ]}
          onChoisir={id => setF({ ...f, jeu: id === AUCUN ? null : id })}
          testID="esport-ev-jeu"
        />
      ) : null}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <ChampDate
          theme={theme}
          libelle={trEv('debut')}
          valeur={f.debut}
          onChanger={debut => setF({ ...f, debut })}
          testID="esport-ev-debut"
          style={{ flexGrow: 1, flexBasis: 190, minWidth: 0 }}
        />
        <ChampDate
          theme={theme}
          libelle={trEv('fin')}
          valeur={f.fin}
          onChanger={fin => setF({ ...f, fin })}
          min={/^\d{4}-\d{2}-\d{2}$/.test(f.debut) ? f.debut : undefined}
          testID="esport-ev-fin"
          style={{ flexGrow: 1, flexBasis: 190, minWidth: 0 }}
        />
      </View>
      <Choix
        theme={theme}
        libelle={trEv('statut')}
        valeur={f.statut}
        options={choix.statuts.map(s => ({
          id: s,
          nom: trEv(`statut.${s}` as CleEv),
        }))}
        onChoisir={statut => setF({ ...f, statut })}
        testID="esport-ev-statut"
      />
      <Champ
        theme={theme}
        libelle={trEv('description')}
        valeur={f.description}
        onChanger={description => setF({ ...f, description })}
        maxLength={choix.limites.description}
        multiligne
        testID="esport-ev-description"
      />

      {fiche ? (
        <>
          <Intertitre theme={theme}>{trEv('inscriptions')}</Intertitre>
          <Text style={attenue(theme)}>{trEv('categorie_aide')}</Text>
          {fiche.categoriesTickets.length ? (
            <Choix
              theme={theme}
              libelle={trEv('categorie')}
              valeur={f.categorieTicketId ?? AUCUN}
              options={[
                { id: AUCUN, nom: trEv('categorie_aucune') },
                ...fiche.categoriesTickets.map(c => ({
                  id: c.id,
                  nom: nomCategorie(c),
                })),
              ]}
              onChoisir={id =>
                setF({ ...f, categorieTicketId: id === AUCUN ? null : id })
              }
              testID="esport-ev-categorie"
            />
          ) : null}
          {fiche.categoriesTickets.length ? (
            <>
              <ChoixMultiple theme={theme} nature="categorie" libelle={trEv('categories_evenement')} valeurs={f.categoriesTickets} options={fiche.categoriesTickets.map(c => ({ id: c.id, nom: nomCategorie(c) }))} onChanger={categoriesTickets => setF({ ...f, categoriesTickets })} max={10} testID="esport-ev-categories" />
              <Text style={attenue(theme)}>{trEv('categories_evenement_aide')}</Text>
            </>
          ) : null}
        </>
      ) : null}

      <Intertitre theme={theme}>{trEv('discord')}</Intertitre>
      {fiche && !fiche.serveur ? (
        <Avis theme={theme} genre="alerte" texte={trEv('sans_serveur')} />
      ) : null}
      {fiche && !fiche.bot ? (
        <Avis theme={theme} genre="alerte" texte={trEv('sans_bot')} />
      ) : null}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>
          {trEv('roles_auto')}
        </Text>
        <Interrupteur
          theme={theme}
          libelle={trEv('roles_auto')}
          valeur={f.rolesAuto}
          onChanger={rolesAuto => setF({ ...f, rolesAuto })}
          testID="esport-ev-roles-auto"
        />
      </View>
      <Text style={attenue(theme)}>{trEv('roles_auto_aide')}</Text>
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ
          theme={theme}
          libelle={trEv('modele')}
          valeur={f.modeleRole}
          onChanger={modeleRole => setF({ ...f, modeleRole })}
          maxLength={90}
          testID="esport-ev-modele"
          style={{ flexGrow: 2, flexBasis: 200, minWidth: 0 }}
        />
        <Champ
          theme={theme}
          libelle={trEv('couleur')}
          valeur={f.couleur}
          onChanger={couleur => setF({ ...f, couleur })}
          maxLength={7}
          placeholder="#e4572e"
          testID="esport-ev-couleur"
          style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }}
        />
      </View>
      <PositionRoles
        theme={theme}
        serveur={roles}
        valeur={f.roleAncreId}
        onChoisir={roleAncreId => setF({ ...f, roleAncreId })}
        onLire={onLireRoles}
        lecture={lectureRoles}
      />
      <Champ
        theme={theme}
        libelle={trEv('suppression')}
        valeur={f.suppressionH}
        onChanger={v => setF({ ...f, suppressionH: v.replace(/\D/g, '') })}
        maxLength={3}
        clavier="number-pad"
        testID="esport-ev-suppression"
      />
      <Text style={attenue(theme)}>{trEv('suppression_aide')}</Text>
      <Champ theme={theme} libelle={trEv('staff.modele')} valeur={f.staffModele} onChanger={staffModele => setF({ ...f, staffModele })} maxLength={90} testID="esport-ev-staff-modele" />
    </View>
  );
}

export function PageEvenements({
  theme,
  client,
  large,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
}) {
  const api = useMemo(() => apiEvenements(client), [client]);
  const [liste, setListe] = useState<
    { evenements: Evenement[]; choix: ChoixEvenements } | undefined
  >();
  const [ouvert, setOuvert] = useState<string | 'nouveau' | undefined>();
  const [fiche, setFiche] = useState<FicheEvenement | undefined>();
  const [f, setF] = useState<Formulaire>(formulaireDe());
  const [roles, setRoles] = useState<RolesServeur | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const relire = useCallback(
    () => agir('charger', async () => setListe(await api.lister())),
    [agir, api],
  );
  useEffect(() => {
    void relire();
  }, [relire]);
  const recevoir = useCallback((x: FicheEvenement) => {
    setFiche(x);
    setF(formulaireDe(x.evenement, x.choix));
  }, []);
  const lireRoles = () =>
    void agir('roles-serveur', async () => {
      setRoles(await api.rolesServeur());
    });
  const ouvrir = (id: string) =>
    void agir('ouvrir', async () => {
      recevoir(await api.lire(id));
      setOuvert(id);
    });
  const retour = () => {
    setOuvert(undefined);
    setFiche(undefined);
    void relire();
  };
  const Cadre = ScrollView;
  const proprietes = {
    contentContainerStyle: {
      padding: large ? ESP.xxl : ESP.m,
      gap: ESP.m,
      maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl,
      width: '100%' as const,
      alignSelf: 'center' as const,
    },
  };
  if (!liste) {
    return (
      <Cadre {...proprietes} testID="esport-administration-evenements">
        <Retours
          theme={theme}
          erreur={erreur}
          avis={avis}
          prefixe="esport-ev"
        />
        {erreur ? null : (
          <Squelette theme={theme} lignes={4} testID="esport-ev-chargement" />
        )}
      </Cadre>
    );
  }
  const choix = liste.choix;
  return (
    <Cadre {...proprietes} testID="esport-administration-evenements">
      <Text
        accessibilityRole="header"
        style={{ ...texte(theme, 20), fontWeight: '700' }}
      >
        {trEv('titre')}
      </Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev" />

      {ouvert === undefined ? (
        <>
          <Text style={attenue(theme)}>{trEv('aide')}</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              variante="plein"
              titre={trEv('nouveau')}
              onPress={() => {
                setF(formulaireDe(undefined, choix));
                setOuvert('nouveau');
              }}
              testID="esport-ev-nouveau"
            />
          </View>
          {!liste.evenements.length ? (
            <Text style={attenue(theme)} testID="esport-ev-vide">
              {trEv('vide')}
            </Text>
          ) : null}
          {liste.evenements.map(e => (
            <Carte
              key={e.id}
              theme={theme}
              dense
              onPress={() => ouvrir(e.id)}
              libelle={e.nom}
              testID={`esport-ev-${e.id}`}
            >
              <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                <Text
                  style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }}
                >
                  {e.nom}
                </Text>
                <Badge
                  theme={theme}
                  ton={TON[e.statut]}
                  texte={trEv(`statut.${e.statut}` as CleEv)}
                />
              </View>
              <Text style={attenue(theme)}>
                {dates(e)} · {trEv('n_equipes', { n: String(e.equipes ?? 0) })}
                {e.jeu
                  ? ` · ${choix.jeux.find(j => j.cle === e.jeu)?.nom ?? e.jeu}`
                  : ''}
              </Text>
            </Carte>
          ))}
        </>
      ) : ouvert === 'nouveau' ? (
        <Bloc theme={theme} testID="esport-ev-creation">
          <Editeur
            theme={theme}
            f={f}
            setF={setF}
            choix={choix}
            roles={roles}
            onLireRoles={lireRoles}
            lectureRoles={enCours === 'roles-serveur'}
          />
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              variante="plein"
              titre={trEv('creer')}
              desactive={!f.nom.trim() || enCours === 'creer'}
              onPress={() =>
                void agir('creer', async () => {
                  const x = await api.creer(saisieDe(f));
                  recevoir(x);
                  setOuvert(x.evenement.id);
                  return trEv('enregistre');
                })
              }
              testID="esport-ev-creer"
            />
            <BoutonHub
              theme={theme}
              titre={trEv('annuler')}
              onPress={() => setOuvert(undefined)}
              testID="esport-ev-annuler"
            />
          </View>
        </Bloc>
      ) : fiche ? (
        <>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub
              theme={theme}
              titre={trEv('retour')}
              onPress={retour}
              testID="esport-ev-retour"
            />
          </View>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text
              style={{ ...texte(theme, 18), fontWeight: '700', flexShrink: 1 }}
              testID="esport-ev-fiche-nom"
            >
              {fiche.evenement.nom}
            </Text>
            <Badge
              theme={theme}
              ton={TON[fiche.evenement.statut]}
              texte={trEv(`statut.${fiche.evenement.statut}` as CleEv)}
            />
          </View>
          <Text style={attenue(theme)}>{dates(fiche.evenement)}</Text>
          {fiche.evenement.discord.rolesCreesLe &&
          !fiche.evenement.discord.rolesSupprimesLe ? (
            <Text style={attenue(theme)} testID="esport-ev-crees">
              {trEv('roles_crees_le', {
                le: quand(fiche.evenement.discord.rolesCreesLe),
              })}
            </Text>
          ) : null}
          {fiche.evenement.discord.rolesSupprimesLe ? (
            <Text style={attenue(theme)}>
              {trEv('roles_supprimes_le', {
                le: quand(fiche.evenement.discord.rolesSupprimesLe),
              })}
            </Text>
          ) : null}
          {fiche.hubs.length ? (
            <Text style={attenue(theme)} testID="esport-ev-hubs">
              {trEv('hubs', {
                hubs: fiche.hubs.map(h => h.nom || h.id).join(', '),
              })}
            </Text>
          ) : (
            <Text style={attenue(theme)}>{trEv('hub_aide')}</Text>
          )}

          <Bloc theme={theme} testID="esport-ev-reglages">
            <Editeur
              theme={theme}
              f={f}
              setF={setF}
              choix={choix}
              fiche={fiche}
              roles={roles}
              onLireRoles={lireRoles}
              lectureRoles={enCours === 'roles-serveur'}
            />
            <View style={styles.ligne}>
              <BoutonHub
                theme={theme}
                variante="plein"
                titre={trEv('enregistrer')}
                desactive={enCours === 'enregistrer'}
                onPress={() =>
                  void agir(
                    'enregistrer',
                    async () => (
                      recevoir(
                        await api.modifier(fiche.evenement.id, saisieDe(f)),
                      ),
                      trEv('enregistre')
                    ),
                  )
                }
                testID="esport-ev-enregistrer"
              />
            </View>
          </Bloc>

          <StaffEvenement theme={theme} api={api} fiche={fiche} onFiche={setFiche} />

          <EquipesEvenement
            theme={theme}
            api={api}
            fiche={fiche}
            onFiche={setFiche}
            categorieId={fiche.evenement.categorieTicketId}
          />

          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonConfirme
              theme={theme}
              titre={trEv('supprimer')}
              confirmation={trEv('supprimer_confirmer')}
              onConfirme={() =>
                void agir('supprimer', async () => {
                  await api.supprimer(fiche.evenement.id);
                  retour();
                  return trEv('supprime');
                })
              }
              testID="esport-ev-supprimer"
            />
          </View>
        </>
      ) : (
        <Squelette theme={theme} lignes={4} />
      )}
    </Cadre>
  );
}

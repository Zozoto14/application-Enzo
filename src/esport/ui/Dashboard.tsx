/**
 * Dashboard de l'Esport (premier niveau) : résumé de TOUTES les teams de
 * l'utilisateur, en une seule requête (`GET /dashboard`).
 *
 * Bloc global : résumés à rédiger, événements de la semaine (toutes teams),
 * alertes. Puis une carte par team : prochains événements, présence récente,
 * résumés en attente, tâches en retard, dernière activité, membres. Le
 * serveur ne renvoie que les teams autorisées, et un bloc vaut `null` quand
 * le module est coupé ou que la permission manque : il n'est pas affiché.
 * Toucher une carte ouvre la team.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BoutonHub, Intertitre, Panneau } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type {
  CarteTeam,
  ClientEsport,
  OccurrenceTableau,
  Tableau,
} from '../client';
import { phraseJournal } from '../libelles';
import {
  PastilleRole,
  Retours,
  TitreSection,
  styles as communs,
  useAgir,
} from './commun';

const TYPES: Record<string, string> = {
  scrim: 'Scrim',
  match: 'Match',
  training: 'Entraînement',
  meeting: 'Réunion',
  tournament: 'Tournoi',
  other: 'Autre',
};

/** « jeu. 22/10 · 20:00 » (heure de l'appareil). */
export function quandCourt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const jours = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${jours[d.getDay()]} ${deux(d.getDate())}/${deux(
    d.getMonth() + 1,
  )} · ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** « il y a 3 h », « il y a 2 j ». */
export function depuis(iso: string, maintenant = Date.now()): string {
  const ecart = Math.max(0, maintenant - Date.parse(iso));
  if (Number.isNaN(ecart)) return '';
  const minutes = Math.round(ecart / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  return `il y a ${Math.round(heures / 24)} j`;
}

export function Dashboard({
  theme,
  client,
  large,
  onOuvrir,
  onBoite,
  onMembres,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  onOuvrir(teamId: string): void;
  onBoite(): void;
  onMembres?(): void;
}) {
  const [tableau, setTableau] = useState<Tableau | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(
    async () => setTableau(await client.tableau()),
    [client],
  );
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = {
    color: theme.attenue,
    fontSize: 13,
    ...police(theme.policeTexte),
  };
  const g = tableau?.global;

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        gap: 20,
        maxWidth: 1200,
        width: '100%',
        alignSelf: 'center',
      }}
      testID="esport-dashboard"
    >
      <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
        <TitreSection
          theme={theme}
          titre="Dashboard"
          sous="Toutes vos teams en un coup d’œil."
        />
        <BoutonHub
          theme={theme}
          titre="Actualiser"
          onPress={() => void agir('', charger)}
          testID="esport-dashboard-actualiser"
        />
      </View>
      <Retours theme={theme} erreur={erreur} prefixe="esport-dashboard" />
      {!tableau ? <Text style={attenue}>Chargement…</Text> : null}
      {tableau && tableau.teams.length === 0 ? (
        <Panneau theme={theme} testID="esport-dashboard-vide">
          <Text style={texte}>
            Vous n’êtes encore dans aucune team. Le Fondateur ou le staff de
            votre team vous y ajoute : elle apparaîtra ici d’elle-même.
          </Text>
        </Panneau>
      ) : null}
      {g && tableau && tableau.teams.length > 0 ? (
        <View
          style={
            large
              ? { flexDirection: 'row', gap: 16, alignItems: 'stretch' }
              : { gap: 16 }
          }
          testID="esport-dashboard-global"
        >
          {tableau.teams.some(t => t.resumes?.redacteur) ? (
            <Panneau
              theme={theme}
              style={large ? { flex: 1 } : undefined}
              testID="esport-dashboard-resumes"
            >
              <Text style={attenue}>Résumés à rédiger</Text>
              <Text
                style={[texte, { fontSize: 32, fontWeight: '800' }]}
                testID="esport-dashboard-resumes-nombre"
              >
                {g.resumesARediger}
              </Text>
              {g.resumesARediger > 0 ? (
                <BoutonHub
                  theme={theme}
                  titre="Boîte de réception"
                  onPress={onBoite}
                  testID="esport-dashboard-boite"
                />
              ) : (
                <Text style={attenue}>Rien en attente.</Text>
              )}
            </Panneau>
          ) : null}
          <Panneau
            theme={theme}
            style={large ? { flex: 2 } : undefined}
            testID="esport-dashboard-semaine"
          >
            <Intertitre
              theme={theme}
            >{`Cette semaine (${g.evenementsSemaine.length})`}</Intertitre>
            {g.evenementsSemaine.length === 0 ? (
              <Text style={attenue}>
                Aucun événement dans les 7 prochains jours.
              </Text>
            ) : null}
            {g.evenementsSemaine.slice(0, 8).map(o => (
              <LigneEvenement
                key={`${o.evenementId}-${o.cle}`}
                theme={theme}
                o={o}
                avecTeam
              />
            ))}
          </Panneau>
          <Panneau
            theme={theme}
            style={large ? { flex: 1.4 } : undefined}
            testID="esport-dashboard-alertes"
          >
            <Intertitre theme={theme}>{`Alertes${
              g.alertes.length ? ` (${g.alertes.length})` : ''
            }`}</Intertitre>
            {g.alertes.length === 0 ? (
              <Text style={attenue}>Tout est en ordre.</Text>
            ) : null}
            {g.alertes.map(a => (
              <Pressable
                key={`${a.genre}-${a.teamId}`}
                accessibilityRole="button"
                accessibilityLabel={`${a.teamNom} : ${a.texte}`}
                onPress={() =>
                  a.genre === 'invites' && onMembres
                    ? onMembres()
                    : onOuvrir(a.teamId)
                }
                style={{
                  flexDirection: 'row',
                  gap: 8,
                  alignItems: 'center',
                  minHeight: 32,
                }}
                testID={`esport-alerte-${a.genre}-${a.teamId}`}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor:
                      a.genre === 'invites' ? theme.accent : theme.alerte,
                  }}
                />
                <Text style={[texte, { flex: 1 }]}>
                  <Text style={{ fontWeight: '700' }}>{a.teamNom}</Text> ·{' '}
                  {a.texte}
                </Text>
              </Pressable>
            ))}
          </Panneau>
        </View>
      ) : null}
      {tableau && tableau.teams.length > 0 ? (
        <View
          style={[communs.ligne, { alignItems: 'stretch', gap: 16 }]}
          testID="esport-dashboard-teams"
        >
          {tableau.teams.map(c => (
            <CarteDashboard
              key={c.team.id}
              theme={theme}
              carte={c}
              large={large}
              onOuvrir={() => onOuvrir(c.team.id)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function LigneEvenement({
  theme,
  o,
  avecTeam,
}: {
  theme: ThemeHub;
  o: OccurrenceTableau;
  avecTeam?: boolean;
}) {
  const texte = {
    color: theme.texte,
    fontSize: 13,
    ...police(theme.policeTexte),
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
      <Text
        style={[
          texte,
          {
            color: theme.attenue,
            minWidth: 108,
            ...police(theme.policeChiffres),
          },
        ]}
      >
        {quandCourt(o.debut)}
      </Text>
      <Text style={[texte, { flex: 1 }]} numberOfLines={1}>
        {o.titre}
        <Text style={{ color: theme.attenue }}>{` · ${TYPES[o.type] ?? o.type}${
          avecTeam && o.teamNom ? ` · ${o.teamNom}` : ''
        }`}</Text>
      </Text>
    </View>
  );
}

function Indicateur({
  theme,
  libelle,
  valeur,
  alerte,
  testID,
}: {
  theme: ThemeHub;
  libelle: string;
  valeur: string;
  alerte?: boolean;
  testID: string;
}) {
  return (
    <View
      style={{
        minWidth: 90,
        flex: 1,
        gap: 2,
        padding: 8,
        borderRadius: Math.min(theme.rayonMoyen, 8),
        backgroundColor: teinteTransparente(
          alerte ? theme.alerte : theme.attenue,
          alerte ? 0.14 : 0.07,
        ),
      }}
      testID={testID}
    >
      <Text
        style={{
          color: theme.attenue,
          fontSize: 11,
          ...police(theme.policeTexte),
        }}
      >
        {libelle}
      </Text>
      <Text
        style={{
          color: alerte ? theme.alerte : theme.texte,
          fontSize: 17,
          fontWeight: '800',
          ...police(theme.policeChiffres),
        }}
      >
        {valeur}
      </Text>
    </View>
  );
}

function CarteDashboard({
  theme,
  carte,
  large,
  onOuvrir,
}: {
  theme: ThemeHub;
  carte: CarteTeam;
  large: boolean;
  onOuvrir(): void;
}) {
  const { team, effectif } = carte;
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = {
    color: theme.attenue,
    fontSize: 12,
    ...police(theme.policeTexte),
  };
  const activite = carte.derniereActivite;
  const phrase = activite?.action
    ? phraseJournal(
        {
          id: '',
          action: activite.action,
          acteur: activite.acteur ?? null,
          entiteType: null,
          entiteId: null,
          meta: activite.meta ?? {},
          date: activite.date,
        },
        activite.acteur ? { [activite.acteur]: activite.pseudo ?? null } : {},
      )
    : undefined;
  return (
    <Pressable
      testID={`esport-team-${team.slug}`}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir ${team.nom}`}
      onPress={onOuvrir}
      style={(etat: { pressed: boolean }) => ({
        width: large ? 360 : ('100%' as const),
        borderWidth: 1,
        padding: 16,
        gap: 12,
        backgroundColor: theme.surface,
        borderColor: (etat as { hovered?: boolean }).hovered
          ? theme.accent
          : theme.ligne,
        borderRadius: theme.rayonMoyen,
      })}
    >
      <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
        <Text
          style={[texte, { fontSize: 18, fontWeight: '800', flexShrink: 1 }]}
          numberOfLines={1}
        >
          {team.nom}
        </Text>
        {carte.role ? (
          <PastilleRole
            theme={theme}
            nom={carte.role.nom}
            couleur={carte.role.couleur}
          />
        ) : (
          <Text style={attenue}>Fondateur</Text>
        )}
      </View>
      <View style={[communs.ligne, { gap: 8 }]}>
        <Indicateur
          theme={theme}
          libelle="Membres"
          valeur={`${effectif.actifs}${
            effectif.invites ? ` +${effectif.invites}` : ''
          }`}
          testID={`esport-carte-membres-${team.slug}`}
        />
        {carte.presence ? (
          <Indicateur
            theme={theme}
            libelle={`Présence ${carte.presence.jours} j`}
            valeur={
              carte.presence.taux === null ? '—' : `${carte.presence.taux} %`
            }
            alerte={carte.presence.taux !== null && carte.presence.taux < 60}
            testID={`esport-carte-presence-${team.slug}`}
          />
        ) : null}
        {carte.resumes ? (
          <Indicateur
            theme={theme}
            libelle="Résumés en attente"
            valeur={String(carte.resumes.aResumer + carte.resumes.enCours)}
            alerte={
              carte.resumes.aResumer + carte.resumes.enCours > 0 &&
              carte.resumes.redacteur
            }
            testID={`esport-carte-resumes-${team.slug}`}
          />
        ) : null}
        {carte.taches ? (
          <Indicateur
            theme={theme}
            libelle="Tâches en retard"
            valeur={String(carte.taches.enRetard)}
            alerte={carte.taches.enRetard > 0}
            testID={`esport-carte-taches-${team.slug}`}
          />
        ) : null}
      </View>
      {effectif.invites > 0 ? (
        <Text style={attenue}>{`${effectif.invites} invité${
          effectif.invites > 1 ? 's' : ''
        } pas encore connecté${effectif.invites > 1 ? 's' : ''}`}</Text>
      ) : null}
      {carte.prochains ? (
        <View style={{ gap: 4 }}>
          <Text style={[attenue, { fontWeight: '700' }]}>
            Prochains événements
          </Text>
          {carte.prochains.length === 0 ? (
            <Text style={attenue}>Rien de prévu dans les 30 jours.</Text>
          ) : null}
          {carte.prochains.map(o => (
            <LigneEvenement
              key={`${o.evenementId}-${o.cle}`}
              theme={theme}
              o={o}
            />
          ))}
        </View>
      ) : null}
      <Text
        style={attenue}
        numberOfLines={2}
        testID={`esport-carte-activite-${team.slug}`}
      >
        {activite
          ? `Dernière activité ${depuis(activite.date)}${
              phrase ? ` : ${phrase}` : ''
            }`
          : 'Aucune activité pour l’instant.'}
      </Text>
    </Pressable>
  );
}

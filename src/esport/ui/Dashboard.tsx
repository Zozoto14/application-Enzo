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
import { Pressable, Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { CarteTeam, ClientEsport, OccurrenceTableau, Tableau } from '../client';
import { phraseJournal } from '../libelles';
import { typeEvenement } from '../planning/libelles';
import { PageEsport } from './CadreEsport';
import { PastilleRole, Retours, useAgir } from './commun';
import { AvatarTeam, Badge, Carte, ChiffreCle, ESP, EnTetePage, EtatVide, Grille, SqueletteCartes, TitreCarte, attenue, couleurTeam, texte, type EtatPresse } from './design';

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
  pseudo,
  onOuvrir,
  onBoite,
  onMembres,
  onTeams,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  pseudo?: string;
  onOuvrir(teamId: string): void;
  onBoite(): void;
  onMembres?(): void;
  onTeams?(): void;
}) {
  const [tableau, setTableau] = useState<Tableau | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setTableau(await client.tableau()), [client]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);

  const g = tableau?.global;
  const redacteur = Boolean(tableau?.teams.some(t => t.resumes?.redacteur));
  const enRetard = tableau?.teams.reduce((n, t) => n + (t.taches?.enRetard ?? 0), 0) ?? 0;
  const membres = tableau?.teams.reduce((n, t) => n + t.effectif.actifs, 0) ?? 0;

  return (
    <PageEsport large={large} testID="esport-dashboard">
      <EnTetePage
        theme={theme}
        large={large}
        titre={pseudo ? `Bonjour ${pseudo}` : 'Dashboard'}
        sous="Toutes vos teams en un coup d’œil : chiffres clés, semaine à venir, alertes."
        action={<BoutonHub theme={theme} titre="⟳ Actualiser" libelle="Actualiser le dashboard" onPress={() => void agir('', charger)} testID="esport-dashboard-actualiser" />}
      />
      <Retours theme={theme} erreur={erreur} prefixe="esport-dashboard" />
      {!tableau && !erreur ? <SqueletteCartes theme={theme} n={large ? 4 : 2} large={large} /> : null}
      {tableau && tableau.teams.length === 0 ? (
        <Carte theme={theme} testID="esport-dashboard-vide">
          <EtatVide
            theme={theme}
            glyphe="◆"
            titre="Aucune team pour l’instant"
            texte="Vous n’êtes encore dans aucune team. Le Fondateur ou le staff de votre team vous y ajoute : elle apparaîtra ici d’elle-même."
            action={onTeams ? { titre: 'Voir les teams', onPress: onTeams, testID: 'esport-dashboard-vers-teams' } : undefined}
          />
        </Carte>
      ) : null}
      {g && tableau && tableau.teams.length > 0 ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: large ? ESP.m : ESP.s }} testID="esport-dashboard-global">
            <ChiffreCle theme={theme} large={large} glyphe="◆" libelle="Teams" valeur={String(tableau.teams.length)} detail={`${membres} membre${membres > 1 ? 's' : ''} actif${membres > 1 ? 's' : ''}`} onPress={onTeams} testID="esport-dashboard-chiffre-teams" />
            <ChiffreCle theme={theme} large={large} glyphe="◷" libelle="Événements (7 jours)" valeur={String(g.evenementsSemaine.length)} detail={g.evenementsSemaine[0] ? `Prochain : ${quandCourt(g.evenementsSemaine[0].debut)}` : 'Rien de prévu'} testID="esport-dashboard-chiffre-semaine" />
            {redacteur ? (
              <ChiffreCle
                theme={theme}
                large={large}
                glyphe="✎"
                libelle="Résumés à rédiger"
                valeur={String(g.resumesARediger)}
                testIDValeur="esport-dashboard-resumes-nombre"
                ton={g.resumesARediger > 0 ? 'alerte' : 'neutre'}
                detail={g.resumesARediger > 0 ? 'Ouvrir la boîte ›' : 'Rien en attente'}
                onPress={g.resumesARediger > 0 ? onBoite : undefined}
                testID="esport-dashboard-resumes"
              />
            ) : (
              <ChiffreCle theme={theme} large={large} glyphe="☑︎" libelle="Tâches en retard" valeur={String(enRetard)} ton={enRetard > 0 ? 'critique' : 'ok'} detail={enRetard > 0 ? 'À rattraper' : 'Tout est à jour'} testID="esport-dashboard-chiffre-taches" />
            )}
            <ChiffreCle theme={theme} large={large} glyphe="!" libelle="Alertes" valeur={String(g.alertes.length)} ton={g.alertes.length > 0 ? 'alerte' : 'ok'} detail={g.alertes.length > 0 ? 'Voir ci-dessous' : 'Tout est en ordre'} testID="esport-dashboard-chiffre-alertes" />
          </View>
          <View style={large ? { flexDirection: 'row', gap: ESP.l, alignItems: 'flex-start' } : { gap: ESP.m }}>
            <Carte theme={theme} style={large ? { flex: 2 } : undefined} testID="esport-dashboard-semaine">
              <TitreCarte theme={theme} titre={`Cette semaine (${g.evenementsSemaine.length})`} sous="Les 7 prochains jours, toutes teams confondues." />
              {g.evenementsSemaine.length === 0 ? <EtatVide theme={theme} glyphe="◷" titre="Semaine libre" texte="Aucun événement dans les 7 prochains jours." /> : null}
              <View style={{ gap: ESP.xs }}>
                {g.evenementsSemaine.slice(0, 8).map(o => (
                  <LigneEvenement key={`${o.evenementId}-${o.cle}`} theme={theme} o={o} avecTeam onPress={() => onOuvrir(o.teamId)} />
                ))}
              </View>
            </Carte>
            <Carte theme={theme} style={large ? { flex: 1.2 } : undefined} testID="esport-dashboard-alertes">
              <TitreCarte theme={theme} titre={`Alertes${g.alertes.length ? ` (${g.alertes.length})` : ''}`} />
              {g.alertes.length === 0 ? <EtatVide theme={theme} glyphe="✓" titre="Tout est en ordre" texte="Aucune tâche en retard, aucun résumé ni présence en souffrance." /> : null}
              {g.alertes.map(a => (
                <Pressable
                  key={`${a.genre}-${a.teamId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.teamNom} : ${a.texte}`}
                  onPress={() => (a.genre === 'invites' && onMembres ? onMembres() : onOuvrir(a.teamId))}
                  style={(etat: EtatPresse) => ({
                    flexDirection: 'row',
                    gap: ESP.s,
                    alignItems: 'center',
                    minHeight: 48,
                    paddingHorizontal: ESP.s,
                    borderRadius: 10,
                    backgroundColor: teinteTransparente(a.genre === 'invites' ? theme.accent : theme.alerte, etat.hovered ? 0.18 : 0.1),
                  })}
                  testID={`esport-alerte-${a.genre}-${a.teamId}`}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.genre === 'invites' ? theme.accent : theme.alerte }} />
                  <Text style={{ ...texte(theme), flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{a.teamNom}</Text> · {a.texte}
                  </Text>
                  <Text style={{ color: theme.attenue, fontSize: 18 }}>›</Text>
                </Pressable>
              ))}
            </Carte>
          </View>
          <View style={{ gap: ESP.m }}>
            <Text accessibilityRole="header" style={{ ...texte(theme, 20), fontWeight: '700', ...police(theme.policeTitre) }}>
              Vos teams
            </Text>
            <Grille min={large ? 340 : 280} gap={ESP.m} testID="esport-dashboard-teams">
              {tableau.teams.map(c => (
                <CarteDashboard key={c.team.id} theme={theme} carte={c} onOuvrir={() => onOuvrir(c.team.id)} />
              ))}
            </Grille>
          </View>
        </>
      ) : null}
    </PageEsport>
  );
}

/** Une ligne d'événement : jour et heure, liseré de la couleur du type, titre, type et team. */
function LigneEvenement({ theme, o, avecTeam, onPress }: { theme: ThemeHub; o: OccurrenceTableau; avecTeam?: boolean; onPress?(): void }) {
  const t = typeEvenement(o.type);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${o.titre}, ${t.nom}, ${quandCourt(o.debut)}${avecTeam && o.teamNom ? `, ${o.teamNom}` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={(etat: EtatPresse) => ({
        flexDirection: 'row',
        gap: ESP.s,
        alignItems: 'center',
        minHeight: 48,
        paddingVertical: ESP.xs,
        paddingHorizontal: ESP.s,
        borderRadius: 10,
        backgroundColor: etat.hovered ? teinteTransparente(theme.attenue, 0.1) : teinteTransparente(theme.attenue, 0.05),
      })}>
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: t.couleur }} />
      <View style={{ width: 92 }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '700', ...police(theme.policeChiffres) }}>{quandCourt(o.debut).split(' · ')[0]}</Text>
        <Text style={{ ...attenue(theme), ...police(theme.policeChiffres) }}>{quandCourt(o.debut).split(' · ')[1]}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ ...texte(theme), fontWeight: '600' }} numberOfLines={1}>
          {o.titre}
        </Text>
        <Text style={attenue(theme)} numberOfLines={1}>
          {`${t.nom}${avecTeam && o.teamNom ? ` · ${o.teamNom}` : ''}${o.lieu ? ` · ${o.lieu}` : ''}`}
        </Text>
      </View>
    </Pressable>
  );
}

function Indicateur({ theme, libelle, valeur, alerte, testID }: { theme: ThemeHub; libelle: string; valeur: string; alerte?: boolean; testID: string }) {
  return (
    <View
      style={{
        minWidth: 92,
        flex: 1,
        gap: 2,
        paddingVertical: ESP.xs,
        paddingHorizontal: ESP.s,
        borderRadius: Math.min(theme.rayonMoyen, 10),
        backgroundColor: teinteTransparente(alerte ? theme.alerte : theme.attenue, alerte ? 0.14 : 0.07),
      }}
      testID={testID}>
      <Text style={{ color: alerte ? theme.alerte : theme.texte, fontSize: 20, fontWeight: '700', ...police(theme.policeChiffres) }}>{valeur}</Text>
      <Text style={attenue(theme, 12)} numberOfLines={1}>
        {libelle}
      </Text>
    </View>
  );
}

function CarteDashboard({ theme, carte, onOuvrir }: { theme: ThemeHub; carte: CarteTeam; onOuvrir(): void }) {
  const { team, effectif } = carte;
  const activite = carte.derniereActivite;
  const phrase = activite?.action
    ? phraseJournal(
        { id: '', action: activite.action, acteur: activite.acteur ?? null, entiteType: null, entiteId: null, meta: activite.meta ?? {}, date: activite.date },
        activite.acteur ? { [activite.acteur]: activite.pseudo ?? null } : {},
      )
    : undefined;
  return (
    <Carte theme={theme} testID={`esport-team-${team.slug}`} libelle={`Ouvrir ${team.nom}`} onPress={onOuvrir} accent={couleurTeam(team.slug)} style={{ height: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
        <AvatarTeam theme={theme} team={team} taille={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ ...texte(theme, 18), fontWeight: '800' }} numberOfLines={1}>
            {team.nom}
          </Text>
          {carte.role ? <PastilleRole theme={theme} nom={carte.role.nom} couleur={carte.role.couleur} /> : <Badge theme={theme} texte="Fondateur" ton="accent" />}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        <Indicateur theme={theme} libelle="Membres" valeur={`${effectif.actifs}${effectif.invites ? ` +${effectif.invites}` : ''}`} testID={`esport-carte-membres-${team.slug}`} />
        {carte.presence ? (
          <Indicateur
            theme={theme}
            libelle={`Présence ${carte.presence.jours} j`}
            valeur={carte.presence.taux === null ? '—' : `${carte.presence.taux} %`}
            alerte={carte.presence.taux !== null && carte.presence.taux < 60}
            testID={`esport-carte-presence-${team.slug}`}
          />
        ) : null}
        {carte.resumes ? (
          <Indicateur
            theme={theme}
            libelle="Résumés en attente"
            valeur={String(carte.resumes.aResumer + carte.resumes.enCours)}
            alerte={carte.resumes.aResumer + carte.resumes.enCours > 0 && carte.resumes.redacteur}
            testID={`esport-carte-resumes-${team.slug}`}
          />
        ) : null}
        {carte.taches ? <Indicateur theme={theme} libelle="Tâches en retard" valeur={String(carte.taches.enRetard)} alerte={carte.taches.enRetard > 0} testID={`esport-carte-taches-${team.slug}`} /> : null}
      </View>
      {effectif.invites > 0 ? <Text style={attenue(theme)}>{`${effectif.invites} invité${effectif.invites > 1 ? 's' : ''} pas encore connecté${effectif.invites > 1 ? 's' : ''}`}</Text> : null}
      {carte.prochains ? (
        <View style={{ gap: ESP.xxs }}>
          <Text style={{ ...attenue(theme), fontWeight: '700' }}>Prochains événements</Text>
          {carte.prochains.length === 0 ? <Text style={attenue(theme)}>Rien de prévu dans les 30 jours.</Text> : null}
          {carte.prochains.slice(0, 3).map(o => {
            const t = typeEvenement(o.type);
            return (
              <View key={`${o.evenementId}-${o.cle}`} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.couleur }} />
                <Text style={{ ...attenue(theme), minWidth: 104, ...police(theme.policeChiffres) }}>{quandCourt(o.debut)}</Text>
                <Text style={{ ...texte(theme, 14), flex: 1 }} numberOfLines={1}>
                  {o.titre}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Text style={attenue(theme)} numberOfLines={2} testID={`esport-carte-activite-${team.slug}`}>
        {activite ? `Dernière activité ${depuis(activite.date)}${phrase ? ` : ${phrase}` : ''}` : 'Aucune activité pour l’instant.'}
      </Text>
    </Carte>
  );
}

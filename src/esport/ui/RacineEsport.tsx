/**
 * App « Esport » du hub : liste des teams, assistant de création, page d'une
 * team, invitation à rejoindre une team, profil Esport.
 *
 * Tout passe par le Worker Esport (esport/), avec le jeton du relais déjà
 * gardé par l'app. Worker pas encore déployé (ou relais pas encore en
 * version 7) : écran « Esport pas encore activé » avec le lien vers la
 * marche à suivre ; rien d'autre ne casse.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RetourHub } from '../../hub/Hub';
import { Avis, BoutonHub, Champ, Intertitre, Panneau } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { PropsRacineApp } from '../../hub/types';
import { relaisDuCompte } from '../../sync/relais/actif';
import { DOC_ACTIVATION, ErreurEsport, MENTION_DONNEES, clientEsport, estInactif, nomModule, trouverConfig, type ClientEsport, type Moi, type Notifications, type TeamListee } from '../client';
import { dateCourte, phraseNotification } from '../libelles';
import { Assistant } from './Assistant';
import { MonProfil, PageTeam, type SectionTeam } from './PageTeam';
import { PastilleRole, Retours, TitreSection, styles as communs, useAgir } from './commun';

const LARGEUR_BARRE = 900;

type Etat =
  | { e: 'chargement' }
  | { e: 'inactif'; raison: 'sans-relais' | 'sans-adresse' | 'serveur' }
  | { e: 'erreur'; message: string }
  | { e: 'pret'; client: ClientEsport; moi: Moi };

type Vue = { v: 'teams' } | { v: 'assistant' } | { v: 'team'; id: string; section?: SectionTeam };

/** Fabrique du client (remplaçable par les tests). */
export const fabrique = {
  relais: () => relaisDuCompte(),
  client: clientEsport,
};

export function Esport(props: PropsRacineApp) {
  const { theme, onRetour, contexte } = props;
  const [etat, setEtat] = useState<Etat>({ e: 'chargement' });
  const [vue, setVue] = useState<Vue>({ v: 'teams' });
  const { width } = useWindowDimensions();
  const large = width >= LARGEUR_BARRE;

  const ouvrir = useCallback(async () => {
    setEtat({ e: 'chargement' });
    const { config, raison } = await trouverConfig(fabrique.relais());
    if (!config) {
      setEtat({ e: 'inactif', raison: raison ?? 'sans-adresse' });
      return;
    }
    const client = fabrique.client(config);
    try {
      setEtat({ e: 'pret', client, moi: await client.ouvrir() });
    } catch (e) {
      if (estInactif(e)) setEtat({ e: 'inactif', raison: 'serveur' });
      else setEtat({ e: 'erreur', message: e instanceof ErreurEsport ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void ouvrir();
  }, [ouvrir]);

  const exporter = contexte.enregistrerFichier ? (nom: string, contenu: string, type = 'application/json') => contexte.enregistrerFichier!(nom, contenu, type) : undefined;
  const fondateur = !contexte.profil || contexte.profil.admin;

  let contenu: React.ReactNode;
  if (etat.e === 'chargement') {
    contenu = <Text style={{ color: theme.attenue, padding: 24 }}>Connexion à l’Esport…</Text>;
  } else if (etat.e === 'inactif') {
    contenu = <PasEncoreActive theme={theme} raison={etat.raison} fondateur={fondateur} onReessayer={() => void ouvrir()} />;
  } else if (etat.e === 'erreur') {
    contenu = (
      <View style={{ padding: 16, gap: 12 }}>
        <Avis theme={theme} genre="critique" texte={etat.message} testID="esport-erreur" />
        <BoutonHub theme={theme} titre="Réessayer" onPress={() => void ouvrir()} testID="esport-reessayer" />
      </View>
    );
  } else if (!etat.moi.profil) {
    contenu = <ProfilInitial theme={theme} client={etat.client} onFait={moi => setEtat({ ...etat, moi })} />;
  } else if (vue.v === 'assistant') {
    contenu = <Assistant theme={theme} client={etat.client} onAnnuler={() => setVue({ v: 'teams' })} onCreee={d => setVue({ v: 'team', id: d.team.id, section: 'membres' })} />;
  } else if (vue.v === 'team') {
    contenu = <PageTeam key={vue.id} theme={theme} client={etat.client} teamId={vue.id} large={large} sectionInitiale={vue.section} onQuitter={() => setVue({ v: 'teams' })} onExporter={exporter} />;
  } else {
    contenu = (
      <MesTeams
        theme={theme}
        client={etat.client}
        moi={etat.moi}
        large={large}
        onOuvrir={id => setVue({ v: 'team', id })}
        onCreer={() => setVue({ v: 'assistant' })}
        onExporter={exporter}
        onProfilSupprime={() => void ouvrir()}
      />
    );
  }

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-esport">
      <RetourHub theme={theme} onRetour={onRetour} titre="Esport" />
      <View style={{ flex: 1 }}>{contenu}</View>
    </View>
  );
}

function PasEncoreActive({ theme, raison, fondateur, onReessayer }: { theme: ThemeHub; raison: 'sans-relais' | 'sans-adresse' | 'serveur'; fondateur: boolean; onReessayer(): void }) {
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const explication =
    raison === 'sans-relais'
      ? 'Cet appareil n’est pas relié au relais : l’Esport utilise votre compte du hub, par le relais (Paramètres › Synchronisation).'
      : fondateur
        ? 'Le serveur Esport (Worker Cloudflare « applibourse-esport ») n’est pas encore déployé, ou le relais n’est pas encore en version 7. La marche à suivre tient en quelques étapes.'
        : 'Le Fondateur n’a pas encore activé l’Esport. Réessayez plus tard.';
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
      <Panneau theme={theme} testID="esport-inactif">
        <Text accessibilityRole="header" style={[texte, { fontSize: 20, fontWeight: '800' }]}>
          Esport pas encore activé
        </Text>
        <Text style={texte}>{explication}</Text>
        <View style={communs.ligne}>
          {fondateur ? (
            <BoutonHub theme={theme} titre="Voir la marche à suivre" variante="plein" onPress={() => void Linking.openURL(DOC_ACTIVATION)} testID="esport-doc" />
          ) : null}
          <BoutonHub theme={theme} titre="Réessayer" onPress={onReessayer} testID="esport-reessayer" />
        </View>
        {fondateur ? <Text style={{ color: theme.attenue, fontSize: 12 }}>docs/esport/deploiement.md</Text> : null}
      </Panneau>
    </ScrollView>
  );
}

function ProfilInitial({ theme, client, onFait }: { theme: ThemeHub; client: ClientEsport; onFait(m: Moi): void }) {
  const [pseudo, setPseudo] = useState('');
  const [riotId, setRiotId] = useState('');
  const [discord, setDiscord] = useState('');
  const { enCours, erreur, agir } = useAgir();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }} testID="esport-profil-initial">
      <TitreSection theme={theme} titre="Bienvenue dans l’Esport" sous="Choisissez le pseudo que verront vos coéquipiers." />
      <Panneau theme={theme}>
        <Champ theme={theme} libelle="Pseudo (obligatoire)" valeur={pseudo} onChanger={setPseudo} maxLength={24} testID="esport-pseudo" />
        <Champ theme={theme} libelle="Riot ID (facultatif, Pseudo#TAG)" valeur={riotId} onChanger={setRiotId} maxLength={22} testID="esport-riot" />
        <Champ theme={theme} libelle="Discord (facultatif)" valeur={discord} onChanger={setDiscord} maxLength={32} testID="esport-discord" />
        <BoutonHub
          theme={theme}
          titre={enCours ? 'Enregistrement…' : 'Continuer'}
          variante="plein"
          desactive={Boolean(enCours) || pseudo.trim().length < 2}
          onPress={() =>
            void agir('Profil', async () => {
              onFait(await client.majProfil({ pseudo: pseudo.trim(), riotId: riotId.trim() || undefined, discord: discord.trim() || undefined }));
            })
          }
          testID="esport-pseudo-valider"
        />
        <Retours theme={theme} erreur={erreur} prefixe="esport-pseudo" />
        <Text style={{ color: theme.attenue, fontSize: 12 }} testID="esport-mention">
          {MENTION_DONNEES}
        </Text>
      </Panneau>
    </ScrollView>
  );
}

function MesTeams({
  theme,
  client,
  moi,
  large,
  onOuvrir,
  onCreer,
  onExporter,
  onProfilSupprime,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  moi: Moi;
  large: boolean;
  onOuvrir(id: string): void;
  onCreer(): void;
  onExporter?(nom: string, contenu: string): Promise<boolean>;
  onProfilSupprime(): void;
}) {
  const [teams, setTeams] = useState<TeamListee[] | undefined>();
  const [notifs, setNotifs] = useState<Notifications | undefined>();
  const [code, setCode] = useState('');
  const [profil, setProfil] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => {
    const [t, n] = await Promise.all([client.teams(), client.notifications().catch(() => undefined)]);
    setTeams(t);
    setNotifs(n);
  }, [client]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const nonLues = useMemo(() => notifs?.liste.filter(n => !n.lue) ?? [], [notifs]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 1200, width: '100%', alignSelf: 'center' }} testID="esport-teams">
      <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
        <TitreSection theme={theme} titre="Mes teams" sous={`Connecté en tant que ${moi.profil?.pseudo ?? moi.compte}${moi.superAdmin ? ' · Fondateur (toutes les teams)' : ''}`} />
        <View style={communs.ligne}>
          {moi.peutCreerTeam ? <BoutonHub theme={theme} titre="Créer une team" variante="plein" onPress={onCreer} testID="esport-creer" /> : null}
          <BoutonHub theme={theme} titre="Mon profil" onPress={() => setProfil(p => !p)} testID="esport-mon-profil-ouvrir" />
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-teams" />
      {profil ? <MonProfil theme={theme} client={client} onExporter={onExporter} onSupprime={onProfilSupprime} /> : null}
      <View style={[communs.ligne, { alignItems: 'stretch', gap: 12 }]} testID="esport-liste-teams">
        {teams?.length === 0 ? (
          <Panneau theme={theme} style={{ flex: 1 }}>
            <Text style={texte}>{moi.peutCreerTeam ? 'Aucune team pour l’instant : créez la première.' : 'Vous n’êtes dans aucune team : collez le code d’invitation reçu ci-dessous.'}</Text>
          </Panneau>
        ) : null}
        {teams?.map(t => (
          <Pressable
            key={t.id}
            testID={`esport-team-${t.slug}`}
            accessibilityRole="button"
            accessibilityLabel={`Ouvrir ${t.nom}`}
            disabled={t.suspendu}
            onPress={() => onOuvrir(t.id)}
            style={(etat: { pressed: boolean }) => [
              styles.carte,
              {
                width: large ? 340 : ('100%' as const),
                backgroundColor: theme.surface,
                borderColor: (etat as { hovered?: boolean }).hovered ? theme.accent : theme.ligne,
                borderRadius: theme.rayonMoyen,
                opacity: t.suspendu ? 0.5 : 1,
              },
            ]}>
            <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
              <Text style={[texte, { fontSize: 18, fontWeight: '800' }]} numberOfLines={1}>
                {t.nom}
              </Text>
              {t.role ? <PastilleRole theme={theme} nom={t.role.nom} couleur={t.role.couleur} /> : <Text style={attenue}>Super admin</Text>}
            </View>
            <Text style={attenue} numberOfLines={2}>
              {t.description || (t.jeu === 'valorant' ? 'Valorant' : 'Autre jeu')}
            </Text>
            <Text style={attenue}>
              {t.membres} membre(s) · {t.modules.length} module(s){t.suspendu ? ' · accès suspendu' : ''}
            </Text>
            <Text style={[attenue, { fontSize: 11 }]} numberOfLines={1}>
              {t.modules.map(nomModule).join(' · ')}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
        <Panneau theme={theme} style={{ flex: 1 }} testID="esport-rejoindre">
          <Intertitre theme={theme}>Rejoindre une team</Intertitre>
          <Champ theme={theme} libelle="Code d’invitation" valeur={code} onChanger={setCode} placeholder="esp_…" maxLength={80} testID="esport-code" />
          <BoutonHub
            theme={theme}
            titre={enCours === 'Rejoindre' ? 'Vérification…' : 'Rejoindre'}
            variante="plein"
            desactive={Boolean(enCours) || code.trim().length < 8}
            onPress={() =>
              void agir('Rejoindre', async () => {
                const r = await client.accepterInvitation(code);
                setCode('');
                await recharger();
                return `Bienvenue dans ${r.team.nom}${r.role ? ` (${r.role.nom})` : ''} !`;
              })
            }
            testID="esport-rejoindre-valider"
          />
        </Panneau>
        <Panneau theme={theme} style={{ flex: 1 }} testID="esport-notifications">
          <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
            <Intertitre theme={theme}>{`Notifications${nonLues.length ? ` (${nonLues.length})` : ''}`}</Intertitre>
            {nonLues.length ? (
              <BoutonHub
                theme={theme}
                titre="Tout marquer lu"
                onPress={() =>
                  void agir('Lu', async () => {
                    setNotifs(await client.marquerLues(true));
                  })
                }
                testID="esport-notifications-lues"
              />
            ) : null}
          </View>
          {notifs?.liste.length ? null : <Text style={attenue}>Rien de nouveau.</Text>}
          {notifs?.liste.slice(0, 8).map(n => (
            <View key={n.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: n.lue ? 'transparent' : theme.accent }} />
              <Text style={[texte, { flex: 1, fontWeight: n.lue ? '400' : '700' }]}>{phraseNotification(n, notifs.noms)}</Text>
              <Text style={attenue}>{dateCourte(n.date)}</Text>
            </View>
          ))}
        </Panneau>
      </View>
      <Text style={[attenue, { fontSize: 12, backgroundColor: teinteTransparente(theme.attenue, 0.08), padding: 10, borderRadius: 8 }]} testID="esport-mention">
        {MENTION_DONNEES}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  carte: { borderWidth: 1, padding: 16, gap: 8, minHeight: 120 },
});

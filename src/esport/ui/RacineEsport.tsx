/**
 * App « Esport » du hub. Navigation de premier niveau, avant d'entrer dans une
 * team : Dashboard (résumé de toutes les teams) · Teams (liste, création,
 * notifications, profil ; en tête, la carte « CM du club » qui ouvre l'espace
 * CM du club pour qui y a un droit) · Membres (tous les membres, création de
 * comptes, invitations), dans la barre latérale (PC) ou la barre d'onglets du
 * bas (iPhone) : voir CadreEsport.tsx. Puis la page d'une team, ses modules
 * rangés en cinq sections (PageTeam.tsx).
 *
 * Tout passe par le serveur Esport (esport/), avec le jeton du relais déjà
 * gardé par l'app. Serveur pas encore en ligne (ou relais pas encore en
 * version 7) : écran « Esport pas encore activé » avec le lien vers la
 * marche à suivre ; rien d'autre ne casse.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RetourHub } from '../../hub/Hub';
import { Avis, BoutonHub, Champ } from '../../hub/admin/ui/commun';
import { police, teinteTransparente, type ThemeHub } from '../../hub/themes';
import type { PropsRacineApp } from '../../hub/types';
import { fabrique } from '../fabrique';
import { DOC_ACTIVATION, ErreurEsport, mentionDonnees, estInactif, trouverConfig, type Boite, type ClientEsport, type Moi, type Notifications, type TeamListee, nomRole, nomJeu } from '../client';
import { dateCourte, phraseNotification } from '../libelles';
import { Assistant } from './Assistant';
import { CadreEsport, PageEsport, type OngletEsport } from './CadreEsport';
import { Dashboard } from './Dashboard';
import { PageMembres, type SousOngletMembres } from './membres/PageMembres';
import { GROUPES_TEAM, MonProfil, PageTeam, type SectionTeam } from './PageTeam';
import { BadgeNouveau, BoiteResumes } from './Resumes';
import { Panneau, PastilleRole, Retours, styles as communs, useAgir } from './commun';
import { AvatarTeam, Badge, Carte, ESP, EnTetePage, EtatVide, Grille, LARGEUR_PC, SqueletteCartes, TitreCarte, attenue, couleurTeam, texte } from './design';
import { definirLangue, langueAppareil, langueCourante, tr, trn, useLangue } from '../i18n';
import { ChoixLangue } from './ChoixLangue';
import { PublierMulti } from './ressources/PublierMulti';
import { EspaceCm, Jeux, Statistiques } from './differe';
import { apiCm, voitDrive, type MoiCm } from '../cm/api';
import type { OngletCm } from './cm/EspaceCm';
import { demarrerUsage, noterPage } from '../usage';

type Etat =
  | { e: 'chargement' }
  | { e: 'inactif'; raison: 'sans-relais' | 'sans-adresse' | 'serveur' }
  | { e: 'erreur'; message: string }
  | { e: 'pret'; client: ClientEsport; moi: Moi };

type Onglet = OngletEsport;
/**
 * Écran affiché. `cm` : l'espace CM du club, rangé dans Teams (l'entrée « Teams » reste surlignée) ; une ancienne
 * navigation vers « cm » (entrée de premier niveau d'avant) mène toujours à cet écran, ou à Teams sans droit CM.
 */
type Vue = { v: Exclude<Onglet, 'membres'> } | { v: 'membres'; sous?: SousOngletMembres } | { v: 'cm'; onglet?: OngletCm } | { v: 'assistant' } | { v: 'boite' } | { v: 'team'; id: string; section?: SectionTeam };

/** Écrans rangés sous l'entrée « Teams » de la navigation (surlignée quand ils sont ouverts). */
export const ongletDeVue = (v: Vue['v']): OngletEsport => (v === 'assistant' || v === 'boite' || v === 'cm' || v === 'team' ? 'teams' : v);

/** Fabrique du client (remplaçable par les tests) : voir ../fabrique.ts. */
export { fabrique };

export function Esport(props: PropsRacineApp) {
  const { theme, onRetour, contexte, registre, onOuvrirApp } = props;
  // Abonné à la langue : un changement re-rend toute l'app Esport, sans recharger.
  useLangue();
  const [etat, setEtat] = useState<Etat>({ e: 'chargement' });
  const [vue, setVue] = useState<Vue>({ v: 'dashboard' });
  // Section CM (GET /cm/moi) : carte « CM du club » de la page Teams ; un ancien serveur sans section CM n'affiche rien.
  const [moiCm, setMoiCm] = useState<MoiCm | undefined>();
  const { width } = useWindowDimensions();
  const large = width >= LARGEUR_PC;

  const ouvrir = useCallback(async () => {
    setEtat({ e: 'chargement' });
    const { config, raison } = await trouverConfig(fabrique.relais());
    if (!config) {
      setEtat({ e: 'inactif', raison: raison ?? 'sans-adresse' });
      return;
    }
    const client = fabrique.client(config);
    try {
      const moi = await client.ouvrir();
      // Langue choisie par l'utilisateur ; à défaut, celle définie par l'administrateur pour son compte ; à défaut, celle de
      // l'appareil (jamais celle d'un compte précédent).
      definirLangue(moi.langue ?? moi.langueDefaut ?? langueAppareil());
      setEtat({ e: 'pret', client, moi });
    } catch (e) {
      if (estInactif(e)) setEtat({ e: 'inactif', raison: 'serveur' });
      else setEtat({ e: 'erreur', message: e instanceof ErreurEsport ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void ouvrir();
  }, [ouvrir]);

  // Statistiques d'usage internes (métadonnées seulement, par lots) : le temps de la session Esport ouverte.
  const clientPret = etat.e === 'pret' ? etat.client : undefined;
  useEffect(() => (clientPret ? demarrerUsage(clientPret) : undefined), [clientPret]);
  const profilPret = etat.e === 'pret' && Boolean(etat.moi.profil);
  useEffect(() => {
    if (!clientPret || !profilPret) return;
    let vivant = true;
    Promise.resolve()
      .then(() => apiCm(clientPret).moi())
      .then(m => {
        if (vivant) setMoiCm(m);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [clientPret, profilPret]);
  const cm = Boolean(moiCm?.espace);
  const pageVue = etat.e !== 'pret' ? null : !etat.moi.profil ? 'esport.profil' : vue.v === 'team' ? null : (vue.v === 'statistiques' && !etat.moi.superAdmin) || (vue.v === 'jeux' && !etat.moi.peutGererJeux) ? 'esport.dashboard' : vue.v === 'cm' && !cm ? 'esport.teams' : `esport.${vue.v}`;
  useEffect(() => {
    if (pageVue) noterPage(pageVue);
  }, [pageVue]);

  const exporter = contexte.enregistrerFichier ? (nom: string, contenu: string, type = 'application/json') => contexte.enregistrerFichier!(nom, contenu, type) : undefined;
  const fondateur = !contexte.profil || contexte.profil.admin;

  let contenu: React.ReactNode;
  if (etat.e === 'chargement') {
    contenu = (
      <View style={{ padding: large ? ESP.xxl : ESP.m, gap: ESP.l, maxWidth: 900, width: '100%', alignSelf: 'center' }} testID="esport-chargement">
        <Text style={{ color: theme.attenue, fontSize: 15, ...police(theme.policeTexte) }}>{tr('racineEsport.connexion_a_l_esport')}</Text>
        <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} />
      </View>
    );
  } else if (etat.e === 'inactif') {
    contenu = <PasEncoreActive theme={theme} raison={etat.raison} fondateur={fondateur} onReessayer={() => void ouvrir()} />;
  } else if (etat.e === 'erreur') {
    contenu = (
      <View style={{ padding: ESP.m, gap: ESP.s, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
        <Avis theme={theme} genre="critique" texte={etat.message} testID="esport-erreur" />
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={tr('racineEsport.reessayer')} onPress={() => void ouvrir()} testID="esport-reessayer" />
        </View>
      </View>
    );
  } else if (!etat.moi.profil) {
    contenu = <ProfilInitial theme={theme} client={etat.client} onFait={moi => setEtat({ ...etat, moi })} />;
  } else if (vue.v === 'team') {
    contenu = (
      <PageTeam
        key={vue.id}
        theme={theme}
        client={etat.client}
        teamId={vue.id}
        large={large}
        sectionInitiale={vue.section}
        onQuitter={() => setVue({ v: 'teams' })}
        onExporter={exporter}
        onMembresGlobal={() => setVue({ v: 'membres', sous: 'tous' })}
        onNaviguer={o => setVue({ v: o })}
        gererJeux={Boolean(etat.moi.peutGererJeux)}
        onChangerTeam={(id, section) => setVue({ v: 'team', id, section })}
        pseudo={etat.moi.profil.pseudo}
        contexte={contexte}
      />
    );
  } else {
    const onglet: Onglet = ongletDeVue(vue.v);
    let page: React.ReactNode;
    if (vue.v === 'assistant') {
      page = (
        <Assistant
          theme={theme}
          client={etat.client}
          large={large}
          onAnnuler={() => setVue({ v: 'teams' })}
          onCreee={d => setVue({ v: 'team', id: d.team.id, section: 'membres' })}
          onJeux={etat.moi.peutGererJeux ? () => setVue({ v: 'jeux' }) : undefined}
        />
      );
    } else if (vue.v === 'boite') {
      page = (
        <PageEsport large={large} testID="esport-boite-globale">
          <EnTetePage
            theme={theme}
            large={large}
            titre={tr('dashboard.resumes_a_rediger')}
            sous={tr('racineEsport.tous_les_depots_des')}
            avant={<LienRetour theme={theme} titre={tr('dashboard.teams')} onPress={() => setVue({ v: 'teams' })} testID="esport-boite-retour" />}
          />
          <BoiteResumes theme={theme} client={etat.client} large={large} />
        </PageEsport>
      );
    } else if (onglet === 'dashboard') {
      page = (
        <Dashboard
          theme={theme}
          client={etat.client}
          large={large}
          pseudo={etat.moi.profil.pseudo}
          onOuvrir={id => setVue({ v: 'team', id })}
          onBoite={() => setVue({ v: 'boite' })}
          onMembres={() => setVue({ v: 'membres', sous: 'tous' })}
          onTeams={() => setVue({ v: 'teams' })}
        />
      );
    } else if (onglet === 'statistiques' && etat.moi.superAdmin) {
      page = <Statistiques theme={theme} client={etat.client} large={large} onExporter={exporter} />;
    } else if (onglet === 'jeux' && etat.moi.peutGererJeux) {
      // Profils de jeu, assistant IA, mises à jour proposées, Administration de l'IA (Fondateur).
      page = <Jeux theme={theme} client={etat.client} large={large} fondateur={etat.moi.superAdmin} />;
    } else if (vue.v === 'cm' && cm && moiCm) {
      // Section CM du club (dans Teams) : tableaux, À valider, calendrier, clips, Drive, Sponsors ; équipe CM, import
      // Trello, réglages (cm.gerer). `key` : le raccourci « Drive » rouvre l'espace sur son onglet.
      page = (
        <EspaceCm
          key={vue.onglet ?? 'cm'}
          theme={theme}
          client={etat.client}
          large={large}
          moi={moiCm}
          onExporter={exporter}
          ongletInitial={vue.onglet}
          avant={<LienRetour theme={theme} titre={tr('dashboard.teams')} onPress={() => setVue({ v: 'teams' })} testID="esport-cm-retour" />}
        />
      );
    } else if (onglet === 'membres') {
      // Membres : Trombinoscope (premier sous-onglet) et Tous les membres (liste, création, invitations).
      page = (
        <PageMembres
          key={vue.v === 'membres' ? (vue.sous ?? 'trombi') : 'trombi'}
          theme={theme}
          client={etat.client}
          contexte={contexte}
          registre={registre}
          large={large}
          ongletInitial={vue.v === 'membres' ? vue.sous : undefined}
          onOuvrirTeam={id => setVue({ v: 'team', id })}
          onOuvrirApp={onOuvrirApp}
          onExporter={contexte.enregistrerFichier ? (nom, contenu, type = 'text/plain') => contexte.enregistrerFichier!(nom, contenu, type) : undefined}
        />
      );
    } else {
      page = (
        <MesTeams
          theme={theme}
          client={etat.client}
          moi={etat.moi}
          large={large}
          onOuvrir={id => setVue({ v: 'team', id })}
          onCreer={() => setVue({ v: 'assistant' })}
          onBoite={() => setVue({ v: 'boite' })}
          onMembres={() => setVue({ v: 'membres', sous: 'tous' })}
          onExporter={exporter}
          onProfilSupprime={() => void ouvrir()}
          moiCm={cm ? moiCm : undefined}
          onCm={o => setVue({ v: 'cm', onglet: o })}
        />
      );
    }
    contenu = (
      <CadreEsport theme={theme} large={large} onglet={onglet} onOnglet={o => setVue(o === 'membres' ? { v: 'membres' } : { v: o })} pseudo={etat.moi.profil.pseudo} fondateur={etat.moi.superAdmin} gererJeux={Boolean(etat.moi.peutGererJeux)}>
        {page}
      </CadreEsport>
    );
  }

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-esport">
      <RetourHub theme={theme} onRetour={onRetour} titre="Esport" />
      <View style={{ flex: 1, borderTopWidth: large ? 1 : 0, borderTopColor: theme.ligne }}>{contenu}</View>
    </View>
  );
}

/** Lien de retour discret, au-dessus d'un titre de page (« ‹ Teams »). */
function LienRetour({ theme, titre, onPress, testID }: { theme: ThemeHub; titre: string; onPress(): void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="link" accessibilityLabel={tr('racineEsport.retour', { titre })} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600', ...police(theme.policeTexte) }}>{`‹ ${titre}`}</Text>
    </Pressable>
  );
}

function PasEncoreActive({ theme, raison, fondateur, onReessayer }: { theme: ThemeHub; raison: 'sans-relais' | 'sans-adresse' | 'serveur'; fondateur: boolean; onReessayer(): void }) {
  const explication =
    raison === 'sans-relais'
      ? tr('racineEsport.cet_appareil_n_est')
      : fondateur
        ? tr('racineEsport.le_serveur_esport_worker')
        : tr('racineEsport.le_fondateur_n_a');
  return (
    <ScrollView contentContainerStyle={{ padding: ESP.m, paddingTop: ESP.xxl, gap: ESP.m, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
      <Carte theme={theme} testID="esport-inactif">
        <EtatVide theme={theme} glyphe="◆" titre={tr('racineEsport.esport_pas_encore_active')} texte={explication} />
        <View style={[communs.ligne, { justifyContent: 'center' }]}>
          {fondateur ? (
            <BoutonHub theme={theme} titre={tr('racineEsport.voir_la_marche_a')} variante="plein" onPress={() => void Linking.openURL(DOC_ACTIVATION)} testID="esport-doc" />
          ) : null}
          <BoutonHub theme={theme} titre={tr('racineEsport.reessayer')} onPress={onReessayer} testID="esport-reessayer" />
        </View>
        {fondateur ? <Text style={{ ...attenue(theme), textAlign: 'center' }}>docs/esport/deploiement.md</Text> : null}
      </Carte>
    </ScrollView>
  );
}

function ProfilInitial({ theme, client, onFait }: { theme: ThemeHub; client: ClientEsport; onFait(m: Moi): void }) {
  const [pseudo, setPseudo] = useState('');
  const [riotId, setRiotId] = useState('');
  const [discord, setDiscord] = useState('');
  const { enCours, erreur, agir } = useAgir();
  const langue = useLangue();
  return (
    <ScrollView contentContainerStyle={{ padding: ESP.m, paddingTop: ESP.xl, gap: ESP.l, maxWidth: 560, width: '100%', alignSelf: 'center' }} testID="esport-profil-initial">
      <EnTetePage theme={theme} titre={tr('racineEsport.bienvenue_dans_l_esport')} sous={tr('racineEsport.choisissez_le_pseudo_que')} />
      <Panneau theme={theme}>
        <ChoixLangue theme={theme} libelle={tr('profil.langue')} valeur={langue} onChoisir={definirLangue} testID="esport-langue" />
        <Champ theme={theme} libelle={tr('pageTeam.pseudo_obligatoire')} valeur={pseudo} onChanger={setPseudo} maxLength={24} testID="esport-pseudo" />
        <Champ theme={theme} libelle={tr('pageTeam.riot_id_facultatif_pseudo')} valeur={riotId} onChanger={setRiotId} maxLength={22} testID="esport-riot" />
        <Champ theme={theme} libelle={tr('pageTeam.discord_facultatif')} valeur={discord} onChanger={setDiscord} maxLength={32} testID="esport-discord" />
        <BoutonHub
          theme={theme}
          titre={enCours ? tr('membresRoles.enregistrement') : tr('racineEsport.continuer')}
          variante="plein"
          desactive={Boolean(enCours) || pseudo.trim().length < 2}
          onPress={() =>
            void agir('profil', async () => {
              const moi = await client.majProfil({ pseudo: pseudo.trim(), riotId: riotId.trim() || undefined, discord: discord.trim() || undefined });
              // La langue affichée devient celle du compte (le bot Discord et les exports la connaissent) ; sans bloquer l'entrée.
              // Un nouveau profil a le français pour langue par défaut : on n'enregistre un CHOIX que si la langue affichée en diffère.
              const avecLangue = langueCourante() === moi.langueDefaut ? undefined : await client.majLangue?.(langueCourante()).catch(() => undefined);
              onFait(avecLangue ?? moi);
            })
          }
          testID="esport-pseudo-valider"
        />
        <Retours theme={theme} erreur={erreur} prefixe="esport-pseudo" />
        <Text style={attenue(theme, 12)} testID="esport-mention">
          {mentionDonnees()}
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
  onBoite,
  onMembres,
  onExporter,
  onProfilSupprime,
  moiCm,
  onCm,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  moi: Moi;
  large: boolean;
  onOuvrir(id: string): void;
  onCreer(): void;
  onBoite(): void;
  onMembres(): void;
  onExporter?(nom: string, contenu: string): Promise<boolean>;
  onProfilSupprime(): void;
  /** Droits CM (GET /cm/moi) quand l'espace CM du club est permis : la carte « CM du club » en tête de la page. */
  moiCm?: MoiCm;
  /** Ouvrir l'espace CM du club (sur un onglet : « drive »). */
  onCm(onglet?: OngletCm): void;
}) {
  const [teams, setTeams] = useState<TeamListee[] | undefined>();
  const [notifs, setNotifs] = useState<Notifications | undefined>();
  const [boite, setBoite] = useState<Boite | undefined>();
  const [profil, setProfil] = useState(false);
  const [ressources, setRessources] = useState(false);
  const { erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => {
    const [t, n, b] = await Promise.all([client.teams(), client.notifications().catch(() => undefined), Promise.resolve().then(() => client.boiteResumes()).catch(() => undefined)]);
    setTeams(t);
    setNotifs(n);
    setBoite(b);
  }, [client]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const nonLues = useMemo(() => notifs?.liste.filter(n => !n.lue) ?? [], [notifs]);

  return (
    <PageEsport large={large} testID="esport-teams">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('racineEsport.mes_teams')}
        sous={tr('racineEsport.connecte_en_tant_que', { nom: moi.profil?.pseudo ?? moi.compte, fondateur: moi.superAdmin ? tr('racineEsport.fondateur_toutes_les_teams') : '' })}
        action={
          <>
            {moi.superAdmin ? <BoutonHub theme={theme} titre={tr('racineEsport.inviter_un_joueur')} onPress={onMembres} testID="esport-teams-inviter" /> : null}
            {moi.superAdmin ? <BoutonHub theme={theme} titre={tr('ressources.multi.bouton')} libelle={tr('ressources.multi.titre')} onPress={() => setRessources(true)} testID="esport-teams-ressources" /> : null}
            <BoutonHub theme={theme} titre={profil ? tr('racineEsport.fermer_mon_profil') : tr('racineEsport.mon_profil')} onPress={() => setProfil(p => !p)} testID="esport-mon-profil-ouvrir" />
            {moi.peutCreerTeam ? <BoutonHub theme={theme} titre={tr('racineEsport.creer_une_team')} variante="plein" onPress={onCreer} testID="esport-creer" /> : null}
          </>
        }
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-teams" />
      {boite && boite.teams.length > 0 ? (
        <Carte theme={theme} testID="esport-redacteur" accent={theme.accent}>
          <View style={[communs.ligne, { justifyContent: 'space-between' }]}>
            <View style={{ flexShrink: 1, gap: ESP.xxs }}>
              <View style={communs.ligne}>
                <Text style={{ ...texte(theme, 17), fontWeight: '700' }} testID="esport-redacteur-compteur">
                  {tr('racineEsport.resumes_a_rediger_en', { attente: boite.attente })}
                </Text>
                {boite.nouveaux > 0 ? <BadgeNouveau theme={theme} testID="esport-redacteur-nouveaux" /> : null}
              </View>
              <Text style={attenue(theme)}>{boite.nouveaux > 0 ? trn('racineEsport.jamais_ouverts', boite.nouveaux) : tr('racineEsport.tous_les_depots_des_2')}</Text>
            </View>
            <BoutonHub theme={theme} titre={tr('racineEsport.boite_de_reception')} variante="plein" onPress={onBoite} testID="esport-redacteur-ouvrir" />
          </View>
        </Carte>
      ) : null}
      {profil ? <MonProfil theme={theme} client={client} onExporter={onExporter} onSupprime={onProfilSupprime} /> : null}
      {ressources ? <PublierMulti theme={theme} client={client} onFermer={() => setRessources(false)} /> : null}
      {!teams ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {teams?.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide
            theme={theme}
            glyphe="◆"
            titre={moi.peutCreerTeam ? tr('dashboard.aucune_team_pour_l') : tr('racineEsport.vous_n_etes_dans')}
            texte={
              moi.peutCreerTeam
                ? tr('racineEsport.creez_la_premiere_puis')
                : tr('racineEsport.le_fondateur_ou_le')
            }
            action={moi.peutCreerTeam ? { titre: tr('racineEsport.creer_une_team'), onPress: onCreer } : undefined}
          />
        </Carte>
      ) : null}
      {teams?.length || moiCm?.espace ? (
        <Grille min={large ? 320 : 280} testID="esport-liste-teams">
          {moiCm?.espace ? <CarteCmClub theme={theme} moi={moiCm} client={client} onOuvrir={onCm} /> : null}
          {teams?.map(t => (
            <CarteTeamListe key={t.id} theme={theme} team={t} onOuvrir={() => onOuvrir(t.id)} />
          ))}
        </Grille>
      ) : null}
      <Carte theme={theme} testID="esport-notifications">
        <TitreCarte
          theme={theme}
          titre={nonLues.length ? tr('racineEsport.notifications_n', { n: nonLues.length }) : tr('racineEsport.notifications')}
          sous={nonLues.length ? tr('racineEsport.les_plus_recentes_de') : undefined}
          droite={
            nonLues.length ? (
              <BoutonHub
                theme={theme}
                titre={tr('racineEsport.tout_marquer_lu')}
                onPress={() =>
                  void agir('Lu', async () => {
                    setNotifs(await client.marquerLues(true));
                  })
                }
                testID="esport-notifications-lues"
              />
            ) : undefined
          }
        />
        {notifs?.liste.length ? null : <Text style={attenue(theme, 15)}>{tr('pageTeam.rien_de_nouveau')}</Text>}
        {notifs?.liste.slice(0, 8).map(n => (
          <View key={n.id} style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', paddingVertical: ESP.xxs }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.lue ? theme.ligne : theme.accent }} />
            <Text style={{ ...texte(theme), flex: 1, fontWeight: n.lue ? '400' : '700' }}>{phraseNotification(n, notifs.noms)}</Text>
            <Text style={attenue(theme)}>{dateCourte(n.date)}</Text>
          </View>
        ))}
      </Carte>
      <Text style={{ ...attenue(theme, 12), backgroundColor: teinteTransparente(theme.attenue, 0.08), padding: ESP.s, borderRadius: 10 }} testID="esport-mention">
        {mentionDonnees()}
      </Text>
    </PageEsport>
  );
}

/** Couleur du bandeau de la tuile « CM du club » : hors des teintes des teams et des accents des thèmes. */
export const COULEUR_CM_CLUB = '#D6409F';

/**
 * Tuile « CM du club » (page Teams, première de la grille) : même gabarit que les cartes de team (bandeau coloré,
 * pastille « CM », titre, ligne secondaire, description, puces des sections, lien « Ouvrir l'espace CM › »).
 * Elle dit ce que le compte y trouve (Contenus, Posts à valider, Drive, Sponsors : selon GET /cm/moi) ; la puce
 * « Drive » ouvre directement le Drive pour qui y a droit.
 */
export function CarteCmClub({ theme, moi, client, onOuvrir }: { theme: ThemeHub; moi: MoiCm; client?: ClientEsport; onOuvrir(onglet?: OngletCm): void }) {
  const contenus = moi.club.includes('cm.voir') || moi.teams.some(t => t.permissions.includes('cm.voir'));
  const drive = voitDrive(moi.club) || moi.teams.some(t => voitDrive(t.permissions));
  const sponsors = Boolean(moi.sponsors?.includes('sponsors.voir'));
  const [aValider, setAValider] = useState(0);
  useEffect(() => {
    if (!contenus || !client) return;
    let actif = true;
    void Promise.resolve()
      .then(() => apiCm(client).etat())
      .then(e => actif && setAValider(e?.aValider ?? 0))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [client, contenus]);
  const nb = Number(contenus) + Number(drive) + Number(sponsors);
  const couleur = COULEUR_CM_CLUB;
  const rayon = theme.id === 'terminal' ? 0 : Math.round(48 * 0.28);
  return (
    <Carte theme={theme} testID="esport-teams-cm" accent={couleur} style={{ height: '100%', minHeight: 180 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 48, height: 48, borderRadius: rayon, backgroundColor: couleur, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>CM</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ ...texte(theme, 18), fontWeight: '800' }} numberOfLines={1} accessibilityRole="header">
            {tr('cm.club_titre')}
          </Text>
          <Text style={attenue(theme)} numberOfLines={1}>{trn('cm.tuile_sous', nb)}</Text>
        </View>
      </View>
      <Text style={attenue(theme, 14)} numberOfLines={2}>
        {tr('cm.tuile_description')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }} testID="esport-teams-cm-contenu">
        {contenus ? <Badge theme={theme} texte={tr('cm.tuile_contenus')} /> : null}
        {contenus && aValider > 0 ? <Badge theme={theme} texte={`${tr('cm.tuile_a_valider')} (${aValider})`} ton="accent" testID="esport-teams-cm-a-valider" /> : null}
        {drive && contenus ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tr('cm.club_ouvrir_drive')} onPress={() => onOuvrir('drive')} testID="esport-teams-cm-drive">
            <Badge theme={theme} texte={tr('cm.club_drive')} ton="accent" />
          </Pressable>
        ) : drive ? (
          <Badge theme={theme} texte={tr('cm.club_drive')} />
        ) : null}
        {sponsors ? <Badge theme={theme} texte={tr('cm.club_sponsors')} /> : null}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={tr('cm.nav_description')} onPress={() => onOuvrir()} testID="esport-teams-cm-ouvrir">
        <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '700' }}>{tr('cm.tuile_ouvrir')}</Text>
      </Pressable>
    </Carte>
  );
}

/** Carte d'une team (page Teams) : logo et couleur, rôle, effectif, sections. */
function CarteTeamListe({ theme, team: t, onOuvrir }: { theme: ThemeHub; team: TeamListee; onOuvrir(): void }) {
  const couleur = couleurTeam(t.slug);
  const jeu = nomJeu(t.jeu, t.jeuNom);
  // Sections de la team, d'après ses modules (comme la navigation dans la team).
  const groupes = GROUPES_TEAM.filter(g => g.id !== 'accueil' && g.id !== 'reglages' && t.modules.some(m => g.sections.includes(`module:${m}`)));
  return (
    <Carte
      theme={theme}
      testID={`esport-team-${t.slug}`}
      libelle={tr('dashboard.ouvrir', { nom: t.nom })}
      onPress={onOuvrir}
      desactive={t.suspendu}
      accent={couleur}
      style={{ height: '100%', minHeight: 180 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }}>
        <AvatarTeam theme={theme} team={t} taille={48} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ ...texte(theme, 18), fontWeight: '800' }} numberOfLines={1}>
            {t.nom}
          </Text>
          <Text style={attenue(theme)} numberOfLines={1}>{`${jeu} · ${trn('statsTeam.membres', t.membres)}`}</Text>
        </View>
      </View>
      <Text style={attenue(theme, 14)} numberOfLines={2}>
        {t.description || tr('racineEsport.pas_encore_de_description')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        {t.role ? <PastilleRole theme={theme} nom={nomRole(t.role.nom)} couleur={t.role.couleur} /> : <Badge theme={theme} texte={tr('pageTeam.super_admin')} ton="accent" />}
        {t.suspendu ? <Badge theme={theme} texte={tr('racineEsport.acces_suspendu')} ton="critique" /> : null}
        {groupes.map(g => (
          <Badge key={g.id} theme={theme} texte={g.libelle} />
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '700' }}>{t.suspendu ? tr('racineEsport.acces_suspendu') : tr('racineEsport.ouvrir_la_team')}</Text>
    </Carte>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
});

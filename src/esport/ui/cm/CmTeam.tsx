/**
 * Onglet « CM » d'une team (module `cm`, rangé dans la section Équipe) :
 *  - Déposer (cm.deposer, le correspondant de la team) : une information, une photo, une actu, une recrue…
 *    → une carte dans « Idées » du tableau CM de la team, que le CM du club reprend ;
 *  - Tableau (cm.voir) : le tableau CM de la team ;
 *  - Clips (cm.clips.proposer, les joueurs) : proposer un clip au CM, suivre ses clips ;
 *  - Drive (cm.drive.*, le correspondant ; docs/esport/drive.md) : le Drive de la team ; un joueur qui propose
 *    des clips ou dépose des infos n'y voit que le dossier « Dépôt joueurs » et ses propres fichiers.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { apiCm, voitDrive, type GenreDepot, type PageTeamCm } from '../../cm/api';
import { ACCEPT_CM, choisirFichier, choixFichierDisponible, type FichierNavigateur } from '../../medias/choixFichier';
import { trCm } from '../../i18n/cm';
import { ChampNote } from '../ChampNote';
import { Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EnTetePage, Onglets, TitreCarte, attenue, texte } from '../design';
import { BarreEnvoi, useEnvoi } from '../medias/EnvoiMedia';
import type { PropsModule } from '../modules';
import { Aide, BadgeStatut, nomGenreDepot, nomListe, quand, useEtatCm } from './commun';
import { ProposerClip, GalerieClips } from './Clips';
import { Tableau } from './Tableau';
import { Drive } from './drive/Drive';
import { useNouveautesDrive } from '../../cm/nouveautesDrive';

type Section = 'deposer' | 'tableau' | 'clips' | 'drive';

export function CmTeam({ theme, client, detail, large }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiCm(client), [client]);
  const [page, setPage] = useState<PageTeamCm | undefined>();
  const [section, setSection] = useState<Section | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setPage(await api.team(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const peut = (p: string) => Boolean(page?.permissions.includes(p as never));
  // Pastille du Drive de la team : nouveautés depuis la dernière visite (migration 0041).
  const nouveautesDrive = useNouveautesDrive(client, teamId, Boolean(page && voitDrive(page.permissions)));
  const sections: Array<{ id: Section; libelle: string; pastille?: number }> = [
    ...(peut('cm.deposer') ? [{ id: 'deposer' as const, libelle: trCm('team.deposer') }] : []),
    ...(peut('cm.voir') && page?.tableaux.length ? [{ id: 'tableau' as const, libelle: trCm('team.tableau') }] : []),
    ...(peut('cm.clips.proposer') || peut('cm.voir') ? [{ id: 'clips' as const, libelle: trCm('team.clips') }] : []),
    // Drive (migration 0027) : celui de la team, ou son seul dossier « Dépôt joueurs ».
    ...(page && (voitDrive(page.permissions) || peut('cm.clips.proposer') || peut('cm.deposer')) ? [{ id: 'drive' as const, libelle: trCm('team.drive'), pastille: nouveautesDrive }] : []),
  ];
  const actif = section && sections.some(s => s.id === section) ? section : sections[0]?.id;
  const { etat } = useEtatCm(api, actif === 'tableau');
  return (
    <View style={{ gap: ESP.l }} testID="esport-cm-team">
      <EnTetePage theme={theme} large={large} titre={trCm('team.titre')} sous={trCm('team.sous')} />
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-team" />
      {sections.length > 1 ? <Onglets theme={theme} prefixe="esport-cm-team-onglet" actif={actif ?? ''} onChoisir={id => setSection(id as Section)} entrees={sections} pleineLargeur={!large} /> : null}
      {page && !sections.length ? <Aide theme={theme}>{trCm('team.rien')}</Aide> : null}
      {page && actif === 'deposer' ? <Deposer theme={theme} api={api} page={page} large={large} onDepose={() => void charger()} /> : null}
      {page && actif === 'tableau' && page.tableaux[0] ? <Tableau theme={theme} api={api} id={page.tableaux[0].id} large={large} versionServeur={etat?.versions[page.tableaux[0].id]} /> : null}
      {page && actif === 'drive' ? <Drive theme={theme} client={client} large={large} porteeFixe={teamId} /> : null}
      {page && actif === 'clips' ? (
        peut('cm.clips.proposer') ? <ProposerClip theme={theme} api={api} teamId={teamId} large={large} /> : <GalerieClips theme={theme} api={api} large={large} teamId={teamId} />
      ) : null}
    </View>
  );
}

function Deposer({ theme, api, page, large, onDepose }: { theme: PropsModule['theme']; api: ReturnType<typeof apiCm>; page: PageTeamCm; large: boolean; onDepose(): void }) {
  const [genre, setGenre] = useState<GenreDepot>('info');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [liens, setLiens] = useState('');
  const [fichiers, setFichiers] = useState<FichierNavigateur[]>([]);
  const envoi = useEnvoi();
  const { erreur, avis, agir, enCours } = useAgir();
  const listeLiens = liens.split(/\s+/).map(x => x.trim()).filter(Boolean);
  return (
    <View style={{ gap: ESP.m }}>
      <Carte theme={theme} testID="esport-cm-depot">
        <TitreCarte theme={theme} titre={trCm('depot.titre')} sous={trCm('depot.aide')} />
        <Choix theme={theme} libelle={trCm('depot.genre')} valeur={genre} options={page.genres.map(g => ({ id: g, nom: nomGenreDepot(g) }))} onChoisir={v => setGenre(v as GenreDepot)} testID="esport-cm-depot-genre" />
        <Champ theme={theme} libelle={trCm('depot.titre_champ')} valeur={titre} onChanger={setTitre} maxLength={200} testID="esport-cm-depot-titre" />
        <ChampNote theme={theme} libelle={trCm('depot.description')} valeur={description} onChanger={setDescription} testID="esport-cm-depot-description" maxLength={8000} apercu="bouton" />
        <Champ theme={theme} libelle={trCm('depot.liens')} valeur={liens} onChanger={setLiens} multiligne placeholder="https://" maxLength={2000} testID="esport-cm-depot-liens" />
        {choixFichierDisponible ? (
          <View style={{ gap: ESP.xs }}>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub
                theme={theme}
                titre={trCm('depot.ajouter_fichier')}
                desactive={fichiers.length >= 5}
                onPress={() =>
                  void choisirFichier(ACCEPT_CM, 'esport-cm-depot-fichier').then(f => {
                    if (f) setFichiers(x => [...x, f]);
                  })
                }
                testID="esport-cm-depot-ajouter-fichier"
              />
              {fichiers.map((f, i) => (
                <BoutonHub key={`${f.nom}-${i}`} theme={theme} titre={`${f.nom} ×`} libelle={trCm('depot.retirer_fichier', { nom: f.nom })} onPress={() => setFichiers(x => x.filter((_, j) => j !== i))} testID={`esport-cm-depot-fichier-${i}`} />
              ))}
            </View>
            <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-cm-depot-envoi" />
          </View>
        ) : (
          <Aide theme={theme}>{trCm('fiche.fichier_depuis_pc')}</Aide>
        )}
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-depot" />
        <BoutonHub
          theme={theme}
          titre={trCm('depot.envoyer')}
          variante="plein"
          desactive={Boolean(enCours) || titre.trim().length < 2}
          onPress={() =>
            void agir('deposer', async () => {
              const envois: string[] = [];
              const oublis: Array<() => void> = [];
              for (const f of fichiers) {
                const { etat, oublier } = await envoi.lancer({ client: api.client, teamId: page.team.id, section: 'cm', fichier: f });
                envois.push(etat.id);
                oublis.push(oublier);
              }
              await api.deposer(page.team.id, { genre, titre: titre.trim(), description, liens: listeLiens, envois });
              oublis.forEach(o => o());
              envoi.effacer();
              setTitre('');
              setDescription('');
              setLiens('');
              setFichiers([]);
              onDepose();
              return trCm('depot.fait');
            })
          }
          testID="esport-cm-depot-envoyer"
        />
      </Carte>
      {page.depots.length ? (
        <Carte theme={theme} testID="esport-cm-depots">
          <TitreCarte theme={theme} titre={trCm('depot.recents')} />
          {page.depots.map(d => (
            <View key={d.id} style={[styles.ligne, { justifyContent: 'space-between' }]} testID={`esport-cm-depot-${d.id}`}>
              <View style={{ flex: 1, minWidth: large ? 240 : 160, gap: 2 }}>
                <Text style={{ ...texte(theme), fontWeight: '600' }}>{d.titre}</Text>
                <Text style={attenue(theme, 12)}>{[nomGenreDepot(d.genre), d.auteur ? (page.noms[d.auteur] ?? '') : '', quand(d.creeLe)].filter(Boolean).join(' · ')}</Text>
              </View>
              <Badge theme={theme} texte={nomListe(d.liste)} />
              <BadgeStatut theme={theme} statut={d.statut} />
            </View>
          ))}
        </Carte>
      ) : null}
    </View>
  );
}

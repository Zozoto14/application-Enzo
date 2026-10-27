/**
 * Clips des joueurs (section CM) :
 *  - `ProposerClip` (partie CM de la team) : lien (YouTube, Twitch…) ou fichier envoyé par morceaux, match ou
 *    résultat lié (publiables seulement), instant, titre, description ; puis « Mes clips » et leur statut ;
 *  - `GalerieClips` (espace CM, et team pour cm.voir) : tri par le CM (retenir, refuser avec motif), créer une
 *    carte (post brouillon) ou joindre le clip à une carte existante, lecture du fichier par lien signé.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { STATUTS_CLIP, type ApiCm, type CarteTransverse, type Clip, type ListeClips, type MatchsTeam, type StatutClip, type TeamCm } from '../../cm/api';
import { ACCEPT_CM, choisirFichier, choixFichierDisponible } from '../../medias/choixFichier';
import { trCm } from '../../i18n/cm';
import { Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EtatVide, Grille, TitreCarte, attenue, texte } from '../design';
import { BarreEnvoi, useEnvoi } from '../medias/EnvoiMedia';
import { ouvrirLienDiffere } from '../ouvrirLien';
import { Aide, TON_CLIP, nomStatutClip, quand } from './commun';

const instantLisible = (s: number | null) => (s === null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

function CarteClip({ theme, api, clip, noms, onChange, teams }: { theme: ThemeHub; api: ApiCm; clip: Clip; noms: Record<string, string | null>; onChange(): void; teams?: boolean }) {
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState(false);
  const [joindre, setJoindre] = useState(false);
  const [q, setQ] = useState('');
  const [cartes, setCartes] = useState<CarteTransverse[] | undefined>();
  const { erreur, avis, agir } = useAgir();
  const faire = (cle: string, action: () => Promise<unknown>, message?: string) =>
    agir(cle, async () => {
      await action();
      onChange();
      return message;
    });
  const contexte = clip.match ? `${clip.match.tournoi}${clip.match.tour ? ` · ${clip.match.tour}` : ''}${clip.match.adversaires.length ? ` · ${clip.match.adversaires.join(', ')}` : ''}` : clip.resultat ? `${quand(clip.resultat.date)} · ${clip.resultat.adversaires.join(', ')}` : '';
  return (
    <Carte theme={theme} dense testID={`esport-cm-clip-${clip.id}`}>
      <TitreCarte theme={theme} titre={clip.titre} sous={[teams ? clip.team.nom : '', clip.proposePar ? trCm('clip.par', { qui: noms[clip.proposePar] ?? '?' }) : '', quand(clip.creeLe)].filter(Boolean).join(' · ')} droite={<Badge theme={theme} ton={TON_CLIP[clip.statut]} texte={nomStatutClip(clip.statut)} testID={`esport-cm-clip-${clip.id}-statut`} />} />
      {contexte ? <Text style={texte(theme, 13)}>{trCm('clip.match', { match: contexte })}</Text> : null}
      {clip.instant !== null ? <Text style={texte(theme, 13)}>{trCm('clip.instant', { instant: instantLisible(clip.instant) })}</Text> : null}
      {clip.description ? <Text style={texte(theme, 14)}>{clip.description}</Text> : null}
      {clip.statut === 'refuse' && clip.motif ? <Text style={{ ...texte(theme, 13), color: theme.critique }}>{trCm('clip.motif', { motif: clip.motif })}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`esport-cm-clip-${clip.id}`} />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {clip.genre === 'lien' && clip.url ? <BoutonHub theme={theme} titre={clip.youtube ? trCm('clip.voir_youtube') : trCm('clip.ouvrir_lien')} onPress={() => void Linking.openURL(clip.url!)} testID={`esport-cm-clip-${clip.id}-lien`} /> : null}
        {clip.fichier ? <BoutonHub theme={theme} titre={trCm('clip.lire')} onPress={() => void ouvrirLienDiffere(async () => (await api.lienClip(clip.id)).url)} testID={`esport-cm-clip-${clip.id}-lire`} /> : null}
        {clip.fichier ? <BoutonHub theme={theme} titre={trCm('fiche.telecharger')} onPress={() => void ouvrirLienDiffere(async () => (await api.lienClip(clip.id, true)).url)} testID={`esport-cm-clip-${clip.id}-telecharger`} /> : null}
        {clip.droits.trier && clip.statut !== 'retenu' && clip.statut !== 'utilise' ? <BoutonHub theme={theme} titre={trCm('clip.retenir')} variante="plein" onPress={() => void faire('retenir', () => api.deciderClip(clip.id, 'retenu'))} testID={`esport-cm-clip-${clip.id}-retenir`} /> : null}
        {clip.droits.trier && clip.statut !== 'refuse' ? <BoutonHub theme={theme} titre={trCm('clip.refuser')} onPress={() => setRefus(x => !x)} testID={`esport-cm-clip-${clip.id}-refuser`} /> : null}
        {clip.droits.trier && clip.statut !== 'utilise' ? <BoutonHub theme={theme} titre={trCm('clip.creer_carte')} onPress={() => void faire('carte', () => api.clipVersCarte(clip.id), trCm('clip.carte_creee'))} testID={`esport-cm-clip-${clip.id}-carte`} /> : null}
        {clip.droits.trier ? <BoutonHub theme={theme} titre={trCm('clip.joindre')} onPress={() => setJoindre(x => !x)} testID={`esport-cm-clip-${clip.id}-joindre`} /> : null}
        {clip.droits.supprimer ? <BoutonHub theme={theme} titre={trCm('c.supprimer')} variante="danger" onPress={() => void faire('supprimer', () => api.supprimerClip(clip.id))} testID={`esport-cm-clip-${clip.id}-supprimer`} /> : null}
      </View>
      {refus ? (
        <View style={{ gap: ESP.xs }}>
          <Champ theme={theme} libelle={trCm('clip.motif_champ')} valeur={motif} onChanger={setMotif} maxLength={500} testID={`esport-cm-clip-${clip.id}-motif`} />
          <BoutonHub theme={theme} titre={trCm('circuit.confirmer_refus')} variante="danger" onPress={() => void faire('refuser', () => api.deciderClip(clip.id, 'refuse', motif.trim()))} testID={`esport-cm-clip-${clip.id}-refus-ok`} />
        </View>
      ) : null}
      {joindre ? (
        <View style={{ gap: ESP.xs }}>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trCm('clip.chercher_carte')} valeur={q} onChanger={setQ} maxLength={80} testID={`esport-cm-clip-${clip.id}-q`} style={{ flex: 1, minWidth: 200 }} />
            <BoutonHub theme={theme} titre={trCm('espace.chercher')} desactive={q.trim().length < 2} onPress={() => void agir('chercher', async () => setCartes((await api.recherche(q.trim())).cartes.filter(c => !c.archive)))} testID={`esport-cm-clip-${clip.id}-chercher`} />
          </View>
          {cartes?.map(c => (
            <BoutonHub key={c.id} theme={theme} titre={c.titre} onPress={() => void faire('joindre', () => api.clipVersCarte(clip.id, c.id), trCm('clip.joint'))} testID={`esport-cm-clip-${clip.id}-vers-${c.id}`} />
          ))}
          {cartes && !cartes.length ? <Text style={attenue(theme)}>{trCm('clip.aucune_carte')}</Text> : null}
        </View>
      ) : null}
    </Carte>
  );
}

/** Galerie des clips (espace CM : toutes les teams visibles ; team : `teamId`). */
export function GalerieClips({ theme, api, large, teams = [], teamId }: { theme: ThemeHub; api: ApiCm; large: boolean; teams?: TeamCm[]; teamId?: string }) {
  const [statut, setStatut] = useState<StatutClip | ''>('propose');
  const [team, setTeam] = useState<string>(teamId ?? '');
  const [liste, setListe] = useState<ListeClips | undefined>();
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setListe(teamId ? await api.clipsTeam(teamId, statut || undefined) : await api.clips({ statut: statut || undefined, team: team || undefined })), [api, teamId, team, statut]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-clips">
      <Choix theme={theme} libelle={trCm('clip.statut')} valeur={statut} options={[{ id: '', nom: trCm('clip.tous') }, ...STATUTS_CLIP.map(s => ({ id: s, nom: nomStatutClip(s) }))]} onChoisir={v => setStatut(v as StatutClip | '')} testID="esport-cm-clips-statut" />
      {!teamId && teams.length > 1 ? <Choix theme={theme} libelle={trCm('clip.team')} valeur={team} options={[{ id: '', nom: trCm('clip.toutes_teams') }, ...teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))]} onChoisir={setTeam} testID="esport-cm-clips-team" /> : null}
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-clips" />
      {liste && !liste.clips.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="▶" titre={trCm('clip.vide')} texte={trCm('clip.vide_texte')} />
        </Carte>
      ) : null}
      <Grille min={large ? 340 : 260}>
        {liste?.clips.map(c => (
          <CarteClip key={c.id} theme={theme} api={api} clip={c} noms={liste.noms} onChange={() => void charger().catch(() => undefined)} teams={!teamId} />
        ))}
      </Grille>
    </View>
  );
}

/** Formulaire de proposition d'un clip (joueurs de la team), et « Mes clips ». */
export function ProposerClip({ theme, api, teamId, large }: { theme: ThemeHub; api: ApiCm; teamId: string; large: boolean }) {
  const [genre, setGenre] = useState<'lien' | 'fichier'>('lien');
  const [url, setUrl] = useState('');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [instant, setInstant] = useState('');
  const [lien, setLien] = useState('');
  const [matchs, setMatchs] = useState<MatchsTeam | undefined>();
  const [mes, setMes] = useState<ListeClips | undefined>();
  const envoi = useEnvoi();
  const { erreur, avis, agir, enCours } = useAgir();
  const charger = useCallback(async () => setMes(await api.clipsTeam(teamId)), [api, teamId]);
  useEffect(() => {
    void agir('', async () => {
      await charger();
      setMatchs(await api.matchs(teamId).catch(() => undefined));
    });
  }, [agir, api, teamId, charger]);
  const [genreLien, idLien] = lien.split(':') as ['resultat' | 'match' | '', string | undefined];
  const envoyer = () =>
    agir('proposer', async () => {
      const contexte = { titre: titre.trim(), description: description.trim(), instant: instant.trim() || undefined, ...(genreLien === 'resultat' ? { resultatId: idLien } : genreLien === 'match' ? { matchId: idLien } : {}) };
      if (genre === 'lien') await api.proposerClip(teamId, { genre: 'lien', url: url.trim(), ...contexte });
      else {
        const f = await choisirFichier(ACCEPT_CM, 'esport-cm-clip-fichier');
        if (!f) return undefined;
        const { etat, oublier } = await envoi.lancer({ client: api.client, teamId, section: 'cm', fichier: f });
        await api.proposerClip(teamId, { genre: 'fichier', envoi: etat.id, ...contexte });
        oublier();
        envoi.effacer();
      }
      setUrl('');
      setTitre('');
      setDescription('');
      setInstant('');
      setLien('');
      await charger();
      return trCm('clip.propose_ok');
    });
  const options = [
    { id: '', nom: trCm('clip.sans_match') },
    ...(matchs?.matchs ?? []).map(m => ({ id: `match:${m.id}`, nom: `${m.titre}${m.adversaires.length ? ` · ${m.adversaires.join(', ')}` : ''}` })),
    ...(matchs?.resultats ?? []).map(r => ({ id: `resultat:${r.id}`, nom: `${r.titre} · ${r.phrase}` })),
  ];
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-proposer">
      <Carte theme={theme}>
        <TitreCarte theme={theme} titre={trCm('clip.proposer')} sous={trCm('clip.proposer_aide')} />
        <Choix theme={theme} libelle={trCm('clip.genre')} valeur={genre} options={[{ id: 'lien', nom: trCm('clip.genre.lien') }, ...(choixFichierDisponible ? [{ id: 'fichier' as const, nom: trCm('clip.genre.fichier') }] : [])]} onChoisir={v => setGenre(v as 'lien' | 'fichier')} testID="esport-cm-clip-genre" />
        {genre === 'lien' ? <Champ theme={theme} libelle={trCm('clip.url')} valeur={url} onChanger={setUrl} placeholder="https://" maxLength={2000} testID="esport-cm-clip-url" /> : null}
        {!choixFichierDisponible ? <Aide theme={theme}>{trCm('fiche.fichier_depuis_pc')}</Aide> : null}
        <Champ theme={theme} libelle={trCm('clip.titre')} valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-cm-clip-titre" />
        <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.s }}>
          <Champ theme={theme} libelle={trCm('clip.instant_champ')} valeur={instant} onChanger={setInstant} placeholder="12:34" maxLength={8} testID="esport-cm-clip-instant" style={{ flex: 1 }} />
        </View>
        <Choix theme={theme} libelle={trCm('clip.match_lie')} valeur={lien} options={options} onChoisir={setLien} testID="esport-cm-clip-match" />
        <Champ theme={theme} libelle={trCm('clip.description')} valeur={description} onChanger={setDescription} multiligne maxLength={1000} testID="esport-cm-clip-description" />
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-proposer" />
        <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-cm-clip-envoi" />
        <BoutonHub theme={theme} titre={genre === 'fichier' ? trCm('clip.choisir_envoyer') : trCm('clip.envoyer')} variante="plein" desactive={Boolean(enCours) || titre.trim().length < 2 || (genre === 'lien' && !/^https:\/\//i.test(url.trim()))} onPress={() => void envoyer()} testID="esport-cm-clip-envoyer" />
      </Carte>
      {mes?.clips.length ? (
        <View style={{ gap: ESP.s }} testID="esport-cm-mes-clips">
          <Text accessibilityRole="header" style={{ ...texte(theme, 17), fontWeight: '700' }}>
            {mes.tous ? trCm('clip.de_la_team') : trCm('clip.mes_clips')}
          </Text>
          <Grille min={large ? 320 : 260}>
            {mes.clips.map(c => (
              <CarteClip key={c.id} theme={theme} api={api} clip={c} noms={mes.noms} onChange={() => void charger().catch(() => undefined)} />
            ))}
          </Grille>
        </View>
      ) : null}
    </View>
  );
}

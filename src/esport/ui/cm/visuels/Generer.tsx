/**
 * « Générer le visuel » (depuis une carte post, une suggestion automatique ou la galerie) : genre de visuel
 * (proposé d'après les liens de la carte ou la suggestion), modèle (par défaut ou du club), formats, langues
 * et source des données (résultat, match, tournoi, membre, roster, semaine). Crée un visuel par format et
 * par langue, puis (site et PC) les rend et les joint à la carte ; sur l'app mobile, ils seront rendus au
 * prochain passage sur le site ou l'app PC.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ApiCm, MatchsTeam, Personne, TeamCm } from '../../../cm/api';
import { refDefaut, type ApiVisuels, type DossierVisuel, type ModeleResume, type Visuel } from '../../../cm/visuels/api';
import { renduDisponible } from '../../../cm/visuels/generateur';
import { genererVisuel } from '../../../cm/visuels/generation';
import { SOURCE_DU_TYPE } from '../../../cm/visuels/modeles';
import { CLES_FORMATS, TYPES_VISUEL, type Charte, type CleFormat, type GenreSource, type Langue, type SourceVisuel, type TypeVisuel } from '../../../cm/visuels/types';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { Choix, Retours, styles, useAgir } from '../../commun';
import { ESP, Volet, attenue, texte } from '../../design';
import { Pastilles } from './controles';
import { optionsDossiers } from './Dossiers';

const GENRES: readonly GenreSource[] = ['resultat', 'annonce', 'tournoi', 'membre', 'equipe', 'semaine', 'libre'];

export function GenererVisuel({
  theme,
  api,
  apiCm,
  portee,
  carteId,
  proposition,
  teams,
  charte,
  dossiers: dossiersFournis,
  dossierInitial,
  onFermer,
  onCree,
}: {
  theme: ThemeHub;
  api: ApiVisuels;
  apiCm: ApiCm;
  portee: string;
  carteId?: string;
  proposition?: { type: TypeVisuel; source: SourceVisuel } | null;
  teams: TeamCm[];
  charte: Charte | undefined;
  /** Dossiers des visuels de la portée (migration 0041) ; lus ici s'ils ne sont pas fournis. */
  dossiers?: DossierVisuel[];
  /** Dossier proposé (dossier ouvert dans la galerie) ; sans : selon le genre. */
  dossierInitial?: string | null;
  onFermer(): void;
  onCree(visuels: Visuel[]): void;
}) {
  const [type, setType] = useState<TypeVisuel>(proposition?.type ?? 'annonce');
  const [modele, setModele] = useState<string>(refDefaut(proposition?.type ?? 'annonce'));
  const [modeles, setModeles] = useState<ModeleResume[]>([]);
  const [formats, setFormats] = useState<CleFormat[]>(['portrait']);
  const [langues, setLangues] = useState<Langue[]>(['fr', 'en']);
  const [genre, setGenre] = useState<GenreSource>(proposition?.source.genre ?? SOURCE_DU_TYPE[proposition?.type ?? 'annonce']);
  const teamFixe = portee !== 'club' ? portee : null;
  const [teamId, setTeamId] = useState<string>(teamFixe ?? proposition?.source.teamId ?? teams[0]?.id ?? '');
  const [element, setElement] = useState<string>(proposition?.source.id ?? '');
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [matchs, setMatchs] = useState<MatchsTeam | undefined>();
  const [membres, setMembres] = useState<Personne[] | undefined>();
  const [progression, setProgression] = useState<string | undefined>();
  const [dossiers, setDossiers] = useState<DossierVisuel[] | undefined>(dossiersFournis);
  // Dossier où ranger les visuels : « auto » (celui du genre), « racine », ou un dossier.
  const [dossier, setDossier] = useState<string>(dossierInitial ?? 'auto');
  useEffect(() => {
    if (dossiersFournis) return;
    void api
      .dossiers(portee)
      .then(r => setDossiers(r.dossiers))
      .catch(() => setDossiers([]));
  }, [api, portee, dossiersFournis]);
  const { erreur, avis, agir, enCours } = useAgir();

  useEffect(() => {
    void api
      .modeles(portee)
      .then(r => setModeles(r.modeles))
      .catch(() => setModeles([]));
  }, [api, portee]);
  useEffect(() => {
    if (!teamId) return;
    setMatchs(undefined);
    setMembres(undefined);
    if (['resultat', 'annonce', 'tournoi'].includes(genre)) void apiCm.matchs(teamId).then(setMatchs).catch(() => setMatchs({ resultats: [], matchs: [], tournois: [] }));
    if (genre === 'membre') void apiCm.membresTeam(teamId).then(r => setMembres(r.membres)).catch(() => setMembres([]));
  }, [apiCm, teamId, genre]);

  const choisirType = (t: TypeVisuel) => {
    setType(t);
    setModele(refDefaut(t));
    const g = proposition && proposition.type === t ? proposition.source.genre : SOURCE_DU_TYPE[t];
    setGenre(g);
    if (!(proposition && proposition.source.genre === g)) setElement('');
    else setElement(proposition.source.id ?? '');
  };
  const options: Array<{ id: string; nom: string }> =
    genre === 'resultat'
      ? (matchs?.resultats ?? []).map(r => ({ id: r.id, nom: `${r.titre} · ${r.phrase}` }))
      : genre === 'annonce'
        ? (matchs?.matchs ?? []).map(m => ({ id: m.id, nom: `${m.titre}${m.adversaires.length ? ` · ${m.adversaires.join(', ')}` : ''}${m.debut ? ` · ${m.debut.slice(0, 10)}` : ''}` }))
        : genre === 'tournoi'
          ? (matchs?.tournois ?? []).map(t => ({ id: t.id, nom: t.nom }))
          : genre === 'membre'
            ? (membres ?? []).map(m => ({ id: m.compte, nom: m.pseudo }))
            : [];
  const besoinElement = ['resultat', 'annonce', 'tournoi', 'membre'].includes(genre);
  const besoinTeam = genre !== 'libre' && genre !== 'semaine';
  const pret = formats.length > 0 && langues.length > 0 && (!besoinTeam || teamId) && (!besoinElement || element) && (genre !== 'semaine' || /^\d{4}-\d{2}-\d{2}$/.test(date));
  const n = formats.length * langues.length;
  const basculer = <T,>(liste: T[], v: T) => (liste.includes(v) ? liste.filter(x => x !== v) : [...liste, v]);

  const creer = () =>
    agir('creer', async () => {
      const source: Partial<SourceVisuel> = { genre, teamId: besoinTeam || (genre === 'semaine' && teamFixe) ? teamId || null : null, id: besoinElement ? element : null, date: genre === 'semaine' ? date : null };
      const crees: Visuel[] = [];
      const dossierId = dossier === 'auto' ? undefined : dossier === 'racine' ? null : dossier;
      for (const format of formats) for (const langue of langues) crees.push((await api.creerVisuel({ portee, carteId, modele, format, langue, source, dossierId })).visuel);
      // Rendu sur le site et le PC (un à la fois) ; sur mobile, seulement créés.
      if (renduDisponible && charte) {
        const modeleComplet = modele.startsWith('defaut:') ? null : (await api.modele(modele)).modele;
        for (let i = 0; i < crees.length; i++) {
          setProgression(trVi('generer.progression', { i: i + 1, n: crees.length }));
          crees[i] = (await genererVisuel(api, crees[i], charte, modeleComplet)) ?? crees[i];
        }
        setProgression(undefined);
      }
      onCree(crees);
      return trVi('generer.cree', { n: crees.length });
    });

  return (
    <Volet theme={theme} visible titre={trVi('generer.titre')} onFermer={onFermer} testID="esport-vi-generer-volet" largeur={620}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vi-generer" />
      <Pastilles<TypeVisuel> theme={theme} libelle={trVi('generer.type')} valeur={type} options={TYPES_VISUEL.map(t => [t, trVi(`type.${t}` as CleVi)] as const)} onChoisir={choisirType} testID="esport-vi-generer-type" />
      <Pastilles<string> theme={theme} libelle={trVi('generer.modele')} valeur={modele} options={[[refDefaut(type), trVi('generer.modele_defaut')], ...modeles.filter(m => m.type === type).map(m => [m.id, m.nom] as const)]} onChoisir={setModele} testID="esport-vi-generer-modele" />
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trVi('generer.formats')}</Text>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        {CLES_FORMATS.map(f => (
          <View key={f} style={[styles.ligne, { gap: 6 }]}>
            <Case theme={theme} coche={formats.includes(f)} libelle={trVi(`format.${f}` as CleVi)} onChanger={() => setFormats(basculer(formats, f))} testID={`esport-vi-generer-format-${f}`} />
            <Text style={texte(theme, 14)}>{trVi(`format.${f}` as CleVi)}</Text>
          </View>
        ))}
      </View>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trVi('generer.langues')}</Text>
      <View style={[styles.ligne, { gap: ESP.s }]}>
        {(['fr', 'en'] as const).map(l => (
          <View key={l} style={[styles.ligne, { gap: 6 }]}>
            <Case theme={theme} coche={langues.includes(l)} libelle={trVi(`langue.${l}`)} onChanger={() => setLangues(basculer(langues, l))} testID={`esport-vi-generer-langue-${l}`} />
            <Text style={texte(theme, 14)}>{trVi(`langue.${l}`)}</Text>
          </View>
        ))}
      </View>
      <Pastilles<GenreSource>
        theme={theme}
        libelle={trVi('generer.source')}
        valeur={genre}
        options={GENRES.map(g => [g, trVi(`source.${g}` as CleVi)] as const)}
        onChoisir={g => {
          setGenre(g);
          setElement('');
        }}
        testID="esport-vi-generer-source"
      />
      {besoinTeam && !teamFixe ? <Choix theme={theme} libelle={trVi('generer.team')} valeur={teamId} options={teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))} onChoisir={id => { setTeamId(id); setElement(''); }} testID="esport-vi-generer-team" /> : null}
      {besoinElement ? (
        options.length ? (
          <Choix theme={theme} libelle={trVi('generer.element')} valeur={element} options={options.slice(0, 30)} onChoisir={setElement} testID="esport-vi-generer-element" />
        ) : (
          <Text style={attenue(theme)}>{matchs || membres ? trVi('generer.aucun_element') : trVi('editeur.chargement')}</Text>
        )
      ) : null}
      {genre === 'semaine' ? <Champ theme={theme} libelle={trVi('generer.date')} valeur={date} onChanger={setDate} maxLength={10} testID="esport-vi-generer-date" /> : null}
      {dossiers?.length ? <Choix theme={theme} libelle={trVi('dossiers.dossier')} valeur={dossier} options={optionsDossiers(dossiers)} onChoisir={setDossier} testID="esport-vi-generer-dossier" /> : null}
      {progression ? <Text style={attenue(theme)}>{progression}</Text> : null}
      {!renduDisponible ? <Text style={attenue(theme)}>{trVi('generer.pc_requis')}</Text> : null}
      <BoutonHub theme={theme} titre={n > 1 ? trVi('generer.creer_tous', { n }) : trVi('carte.generer')} variante="plein" desactive={!pret || Boolean(enCours)} onPress={() => void creer()} testID="esport-vi-generer-ok" />
    </Volet>
  );
}

/**
 * Publier une même ressource (lien, vidéo YouTube ou note) dans PLUSIEURS teams d'un coup, depuis
 * l'Esport global (page Teams, Fondateur). Le serveur vérifie chaque team (appartenance → module →
 * resources.post) avant d'écrire quoi que ce soit : tout ou rien. Catégorie : une catégorie par défaut
 * (retrouvée dans chaque team) ou un nom (créée là où elle manque).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { CATEGORIES_DEFAUT, apiRessources, type GenreRessource, type TeamPublication, type VisibiliteRessource } from '../../ressources/api';
import { nomCategorie, nomGenre } from '../../ressources/libelles';
import { extraireYoutube } from '../../review/youtube';
import { lireTags } from '../../strats/libelles';
import { tr, trn } from '../../i18n';
import { ChampNote } from '../ChampNote';
import { Choix, Retours, styles, useAgir } from '../commun';
import { ESP, EtatVide, TYPO, Volet, attenue, texte } from '../design';

const GENRES_MULTI: readonly GenreRessource[] = ['lien', 'youtube', 'note'];

export function PublierMulti({ theme, client, onFermer }: { theme: ThemeHub; client: ClientEsport; onFermer(): void }) {
  const api = useMemo(() => apiRessources(client), [client]);
  const [teams, setTeams] = useState<TeamPublication[] | undefined>();
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  const [genre, setGenre] = useState<GenreRessource>('lien');
  const [url, setUrl] = useState('');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [categorie, setCategorie] = useState<string>('divers');
  const [autre, setAutre] = useState('');
  const [tags, setTags] = useState('');
  const [visibilite, setVisibilite] = useState<VisibiliteRessource>('team');
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setTeams(await api.teamsPublication()));
  }, [agir, api]);
  const basculer = (id: string) =>
    setChoisies(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pret = choisies.size > 0 && !enCours && (genre === 'note' ? titre.trim().length >= 2 && description.trim().length > 0 : genre === 'youtube' ? Boolean(extraireYoutube(url)) && titre.trim().length >= 2 : url.trim().length > 0) && (categorie !== 'autre' || autre.trim().length >= 2);

  return (
    <Volet theme={theme} visible titre={tr('ressources.multi.titre')} onFermer={onFermer} testID="esport-ressources-multi">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ressources-multi" />
      <Text style={attenue(theme, TYPO.texte)}>{tr('ressources.multi.explication')}</Text>
      {teams && teams.length === 0 ? <EtatVide theme={theme} glyphe="bibliotheque" titre={tr('ressources.multi.aucune_team')} texte={tr('ressources.multi.aucune_team_texte')} /> : null}
      {teams?.length ? (
        <View style={{ gap: ESP.xs }}>
          <Text style={{ ...texte(theme), fontWeight: '700' }}>{trn('ressources.multi.teams', choisies.size)}</Text>
          <View style={styles.ligne}>
            {teams.map(t => (
              <Pressable
                key={t.id}
                testID={`esport-ressources-multi-team-${t.slug}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: choisies.has(t.id) }}
                accessibilityLabel={t.nom}
                onPress={() => basculer(t.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ESP.xs,
                  minHeight: 44,
                  paddingHorizontal: ESP.s,
                  borderWidth: 1,
                  borderRadius: 10,
                  borderColor: choisies.has(t.id) ? theme.accent : theme.ligne,
                  backgroundColor: choisies.has(t.id) ? teinteTransparente(theme.accent, 0.16) : theme.surface,
                }}>
                <Text style={{ ...texte(theme), fontWeight: '800', color: choisies.has(t.id) ? theme.accent : theme.attenue }}>{choisies.has(t.id) ? '☑︎' : '☐'}</Text>
                <Text style={texte(theme)}>{t.nom}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={tr('ressources.multi.toutes')} onPress={() => setChoisies(new Set(teams.map(t => t.id)))} testID="esport-ressources-multi-toutes" />
          </View>
        </View>
      ) : null}
      <Choix<GenreRessource> theme={theme} libelle={tr('resumes.type')} valeur={genre} options={GENRES_MULTI.map(g => ({ id: g, nom: nomGenre(g) }))} onChoisir={setGenre} testID="esport-ressources-multi-genre" />
      {genre !== 'note' ? <Champ theme={theme} libelle={genre === 'youtube' ? tr('ressources.adresse_youtube') : tr('ressources.adresse')} valeur={url} onChanger={setUrl} placeholder="https://" maxLength={2048} testID="esport-ressources-multi-url" /> : null}
      <Champ theme={theme} libelle={genre === 'lien' ? tr('ressources.titre_facultatif') : tr('objectifs.titre')} valeur={titre} onChanger={setTitre} maxLength={120} testID="esport-ressources-multi-titre" />
      <ChampNote theme={theme} libelle={genre === 'note' ? tr('ressources.texte_note') : tr('ressources.description')} valeur={description} onChanger={setDescription} maxLength={8000} testID="esport-ressources-multi-description" apercu="jamais" />
      <Choix
        theme={theme}
        libelle={tr('ressources.categorie')}
        valeur={categorie}
        options={[...CATEGORIES_DEFAUT.map(c => ({ id: c as string, nom: nomCategorie({ nom: c, cleDefaut: c }) })), { id: 'autre', nom: tr('ressources.multi.autre_categorie') }]}
        onChoisir={setCategorie}
        testID="esport-ressources-multi-categorie"
      />
      {categorie === 'autre' ? <Champ theme={theme} libelle={tr('ressources.multi.nom_categorie')} valeur={autre} onChanger={setAutre} maxLength={40} testID="esport-ressources-multi-categorie-nom" /> : null}
      <Champ theme={theme} libelle={tr('strats.playbook.tags_separes_par_des')} valeur={tags} onChanger={setTags} maxLength={200} testID="esport-ressources-multi-tags" />
      <Segments<VisibiliteRessource> theme={theme} libelle={tr('resumes.visibilite')} valeur={visibilite} options={[['team', tr('ressources.visibilite.team')], ['staff', tr('ressources.visibilite.staff')]]} onChoisir={setVisibilite} testID="esport-ressources-multi-visibilite" />
      <BoutonHub
        theme={theme}
        titre={trn('ressources.multi.publier', choisies.size)}
        variante="plein"
        desactive={!pret}
        onPress={() =>
          void agir('publier', async () => {
            const r = await api.publierMulti({
              teams: [...choisies],
              genre,
              ...(genre !== 'note' ? { url: url.trim() } : {}),
              titre: titre.trim(),
              description,
              tags: lireTags(tags),
              visibilite,
              categorie: categorie === 'autre' ? { nom: autre.trim() } : { cleDefaut: categorie },
            });
            setUrl('');
            setTitre('');
            setDescription('');
            setTags('');
            return trn('ressources.multi.publiee', r.ressources.length, { teams: r.ressources.map(x => x.team).join(', ') });
          })
        }
        testID="esport-ressources-multi-publier"
      />
    </Volet>
  );
}

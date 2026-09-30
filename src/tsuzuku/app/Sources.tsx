/**
 * Sources (rang administrateur) : sites que l'utilisateur branche lui-même, décrits par
 * des sélecteurs CSS. VIDE par défaut : Tsuzuku n'en fournit aucune. Les amis utilisent
 * les sources de l'administrateur (jamais les modifier). Section « Films » distincte.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { messageDe } from '../moteur/erreurs';
import { diagnostiquerRecherche, type DiagnosticEtape } from '../moteur/resolution';
import { LANGUES, ajouterSource, importerSources, modifierSource, supporteFilms, supprimerSource, type DefinitionSource, type Langue } from '../moteur/sources';
import { useCharger, useTsuzuku } from './contexte';
import { Avis, Bouton, Champ, Etat, Puce, Titre, styleAttenue, styleTexte, styleTitre } from './ui';

const LIBELLE_LANGUE: Record<Langue, string> = { vf: 'VF', vostfr: 'VOSTFR', indifferent: 'Indifférent' };

type Brouillon = Record<string, unknown>;

const GROUPES: ReadonlyArray<{ titre: string; aide?: string; champs: ReadonlyArray<readonly [string, string, string?]> }> = [
  {
    titre: 'Animés · recherche',
    aide: '{query} est remplacé par le titre. Un sélecteur vide désactive la partie.',
    champs: [
      ['search.path', 'Chemin de recherche', '/recherche?q={query}'],
      ['search.pathVf', 'Chemin VF (facultatif)'],
      ['search.pathVostfr', 'Chemin VOSTFR (facultatif)'],
      ['search.item', 'Sélecteur d’un résultat', 'ul.resultats li'],
      ['search.title', 'Titre (relatif au résultat)', 'a.titre'],
      ['search.link', 'Lien (relatif au résultat)', 'a'],
    ],
  },
  {
    titre: 'Animés · épisodes',
    champs: [
      ['episodes.item', 'Sélecteur d’un épisode', 'ol.episodes li'],
      ['episodes.number', 'Numéro', '.num'],
      ['episodes.title', 'Titre', '.nom'],
      ['episodes.link', 'Lien', 'a'],
    ],
  },
  {
    titre: 'Animés · lecteur',
    champs: [
      ['player.iframe', 'Sélecteur des iframes', 'div.lecteur iframe'],
      ['player.options', 'Lecteurs en menu (option)', 'select.lecteurs option'],
      ['player.optionAttr', 'Attribut de l’option', 'value'],
      ['player.optionLabel', 'Nom du lecteur (option)'],
    ],
  },
  {
    titre: 'Films · recherche',
    aide: 'Sans chemin ni sélecteur de résultat, la source ne sert pas aux films.',
    champs: [
      ['movies.search.path', 'Chemin de recherche des films', '/films?q={query}'],
      ['movies.search.item', 'Sélecteur d’un film', '.film'],
      ['movies.search.title', 'Titre', 'h3'],
      ['movies.search.link', 'Lien', 'a'],
      ['movies.search.year', 'Année', '.an'],
    ],
  },
  {
    titre: 'Films · lecteur',
    champs: [
      ['movies.player.iframe', 'Sélecteur des iframes', 'iframe.film'],
      ['movies.player.options', 'Lecteurs en menu (option)'],
    ],
  },
];

const lire = (o: Brouillon, chemin: string): string => {
  let v: unknown = o;
  for (const c of chemin.split('.')) v = (v as Record<string, unknown> | undefined)?.[c];
  return typeof v === 'string' ? v : '';
};
const ecrire = (o: Brouillon, chemin: string, valeur: string): Brouillon => {
  const [tete, ...reste] = chemin.split('.');
  if (!reste.length) return { ...o, [tete]: valeur };
  return { ...o, [tete]: ecrire((o[tete] as Brouillon | undefined) ?? {}, reste.join('.'), valeur) };
};

export function Sources() {
  const { s, theme, version, changee } = useTsuzuku();
  const [liste, setListe] = useState<DefinitionSource[] | undefined>();
  const charge = useCharger(async () => {
    const l = await s.sources();
    setListe(l);
    return l;
  }, [s, version]);
  const [edition, setEdition] = useState<{ id?: string; brouillon: Brouillon } | undefined>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [titreTest, setTitreTest] = useState('Naruto');
  const [diag, setDiag] = useState<{ id: string; etape: DiagnosticEtape } | undefined>();
  const [jsonImport, setJsonImport] = useState('');
  const sources = liste ?? charge.donnees ?? [];

  if (!s.estAdmin) {
    return (
      <View style={{ gap: 12 }} testID="tsuzuku-sources-interdit">
        <Titre>Sources</Titre>
        <Avis genre="info" texte="Les sources sont gérées par l’administrateur : vous utilisez les siennes, sans pouvoir les modifier." />
        <Text style={styleAttenue(theme, 14)}>{sources.length ? `${sources.length} source(s) disponible(s) pour vous.` : 'Aucune source n’est disponible pour le moment.'}</Text>
      </View>
    );
  }

  const enregistrer = async (nouvelle: DefinitionSource[]) => {
    await s.enregistrerSources(nouvelle);
    setListe(nouvelle);
    changee();
  };
  const agir = async (fn: () => Promise<void | string>, ok?: string) => {
    try {
      setErreur(undefined);
      const message = await fn();
      setAvis(typeof message === 'string' ? message : ok);
    } catch (e) {
      setAvis(undefined);
      setErreur(messageDe(e));
    }
  };
  const sauver = () =>
    agir(async () => {
      if (!edition) return;
      const { liste: suite } = edition.id ? modifierSource(sources, edition.id, edition.brouillon) : ajouterSource(sources, { ...edition.brouillon, enabled: edition.brouillon.enabled ?? true });
      await enregistrer(suite);
      setEdition(undefined);
    }, 'Source enregistrée.');
  const importer = () =>
    agir(async () => {
      const { sources: lues, ecartees } = importerSources(JSON.parse(jsonImport));
      const ids = new Set(sources.map(x => x.id));
      await enregistrer([...sources, ...lues.filter(x => !ids.has(x.id))]);
      setJsonImport('');
      return `${lues.length} source(s) importée(s)${ecartees ? `, ${ecartees} écartée(s)` : ''}.`;
    });
  const tester = (src: DefinitionSource) =>
    agir(async () => {
      setDiag({ id: src.id, etape: await diagnostiquerRecherche(s.ctx, src, titreTest || 'a') });
    });

  return (
    <View style={{ gap: 16 }} testID="tsuzuku-sources">
      <Titre>Sources</Titre>
      <Text style={styleAttenue(theme, 14)}>
        Tsuzuku ne fournit aucune source. Branchez seulement des sites dont vous avez le droit de vous servir (votre médiathèque, un service dont vous détenez les droits, un site de diffusion libre). Les amis utilisent vos sources en lecture seule.
      </Text>
      {!s.lectureSources ? <Avis genre="alerte" texte="Sur le site, les pages des sources ne peuvent pas être lues (CORS) : lecture disponible sur l’app PC/iPhone ; sur le site, bientôt. Vous pouvez néanmoins préparer vos sources ici." /> : null}
      <Etat enCours={charge.enCours && !liste} erreur={charge.erreur} onRecharger={charge.recharger}>
        {sources.length === 0 ? <Text style={styleTexte(theme, 14)} testID="sources-vide">Aucune source pour le moment.</Text> : null}
        {sources.map(src => (
          <View key={src.id} testID={`source-${src.id}`} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }}>
            <Text style={[styleTitre(theme, 16)]}>{src.name}</Text>
            <Text style={styleAttenue(theme, 13)} numberOfLines={1}>
              {src.baseUrl} · {LIBELLE_LANGUE[src.language]} · {src.enabled ? 'activée' : 'désactivée'}
              {supporteFilms(src) ? ' · films' : ''}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Bouton titre={src.enabled ? 'Désactiver' : 'Activer'} onPress={() => void agir(() => enregistrer(sources.map(x => (x.id === src.id ? { ...x, enabled: !x.enabled } : x))))} testID={`source-activer-${src.id}`} />
              <Bouton titre="Modifier" onPress={() => setEdition({ id: src.id, brouillon: JSON.parse(JSON.stringify(src)) as Brouillon })} testID={`source-modifier-${src.id}`} />
              {s.lectureSources ? <Bouton titre="Tester" onPress={() => void tester(src)} testID={`source-tester-${src.id}`} /> : null}
              <Bouton titre="Supprimer" variante="danger" onPress={() => void agir(() => enregistrer(supprimerSource(sources, src.id)), 'Source supprimée.')} testID={`source-supprimer-${src.id}`} />
            </View>
            {diag?.id === src.id ? <Avis genre={diag.etape.ok ? 'ok' : 'alerte'} texte={`${diag.etape.detail}${diag.etape.pistes.length ? ` Pistes : ${diag.etape.pistes.slice(0, 4).join(', ')}` : ''}`} /> : null}
          </View>
        ))}
      </Etat>
      {s.lectureSources && sources.length ? <Champ libelle="Titre pour tester la recherche" valeur={titreTest} onChanger={setTitreTest} testID="sources-titre-test" /> : null}
      {edition ? (
        <View style={{ gap: 12, padding: 12, borderWidth: 1, borderColor: theme.accent, borderRadius: theme.rayonMoyen }} testID="source-formulaire" accessibilityLabel={edition.id ? 'Modifier la source' : 'Nouvelle source'}>
          <Titre taille={18}>{edition.id ? 'Modifier la source' : 'Nouvelle source'}</Titre>
          <Champ libelle="Nom" valeur={lire(edition.brouillon, 'name')} onChanger={v => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, 'name', v) })} testID="source-nom" />
          <Champ libelle="Adresse du site (https://…)" valeur={lire(edition.brouillon, 'baseUrl')} onChanger={v => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, 'baseUrl', v) })} testID="source-adresse" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Langue">
            {LANGUES.map(l => (
              <Puce key={l} titre={LIBELLE_LANGUE[l]} actif={(lire(edition.brouillon, 'language') || 'indifferent') === l} onPress={() => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, 'language', l) })} testID={`source-langue-${l}`} />
            ))}
          </View>
          {GROUPES.map(g => (
            <View key={g.titre} style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={styleTitre(theme, 15)}>{g.titre}</Text>
              {g.aide ? <Text style={styleAttenue(theme, 12)}>{g.aide}</Text> : null}
              {g.champs.map(([chemin, libelle, exemple]) => (
                <Champ key={chemin} libelle={libelle} valeur={lire(edition.brouillon, chemin)} onChanger={v => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, chemin, v) })} placeholder={exemple} testID={`source-champ-${chemin}`} />
              ))}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Bouton titre="Enregistrer la source" variante="plein" onPress={() => void sauver()} testID="source-enregistrer" />
            <Bouton titre="Annuler" onPress={() => { setEdition(undefined); setErreur(undefined); }} testID="source-annuler" />
          </View>
        </View>
      ) : (
        <Bouton titre="+ Ajouter une source" onPress={() => setEdition({ brouillon: { enabled: true, language: 'indifferent' } })} testID="source-ajouter" style={{ alignSelf: 'flex-start' }} />
      )}
      <View style={{ gap: 8 }}>
        <Titre taille={16}>Importer d’anciennes sources</Titre>
        <Champ libelle="Contenu d’un ancien sources.json" valeur={jsonImport} onChanger={setJsonImport} multiligne testID="sources-import-texte" />
        <Bouton titre="Importer" onPress={() => void importer()} desactive={!jsonImport.trim()} testID="sources-importer" style={{ alignSelf: 'flex-start' }} />
      </View>
      {avis ? <Avis genre="ok" texte={avis} testID="sources-avis" /> : null}
      {erreur ? <Avis genre="critique" texte={erreur} testID="sources-erreur" /> : null}
    </View>
  );
}

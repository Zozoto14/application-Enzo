/**
 * Sources de Tsuzuku (rangs habilités : Fondateur). UNE implémentation, deux
 * entrées :
 *
 *  - la page « Sources » de l'app (onglet de l'en-tête sur PC/tablette, de la
 *    barre basse sur téléphone, avec le nombre de sources actives) ;
 *  - Paramètres › Administration › Tsuzuku · Sources (`AdminTsuzuku.tsx`).
 *
 * Sites branchés par l'administration, décrits par des sélecteurs CSS. VIDE
 * par défaut : Tsuzuku n'en fournit aucune. « + Ajouter une source » propose
 * l'assistant (lien du site → prompt pour une IA → JSON → test →
 * enregistrement, `AssistantSource.tsx`) ou la saisie du JSON. Pour chaque
 * source, le Fondateur choisit qui y a accès (lui seul, tous les utilisateurs
 * autorisés à Tsuzuku, ou une sélection) ; la synchronisation publie ensuite,
 * chiffrée, dans l'espace de chaque bénéficiaire. Les autres rangs ne voient
 * jamais cette page (ni onglet, ni Paramètres) et la règle est revérifiée par
 * les services (`gestion.ts`, 403).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../hub/themes';
import { RAPPEL_DROITS, testReussi, testerSourcePasAPas, type EtapeTest } from '../moteur/assistant';
import { messageDe } from '../moteur/erreurs';
import { LANGUES, ajouterSource, modifierSource, supprimerSource, type DefinitionSource } from '../moteur/sources';
import { AideConfiguration } from './AideSources';
import { AssistantSource, ChoixPartage, LIBELLE_LANGUE, typeDe, type CompteTsuzuku, type SourceAssistant } from './AssistantSource';
import { useCharger, useTsuzuku } from './contexte';
import { exporterSources, importerExportSources, partageDe, quiRecoitQuoi, type Partages, type TestsSources } from './gestion';
import { Avis, Bouton, Champ, Etat, Puce, Titre, styleAttenue, styleTexte, styleTitre } from './ui';

export type { CompteTsuzuku } from './AssistantSource';

type Brouillon = Record<string, unknown>;

const GROUPES: ReadonlyArray<{ titre: string; aide?: string; champs: ReadonlyArray<readonly [string, string, string?]> }> = [
  {
    titre: 'Animés · recherche',
    aide: '{query} (ou {q}) est remplacé par le titre ; {slug} ouvre directement la page de l’oeuvre. Type « json » : item, titre et lien sont des chemins JSON. Voir « Comment bien configurer une source ».',
    champs: [
      ['search.path', 'Chemin de recherche', '/recherche?q={query}'],
      ['search.pathVf', 'Chemin VF (facultatif)'],
      ['search.pathVostfr', 'Chemin VOSTFR (facultatif)'],
      ['search.item', 'Sélecteur d’un résultat (ou chemin JSON de la liste)', 'ul.resultats li'],
      ['search.title', 'Titre (relatif au résultat)', 'a.titre'],
      ['search.link', 'Lien (relatif au résultat)', 'a'],
      ['search.image', 'Image (relatif au résultat, facultatif)', 'img'],
      ['search.type', 'Type de réponse : html ou json (facultatif)', 'html'],
      ['search.method', 'Méthode : GET ou POST (facultatif)', 'GET'],
      ['search.body', 'Corps du POST (facultatif)', 'action=recherche&s={query}'],
      ['search.linkFormat', 'Lien fabriqué depuis un identifiant (facultatif)', '/anime/{value}'],
      ['search.htmlPath', 'JSON : chemin du fragment HTML (facultatif)', 'data.html'],
    ],
  },
  {
    titre: 'Animés · épisodes',
    champs: [
      ['episodes.item', 'Sélecteur d’un épisode', 'ol.episodes li'],
      ['episodes.number', 'Numéro', '.num'],
      ['episodes.title', 'Titre', '.nom'],
      ['episodes.link', 'Lien', 'a'],
      ['episodes.next', 'Lien « page suivante » (facultatif)', 'a.suivant'],
      ['episodes.type', 'Type : html ou json (facultatif)', 'html'],
      ['episodes.linkFormat', 'Lien fabriqué depuis un identifiant (facultatif)', '/episode/{value}'],
    ],
  },
  {
    titre: 'Animés · lecteur',
    champs: [
      ['player.iframe', 'Sélecteur des iframes', 'div.lecteur iframe'],
      ['player.attr', 'Attribut de l’iframe', 'src'],
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


/** Guide court de la page (bouton « ? »). */
function Aide({ onFermer }: { onFermer(): void }) {
  const { theme } = useTsuzuku();
  const bloc = (titre: string, texte: string) => (
    <View style={{ gap: 2 }}>
      <Text style={[styleTexte(theme, 14), { fontWeight: '800' }]}>{titre}</Text>
      <Text style={[styleAttenue(theme, 14), { lineHeight: 20 }]}>{texte}</Text>
    </View>
  );
  return (
    <View testID="sources-aide" accessibilityLabel="Aide sur les sources" style={{ gap: 10, padding: 14, borderRadius: theme.rayonMoyen, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
      {bloc('Qu’est-ce qu’une source ?', 'Un site que vous avez le droit d’utiliser (votre médiathèque, un service dont vous détenez les droits, un site de diffusion libre), décrit par des sélecteurs CSS : où chercher un titre, où trouver la liste des épisodes, où est le lecteur. Tsuzuku n’en fournit aucune.')}
      {bloc('Comment marche l’assistant ?', '1. Collez l’adresse d’une page du site. 2. L’app l’analyse et prépare un prompt : copiez-le dans l’IA de votre choix. 3. Collez sa réponse (un JSON) : elle est vérifiée, et « Réparer avec l’IA » prépare un prompt de correction si besoin. 4. Testez, puis enregistrez.')}
      {bloc('Que mettre dans le prompt ?', 'Rien à écrire : il est généré, avec tout le format de source, un exemple et l’extrait de la page. Donnez de préférence l’adresse d’une page de résultats de recherche ; sur le site web, collez le code HTML de la page ou demandez à l’IA d’analyser le site elle-même.')}
      {bloc('Ça ne trouve pas l’animé ?', 'Lisez « Comment bien configurer une source » ci-dessous (recherche, {slug}, API JSON, pages JavaScript, anti-robot), puis, sur la fiche, « Tester une source sur ce titre » et « Copier le diagnostic ».')}
      {bloc('Comment tester ?', 'Indiquez un titre présent sur le site : l’app le cherche, ouvre le premier résultat, lit ses épisodes et cherche un lecteur. Chaque étape affiche OK ou KO ; le dernier résultat reste affiché dans la liste.')}
      <Text style={[styleTexte(theme, 13), { fontWeight: '700' }]}>{RAPPEL_DROITS}</Text>
      <Bouton titre="Fermer l’aide" onPress={onFermer} testID="sources-aide-fermer" style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

/** Pastille d'état (activée, test OK/KO). */
function Pastille({ texte, couleur, testID }: { texte: string; couleur: string; testID?: string }) {
  const { theme } = useTsuzuku();
  return (
    <View testID={testID} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: teinteTransparente(couleur, 0.16), borderWidth: 1, borderColor: teinteTransparente(couleur, 0.5) }}>
      <Text style={{ color: theme.texte, fontSize: 12, fontWeight: '700', ...police(theme.policeTexte) }}>{texte}</Text>
    </View>
  );
}

const dateCourte = (iso: string) => (iso ? iso.slice(0, 10) : '');

export interface PropsSources {
  comptes?: readonly CompteTsuzuku[];
  /** Faux pour un Fondateur autre que le compte historique (le partage est publié par celui-ci). */
  partageActif?: boolean;
  /** Ouvre Paramètres › Administration (clés d'API). Absent : déjà dans Paramètres. */
  onCles?(): void;
  /** Ouvre directement un chemin d'ajout (état vide « Ajouter une source avec l'assistant »). */
  ajoutInitial?: 'assistant' | 'json';
  /** Rendu comme page de l'app (titre) plutôt que dans Paramètres. */
  page?: boolean;
}

type Vue = 'liste' | 'choix' | 'assistant' | 'json' | 'formulaire';

export function Sources({ comptes = [], partageActif = true, onCles, ajoutInitial, page }: PropsSources) {
  const { s, theme, version, changee, large, enregistrerFichier } = useTsuzuku();
  const [liste, setListe] = useState<DefinitionSource[] | undefined>();
  const [partages, setPartages] = useState<Partages | undefined>();
  const [tests, setTests] = useState<TestsSources>({});
  const charge = useCharger(async () => {
    const [l, p, t] = await Promise.all([s.sourcesPropres(), s.partages(), s.derniersTests()]);
    setListe(l);
    setPartages(p);
    setTests(t);
    return l;
  }, [s, version]);
  const [vue, setVue] = useState<Vue>(ajoutInitial ?? 'liste');
  const [edition, setEdition] = useState<{ id?: string; brouillon: Brouillon } | undefined>();
  const [aide, setAide] = useState(false);
  const [aideConfig, setAideConfig] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [titreTest, setTitreTest] = useState('');
  const [diag, setDiag] = useState<{ id: string; etapes: EtapeTest[] } | undefined>();
  const [enTest, setEnTest] = useState<string | undefined>();
  const [jsonImport, setJsonImport] = useState('');
  const [exportTexte, setExportTexte] = useState<string | undefined>();
  const [nouvelle, setNouvelle] = useState<string | undefined>();
  const sources = liste ?? charge.donnees ?? [];

  if (!s.estAdmin) {
    // Jamais proposé aux autres rangs ; si un écran s'y trompait, rien n'est montré.
    return <Avis genre="info" texte="Les sources de Tsuzuku sont réservées aux Fondateurs." testID="tsuzuku-sources-interdit" />;
  }

  const actives = sources.filter(x => x.enabled).length;
  const enregistrer = async (suite: DefinitionSource[]) => {
    await s.enregistrerSources(suite);
    setListe(suite);
    setPartages(await s.partages());
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
      const { liste: suite, source } = edition.id ? modifierSource(sources, edition.id, edition.brouillon) : ajouterSource(sources, { ...edition.brouillon, enabled: edition.brouillon.enabled ?? true });
      await enregistrer(suite);
      setNouvelle(source.id);
      setEdition(undefined);
      setVue('liste');
    }, 'Source enregistrée.');
  const importer = () =>
    agir(async () => {
      const { sources: lues, ecartees, doublons } = importerExportSources(jsonImport, sources);
      await enregistrer([...sources, ...lues]);
      setJsonImport('');
      return `${lues.length} source(s) importée(s)${ecartees ? `, ${ecartees} écartée(s) (adresse non publique ou sélecteur invalide)` : ''}${doublons ? `, ${doublons} déjà présente(s)` : ''}.`;
    });
  const exporter = () =>
    agir(async () => {
      const texte = exporterSources(sources, new Date().toISOString());
      const nom = `tsuzuku-sources-${new Date().toISOString().slice(0, 10)}.json`;
      if (enregistrerFichier && (await enregistrerFichier(nom, texte, 'application/json'))) {
        setExportTexte(undefined);
        return `${sources.length} source(s) exportée(s) dans « ${nom} » (sans clé d’API ni partage).`;
      }
      setExportTexte(texte);
      return 'Copiez le texte ci-dessous (sans clé d’API ni partage) pour le coller sur un autre appareil.';
    });
  const tester = (src: DefinitionSource) =>
    agir(async () => {
      setEnTest(src.id);
      try {
        const etapes = await testerSourcePasAPas(s.ctx, src, { titres: [titreTest.trim() || 'a'], langue: (await s.reglages()).langue });
        setDiag({ id: src.id, etapes });
        const resume = { ok: testReussi(etapes), date: new Date().toISOString(), detail: etapes.map(e => `${e.nom} : ${e.ok === true ? 'OK' : e.ok === false ? 'KO' : '—'}`).join(' · ') };
        await s.enregistrerTest(src.id, resume);
        setTests(await s.derniersTests());
      } finally {
        setEnTest(undefined);
      }
    });
  const partager = (p: Partages) =>
    agir(async () => {
      await s.enregistrerPartages(p);
      setPartages(await s.partages());
    }, 'Partage enregistré : il part à la prochaine synchronisation.');
  const depuisAssistant = async ({ source, partage, test }: SourceAssistant): Promise<boolean> => {
    let ok = false;
    await agir(async () => {
      const { liste: suite, source: ajoutee } = ajouterSource(sources, source);
      await enregistrer(suite);
      if (partage.mode !== 'personne' && partageActif) {
        await s.enregistrerPartages({ ...(await s.partages()), [ajoutee.id]: partage });
        setPartages(await s.partages());
      }
      if (test) {
        await s.enregistrerTest(ajoutee.id, { ...test, date: new Date().toISOString() });
        setTests(await s.derniersTests());
      }
      setNouvelle(ajoutee.id);
      setVue('liste');
      ok = true;
      return `Source « ${ajoutee.name} » ajoutée${partage.mode === 'personne' ? ' (pour vous seul pour l’instant)' : ''}.`;
    });
    return ok;
  };
  const recoit = partageActif && partages ? quiRecoitQuoi(sources, partages, comptes) : [];

  return (
    <View style={{ gap: 16 }} testID="tsuzuku-sources">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          {page ? <Titre taille={large ? 30 : 26} testID="sources-titre">Sources</Titre> : null}
          <Text style={styleAttenue(theme, 14)} testID="sources-compte">
            {sources.length ? `${sources.length} source(s) · ${actives} active(s)` : 'Aucune source pour le moment'}
          </Text>
          <PastilleSynchro />
        </View>
        <Pressable
          testID="sources-aide-ouvrir"
          accessibilityRole="button"
          accessibilityLabel="Aide : comment ajouter une source"
          accessibilityState={{ expanded: aide }}
          onPress={() => setAide(a => !a)}
          style={{ marginLeft: 'auto', width: 44, height: 44, borderRadius: 999, borderWidth: 1, borderColor: aide ? theme.accent : theme.ligne, backgroundColor: aide ? theme.accent : theme.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: aide ? theme.surAccent : theme.texte, fontSize: 18, fontWeight: '800' }}>?</Text>
        </Pressable>
      </View>
      {aide ? <Aide onFermer={() => setAide(false)} /> : null}
      <Bouton titre={aideConfig ? 'Masquer : comment bien configurer une source' : 'Comment bien configurer une source'} onPress={() => setAideConfig(v => !v)} testID="sources-aide-config-ouvrir" style={{ alignSelf: 'flex-start' }} />
      {aideConfig ? <AideConfiguration onFermer={() => setAideConfig(false)} /> : null}
      {/* Rappel visible en permanence ; l'assistant ouvert porte le sien (pas de doublon). */}
      {vue !== 'assistant' && vue !== 'json' ? <Avis genre="alerte" texte={RAPPEL_DROITS} testID="sources-rappel" /> : null}
      {!s.lectureSources ? <Avis texte="Sur le site web, les pages des sources ne peuvent pas être lues (CORS) : test et lecture sur l’app PC/iPhone. Vous pouvez néanmoins préparer, importer et partager vos sources ici." /> : null}
      {!partageActif ? <Avis texte="Le partage des sources est publié par le compte historique (Fondateur d’origine) : les sources ajoutées ici ne servent qu’à vous." testID="sources-partage-historique" /> : null}

      {vue === 'liste' ? (
        <Bouton titre="+ Ajouter une source" variante="plein" onPress={() => setVue('choix')} testID="sources-ajouter" style={{ alignSelf: large ? 'flex-start' : 'stretch', minHeight: 48 }} />
      ) : null}
      {vue === 'choix' ? (
        <View testID="sources-choix-ajout" style={{ gap: 10, padding: 14, borderRadius: theme.rayonMoyen, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.surface }}>
          <Text style={styleTitre(theme, 17)}>Ajouter une source</Text>
          <Pressable testID="sources-assistant" accessibilityRole="button" accessibilityLabel="Avec l’assistant (recommandé)" onPress={() => setVue('assistant')} style={{ gap: 2, padding: 12, borderRadius: theme.rayonMoyen, backgroundColor: theme.accent }}>
            <Text style={{ color: theme.surAccent, fontWeight: '800', fontSize: 16, ...police(theme.policeTexte) }}>Avec l’assistant (recommandé)</Text>
            <Text style={{ color: theme.surAccent, opacity: 0.9, fontSize: 13, ...police(theme.policeTexte) }}>Collez le lien du site : l’app prépare un prompt pour une IA, vérifie sa réponse et la teste.</Text>
          </Pressable>
          <Pressable testID="sources-json" accessibilityRole="button" accessibilityLabel="Saisir ou coller le JSON" onPress={() => setVue('json')} style={{ gap: 2, padding: 12, borderRadius: theme.rayonMoyen, borderWidth: 1, borderColor: theme.ligne }}>
            <Text style={{ color: theme.texte, fontWeight: '800', fontSize: 16, ...police(theme.policeTexte) }}>Saisir ou coller le JSON</Text>
            <Text style={styleAttenue(theme, 13)}>Vous avez déjà la définition de la source (JSON) : elle est vérifiée et testée avant l’enregistrement.</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton titre="Remplir le formulaire champ par champ" onPress={() => { setEdition({ brouillon: { enabled: true, language: 'indifferent' } }); setVue('formulaire'); }} testID="source-ajouter" />
            <Bouton titre="Annuler" onPress={() => setVue('liste')} testID="sources-choix-annuler" />
          </View>
        </View>
      ) : null}
      {vue === 'assistant' || vue === 'json' ? (
        <AssistantSource
          key={vue}
          depart={vue === 'json' ? 'json' : 'adresse'}
          comptes={comptes}
          partageActif={partageActif}
          onFermer={() => setVue('liste')}
          onEnregistrer={depuisAssistant}
          onFormulaire={src => {
            const brouillon = JSON.parse(JSON.stringify(src)) as Brouillon;
            delete brouillon.id;
            delete brouillon.createdAt;
            setEdition({ brouillon });
            setVue('formulaire');
          }}
        />
      ) : null}
      {vue === 'formulaire' && edition ? (
        <View style={{ gap: 12, padding: 12, borderWidth: 1, borderColor: theme.accent, borderRadius: theme.rayonMoyen }} testID="source-formulaire" accessibilityLabel={edition.id ? 'Modifier la source' : 'Nouvelle source'}>
          <Titre taille={18}>{edition.id ? 'Modifier la source' : 'Nouvelle source'}</Titre>
          <Champ libelle="Nom" valeur={lire(edition.brouillon, 'name')} onChanger={v => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, 'name', v) })} testID="source-nom" />
          <Champ libelle="Adresse du site (https://…)" valeur={lire(edition.brouillon, 'baseUrl')} onChanger={v => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, 'baseUrl', v) })} testID="source-adresse" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Langue">
            {LANGUES.map(l => (
              <Puce key={l} titre={l === 'indifferent' ? 'Indifférent' : LIBELLE_LANGUE[l]} actif={(lire(edition.brouillon, 'language') || 'indifferent') === l} onPress={() => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, 'language', l) })} testID={`source-langue-${l}`} />
            ))}
          </View>
          {GROUPES.map(g => (
            <View key={g.titre} style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={styleTitre(theme, 15)}>
                {g.titre}
              </Text>
              {g.aide ? <Text style={styleAttenue(theme, 12)}>{g.aide}</Text> : null}
              {g.champs.map(([chemin, libelle, exemple]) => (
                <Champ key={chemin} libelle={libelle} valeur={lire(edition.brouillon, chemin)} onChanger={v => setEdition({ ...edition, brouillon: ecrire(edition.brouillon, chemin, v) })} placeholder={exemple} testID={`source-champ-${chemin}`} />
              ))}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Bouton titre="Enregistrer la source" variante="plein" onPress={() => void sauver()} testID="source-enregistrer" />
            <Bouton
              titre="Annuler"
              onPress={() => {
                setEdition(undefined);
                setErreur(undefined);
                setVue('liste');
              }}
              testID="source-annuler"
            />
          </View>
        </View>
      ) : null}

      {avis ? <Avis genre="ok" texte={avis} testID="sources-avis" /> : null}
      {erreur ? <Avis genre="critique" texte={erreur} testID="sources-erreur" /> : null}

      <Etat enCours={charge.enCours && !liste} erreur={charge.erreur} onRecharger={charge.recharger}>
        {sources.length === 0 ? (
          <Text style={styleTexte(theme, 14)} testID="sources-vide">
            Aucune source pour le moment. Tsuzuku a besoin d’au moins une source pour lire des épisodes et des films : ajoutez-en une avec l’assistant.
          </Text>
        ) : null}
        {s.lectureSources && sources.length ? <Champ libelle="Titre à chercher pour tester une source" valeur={titreTest} onChanger={setTitreTest} placeholder="Un titre présent sur le site" testID="sources-titre-test" /> : null}
        <View style={{ gap: 10 }} testID="sources-liste">
          {sources.map(src => {
            const t = tests[src.id];
            const p = partageDe(partages ?? {}, src.id);
            const qui = p.mode === 'tous' ? comptes : p.mode === 'selection' ? comptes.filter(c => p.comptes.includes(c.id)) : [];
            return (
              <View
                key={src.id}
                testID={`source-${src.id}`}
                style={{ gap: 8, padding: 12, borderWidth: nouvelle === src.id ? 2 : 1, borderColor: nouvelle === src.id ? theme.accent : theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <Text style={[styleTitre(theme, 16), { marginRight: 4 }]}>{src.name}</Text>
                  {nouvelle === src.id ? <Pastille texte="Nouvelle" couleur={theme.accent} testID="source-nouvelle" /> : null}
                  <Pastille texte={src.enabled ? 'Activée' : 'Désactivée'} couleur={src.enabled ? theme.ok : theme.attenue} testID={`source-etat-${src.id}`} />
                  <Pastille texte={typeDe(src)} couleur={theme.accent} />
                  <Pastille texte={LIBELLE_LANGUE[src.language]} couleur={theme.attenue} />
                  <Pastille texte={t ? `Dernier test : ${t.ok ? 'OK' : 'KO'}${t.date ? ` (${dateCourte(t.date)})` : ''}` : 'Jamais testée'} couleur={t ? (t.ok ? theme.ok : theme.critique) : theme.attenue} testID={`source-test-${src.id}`} />
                </View>
                <Text style={styleAttenue(theme, 13)} numberOfLines={1}>
                  {src.baseUrl}
                </Text>
                <Text style={styleTexte(theme, 13)} testID={`source-acces-${src.id}`}>
                  {partageActif ? (qui.length ? `Partagée avec : ${qui.map(c => c.nom).join(', ')}` : 'Accès : vous seul') : 'Accès : vous seul'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Bouton titre={src.enabled ? 'Désactiver' : 'Activer'} onPress={() => void agir(() => enregistrer(sources.map(x => (x.id === src.id ? { ...x, enabled: !x.enabled } : x))))} testID={`source-activer-${src.id}`} />
                  <Bouton titre="Modifier" onPress={() => { setEdition({ id: src.id, brouillon: JSON.parse(JSON.stringify(src)) as Brouillon }); setVue('formulaire'); }} testID={`source-modifier-${src.id}`} />
                  {s.lectureSources ? <Bouton titre={enTest === src.id ? 'Test…' : 'Tester'} desactive={enTest !== undefined} onPress={() => void tester(src)} testID={`source-tester-${src.id}`} /> : null}
                  <Bouton titre="Supprimer" variante="danger" onPress={() => void agir(() => enregistrer(supprimerSource(sources, src.id)), 'Source supprimée.')} testID={`source-supprimer-${src.id}`} />
                </View>
                {partageActif && partages ? <ChoixPartage partage={p} comptes={comptes} onChanger={x => void partager({ ...partages, [src.id]: x })} prefixe={`source-partage-${src.id}`} sansResume /> : null}
                {diag?.id === src.id ? (
                  <View style={{ gap: 6 }} testID="sources-diagnostic">
                    {diag.etapes.map(e => (
                      <Avis key={e.cle} genre={e.ok === true ? 'ok' : e.ok === false ? 'critique' : 'info'} texte={`${e.ok === true ? '✓' : e.ok === false ? '✗' : '–'} ${e.nom} : ${e.detail}${e.pistes.length ? ` Pistes : ${e.pistes.slice(0, 4).join(', ')}` : ''}`} />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </Etat>

      {partageActif && sources.length ? (
        <View style={{ gap: 6 }} testID="sources-qui-recoit">
          <Text style={styleTitre(theme, 16)}>Partage : qui reçoit quoi</Text>
          {recoit.length ? (
            recoit.map(c => (
              <Text key={c.id} style={styleTexte(theme, 14)} testID={`sources-recoit-${c.id}`}>
                {c.nom} : {c.sources.length ? c.sources.join(', ') : 'rien'}
              </Text>
            ))
          ) : (
            <Text style={styleAttenue(theme, 13)}>Aucun autre compte n’a accès à Tsuzuku : les sources ne servent qu’à vous.</Text>
          )}
          <Text style={styleAttenue(theme, 12)}>Une source désactivée n’est partagée avec personne. Le partage part, chiffré, à la prochaine synchronisation.</Text>
        </View>
      ) : null}

      <View style={{ gap: 8 }} testID="sources-sauvegarde">
        <Text style={styleTitre(theme, 16)}>Importer / exporter les sources (JSON)</Text>
        <Text style={styleAttenue(theme, 13)}>Pour une sauvegarde ou pour les recopier sur un autre appareil. L’export ne contient que la définition des sources : ni clé d’API, ni partage. L’import vérifie chaque source (adresse publique, sélecteurs valides) et ignore celles déjà présentes.</Text>
        <Bouton titre="Exporter les sources" onPress={() => void exporter()} desactive={!sources.length} testID="sources-exporter" style={{ alignSelf: 'flex-start' }} />
        {exportTexte ? <Champ libelle="Export (à copier)" valeur={exportTexte} onChanger={() => undefined} multiligne lectureSeule testID="sources-export-texte" /> : null}
        <Champ libelle="Coller un export de sources (ou un ancien sources.json)" valeur={jsonImport} onChanger={setJsonImport} multiligne testID="sources-import-texte" />
        <Bouton titre="Importer" onPress={() => void importer()} desactive={!jsonImport.trim()} testID="sources-importer" style={{ alignSelf: 'flex-start' }} />
      </View>
      {onCles ? (
        <View style={{ gap: 6 }}>
          <Text style={styleTitre(theme, 16)}>Clés d’API</Text>
          <Text style={styleAttenue(theme, 13)}>La clé TMDB (catalogue des films) reste dans Paramètres › Administration › Tsuzuku · Clés d’API : elle n’est jamais partagée ni exportée.</Text>
          <Bouton titre="Ouvrir Tsuzuku · Clés d’API ›" onPress={onCles} testID="sources-cles" style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
    </View>
  );
}

/** « Synchronisé » / « En attente » : les sources du compte entre ses appareils (relu toutes les 3 s). */
function PastilleSynchro() {
  const { s, theme, version } = useTsuzuku();
  const [etat, setEtat] = useState(() => s.etatSynchroSources());
  useEffect(() => {
    setEtat(s.etatSynchroSources());
    const minuterie = setInterval(() => setEtat(s.etatSynchroSources()), 3000);
    return () => clearInterval(minuterie);
  }, [s, version]);
  const texte =
    etat.etat === 'synchronise'
      ? 'Synchronisé avec vos autres appareils'
      : etat.etat === 'en-attente'
        ? 'En attente de synchronisation…'
        : 'Synchronisation entre appareils non configurée (Paramètres › Synchronisation)';
  const couleur = etat.etat === 'synchronise' ? theme.ok : etat.etat === 'en-attente' ? theme.alerte : theme.attenue;
  return (
    <View testID="sources-synchro" accessibilityLabel={texte} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View testID={`sources-synchro-${etat.etat}`} style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: couleur }} />
      <Text style={styleAttenue(theme, 13)}>{texte}</Text>
    </View>
  );
}

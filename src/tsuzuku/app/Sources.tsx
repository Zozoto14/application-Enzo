/**
 * Administration › Tsuzuku › Sources (rangs habilités : Fondateur).
 *
 * Sites branchés par l'administration, décrits par des sélecteurs CSS. VIDE
 * par défaut : Tsuzuku n'en fournit aucune. Pour chaque source, le Fondateur
 * choisit qui y a accès (lui seul, tous les utilisateurs autorisés à Tsuzuku,
 * ou une sélection) ; la synchronisation publie ensuite, chiffrée, dans
 * l'espace de chaque bénéficiaire. Les autres rangs ne voient jamais cet
 * écran (Paramètres ne le leur propose pas) et la règle est revérifiée par
 * les services (`gestion.ts`).
 *
 * Rendu dans la page Paramètres (voir `AdminTsuzuku.tsx`), pas dans l'app.
 */

import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { RAPPEL_DROITS, analyserSite, analyserStructure, extraitHtml, genererPrompt, validerSourceJson, type ResumeStructure, type ValidationSource } from '../moteur/assistant';
import { messageDe } from '../moteur/erreurs';
import { diagnostiquerRecherche, type DiagnosticEtape } from '../moteur/resolution';
import { LANGUES, ajouterSource, importerSources, modifierSource, supporteAnimes, supporteFilms, supprimerSource, vueFilm, type DefinitionSource, type Langue } from '../moteur/sources';
import { useCharger, useTsuzuku } from './contexte';
import { partageDe, type ModePartage, type Partages } from './gestion';
import { Avis, Bouton, Champ, Etat, Puce, Titre, styleAttenue, styleTexte, styleTitre } from './ui';

const LIBELLE_LANGUE: Record<Langue, string> = { vf: 'VF', vostfr: 'VOSTFR', indifferent: 'Indifférent' };
const LIBELLE_PARTAGE: Record<ModePartage, string> = { personne: 'Moi seul', tous: 'Tous les utilisateurs de Tsuzuku', selection: 'Une sélection' };

type Brouillon = Record<string, unknown>;

/** Compte à qui une source peut être partagée (actif, autorisé à Tsuzuku). */
export interface CompteTsuzuku {
  id: string;
  nom: string;
}

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
      ['search.image', 'Image (relatif au résultat, facultatif)', 'img'],
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

const typeDe = (src: DefinitionSource) => [supporteAnimes(src) ? 'animés' : '', supporteFilms(src) ? 'films' : ''].filter(Boolean).join(' + ') || 'incomplète';

/** Copie dans le presse-papiers quand la plateforme le permet (site, PC). */
async function copier(texte: string): Promise<boolean> {
  try {
    const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    if (Platform.OS === 'web' && presse) {
      await presse.writeText(texte);
      return true;
    }
  } catch {
    // Refusé par le navigateur : le texte reste sélectionnable.
  }
  return false;
}

/** Assistant : lien → résumé de structure → prompt pour une IA → JSON validé → test → enregistrement. */
function Assistant({ onFermer, onEnregistrer, onFormulaire }: { onFermer(): void; onEnregistrer(src: DefinitionSource): Promise<void>; onFormulaire(src: DefinitionSource): void }) {
  const { s, theme } = useTsuzuku();
  const [adresse, setAdresse] = useState('');
  const [htmlColle, setHtmlColle] = useState('');
  const [analyse, setAnalyse] = useState<{ resume: ResumeStructure; prompt: string } | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [copie, setCopie] = useState<string | undefined>();
  const [json, setJson] = useState('');
  const [validation, setValidation] = useState<ValidationSource | undefined>();
  const [titreTest, setTitreTest] = useState('');
  const [diag, setDiag] = useState<DiagnosticEtape[] | undefined>();

  const analyser = async () => {
    setErreur(undefined);
    setEnCours(true);
    try {
      // Sur le site (pas de lecture de pages tierces), l'administrateur peut coller le code de la page.
      const resultat = htmlColle.trim()
        ? { resume: analyserStructure(htmlColle, adresse.trim() || 'adresse non précisée'), extrait: extraitHtml(htmlColle) }
        : await analyserSite(s.client, adresse);
      setAnalyse({ resume: resultat.resume, prompt: genererPrompt(resultat.resume, resultat.extrait) });
    } catch (e) {
      setAnalyse(undefined);
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  };
  const verifier = () => {
    setDiag(undefined);
    setValidation(validerSourceJson(json, analyse?.resume.url.startsWith('http') ? analyse.resume.url : undefined));
  };
  const tester = async (src: DefinitionSource) => {
    const titre = titreTest.trim() || 'a';
    const etapes: DiagnosticEtape[] = [];
    if (supporteAnimes(src)) etapes.push({ ...(await diagnostiquerRecherche(s.ctx, src, titre)), nom: 'Animés · recherche' });
    if (supporteFilms(src)) etapes.push({ ...(await diagnostiquerRecherche(s.ctx, vueFilm(src), titre)), nom: 'Films · recherche' });
    setDiag(etapes);
  };
  const r = analyse?.resume;

  return (
    <View style={{ gap: 12, padding: 12, borderWidth: 1, borderColor: theme.accent, borderRadius: theme.rayonMoyen }} testID="assistant-source">
      <Titre taille={18}>Assistant d’ajout de source</Titre>
      <Avis genre="alerte" texte={RAPPEL_DROITS} testID="assistant-rappel" />
      <Text style={styleAttenue(theme, 13)}>
        1. Collez l’adresse d’une page du site (idéalement une page de résultats de recherche). 2. Copiez le prompt généré vers l’IA de votre choix. 3. Collez le JSON qu’elle renvoie : il est vérifié, puis testé pas à pas avant l’enregistrement.
      </Text>
      <Champ libelle="Adresse de la page à analyser" valeur={adresse} onChanger={setAdresse} placeholder="https://…" testID="assistant-adresse" />
      {!s.lectureSources ? (
        <Champ libelle="Sur le site, collez ici le code HTML de la page (lecture directe : app PC ou iPhone)" valeur={htmlColle} onChanger={setHtmlColle} multiligne testID="assistant-html" />
      ) : null}
      <Bouton titre={enCours ? 'Analyse…' : 'Analyser la page'} variante="plein" desactive={enCours || (!adresse.trim() && !htmlColle.trim())} onPress={() => void analyser()} testID="assistant-analyser" style={{ alignSelf: 'flex-start' }} />
      {erreur ? <Avis genre="critique" texte={erreur} testID="assistant-erreur" /> : null}
      {r && analyse ? (
        <View style={{ gap: 8 }} testID="assistant-resume">
          <Text style={styleTitre(theme, 15)}>Structure repérée</Text>
          <Text style={styleTexte(theme, 13)}>
            {r.titre || 'Page sans titre'} · {r.recurrents.length} élément(s) récurrent(s) · {r.formulaires.length} formulaire(s) · {r.liensEpisodes.length} lien(s) d’épisode · {r.iframes.length} iframe(s) · {r.menus.length} menu(s)
          </Text>
          {r.renduJs ? <Avis genre="alerte" texte="La page semble construite en JavaScript : les sélecteurs risquent de ne rien trouver." /> : null}
          <Champ libelle="Prompt à copier vers une IA" valeur={analyse.prompt} onChanger={() => undefined} multiligne testID="assistant-prompt" />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Bouton titre="Copier le prompt" onPress={() => void copier(analyse.prompt).then(ok => setCopie(ok ? 'Prompt copié.' : 'Sélectionnez le texte du prompt pour le copier.'))} testID="assistant-copier" />
            {copie ? <Text style={styleAttenue(theme, 13)}>{copie}</Text> : null}
          </View>
        </View>
      ) : null}
      <Champ
        libelle="JSON renvoyé par l’IA"
        valeur={json}
        onChanger={v => {
          setJson(v);
          setValidation(undefined);
        }}
        multiligne
        testID="assistant-json"
      />
      <Bouton titre="Vérifier le JSON" onPress={verifier} desactive={!json.trim()} testID="assistant-verifier" style={{ alignSelf: 'flex-start' }} />
      {validation?.erreurs.length ? <Avis genre="critique" texte={validation.erreurs.join('\n')} testID="assistant-invalide" /> : null}
      {validation?.avertissements.length ? <Avis genre="alerte" texte={validation.avertissements.join('\n')} testID="assistant-avertissements" /> : null}
      {validation?.source ? (
        <View style={{ gap: 8 }} testID="assistant-valide">
          <Avis genre="ok" texte={`JSON conforme : « ${validation.source.name} » (${typeDe(validation.source)}, ${LIBELLE_LANGUE[validation.source.language]}).`} />
          {s.lectureSources ? (
            <View style={{ gap: 8 }}>
              <Champ libelle="Titre pour le test pas à pas" valeur={titreTest} onChanger={setTitreTest} testID="assistant-titre-test" />
              <Bouton titre="Tester" onPress={() => void tester(validation.source!).catch(e => setErreur(messageDe(e)))} testID="assistant-tester" style={{ alignSelf: 'flex-start' }} />
              {diag?.map(e => (
                <Avis key={e.nom} genre={e.ok ? 'ok' : 'alerte'} texte={`${e.nom} : ${e.detail}${e.pistes.length ? ` Pistes : ${e.pistes.slice(0, 4).join(', ')}` : ''}`} testID={`assistant-diag-${e.ok ? 'ok' : 'ko'}`} />
              ))}
            </View>
          ) : (
            <Avis texte="Le test pas à pas demande l’app PC ou iPhone (lecture des pages)." />
          )}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Bouton titre="Enregistrer la source" variante="plein" onPress={() => void onEnregistrer(validation.source!)} testID="assistant-enregistrer" />
            <Bouton titre="Ouvrir dans le formulaire" onPress={() => onFormulaire(validation.source!)} testID="assistant-formulaire" />
          </View>
        </View>
      ) : null}
      <Bouton titre="Fermer l’assistant" onPress={onFermer} testID="assistant-fermer" style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

/** Choix du partage d'une source. */
function Partage({ id, partages, comptes, onChanger }: { id: string; partages: Partages; comptes: readonly CompteTsuzuku[]; onChanger(p: Partages): void }) {
  const { theme } = useTsuzuku();
  const p = partageDe(partages, id);
  const choisir = (mode: ModePartage, liste = p.comptes) => onChanger({ ...partages, [id]: { mode, comptes: liste } });
  const beneficiaires = p.mode === 'tous' ? comptes.length : p.mode === 'selection' ? comptes.filter(c => p.comptes.includes(c.id)).length : 0;
  return (
    <View style={{ gap: 6 }} testID={`source-partage-${id}`} accessibilityLabel="Qui y a accès">
      <Text style={styleTexte(theme, 13)} testID={`source-acces-${id}`}>
        Accès : {p.mode === 'personne' ? 'vous seul' : `${beneficiaires} utilisateur(s) en plus de vous`}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(['personne', 'tous', 'selection'] as const).map(m => (
          <Puce key={m} titre={LIBELLE_PARTAGE[m]} actif={p.mode === m} onPress={() => choisir(m)} testID={`source-partage-${id}-${m}`} />
        ))}
      </View>
      {p.mode === 'selection' ? (
        comptes.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {comptes.map(c => {
              const coche = p.comptes.includes(c.id);
              return (
                <Puce
                  key={c.id}
                  titre={`${coche ? '✓ ' : ''}${c.nom}`}
                  actif={coche}
                  onPress={() => choisir('selection', coche ? p.comptes.filter(x => x !== c.id) : [...p.comptes, c.id])}
                  testID={`source-partage-${id}-compte-${c.id}`}
                />
              );
            })}
          </View>
        ) : (
          <Text style={styleAttenue(theme, 13)}>Aucun autre compte n’a accès à Tsuzuku.</Text>
        )
      ) : null}
    </View>
  );
}

export function Sources({ comptes = [], partageActif = true }: { comptes?: readonly CompteTsuzuku[]; partageActif?: boolean }) {
  const { s, theme, version, changee } = useTsuzuku();
  const [liste, setListe] = useState<DefinitionSource[] | undefined>();
  const [partages, setPartages] = useState<Partages | undefined>();
  const charge = useCharger(async () => {
    const [l, p] = await Promise.all([s.sourcesPropres(), s.partages()]);
    setListe(l);
    setPartages(p);
    return l;
  }, [s, version]);
  const [edition, setEdition] = useState<{ id?: string; brouillon: Brouillon } | undefined>();
  const [assistant, setAssistant] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [avis, setAvis] = useState<string | undefined>();
  const [titreTest, setTitreTest] = useState('');
  const [diag, setDiag] = useState<{ id: string; etape: DiagnosticEtape } | undefined>();
  const [jsonImport, setJsonImport] = useState('');
  const sources = liste ?? charge.donnees ?? [];

  if (!s.estAdmin) {
    // Jamais proposé aux autres rangs ; si un écran s'y trompait, rien n'est montré.
    return <Avis genre="info" texte="Les sources de Tsuzuku sont réservées aux Fondateurs." testID="tsuzuku-sources-interdit" />;
  }

  const enregistrer = async (nouvelle: DefinitionSource[]) => {
    await s.enregistrerSources(nouvelle);
    setListe(nouvelle);
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
      setDiag({ id: src.id, etape: await diagnostiquerRecherche(s.ctx, supporteAnimes(src) ? src : vueFilm(src), titreTest || 'a') });
    });
  const partager = (p: Partages) =>
    agir(async () => {
      await s.enregistrerPartages(p);
      setPartages(await s.partages());
    }, 'Partage enregistré : il part à la prochaine synchronisation.');

  return (
    <View style={{ gap: 16 }} testID="tsuzuku-sources">
      <Text style={styleAttenue(theme, 14)}>
        Tsuzuku ne fournit aucune source. Branchez seulement des sites dont vous avez le droit d’utiliser le contenu (votre médiathèque, un service dont vous détenez les droits, un site de diffusion libre). Choisissez pour chacune qui y a accès : les autres utilisateurs la voient sans pouvoir la modifier.
      </Text>
      {!s.lectureSources ? <Avis genre="alerte" texte="Sur le site, les pages des sources ne peuvent pas être lues (CORS) : test et lecture sur l’app PC/iPhone. Vous pouvez néanmoins préparer et partager vos sources ici." /> : null}
      {!partageActif ? <Avis texte="Le partage des sources est publié par le compte historique (Fondateur d’origine) : les sources ajoutées ici ne servent qu’à vous." testID="sources-partage-historique" /> : null}
      <Etat enCours={charge.enCours && !liste} erreur={charge.erreur} onRecharger={charge.recharger}>
        {sources.length === 0 ? (
          <Text style={styleTexte(theme, 14)} testID="sources-vide">
            Aucune source pour le moment.
          </Text>
        ) : null}
        {sources.map(src => (
          <View key={src.id} testID={`source-${src.id}`} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }}>
            <Text style={[styleTitre(theme, 16)]}>{src.name}</Text>
            <Text style={styleAttenue(theme, 13)} numberOfLines={1}>
              {src.baseUrl} · {typeDe(src)} · {LIBELLE_LANGUE[src.language]} · {src.enabled ? 'activée' : 'désactivée'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Bouton titre={src.enabled ? 'Désactiver' : 'Activer'} onPress={() => void agir(() => enregistrer(sources.map(x => (x.id === src.id ? { ...x, enabled: !x.enabled } : x))))} testID={`source-activer-${src.id}`} />
              <Bouton titre="Modifier" onPress={() => setEdition({ id: src.id, brouillon: JSON.parse(JSON.stringify(src)) as Brouillon })} testID={`source-modifier-${src.id}`} />
              {s.lectureSources ? <Bouton titre="Tester" onPress={() => void tester(src)} testID={`source-tester-${src.id}`} /> : null}
              <Bouton titre="Supprimer" variante="danger" onPress={() => void agir(() => enregistrer(supprimerSource(sources, src.id)), 'Source supprimée.')} testID={`source-supprimer-${src.id}`} />
            </View>
            {partageActif && partages ? <Partage id={src.id} partages={partages} comptes={comptes} onChanger={p => void partager(p)} /> : null}
            {diag?.id === src.id ? <Avis genre={diag.etape.ok ? 'ok' : 'alerte'} texte={`${diag.etape.detail}${diag.etape.pistes.length ? ` Pistes : ${diag.etape.pistes.slice(0, 4).join(', ')}` : ''}`} testID="sources-diagnostic" /> : null}
          </View>
        ))}
      </Etat>
      {s.lectureSources && sources.length ? <Champ libelle="Titre pour tester la recherche" valeur={titreTest} onChanger={setTitreTest} testID="sources-titre-test" /> : null}
      {assistant ? (
        <Assistant
          onFermer={() => setAssistant(false)}
          onFormulaire={src => {
            setAssistant(false);
            const { id: _id, createdAt: _date, ...reste } = src;
            setEdition({ brouillon: JSON.parse(JSON.stringify(reste)) as Brouillon });
          }}
          onEnregistrer={src =>
            agir(async () => {
              await enregistrer(ajouterSource(sources, src).liste);
              setAssistant(false);
            }, `Source « ${src.name} » enregistrée (partagée avec personne pour l’instant).`)
          }
        />
      ) : null}
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
              }}
              testID="source-annuler"
            />
          </View>
        </View>
      ) : !assistant ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Bouton titre="Assistant" variante="plein" libelle="Assistant d’ajout de source par lien" onPress={() => setAssistant(true)} testID="sources-assistant" />
          <Bouton titre="+ Ajouter une source" onPress={() => setEdition({ brouillon: { enabled: true, language: 'indifferent' } })} testID="source-ajouter" />
        </View>
      ) : null}
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

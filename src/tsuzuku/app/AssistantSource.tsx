/**
 * Assistant « Ajouter une source à partir du lien du site », en 4 étapes :
 *
 *  1. Adresse du site (vérifiée : http(s), hôte public — anti-SSRF) et
 *     ce que la source doit couvrir (animés, films, les deux) ;
 *  2. l'app lit et analyse la page (PC, iPhone) ou le HTML collé (site), puis
 *     génère le PROMPT à copier vers une IA (ou un prompt sans extrait :
 *     l'IA analyse elle-même le site) ;
 *  3. la RÉPONSE de l'IA (JSON) est validée par le schéma du moteur ; en cas
 *     d'erreur, « Réparer avec l'IA » prépare un prompt de correction ;
 *  4. test pas à pas (recherche → épisodes → lecteur), puis enregistrement
 *     (nom, activée, partage).
 *
 * Une seule implémentation, deux entrées : la page « Sources » de Tsuzuku et
 * Paramètres › Administration › Tsuzuku · Sources (voir `Sources.tsx`).
 * Réservé aux rangs habilités : `Sources` ne le rend pas pour les autres, et
 * les services revérifient (403).
 */

import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { police } from '../../hub/themes';
import {
  LIBELLE_CIBLE,
  RAPPEL_DROITS,
  analyserSite,
  analyserStructure,
  extraitHtml,
  genererPrompt,
  genererPromptReparation,
  genererPromptSansExtrait,
  testReussi,
  testerSourcePasAPas,
  validerSourceJson,
  verifierAdresseSite,
  type CibleSource,
  type EtapeTest,
  type ResumeStructure,
  type ValidationSource,
} from '../moteur/assistant';
import { messageDe } from '../moteur/erreurs';
import { supporteAnimes, supporteFilms, type DefinitionSource, type Langue } from '../moteur/sources';
import { useTsuzuku } from './contexte';
import { ouvrirExterne } from './externe';
import type { ModePartage, PartageSource } from './gestion';
import { Avis, Bouton, Champ, Puce, Titre, styleAttenue, styleTexte, styleTitre } from './ui';

export const LIBELLE_LANGUE: Record<Langue, string> = { vf: 'VF', vostfr: 'VOSTFR', indifferent: 'VF/VOSTFR' };
export const LIBELLE_PARTAGE: Record<ModePartage, string> = { personne: 'Moi seul', tous: 'Tous les utilisateurs de Tsuzuku', selection: 'Une sélection' };

/** Compte à qui une source peut être partagée (actif, autorisé à Tsuzuku). */
export interface CompteTsuzuku {
  id: string;
  nom: string;
}

export const typeDe = (src: DefinitionSource) => [supporteAnimes(src) ? 'animés' : '', supporteFilms(src) ? 'films' : ''].filter(Boolean).join(' + ') || 'incomplète';

/** Liens vers deux assistants d'IA grand public (liens externes simples, rien n'est envoyé). */
export const LIENS_IA = [
  { cle: 'chatgpt', titre: 'Ouvrir ChatGPT ↗', url: 'https://chatgpt.com/' },
  { cle: 'claude', titre: 'Ouvrir Claude ↗', url: 'https://claude.ai/new' },
] as const;

/** Copie dans le presse-papiers quand la plateforme le permet (site, PC). */
export async function copier(texte: string): Promise<boolean> {
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

export const ETAPES = ['Adresse du site', 'Prompt pour l’IA', 'Réponse de l’IA', 'Test et enregistrement'] as const;

/** Indicateur d'étapes : numéro, libellé (en entier sur grand écran, l'étape courante seulement sur téléphone). */
function IndicateurEtapes({ courante }: { courante: number }) {
  const { theme, large } = useTsuzuku();
  return (
    <View testID="assistant-etapes" accessibilityRole="progressbar" accessibilityLabel={`Étape ${courante} sur 4 : ${ETAPES[courante - 1]}`} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        {ETAPES.map((nom, i) => {
          const n = i + 1;
          const fait = n < courante;
          const actif = n === courante;
          return (
            <View
              key={nom}
              testID={`assistant-etape-${n}`}
              accessibilityState={{ selected: actif }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, paddingVertical: 6, borderBottomWidth: 3, borderBottomColor: actif || fait ? theme.accent : theme.ligne }}>
              <View style={{ width: 24, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: actif || fait ? theme.accent : 'transparent', borderWidth: 1, borderColor: actif || fait ? theme.accent : theme.ligne }}>
                <Text style={{ color: actif || fait ? theme.surAccent : theme.attenue, fontWeight: '800', fontSize: 12 }}>{fait ? '✓' : n}</Text>
              </View>
              {large ? (
                <Text numberOfLines={1} style={{ flexShrink: 1, color: actif ? theme.texte : theme.attenue, fontWeight: actif ? '800' : '600', fontSize: 13, ...police(theme.policeTexte) }}>
                  {nom}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {!large ? (
        <Text style={[styleTexte(theme, 14), { fontWeight: '700' }]}>
          Étape {courante} sur 4 · {ETAPES[courante - 1]}
        </Text>
      ) : null}
    </View>
  );
}

/** Choix du partage d'une source (moi seul, tous, une sélection). */
export function ChoixPartage({ partage, comptes, onChanger, prefixe, sansResume }: { partage: PartageSource; comptes: readonly CompteTsuzuku[]; onChanger(p: PartageSource): void; prefixe: string; /** Le résumé est déjà affiché à côté (liste des sources). */ sansResume?: boolean }) {
  const { theme } = useTsuzuku();
  const beneficiaires = partage.mode === 'tous' ? comptes : partage.mode === 'selection' ? comptes.filter(c => partage.comptes.includes(c.id)) : [];
  return (
    <View style={{ gap: 6 }} testID={prefixe} accessibilityLabel="Qui y a accès">
      {sansResume ? null : <Text style={styleTexte(theme, 13)} testID={`${prefixe}-resume`}>
        {partage.mode === 'personne' ? 'Accès : vous seul' : beneficiaires.length ? `Accès : vous + ${beneficiaires.map(c => c.nom).join(', ')}` : 'Accès : vous seul (aucun compte choisi)'}
      </Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(['personne', 'tous', 'selection'] as const).map(m => (
          <Puce key={m} titre={LIBELLE_PARTAGE[m]} actif={partage.mode === m} onPress={() => onChanger({ mode: m, comptes: partage.comptes })} testID={`${prefixe}-${m}`} />
        ))}
      </View>
      {partage.mode === 'selection' ? (
        comptes.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {comptes.map(c => {
              const coche = partage.comptes.includes(c.id);
              return (
                <Puce
                  key={c.id}
                  titre={`${coche ? '✓ ' : ''}${c.nom}`}
                  actif={coche}
                  onPress={() => onChanger({ mode: 'selection', comptes: coche ? partage.comptes.filter(x => x !== c.id) : [...partage.comptes, c.id] })}
                  testID={`${prefixe}-compte-${c.id}`}
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

/** Ce que l'assistant remet à la page Sources à l'enregistrement. */
export interface SourceAssistant {
  source: DefinitionSource;
  partage: PartageSource;
  /** Résultat du test pas à pas, s'il a été joué. */
  test?: { ok: boolean; detail: string };
}

export function AssistantSource({
  depart = 'adresse',
  comptes = [],
  partageActif = true,
  onFermer,
  onEnregistrer,
  onFormulaire,
}: {
  /** « json » : l'administrateur a déjà le JSON (on commence à l'étape 3). */
  depart?: 'adresse' | 'json';
  comptes?: readonly CompteTsuzuku[];
  partageActif?: boolean;
  onFermer(): void;
  onEnregistrer(r: SourceAssistant): Promise<boolean>;
  onFormulaire(src: DefinitionSource): void;
}) {
  const { s, theme, large } = useTsuzuku();
  const [etape, setEtape] = useState(depart === 'json' ? 3 : 1);
  // Étape 1
  const [adresse, setAdresse] = useState('');
  const [cible, setCible] = useState<CibleSource>('les-deux');
  const [htmlColle, setHtmlColle] = useState('');
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  // Étape 2
  const [analyse, setAnalyse] = useState<{ resume?: ResumeStructure; prompt: string } | undefined>();
  const [copie, setCopie] = useState<string | undefined>();
  // Étape 3
  const [json, setJson] = useState('');
  const [validation, setValidation] = useState<ValidationSource | undefined>();
  const [reparation, setReparation] = useState<string | undefined>();
  // Étape 4
  const [titreTest, setTitreTest] = useState('');
  const [test, setTest] = useState<EtapeTest[] | undefined>();
  const [nom, setNom] = useState('');
  const [active, setActive] = useState(true);
  const [partage, setPartage] = useState<PartageSource>({ mode: 'personne', comptes: [] });

  const analysee = analyse?.resume?.url.startsWith('http') ? analyse.resume.url : undefined;

  const analyser = async () => {
    setErreur(undefined);
    const colle = htmlColle.trim();
    const verif = adresse.trim() || !colle ? verifierAdresseSite(adresse) : { url: undefined };
    if (verif.erreur) {
      setErreur(verif.erreur);
      return;
    }
    setEnCours(true);
    try {
      // Sur le site (pas de lecture de pages tierces), l'administrateur colle le code de la page.
      const r = colle ? { resume: analyserStructure(colle, verif.url ?? 'adresse non précisée'), extrait: extraitHtml(colle) } : await analyserSite(s.client, verif.url!);
      setAnalyse({ resume: r.resume, prompt: genererPrompt(r.resume, r.extrait, { cible }) });
      setCopie(undefined);
      setEtape(2);
    } catch (e) {
      setErreur(`${messageDe(e)} Vous pouvez générer le prompt sans extrait : l’IA analysera elle-même le site.`);
    } finally {
      setEnCours(false);
    }
  };
  const sansExtrait = () => {
    const verif = verifierAdresseSite(adresse);
    if (verif.erreur) {
      setErreur(verif.erreur);
      return;
    }
    setErreur(undefined);
    setAnalyse({ prompt: genererPromptSansExtrait(verif.url!, { cible }) });
    setCopie(undefined);
    setEtape(2);
  };
  const verifier = () => {
    setTest(undefined);
    setReparation(undefined);
    const v = validerSourceJson(json, analysee);
    setValidation(v);
    if (v.source) setNom(v.source.name);
  };
  const tester = async (src: DefinitionSource) => {
    setErreur(undefined);
    setEnCours(true);
    try {
      setTest(await testerSourcePasAPas(s.ctx, src, titreTest));
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  };
  const enregistrer = async () => {
    if (!validation?.source) return;
    const source = { ...validation.source, name: nom.trim() || validation.source.name, enabled: active };
    const resume = test ? { ok: testReussi(test), detail: test.map(e => `${e.nom} : ${e.ok === true ? 'OK' : e.ok === false ? 'KO' : 'non testé'}`).join(' · ') } : undefined;
    await onEnregistrer({ source, partage: partageActif ? partage : { mode: 'personne', comptes: [] }, test: resume });
  };

  const rangee = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' as const };

  return (
    <View style={{ gap: 14, padding: large ? 18 : 12, borderWidth: 1, borderColor: theme.accent, borderRadius: theme.rayonMoyen, backgroundColor: theme.surface }} testID="assistant-source">
      <Titre taille={20}>{depart === 'json' && etape >= 3 && !analyse ? 'Ajouter une source à partir de son JSON' : 'Ajouter une source à partir du lien du site'}</Titre>
      <IndicateurEtapes courante={etape} />
      <Avis genre="alerte" texte={RAPPEL_DROITS} testID="assistant-rappel" />

      {etape === 1 ? (
        <View style={{ gap: 12 }} testID="assistant-etape-adresse">
          <Text style={styleAttenue(theme, 14)}>Collez l’adresse d’une page du site, idéalement sa page de résultats de recherche. L’app vérifie l’adresse (site public seulement) puis analyse la page.</Text>
          <Champ libelle="Adresse du site" valeur={adresse} onChanger={v => { setAdresse(v); setErreur(undefined); }} placeholder="https://…" testID="assistant-adresse" />
          <View style={{ gap: 6 }}>
            <Text style={[styleTexte(theme, 13), { fontWeight: '600' }]}>La source servira pour</Text>
            <View style={rangee} accessibilityRole="radiogroup" accessibilityLabel="La source servira pour">
              {(['animes', 'films', 'les-deux'] as const).map(c => (
                <Puce key={c} titre={LIBELLE_CIBLE[c]} actif={cible === c} onPress={() => setCible(c)} testID={`assistant-cible-${c}`} />
              ))}
            </View>
          </View>
          {!s.lectureSources ? (
            <View style={{ gap: 6 }}>
              <Avis texte="Sur le site web, le navigateur ne peut pas lire les pages d’un autre site (CORS). Collez ci-dessous le code HTML de la page (clic droit › « Afficher le code source », tout copier), ou générez le prompt sans extrait : l’IA analysera elle-même le site." testID="assistant-site" />
              <Champ libelle="Code HTML de la page (facultatif)" valeur={htmlColle} onChanger={setHtmlColle} multiligne testID="assistant-html" />
            </View>
          ) : null}
          <View style={rangee}>
            {s.lectureSources || htmlColle.trim() ? (
              <Bouton titre={enCours ? 'Analyse…' : 'Analyser la page →'} variante="plein" desactive={enCours || (!adresse.trim() && !htmlColle.trim())} onPress={() => void analyser()} testID="assistant-analyser" />
            ) : null}
            <Bouton titre="Générer le prompt sans extrait" variante={s.lectureSources || htmlColle.trim() ? 'normal' : 'plein'} desactive={!adresse.trim()} onPress={sansExtrait} testID="assistant-sans-extrait" />
          </View>
          <Bouton titre="J’ai déjà le JSON de la source" onPress={() => setEtape(3)} testID="assistant-direct-json" style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}

      {etape === 2 && analyse ? (
        <View style={{ gap: 12 }} testID="assistant-etape-prompt">
          {analyse.resume ? (
            <View style={{ gap: 4 }} testID="assistant-resume">
              <Text style={styleTitre(theme, 15)}>Structure repérée</Text>
              <Text style={styleTexte(theme, 13)}>
                {analyse.resume.titre || 'Page sans titre'} · {analyse.resume.recurrents.length} élément(s) récurrent(s) · {analyse.resume.formulaires.length} formulaire(s) · {analyse.resume.liensEpisodes.length} lien(s) d’épisode · {analyse.resume.iframes.length} iframe(s) · {analyse.resume.menus.length} menu(s)
              </Text>
              {analyse.resume.renduJs ? <Avis genre="alerte" texte="La page semble construite en JavaScript : les sélecteurs risquent de ne rien trouver." /> : null}
            </View>
          ) : (
            <Avis texte="Prompt sans extrait : l’IA devra consulter elle-même le site. Si elle ne le peut pas, revenez à l’étape 1 et collez le code HTML de la page." testID="assistant-sans-extrait-avis" />
          )}
          <Text style={[styleTexte(theme, 15), { fontWeight: '700' }]} testID="assistant-consigne">
            Colle ce prompt dans l’IA de ton choix, puis reviens coller sa réponse.
          </Text>
          <Champ libelle="Prompt à copier vers une IA" valeur={analyse.prompt} onChanger={() => undefined} multiligne lectureSeule hauteur={large ? 320 : 240} testID="assistant-prompt" />
          <View style={rangee}>
            <Bouton titre="Copier le prompt" variante="plein" onPress={() => void copier(analyse.prompt).then(ok => setCopie(ok ? 'Prompt copié.' : 'Sélectionnez le texte du prompt pour le copier.'))} testID="assistant-copier" />
            {LIENS_IA.map(l => (
              <Bouton key={l.cle} titre={l.titre} libelle={`${l.titre.replace(' ↗', '')} dans le navigateur`} onPress={() => void ouvrirExterne(l.url)} testID={`assistant-ouvrir-${l.cle}`} />
            ))}
          </View>
          {copie ? <Text style={styleAttenue(theme, 13)} testID="assistant-copie">{copie}</Text> : null}
          <View style={rangee}>
            <Bouton titre="← Adresse" onPress={() => setEtape(1)} testID="assistant-precedent" />
            <Bouton titre="J’ai la réponse de l’IA →" variante="plein" onPress={() => setEtape(3)} testID="assistant-suivant" />
          </View>
        </View>
      ) : null}

      {etape === 3 ? (
        <View style={{ gap: 12 }} testID="assistant-etape-reponse">
          <Text style={styleAttenue(theme, 14)}>Collez la réponse de l’IA (le bloc ```json suffit, le texte autour est ignoré). Elle est vérifiée par le schéma du moteur : sélecteurs CSS, {'{query}'} dans les chemins, adresse publique.</Text>
          <Champ
            libelle="Réponse de l’IA (JSON de la source)"
            valeur={json}
            onChanger={v => {
              setJson(v);
              setValidation(undefined);
              setReparation(undefined);
            }}
            multiligne
            hauteur={large ? 260 : 200}
            testID="assistant-json"
          />
          <View style={rangee}>
            <Bouton titre="Vérifier le JSON" variante="plein" onPress={verifier} desactive={!json.trim()} testID="assistant-verifier" />
            {etape === 3 ? <Bouton titre="← Étape précédente" onPress={() => setEtape(analyse ? 2 : 1)} testID="assistant-precedent" /> : null}
          </View>
          {validation?.erreurs.length ? (
            <View style={{ gap: 8 }}>
              <Avis genre="critique" texte={`${validation.erreurs.length} erreur(s) :\n${validation.erreurs.map(e => `• ${e}`).join('\n')}`} testID="assistant-invalide" />
              <Bouton titre="Réparer avec l’IA" onPress={() => setReparation(genererPromptReparation(json, validation.erreurs, validation.avertissements))} testID="assistant-reparer" style={{ alignSelf: 'flex-start' }} />
              {reparation ? (
                <View style={{ gap: 8 }}>
                  <Text style={styleTexte(theme, 14)}>Copiez ce prompt de correction dans la même conversation avec l’IA, puis collez sa nouvelle réponse ci-dessus.</Text>
                  <Champ libelle="Prompt de correction" valeur={reparation} onChanger={() => undefined} multiligne lectureSeule hauteur={180} testID="assistant-prompt-reparation" />
                  <Bouton titre="Copier le prompt de correction" onPress={() => void copier(reparation).then(ok => setCopie(ok ? 'Prompt de correction copié.' : 'Sélectionnez le texte pour le copier.'))} testID="assistant-copier-reparation" style={{ alignSelf: 'flex-start' }} />
                </View>
              ) : null}
            </View>
          ) : null}
          {validation?.avertissements.length ? <Avis genre="alerte" texte={validation.avertissements.map(a => `• ${a}`).join('\n')} testID="assistant-avertissements" /> : null}
          {validation?.source ? (
            <View style={{ gap: 8 }} testID="assistant-valide">
              <Avis genre="ok" texte={`JSON conforme : « ${validation.source.name} » (${typeDe(validation.source)}, ${LIBELLE_LANGUE[validation.source.language]}).`} />
              <View style={rangee}>
                <Bouton titre="Tester la source →" variante="plein" onPress={() => setEtape(4)} testID="assistant-suivant" />
                <Bouton titre="Ouvrir dans le formulaire" onPress={() => onFormulaire(validation.source!)} testID="assistant-formulaire" />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {etape === 4 && validation?.source ? (
        <View style={{ gap: 12 }} testID="assistant-etape-test">
          <Text style={[styleTitre(theme, 16)]}>Tester pas à pas</Text>
          {s.lectureSources ? (
            <View style={{ gap: 8 }}>
              <Text style={styleAttenue(theme, 14)}>Indiquez un titre présent sur le site : l’app cherche ce titre, ouvre le premier résultat, lit la liste des épisodes, puis cherche le lecteur du premier épisode.</Text>
              <Champ libelle="Titre à chercher pour le test" valeur={titreTest} onChanger={setTitreTest} testID="assistant-titre-test" />
              <Bouton titre={enCours ? 'Test en cours…' : 'Tester'} desactive={enCours} onPress={() => void tester(validation.source!)} testID="assistant-tester" style={{ alignSelf: 'flex-start' }} />
              {test ? (
                <View style={{ gap: 6 }} testID="assistant-resultat-test">
                  {test.map(e => (
                    <Avis
                      key={e.cle}
                      genre={e.ok === true ? 'ok' : e.ok === false ? 'critique' : 'info'}
                      texte={`${e.ok === true ? '✓' : e.ok === false ? '✗' : '–'} ${e.nom} : ${e.detail}${e.pistes.length ? ` Pistes : ${e.pistes.slice(0, 4).join(', ')}` : ''}`}
                      testID={`assistant-test-${e.cle}-${e.ok === true ? 'ok' : e.ok === false ? 'ko' : 'saute'}`}
                    />
                  ))}
                  <Text style={[styleTexte(theme, 14), { fontWeight: '700' }]} testID="assistant-test-bilan">
                    {testReussi(test) ? 'Test réussi : la source trouve le titre, ses épisodes et un lecteur.' : 'Test incomplet : corrigez le JSON (étape 3, « Réparer avec l’IA ») ou enregistrez quand même.'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Avis texte="Le test pas à pas demande l’app PC ou iPhone (lecture des pages). Vous pouvez enregistrer la source ici et la tester depuis l’app." testID="assistant-test-indisponible" />
          )}
          <View style={{ gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            <Text style={[styleTitre(theme, 16)]}>Enregistrer</Text>
            <Champ libelle="Nom de la source" valeur={nom} onChanger={setNom} testID="assistant-nom" />
            <View style={rangee} accessibilityLabel="État">
              <Puce titre="Activée" actif={active} onPress={() => setActive(true)} testID="assistant-active-oui" />
              <Puce titre="Désactivée" actif={!active} onPress={() => setActive(false)} testID="assistant-active-non" />
            </View>
            {partageActif ? (
              <ChoixPartage partage={partage} comptes={comptes} onChanger={setPartage} prefixe="assistant-partage" />
            ) : (
              <Text style={styleAttenue(theme, 13)}>Partage : publié par le compte historique ; cette source ne servira qu’à vous.</Text>
            )}
            {erreur ? <Avis genre="critique" texte={erreur} testID="assistant-erreur" /> : null}
            <View style={rangee}>
              <Bouton titre="Enregistrer la source" variante="plein" onPress={() => void enregistrer()} testID="assistant-enregistrer" />
              <Bouton titre="← Réponse de l’IA" onPress={() => setEtape(3)} testID="assistant-precedent" />
            </View>
          </View>
        </View>
      ) : null}

      {erreur && etape !== 4 ? <Avis genre="critique" texte={erreur} testID="assistant-erreur" /> : null}
      <Bouton titre="Annuler" onPress={onFermer} testID="assistant-fermer" style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

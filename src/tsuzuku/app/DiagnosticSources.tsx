/**
 * Pourquoi une fiche ne trouve rien sur les sources : la vraie raison (aucune
 * source, site web, source en erreur, titre non trouvé, aucun épisode…),
 * « Réessayer », « Chercher avec un autre titre » et le détail du diagnostic
 * (quelle source, quelle requête, combien de résultats, quel titre retenu ou
 * écarté). Partagé par la fiche (« Sur vos sources ») et le lecteur.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { testReussi, testerSourcePasAPas, type EtapeTest } from '../moteur/assistant';
import { messageDe } from '../moteur/erreurs';
import type { DefinitionSource } from '../moteur/sources';
import { copier } from './AssistantSource';
import { useCharger, useTsuzuku } from './contexte';
import { lignesDiagnostic, texteDiagnostic, texteMesure } from './diagnosticTexte';
import { enregistrerTitrePerso, episodesDisponibles, lireTitresPerso, type DiagnosticLecture, type Disponibilite } from './resoudre';
import { LIBELLE_LANGUE_VERSION } from '../moteur/langues';
import { langueVoulue } from './langues';
import { Avis, Bouton, Champ, styleAttenue, styleTexte } from './ui';

export { LIBELLE_STATUT_SOURCE, lignesDiagnostic, texteDiagnostic } from './diagnosticTexte';

const LIBELLE_PLATEFORME = { pc: 'app PC', site: 'site web (navigateur)', mobile: 'iPhone/iPad' } as const;
/** Libellé de la plateforme dans le diagnostic (« via le relais » quand le site lit par le relais). */
export const libellePlateforme = (s: { plateforme: keyof typeof LIBELLE_PLATEFORME; viaRelais?: boolean }): string =>
  `${LIBELLE_PLATEFORME[s.plateforme] ?? s.plateforme}${s.viaRelais ? ', via le relais' : ''}`;

/** Détail du diagnostic : lignes lisibles, « Copier le diagnostic » et le texte complet à sélectionner. */
function DetailDiagnostic({ diagnostic, message, oeuvre, testID }: { diagnostic: DiagnosticLecture; message?: string; oeuvre?: string; testID: string }) {
  const { s, theme } = useTsuzuku();
  const [copie, setCopie] = useState<string | undefined>();
  const [texte, setTexte] = useState<string | undefined>();
  const complet = () => texteDiagnostic(diagnostic, { oeuvre, message, plateforme: libellePlateforme(s) });
  return (
    <View style={{ gap: 6 }} testID={`${testID}-detail`}>
      {s.viaRelais ? (
        <Text selectable style={styleAttenue(theme, 12)} testID={`${testID}-via-relais`}>
          Plateforme : {libellePlateforme(s)} (pages lues par le relais Cloudflare, sans cookie)
        </Text>
      ) : null}
      {lignesDiagnostic(diagnostic).map((l, i) => (
        <Text key={i} selectable style={l.startsWith('  ') ? styleAttenue(theme, 12) : styleTexte(theme, 13)}>
          {l}
        </Text>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Bouton
          titre="Copier le diagnostic"
          onPress={() => {
            const t = complet();
            setTexte(t);
            void copier(t).then(ok => setCopie(ok ? 'Diagnostic copié : collez-le dans votre message.' : 'Copie automatique impossible : sélectionnez le texte ci-dessous.'));
          }}
          testID={`${testID}-copier`}
        />
      </View>
      {copie ? <Text style={styleAttenue(theme, 12)} testID={`${testID}-copie`}>{copie}</Text> : null}
      {texte ? <Champ libelle="Diagnostic à transmettre (sans clé ni secret)" valeur={texte} onChanger={() => undefined} multiligne lectureSeule hauteur={180} testID={`${testID}-texte`} /> : null}
    </View>
  );
}

export function PanneauEchec({
  message,
  diagnostic,
  titrePerso,
  enCours,
  onReessayer,
  onAutreTitre,
  oeuvre,
  testID = 'sources-echec',
}: {
  /** Titre de l'oeuvre (en-tête du diagnostic copié). */
  oeuvre?: string;
  /** Absent : le message est déjà affiché à côté (lecteur). */
  message?: string;
  diagnostic?: DiagnosticLecture;
  titrePerso?: string;
  enCours?: boolean;
  onReessayer(): void;
  /** Titre vide : revient aux titres du catalogue. */
  onAutreTitre?(titre: string): void;
  testID?: string;
}) {
  const { theme } = useTsuzuku();
  const [detail, setDetail] = useState(false);
  const [autre, setAutre] = useState(titrePerso ?? '');
  // Un autre titre n'aide pas quand le site bloque, ou que la source ne cherche pas d'animés.
  const recherchable = diagnostic && !['site', 'aucune-source', 'bloquee', 'non-configuree'].includes(diagnostic.raison);
  return (
    <View testID={testID} style={{ gap: 10, padding: 12, borderRadius: Math.max(theme.rayonMoyen, 8), borderWidth: 1, borderColor: theme.ligne, backgroundColor: teinteTransparente(theme.texte, 0.03) }}>
      {message ? <Avis genre={diagnostic?.raison === 'erreur' ? 'critique' : 'alerte'} texte={message} testID={`${testID}-message`} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {diagnostic?.raison !== 'aucune-source' ? <Bouton titre={enCours ? 'Recherche…' : 'Réessayer'} desactive={enCours} onPress={onReessayer} testID={`${testID}-reessayer`} /> : null}
        {diagnostic ? <Bouton titre={detail ? 'Masquer le détail' : 'Détail du diagnostic'} onPress={() => setDetail(v => !v)} testID={`${testID}-detail-bouton`} /> : null}
      </View>
      {recherchable && onAutreTitre ? (
        <View style={{ gap: 6 }}>
          <Champ libelle="Chercher avec un autre titre" valeur={autre} onChanger={setAutre} placeholder="Le titre tel que le site l’écrit" onValider={() => onAutreTitre(autre)} testID={`${testID}-autre-titre`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Bouton titre="Chercher" variante="plein" desactive={enCours || !autre.trim()} onPress={() => onAutreTitre(autre)} testID={`${testID}-chercher`} />
            {titrePerso ? <Bouton titre="Revenir aux titres du catalogue" onPress={() => { setAutre(''); onAutreTitre(''); }} testID={`${testID}-titres-catalogue`} /> : null}
          </View>
        </View>
      ) : null}
      {detail && diagnostic ? <DetailDiagnostic diagnostic={diagnostic} message={message} oeuvre={oeuvre} testID={testID} /> : null}
    </View>
  );
}

/** Résultat d'un test pas à pas, étape par étape (OK / KO / non joué). */
function EtapesTest({ etapes, testID }: { etapes: EtapeTest[]; testID: string }) {
  const { theme } = useTsuzuku();
  return (
    <View style={{ gap: 4 }} testID={testID}>
      <Avis genre={testReussi(etapes) ? 'ok' : 'alerte'} texte={testReussi(etapes) ? 'Test réussi sur ce titre : recherche, épisodes et lecteur.' : 'Test incomplet sur ce titre : voir les étapes ci-dessous.'} testID={`${testID}-bilan`} />
      {etapes.map(e => (
        <View key={e.cle} style={{ gap: 2 }} testID={`${testID}-${e.cle}-${e.ok === undefined ? 'saute' : e.ok ? 'ok' : 'ko'}`}>
          <Text selectable style={[styleTexte(theme, 13), { fontWeight: '700' }]}>
            {e.ok === undefined ? '—' : e.ok ? '✓' : '✗'} {e.nom}
          </Text>
          <Text selectable style={styleAttenue(theme, 12)}>
            {e.detail}
          </Text>
          {e.pistes.map((p, i) => (
            <Text key={i} selectable style={styleAttenue(theme, 12)}>
              → {p}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * « Tester cette source sur CE titre » (rangs habilités) : le test pas à pas
 * de l'assistant, lancé depuis la fiche avec SES titres (titre choisi à la
 * main compris) et la préférence de doublage, même désactivée.
 */
function TesterSurCeTitre({ titres, id }: { titres: readonly string[]; id: string }) {
  const { s, theme } = useTsuzuku();
  const [ouvert, setOuvert] = useState(false);
  const [enTest, setEnTest] = useState<string | undefined>();
  const [resultat, setResultat] = useState<{ id: string; etapes?: EtapeTest[]; erreur?: string } | undefined>();
  const sources = useCharger(async () => (ouvert ? await s.sources() : []), [s, ouvert]);
  if (!s.estAdmin || !s.lectureSources) return null;
  const tester = async (src: DefinitionSource) => {
    setEnTest(src.id);
    setResultat(undefined);
    try {
      const perso = (await lireTitresPerso(s))[`anime:${id}`];
      const cible = perso ? [perso, ...titres.filter(t => t !== perso)] : [...titres];
      setResultat({ id: src.id, etapes: await testerSourcePasAPas(s.ctx, src, { titres: cible, langue: (await s.reglages()).langue }) });
    } catch (e) {
      setResultat({ id: src.id, erreur: messageDe(e) });
    } finally {
      setEnTest(undefined);
    }
  };
  return (
    <View style={{ gap: 8 }} testID="fiche-tester-sources">
      <Bouton titre={ouvert ? 'Masquer le test des sources' : 'Tester une source sur ce titre'} onPress={() => setOuvert(v => !v)} testID="fiche-tester-ouvrir" style={{ alignSelf: 'flex-start' }} />
      {ouvert ? (
        <View style={{ gap: 8 }}>
          <Text style={styleAttenue(theme, 13)}>Même recherche que la fiche (titres du catalogue, titre choisi à la main, préférence VF/VOSTFR), étape par étape : recherche → épisodes → lecteur.</Text>
          {(sources.donnees ?? []).map((src: DefinitionSource) => (
            <View key={src.id} style={{ gap: 6 }}>
              <Bouton
                titre={enTest === src.id ? 'Test…' : `Tester « ${src.name} » sur ce titre${src.enabled ? '' : ' (désactivée)'}`}
                desactive={enTest !== undefined}
                onPress={() => void tester(src)}
                testID={`fiche-tester-${src.id}`}
                style={{ alignSelf: 'flex-start' }}
              />
              {resultat?.id === src.id && resultat.etapes ? <EtapesTest etapes={resultat.etapes} testID={`fiche-test-${src.id}`} /> : null}
              {resultat?.id === src.id && resultat.erreur ? <Avis genre="critique" texte={resultat.erreur} /> : null}
            </View>
          ))}
          {sources.donnees && !sources.donnees.length ? <Text style={styleAttenue(theme, 13)}>Aucune source à tester.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** « · VOSTFR (VF aussi) », « · langue inconnue » : ce que la source dit des langues. */
function resumeLangues(d: Disponibilite): string {
  const l = d.resultat?.langues;
  if (!l) return '';
  if (!l.courante) return ' · langue inconnue (la source ne la précise pas)';
  const autre = l.courante === 'vf' ? 'vostfr' : 'vf';
  return ` · ${LIBELLE_LANGUE_VERSION[l.courante]}${l.variantes[autre] ? ` (${LIBELLE_LANGUE_VERSION[autre]} aussi)` : ''}`;
}

/**
 * Fiche d'un animé : « Sur vos sources » — la recherche que fera le lecteur,
 * lancée dès l'ouverture de la fiche (résultat gardé 10 min pour le lecteur).
 */
/** « Recherche sur vos sources… 4 s » : le temps écoulé, compté à partir de 2 s (l'écran ne paraît pas figé). */
function Ecoule({ actif }: { actif: boolean }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!actif) {
      setS(0);
      return undefined;
    }
    const debut = Date.now();
    const t = setInterval(() => setS(Math.floor((Date.now() - debut) / 1000)), 1000);
    return () => clearInterval(t);
  }, [actif]);
  return s >= 2 ? <>{` ${s} s`}</> : null;
}

export function DisponibiliteSources({ id, titres, oeuvre }: { id: string; titres: readonly string[]; oeuvre?: string }) {
  const { s, theme, version, changee } = useTsuzuku();
  const [essai, setEssai] = useState(0);
  const etat = useCharger(async () => {
    const d = await episodesDisponibles(s, { id, titres, forcer: essai > 0, langue: (await langueVoulue(s, `anime:${id}`)).langue });
    return { d, perso: (await lireTitresPerso(s))[`anime:${id}`] };
  }, [s, id, titres.join('|'), essai, version]);
  const d = etat.donnees?.d;
  // Résultat périmé servi par le cache : quand la recherche fraîche change quelque chose, les écrans se relisent.
  const rafraichissement = d?.rafraichissement;
  useEffect(() => {
    let actif = true;
    void rafraichissement?.then(change => {
      if (change && actif) changee();
    });
    return () => {
      actif = false;
    };
  }, [rafraichissement, changee]);
  // Aucune source : la carte « Aucune source configurée » le dit déjà.
  if (d?.diagnostic.raison === 'aucune-source' && !d.episodes.length) return null;
  const relancer = () => setEssai(v => v + 1);
  return (
    <View style={{ gap: 8 }} testID="fiche-sources">
      <Text style={styleTexte(theme, 15)}>Sur vos sources</Text>
      {s.viaRelais ? (
        <Text style={styleAttenue(theme, 12)} testID="fiche-sources-via-relais">
          Site web : lecture via le relais
        </Text>
      ) : null}
      {etat.enCours && !d ? (
        <Text style={styleAttenue(theme, 13)} testID="fiche-sources-recherche" accessibilityLiveRegion="polite">
          Recherche sur vos sources…
          <Ecoule actif={etat.enCours && !d} />
        </Text>
      ) : etat.erreur ? (
        <PanneauEchec message={etat.erreur} enCours={etat.enCours} onReessayer={relancer} oeuvre={oeuvre ?? titres[0]} testID="fiche-sources-echec" />
      ) : d && d.episodes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Avis
            genre="ok"
            testID="fiche-sources-ok"
            texte={`« ${d.resultat?.serie?.title ?? titres[0]} » trouvé sur « ${d.resultat?.source?.name ?? 'la source'} » : ${d.episodes.length} épisode(s) (n° ${d.episodes[0].number} à ${d.episodes[d.episodes.length - 1].number})${resumeLangues(d)}.`}
          />
          <Bouton titre={etat.enCours ? 'Recherche…' : 'Rechercher à nouveau'} desactive={etat.enCours} onPress={relancer} testID="fiche-sources-reessayer" />
          {d.mesure ? (
            <Text style={styleAttenue(theme, 12)} testID="fiche-sources-mesure">
              {texteMesure(d.mesure)}
            </Text>
          ) : null}
        </View>
      ) : d ? (
        <PanneauEchec
          message={d.message ?? 'Rien trouvé sur vos sources.'}
          diagnostic={d.diagnostic}
          titrePerso={etat.donnees?.perso}
          enCours={etat.enCours}
          onReessayer={relancer}
          onAutreTitre={t => void enregistrerTitrePerso(s, `anime:${id}`, t).then(relancer)}
          oeuvre={oeuvre ?? titres[0]}
          testID="fiche-sources-echec"
        />
      ) : null}
      {d && !etat.enCours ? <TesterSurCeTitre titres={titres} id={id} /> : null}
    </View>
  );
}

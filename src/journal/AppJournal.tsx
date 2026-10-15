/**
 * App « Journal » du hub : le carnet qui s'écrit seul.
 *
 * Une page par jour, écrite chaque soir (heure réglable) ou rattrapée à la
 * première ouverture, à partir de ce qui s'est passé dans les apps. On le lit
 * comme un livre : jour, semaine, mois, calendrier, recherche ; on ajoute sa
 * note et son humeur, on épingle une journée, on exporte (Markdown, ou PDF par
 * la fenêtre d'impression). Privé : tout vit dans la base chiffrée du profil.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RetourHub, BoutonHub } from '../hub/Hub';
import { Avis, Panneau, styleTitre } from '../hub/admin/ui/commun';
import { police, teinteTransparente } from '../hub/themes';
import type { PropsRacineApp } from '../hub/types';
import { masquerMontants } from '../ui/discretion';
import { useMobile } from '../ui/mobile/useMobile';
import { controlerJournal } from './automatique';
import { Basculeur, Onglets, BoutonRond, LigneJour, SelecteurHumeur, TextePage, taille } from './briques';
import { ajouterJours, ajouterMois, debutSemaine, finSemaine, grilleDuMois, jourCourt, jourDe, jourLongMaj, JOURS_SEMAINE, moisDe, moisLong, semaineLongue } from './dates';
import { echeanceDu, libelleProchaine } from './echeance';
import { documentImprimable, exporterMarkdown, imprimerDocument, nomFichierExport } from './export';
import { ecouterEcritures } from './evenements';
import { ecrireJournee, joursEcrits, reglagesOuCreer } from './moteur';
import {
  HEURE_MAX,
  HEURE_MIN,
  bornerHeure,
  ecrireReglages,
  emojiHumeur,
  lirePage,
  modifierPage,
  pagesEntre,
  toutesLesPages,
  type Humeur,
  type PageJournal,
  type ReglagesJournal,
} from './modele';
import { composerRecap, type Recap } from './recap';
import { chercher } from './recherche';
import { SOURCES_JOURNAL } from './sources';

type Vue = 'jour' | 'semaine' | 'mois' | 'calendrier' | 'recherche';
const VUES: ReadonlyArray<readonly [Vue, string]> = [
  ['jour', 'Jour'],
  ['semaine', 'Semaine'],
  ['mois', 'Mois'],
  ['calendrier', 'Calendrier'],
  ['recherche', 'Recherche'],
];

type AvisJournal = { texte: string; genre: 'ok' | 'alerte' | 'critique' | 'info' };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AppJournal(props: PropsRacineApp) {
  const { contexte, theme, onRetour } = props;
  const base = contexte.baseProfil;
  if (!base) {
    return (
      <View style={[styles.racine, { backgroundColor: theme.fond, padding: 24 }]} testID="app-journal-refus">
        <RetourHub theme={theme} onRetour={onRetour} titre="Journal" />
        <Text style={[styleTitre(theme), { fontSize: 24, marginTop: 24 }]}>Journal indisponible</Text>
        <Text style={{ color: theme.attenue, marginTop: 8, ...police(theme.policeTexte) }}>Ouvrez d’abord votre profil : le journal vit dans sa base chiffrée.</Text>
      </View>
    );
  }
  return <Carnet {...props} base={base} />;
}

function Carnet({ contexte, theme, onRetour, base }: PropsRacineApp & { base: NonNullable<PropsRacineApp['contexte']['baseProfil']> }) {
  const mobile = useMobile();
  const maintenant = useCallback(() => contexte.maintenant ?? Date.now(), [contexte.maintenant]);
  const aujourdhui = jourDe(maintenant());
  const [rev, setRev] = useState(0);
  const [vue, setVue] = useState<Vue>('jour');
  const [jour, setJour] = useState(aujourdhui);
  const [avis, setAvis] = useState<AvisJournal | undefined>();
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const [requete, setRequete] = useState('');
  const [enCours, setEnCours] = useState(false);
  const masquer = masquerMontants;

  // `rev` change après chaque écriture dans la base : les lectures ci-dessous sont alors refaites.
  /* eslint-disable react-hooks/exhaustive-deps */
  const reglages = useMemo(() => reglagesOuCreer(base, maintenant()), [base, maintenant, rev]);
  const page = useMemo(() => lirePage(base, jour), [base, jour, rev]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [brouillon, setBrouillon] = useState(page?.note ?? '');
  useEffect(() => setBrouillon(page?.note ?? ''), [jour, page?.note]);

  // Pages écrites ailleurs (échéance du soir pendant que l'écran est ouvert) : l'écran se relit.
  useEffect(() => ecouterEcritures(() => setRev(r => r + 1)), []);
  // Première ouverture : rattrape les soirs manqués.
  useEffect(() => {
    let vivant = true;
    controlerJournal({ ...contexte, baseProfil: base })
      .then(jours => {
        if (!vivant || jours.length === 0) return;
        setRev(r => r + 1);
        setAvis({ texte: jours.length === 1 ? `La page du ${jourLongMaj(jours[0], false).toLowerCase()} vient d’être écrite.` : `${jours.length} pages viennent d’être écrites (rattrapage).`, genre: 'info' });
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
    // Une seule fois à l'ouverture de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relire = () => setRev(r => r + 1);

  const ecrire = async (cible: string) => {
    setEnCours(true);
    setAvis(undefined);
    try {
      const r = reglagesOuCreer(base, maintenant());
      const t = maintenant();
      await ecrireJournee(cible, {
        base,
        sources: SOURCES_JOURNAL,
        contexte,
        maintenant: t,
        reglages: r,
        redacteur: r.ia ? contexte.redacteurJournal : undefined,
        enCours: cible === jourDe(t) && t < echeanceDu(cible, r.heure),
      });
      relire();
      setAvis({ texte: `La page du ${jourLongMaj(cible, false).toLowerCase()} est écrite.`, genre: 'ok' });
    } catch (e) {
      setAvis({ texte: `Écriture impossible : ${message(e)}`, genre: 'critique' });
    } finally {
      setEnCours(false);
    }
  };

  const majReglages = (suite: Partial<ReglagesJournal>) => {
    try {
      ecrireReglages(base, { ...reglagesOuCreer(base, maintenant()), ...suite });
      relire();
    } catch (e) {
      setAvis({ texte: `Réglage non enregistré : ${message(e)}`, genre: 'critique' });
    }
  };

  const modifier = (m: Parameters<typeof modifierPage>[2]) => {
    try {
      modifierPage(base, jour, m, maintenant());
      relire();
    } catch (e) {
      setAvis({ texte: `Enregistrement impossible : ${message(e)}`, genre: 'critique' });
    }
  };

  // ----- Portée de l'export selon la vue
  const portee = (() => {
    if (vue === 'jour') return { du: jour, au: jour, titre: jourLongMaj(jour) };
    if (vue === 'semaine') return { du: debutSemaine(jour), au: finSemaine(jour), titre: `Journal, ${semaineLongue(jour)}` };
    if (vue === 'mois' || vue === 'calendrier') return { du: `${moisDe(jour)}-01`, au: `${moisDe(jour)}-31`, titre: `Journal, ${moisLong(moisDe(jour))}` };
    return undefined;
  })();
  const recap: Recap | undefined = useMemo(() => {
    if (vue !== 'semaine' && vue !== 'mois') return undefined;
    const p = vue === 'semaine' ? { du: debutSemaine(jour), au: finSemaine(jour) } : { du: `${moisDe(jour)}-01`, au: `${moisDe(jour)}-31` };
    return composerRecap(vue, jour, pagesEntre(base, p.du, p.au), aujourdhui);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vue, jour, base, rev, aujourdhui]);

  const exporter = async (format: 'md' | 'pdf') => {
    if (!portee) return;
    const pages = pagesEntre(base, portee.du, portee.au).filter(p => p.auto.moteur !== 'vide' || p.note);
    if (pages.length === 0) {
      setAvis({ texte: 'Rien à exporter : aucune page sur cette période.', genre: 'alerte' });
      return;
    }
    const recapExport = vue === 'semaine' || vue === 'mois' ? recap : undefined;
    if (format === 'md') {
      if (!contexte.enregistrerFichier) {
        setAvis({ texte: 'Export de fichier indisponible sur cet appareil. Utilisez PDF (impression).', genre: 'alerte' });
        return;
      }
      const du = pages[0].jour;
      const au = pages[pages.length - 1].jour;
      const ok = await contexte.enregistrerFichier(nomFichierExport(du, au), exporterMarkdown(pages, recapExport, { masquer }), 'text/markdown;charset=utf-8');
      setAvis(ok ? { texte: `Journal exporté (${pages.length} page${pages.length > 1 ? 's' : ''}, Markdown).`, genre: 'ok' } : { texte: 'Export annulé.', genre: 'info' });
    } else {
      const ok = imprimerDocument(documentImprimable(portee.titre, pages, recapExport, { masquer }));
      setAvis(ok ? { texte: 'Fenêtre d’impression ouverte : choisissez « Enregistrer au format PDF ».', genre: 'info' } : { texte: 'Impression indisponible ici : utilisez l’export Markdown.', genre: 'alerte' });
    }
  };

  const aller = (j: string, v: Vue = 'jour') => {
    setJour(j);
    setVue(v);
    setAvis(undefined);
  };

  const pas = (sens: -1 | 1) => {
    if (vue === 'jour') setJour(j => ajouterJours(j, sens));
    else if (vue === 'semaine') setJour(j => ajouterJours(j, 7 * sens));
    else setJour(j => `${ajouterMois(moisDe(j), sens)}-01`);
    setAvis(undefined);
  };
  const suivantPossible = vue === 'jour' ? jour < aujourdhui : vue === 'semaine' ? finSemaine(jour) < aujourdhui : `${moisDe(jour)}` < moisDe(aujourdhui);
  const titreNav = vue === 'jour' ? jourLongMaj(jour) : vue === 'semaine' ? semaineLongue(jour) : moisLong(moisDe(jour));
  const t = (n: number) => taille(n, mobile);
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const existants = joursEcrits(base, aujourdhui, aujourdhui);

  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="app-journal">
      <View style={mobile ? styles.enteteMobile : styles.enteteBureau}>
        <RetourHub theme={theme} onRetour={onRetour} titre="Journal" />
      </View>
      <ScrollView contentContainerStyle={[styles.page, mobile && styles.pageMobile]} testID="journal-defilement" keyboardShouldPersistTaps="handled">
        <View style={styles.colonne}>
          <Text style={[styleTitre(theme), { fontSize: mobile ? 28 : 32 }]} accessibilityRole="header">
            Journal
          </Text>
          <Text style={[attenue, { fontSize: t(14) }]}>Votre carnet s’écrit seul chaque soir, à partir de vos apps. Privé : chiffré dans votre profil, jamais envoyé sur le relais.</Text>

          <View style={styles.rangee}>
            <Onglets theme={theme} mobile={mobile} valeur={vue} options={VUES} onChoisir={v => { setVue(v); setAvis(undefined); }} testID="journal-onglet" />
            <BoutonRond theme={theme} mobile={mobile} titre="⚙︎" libelle="Réglages du journal" onPress={() => setReglagesOuverts(o => !o)} actif={reglagesOuverts} testID="journal-reglages-ouvrir" />
          </View>

          {reglagesOuverts ? (
            <Panneau theme={theme} testID="journal-reglages">
              <Text style={[texte, { fontWeight: '700', fontSize: t(15) }]}>Écriture automatique</Text>
              <Basculeur theme={theme} mobile={mobile} testID="journal-actif" libelle="Écrire une page chaque soir" valeur={reglages.actif} onChanger={v => majReglages({ actif: v })} />
              <View style={styles.ligneReglage}>
                <Text style={[texte, { fontSize: t(15), flex: 1 }]}>Heure de l’écriture</Text>
                <BoutonRond theme={theme} mobile={mobile} titre="−" libelle="Une heure plus tôt" desactive={reglages.heure <= HEURE_MIN} onPress={() => majReglages({ heure: bornerHeure(reglages.heure - 1) })} testID="journal-heure-moins" />
                <Text testID="journal-heure" style={[texte, { fontSize: t(17), fontWeight: '700', minWidth: 48, textAlign: 'center' }]}>{reglages.heure} h</Text>
                <BoutonRond theme={theme} mobile={mobile} titre="+" libelle="Une heure plus tard" desactive={reglages.heure >= HEURE_MAX} onPress={() => majReglages({ heure: bornerHeure(reglages.heure + 1) })} testID="journal-heure-plus" />
              </View>
              <Text testID="journal-prochaine" style={[attenue, { fontSize: t(14) }]}>
                {libelleProchaine(maintenant(), reglages, existants)} Si l’app est fermée à cette heure, la page s’écrit à la première ouverture.
              </Text>
              <Basculeur theme={theme} mobile={mobile} testID="journal-ia" libelle="Rédaction par IA (désactivée par défaut)" valeur={reglages.ia && Boolean(contexte.redacteurJournal)} desactive={!contexte.redacteurJournal} onChanger={v => majReglages({ ia: v })} />
              <Text style={[attenue, { fontSize: t(13) }]}>
                {contexte.redacteurJournal ? `Rédacteur branché : ${contexte.redacteurJournal.nom}. Il ne reçoit que les faits du jour, sans montant.` : 'Aucun rédacteur IA n’est branché : les modèles de phrases écrivent, sans aucun appel externe.'}
              </Text>
              <View style={styles.actions}>
                <BoutonHub theme={theme} titre="Écrire la page d’aujourd’hui maintenant" onPress={() => void ecrire(aujourdhui)} desactive={enCours} testID="journal-ecrire-maintenant" />
              </View>
            </Panneau>
          ) : null}

          {avis ? <Avis theme={theme} genre={avis.genre} texte={avis.texte} testID="journal-avis" /> : null}

          {vue !== 'recherche' ? (
            <View style={styles.navigation}>
              <BoutonRond theme={theme} mobile={mobile} titre="‹" libelle={vue === 'jour' ? 'Jour précédent' : vue === 'semaine' ? 'Semaine précédente' : 'Mois précédent'} onPress={() => pas(-1)} testID="journal-precedent" />
              <Text testID="journal-titre" accessibilityRole="header" style={[styleTitre(theme), { flex: 1, textAlign: 'center', fontSize: mobile ? 18 : 20 }]}>
                {titreNav}
              </Text>
              <BoutonRond theme={theme} mobile={mobile} titre="›" libelle={vue === 'jour' ? 'Jour suivant' : vue === 'semaine' ? 'Semaine suivante' : 'Mois suivant'} desactive={!suivantPossible} onPress={() => pas(1)} testID="journal-suivant" />
              {jour !== aujourdhui ? <BoutonHub theme={theme} titre="Aujourd’hui" onPress={() => setJour(aujourdhui)} testID="journal-aujourdhui" /> : null}
            </View>
          ) : null}

          {vue === 'jour' ? (
            <VueJour
              theme={theme}
              mobile={mobile}
              jour={jour}
              aujourdhui={aujourdhui}
              page={page}
              brouillon={brouillon}
              setBrouillon={setBrouillon}
              masquer={masquer}
              enCours={enCours}
              onEcrire={() => void ecrire(jour)}
              onHumeur={h => modifier({ humeur: h })}
              onNote={() => modifier({ note: brouillon })}
              onEpingle={() => modifier({ epingle: !page?.epingle })}
            />
          ) : null}
          {vue === 'semaine' && recap ? <VueSemaine theme={theme} mobile={mobile} jour={jour} recap={recap} base={base} masquer={masquer} aller={aller} /> : null}
          {vue === 'mois' && recap ? <VueMois theme={theme} mobile={mobile} recap={recap} base={base} masquer={masquer} aller={aller} /> : null}
          {vue === 'calendrier' ? <VueCalendrier theme={theme} mobile={mobile} jour={jour} aujourdhui={aujourdhui} base={base} rev={rev} aller={aller} /> : null}
          {vue === 'recherche' ? <VueRecherche theme={theme} mobile={mobile} base={base} requete={requete} setRequete={setRequete} aller={aller} /> : null}

          {portee ? (
            <View style={styles.actions}>
              <BoutonHub theme={theme} titre="Exporter en Markdown" onPress={() => void exporter('md')} testID="journal-exporter-md" />
              <BoutonHub theme={theme} titre="Exporter en PDF" onPress={() => void exporter('pdf')} testID="journal-exporter-pdf" />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ Vue « jour »

interface PropsJour {
  theme: PropsRacineApp['theme'];
  mobile: boolean;
  jour: string;
  aujourdhui: string;
  page?: PageJournal;
  brouillon: string;
  setBrouillon(t: string): void;
  masquer(t: string): string;
  enCours: boolean;
  onEcrire(): void;
  onHumeur(h: Humeur | null): void;
  onNote(): void;
  onEpingle(): void;
}

function VueJour(p: PropsJour) {
  const { theme, mobile, page, jour } = p;
  const t = (n: number) => taille(n, mobile);
  const redigee = page && page.auto.moteur !== 'vide';
  const passe = jour <= p.aujourdhui;
  return (
    <Panneau theme={theme} testID="journal-page" style={styles.carte}>
      {redigee && page ? (
        <>
          <TextePage theme={theme} mobile={mobile} page={page} masquer={p.masquer} />
          {page.sourcesEnEchec?.length ? (
            <Text testID="journal-echecs" style={{ color: theme.alerte, fontSize: t(14), ...police(theme.policeTexte) }}>
              Écrite sans : {page.sourcesEnEchec.join(', ')} (source indisponible au moment de l’écriture).
            </Text>
          ) : null}
        </>
      ) : (
        <View style={{ gap: 10 }} testID="journal-vide">
          <Text style={{ color: theme.texte, fontSize: t(16), ...police(theme.policeTexte) }}>
            {passe ? 'Pas encore de page pour ce jour.' : 'Ce jour n’est pas encore arrivé.'}
          </Text>
          {passe ? (
            <View style={styles.actions}>
              <BoutonHub theme={theme} variante="plein" titre="Écrire la page de ce jour" onPress={p.onEcrire} desactive={p.enCours} testID="journal-ecrire-jour" />
            </View>
          ) : null}
        </View>
      )}

      {passe ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.attenue, fontSize: t(12), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>Mon humeur</Text>
          <SelecteurHumeur theme={theme} mobile={mobile} valeur={page?.humeur} onChoisir={p.onHumeur} />
          <Text style={{ color: theme.attenue, fontSize: t(12), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>Ma note</Text>
          <TextInput
            testID="journal-note"
            accessibilityLabel="Ma note du jour"
            value={p.brouillon}
            onChangeText={p.setBrouillon}
            multiline
            maxLength={8000}
            placeholder="Un mot, une pensée, ce qui compte pour toi aujourd’hui…"
            placeholderTextColor={theme.attenue}
            style={[styles.note, { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), fontSize: mobile ? 17 : 15, ...police(theme.policeTexte) }]}
          />
          <View style={styles.actions}>
            <BoutonHub theme={theme} variante="plein" titre="Enregistrer la note" onPress={p.onNote} desactive={p.brouillon === (page?.note ?? '')} testID="journal-note-enregistrer" />
            <BoutonHub theme={theme} titre={page?.epingle ? '📌 Journée épinglée' : '📌 Épingler cette journée'} onPress={p.onEpingle} testID="journal-epingler" />
            {redigee ? <BoutonHub theme={theme} titre="Réécrire la page" onPress={p.onEcrire} desactive={p.enCours} testID="journal-reecrire" /> : null}
          </View>
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Vues « semaine » et « mois »

type Aller = (jour: string, vue?: Vue) => void;

function BlocRecap({ theme, mobile, recap, masquer }: { theme: PropsRacineApp['theme']; mobile: boolean; recap: Recap; masquer(t: string): string }) {
  const t = (n: number) => taille(n, mobile);
  const corps = { color: theme.texte, fontSize: t(16), lineHeight: t(16) * 1.55, ...police(theme.policeTexte) };
  return (
    <Panneau theme={theme} testID="journal-recap" style={styles.carte}>
      <Text style={{ color: theme.attenue, fontSize: t(14), fontStyle: 'italic', ...police(theme.policeTexte) }}>{recap.titre.charAt(0).toUpperCase() + recap.titre.slice(1)}</Text>
      <Text style={corps}>{masquer(recap.intro)}</Text>
      <View style={styles.chiffres}>
        {recap.chiffres.map(c => (
          <View key={c.id} testID={`journal-recap-${c.id}`} style={[styles.chiffre, { borderColor: theme.ligne, backgroundColor: theme.fond, borderRadius: Math.min(theme.rayonMoyen, 12) }]}>
            <Text style={{ color: theme.texte, fontSize: t(19), fontWeight: theme.poidsTitre, ...police(theme.policeChiffres) }}>{masquer(c.valeur)}</Text>
            <Text style={{ color: theme.attenue, fontSize: t(12), ...police(theme.policeTexte) }}>{c.libelle}</Text>
          </View>
        ))}
      </View>
      {recap.sections.map(s => (
        <View key={s.id} style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: theme.accent, fontSize: t(13), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>{s.titre}</Text>
          {s.paragraphes.map((p, i) => (
            <Text key={i} style={corps}>{masquer(p)}</Text>
          ))}
        </View>
      ))}
      {recap.marquants.length ? (
        <View style={{ gap: 4 }} testID="journal-recap-marquants">
          <Text accessibilityRole="header" style={{ color: theme.accent, fontSize: t(13), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>Faits marquants</Text>
          {recap.marquants.map(f => (
            <Text key={f.jour} style={corps}>
              {jourCourt(f.jour)} : {masquer(f.texte)}
            </Text>
          ))}
        </View>
      ) : null}
    </Panneau>
  );
}

function VueSemaine({ theme, mobile, jour, recap, base, masquer, aller }: { theme: PropsRacineApp['theme']; mobile: boolean; jour: string; recap: Recap; base: NonNullable<PropsRacineApp['contexte']['baseProfil']>; masquer(t: string): string; aller: Aller }) {
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(debutSemaine(jour), i));
  const pages = pagesEntre(base, jours[0], jours[6]);
  return (
    <>
      <BlocRecap theme={theme} mobile={mobile} recap={recap} masquer={masquer} />
      <View style={{ gap: 8 }} testID="journal-semaine-jours">
        {jours.map(j => {
          const p = pages.find(x => x.jour === j);
          const redigee = p && p.auto.moteur !== 'vide';
          return (
            <LigneJour
              key={j}
              theme={theme}
              mobile={mobile}
              jour={j}
              texte={`${JOURS_SEMAINE[(new Date(`${j}T12:00:00`).getDay() + 6) % 7]} · ${redigee ? masquer(p!.auto.marquant?.texte ?? p!.auto.accroche) : p?.note ? 'Note sans page automatique' : 'Pas de page'}`}
              humeur={emojiHumeur(p?.humeur)}
              epingle={p?.epingle}
              onPress={() => aller(j)}
              testID={`journal-semaine-${j}`}
            />
          );
        })}
      </View>
    </>
  );
}

function VueMois({ theme, mobile, recap, base, masquer, aller }: { theme: PropsRacineApp['theme']; mobile: boolean; recap: Recap; base: NonNullable<PropsRacineApp['contexte']['baseProfil']>; masquer(t: string): string; aller: Aller }) {
  const pages = pagesEntre(base, recap.du, recap.au).filter(p => p.epingle);
  return (
    <>
      <BlocRecap theme={theme} mobile={mobile} recap={recap} masquer={masquer} />
      {pages.length ? (
        <View style={{ gap: 8 }} testID="journal-mois-epinglees">
          <Text accessibilityRole="header" style={{ color: theme.accent, fontSize: taille(13, mobile), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>Journées épinglées</Text>
          {pages.map(p => (
            <LigneJour key={p.jour} theme={theme} mobile={mobile} jour={p.jour} texte={masquer(p.auto.marquant?.texte ?? p.auto.accroche)} humeur={emojiHumeur(p.humeur)} epingle onPress={() => aller(p.jour)} testID={`journal-epinglee-${p.jour}`} />
          ))}
        </View>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ Calendrier

function VueCalendrier({ theme, mobile, jour, aujourdhui, base, rev, aller }: { theme: PropsRacineApp['theme']; mobile: boolean; jour: string; aujourdhui: string; base: NonNullable<PropsRacineApp['contexte']['baseProfil']>; rev: number; aller: Aller }) {
  const mois = moisDe(jour);
  const semaines = useMemo(() => grilleDuMois(mois), [mois]);
  // `rev` : relecture après chaque écriture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pages = useMemo(() => new Map(pagesEntre(base, `${mois}-01`, `${mois}-31`).map(p => [p.jour, p])), [base, mois, rev]);
  return (
    <Panneau theme={theme} testID="journal-calendrier" style={[styles.carte, mobile && styles.carteCalendrier]}>
      <View style={styles.semaineCal}>
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', color: theme.attenue, fontSize: taille(13, mobile), fontWeight: '700', ...police(theme.policeTexte) }}>
            {l}
          </Text>
        ))}
      </View>
      {semaines.map((s, i) => (
        <View key={i} style={styles.semaineCal}>
          {s.map((j, k) => {
            if (!j) return <View key={k} style={styles.celluleVide} />;
            const p = pages.get(j);
            const redigee = p && p.auto.moteur !== 'vide';
            const futur = j > aujourdhui;
            return (
              <Pressable
                key={k}
                testID={`journal-cellule-${j}`}
                accessibilityRole="button"
                accessibilityLabel={`${jourLongMaj(j)}${redigee ? ', page écrite' : ''}${p?.epingle ? ', épinglée' : ''}`}
                disabled={futur}
                onPress={() => aller(j)}
                style={[
                  styles.cellule,
                  {
                    borderColor: j === jour ? theme.accent : theme.ligne,
                    backgroundColor: redigee ? teinteTransparente(theme.accent, 0.14) : theme.surface,
                    borderRadius: Math.min(theme.rayonMoyen, 10),
                    opacity: futur ? 0.4 : 1,
                  },
                ]}>
                <Text style={{ color: theme.texte, fontSize: taille(14, mobile), fontWeight: j === aujourdhui ? '800' : '500', ...police(theme.policeChiffres) }}>{Number(j.slice(8))}</Text>
                <Text style={{ fontSize: taille(12, mobile), minHeight: 16 }}>{`${p?.epingle ? '📌' : ''}${emojiHumeur(p?.humeur) || (redigee ? '•' : '')}`}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={{ color: theme.attenue, fontSize: taille(13, mobile), ...police(theme.policeTexte) }}>• page écrite · 📌 épinglée · l’émoji est l’humeur choisie.</Text>
    </Panneau>
  );
}

// ------------------------------------------------------------------ Recherche

function VueRecherche({ theme, mobile, base, requete, setRequete, aller }: { theme: PropsRacineApp['theme']; mobile: boolean; base: NonNullable<PropsRacineApp['contexte']['baseProfil']>; requete: string; setRequete(t: string): void; aller: Aller }) {
  const pages = useMemo(() => toutesLesPages(base), [base]);
  const resultats = useMemo(() => chercher(pages, requete), [pages, requete]);
  const epinglees = pages.filter(p => p.epingle).reverse();
  return (
    <View style={{ gap: 12 }} testID="journal-recherche">
      <TextInput
        testID="journal-recherche-champ"
        accessibilityLabel="Chercher dans le journal"
        value={requete}
        onChangeText={setRequete}
        placeholder="Chercher un mot, un titre, une série, une note…"
        placeholderTextColor={theme.attenue}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.champ, { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), fontSize: mobile ? 17 : 15, ...police(theme.policeTexte) }]}
      />
      {requete.trim() ? (
        resultats.length ? (
          <View style={{ gap: 8 }}>
            <Text testID="journal-recherche-compte" style={{ color: theme.attenue, fontSize: taille(14, mobile), ...police(theme.policeTexte) }}>
              {resultats.length} page{resultats.length > 1 ? 's' : ''} trouvée{resultats.length > 1 ? 's' : ''}
            </Text>
            {resultats.map(r => (
              <LigneJour key={r.jour} theme={theme} mobile={mobile} jour={r.jour} texte={`${r.dans === 'note' ? 'Ma note : ' : ''}${masquerMontants(r.extrait)}`} epingle={r.epingle} onPress={() => aller(r.jour)} testID={`journal-resultat-${r.jour}`} />
            ))}
          </View>
        ) : (
          <Text testID="journal-recherche-vide" style={{ color: theme.attenue, fontSize: taille(15, mobile), ...police(theme.policeTexte) }}>
            Aucune page ne correspond.
          </Text>
        )
      ) : (
        <View style={{ gap: 8 }} testID="journal-epinglees">
          <Text accessibilityRole="header" style={{ color: theme.accent, fontSize: taille(13, mobile), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', ...police(theme.policeTexte) }}>Journées épinglées</Text>
          {epinglees.length === 0 ? (
            <Text style={{ color: theme.attenue, fontSize: taille(15, mobile), ...police(theme.policeTexte) }}>Aucune journée épinglée pour l’instant.</Text>
          ) : (
            epinglees.map(p => (
              <LigneJour key={p.jour} theme={theme} mobile={mobile} jour={p.jour} texte={masquerMontants(p.auto.marquant?.texte ?? p.auto.accroche)} humeur={emojiHumeur(p.humeur)} epingle onPress={() => aller(p.jour)} testID={`journal-epinglee-${p.jour}`} />
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  enteteBureau: { paddingHorizontal: 24, paddingTop: 16 },
  enteteMobile: { paddingHorizontal: 16 },
  page: { padding: 24, paddingBottom: 64, alignItems: 'center' },
  pageMobile: { padding: 16, paddingBottom: 48 },
  colonne: { width: '100%', maxWidth: 860, gap: 14 },
  rangee: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  ligneReglage: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  carte: { gap: 16, padding: 18 },
  carteCalendrier: { padding: 8, gap: 6 },
  note: { borderWidth: 1, padding: 12, minHeight: 110, textAlignVertical: 'top' },
  champ: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48 },
  chiffres: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chiffre: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, gap: 2, minWidth: 120, flexGrow: 1, flexBasis: 120 },
  semaineCal: { flexDirection: 'row', gap: 3 },
  cellule: { flex: 1, minHeight: 54, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  celluleVide: { flex: 1, minHeight: 54 },
});

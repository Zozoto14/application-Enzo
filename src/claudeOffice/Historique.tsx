/**
 * Claude Office : écran « Historique » — chaque requête faite à Claude Code
 * sur un appareil équipé du hook d'historique, même AppDashboard fermé.
 *
 * Sur le PC : lecture du journal local par le pont (relu toutes les 5 s :
 * seules les lignes ajoutées sont lues), réglages, import, suppression
 * (confirmée ici, puis par une boîte native), installation du hook. Partout
 * (PC, site, téléphone) : la copie chiffrée déposée sur le relais par les
 * appareils équipés, si la synchro est activée (compte principal seulement).
 * Voir docs/claude-office-historique.md.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { police, type ThemeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import {
  LIBELLES_TYPES, compter, exporterCsv, exporterJson, filtrer, fusionner, grouper, heure, libelleJour, nomExport, texteComplet, titreEntree,
  valeursFiltres, type EntreeHistorique, type Filtres,
} from './logiqueHistorique';
import { LIBELLE_HOOK_HISTORIQUE, type CritereSuppression, type EtatClaudeOffice, type LectureHistorique, type PlanHooks, type PontClaudeOffice, type PontHistorique } from './pont';
import { ecrireEtatSynchro, lireEtatSynchro, synchroniserSiDu, type CopieAppareil, type EtatSynchroHistorique } from './synchroHistorique';
import type { FiltreHistorique } from './Bureau';
import { entreesDemo } from './logiqueScene';
import { historiqueDemo } from './logiqueStats';
import { NoteSession } from './NoteSession';
import { Bouton as BoutonHub, Interrupteur, Puce as PuceOffice } from './uiOffice';

export const INTERVALLE_LECTURE_MS = 5_000;
const PAR_PAGE = 150;

interface Distant {
  entrees: EntreeHistorique[];
  copies: CopieAppareil[];
  erreurs: string[];
  le: string;
}

function RangeePuces({ theme, libelle, valeurs, choisie, onChoix, testID, libelles }: {
  theme: ThemeHub; libelle: string; valeurs: string[]; choisie?: string; onChoix(v?: string): void; testID: string; libelles?: Record<string, string>;
}) {
  const sm = stylesMobile;
  if (valeurs.length === 0) return null;
  return (
    <View style={styles.rangee}>
      <Text style={[styles.libelle, sm.texte, { color: theme.attenue }]}>{libelle}</Text>
      <PuceOffice theme={theme} titre="Tous" actif={!choisie} onPress={() => onChoix(undefined)} testID={`${testID}-tous`} />
      {valeurs.slice(0, 15).map(v => (
        <PuceOffice key={v} theme={theme} titre={libelles?.[v] ?? v} actif={choisie === v} onPress={() => onChoix(choisie === v ? undefined : v)} testID={`${testID}-${v}`} />
      ))}
    </View>
  );
}

export function Historique({ theme, contexte, office, filtreInitial, debutDemo }: {
  theme: ThemeHub; contexte: ContexteHub; office?: PontClaudeOffice;
  /** Ouvert depuis le Bureau : recherche ou session déjà choisie. */
  filtreInitial?: FiltreHistorique;
  /** Démo de l'écran : historique fictif, en lecture seule. */
  debutDemo?: number;
}) {
  const demo = debutDemo !== undefined;
  const pont: PontHistorique | undefined = demo ? undefined : office?.historique;
  const [etatHook, setEtatHook] = useState<EtatClaudeOffice['historique']>();
  const service = demo ? undefined : contexte.historiqueOffice;
  const base = contexte.baseProfil;
  const [local, setLocal] = useState<LectureHistorique>();
  const [distant, setDistant] = useState<Distant>();
  const [filtres, setFiltres] = useState<Filtres>(() => ({ ...(filtreInitial?.recherche ? { recherche: filtreInitial.recherche } : {}), ...(filtreInitial?.session ? { session: filtreInitial.session } : {}) }));
  const [affiches, setAffiches] = useState(PAR_PAGE);
  const [selection, setSelection] = useState<string>();
  const [confirmer, setConfirmer] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [plan, setPlan] = useState<PlanHooks>();
  const [occupe, setOccupe] = useState(false);
  const [synchro, setSynchro] = useState<EtatSynchroHistorique>(() => lireEtatSynchro(base));
  const monte = useRef(true);
  useEffect(() => () => void (monte.current = false), []);

  const lireEtatHook = useCallback(async () => {
    try {
      const etat = await office?.etat();
      if (monte.current) setEtatHook(etat?.historique);
    } catch {
      // L'état du hook reste inconnu.
    }
  }, [office]);
  useEffect(() => {
    if (pont) void lireEtatHook();
  }, [pont, lireEtatHook]);

  const lireLocal = useCallback(async () => {
    if (!pont) return undefined;
    try {
      const lu = await pont.lire();
      if (monte.current) setLocal(lu);
      return lu;
    } catch (erreur) {
      if (monte.current) setLocal({ ok: false, erreur: (erreur as Error).message });
      return undefined;
    }
  }, [pont]);

  const lireDistant = useCallback(async () => {
    if (!service) return;
    try {
      const lu = await service.lireTout();
      if (monte.current) setDistant({ ...lu, le: new Date().toISOString() });
    } catch (erreur) {
      if (monte.current) setMessage(`Relais : ${(erreur as Error).message}`);
    }
  }, [service]);

  // Ingestion continue du journal local : relu toutes les 5 s (seules les lignes ajoutées sont lues).
  useEffect(() => {
    if (!pont) return undefined;
    void lireLocal();
    const minuterie = setInterval(() => void lireLocal(), INTERVALLE_LECTURE_MS);
    return () => clearInterval(minuterie);
  }, [pont, lireLocal]);

  // Copies des autres appareils : à l'ouverture si la synchro est active (ou hors du PC, où c'est la seule source).
  useEffect(() => {
    if (service && (!pont || lireEtatSynchro(base).active)) void lireDistant();
  }, [service, pont, base, lireDistant]);

  // Dépôt automatique de la copie chiffrée, s'il est dû (délai minimal, contenu changé).
  useEffect(() => {
    if (!pont || !service || !local?.entrees || !synchro.active) return;
    void synchroniserSiDu({ service, base, appareilId: local.reglages?.appareilId, entrees: local.entrees }).then(r => {
      if (monte.current && r.issue !== 'trop-tot' && r.issue !== 'inchangee') setSynchro(r.etat);
    });
  }, [pont, service, base, local, synchro.active]);

  const minuteDemo = demo ? Math.floor(Date.now() / 60_000) : 0;
  const toutes = useMemo(
    () => (demo ? fusionner(historiqueDemo(Date.now()), entreesDemo(debutDemo!, Date.now())) : fusionner(local?.entrees, distant?.entrees)),
    [demo, debutDemo, local, distant, minuteDemo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filtrees = useMemo(() => filtrer(toutes, filtres), [toutes, filtres]);
  const options = useMemo(() => valeursFiltres(toutes), [toutes]);
  const compteurs = useMemo(() => compter(filtrees), [filtrees]);
  // Les plus récentes d'abord : on coupe à la fin de la liste triée.
  const visibles = useMemo(() => filtrees.slice(Math.max(0, filtrees.length - affiches)), [filtrees, affiches]);
  const groupes = useMemo(() => grouper(visibles), [visibles]);
  const choisie = selection ? toutes.find(e => e.id === selection) : undefined;
  const surCePc = (e: EntreeHistorique) => !!local?.entrees?.some(l => l.id === e.id);

  const changerFiltre = (cle: keyof Filtres, valeur?: string) => {
    setFiltres(f => ({ ...f, [cle]: valeur || undefined }));
    setAffiches(PAR_PAGE);
  };

  const agir = async (action: () => Promise<string | undefined>) => {
    setOccupe(true);
    setConfirmer(undefined);
    try {
      setMessage(await action());
    } catch (erreur) {
      setMessage((erreur as Error).message);
    } finally {
      setOccupe(false);
      await lireLocal();
      if (pont) await lireEtatHook();
    }
  };

  const supprimer = (critere: CritereSuppression) =>
    agir(async () => {
      if (!pont) return undefined;
      const r = await pont.supprimer(critere);
      if (r.annule) return 'Annulé : rien n’a été supprimé.';
      if (!r.ok) return r.erreur;
      setSelection(undefined);
      return `${r.supprimees ?? 0} entrée${(r.supprimees ?? 0) > 1 ? 's' : ''} supprimée${(r.supprimees ?? 0) > 1 ? 's' : ''} de ce PC.${synchro.active ? ' La copie du relais suivra au prochain dépôt.' : ''}`;
    });

  const exporter = (format: 'json' | 'csv') =>
    agir(async () => {
      const contenu = format === 'json' ? exporterJson(filtrees) : exporterCsv(filtrees);
      const enregistrer = contexte.enregistrerFichier;
      if (!enregistrer) return 'Export indisponible ici.';
      const ok = await enregistrer(nomExport(format), contenu, format === 'json' ? 'application/json' : 'text/csv');
      return ok ? `${filtrees.length} entrée${filtrees.length > 1 ? 's' : ''} exportée${filtrees.length > 1 ? 's' : ''} (${format.toUpperCase()}).` : undefined;
    });

  const copier = async (e: EntreeHistorique) => {
    const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    try {
      await presse?.writeText(texteComplet(e));
      setMessage(presse ? 'Copié dans le presse-papiers.' : 'Copie indisponible ici : sélectionnez le texte.');
    } catch {
      setMessage('Copie refusée par le navigateur : sélectionnez le texte.');
    }
  };

  const reglages = local?.reglages;
  const changerReglage = (changement: Parameters<PontHistorique['reglages']>[0]) =>
    agir(async () => {
      const r = await pont!.reglages(changement);
      return r.ok ? 'Réglage enregistré : il vaut pour les prochaines requêtes.' : r.erreur;
    });

  const basculerSynchro = (active: boolean) => {
    const etat = { ...lireEtatSynchro(base), active, erreur: undefined };
    ecrireEtatSynchro(base, etat);
    setSynchro(etat);
    if (active) void lireDistant();
  };

  const synchroniserMaintenant = () =>
    agir(async () => {
      const r = await synchroniserSiDu({ service, base, appareilId: reglages?.appareilId, entrees: local?.entrees ?? [], manuel: true });
      setSynchro(r.etat);
      await lireDistant();
      return {
        envoyee: 'Copie chiffrée déposée sur le relais.',
        'trop-tot': 'Dernier dépôt il y a moins d’une minute : réessayez un peu plus tard.',
        inchangee: 'Rien de nouveau à déposer.',
        echec: `Échec du dépôt : ${r.etat.erreur ?? 'relais injoignable'}.`,
        desactivee: 'La synchro est désactivée.',
        indisponible: 'Relais non relié (compte principal seulement) ou journal pas encore lu.',
      }[r.issue];
    });

  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue };
  // Partout (site sur iPad et iPhone d'abord) : textes ≥ 15 px, champs ≥ 16 px (sinon Safari zoome au focus), cibles ≥ 44 px.
  const sm = stylesMobile;
  const periodeOk = !!filtres.du && !!filtres.au;

  return (
    <View style={styles.colonne} testID="historique">
      <View style={[styles.avertissement, { borderColor: theme.alerte, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen }]} testID="historique-avertissement">
        <Text style={[styles.texte, sm.texte, texte]}>
          Cet historique contient ce que vous écrivez à Claude (demandes, noms de fichiers, débuts de commandes) : traitez-le comme un document personnel. Les secrets reconnus (clés d’API, jetons, mots de passe) sont masqués avant l’écriture, mais pas forcément tous.
        </Text>
        <Text style={[styles.petit, sm.texte, attenue]}>
          Seul un appareil où Claude Code a le hook d’historique enregistre — même si AppDashboard et Claude Office sont fermés. Un PC éteint, ou un appareil sans le hook, n’enregistre rien.
        </Text>
      </View>

      {demo ? <Text style={[styles.texte, sm.texte, { color: theme.sombre ? '#F4A261' : '#9A4A12', fontWeight: '700' }]} testID="historique-demo">◆ Démo : historique fictif, en lecture seule</Text> : null}
      {filtres.session ? (
        <View style={styles.rangee}>
          <PuceOffice theme={theme} titre={`Session ${filtres.session.slice(0, 8)} ✕`} libelle="Retirer le filtre de session" actif onPress={() => changerFiltre('session', undefined)} testID="historique-filtre-session" />
          <Text style={[styles.texte, sm.texte, attenue]}>Seulement cette session (ouverte depuis le Bureau).</Text>
        </View>
      ) : null}
      {pont || demo ? null : (
        <Text style={[styles.texte, sm.texte, attenue]} testID="historique-hors-pc">
          {service
            ? 'Ici, on lit la copie chiffrée que les PC équipés déposent sur le relais (si leur synchro est activée).'
            : 'Le journal est sur le PC : ouvrez Claude Office sur le PC. Pour le lire ici, activez sa synchro sur le PC (compte principal relié au relais).'}
        </Text>
      )}
      {local && !local.ok ? <Text style={[styles.texte, sm.texte, { color: theme.critique }]}>Journal illisible : {local.erreur}</Text> : null}

      <View style={styles.compteurs} testID="historique-compteurs">
        {[
          ['Entrées', compteurs.total],
          ['Demandes', compteurs.demandes],
          ['Outils', compteurs.outils],
          ['Sessions', compteurs.sessions],
          ['Projets', compteurs.projets],
          ['Appareils', compteurs.appareils],
        ].map(([l, v]) => (
          <View key={l} style={[styles.compteur, { borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
            <Text style={[styles.nombre, { color: theme.texte }, police(theme.policeChiffres)]} testID={`historique-compte-${String(l).toLowerCase()}`}>{v}</Text>
            <Text style={[styles.petit, sm.texte, attenue]}>{l}</Text>
          </View>
        ))}
      </View>
      {local?.ignorees ? <Text style={[styles.petit, sm.texte, attenue]}>{local.ignorees} ligne(s) illisible(s) ignorée(s) (coupure pendant une écriture).</Text> : null}

      <TextInput
        testID="historique-recherche"
        placeholder="Rechercher dans les demandes, fichiers, commandes…"
        placeholderTextColor={theme.attenue}
        value={filtres.recherche ?? ''}
        onChangeText={t => changerFiltre('recherche', t)}
        accessibilityLabel="Rechercher dans l’historique"
        inputMode="search"
        enterKeyHint="search"
        style={[styles.champ, sm.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]}
      />
      <RangeePuces theme={theme} libelle="Type" valeurs={Object.keys(LIBELLES_TYPES)} libelles={LIBELLES_TYPES} choisie={filtres.type} onChoix={v => changerFiltre('type', v)} testID="filtre-type" />
      <RangeePuces theme={theme} libelle="Projet" valeurs={options.projets} choisie={filtres.projet} onChoix={v => changerFiltre('projet', v)} testID="filtre-projet" />
      <RangeePuces theme={theme} libelle="Appareil" valeurs={options.appareils} choisie={filtres.appareil} onChoix={v => changerFiltre('appareil', v)} testID="filtre-appareil" />
      <RangeePuces theme={theme} libelle="Outil" valeurs={options.outils} choisie={filtres.outil} onChoix={v => changerFiltre('outil', v)} testID="filtre-outil" />
      <View style={styles.rangee}>
        <Text style={[styles.libelle, sm.texte, attenue]}>Période</Text>
        <TextInput testID="filtre-du" placeholder="du AAAA-MM-JJ" placeholderTextColor={theme.attenue} value={filtres.du ?? ''} onChangeText={t => changerFiltre('du', t)} accessibilityLabel="Période : du (AAAA-MM-JJ)" enterKeyHint="next" style={[styles.date, sm.champ, { color: theme.texte, borderColor: theme.ligne }]} />
        <TextInput testID="filtre-au" placeholder="au AAAA-MM-JJ" placeholderTextColor={theme.attenue} value={filtres.au ?? ''} onChangeText={t => changerFiltre('au', t)} accessibilityLabel="Période : au (AAAA-MM-JJ)" enterKeyHint="done" style={[styles.date, sm.champ, { color: theme.texte, borderColor: theme.ligne }]} />
      </View>

      <View style={styles.boutons}>
        <BoutonHub theme={theme} titre="Exporter en JSON" desactive={occupe || filtrees.length === 0} onPress={() => exporter('json')} testID="historique-export-json" />
        <BoutonHub theme={theme} titre="Exporter en CSV" desactive={occupe || filtrees.length === 0} onPress={() => exporter('csv')} testID="historique-export-csv" />
        {pont ? (
          <>
            <BoutonHub theme={theme} titre="Actualiser" desactive={occupe} onPress={() => void lireLocal()} testID="historique-actualiser" />
            <BoutonHub theme={theme} variante="danger" titre={confirmer === 'periode' ? 'Confirmer : supprimer la période' : 'Supprimer la période…'} desactive={occupe || !periodeOk} onPress={() => (confirmer === 'periode' ? supprimer({ du: filtres.du!.length === 10 ? `${filtres.du}T00:00:00` : filtres.du!, au: filtres.au!.length === 10 ? `${filtres.au}T23:59:59.999` : filtres.au! }) : setConfirmer('periode'))} testID="historique-supprimer-periode" />
            <BoutonHub theme={theme} variante="danger" titre={confirmer === 'tout' ? 'Confirmer : tout supprimer' : 'Tout supprimer…'} desactive={occupe || (local?.entrees?.length ?? 0) === 0} onPress={() => (confirmer === 'tout' ? supprimer({ tout: true }) : setConfirmer('tout'))} testID="historique-supprimer-tout" />
          </>
        ) : service ? (
          <BoutonHub theme={theme} titre="Actualiser" desactive={occupe} onPress={() => void agir(async () => (await lireDistant(), undefined))} testID="historique-actualiser-relais" />
        ) : null}
      </View>
      {message ? <Text testID="historique-message" style={[styles.texte, sm.texte, texte]}>{message}</Text> : null}

      {choisie ? (
        <View testID="historique-detail" style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.accent, borderRadius: theme.rayonMoyen }]}>
          <Text style={[styles.titreCarte, texte]}>{LIBELLES_TYPES[choisie.type] ?? choisie.type} · {new Date(choisie.ts).toLocaleString('fr-FR')}</Text>
          <Text selectable style={[styles.code, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]} testID="historique-detail-texte">{texteComplet(choisie)}</Text>
          <View style={styles.boutons}>
            <BoutonHub theme={theme} titre="Copier" onPress={() => void copier(choisie)} testID="historique-copier" />
            <BoutonHub theme={theme} titre="Fermer" onPress={() => setSelection(undefined)} testID="historique-fermer" />
            {pont && surCePc(choisie) ? (
              <BoutonHub theme={theme} variante="danger" titre={confirmer === choisie.id ? 'Confirmer la suppression' : 'Supprimer cette entrée…'} desactive={occupe} onPress={() => (confirmer === choisie.id ? supprimer({ ids: [choisie.id] }) : setConfirmer(choisie.id))} testID="historique-supprimer-entree" />
            ) : null}
          </View>
        </View>
      ) : null}

      {filtrees.length === 0 ? (
        <Text style={[styles.texte, sm.texte, attenue]} testID="historique-vide">
          {toutes.length === 0 ? (pont ? 'Aucune requête enregistrée pour l’instant. Installez le hook d’historique ci-dessous, puis redémarrez Claude Code.' : 'Aucune entrée à afficher.') : 'Aucune entrée ne correspond à ces filtres.'}
        </Text>
      ) : null}
      {groupes.map(g => (
        <View key={g.jour} style={styles.colonne}>
          <Text style={[styles.jour, { color: theme.texte }, police(theme.policeTitre)]}>{libelleJour(g.jour)}</Text>
          {g.sessions.map(s => (
            <View key={`${s.appareil}|${s.session}`} style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
              <Text style={[styles.petit, sm.texte, attenue]}>
                {s.projet ?? 'Projet inconnu'} · {s.appareil ?? 'appareil ?'} · session {s.session.slice(0, 8)}
              </Text>
              <NoteSession theme={theme} session={s.session} projet={s.projet} compact />
              {s.entrees.map(e => (
                <Pressable key={e.id} onPress={() => setSelection(e.id)} testID={`historique-entree-${e.id}`} style={[styles.entree, sm.entree]}>
                  <Text style={[styles.heure, sm.texte, attenue]}>{heure(e.ts)}</Text>
                  <Text style={[styles.type, sm.texte, { color: e.type === 'demande' ? theme.accent : e.echec ? theme.critique : theme.attenue }]}>{e.type === 'demande' ? '›' : e.type === 'outil' ? '⚙' : '·'}</Text>
                  <Text numberOfLines={2} style={[styles.texteEntree, sm.texte, { color: e.type === 'demande' ? theme.texte : theme.attenue }]}>{titreEntree(e)}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ))}
      {filtrees.length > visibles.length ? (
        <BoutonHub theme={theme} titre={`Afficher plus (${filtrees.length - visibles.length} plus anciennes)`} onPress={() => setAffiches(n => n + PAR_PAGE)} testID="historique-plus" />
      ) : null}

      {pont ? (
        <View style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]} testID="historique-reglages">
          <Text style={[styles.titreCarte, texte]}>Enregistrement sur ce PC</Text>
          {local?.dossier ? <Text selectable style={[styles.petit, sm.texte, attenue]}>Journal : {local.dossier}</Text> : null}
          <Interrupteur theme={theme} libelle="Enregistrer les requêtes" valeur={reglages?.actif ?? true} desactive={occupe || !reglages} onChange={v => changerReglage({ actif: v })} testID="reglage-actif" />
          <Interrupteur theme={theme} libelle="Enregistrer aussi le contenu des outils" aide="Désactivé par défaut : seuls la demande et un résumé court (outil, fichier, début de commande) sont gardés, jamais les sorties brutes." valeur={reglages?.enregistrerSorties ?? false} desactive={occupe || !reglages} onChange={v => changerReglage({ enregistrerSorties: v })} testID="reglage-sorties" />
          <Interrupteur theme={theme} libelle="Masquer les secrets reconnus" aide="Clés d’API, jetons, mots de passe repérés par motifs, remplacés avant l’écriture." valeur={reglages?.masquerSecrets ?? true} desactive={occupe || !reglages} onChange={v => changerReglage({ masquerSecrets: v })} testID="reglage-secrets" />
          <Text style={[styles.texte, sm.texte, texte]} testID="historique-hook-etat">Hook d’historique : {etatHook ? LIBELLE_HOOK_HISTORIQUE[etatHook] : '…'}</Text>
          <View style={styles.boutons}>
            <BoutonHub theme={theme} titre="Voir ce qui sera modifié" desactive={occupe} onPress={() => agir(async () => {
              const r = await pont.apercuHooks(false);
              setPlan(r.plan);
              return r.ok ? undefined : r.erreur;
            })} testID="historique-hook-apercu" />
            <BoutonHub theme={theme} variante="plein" titre="Installer le hook…" desactive={occupe} onPress={() => agir(async () => {
              const r = await pont.installerHooks(false);
              if (r.plan) setPlan(r.plan);
              if (r.annule) return 'Annulé : rien n’a été modifié.';
              if (!r.ok) return r.erreur;
              return r.ecrit ? `Hook installé.${r.sauvegarde ? ` Sauvegarde : ${r.sauvegarde}.` : ''} Redémarrez Claude Code.` : 'Rien à faire : déjà installé.';
            })} testID="historique-hook-installer" />
            <BoutonHub theme={theme} variante="danger" titre="Retirer le hook…" desactive={occupe} onPress={() => agir(async () => {
              const r = await pont.installerHooks(true);
              if (r.annule) return 'Annulé : rien n’a été modifié.';
              if (!r.ok) return r.erreur;
              return r.ecrit ? 'Hook retiré : plus rien n’est enregistré.' : 'Aucun hook d’historique à retirer.';
            })} testID="historique-hook-retirer" />
            <BoutonHub theme={theme} titre="Importer un journal…" desactive={occupe} onPress={() => agir(async () => {
              const r = await pont.importer();
              if (r.annule) return undefined;
              return r.ok ? `${r.importees} entrée${(r.importees ?? 0) > 1 ? 's' : ''} importée${(r.importees ?? 0) > 1 ? 's' : ''} (doublons ignorés à l’affichage).` : r.erreur;
            })} testID="historique-importer" />
          </View>
          {plan ? <Text selectable style={[styles.code, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]} testID="historique-plan">{plan.description}</Text> : null}
        </View>
      ) : null}

      {service ? (
        <View style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]} testID="historique-synchro">
          <Text style={[styles.titreCarte, texte]}>Copie chiffrée sur le relais</Text>
          <Text style={[styles.petit, sm.texte, attenue]}>
            Pour consulter l’historique depuis le site, le téléphone ou un autre PC, même ce PC éteint. Chiffrée avec la clé de synchronisation (le relais ne voit que du bruit), réservée au compte principal ; déposée au plus toutes les 15 minutes, en une seule copie par appareil.
          </Text>
          {pont ? (
            <Interrupteur theme={theme} libelle="Déposer la copie de ce PC" valeur={synchro.active} onChange={basculerSynchro} testID="historique-synchro-active" />
          ) : null}
          <Text style={[styles.petit, sm.texte, attenue]} testID="historique-synchro-derniere">
            {pont ? `Dernier dépôt : ${synchro.derniere ? new Date(synchro.derniere).toLocaleString('fr-FR') : 'jamais'}${synchro.erreur ? ` · erreur : ${synchro.erreur}` : ''}` : ''}
            {distant ? `${pont ? '\n' : ''}Copies lues sur le relais : ${distant.copies.length ? distant.copies.map(c => `${c.appareil ?? c.objet} (${c.entrees}, ${new Date(c.date).toLocaleString('fr-FR')})`).join(' ; ') : 'aucune'}` : ''}
          </Text>
          {distant?.erreurs.length ? <Text style={[styles.petit, sm.texte, { color: theme.critique }]}>{distant.erreurs.join('\n')}</Text> : null}
          {pont ? <BoutonHub theme={theme} titre="Synchroniser maintenant" desactive={occupe || !synchro.active} onPress={synchroniserMaintenant} testID="historique-synchroniser" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const stylesMobileBrut = {
  texte: { fontSize: 15, lineHeight: 21 },
  champ: { fontSize: 17, minHeight: 48 },
  entree: { minHeight: 44, paddingVertical: 8 },
} as const;
const stylesMobile = StyleSheet.create(stylesMobileBrut);

const styles = StyleSheet.create({
  colonne: { gap: 10 },
  avertissement: { borderWidth: 1, padding: 12, gap: 6 },
  texte: { fontSize: 14, lineHeight: 20 },
  petit: { fontSize: 12, lineHeight: 17 },
  compteurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  compteur: { borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, paddingHorizontal: 10, minWidth: 84 },
  nombre: { fontSize: 18, fontWeight: '700' },
  champ: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  date: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 16, width: 160, minHeight: 44 },
  rangee: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  libelle: { fontSize: 13, minWidth: 64 },
  puce: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  carte: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  titreCarte: { fontSize: 17, fontWeight: '700' },
  jour: { fontSize: 17, fontWeight: '700', marginTop: 6, textTransform: 'capitalize' },
  entree: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 3 },
  heure: { fontSize: 15, width: 76, fontVariant: ['tabular-nums'] },
  type: { fontSize: 13, width: 14, textAlign: 'center' },
  texteEntree: { fontSize: 13, flex: 1, lineHeight: 18 },
  code: { fontFamily: 'monospace', fontSize: 15, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: 10 },
});

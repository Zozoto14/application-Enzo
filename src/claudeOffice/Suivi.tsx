/**
 * Claude Office v4 : onglet « Suivi » — Récap (jour, semaine, exports), Alertes
 * (réglages et journal), Équipe (personnalisation des agents) et Notes de
 * session (recherche). Tout est calculé et rangé sur l'appareil ; l'écran
 * garde la sobriété du Bureau (une section à la fois). Aide des raccourcis
 * clavier : `AideRaccourcis` (touche « ? »).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { police, type ThemeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { FeuilleBasse } from '../ui/mobile/FeuilleBasse';
import { useMobile } from '../ui/mobile/useMobile';
import type { AlertesOffice } from './alertesOffice';
import { entreesDemoSuivi } from './demoSuivi';
import { EcranEquipe } from './EcranEquipe';
import { chercherNotes, notesCourantes, useMagasinSuivi } from './equipe';
import { deduireBureau, ilYA, masquerAffichage } from './logiqueBureau';
import { DEFINITIONS, REGLES, libellePastille, type RegleAlerte } from './logiqueAlertes';
import { fusionner, type EntreeHistorique } from './logiqueHistorique';
import { calculerRecap, exporterRecapJson, exporterRecapMarkdown, exporterRecapTexte, faitsMarquants, phraseRecap, titreRecap, type PeriodeRecap } from './logiqueRecap';
import { entreesDemo } from './logiqueScene';
import { entreesDemoSousAgents } from './logiqueSousAgents';
import { historiqueDemo } from './logiqueStats';
import type { FiltreHistorique } from './Bureau';
import { NoteSession } from './NoteSession';
import type { PontClaudeOffice } from './pont';
import { RACCOURCIS } from './raccourcis';
import { useHistoriqueComplet } from './Statistiques';
import { Bouton, Carte, copierTexte, Interrupteur, Puce, Segments, TAILLE } from './uiOffice';

export type SectionSuivi = 'recap' | 'alertes' | 'equipe' | 'notes';

// ------------------------------------------------------------------ récap

function CarteRecap({ theme, entrees, maintenant, enregistrer, demo }: {
  theme: ThemeHub; entrees: readonly EntreeHistorique[]; maintenant: number; demo: boolean;
  enregistrer?(nom: string, contenu: string, type: string): Promise<boolean>;
}) {
  const [periode, setPeriode] = useState<PeriodeRecap>('jour');
  const [message, setMessage] = useState<string>();
  const [texteVisible, setTexteVisible] = useState<string>();
  const minute = Math.floor(maintenant / 60_000);
  const r = useMemo(() => calculerRecap(entrees, maintenant, periode), [entrees, periode, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = { color: theme.texte, fontSize: TAILLE, lineHeight: 22, ...police(theme.policeTexte) };
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };
  const copier = async (format: 'texte' | 'markdown' | 'json') => {
    const contenu = format === 'json' ? exporterRecapJson(r) : format === 'markdown' ? exporterRecapMarkdown(r) : exporterRecapTexte(r);
    const ok = await copierTexte(contenu);
    setTexteVisible(ok ? undefined : contenu);
    setMessage(ok ? `Récap copié (${format === 'texte' ? 'texte' : format === 'markdown' ? 'Markdown' : 'JSON'}) ✓` : 'Copie impossible ici : sélectionne le texte ci-dessous.');
  };
  const faits = faitsMarquants(r);
  return (
    <Carte theme={theme} titre={titreRecap(r)} testID="suivi-recap">
      <Segments<PeriodeRecap> theme={theme} libelle="Période du récap" valeurs={[['jour', 'Aujourd’hui'], ['semaine', '7 jours']] as const} valeur={periode} onChange={setPeriode} testID="recap-periode" />
      <Text style={[t, { fontWeight: '700' }]} testID="recap-phrase">{phraseRecap(r)}{demo ? ' (démo)' : ''}</Text>
      {r.sessions ? (
        <>
          <View style={styles.chiffres}>
            {([['Sessions', r.sessions], ['Demandes', r.demandes], ['Outils', r.outils], ['Erreurs', r.erreurs.total]] as const).map(([l, v]) => (
              <View key={l} style={[styles.chiffre, { borderColor: theme.ligne }]} accessible accessibilityLabel={`${l} : ${v}`}>
                <Text style={{ color: theme.texte, fontSize: 20, fontWeight: '700' }} testID={`recap-${l.toLowerCase()}`}>{v}</Text>
                <Text style={a}>{l}</Text>
              </View>
            ))}
          </View>
          <Text style={t} testID="recap-projets"><Text style={{ fontWeight: '700' }}>Projets : </Text>{r.projets.map(p => `${p.nom} (${p.demandes})`).join(', ')}</Text>
          {r.outilsTop.length ? <Text style={t} testID="recap-outils"><Text style={{ fontWeight: '700' }}>Outils : </Text>{r.outilsTop.map(o => `${o.nom} ×${o.n}`).join(', ')}</Text> : null}
          {faits.length ? (
            <View style={{ gap: 4 }} testID="recap-faits">
              <Text style={[t, { fontWeight: '700' }]} accessibilityRole="header">Faits marquants</Text>
              {faits.map(f => <Text key={f} style={t}>• {f}</Text>)}
            </View>
          ) : null}
        </>
      ) : null}
      <View style={styles.boutons}>
        <Bouton theme={theme} variante="plein" titre="Copier le récap" onPress={() => void copier('texte')} testID="recap-copier-texte" />
        <Bouton theme={theme} titre="Markdown" libelle="Copier le récap en Markdown" onPress={() => void copier('markdown')} testID="recap-copier-markdown" />
        <Bouton theme={theme} titre="JSON" libelle="Copier le récap en JSON" onPress={() => void copier('json')} testID="recap-copier-json" />
        {enregistrer ? (
          <Bouton theme={theme} titre="Enregistrer (.md)…" onPress={() => void enregistrer(`claude-office-recap-${r.au.slice(0, 10)}.md`, exporterRecapMarkdown(r), 'text/markdown').then(ok => setMessage(ok ? 'Récap enregistré ✓' : 'Enregistrement annulé.'))} testID="recap-enregistrer" />
        ) : null}
      </View>
      {message ? <Text style={a} testID="recap-message" accessibilityLiveRegion="polite">{message}</Text> : null}
      {texteVisible ? <Text selectable style={[styles.code, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]} testID="recap-texte">{texteVisible}</Text> : null}
      <Text style={a}>Secrets reconnus masqués ; aucun contenu d’outil dans le récap.</Text>
    </Carte>
  );
}

// ------------------------------------------------------------------ alertes

function EcranAlertes({ theme, alertes, surPc, maintenant, onVoirHistorique }: {
  theme: ThemeHub; alertes: AlertesOffice; surPc: boolean; maintenant: number; onVoirHistorique?(f: FiltreHistorique): void;
}) {
  const { reglages } = alertes;
  const [ouverte, setOuverte] = useState<RegleAlerte>();
  // Ouvrir le journal le marque comme lu (la pastille disparaît) ; les nouvelles restent signalées en gras jusque-là.
  const nonLuesAvant = useMemo(() => new Set(alertes.journal.filter(x => !x.lue).map(x => x.id)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (alertes.nonLues || alertes.journal.some(x => !x.lue)) alertes.toutLu();
  }, [alertes.journal.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 21 };
  const t = { color: theme.texte, fontSize: TAILLE, lineHeight: 22 };
  const changer = (r: RegleAlerte, c: Partial<typeof reglages[RegleAlerte]>) => alertes.changerReglages({ ...reglages, [r]: { ...reglages[r], ...c } });
  return (
    <View style={styles.colonne} testID="suivi-alertes">
      <Carte theme={theme} titre="Journal des alertes">
        {alertes.journal.length === 0 ? <Text style={a} testID="alertes-vide">Aucune alerte pour l’instant.</Text> : null}
        <View style={{ gap: 8 }} testID="alertes-journal">
          {alertes.journal.slice(0, 50).map(x => (
            <View key={x.id} style={[styles.alerte, { borderColor: nonLuesAvant.has(x.id) ? theme.alerte : theme.ligne }]} testID={`alerte-${x.regle}`}>
              <Text style={[t, { fontWeight: nonLuesAvant.has(x.id) ? '700' : '600' }]}>{x.demo ? '◆ ' : ''}{x.titre}</Text>
              {x.detail ? <Text style={a} numberOfLines={2}>{masquerAffichage(x.detail)}</Text> : null}
              <View style={styles.ligneAlerte}>
                <Text style={[a, { flex: 1 }]}>{DEFINITIONS[x.regle].titre} · {ilYA(Date.parse(x.ts), maintenant)}</Text>
                {onVoirHistorique && !x.demo ? <Bouton theme={theme} variante="discret" compact titre="Voir la session" onPress={() => onVoirHistorique({ session: x.session })} testID={`alerte-voir-${x.regle}`} /> : null}
              </View>
            </View>
          ))}
        </View>
        {alertes.journal.length ? <Bouton theme={theme} variante="danger" titre="Vider le journal" onPress={alertes.vider} testID="alertes-vider" /> : null}
      </Carte>
      <Carte theme={theme} titre="Règles">
        <Text style={a}>Calculées sur cet appareil à partir de l’activité lue ici ; réglages propres à l’appareil.{surPc ? '' : ' Notification du système : sur le PC seulement (application de bureau ouverte).'}</Text>
        {REGLES.map(r => {
          const d = DEFINITIONS[r];
          const g = reglages[r];
          return (
            <View key={r} style={[styles.regle, { borderColor: theme.ligne }]} testID={`alertes-regle-${r}`}>
              <Interrupteur theme={theme} libelle={d.titre} aide={d.aide(g.seuil)} valeur={g.active} onChange={v => changer(r, { active: v })} testID={`alertes-active-${r}`} />
              {g.active ? (
                <>
                  <Bouton theme={theme} variante="discret" compact titre={ouverte === r ? 'Masquer les réglages' : 'Régler…'} onPress={() => setOuverte(o => (o === r ? undefined : r))} testID={`alertes-regler-${r}`} />
                  {ouverte === r ? (
                    <View style={{ gap: 8 }}>
                      <Text style={t}>Seuil</Text>
                      <View style={styles.boutons}>
                        {d.seuils.map(s => (
                          <Puce key={s} theme={theme} titre={r === 'fini' && s === 0 ? 'Toutes' : `${s} ${d.unite}`} actif={g.seuil === s} onPress={() => changer(r, { seuil: s })} testID={`alertes-seuil-${r}-${s}`} />
                        ))}
                      </View>
                      <Interrupteur theme={theme} libelle="Pastille (onglet et tuile du hub)" valeur={g.badge} onChange={v => changer(r, { badge: v })} testID={`alertes-badge-${r}`} />
                      {surPc ? <Interrupteur theme={theme} libelle="Notification de Windows" aide="Une seule fois par occurrence, tant que l’application est ouverte." valeur={g.notifier} onChange={v => changer(r, { notifier: v })} testID={`alertes-notifier-${r}`} /> : null}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
        <Text style={a}>Anti-répétition : une alerte par occurrence, et au plus une par règle et par session toutes les 10 min ; un fait ancien (rouverture de l’écran) ne déclenche rien.</Text>
      </Carte>
    </View>
  );
}

// ------------------------------------------------------------------ notes

function EcranNotes({ theme, onVoirHistorique }: { theme: ThemeHub; onVoirHistorique?(f: FiltreHistorique): void }) {
  useMagasinSuivi();
  const [recherche, setRecherche] = useState('');
  const notes = chercherNotes(notesCourantes(), recherche);
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 21 };
  return (
    <Carte theme={theme} titre="Notes de session" testID="suivi-notes">
      <Text style={a}>Ajoute une note depuis le détail d’un agent ou l’Historique. Gardées sur cet appareil.</Text>
      <TextInput
        value={recherche}
        onChangeText={setRecherche}
        placeholder="Rechercher dans les notes…"
        placeholderTextColor={theme.attenue}
        accessibilityLabel="Rechercher dans les notes"
        inputMode="search"
        style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]}
        testID="suivi-notes-recherche"
      />
      {notes.length === 0 ? <Text style={a} testID="notes-vide">{recherche ? 'Aucune note ne correspond.' : 'Aucune note pour l’instant.'}</Text> : null}
      {notes.map(n => (
        <View key={n.session} style={[styles.alerte, { borderColor: theme.ligne }]} testID={`notes-ligne-${n.session.slice(0, 12)}`}>
          <Text style={a}>{masquerAffichage(n.projet ?? 'Projet inconnu')} · session {n.session.slice(0, 8)} · {new Date(n.maj).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
          <NoteSession theme={theme} session={n.session} projet={n.projet} />
          {onVoirHistorique ? <Bouton theme={theme} variante="discret" compact titre="Voir dans l’Historique" onPress={() => onVoirHistorique({ session: n.session })} testID={`notes-voir-${n.session.slice(0, 12)}`} /> : null}
        </View>
      ))}
    </Carte>
  );
}

// ------------------------------------------------------------------ aide des raccourcis

export function AideRaccourcis({ theme, visible, onFermer }: { theme: ThemeHub; visible: boolean; onFermer(): void }) {
  const t = { color: theme.texte, fontSize: TAILLE, lineHeight: 22 };
  return (
    <FeuilleBasse theme={theme} visible={visible} titre="Raccourcis clavier" description="Sur le PC ou un iPad avec clavier. Inactifs pendant la saisie dans un champ." onFermer={onFermer} testID="raccourcis-aide">
      <View accessibilityRole="list" style={{ gap: 6 }}>
        {RACCOURCIS.map(r => (
          <View key={r.action} style={styles.raccourci} accessibilityRole="text" accessibilityLabel={`${r.touches.join(' ou ')} : ${r.description}`}>
            <View style={[styles.touche, { borderColor: theme.ligne, backgroundColor: theme.fond }]}><Text style={[t, { fontWeight: '700', fontFamily: 'monospace' }]}>{r.touches.join(' ')}</Text></View>
            <Text style={[t, { flex: 1 }]}>{r.description}</Text>
          </View>
        ))}
      </View>
    </FeuilleBasse>
  );
}

// ------------------------------------------------------------------ onglet

export function Suivi({ theme, contexte, office, debutDemo, alertes, maintenant, activite, section: sectionInitiale, onVoirHistorique, onAideRaccourcis }: {
  theme: ThemeHub; contexte: ContexteHub; office?: PontClaudeOffice; debutDemo?: number; alertes: AlertesOffice; maintenant: number;
  /** Activité récente (agents en cours, pour personnaliser une session). */
  activite: { entrees: readonly EntreeHistorique[]; references: Record<string, number> };
  section?: SectionSuivi;
  onVoirHistorique?(f: FiltreHistorique): void;
  onAideRaccourcis?(): void;
}) {
  const demo = debutDemo !== undefined;
  const mobile = useMobile();
  const [section, setSection] = useState<SectionSuivi>(sectionInitiale ?? 'recap');
  const reel = useHistoriqueComplet(office, contexte, !demo);
  const minute = Math.floor(maintenant / 60_000);
  const entrees = useMemo(
    () => (demo ? fusionner(historiqueDemo(maintenant), entreesDemo(debutDemo!, maintenant), entreesDemoSuivi(debutDemo!), entreesDemoSousAgents(debutDemo!, maintenant)) : fusionner(reel.entrees, activite.entrees)),
    [demo, debutDemo, reel.entrees, activite.entrees, minute], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const agents = useMemo(
    () => deduireBureau(demo ? fusionner(entreesDemo(debutDemo!, maintenant), entreesDemoSuivi(debutDemo!), entreesDemoSousAgents(debutDemo!, maintenant)) : activite.entrees, { maintenant, references: demo ? {} : activite.references }).agents,
    [demo, debutDemo, activite, minute], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const projets = useMemo(() => {
    const depuis = maintenant - 30 * 86_400_000;
    return [...new Set(entrees.filter(e => e.projet && Date.parse(e.ts) >= depuis).map(e => e.projet!))];
  }, [entrees]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = { color: theme.attenue, fontSize: TAILLE, lineHeight: 22 };
  return (
    <View style={styles.colonne} testID="suivi">
      <Segments<SectionSuivi>
        theme={theme}
        libelle="Section du suivi"
        valeurs={[['recap', 'Récap'], ['alertes', alertes.nonLues ? `Alertes · ${libellePastille(alertes.nonLues)}` : 'Alertes'], ['equipe', 'Équipe'], ['notes', 'Notes']] as const}
        valeur={section}
        onChange={setSection}
        testID="suivi-section"
      />
      {demo ? <Text style={[a, { color: theme.sombre ? '#F4A261' : '#9A4A12', fontWeight: '700' }]} testID="suivi-demo">◆ Démo : données fictives, rien n’est enregistré</Text> : null}
      {section === 'recap' ? (
        !demo && !reel.lu ? <Text style={a} testID="recap-chargement">Lecture de l’historique…</Text> : <CarteRecap theme={theme} entrees={entrees} maintenant={maintenant} demo={demo} enregistrer={demo ? undefined : contexte.enregistrerFichier} />
      ) : section === 'alertes' ? (
        <EcranAlertes theme={theme} alertes={alertes} surPc={Boolean(office?.historique) && !demo} maintenant={maintenant} onVoirHistorique={onVoirHistorique} />
      ) : section === 'equipe' ? (
        <EcranEquipe theme={theme} projets={projets} agents={agents} />
      ) : (
        <EcranNotes theme={theme} onVoirHistorique={demo ? undefined : onVoirHistorique} />
      )}
      {!mobile && onAideRaccourcis ? <Bouton theme={theme} variante="discret" titre="Raccourcis clavier (?)" onPress={onAideRaccourcis} testID="suivi-raccourcis" style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  colonne: { gap: 12 },
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chiffres: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chiffre: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 80, flexGrow: 1, flexBasis: 80 },
  code: { fontFamily: 'monospace', fontSize: TAILLE, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 10 },
  alerte: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  ligneAlerte: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  regle: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 4 },
  champ: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  raccourci: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  touche: { minWidth: 64, borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' },
});

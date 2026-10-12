/**
 * Claude Office, app du hub : écran racine.
 *
 * Onglet « Bureau » (par défaut, partout : PC, site, téléphone) : le bureau
 * des agents dessiné dans le hub (`Bureau.tsx`), sans serveur ni rien à
 * installer sur l'appareil qui regarde. Onglet « Historique » : le journal des
 * requêtes. Sur le PC seulement, en option avancée : le vrai Claude Office
 * (licence MIT, W17ANT) — serveur local ouvert dans une fenêtre à part, et ses
 * hooks, toujours après un aperçu et une confirmation native. Voir
 * docs/claude-office.md.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BoutonHub, RetourHub } from '../hub/Hub';
import { police, type ThemeHub } from '../hub/themes';
import type { PropsRacineApp } from '../hub/types';
import { useMobile } from '../ui/mobile/useMobile';
import { OngletBureau, type FiltreHistorique } from './Bureau';
import { Historique } from './Historique';
import { Statistiques } from './Statistiques';
import {
  COMMANDE_APERCU, COMMANDE_DOSSIER, COMMANDE_HOOKS, LIBELLE_HOOKS, libelleServeur, pontClaudeOffice,
  type EtatClaudeOffice, type PlanHooks, type PontClaudeOffice,
} from './pont';

function Carte({ theme, titre, children, testID }: { theme: ThemeHub; titre: string; children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={[styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }]}>
      <Text style={[styles.titreCarte, { color: theme.texte }, police(theme.policeTitre)]}>{titre}</Text>
      {children}
    </View>
  );
}

function Code({ theme, children, testID }: { theme: ThemeHub; children: string; testID?: string }) {
  return (
    <Text testID={testID} selectable style={[styles.code, { color: theme.texte, backgroundColor: theme.fond, borderColor: theme.ligne }]}>
      {children}
    </Text>
  );
}

function Ligne({ theme, libelle, valeur, testID }: { theme: ThemeHub; libelle: string; valeur: string; testID?: string }) {
  return (
    <View style={styles.ligne}>
      <Text style={[styles.libelle, { color: theme.attenue }]}>{libelle}</Text>
      <Text testID={testID} selectable style={[styles.valeur, { color: theme.texte }]}>
        {valeur}
      </Text>
    </View>
  );
}

/** Commandes à lancer sur le PC (aussi montrées sur le PC, pour qui préfère le terminal). */
function Installation({ theme }: { theme: ThemeHub }) {
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  return (
    <Carte theme={theme} titre="Installer sur le PC" testID="claude-office-installation">
      <Text style={[styles.texte, texte]}>1. Placez Claude Office dans un dossier du PC (par exemple « Claude Office » dans ou à côté du dossier d’AppDashboard), puis lancez-y :</Text>
      <Code theme={theme}>npm ci</Code>
      <Text style={[styles.texte, texte]}>2. Depuis le dossier d’AppDashboard, regardez d’abord ce qui changera, puis installez les hooks (confirmation demandée, sauvegarde faite avant) :</Text>
      <Code theme={theme} testID="claude-office-commande-apercu">{COMMANDE_APERCU}</Code>
      <Code theme={theme} testID="claude-office-commande">{COMMANDE_HOOKS}</Code>
      <Text style={[styles.texte, { color: theme.attenue }]}>Dossier pas trouvé tout seul ? Donnez-le :</Text>
      <Code theme={theme}>{COMMANDE_DOSSIER}</Code>
      <Text style={[styles.texte, texte]}>3. Démarrez Claude Office dans son dossier (« npm run build » puis « npm run server », ou son raccourci « Claude Office.vbs »), puis redémarrez Claude Code : ses agents apparaissent dans le bureau.</Text>
    </Carte>
  );
}

function SurLePc({ theme, pont }: { theme: ThemeHub; pont: PontClaudeOffice }) {
  const [etat, setEtat] = useState<EtatClaudeOffice>();
  const [message, setMessage] = useState<string>();
  const [plan, setPlan] = useState<PlanHooks>();
  const [url, setUrl] = useState('');
  const [occupe, setOccupe] = useState(false);

  const actualiser = useCallback(async () => {
    try {
      const nouveau = await pont.etat();
      setEtat(nouveau);
      setUrl(nouveau.url);
    } catch (erreur) {
      setMessage((erreur as Error).message);
    }
  }, [pont]);

  useEffect(() => {
    // Lecture seule à l'ouverture : rien n'est installé ni lancé sans un clic.
    void actualiser();
  }, [actualiser]);

  const agir = async (action: () => Promise<string | undefined>) => {
    setOccupe(true);
    try {
      setMessage(await action());
    } catch (erreur) {
      setMessage((erreur as Error).message);
    } finally {
      setOccupe(false);
      await actualiser();
    }
  };

  const voirPlan = (desinstaller: boolean) =>
    agir(async () => {
      const r = await pont.apercuHooks(desinstaller);
      setPlan(r.plan);
      return r.ok ? undefined : r.erreur;
    });

  const installer = (desinstaller: boolean) =>
    agir(async () => {
      const r = await pont.installerHooks(desinstaller);
      if (r.plan) setPlan(r.plan);
      if (r.annule) return 'Annulé : rien n’a été modifié.';
      if (!r.ok) return r.erreur;
      if (!r.ecrit) return 'Rien à faire : déjà dans cet état.';
      return `${desinstaller ? 'Hooks retirés' : 'Hooks installés'}. ${r.sauvegarde ? `Sauvegarde : ${r.sauvegarde}. ` : ''}Redémarrez Claude Code pour qu’il les lise.`;
    });

  const joignable = etat?.serveur.joignable === true;
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  return (
    <>
      <Carte theme={theme} titre="Serveur local" testID="claude-office-serveur">
        <Text testID="claude-office-etat" style={[styles.etat, { color: joignable ? theme.ok : theme.alerte }]}>
          {etat ? `${joignable ? '●' : '○'} ${libelleServeur(etat.serveur)}` : 'Vérification…'}
        </Text>
        <View style={styles.ligne}>
          <Text style={[styles.libelle, { color: theme.attenue }]}>Adresse</Text>
          <TextInput
            testID="claude-office-url"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.champ, { color: theme.texte, borderColor: theme.ligne, backgroundColor: theme.fond }]}
          />
        </View>
        <View style={styles.boutons}>
          <BoutonHub theme={theme} variante="plein" titre="Ouvrir Claude Office" desactive={!joignable || occupe} onPress={() => agir(async () => {
            await pont.ouvrir();
            return undefined;
          })} testID="claude-office-ouvrir" />
          <BoutonHub theme={theme} titre="Actualiser" desactive={occupe} onPress={() => void actualiser()} testID="claude-office-actualiser" />
          <BoutonHub
            theme={theme}
            titre="Enregistrer l’adresse"
            desactive={occupe || url === etat?.url}
            onPress={() => agir(async () => {
              const r = await pont.reglerUrl(url);
              return r.ok ? 'Adresse enregistrée.' : r.erreur;
            })}
            testID="claude-office-url-enregistrer"
          />
        </View>
        <Ligne theme={theme} libelle="Dossier" valeur={etat?.dossier ?? 'Introuvable : choisissez-le'} testID="claude-office-dossier" />
        <View style={styles.boutons}>
          <BoutonHub
            theme={theme}
            titre="Choisir le dossier…"
            desactive={occupe}
            onPress={() => agir(async () => {
              const r = await pont.choisirDossier();
              return r.ok ? `Dossier : ${r.dossier}` : r.erreur;
            })}
            testID="claude-office-choisir-dossier"
          />
        </View>
      </Carte>

      <Carte theme={theme} titre="Hooks de Claude Code" testID="claude-office-hooks">
        <Text style={[styles.texte, texte]}>
          Les hooks font envoyer à Claude Code chaque demande et chaque outil utilisé à Claude Office (sur ce PC seulement). Ils sont ajoutés aux réglages de Claude Code : voyez d’abord exactement ce qui change, puis confirmez.
        </Text>
        <Ligne theme={theme} libelle="État" valeur={etat ? LIBELLE_HOOKS[etat.hooks] : '…'} testID="claude-office-hooks-etat" />
        <View style={styles.boutons}>
          <BoutonHub theme={theme} titre="Voir ce qui sera modifié" desactive={occupe} onPress={() => voirPlan(false)} testID="claude-office-apercu" />
          <BoutonHub theme={theme} variante="plein" titre="Installer les hooks…" desactive={occupe || !etat?.dossier} onPress={() => installer(false)} testID="claude-office-installer" />
          <BoutonHub theme={theme} variante="danger" titre="Retirer les hooks…" desactive={occupe || etat?.hooks !== 'installes'} onPress={() => installer(true)} testID="claude-office-retirer" />
        </View>
        {plan ? <Code theme={theme} testID="claude-office-plan">{plan.description}</Code> : null}
      </Carte>
      {message ? (
        <Text testID="claude-office-message" style={[styles.texte, texte]}>
          {message}
        </Text>
      ) : null}
    </>
  );
}

type Onglet = 'bureau' | 'historique' | 'stats';

/** Onglets de l'écran : le bureau des agents, l'historique des requêtes, les statistiques. */
function Onglets({ theme, onglet, onChange }: { theme: ThemeHub; onglet: Onglet; onChange(o: Onglet): void }) {
  return (
    <View style={styles.onglets} accessibilityRole="tablist">
      {([['bureau', 'Bureau'], ['historique', 'Historique'], ['stats', 'Statistiques']] as const).map(([id, titre]) => (
        <Pressable
          key={id}
          accessibilityRole="tab"
          accessibilityState={{ selected: onglet === id }}
          onPress={() => onChange(id)}
          testID={`claude-office-onglet-${id}`}
          style={[styles.onglet, { borderColor: onglet === id ? theme.accent : theme.ligne, backgroundColor: onglet === id ? theme.accent : theme.surface }]}
        >
          <Text numberOfLines={1} style={{ color: onglet === id ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 16 }}>{titre}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Sur le PC : le vrai Claude Office (serveur local, fenêtre à part, ses hooks), replié par défaut. */
function Avance({ theme, pont }: { theme: ThemeHub; pont: PontClaudeOffice }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <View style={{ gap: 14 }} testID="claude-office-avance">
      <BoutonHub
        theme={theme}
        titre={ouvert ? 'Masquer les options avancées' : 'Options avancées : Claude Office complet en fenêtre à part…'}
        onPress={() => setOuvert(o => !o)}
        testID="claude-office-avance-basculer"
      />
      {ouvert ? (
        <>
          <Text style={[styles.texte, { color: theme.attenue }, police(theme.policeTexte)]}>
            Le bureau ci-dessus suffit au quotidien. Si vous avez aussi installé le vrai Claude Office (serveur local avec ses sprites, son fil de discussion), vous pouvez l’ouvrir ici dans une fenêtre à part.
          </Text>
          <SurLePc theme={theme} pont={pont} />
          <Installation theme={theme} />
        </>
      ) : null}
    </View>
  );
}

export function ClaudeOffice({ theme, onRetour, contexte }: PropsRacineApp) {
  const pont = pontClaudeOffice();
  const mobile = useMobile();
  const [onglet, setOnglet] = useState<Onglet>('bureau');
  const [filtreHistorique, setFiltreHistorique] = useState<FiltreHistorique>();
  // Démo partagée par les trois onglets (sessions fictives, historique fictif) : rien de réel n'est lu ni écrit.
  const [debutDemo, setDebutDemo] = useState<number>();
  const defilement = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const changerOnglet = (o: Onglet) => {
    setOnglet(o);
    if (o !== 'historique') setFiltreHistorique(undefined);
  };
  const voirHistorique = (f: FiltreHistorique) => {
    setFiltreHistorique({ ...f });
    setOnglet('historique');
    defilement.current?.scrollTo?.({ y: 0, animated: false });
  };
  return (
    <ScrollView ref={defilement} style={{ flex: 1, backgroundColor: theme.fond }} contentContainerStyle={[styles.page, mobile ? styles.pageMobile : null]}>
      <RetourHub theme={theme} onRetour={onRetour} titre="Claude Office" />
      <Text style={[styles.titre, { color: theme.texte, fontWeight: theme.poidsTitre }, police(theme.policeTitre)]}>Claude Office</Text>
      <Text style={[styles.texte, styles.texteMobile, { color: theme.attenue }, police(theme.policeTexte)]}>
        {mobile
          ? 'Un personnage par session de Claude Code, dans la zone de ce qu’il fait.'
          : 'Le bureau des agents de Claude Code : un personnage par session, qui va dans la zone de ce qu’il fait (code, commandes, lecture, web…), lève la main quand Claude attend ta réponse et passe en salle d’attente quand il a fini — ici même, sur le PC, le site ou le téléphone.'}
      </Text>
      <Onglets theme={theme} onglet={onglet} onChange={changerOnglet} />
      {onglet === 'historique' ? (
        <Historique key={JSON.stringify(filtreHistorique ?? {})} theme={theme} contexte={contexte} office={pont} filtreInitial={filtreHistorique} debutDemo={debutDemo} />
      ) : onglet === 'stats' ? (
        <Statistiques theme={theme} contexte={contexte} office={pont} debutDemo={debutDemo} />
      ) : (
        <>
          <OngletBureau theme={theme} contexte={contexte} office={pont} debutDemo={debutDemo} onDemo={a => setDebutDemo(a ? Date.now() : undefined)} onVoirHistorique={voirHistorique} />
          {pont ? <Avance theme={theme} pont={pont} /> : null}
        </>
      )}
      <Text style={[styles.credit, styles.texteMobile, { color: theme.attenue }]}>D’après Claude Office, © 2026 W17ANT, licence MIT.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14, maxWidth: 980, width: '100%', alignSelf: 'center' },
  pageMobile: { padding: 16 },
  texteMobile: { fontSize: 15, lineHeight: 21 },
  titre: { fontSize: 26 },
  texte: { fontSize: 14, lineHeight: 20 },
  carte: { borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  titreCarte: { fontSize: 16, fontWeight: '700' },
  etat: { fontSize: 15, fontWeight: '600' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  libelle: { fontSize: 13, minWidth: 64 },
  valeur: { fontSize: 13, flexShrink: 1 },
  champ: { flex: 1, minWidth: 200, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14 },
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  code: { fontFamily: 'monospace', fontSize: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: 10 },
  credit: { fontSize: 15, marginTop: 6 },
  onglets: { flexDirection: 'row', gap: 6 },
  onglet: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', flexGrow: 1, flexShrink: 1, maxWidth: 200 },
});

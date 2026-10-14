/**
 * Paramètres › Tâches (page Paramètres du hub) : les MÊMES réglages que dans
 * l'app (mêmes fenêtres, même stockage — aucune seconde source de vérité).
 *
 *  - `ReglagesTachesPerso` : pour tout compte qui a Tâches — vue d'ouverture
 *    de cet appareil, SES notifications, son relevé du temps ;
 *  - `ReglagesTachesFondateur` : le Fondateur seul — membres et droits, liens
 *    avec les autres apps, IA et GitHub, corbeille.
 *
 * Un lien « Ouvrir dans Tâches » mène à l'app ; de l'app, 👥 › « Paramètres ›
 * Tâches » ramène ici.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThemeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import { useMobile } from '../../ui/mobile';
import { droitsProjet } from '../acces';
import { effacerElement, restaurerElement, viderCorbeille } from '../corbeille';
import { CLES_TACHES } from '../partage';
import { appareilTaches, notificationSystemeDisponible, reinitialiserLiens, testerNotification, verifierRappels } from '../resume';
import type { Actions } from './actions';
import { useAidesV3 } from './aides';
import { attenueDe, Bouton, Options } from './atomes';
import { useEtatTaches } from './etat';
import { DialogueAides } from './IA';
import { DialogueMembres } from './Membres';
import { LIBELLES_OUVERTURE, type Ouverture } from './ouverture';
import { DialogueLiens, DialogueNotifications } from './ReglagesV2';
import { DialogueReleve } from './SuiviTemps';
import { DialogueCorbeille } from './Suppression';

type Fenetre = 'notifications' | 'releve' | 'membres' | 'liens' | 'aides' | 'corbeille' | undefined;

function sansEffet() {
  return undefined;
}

/** Actions minimales : les fenêtres de réglages n'utilisent que l'état, le thème, les droits et l'IA. */
function useActionsReglages(contexte: ContexteHub, theme: ThemeHub, onAvis: (t: string) => void): Actions {
  const mobile = useMobile();
  const etat = useEtatTaches(contexte);
  const aides = useAidesV3(contexte.baseProfil!, etat, sansEffet, onAvis);
  return useMemo(
    () => ({
      theme,
      mobile,
      etat,
      ouvrir: sansEffet,
      basculer: sansEffet,
      changer: sansEffet,
      droits: (pid: string) => droitsProjet(etat.role, etat.donnees, pid, etat.moi),
      menuStatut: sansEffet,
      menuPriorite: sansEffet,
      menuEcheance: sansEffet,
      menuAssigne: sansEffet,
      versColonne: sansEffet,
      basculerJournee: sansEffet,
      demanderSuppression: sansEffet,
      supprimer: sansEffet,
      minuteur: sansEffet,
      ...(aides ? { aides } : {}),
    }),
    [theme, mobile, etat, aides],
  );
}

function lireOuverture(contexte: ContexteHub): Ouverture {
  try {
    return (JSON.parse(contexte.baseProfil?.lire(CLES_TACHES.affichage) ?? '{}') as { ouverture?: Ouverture }).ouverture ?? 'calendrier-semaine';
  } catch {
    return 'calendrier-semaine';
  }
}

export function ReglagesTachesPerso({ contexte, theme, onOuvrirTaches }: { contexte: ContexteHub; theme: ThemeHub; onOuvrirTaches(): void }) {
  const [avis, setAvis] = useState('');
  const a = useActionsReglages(contexte, theme, setAvis);
  const [fenetre, setFenetre] = useState<Fenetre>();
  const [ouverture, setOuverture] = useState<Ouverture>(() => lireOuverture(contexte));
  const base = contexte.baseProfil!;
  const choisir = (o: Ouverture) => {
    let actuel: Record<string, unknown> = {};
    try {
      actuel = JSON.parse(base.lire(CLES_TACHES.affichage) ?? '{}') as Record<string, unknown>;
    } catch {
      actuel = {};
    }
    base.ecrire(CLES_TACHES.affichage, JSON.stringify({ ...actuel, ouverture: o }));
    setOuverture(o);
  };
  return (
    <View style={styles.bloc} testID="parametres-taches-perso">
      <Text style={attenueDe(theme)}>Vue d’ouverture (cet appareil)</Text>
      <Options theme={theme} valeur={ouverture} onChoisir={choisir} options={(Object.keys(LIBELLES_OUVERTURE) as Ouverture[]).map(o => ({ valeur: o, texte: LIBELLES_OUVERTURE[o] }))} testID="parametres-taches-ouverture" />
      <View style={styles.rangee}>
        <Bouton theme={theme} titre="🔔 Mes notifications…" onPress={() => setFenetre('notifications')} testID="parametres-taches-notifications" />
        <Bouton theme={theme} titre="⏱ Relevé du temps…" onPress={() => setFenetre('releve')} testID="parametres-taches-releve" />
        <Bouton theme={theme} variante="discret" titre="Ouvrir dans Tâches ›" onPress={onOuvrirTaches} testID="parametres-taches-ouvrir" />
      </View>
      {avis ? <Text style={attenueDe(theme)}>{avis}</Text> : null}
      {fenetre === 'notifications' ? (
        <DialogueNotifications
          a={a}
          appareil={appareilTaches(base)}
          systemeDisponible={notificationSystemeDisponible()}
          onTester={() => {
            const r = testerNotification(contexte, Date.now());
            a.etat.relire();
            setAvis(r.systeme ? 'Notification du système envoyée.' : 'La pastille 🔔 la montre (pas de notification du système ici).');
          }}
          onFermer={() => setFenetre(undefined)}
        />
      ) : null}
      {fenetre === 'releve' ? (
        <DialogueReleve
          a={a}
          onFermer={() => setFenetre(undefined)}
          onOuvrir={onOuvrirTaches}
          onExporter={(nom, csv) => void contexte.enregistrerFichier?.(nom, csv, 'text/csv').then(ok => ok && setAvis(`Relevé exporté : ${nom}.`))}
        />
      ) : null}
    </View>
  );
}

export function ReglagesTachesFondateur({ contexte, theme, onOuvrirTaches }: { contexte: ContexteHub; theme: ThemeHub; onOuvrirTaches(): void }) {
  const [avis, setAvis] = useState('');
  const a = useActionsReglages(contexte, theme, setAvis);
  const [fenetre, setFenetre] = useState<Fenetre>();
  const erreur = (e: unknown) => setAvis(e instanceof Error ? e.message : String(e));
  const fermer = () => setFenetre(undefined);
  if (a.etat.role !== 'fondateur') return null;
  return (
    <View style={styles.bloc} testID="parametres-taches-fondateur">
      <View style={styles.rangee}>
        <Bouton theme={theme} titre="👥 Membres et droits…" onPress={() => setFenetre('membres')} testID="parametres-taches-membres" />
        <Bouton theme={theme} titre="🔗 Liens avec les autres apps…" onPress={() => setFenetre('liens')} testID="parametres-taches-liens" />
        <Bouton theme={theme} titre="✨ IA et GitHub…" onPress={() => setFenetre('aides')} testID="parametres-taches-aides" />
        <Bouton theme={theme} titre="🗑 Corbeille…" onPress={() => setFenetre('corbeille')} testID="parametres-taches-corbeille" />
        <Bouton theme={theme} variante="discret" titre="Ouvrir dans Tâches ›" onPress={onOuvrirTaches} testID="parametres-taches-ouvrir-fondateur" />
      </View>
      {avis ? <Text style={attenueDe(theme)} testID="parametres-taches-avis">{avis}</Text> : null}
      {fenetre === 'membres' ? <DialogueMembres a={a} comptes={contexte.profils?.tous ?? []} onFermer={fermer} onErreur={erreur} onAvis={setAvis} /> : null}
      {fenetre === 'liens' ? (
        <DialogueLiens
          a={a}
          onFermer={fermer}
          onSynchroniser={() => {
            reinitialiserLiens();
            verifierRappels(contexte, Date.now());
            a.etat.relire();
            setAvis('Liens mis à jour.');
          }}
        />
      ) : null}
      {fenetre === 'aides' && a.aides ? <DialogueAides a={a} onFermer={fermer} onAvis={setAvis} onErreur={erreur} /> : null}
      {fenetre === 'corbeille' ? (
        <DialogueCorbeille
          a={a}
          onFermer={fermer}
          onRestaurer={el => {
            try {
              a.etat.maj((x, ctx) => restaurerElement(x, el.genre, el.id, ctx));
              setAvis(`« ${el.nom} » restauré.`);
            } catch (e) {
              erreur(e);
            }
          }}
          onEffacer={el => {
            try {
              a.etat.maj((x, ctx) => effacerElement(x, el.genre, el.id, ctx));
            } catch (e) {
              erreur(e);
            }
          }}
          onVider={() => a.etat.maj((x, ctx) => viderCorbeille(x, ctx))}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: 10 },
  rangee: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});

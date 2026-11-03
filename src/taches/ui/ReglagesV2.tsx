/**
 * Tâches (V2) : réglages des notifications (chaque utilisateur les siens,
 * synchronisés entre ses appareils) et des liens avec les autres apps
 * (Fondateur).
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { heureValide, lireHeure } from '../dates';
import { lienActif, NOMS_APPS } from '../integrations/commun';
import { APPS_LIEES, changerReglages, projetsDe, type AppLiee } from '../modele';
import { CANAUX, champPrefs, DELAIS_DEFAUT, enHeuresCalmes, LIBELLES_CANAL, LIBELLES_TYPE, prefsDe, TYPES_NOTIF, type Canal, type PrefsNotif, type TypeNotif } from '../notifications';
import { libelleDelai } from '../rappels';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, Dialogue, Libelle, Puce, texteDe } from './atomes';
import { Icone } from '../../ui/icones';

const TYPES_AMI: readonly TypeNotif[] = ['echeance', 'rappel', 'retard', 'assignee', 'ami', 'recap', 'journal'];
const COURTS: Record<Canal, string> = { 'les-deux': 'Les deux', systeme: 'Système', pastille: 'Pastille', aucun: 'Aucune' };

function Interrupteur({ a, texte, actif, onPress, testID, detail }: { a: Actions; texte: string; actif: boolean; onPress(): void; testID: string; detail?: string }) {
  return (
    <View style={styles.ligne}>
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={texteDe(a.theme)}>{texte}</Text>
        {detail ? <Text style={attenueDe(a.theme)}>{detail}</Text> : null}
      </View>
      <Puce theme={a.theme} grand texte={actif ? 'Activé' : 'Désactivé'} couleur={actif ? a.theme.ok : a.theme.attenue} actif={actif} onPress={onPress} testID={testID} libelle={`${texte} : ${actif ? 'activé' : 'désactivé'}`} />
    </View>
  );
}

export function DialogueNotifications({ a, appareil, systemeDisponible, onTester, onFermer }: { a: Actions; appareil: { id: string; nom: string }; systemeDisponible: boolean; onTester(): void; onFermer(): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const role = a.etat.role;
  const p = prefsDe(d, role);
  const [debut, setDebut] = useState(p.calme.debut);
  const [fin, setFin] = useState(p.calme.fin);
  const [heureRecap, setHeureRecap] = useState(p.heureRecap);
  const [heureJournal, setHeureJournal] = useState(p.heureJournal);
  const changer = (c: Partial<PrefsNotif>) => a.etat.maj((x, ctx) => changerReglages(x, { [champPrefs(role)]: { ...prefsDe(x, role), ...c } }, ctx));
  const heure = (v: string) => (heureValide(v) ? v : lireHeure(v));
  const types = role === 'fondateur' ? TYPES_NOTIF : TYPES_AMI;
  const calmeMaintenant = enHeuresCalmes(p, a.etat.maintenant());
  return (
    <Dialogue
      theme={theme}
      mobile={a.mobile}
      visible
      large
      titre="Notifications"
      description={`Vos réglages${role === 'ami' ? '' : ''} : ils vous suivent sur vos appareils (ils voyagent avec vos tâches, sans écriture de plus sur le relais).`}
      onFermer={onFermer}
      testID="dialogue-notifications"
      pied={<Bouton theme={theme} variante="plein" titre="Tester une notification" onPress={onTester} testID="notif-tester" />}>
      <Interrupteur a={a} texte="Notifications de Tâches" detail="Désactivées : ni notification du système, ni pastille de la cloche." actif={p.actif} onPress={() => changer({ actif: !p.actif })} testID="notif-actif" />
      {p.actif ? (
        <>
          <Libelle theme={theme}>PAR TYPE : OÙ LES RECEVOIR</Libelle>
          <Text style={attenueDe(theme)}>
            « Système » : la notification de l’ordinateur {systemeDisponible ? '(disponible ici)' : '(PC ou navigateur autorisé ; sinon la pastille seule)'} ; « Pastille » : <Icone nom="cloche" /> dans le hub et dans Tâches.
          </Text>
          {types.map(t => (
            <View key={t} style={[styles.type, a.mobile && styles.typeMobile]} testID={`notif-type-${t}`}>
              <Text style={[texteDe(theme), a.mobile ? null : { minWidth: 180, flex: 1 }]}>{LIBELLES_TYPE[t]}</Text>
              <View style={styles.rangee}>
                {CANAUX.map(c => (
                  <Puce key={c} theme={theme} grand={a.mobile} texte={COURTS[c]} libelle={`${LIBELLES_TYPE[t]} : ${LIBELLES_CANAL[c]}`} couleur={c === 'aucun' ? theme.attenue : theme.accent} actif={p.types[t] === c} onPress={() => changer({ types: { ...p.types, [t]: c } })} testID={`notif-${t}-${c}`} />
                ))}
              </View>
            </View>
          ))}
          <Libelle theme={theme}>RAPPEL PAR DÉFAUT D’UNE NOUVELLE ÉCHÉANCE</Libelle>
          <View style={styles.rangee}>
            {[-1, ...DELAIS_DEFAUT].map(m => (
              <Puce key={m} theme={theme} grand={a.mobile} texte={m === -1 ? 'Aucun' : m === 0 ? 'À l’heure' : libelleDelai(m)} couleur={theme.accent} actif={p.delaiDefaut === m} onPress={() => changer({ delaiDefaut: m })} testID={`notif-delai-${m}`} />
            ))}
          </View>
          <Text style={attenueDe(theme)}>Modifiable ensuite sur chaque tâche (« Rappels » dans son détail).</Text>
          {p.types.recap !== 'aucun' ? (
            <>
              <Libelle theme={theme}>HEURE DU RÉCAP « MA JOURNÉE »</Libelle>
              <Champ theme={theme} mobile={a.mobile} value={heureRecap} onChangeText={setHeureRecap} onBlur={() => (heure(heureRecap) ? changer({ heureRecap: heure(heureRecap)! }) : setHeureRecap(p.heureRecap))} placeholder="08:30" testID="notif-heure-recap" accessibilityLabel="Heure du récap quotidien" style={{ maxWidth: 160 }} />
            </>
          ) : null}
          {p.types.journal !== 'aucun' ? (
            <>
              <Libelle theme={theme}>HEURE DE L’INVITE DU SOIR (JOURNAL DU JOUR)</Libelle>
              <Champ theme={theme} mobile={a.mobile} value={heureJournal} onChangeText={setHeureJournal} onBlur={() => (heure(heureJournal) ? changer({ heureJournal: heure(heureJournal)! }) : setHeureJournal(p.heureJournal))} placeholder="18:00" testID="notif-heure-journal" accessibilityLabel="Heure de l’invite du soir" style={{ maxWidth: 160 }} />
            </>
          ) : null}
          <Libelle theme={theme}>HEURES CALMES (NE PAS DÉRANGER)</Libelle>
          <Interrupteur a={a} texte="Heures calmes" detail={`Rien ne sonne pendant la plage (la pastille de la cloche garde tout).${calmeMaintenant ? ' En cours maintenant.' : ''}`} actif={p.calme.actif} onPress={() => changer({ calme: { ...p.calme, actif: !p.calme.actif } })} testID="notif-calme" />
          {p.calme.actif ? (
            <View style={styles.rangee}>
              <Text style={texteDe(theme)}>De</Text>
              <Champ theme={theme} mobile={a.mobile} value={debut} onChangeText={setDebut} onBlur={() => (heure(debut) ? changer({ calme: { ...p.calme, debut: heure(debut)! } }) : setDebut(p.calme.debut))} testID="notif-calme-debut" accessibilityLabel="Début des heures calmes" style={{ width: 96 }} />
              <Text style={texteDe(theme)}>à</Text>
              <Champ theme={theme} mobile={a.mobile} value={fin} onChangeText={setFin} onBlur={() => (heure(fin) ? changer({ calme: { ...p.calme, fin: heure(fin)! } }) : setFin(p.calme.fin))} testID="notif-calme-fin" accessibilityLabel="Fin des heures calmes" style={{ width: 96 }} />
              <Puce theme={theme} grand={a.mobile} texte="Tout le week-end" couleur={theme.accent} actif={p.calme.weekEnd} onPress={() => changer({ calme: { ...p.calme, weekEnd: !p.calme.weekEnd } })} testID="notif-calme-weekend" />
            </View>
          ) : null}
          <Libelle theme={theme}>PRÉSENTATION</Libelle>
          <Interrupteur a={a} texte="Regrouper" detail="Une seule notification résumée quand plusieurs partent en même temps." actif={p.regrouper} onPress={() => changer({ regrouper: !p.regrouper })} testID="notif-regrouper" />
          <Interrupteur a={a} texte="Son" detail="Notification sonore (application du PC, à partir de cette version ; navigateur selon le système)." actif={p.son} onPress={() => changer({ son: !p.son })} testID="notif-son" />
          <Libelle theme={theme}>UN APPAREIL SEULEMENT</Libelle>
          <Text style={attenueDe(theme)}>Pour éviter les doublons quand plusieurs appareils sont ouverts : seul l’appareil choisi montre les notifications du système (les autres gardent la pastille).</Text>
          <View style={styles.rangee}>
            <Puce theme={theme} grand={a.mobile} texte="Tous mes appareils" couleur={theme.accent} actif={!p.appareil} onPress={() => changer({ appareil: undefined })} testID="notif-appareil-tous" />
            <Puce theme={theme} grand={a.mobile} texte={`Seulement cet appareil (${appareil.nom})`} couleur={theme.accent} actif={p.appareil?.id === appareil.id} onPress={() => changer({ appareil })} testID="notif-appareil-ici" />
            {p.appareil && p.appareil.id !== appareil.id ? <Puce theme={theme} texte={`Choisi : ${p.appareil.nom}`} couleur={theme.alerte} actif /> : null}
          </View>
          <Libelle theme={theme}>PROJETS EN SOURDINE</Libelle>
          <View style={styles.rangee}>
            {projetsDe(d).map(pr => {
              const muet = p.muets.includes(pr.id);
              return <Puce key={pr.id} theme={theme} grand={a.mobile} icone={muet ? 'cloche-barree' : 'cloche'} texte={pr.nom} couleur={muet ? theme.attenue : pr.couleur} actif={muet} onPress={() => changer({ muets: muet ? p.muets.filter(x => x !== pr.id) : [...p.muets, pr.id] })} testID={`notif-muet-${pr.id}`} libelle={`${pr.nom} : ${muet ? 'en sourdine' : 'notifié'}`} />;
            })}
          </View>
        </>
      ) : null}
    </Dialogue>
  );
}

const TEXTES_LIENS: Record<AppLiee, string> = {
  office: 'Dans le Détail d’un agent (ou d’un sous-agent) de Claude Office : « ＋ Créer une tâche ». Quand l’agent lié finit, la tâche passe « En revue » ; ses sessions s’ouvrent dans l’Historique.',
  prospects: 'Chaque relance prévue (30 prochains jours, ou en retard) devient une tâche du projet « Prospects » ; cocher la tâche note le contact dans Prospects.',
  abonnements: 'Échéances proches et retards de paiement deviennent des tâches du projet « Abonnements » ; elles se terminent quand le paiement est noté.',
  portefeuille: 'Le rappel de versement mensuel (s’il est activé dans le portefeuille) et les dividendes attendus à vérifier deviennent des tâches du projet « Portefeuille ».',
};

export function DialogueLiens({ a, onFermer, onSynchroniser }: { a: Actions; onFermer(): void; onSynchroniser(): void }) {
  const d = a.etat.donnees;
  return (
    <Dialogue
      theme={a.theme}
      mobile={a.mobile}
      visible
      large
      titre="Liens avec les autres apps"
      description="Chaque lien range ses tâches dans un projet à son nom (espace « Applications »), sans doublon. Ces projets ne se partagent pas : rien de ces apps n’est montré à votre ami. Désactiver un lien arrête les créations ; les tâches déjà là restent."
      onFermer={onFermer}
      testID="dialogue-liens"
      pied={<Bouton theme={a.theme} variante="plein" titre="Mettre à jour maintenant" onPress={onSynchroniser} testID="liens-synchroniser" />}>
      {(['office', 'prospects', 'abonnements', 'portefeuille'] as const).filter(x => APPS_LIEES.includes(x)).map(app => {
        const actif = lienActif(d, app);
        return (
          <Interrupteur
            key={app}
            a={a}
            texte={NOMS_APPS[app]}
            detail={TEXTES_LIENS[app]}
            actif={actif}
            onPress={() => {
              a.etat.maj((x, ctx) => changerReglages(x, { liens: { ...x.reglages.liens, [app]: !actif } }, ctx));
              if (!actif) onSynchroniser();
            }}
            testID={`lien-${app}`}
          />
        );
      })}
    </Dialogue>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, flexWrap: 'wrap' },
  type: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingVertical: 4 },
  typeMobile: { flexDirection: 'column', alignItems: 'stretch' },
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});

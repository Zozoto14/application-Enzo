/**
 * Administration › Support (Fondateur, jeton maître) : toutes les demandes des utilisateurs, rangées
 * sur le relais (`GET /support/tickets?tous=1`), leur statut, la conversation, et la RÉPONSE :
 *  - elle arrive dans l'app de l'utilisateur (Support › Mes demandes, notification sur le bouton) ;
 *  - elle part dans le fil Discord de la demande (salon forum, ou fil ouvert par le bot) ;
 *  - en option, par e-mail : l'adresse vient des données chiffrées de l'Administration (fiche du
 *    compte), elle est jointe à CETTE demande d'envoi et le relais ne la garde pas.
 * Un diagnostic dit si le webhook Discord est configuré et comment s'est passé le dernier envoi.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChampNote } from '../../../esport/ui/ChampNote';
import { NoteMarkdown } from '../../../esport/ui/review/Note';
import { liaisonCourriel } from '../../../messagerie/courriel';
import { agirSurTicket, etatSupport, listerTickets } from '../../../support/envoi';
import { CATEGORIES_TICKET, LIBELLES_STATUT_SERVEUR, STATUTS_SERVEUR, lireMessages, type StatutServeur, type VueServeur } from '../../../support/tickets';
import { police, teinteTransparente } from '../../themes';
import { Avis, BoutonHub, Case, Intertitre, Panneau, Pilule, Segments, dateLisible, type OutilsAdmin } from './commun';

type Filtre = 'tous' | StatutServeur;
type Etat = Awaited<ReturnType<typeof etatSupport>>;

const LIBELLES_DISCORD: Record<string, string> = { envoye: 'Discord ✓', echec: 'Discord : échec', 'non-configure': 'Discord : non configuré' };

export function SupportAdmin({ outils }: { outils: OutilsAdmin }) {
  const { theme, donnees, controle } = outils;
  const [tickets, setTickets] = useState<VueServeur[] | undefined>();
  const [etat, setEtat] = useState<Etat>();
  const [erreur, setErreur] = useState<string | undefined>();
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [choisi, setChoisi] = useState<string | undefined>();
  const [reponse, setReponse] = useState('');
  const [parEmail, setParEmail] = useState(true);
  const [statutApres, setStatutApres] = useState<StatutServeur>('repondu');
  const [retour, setRetour] = useState<{ genre: 'ok' | 'alerte' | 'critique'; texte: string } | undefined>();
  const [enCours, setEnCours] = useState(false);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };

  const charger = useCallback(async () => {
    const liaison = liaisonCourriel.relais();
    if (!liaison) {
      setErreur('Cet appareil n’est pas relié au relais : Paramètres › Synchronisation.');
      return;
    }
    const [lu, e] = await Promise.all([listerTickets(liaison, liaisonCourriel.requete(), true), etatSupport(liaison, liaisonCourriel.requete())]);
    if (!lu) setErreur('Le relais ne répond pas (ou n’est pas encore à jour) : réessayez dans un instant.');
    else {
      setErreur(undefined);
      setTickets(lu.tickets);
    }
    setEtat(e);
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  const nomDe = (t: VueServeur) => (t.compte === 'principal' ? 'Vous' : (controle.tous.find(p => p.id === t.compte)?.nom ?? t.auteur ?? t.compte ?? '?'));
  const emailDe = (t: VueServeur) => (t.compte ? donnees.contacts[t.compte]?.email : undefined);
  const liste = useMemo(() => (tickets ?? []).filter(t => filtre === 'tous' || t.statut === filtre), [tickets, filtre]);
  const t = tickets?.find(x => x.id === choisi);
  const remplacer = (v: VueServeur) => setTickets(avant => (avant ?? []).map(x => (x.id === v.id ? { ...x, ...v } : x)));

  const repondre = async () => {
    if (!t) return;
    setEnCours(true);
    setRetour(undefined);
    const adresse = parEmail ? emailDe(t) : undefined;
    const r = await agirSurTicket(
      liaisonCourriel.relais(),
      t.id,
      'messages',
      { texte: reponse.trim(), statut: statutApres, ...(adresse ? { courriel: { adresse, langue: t.technique?.langue === 'en' ? 'en' : 'fr' } } : {}) },
      liaisonCourriel.requete(),
    );
    setEnCours(false);
    if (!r.ok) {
      setRetour({ genre: 'critique', texte: r.motif });
      return;
    }
    remplacer(r.vue);
    setReponse('');
    outils.journaliser({ type: 'support', action: `Réponse à la demande de support n° ${t.numero}${adresse ? ' (app, Discord, e-mail)' : ''}`, ...(t.compte && t.compte !== 'principal' ? { cible: t.compte, nomCible: nomDe(t) } : {}) });
    const morceaux = ['Réponse envoyée : visible dans l’app de l’utilisateur'];
    morceaux.push(r.discord ? 'et dans le fil Discord' : 'mais pas sur Discord (webhook absent ou en panne)');
    if (r.courriel) morceaux.push(r.courriel.ok ? '; e-mail envoyé' : `; e-mail NON envoyé (${r.courriel.erreur ?? 'erreur'})`);
    else if (parEmail && !adresse) morceaux.push('; pas d’e-mail : aucune adresse dans sa fiche');
    setRetour({ genre: r.discord && (!r.courriel || r.courriel.ok) ? 'ok' : 'alerte', texte: `${morceaux.join(' ')}.` });
  };

  const changerStatut = async (statut: StatutServeur) => {
    if (!t) return;
    const r = await agirSurTicket(liaisonCourriel.relais(), t.id, 'statut', { statut }, liaisonCourriel.requete());
    if (r.ok) remplacer(r.vue);
    else setRetour({ genre: 'critique', texte: r.motif });
  };
  const renvoyerDiscord = async () => {
    if (!t) return;
    const r = await agirSurTicket(liaisonCourriel.relais(), t.id, 'discord', {}, liaisonCourriel.requete());
    if (r.ok) remplacer(r.vue);
    setRetour(r.ok && r.vue.discord === 'envoye' ? { genre: 'ok', texte: 'Demande annoncée sur Discord.' } : { genre: 'critique', texte: 'Discord refuse toujours : vérifiez DISCORD_WEBHOOK_URL dans relais.env (docs/support.md).' });
  };

  const diagnostic = etat ? (
    etat.webhook === 'ok' ? (
      <Text style={attenue} testID="admin-support-diagnostic">
        Webhook Discord configuré{etat.mode ? ` (salon ${etat.mode === 'forum' ? 'forum : un fil par demande' : 'texte'}${etat.mode === 'texte' && etat.bot ? ', fils ouverts par le bot' : ''})` : ''}
        {etat.dernierEnvoi ? ` · dernier envoi ${dateLisible(etat.dernierEnvoi.date, true)} : ${etat.dernierEnvoi.ok ? 'réussi' : `échec (HTTP ${etat.dernierEnvoi.statut ?? '—'}${etat.dernierEnvoi.code ? `, code Discord ${etat.dernierEnvoi.code}` : ''})`}` : ''}
        {` · e-mails ${etat.courriel ? 'activés' : 'non configurés'}`}
      </Text>
    ) : (
      <Avis
        theme={theme}
        genre="alerte"
        testID="admin-support-diagnostic"
        texte={`Le webhook Discord du support est ${etat.webhook === 'absent' ? 'ABSENT' : 'MAL FORMÉ'} sur le relais : les demandes sont bien enregistrées ici, mais rien n’arrive dans Discord. Ajoutez DISCORD_WEBHOOK_URL dans ~/.appdashboard/relais.env, puis redémarrez le relais (docs/support.md).`}
      />
    )
  ) : null;

  return (
    <View style={{ gap: 12 }} testID="admin-support">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Demandes de support</Intertitre>
        {diagnostic}
        {erreur ? <Avis theme={theme} genre="critique" texte={erreur} testID="admin-support-erreur" /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Segments<Filtre> theme={theme} libelle="Statut" valeur={filtre} options={[['tous', 'Toutes'], ...STATUTS_SERVEUR.map(s => [s, LIBELLES_STATUT_SERVEUR[s]] as const)]} onChoisir={setFiltre} testID="admin-support-filtre" />
          <BoutonHub theme={theme} titre="↻ Actualiser" onPress={() => void charger()} testID="admin-support-actualiser" />
        </View>
        {tickets && liste.length === 0 ? (
          <Text style={attenue} testID="admin-support-vide">
            Aucune demande{filtre !== 'tous' ? ' avec ce statut' : ''}.
          </Text>
        ) : null}
        {liste.map(x => {
          const c = CATEGORIES_TICKET.find(k => k.id === x.categorie) ?? CATEGORIES_TICKET[2];
          const actif = x.id === choisi;
          const attente = lireMessages(x.messages).at(-1)?.de !== 'equipe' && x.statut !== 'resolu';
          return (
            <Pressable
              key={x.id}
              onPress={() => {
                setChoisi(actif ? undefined : x.id);
                setRetour(undefined);
              }}
              testID={`admin-support-ticket-${x.numero}`}
              accessibilityRole="button"
              style={{ borderWidth: 1, borderColor: actif ? theme.accent : theme.ligne, borderLeftWidth: 4, borderLeftColor: c.couleur, borderRadius: Math.min(theme.rayonMoyen, 10), padding: 10, gap: 4, backgroundColor: actif ? teinteTransparente(theme.accent, 0.06) : 'transparent' }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Text style={[texte, { fontWeight: '700', flex: 1 }]} numberOfLines={2}>
                  n° {x.numero} · {c.emoji} {x.titre}
                </Text>
                {attente ? <Pilule theme={theme} texte="À traiter" couleur={theme.alerte} /> : null}
                <Pilule theme={theme} texte={LIBELLES_STATUT_SERVEUR[x.statut as StatutServeur] ?? x.statut} couleur={x.statut === 'resolu' ? theme.ok : x.statut === 'repondu' ? theme.accent : theme.attenue} testID={`admin-support-ticket-${x.numero}-statut`} />
              </View>
              <Text style={attenue}>
                {nomDe(x)} · {c.libelle} · {dateLisible(x.cree, true)} · {LIBELLES_DISCORD[x.discord ?? ''] ?? ''}
              </Text>
            </Pressable>
          );
        })}
      </Panneau>
      {t ? (
        <Panneau theme={theme} testID="admin-support-detail">
          <Intertitre theme={theme}>{`Demande n° ${t.numero}`}</Intertitre>
          <Text style={[texte, { fontWeight: '700', fontSize: 16 }]}>{t.titre}</Text>
          <Text style={attenue}>
            De {nomDe(t)}
            {t.technique ? ` · ${[t.technique.app, t.technique.version, t.technique.appareil, t.technique.plateforme, t.technique.langue?.toUpperCase()].filter(Boolean).join(' · ')}` : ''}
            {t.pieceNom ? ` · capture jointe sur Discord (${t.pieceNom})` : ''}
          </Text>
          <NoteMarkdown theme={theme} source={t.message} />
          {lireMessages(t.messages).map(m => (
            <View key={m.id || m.date} style={{ padding: 10, gap: 4, borderRadius: 8, backgroundColor: m.de === 'equipe' ? teinteTransparente(theme.ok, 0.12) : teinteTransparente(theme.accent, 0.08) }} testID={`admin-support-message-${m.de}`}>
              <Text style={[attenue, { fontWeight: '700' }]}>
                {m.de === 'equipe' ? 'Vous (Fondateur)' : nomDe(t)} · {dateLisible(m.date, true)}
              </Text>
              <NoteMarkdown theme={theme} source={m.texte} />
            </View>
          ))}
          <ChampNote theme={theme} libelle="Votre réponse" valeur={reponse} onChanger={setReponse} maxLength={4000} placeholder="Bonjour, …" testID="admin-support-reponse" apercu="bouton" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Case theme={theme} coche={parEmail} libelle="Prévenir aussi par e-mail" onChanger={setParEmail} testID="admin-support-par-email" />
            <Text style={attenue}>{emailDe(t) ? `Prévenir aussi par e-mail (${emailDe(t)})` : 'Prévenir aussi par e-mail (aucune adresse dans sa fiche)'}</Text>
          </View>
          <Segments<StatutServeur> theme={theme} libelle="Statut après la réponse" valeur={statutApres} options={STATUTS_SERVEUR.map(s => [s, LIBELLES_STATUT_SERVEUR[s]] as const)} onChoisir={setStatutApres} testID="admin-support-statut-apres" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <BoutonHub theme={theme} variante="plein" titre={enCours ? 'Envoi…' : 'Répondre'} desactive={enCours || reponse.trim().length < 2} onPress={() => void repondre()} testID="admin-support-repondre" />
            <BoutonHub theme={theme} titre="En cours" onPress={() => void changerStatut('en_cours')} testID="admin-support-en-cours" />
            <BoutonHub theme={theme} titre="Marquer résolue" onPress={() => void changerStatut('resolu')} testID="admin-support-resolu" />
            {t.discord !== 'envoye' ? <BoutonHub theme={theme} titre="Renvoyer sur Discord" onPress={() => void renvoyerDiscord()} testID="admin-support-discord" /> : null}
          </View>
          {retour ? <Avis theme={theme} genre={retour.genre} texte={retour.texte} testID="admin-support-retour" /> : null}
          <Text style={[attenue, { fontSize: 12 }]}>
            L’adresse e-mail n’est jamais gardée par le serveur : elle part avec cette réponse, puis seule une trace masquée reste dans le journal d’envoi.
          </Text>
        </Panneau>
      ) : null}
    </View>
  );
}

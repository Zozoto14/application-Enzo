/**
 * Administration › Messagerie (Fondateur, jeton maître) : écrire un e-mail à un ou plusieurs
 * utilisateurs, ou à tous les membres d'une team Esport, avec l'éditeur riche ; l'e-mail part
 * DIRECTEMENT du serveur (SMTP de l'hébergeur, docs/emails.md). Historique des envois et statut
 * (envoyé, échec) en bas de page.
 *
 * Confidentialité : les adresses sont celles des fiches de l'Administration (base chiffrée du
 * Fondateur). Elles partent avec la demande d'envoi ; le serveur ne les garde pas (journal : adresse
 * masquée). Un e-mail par destinataire : personne ne voit l'adresse des autres. Sans SMTP sur le
 * serveur, « Ouvrir ma messagerie » prépare le même message (destinataires en copie cachée).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { ChampNote } from '../../../esport/ui/ChampNote';
import { trouverConfig, type Annuaire } from '../../../esport/client';
import { fabrique } from '../../../esport/fabrique';
import { courrielDisponible, envoyerCourriel, journalCourriel, libelleErreurCourriel, mailtoSecours, type EnvoiJournal, type LangueCourriel } from '../../../messagerie/courriel';
import { police } from '../../themes';
import { Avis, BoutonHub, Case, Champ, Intertitre, Panneau, Pilule, Segments, dateLisible, type OutilsAdmin } from './commun';

export function Messagerie({ outils }: { outils: OutilsAdmin }) {
  const { theme, donnees, tous } = outils;
  const [disponible, setDisponible] = useState<boolean | undefined>();
  const [journal, setJournal] = useState<EnvoiJournal[] | undefined>();
  const [choisis, setChoisis] = useState<ReadonlySet<string>>(new Set());
  const [objet, setObjet] = useState('');
  const [message, setMessage] = useState('');
  const [langue, setLangue] = useState<LangueCourriel>('fr');
  const [annuaire, setAnnuaire] = useState<Annuaire | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState<{ genre: 'ok' | 'alerte' | 'critique'; texte: string } | undefined>();
  const attenue = { color: theme.attenue, fontSize: 13, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };

  const comptes = useMemo(
    () =>
      tous
        .filter(p => p.id !== 'principal')
        .map(p => ({ id: p.id, nom: p.nom, email: donnees.contacts[p.id]?.email }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    [tous, donnees.contacts],
  );
  const avecAdresse = comptes.filter(c => c.email);

  const charger = useCallback(async () => {
    const [d, j] = await Promise.all([courrielDisponible(), journalCourriel()]);
    setDisponible(d);
    setJournal(j);
  }, []);
  useEffect(() => {
    void charger();
    // Teams Esport (facultatif) : « tous les membres d'une team ».
    void (async () => {
      try {
        const { config } = await trouverConfig(fabrique.relais());
        if (config) setAnnuaire(await fabrique.client(config).annuaire());
      } catch {
        setAnnuaire(undefined);
      }
    })();
  }, [charger]);

  const basculer = (id: string, v: boolean) =>
    setChoisis(avant => {
      const suite = new Set(avant);
      if (v) suite.add(id);
      else suite.delete(id);
      return suite;
    });
  const choisirTeam = (teamId: string) => {
    const ids = new Set((annuaire?.comptes ?? []).filter(c => c.appartenances.some(a => a.teamId === teamId)).map(c => c.compte));
    setChoisis(new Set(avecAdresse.filter(c => ids.has(c.id)).map(c => c.id)));
  };
  const destinataires = avecAdresse.filter(c => choisis.has(c.id));
  const probleme = destinataires.length === 0 ? 'Choisissez au moins un destinataire (avec une adresse).' : !objet.trim() ? 'L’objet est vide.' : message.trim().length < 2 ? 'Le message est vide.' : undefined;

  const envoyer = async () => {
    setEnCours(true);
    setRetour(undefined);
    const r = await envoyerCourriel({ destinataires: destinataires.map(d => ({ adresse: d.email!, nom: d.nom, langue })), modele: 'libre', langue, objet: objet.trim(), message, ref: 'messagerie' });
    setEnCours(false);
    if (r.nonConfigure) {
      setDisponible(false);
      setRetour({ genre: 'alerte', texte: 'Le serveur n’envoie pas encore d’e-mails (SMTP non configuré) : utilisez « Ouvrir ma messagerie ».' });
      return;
    }
    if (r.envoyes === 0) {
      setRetour({ genre: 'critique', texte: `Aucun e-mail envoyé : ${r.erreur ? libelleErreurCourriel(r.erreur) : 'erreur'}.` });
    } else {
      const echecs = r.resultats.filter(x => x.statut === 'echec');
      setRetour({
        genre: echecs.length ? 'alerte' : 'ok',
        texte: `${r.envoyes} e-mail${r.envoyes > 1 ? 's' : ''} envoyé${r.envoyes > 1 ? 's' : ''}${echecs.length ? ` ; ${echecs.length} échec(s) : ${echecs.map(e => `${e.a} (${libelleErreurCourriel(e.erreur)})`).join(', ')}` : ''}.`,
      });
      outils.journaliser({ type: 'messagerie', action: `E-mail « ${objet.trim().slice(0, 60)} » envoyé à ${r.envoyes} destinataire${r.envoyes > 1 ? 's' : ''}` });
      setObjet('');
      setMessage('');
    }
    void charger();
  };

  const secours = mailtoSecours(destinataires.map(d => d.email!), objet, message);

  return (
    <View style={{ gap: 12 }} testID="admin-messagerie">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Écrire un e-mail</Intertitre>
        {disponible === false ? (
          <Avis
            theme={theme}
            genre="alerte"
            testID="admin-messagerie-non-configure"
            texte="Le serveur n’envoie pas encore d’e-mails : ajoutez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS et MAIL_FROM dans ~/.appdashboard/relais.env, puis redémarrez le relais (docs/emails.md). En attendant, « Ouvrir ma messagerie » prépare le message."
          />
        ) : disponible ? (
          <Text style={attenue} testID="admin-messagerie-pret">
            Envoi direct par le serveur. Un e-mail par destinataire : personne ne voit les autres adresses.
          </Text>
        ) : null}
        <Text style={[texte, { fontWeight: '600' }]}>Destinataires ({destinataires.length})</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <BoutonHub theme={theme} titre="Tous" onPress={() => setChoisis(new Set(avecAdresse.map(c => c.id)))} testID="admin-messagerie-tous" />
          <BoutonHub theme={theme} titre="Aucun" onPress={() => setChoisis(new Set())} testID="admin-messagerie-aucun" />
          {(annuaire?.teams ?? [])
            .filter(t => !t.archivee)
            .map(t => (
              <BoutonHub key={t.id} theme={theme} titre={`Team ${t.nom}`} onPress={() => choisirTeam(t.id)} testID={`admin-messagerie-team-${t.slug}`} />
            ))}
        </View>
        <View style={{ gap: 6 }}>
          {comptes.map(c => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
              {c.email ? <Case theme={theme} coche={choisis.has(c.id)} libelle={`Écrire à ${c.nom}`} onChanger={v => basculer(c.id, v)} testID={`admin-messagerie-dest-${c.id}`} /> : <View style={{ width: 22 }} />}
              <Text style={[texte, { flex: 1, opacity: c.email ? 1 : 0.55 }]}>
                {c.nom} <Text style={attenue}>{c.email ?? '— pas d’adresse dans sa fiche'}</Text>
              </Text>
            </View>
          ))}
          {comptes.length === 0 ? <Text style={attenue}>Aucun compte pour l’instant.</Text> : null}
        </View>
        <Segments<LangueCourriel> theme={theme} libelle="Langue de l’e-mail" valeur={langue} options={[['fr', 'Français'], ['en', 'English']]} onChoisir={setLangue} testID="admin-messagerie-langue" />
        <Champ theme={theme} libelle="Objet" valeur={objet} onChanger={setObjet} maxLength={160} testID="admin-messagerie-objet" placeholder="Ex. : Tournoi de samedi" />
        <ChampNote theme={theme} libelle="Message" valeur={message} onChanger={setMessage} maxLength={20000} testID="admin-messagerie-message" apercu="bouton" placeholder="Bonjour à tous, …" />
        {probleme && (objet || message || choisis.size) ? <Text style={[attenue, { color: theme.alerte }]}>{probleme}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <BoutonHub theme={theme} variante="plein" titre={enCours ? 'Envoi…' : `Envoyer (${destinataires.length})`} desactive={enCours || Boolean(probleme) || disponible === false} onPress={() => void envoyer()} testID="admin-messagerie-envoyer" />
          {disponible === false && !probleme ? (
            <BoutonHub
              theme={theme}
              titre="Ouvrir ma messagerie"
              onPress={() => (Platform.OS === 'web' ? (globalThis as { open?(u: string): void }).open?.(secours) : void Linking.openURL(secours))}
              testID="admin-messagerie-mailto"
            />
          ) : null}
        </View>
        {retour ? <Avis theme={theme} genre={retour.genre} texte={retour.texte} testID="admin-messagerie-retour" /> : null}
      </Panneau>
      <Panneau theme={theme} testID="admin-messagerie-historique">
        <Intertitre theme={theme}>Historique des envois</Intertitre>
        {journal === undefined ? <Text style={attenue}>Historique indisponible (serveur injoignable).</Text> : journal.length === 0 ? <Text style={attenue}>Aucun envoi pour l’instant.</Text> : null}
        {(journal ?? []).slice(0, 50).map(e => {
          const ok = e.resultats.filter(r => r.statut === 'envoye').length;
          const ko = e.resultats.length - ok;
          return (
            <View key={e.id} style={{ gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.ligne }} testID={`admin-messagerie-envoi-${e.id}`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Text style={[texte, { fontWeight: '700', flex: 1 }]}>{e.objet || '(sans objet)'}</Text>
                {ok ? <Pilule theme={theme} texte={`Envoyé ×${ok}`} couleur={theme.ok} /> : null}
                {ko ? <Pilule theme={theme} texte={`Échec ×${ko}`} couleur={theme.critique} /> : null}
              </View>
              <Text style={attenue}>
                {dateLisible(e.date, true)} · {e.modele === 'invitation' ? 'Invitation' : e.modele === 'support' ? 'Réponse au support' : e.modele === 'recap' ? 'Récapitulatif' : 'Messagerie'} · {e.resultats.map(r => `${r.a}${r.statut === 'echec' ? ` ✗ ${libelleErreurCourriel(r.erreur)}` : ''}`).join(', ')}
              </Text>
            </View>
          );
        })}
      </Panneau>
    </View>
  );
}

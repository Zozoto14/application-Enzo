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
 *
 * Langue : par défaut « Langue du destinataire » (celle de son compte : choix de l'utilisateur dans l'Esport,
 * sinon la langue par défaut réglée par le Fondateur dans sa fiche), ou Français / English forcé pour tous.
 * L'habillage (en-tête, pied de page, mentions, bouton) est traduit pour CHAQUE destinataire ; le corps reste
 * celui que le Fondateur a écrit — ou, s'il écrit aussi une version anglaise, chacun reçoit la sienne. L'aperçu
 * montre le rendu exact (objet, HTML, texte) dans la langue choisie, avant l'envoi.
 *
 * Jamais silencieux : « Envoyer » répond toujours (envoyé, ou la raison précise : appareil non relié avec le jeton
 * maître, relais injoignable ou arrêté, ancienne version du relais, SMTP non configuré ou refusé…). « Tester l'envoi »
 * fait vérifier la connexion SMTP au relais et envoie un e-mail de test (docs/emails.md, « Dépannage »).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { ChampNote } from '../../../esport/ui/ChampNote';
import { trouverConfig, type Annuaire, type ClientEsport } from '../../../esport/client';
import { ZoneEcriture } from '../../../esport/ui/ecriture/ZoneEcriture';
import { fabrique } from '../../../esport/fabrique';
import {
  apercuCourriel,
  envoyerCourriel,
  etatCourriel,
  libelleErreurCourriel,
  lireJournalCourriel,
  mailtoSecours,
  testerCourriel,
  type ApercuCourriel,
  type EnvoiJournal,
  type EtatCourriel,
  type LangueCourriel,
  type ResultatTest,
} from '../../../messagerie/courriel';
import { NOMS_LANGUES, langueEffective } from '../contacts';
import { police, type ThemeHub } from '../../themes';
import { Avis, BoutonHub, Case, Champ, Intertitre, Panneau, Pilule, Segments, dateLisible, type OutilsAdmin } from './commun';

type ChoixLangueMessage = 'auto' | LangueCourriel;

/** Aperçu rendu par le serveur : HTML dans un cadre isolé sur le web (aucun script), texte brut ailleurs. */
function CadreApercu({ theme, apercu }: { theme: ThemeHub; apercu: ApercuCourriel }) {
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  if (Platform.OS === 'web') {
    return React.createElement('iframe', {
      'data-testid': 'admin-messagerie-apercu-html',
      title: apercu.objet,
      sandbox: '',
      srcDoc: apercu.html,
      style: { width: '100%', height: 420, border: `1px solid ${theme.ligne}`, borderRadius: 8, background: '#fff' },
    });
  }
  return (
    <Text selectable style={[texte, { fontSize: 13 }]} testID="admin-messagerie-apercu-texte">
      {apercu.texte}
    </Text>
  );
}

export function Messagerie({ outils }: { outils: OutilsAdmin }) {
  const { theme, donnees, tous } = outils;
  const [etat, setEtat] = useState<EtatCourriel | undefined>();
  const disponible = etat?.configure;
  const [journal, setJournal] = useState<EnvoiJournal[] | undefined>();
  const [journalIndisponible, setJournalIndisponible] = useState<string | undefined>();
  const [adresseTest, setAdresseTest] = useState(() => donnees.contacts.principal?.email ?? '');
  const [testEnCours, setTestEnCours] = useState(false);
  const [test, setTest] = useState<ResultatTest | undefined>();
  const [choisis, setChoisis] = useState<ReadonlySet<string>>(new Set());
  const [objet, setObjet] = useState('');
  const [message, setMessage] = useState('');
  const [langue, setLangue] = useState<ChoixLangueMessage>('auto');
  const [deuxVersions, setDeuxVersions] = useState(false);
  const [objetEn, setObjetEn] = useState('');
  const [messageEn, setMessageEn] = useState('');
  const [apercuOuvert, setApercuOuvert] = useState(false);
  const [langueApercu, setLangueApercu] = useState<LangueCourriel | undefined>();
  const [apercu, setApercu] = useState<ApercuCourriel | undefined | 'indisponible'>();
  const [annuaire, setAnnuaire] = useState<Annuaire | undefined>();
  const [clientEsport, setClientEsport] = useState<ClientEsport | undefined>();
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
    const [e, j] = await Promise.all([etatCourriel(), lireJournalCourriel()]);
    setEtat(e);
    setJournal(j.envois);
    setJournalIndisponible(j.message);
  }, []);
  useEffect(() => {
    void charger();
    // Teams Esport (facultatif) : « tous les membres d'une team ».
    void (async () => {
      try {
        const { config } = await trouverConfig(fabrique.relais());
        if (config) {
          const client = fabrique.client(config);
          // Assistant d'écriture (corriger, traduire le message) : même session Esport du Fondateur (jeton maître).
          setClientEsport(client);
          setAnnuaire(await client.annuaire());
        }
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
  // Langue de chaque destinataire : forcée, ou celle de son compte (choix de l'utilisateur, sinon langue par défaut de sa fiche).
  const fichesEsport = useMemo(() => new Map((annuaire?.comptes ?? []).map(c => [c.compte, c])), [annuaire]);
  const langueDe = (id: string): LangueCourriel => (langue !== 'auto' ? langue : langueEffective(donnees.contacts[id], fichesEsport.get(id)));
  const nbEn = destinataires.filter(d => langueDe(d.id) === 'en').length;
  const nbFr = destinataires.length - nbEn;
  const versionEnIncomplete = deuxVersions && (!objetEn.trim() || messageEn.trim().length < 2);
  const probleme =
    destinataires.length === 0
      ? 'Choisissez au moins un destinataire (avec une adresse).'
      : !objet.trim()
        ? 'L’objet est vide.'
        : message.trim().length < 2
          ? 'Le message est vide.'
          : versionEnIncomplete
            ? 'La version anglaise est incomplète (objet et message).'
            : undefined;
  const versionEn = deuxVersions && !versionEnIncomplete ? { objet: objetEn.trim(), message: messageEn } : undefined;
  // Langues proposées à l'aperçu : celles que recevront les destinataires choisis (sinon celle choisie, sinon le français).
  const langues: LangueCourriel[] = destinataires.length ? ([nbFr > 0 ? 'fr' : undefined, nbEn > 0 ? 'en' : undefined].filter(Boolean) as LangueCourriel[]) : [langue === 'en' ? 'en' : 'fr'];
  const langueAffichee = langueApercu && langues.includes(langueApercu) ? langueApercu : langues[0];

  // Aperçu : rendu exact par le serveur (mêmes modèles que l'envoi), mis à jour après une courte pause de frappe.
  useEffect(() => {
    if (!apercuOuvert || objet.trim().length === 0 || message.trim().length < 2) {
      setApercu(undefined);
      return;
    }
    let vivant = true;
    const minuteur = setTimeout(() => {
      void apercuCourriel({ langue: langueAffichee, objet: objet.trim(), message, ...(versionEn ? { en: versionEn } : {}) }).then(r => vivant && setApercu(r ?? 'indisponible'));
    }, 300);
    return () => {
      vivant = false;
      clearTimeout(minuteur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apercuOuvert, objet, message, langueAffichee, deuxVersions, objetEn, messageEn]);

  const envoyer = async () => {
    // Toujours une réponse visible : un problème de saisie est dit ici plutôt que par un bouton grisé muet.
    if (probleme) {
      setRetour({ genre: 'alerte', texte: probleme });
      return;
    }
    setEnCours(true);
    setRetour(undefined);
    let r: Awaited<ReturnType<typeof envoyerCourriel>>;
    try {
      r = await envoyerCourriel({
        destinataires: destinataires.map(d => ({ adresse: d.email!, nom: d.nom, langue: langueDe(d.id) })),
        modele: 'libre',
        langue: langue === 'en' ? 'en' : 'fr',
        objet: objet.trim(),
        message,
        ...(versionEn ? { en: versionEn } : {}),
        ref: 'messagerie',
      });
    } catch (e) {
      r = { ok: false, envoyes: 0, resultats: [], erreur: `erreur inattendue de l’app (${e instanceof Error ? e.message : String(e)})` };
    } finally {
      setEnCours(false);
    }
    if (r.nonConfigure) {
      setEtat(avant => ({ ...avant, configure: false }));
      setRetour({ genre: 'alerte', texte: 'Le serveur n’envoie pas encore d’e-mails (SMTP non configuré) : utilisez « Ouvrir ma messagerie », ou « Tester l’envoi » pour voir ce qui manque.' });
      return;
    }
    if (r.envoyes === 0) {
      const detail = r.erreur ? libelleErreurCourriel(r.erreur) : 'le relais n’a rien envoyé, sans dire pourquoi';
      const parAdresse = r.resultats.filter(x => x.statut === 'echec' && x.erreur).map(e => `${e.a} (${libelleErreurCourriel(e.erreur)})`);
      setRetour({ genre: 'critique', texte: `Aucun e-mail envoyé : ${detail}${parAdresse.length > 1 ? ` ; détail : ${parAdresse.join(', ')}` : ''}.` });
      if (r.probleme) setEtat(avant => ({ ...avant, probleme: r.probleme, message: r.erreur }));
    } else {
      const echecs = r.resultats.filter(x => x.statut === 'echec');
      setRetour({
        genre: echecs.length ? 'alerte' : 'ok',
        texte: `${r.envoyes} e-mail${r.envoyes > 1 ? 's' : ''} envoyé${r.envoyes > 1 ? 's' : ''}${echecs.length ? ` ; ${echecs.length} échec(s) : ${echecs.map(e => `${e.a} (${libelleErreurCourriel(e.erreur)})`).join(', ')}` : ''}.`,
      });
      outils.journaliser({ type: 'messagerie', action: `E-mail « ${objet.trim().slice(0, 60)} » envoyé à ${r.envoyes} destinataire${r.envoyes > 1 ? 's' : ''} (${nbFr} en français, ${nbEn} en anglais${versionEn ? ' ; deux versions' : ''})` });
      setObjet('');
      setMessage('');
      setObjetEn('');
      setMessageEn('');
      setDeuxVersions(false);
      setApercuOuvert(false);
    }
    void charger();
  };

  const tester = async () => {
    setTestEnCours(true);
    setTest(undefined);
    try {
      setTest(await testerCourriel(adresseTest));
    } catch (e) {
      setTest({ ok: false, etape: 'relais', message: `Erreur inattendue de l’app : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTestEnCours(false);
    }
    void charger();
  };

  const secours = mailtoSecours(destinataires.map(d => d.email!), objet, message);

  return (
    <View style={{ gap: 12 }} testID="admin-messagerie">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Écrire un e-mail</Intertitre>
        {etat?.probleme ? (
          <Avis theme={theme} genre="critique" testID="admin-messagerie-probleme" texte={etat.message ?? 'Relais injoignable.'} />
        ) : disponible === false ? (
          <Avis
            theme={theme}
            genre="alerte"
            testID="admin-messagerie-non-configure"
            texte={`Le serveur n’envoie pas encore d’e-mails : ${
              etat?.manques?.length ? `il manque ${etat.manques.join(', ')}` : 'ajoutez SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS et MAIL_FROM'
            } dans ~/.appdashboard/relais.env, puis redémarrez le relais (cPanel › Setup Node.js App › Restart ; docs/emails.md). En attendant, « Ouvrir ma messagerie » prépare le message.`}
          />
        ) : disponible ? (
          <Text style={attenue} testID="admin-messagerie-pret">
            Envoi direct par le serveur. Un e-mail par destinataire : personne ne voit les autres adresses.
          </Text>
        ) : (
          <Text style={attenue} testID="admin-messagerie-verification">
            Vérification de l’envoi par le serveur…
          </Text>
        )}
        {etat?.verification?.statut === 'echec' ? (
          <Avis
            theme={theme}
            genre="critique"
            testID="admin-messagerie-verification-echec"
            texte={`Au démarrage du relais, la connexion SMTP a échoué${etat.verification.technique ? ` (code ${etat.verification.technique})` : ''} : ${etat.verification.explication ?? libelleErreurCourriel(etat.verification.code)}`}
          />
        ) : null}
        {etat && !etat.probleme && etat.test === false ? (
          <Avis
            theme={theme}
            genre="alerte"
            testID="admin-messagerie-relais-ancien"
            texte="Le relais tourne une ancienne version (il n’a pas redémarré après la dernière mise à jour) : cPanel › Setup Node.js App › application-enzo/relais › Restart."
          />
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
              {c.email ? <Pilule theme={theme} texte={langueDe(c.id).toUpperCase()} couleur={langueDe(c.id) === 'en' ? theme.accent : theme.attenue} testID={`admin-messagerie-langue-${c.id}`} /> : null}
            </View>
          ))}
          {comptes.length === 0 ? <Text style={attenue}>Aucun compte pour l’instant.</Text> : null}
        </View>
        <Segments<ChoixLangueMessage>
          theme={theme}
          libelle="Langue de l’e-mail"
          valeur={langue}
          options={[['auto', 'Langue du destinataire'], ['fr', NOMS_LANGUES.fr], ['en', NOMS_LANGUES.en]]}
          onChoisir={setLangue}
          testID="admin-messagerie-langue"
        />
        <Text style={attenue} testID="admin-messagerie-langues-resume">
          {langue === 'auto'
            ? `Chacun reçoit l’habillage (en-tête, pied de page, mentions) dans la langue de son compte${destinataires.length ? ` : ${nbFr} en français, ${nbEn} en anglais` : ''}. Le message reste tel que vous l’écrivez${deuxVersions ? ' (ou sa version anglaise)' : ''}.`
            : `Tous reçoivent l’e-mail en ${NOMS_LANGUES[langue]}, quelle que soit la langue de leur compte.`}
        </Text>
        <Champ theme={theme} libelle="Objet" valeur={objet} onChanger={setObjet} maxLength={160} testID="admin-messagerie-objet" placeholder="Ex. : Tournoi de samedi" />
        <ZoneEcriture theme={theme} client={clientEsport} champ="messagerie" valeur={message} onChanger={setMessage} maxLength={20000} testID="admin-messagerie-ecriture">
          <ChampNote theme={theme} libelle="Message" valeur={message} onChanger={setMessage} maxLength={20000} testID="admin-messagerie-message" apercu="bouton" placeholder="Bonjour à tous, …" />
        </ZoneEcriture>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
          <Case theme={theme} coche={deuxVersions} libelle="Écrire aussi une version anglaise" onChanger={setDeuxVersions} testID="admin-messagerie-deux-versions" />
          <Text style={[texte, { flex: 1 }]}>Écrire aussi une version anglaise (chacun reçoit la sienne)</Text>
        </View>
        {deuxVersions ? (
          <View style={{ gap: 8 }} testID="admin-messagerie-version-en">
            <Text style={attenue}>Version anglaise : reçue par les destinataires en anglais (le texte ci-dessus va aux autres).</Text>
            <Champ theme={theme} libelle="Objet (English)" valeur={objetEn} onChanger={setObjetEn} maxLength={160} testID="admin-messagerie-objet-en" placeholder="E.g. Saturday’s tournament" />
            <ZoneEcriture theme={theme} client={clientEsport} champ="messagerie" valeur={messageEn} onChanger={setMessageEn} maxLength={20000} testID="admin-messagerie-ecriture-en">
              <ChampNote theme={theme} libelle="Message (English)" valeur={messageEn} onChanger={setMessageEn} maxLength={20000} testID="admin-messagerie-message-en" apercu="jamais" placeholder="Hello everyone, …" />
            </ZoneEcriture>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <BoutonHub theme={theme} titre={apercuOuvert ? 'Masquer l’aperçu de l’e-mail' : 'Aperçu de l’e-mail'} onPress={() => setApercuOuvert(v => !v)} testID="admin-messagerie-apercu-basculer" />
          {apercuOuvert && langues.length > 1 ? (
            <Segments<LangueCourriel> theme={theme} libelle="Langue de l’aperçu" valeur={langueAffichee} options={langues.map(l => [l, NOMS_LANGUES[l]] as const)} onChoisir={setLangueApercu} testID="admin-messagerie-apercu-langue" />
          ) : null}
        </View>
        {apercuOuvert ? (
          <View style={{ gap: 6 }} testID="admin-messagerie-apercu">
            {apercu === 'indisponible' ? (
              <Text style={[attenue, { color: theme.alerte }]} testID="admin-messagerie-apercu-indisponible">Aperçu indisponible (serveur injoignable ou appareil non relié).</Text>
            ) : apercu ? (
              <>
                <Text style={[texte, { fontWeight: '700' }]} testID="admin-messagerie-apercu-objet">
                  Objet ({NOMS_LANGUES[apercu.langue]}) : {apercu.objet}
                </Text>
                <CadreApercu theme={theme} apercu={apercu} />
              </>
            ) : (
              <Text style={attenue}>Écrivez l’objet et le message pour voir l’aperçu.</Text>
            )}
          </View>
        ) : null}
        {probleme && (objet || message || choisis.size) ? <Text style={[attenue, { color: theme.alerte }]}>{probleme}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <BoutonHub theme={theme} variante="plein" titre={enCours ? 'Envoi…' : `Envoyer (${destinataires.length})`} desactive={enCours} onPress={() => void envoyer()} testID="admin-messagerie-envoyer" />
          {(disponible === false || etat?.probleme) && !probleme ? (
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
      <Panneau theme={theme} testID="admin-messagerie-test">
        <Intertitre theme={theme}>Tester l’envoi</Intertitre>
        <Text style={attenue}>
          Le relais vérifie la connexion et les identifiants SMTP, puis envoie un e-mail de test à cette adresse (vide : à la boîte d’envoi elle-même{etat?.expediteur ? `, ${etat.expediteur}` : ''}). En cas d’échec, la cause exacte s’affiche.
        </Text>
        <Champ theme={theme} libelle="Adresse de test (la vôtre)" valeur={adresseTest} onChanger={setAdresseTest} maxLength={254} testID="admin-messagerie-test-adresse" placeholder="vous@exemple.fr" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <BoutonHub theme={theme} titre={testEnCours ? 'Test en cours…' : 'Tester l’envoi'} desactive={testEnCours} onPress={() => void tester()} testID="admin-messagerie-tester" />
        </View>
        {test ? <Avis theme={theme} genre={test.ok ? 'ok' : 'critique'} texte={test.message} testID="admin-messagerie-test-retour" /> : null}
      </Panneau>
      <Panneau theme={theme} testID="admin-messagerie-historique">
        <Intertitre theme={theme}>Historique des envois</Intertitre>
        <Text style={attenue}>Une copie de chaque e-mail arrive aussi dans le dossier « Envoyés » de la boîte noreply (webmail).</Text>
        {journal === undefined ? (
          <Text style={[attenue, journalIndisponible ? { color: theme.alerte } : null]} testID="admin-messagerie-historique-indisponible">
            {journalIndisponible ? `Historique indisponible : ${journalIndisponible}` : 'Lecture de l’historique…'}
          </Text>
        ) : journal.length === 0 ? <Text style={attenue}>Aucun envoi pour l’instant.</Text> : null}
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
                {dateLisible(e.date, true)} · {e.ref === 'test' ? 'Test d’envoi' : e.modele === 'invitation' ? 'Invitation' : e.modele === 'support' ? 'Réponse au support' : e.modele === 'recap' ? 'Récapitulatif' : 'Messagerie'} · {e.resultats.map(r => `${r.a}${r.statut === 'echec' ? ` ✗ ${libelleErreurCourriel(r.erreur)}` : ''}`).join(', ')}
              </Text>
            </View>
          );
        })}
      </Panneau>
    </View>
  );
}

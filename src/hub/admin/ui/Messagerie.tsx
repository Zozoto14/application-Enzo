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
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { ChampNote } from '../../../esport/ui/ChampNote';
import { trouverConfig, type Annuaire } from '../../../esport/client';
import { fabrique } from '../../../esport/fabrique';
import { apercuCourriel, courrielDisponible, envoyerCourriel, journalCourriel, libelleErreurCourriel, mailtoSecours, type ApercuCourriel, type EnvoiJournal, type LangueCourriel } from '../../../messagerie/courriel';
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
  const [disponible, setDisponible] = useState<boolean | undefined>();
  const [journal, setJournal] = useState<EnvoiJournal[] | undefined>();
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
    setEnCours(true);
    setRetour(undefined);
    const r = await envoyerCourriel({
      destinataires: destinataires.map(d => ({ adresse: d.email!, nom: d.nom, langue: langueDe(d.id) })),
      modele: 'libre',
      langue: langue === 'en' ? 'en' : 'fr',
      objet: objet.trim(),
      message,
      ...(versionEn ? { en: versionEn } : {}),
      ref: 'messagerie',
    });
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
        <ChampNote theme={theme} libelle="Message" valeur={message} onChanger={setMessage} maxLength={20000} testID="admin-messagerie-message" apercu="bouton" placeholder="Bonjour à tous, …" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
          <Case theme={theme} coche={deuxVersions} libelle="Écrire aussi une version anglaise" onChanger={setDeuxVersions} testID="admin-messagerie-deux-versions" />
          <Text style={[texte, { flex: 1 }]}>Écrire aussi une version anglaise (chacun reçoit la sienne)</Text>
        </View>
        {deuxVersions ? (
          <View style={{ gap: 8 }} testID="admin-messagerie-version-en">
            <Text style={attenue}>Version anglaise : reçue par les destinataires en anglais (le texte ci-dessus va aux autres).</Text>
            <Champ theme={theme} libelle="Objet (English)" valeur={objetEn} onChanger={setObjetEn} maxLength={160} testID="admin-messagerie-objet-en" placeholder="E.g. Saturday’s tournament" />
            <ChampNote theme={theme} libelle="Message (English)" valeur={messageEn} onChanger={setMessageEn} maxLength={20000} testID="admin-messagerie-message-en" apercu="jamais" placeholder="Hello everyone, …" />
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
        <Text style={attenue}>Une copie de chaque e-mail arrive aussi dans le dossier « Envoyés » de la boîte noreply (webmail).</Text>
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

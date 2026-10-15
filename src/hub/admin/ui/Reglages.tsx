/**
 * Section « Réglages » de l'Administration.
 *
 *  - **Comptes et invitations** (Fondateurs) : durée de validité par défaut
 *    d'une invitation, politique du mot de passe que choisit un ami (longueur,
 *    force ; portée, scellée, par l'invitation), nombre d'appareils au-delà
 *    duquel un compte est signalé ;
 *  - **Message d'invitation** (Fondateurs) : objet et corps, avec variables
 *    {prenom}, {lien}, {expiration}, {fondateur}…, aperçu en direct ;
 *  - **Sauvegarde chiffrée** (Fondateurs) : export et import des données de
 *    l'Administration, scellées par une phrase ;
 *  - le reste (journal, verrouillage du panneau, identité, comptes inactifs)
 *    est dans la page Paramètres, section Administration.
 *
 * Un Administrateur voit ces réglages en lecture seule ; un Gestionnaire n'a
 * pas cette section (voir `Administration.tsx`).
 */

import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { LIBELLES_FORCE } from '../../../profils/invitation';
import { police } from '../../themes';
import { avecModeleInvitationPar, avecReglagesComptesPar } from '../actions';
import { avecEvenement, BORNES_REGLAGES, REGLAGES_DEFAUT, type ReglagesAdmin } from '../donnees';
import { LIBELLES_VARIABLES, LONGUEUR_MAX_MAILTO, MODELE_INVITATION_DEFAUT, VARIABLES_MODELE, lienMailto, rendreModele, validerModele, type ModeleInvitation } from '../modeleInvitation';
import { autorise } from '../roles';
import { LONGUEUR_MIN_PHRASE, erreurPhrase, exporterSauvegardePar, importerSauvegardePar } from '../sauvegarde';
import { Avis, BoutonHub, Champ, Intertitre, Panneau, Segments, commun, type OutilsAdmin } from './commun';

type CleCompte = 'invitationJours' | 'mdpLongueurMin' | 'appareilsMax';
const CHAMPS_COMPTES: ReadonlyArray<{ cle: CleCompte; libelle: string; aide: string }> = [
  { cle: 'invitationJours', libelle: 'Validité d’une invitation (jours)', aide: 'Proposée à la création d’un compte et pour les relances.' },
  { cle: 'mdpLongueurMin', libelle: 'Mot de passe des amis : longueur minimale', aide: 'Exigée quand l’ami choisit son mot de passe par l’invitation.' },
  { cle: 'appareilsMax', libelle: 'Appareils par compte avant alerte', aide: 'Au-delà, le compte est signalé au tableau de bord.' },
];

/** Exemple pour l'aperçu du modèle (rien de réel). */
const EXEMPLE = {
  prenom: 'Léa',
  lien: 'https://exemple.fr/#invitation=AI1.exemple',
  expiration: '22 octobre',
  code: 'K7M2Q-9XH4T',
  site: 'https://exemple.fr',
  connexion: 'https://exemple.fr/#relais=https://relais.exemple.fr',
};

/** Choisit un fichier texte (navigateur, app PC) ; undefined si indisponible ou annulé. */
function choisirFichier(): Promise<string | undefined> {
  type ChampFichier = { type: string; accept: string; files?: ArrayLike<{ text(): Promise<string> }> | null; onchange: (() => void) | null; click(): void };
  const doc = (globalThis as { document?: { createElement(nom: 'input'): ChampFichier } }).document;
  if (Platform.OS !== 'web' || !doc) return Promise.resolve(undefined);
  return new Promise(resoudre => {
    const champ = doc.createElement('input');
    champ.type = 'file';
    champ.accept = '.json,application/json';
    champ.onchange = () => {
      const fichier = champ.files?.[0];
      if (!fichier) return resoudre(undefined);
      fichier.text().then(resoudre, () => resoudre(undefined));
    };
    champ.click();
  });
}

export function Reglages({ outils }: { outils: OutilsAdmin }) {
  const { theme, donnees } = outils;
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const fondateur = autorise(outils.acteur, 'reglages-comptes').ok;
  const r = donnees.reglages;
  const enTexte = (reglages: ReglagesAdmin) => Object.fromEntries(CHAMPS_COMPTES.map(c => [c.cle, String(reglages[c.cle])])) as Record<CleCompte, string>;
  const [brouillon, setBrouillon] = useState(() => enTexte(r));
  const [force, setForce] = useState(String(r.mdpForceMin));
  const [message, setMessage] = useState<string | undefined>();
  const modeleActuel = donnees.modeleInvitation ?? MODELE_INVITATION_DEFAUT;
  const [objet, setObjet] = useState(modeleActuel.objet);
  const [corps, setCorps] = useState(modeleActuel.corps);
  const [messageModele, setMessageModele] = useState<string | undefined>();
  const [phrase, setPhrase] = useState('');
  const [phrase2, setPhrase2] = useState('');
  const [messageSauvegarde, setMessageSauvegarde] = useState<{ texte: string; genre: 'ok' | 'critique' | 'info' } | undefined>();
  const [aImporter, setAImporter] = useState<string | undefined>();
  const [phraseImport, setPhraseImport] = useState('');

  const modele: ModeleInvitation = { objet, corps };
  const erreursModele = validerModele(modele);
  const valeursApercu = { ...EXEMPLE, fondateur: outils.acteur.nom && outils.acteur.nom !== 'Moi' ? outils.acteur.nom : 'Ton administrateur', longueur: String(r.mdpLongueurMin) };
  const apercu = erreursModele.length === 0 ? rendreModele(modele, valeursApercu) : undefined;
  const longueurMailto = apercu ? lienMailto('lea@exemple.fr', apercu, valeursApercu, Number.MAX_SAFE_INTEGER).url.length : 0;

  const enregistrerComptes = () => {
    const changement: Partial<ReglagesAdmin> = { mdpForceMin: Number(force) };
    for (const { cle } of CHAMPS_COMPTES) {
      const n = Number(brouillon[cle]);
      if (brouillon[cle].trim() !== '' && Number.isFinite(n)) changement[cle] = n;
    }
    try {
      let enregistrees: ReglagesAdmin | undefined;
      outils.majDonnees(d => {
        const suivantes = avecReglagesComptesPar(outils.acteur, d, changement, outils.maintenant());
        enregistrees = suivantes.reglages;
        const modifies = [...CHAMPS_COMPTES.map(c => c.cle), 'mdpForceMin' as const].filter(c => d.reglages[c] !== suivantes.reglages[c]);
        if (modifies.length === 0) return suivantes;
        const resume = modifies
          .map(c => (c === 'mdpForceMin' ? `force minimale : ${LIBELLES_FORCE[suivantes.reglages.mdpForceMin]}` : `${CHAMPS_COMPTES.find(x => x.cle === c)?.libelle.toLowerCase()} : ${suivantes.reglages[c]}`))
          .join(' ; ');
        return avecEvenement(suivantes, { type: 'reglages', action: `Réglages des comptes modifiés (${resume})` }, outils.maintenant());
      });
      if (enregistrees) {
        setBrouillon(enTexte(enregistrees));
        setForce(String(enregistrees.mdpForceMin));
      }
      setMessage('Réglages enregistrés (valeurs ramenées dans leurs bornes si besoin). Ils s’appliquent aux prochaines invitations.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const enregistrerModele = (nouveau: ModeleInvitation | undefined) => {
    try {
      outils.majDonnees(d =>
        avecEvenement(
          avecModeleInvitationPar(outils.acteur, d, nouveau),
          { type: 'reglages', action: nouveau ? 'Modèle du message d’invitation modifié' : 'Modèle du message d’invitation rétabli (par défaut)' },
          outils.maintenant(),
        ),
      );
      if (!nouveau) {
        setObjet(MODELE_INVITATION_DEFAUT.objet);
        setCorps(MODELE_INVITATION_DEFAUT.corps);
      }
      setMessageModele(nouveau ? 'Modèle enregistré : il sert aux prochaines invitations.' : 'Modèle par défaut rétabli.');
    } catch (e) {
      setMessageModele(e instanceof Error ? e.message : String(e));
    }
  };

  const exporter = () => {
    const enregistrer = outils.services?.enregistrerFichier;
    if (!enregistrer) {
      setMessageSauvegarde({ texte: 'Export indisponible sur cette plateforme.', genre: 'critique' });
      return;
    }
    const phraseChoisie = phrase;
    outils.exigerIdentite('Exporter une sauvegarde chiffrée de l’Administration', () =>
      outils.agir('Chiffrement de la sauvegarde…', async () => {
        const contenu = exporterSauvegardePar(outils.acteur, donnees, phraseChoisie, outils.maintenant());
        const nom = `administration-${new Date(outils.maintenant()).toISOString().slice(0, 10)}.appdashboard-admin.json`;
        const fait = await enregistrer(nom, contenu, 'application/json');
        setPhrase('');
        setPhrase2('');
        if (fait) {
          outils.journaliser({ type: 'export', action: 'Sauvegarde chiffrée de l’Administration exportée' });
          setMessageSauvegarde({ texte: `Sauvegarde enregistrée : ${nom}. Gardez la phrase à part : sans elle, le fichier est illisible.`, genre: 'ok' });
        } else {
          setMessageSauvegarde({ texte: 'Export annulé.', genre: 'info' });
        }
      }),
    );
  };

  const importer = () => {
    const contenu = aImporter;
    const phraseChoisie = phraseImport;
    if (!contenu) return;
    outils.exigerIdentite('Restaurer une sauvegarde de l’Administration', () =>
      outils.agir('Déchiffrement de la sauvegarde…', async () => {
        try {
          const lues = importerSauvegardePar(outils.acteur, contenu, phraseChoisie);
          outils.majDonnees(() => avecEvenement(lues, { type: 'reglages', action: 'Sauvegarde de l’Administration restaurée' }, outils.maintenant()));
          setAImporter(undefined);
          setPhraseImport('');
          setMessageSauvegarde({ texte: `Sauvegarde restaurée : ${Object.keys(lues.contacts).length} contact(s), ${lues.journal.length} entrée(s) de journal.`, genre: 'ok' });
        } catch (e) {
          setMessageSauvegarde({ texte: e instanceof Error ? e.message : String(e), genre: 'critique' });
        }
      }),
    );
  };

  return (
    <View style={{ gap: 16 }} testID="admin-section-reglages">
      <Panneau theme={theme} testID="admin-reglages-comptes">
        <Intertitre theme={theme}>Comptes et invitations</Intertitre>
        {!fondateur ? <Avis theme={theme} genre="info" texte="Réservé aux Fondateurs : vous voyez ces réglages sans pouvoir les modifier." testID="admin-reglages-comptes-lecture" /> : null}
        <View style={commun.grille}>
          {CHAMPS_COMPTES.map(champ => (
            <View key={champ.cle} style={{ flexBasis: 220, flexGrow: 1, gap: 2 }}>
              {fondateur ? (
                <Champ
                  theme={theme}
                  libelle={champ.libelle}
                  valeur={brouillon[champ.cle]}
                  onChanger={v => setBrouillon(b => ({ ...b, [champ.cle]: v.replace(/[^\d]/g, '') }))}
                  clavier="number-pad"
                  maxLength={3}
                  testID={`admin-rc-${champ.cle}`}
                />
              ) : (
                <Text style={[texte, { fontWeight: '600' }]} testID={`admin-rc-${champ.cle}`}>
                  {champ.libelle} : {r[champ.cle]}
                </Text>
              )}
              <Text style={[attenue, { fontSize: 12 }]}>
                {champ.aide} Entre {BORNES_REGLAGES[champ.cle].min} et {BORNES_REGLAGES[champ.cle].max} (défaut {REGLAGES_DEFAUT[champ.cle]}).
              </Text>
            </View>
          ))}
        </View>
        {fondateur ? (
          <Segments
            theme={theme}
            libelle="Force minimale du mot de passe des amis"
            valeur={force}
            options={[1, 2, 3, 4].map(n => [String(n), LIBELLES_FORCE[n]] as const)}
            onChoisir={setForce}
            testID="admin-rc-force"
          />
        ) : (
          <Text style={texte}>Force minimale : {LIBELLES_FORCE[r.mdpForceMin]}</Text>
        )}
        <Text style={[attenue, { fontSize: 12 }]}>
          La politique voyage, scellée, dans chaque nouvelle invitation : l’écran de l’ami l’affiche et la fait respecter. Les règles de base restent (pas
          seulement des chiffres, pas son prénom, pas un mot de passe courant). Les invitations déjà envoyées gardent leurs règles.
        </Text>
        {fondateur ? (
          <View style={commun.actions}>
            <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Enregistrer" onPress={enregistrerComptes} testID="admin-rc-enregistrer" />
          </View>
        ) : null}
        {message ? <Avis theme={theme} genre="ok" texte={message} testID="admin-rc-message" /> : null}
      </Panneau>

      <Panneau theme={theme} testID="admin-modele-invitation">
        <Intertitre theme={theme}>Message d’invitation</Intertitre>
        <Text style={[attenue, { fontSize: 13 }]}>
          Envoyé par votre messagerie (« Envoyer l’invitation par e-mail ») ou copié pour SMS, WhatsApp… Aucun e-mail ne part d’un serveur. Une ligne dont
          la variable est vide (code court…) disparaît.
        </Text>
        {fondateur ? (
          <>
            <Champ theme={theme} libelle="Objet de l’e-mail" valeur={objet} onChanger={setObjet} maxLength={120} testID="admin-modele-objet" />
            <Champ theme={theme} libelle="Message" valeur={corps} onChanger={setCorps} multiligne maxLength={2000} testID="admin-modele-corps" />
            <Text style={[attenue, { fontSize: 12 }]}>Variables : {VARIABLES_MODELE.map(v => `{${v}} (${LIBELLES_VARIABLES[v]})`).join(' · ')}</Text>
            {erreursModele.map(e => (
              <Text key={e} style={{ color: theme.critique, fontSize: 12 }} testID="admin-modele-erreur">
                {e}
              </Text>
            ))}
            <View style={commun.actions}>
              <BoutonHub
                theme={theme}
                variante="plein"
                couleur={theme.teintes.admin}
                titre="Enregistrer le modèle"
                desactive={erreursModele.length > 0}
                onPress={() => enregistrerModele(modele)}
                testID="admin-modele-enregistrer"
              />
              <BoutonHub theme={theme} titre="Rétablir le modèle par défaut" onPress={() => enregistrerModele(undefined)} testID="admin-modele-defaut" />
            </View>
            {messageModele ? <Avis theme={theme} genre="ok" texte={messageModele} testID="admin-modele-message" /> : null}
          </>
        ) : null}
        {apercu ? (
          <View style={[commun.avis, { borderLeftColor: theme.teintes.admin, gap: 4 }]} testID="admin-modele-apercu">
            <Text style={[texte, { fontWeight: '700', fontSize: 13 }]}>Aperçu · Objet : {apercu.objet}</Text>
            <Text style={[texte, { fontSize: 12 }]} selectable>
              {apercu.corps}
            </Text>
            <Text style={[attenue, { fontSize: 11 }]}>
              Lien e-mail : {longueurMailto} caractères sur {LONGUEUR_MAX_MAILTO}
              {longueurMailto > LONGUEUR_MAX_MAILTO ? ' — trop long : l’e-mail contiendra une version courte (le message complet reste copiable)' : ''}.
            </Text>
          </View>
        ) : null}
      </Panneau>

      {fondateur ? (
        <Panneau theme={theme} testID="admin-sauvegarde">
          <Intertitre theme={theme}>Sauvegarde chiffrée de l’Administration</Intertitre>
          <Text style={[attenue, { fontSize: 13 }]}>
            Réglages, modèle d’invitation, adresses e-mail, notes, journal, abonnements et prospects, dans un fichier scellé par une phrase que vous
            choisissez (Argon2id + XChaCha20-Poly1305). Aucun mot de passe ni clé d’accès n’y figure. Rien n’est envoyé : le fichier reste où vous
            l’enregistrez.
          </Text>
          <View style={commun.grille}>
            <Champ
              theme={theme}
              libelle={`Phrase de sauvegarde (${LONGUEUR_MIN_PHRASE} caractères au moins)`}
              valeur={phrase}
              onChanger={setPhrase}
              secret
              testID="admin-sauvegarde-phrase"
              style={{ flexBasis: 220, flexGrow: 1 }}
            />
            <Champ theme={theme} libelle="Confirmez la phrase" valeur={phrase2} onChanger={setPhrase2} secret testID="admin-sauvegarde-phrase2" style={{ flexBasis: 220, flexGrow: 1 }} />
          </View>
          {phrase && erreurPhrase(phrase, phrase2) ? <Text style={{ color: theme.alerte, fontSize: 12 }}>{erreurPhrase(phrase, phrase2)}</Text> : null}
          <View style={commun.actions}>
            <BoutonHub
              theme={theme}
              titre="Exporter la sauvegarde chiffrée"
              desactive={Boolean(erreurPhrase(phrase, phrase2)) || !outils.services?.enregistrerFichier}
              onPress={exporter}
              testID="admin-sauvegarde-exporter"
            />
            {Platform.OS === 'web' ? (
              <BoutonHub
                theme={theme}
                titre="Restaurer une sauvegarde…"
                onPress={() =>
                  void choisirFichier().then(contenu => {
                    if (contenu) {
                      setAImporter(contenu);
                      setMessageSauvegarde(undefined);
                    }
                  })
                }
                testID="admin-sauvegarde-choisir"
              />
            ) : null}
          </View>
          {aImporter ? (
            <View style={[commun.avis, { borderLeftColor: theme.alerte, gap: 8 }]} testID="admin-sauvegarde-import">
              <Text style={texte}>
                Restaurer remplace les données de l’Administration de cet appareil (puis de vos autres appareils, par la synchronisation). Les comptes eux-mêmes
                ne changent pas.
              </Text>
              <Champ theme={theme} libelle="Phrase de cette sauvegarde" valeur={phraseImport} onChanger={setPhraseImport} secret testID="admin-sauvegarde-phrase-import" />
              <View style={commun.actions}>
                <BoutonHub theme={theme} variante="danger" titre="Restaurer (mot de passe + code)" desactive={!phraseImport} onPress={importer} testID="admin-sauvegarde-restaurer" />
                <BoutonHub theme={theme} titre="Annuler" onPress={() => setAImporter(undefined)} />
              </View>
            </View>
          ) : null}
          {messageSauvegarde ? <Avis theme={theme} genre={messageSauvegarde.genre} texte={messageSauvegarde.texte} testID="admin-sauvegarde-message" /> : null}
        </Panneau>
      ) : null}

      <Panneau theme={theme}>
        <Intertitre theme={theme}>Autres réglages</Intertitre>
        <Text style={[attenue, { fontSize: 14 }]}>
          Le thème, la synchronisation, la sécurité et, dans la section Administration, la rétention du journal, le verrouillage du panneau, la validité de
          l’identité et les comptes inactifs sont dans la page Paramètres. Les apps ouvertes par défaut à un nouveau compte se règlent dans « Applications ».
        </Text>
        <View style={commun.actions}>
          <BoutonHub
            theme={theme}
            variante="plein"
            couleur={theme.teintes.admin}
            titre="Ouvrir les Paramètres"
            onPress={() => outils.onParametres?.('administration')}
            testID="admin-ouvrir-parametres"
          />
          {outils.role === 'fondateur' ? <BoutonHub theme={theme} titre="Apps par défaut →" onPress={() => outils.allerA('applications')} testID="admin-vers-applications" /> : null}
        </View>
      </Panneau>
    </View>
  );
}

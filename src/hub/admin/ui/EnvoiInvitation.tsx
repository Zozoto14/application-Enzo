/**
 * Panneau « Invitation de … » : envoyer le lien d'invitation par e-mail (la
 * messagerie de l'appareil s'ouvre, pré-remplie, par un lien `mailto:`),
 * copier le message, le partager (feuille de partage de l'iPhone/iPad), copier
 * le lien seul, ou le montrer en QR code.
 *
 * Rien ne part d'un serveur : l'e-mail est envoyé par la messagerie de
 * l'appareil, depuis la boîte du Fondateur. Chaque transmission est notée dans
 * l'historique du compte (date, canal), dans les données chiffrées de
 * l'Administration ; le journal dit « par e-mail », jamais l'adresse.
 */

import React, { useState } from 'react';
import { Linking, Platform, Share, Text, View } from 'react-native';
import { QrCode } from '../../../ui/ecrans/CarteSynchro';
import type { InvitationAffichee } from '../../../profils/identifiants';
import { police, teinteTransparente, type ThemeHub } from '../../themes';
import type { CanalInvitation } from '../contacts';
import { dateExpiration, lienMailto, prenomFondateur, rendreModele, type ModeleInvitation, type ValeursModele } from '../modeleInvitation';
import { Avis, BoutonHub, commun, dateLisible } from './commun';

/** Copie dans le presse-papiers (web, Electron) ; faux si indisponible. */
export async function copier(texte: string): Promise<boolean> {
  const presse = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  if (!presse) return false;
  try {
    await presse.writeText(texte);
    return true;
  } catch {
    return false;
  }
}

type NavigateurPartage = { share?(donnees: { title?: string; text?: string }): Promise<void> };

/** Le partage système est-il disponible ? (feuille de partage sur iPhone/iPad, Android ; absent sur la plupart des PC) */
export function partageDisponible(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof (globalThis as { navigator?: NavigateurPartage }).navigator?.share === 'function';
}

/** Ouvre la feuille de partage ; vrai si le partage a eu lieu (faux : annulé ou indisponible). */
export async function partager(titre: string, texte: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'web') {
      const resultat = await Share.share({ message: texte, title: titre });
      return resultat.action !== Share.dismissedAction;
    }
    const nav = (globalThis as { navigator?: NavigateurPartage }).navigator;
    if (!nav?.share) return false;
    await nav.share({ title: titre, text: texte });
    return true;
  } catch {
    return false;
  }
}

/** Valeurs du modèle pour une invitation affichée. */
export function valeursInvitation(invitation: InvitationAffichee, nom: string, fondateur: string | undefined): ValeursModele {
  return {
    prenom: invitation.prenom ?? nom,
    lien: invitation.lien ?? '',
    expiration: dateExpiration(invitation.expire),
    fondateur: prenomFondateur(invitation.fondateur ?? fondateur),
    code: invitation.codeCourt && invitation.site ? invitation.codeCourt : '',
    site: invitation.codeCourt && invitation.site ? invitation.site : '',
    connexion: invitation.lienConnexion ?? '',
    longueur: String(invitation.longueur ?? 10),
  };
}

/**
 * Bouton-lien `mailto:` : sur le web (site, iPhone/iPad, PC), un vrai lien
 * `<a href="mailto:…" target="_blank">` — ouvert par le navigateur sans
 * bloqueur de fenêtres, et confié par l'app PC à la messagerie du système
 * (`bureau/electron/fenetresAnnexes.mjs`) ; en natif, `Linking.openURL`.
 */
function LienEmail({ theme, url, titre, onOuvert, testID }: { theme: ThemeHub; url: string; titre: string; onOuvert(): void; testID: string }) {
  const lien = Platform.OS === 'web' ? ({ href: url, hrefAttrs: { target: 'blank', rel: 'noopener noreferrer' } } as object) : {};
  return (
    <Text
      {...lien}
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={titre}
      onPress={() => {
        onOuvert();
        if (Platform.OS !== 'web') void Linking.openURL(url).catch(() => undefined);
      }}
      style={{
        backgroundColor: theme.teintes.admin,
        color: theme.surAccent,
        fontWeight: '700',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: theme.rayonGrand ? 999 : Math.min(theme.rayonMoyen, 10),
        overflow: 'hidden',
        textDecorationLine: 'none',
        minHeight: 40,
        ...police(theme.policeTexte),
      }}>
      {titre}
    </Text>
  );
}

/** Lien d'invitation, e-mail, copie, partage, QR code et code court. */
export function PanneauInvitation({
  theme,
  nom,
  invitation,
  email,
  modele,
  fondateur,
  onEnvoye,
}: {
  theme: ThemeHub;
  nom: string;
  invitation: InvitationAffichee;
  /** Adresse enregistrée (Administration) : destinataire du `mailto:`. */
  email?: string;
  /** Modèle personnalisé (Réglages) ; absent : modèle par défaut. */
  modele?: ModeleInvitation;
  /** Prénom de l'acteur, si l'hôte ne l'a pas mis dans l'invitation. */
  fondateur?: string;
  /** Une transmission a eu lieu (historique et journal). */
  onEnvoye?(canal: CanalInvitation): void;
}) {
  const [retour, setRetour] = useState<string | undefined>();
  const [qr, setQr] = useState(true);
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  if (invitation.erreur || !invitation.lien) {
    return <Avis theme={theme} genre="critique" texte={invitation.erreur ?? 'Invitation impossible.'} testID="admin-invitation-erreur" />;
  }
  const jour = invitation.expire ? dateLisible(invitation.expire, true) : '';
  const valeurs = valeursInvitation(invitation, nom, fondateur);
  const message = rendreModele(modele, valeurs);
  const mailto = lienMailto(email, message, valeurs);
  const copierTexte = (valeur: string, quoi: string, canal: CanalInvitation) =>
    void copier(valeur).then(ok => {
      setRetour(ok ? `${quoi} copié : collez-le dans votre messagerie.` : 'Copie impossible ici : sélectionnez le texte ci-dessous.');
      if (ok) onEnvoye?.(canal);
    });
  return (
    <View style={[commun.avis, { borderLeftColor: theme.ok, backgroundColor: teinteTransparente(theme.ok, 0.1), gap: 8 }]} testID="admin-invitation">
      <Text style={[texte, { fontWeight: '700' }]}>✉️ Invitation de {nom} — valable une fois, jusqu’au {jour}</Text>
      <Text style={[attenue, { fontSize: 13 }]}>
        Envoyez-la à {nom} : par e-mail (votre messagerie s’ouvre, message prêt), ou copiez le message pour SMS, WhatsApp… {nom} ouvre le lien, choisit SON
        mot de passe, et c’est tout : vous n’avez aucun mot de passe à transmettre.
      </Text>
      {invitation.publie === false ? (
        <Avis theme={theme} genre="alerte" texte={`Le compte de ${nom} n’est pas encore publié sur le relais : gardez l’app ouverte (déverrouillée) une minute.`} testID="admin-invitation-non-publie" />
      ) : invitation.publie ? (
        <Text style={{ color: theme.ok, fontSize: 13 }} testID="admin-invitation-publie">
          ✓ Compte publié sur le relais : {nom} peut ouvrir le lien dès maintenant.
        </Text>
      ) : null}
      {invitation.avertissement ? <Avis theme={theme} genre="alerte" texte={invitation.avertissement} testID="admin-invitation-avertissement" /> : null}
      <View style={commun.actions}>
        <LienEmail
          theme={theme}
          url={mailto.url}
          titre={email ? `✉️ Envoyer l’invitation par e-mail` : '✉️ Écrire l’e-mail d’invitation'}
          onOuvert={() => {
            setRetour(email ? `Votre messagerie s’ouvre, adressée à ${email} : vérifiez puis envoyez.` : 'Votre messagerie s’ouvre : ajoutez le destinataire, puis envoyez.');
            onEnvoye?.('email');
          }}
          testID="admin-invitation-email"
        />
        <BoutonHub theme={theme} titre="Copier le message" onPress={() => copierTexte(message.corps, 'Message', 'copie')} testID="admin-invitation-copier" />
        {partageDisponible() ? (
          <BoutonHub
            theme={theme}
            titre="Partager…"
            onPress={() =>
              void partager(message.objet, message.corps).then(fait => {
                if (fait) {
                  setRetour('Invitation partagée.');
                  onEnvoye?.('partage');
                }
              })
            }
            testID="admin-invitation-partager"
          />
        ) : null}
        <BoutonHub theme={theme} titre="Copier le lien seul" onPress={() => copierTexte(invitation.lien!, 'Lien', 'lien')} testID="admin-invitation-copier-lien" />
        <BoutonHub
          theme={theme}
          titre={qr ? 'Masquer le QR code' : 'QR code'}
          onPress={() => {
            setQr(v => !v);
            if (!qr) onEnvoye?.('qr');
          }}
          testID="admin-invitation-qr-basculer"
        />
      </View>
      {email ? (
        <Text style={[attenue, { fontSize: 12 }]} testID="admin-invitation-destinataire">
          Destinataire : {email}
        </Text>
      ) : (
        <Text style={[attenue, { fontSize: 12 }]} testID="admin-invitation-sans-email">
          Aucune adresse e-mail enregistrée pour {nom} : ajoutez-la dans sa fiche pour pré-remplir le destinataire.
        </Text>
      )}
      {mailto.raccourci ? (
        <Text style={[attenue, { fontSize: 12 }]} testID="admin-invitation-raccourci">
          Message long : l’e-mail contient une version courte (le lien et sa validité). « Copier le message » donne le texte complet.
        </Text>
      ) : null}
      <Text style={[attenue, { fontSize: 12 }]}>Aucun e-mail ne part d’un serveur : c’est votre messagerie qui l’envoie.</Text>
      {retour ? (
        <Text style={{ color: theme.ok, fontSize: 13 }} testID="admin-invitation-copie">
          {retour}
        </Text>
      ) : null}
      <Text selectable style={[texte, { fontSize: 12 }]} testID="admin-invitation-lien">
        {invitation.lien}
      </Text>
      {invitation.codeCourt ? (
        <Text style={[texte, { fontSize: 13 }]}>
          Code court (sur le site, « J’ai reçu une invitation ») :{' '}
          <Text selectable style={[police(theme.policeChiffres), { fontWeight: '700', letterSpacing: 1.5 }]} testID="admin-invitation-code-court">
            {invitation.codeCourt}
          </Text>
        </Text>
      ) : null}
      {qr ? (
        <View style={{ alignItems: 'flex-start' }}>
          <QrCode texte={invitation.lien} legende={`Invitation · ${nom}`} testID="admin-invitation-qr" />
        </View>
      ) : null}
      <Text style={[attenue, { fontSize: 12 }]}>Objet : {message.objet}</Text>
      <Text selectable style={[texte, { fontSize: 12 }]} testID="admin-invitation-message">
        {message.corps}
      </Text>
    </View>
  );
}

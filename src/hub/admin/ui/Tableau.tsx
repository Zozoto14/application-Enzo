/** Section « Tableau de bord » : chiffres clés, apps, alertes, activité récente. */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { police, teinteTransparente } from '../../themes';
import { alertesComptes, statistiques, type AlerteAdmin } from '../comptes';
import { LIBELLES_TYPE } from '../journal';
import { alertesSecurite } from './Securite';
import { dateDuJour, lignesAbo, resumeRappels } from '../../abonnements/abonnements';
import { ID_ABONNEMENTS, comptesSuivis, peutVoirAbonnements } from '../../abonnements/actionsAbo';
import { Intertitre, Panneau, commun, dateLisible, relatif, styleTitre, type OutilsAdmin } from './commun';

export function Tableau({ outils }: { outils: OutilsAdmin }) {
  const { theme, tous, apercu, registre, donnees } = outils;
  const gestionnaire = outils.role === 'gestionnaire';
  const maintenant = outils.maintenant();
  // Un gestionnaire ne reçoit que des chiffres : `apercu` ne porte aucun prénom.
  const stats = statistiques(apercu, registre, outils.politique, maintenant);
  // Échecs de vérification d'identité notés au journal ces 7 derniers jours (le relais, lui, ne communique pas
  // les tentatives refusées : sa protection anti-force brute les bloque sans les remonter).
  const echecsIdentite = donnees.journal.filter(e => e.type === 'securite' && /^Échec/.test(e.action) && maintenant - Date.parse(e.date) < 7 * 86_400_000).length;
  const alertes: AlerteAdmin[] = [
    ...(gestionnaire ? [] : alertesSecurite(outils)),
    ...(!gestionnaire && echecsIdentite > 0
      ? [{ genre: 'securite' as const, gravite: 'alerte' as const, message: `${echecsIdentite} échec${echecsIdentite > 1 ? 's' : ''} de vérification d’identité dans l’Administration ces 7 derniers jours (voir le journal).` }]
      : []),
    ...alertesComptes(tous, maintenant, donnees.reglages.inactifJours, gestionnaire ? undefined : donnees.reglages.appareilsMax),
  ];
  const enAttente = tous
    .filter(p => !p.admin && !p.derniereConnexion && p.invitationExpireLe && p.actif !== false)
    .sort((a, b) => Date.parse(a.invitationExpireLe!) - Date.parse(b.invitationExpireLe!))
    .slice(0, 6);
  const resumeAbo = peutVoirAbonnements(outils.acteur) ? resumeRappels(lignesAbo(comptesSuivis(outils.acteur, tous), donnees.abonnements, dateDuJour(maintenant))) : undefined;
  const autres = outils.controle.gestion?.autres ?? 0;
  const recents = [...donnees.journal].reverse().slice(0, 8);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

  const chiffre = (libelle: string, valeur: number | string, testID: string, cible?: () => void) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole={cible ? 'button' : undefined}
      accessibilityLabel={`${libelle} : ${valeur}`}
      disabled={!cible}
      onPress={cible}
      style={(etat: { pressed: boolean; hovered?: boolean }) => [
        commun.panneau,
        {
          flexGrow: 1,
          flexBasis: 140,
          borderColor: etat.hovered && cible ? theme.teintes.admin : theme.ligne,
          backgroundColor: theme.surface,
          borderRadius: theme.rayonMoyen,
          gap: 4,
        },
      ]}>
      <Text style={[attenue, { fontSize: 11, fontWeight: '700', letterSpacing: 1 }]}>{libelle.toUpperCase()}</Text>
      <Text style={[styleTitre(theme), { fontSize: 30 }, police(theme.policeChiffres)]}>{valeur}</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 16 }} testID="admin-section-tableau">
      <View style={commun.grille}>
        {chiffre('Comptes', stats.total, 'admin-stat-total', () => outils.allerA('utilisateurs'))}
        {chiffre('Actifs', stats.actifs, 'admin-stat-actifs', () => outils.allerA('utilisateurs'))}
        {chiffre('Désactivés', stats.desactives, 'admin-stat-desactives', () => outils.allerA('utilisateurs'))}
        {chiffre('Invités en attente', stats.invites - stats.expirees, 'admin-stat-invites', () => outils.allerA('utilisateurs'))}
        {chiffre('Invitations expirées', stats.expirees, 'admin-stat-expirees', () => outils.allerA('utilisateurs'))}
        {gestionnaire ? null : chiffre('Appareils', stats.appareils, 'admin-stat-appareils', () => outils.allerA('utilisateurs'))}
      </View>

      {resumeAbo && resumeAbo.texte ? (
        <Pressable
          testID="admin-abonnements-rappel"
          accessibilityRole="button"
          accessibilityHint="Ouvre l’app Abonnements"
          disabled={!outils.onOuvrirApp}
          onPress={() => outils.onOuvrirApp?.(ID_ABONNEMENTS)}
          style={[commun.avis, { borderLeftColor: resumeAbo.retard > 0 ? theme.critique : theme.alerte, backgroundColor: teinteTransparente(resumeAbo.retard > 0 ? theme.critique : theme.alerte, 0.12) }]}>
          <Text style={[texte, { fontSize: 13, fontWeight: '600' }]}>🔔 {resumeAbo.texte}</Text>
        </Pressable>
      ) : null}

      {gestionnaire ? (
        <Panneau theme={theme} testID="admin-gestion-resume">
          <Intertitre theme={theme}>Vos comptes</Intertitre>
          <Text style={texte}>
            Vous gérez {tous.length} ami{tous.length > 1 ? 's' : ''} (ceux que vous avez créés).{' '}
            {autres > 0 ? `${autres} autre${autres > 1 ? 's' : ''} compte${autres > 1 ? 's' : ''} de cet appareil ne vous ${autres > 1 ? 'sont' : 'est'} pas montré${autres > 1 ? 's' : ''} : chaque compte reste isolé.` : 'Les autres comptes de cet appareil ne vous sont pas montrés : chaque compte reste isolé.'}
          </Text>
        </Panneau>
      ) : null}

      <View style={[{ gap: 16 }, outils.large && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <Panneau theme={theme} style={outils.large ? { flex: 1 } : undefined} testID="admin-alertes">
          <Intertitre theme={theme}>{`Alertes (${alertes.length})`}</Intertitre>
          {alertes.length === 0 ? <Text style={attenue}>Aucune alerte : tout est en ordre.</Text> : null}
          {alertes.map((alerte, index) => {
            const couleur = alerte.gravite === 'critique' ? theme.critique : alerte.gravite === 'alerte' ? theme.alerte : theme.accent;
            return (
              <Pressable
                key={`${alerte.genre}-${alerte.cible ?? index}`}
                testID={`admin-alerte-${alerte.genre}`}
                accessibilityRole="button"
                onPress={() => (alerte.cible ? outils.allerA('utilisateurs', alerte.cible) : outils.allerA('securite'))}
                style={[commun.avis, { borderLeftColor: couleur, backgroundColor: teinteTransparente(couleur, 0.12) }]}>
                <Text style={[texte, { fontSize: 13 }]}>{alerte.message}</Text>
              </Pressable>
            );
          })}
        </Panneau>

        <Panneau theme={theme} style={outils.large ? { flex: 1 } : undefined}>
          <Intertitre theme={theme}>Applications</Intertitre>
          {stats.parApp.map(({ app, utilisateurs, active, maintenance }) => (
            <View key={app.id} style={commun.ligne}>
              <View style={[commun.carre, { backgroundColor: theme.teintes[app.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
                <Text style={{ color: theme.surAccent, fontWeight: '700' }}>{app.icone}</Text>
              </View>
              <Text style={[texte, { flex: 1, fontWeight: '600' }]}>{app.nom}</Text>
              <Text style={[attenue, { fontSize: 13 }]}>
                {utilisateurs} utilisateur{utilisateurs > 1 ? 's' : ''}
                {!active ? ' · désactivée' : maintenance ? ' · maintenance' : ''}
              </Text>
            </View>
          ))}
          {gestionnaire ? null : (
            <Text style={[attenue, { fontSize: 13 }]} testID="admin-derniere-activite">
              Dernière activité : {stats.derniereActivite ? `${stats.derniereActivite.nom}, ${relatif(stats.derniereActivite.date, maintenant)}` : 'aucune connexion notée'}
            </Text>
          )}
        </Panneau>
      </View>

      <View style={[{ gap: 16 }, outils.large && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        {gestionnaire ? null : (
          <Panneau theme={theme} style={outils.large ? { flex: 1 } : undefined} testID="admin-dernieres-connexions">
            <Intertitre theme={theme}>Dernières connexions</Intertitre>
            {stats.dernieresConnexions.length === 0 ? <Text style={attenue}>Aucune connexion notée.</Text> : null}
            {stats.dernieresConnexions.map((c, index) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => outils.allerA('utilisateurs', c.id)}
                style={[commun.ligne, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]}>
                <Text style={[texte, { flex: 1, fontWeight: '600' }]}>{c.nom}</Text>
                <Text style={[attenue, { fontSize: 13 }]}>{relatif(c.date, maintenant)}</Text>
              </Pressable>
            ))}
          </Panneau>
        )}
        <Panneau theme={theme} style={outils.large ? { flex: 1 } : undefined} testID="admin-invitations-attente">
          <Intertitre theme={theme}>{`Invitations en attente (${enAttente.length})`}</Intertitre>
          {enAttente.length === 0 ? <Text style={attenue}>Aucune invitation en attente.</Text> : null}
          {enAttente.map((p, index) => {
            const expiree = maintenant >= Date.parse(p.invitationExpireLe!);
            const envoi = donnees.contacts[p.id]?.envois.slice(-1)[0];
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                onPress={() => outils.allerA('utilisateurs', p.id)}
                style={[commun.ligne, { flexWrap: 'wrap' }, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]}
                testID={`admin-attente-${p.id}`}>
                <Text style={[texte, { flex: 1, fontWeight: '600' }]}>{p.nom}</Text>
                <Text style={[{ fontSize: 13, color: expiree ? theme.alerte : theme.attenue }, police(theme.policeTexte)]}>
                  {expiree ? `expirée ${relatif(p.invitationExpireLe, maintenant)}` : `expire ${relatif(p.invitationExpireLe, maintenant)}`}
                  {envoi ? ` · envoyée ${relatif(envoi.date, maintenant)}` : ' · jamais envoyée'}
                </Text>
              </Pressable>
            );
          })}
        </Panneau>
      </View>

      <Panneau theme={theme}>
        <View style={[commun.ligne, { justifyContent: 'space-between', paddingVertical: 0 }]}>
          <Intertitre theme={theme}>{gestionnaire ? 'Vos dernières actions' : 'Activité récente'}</Intertitre>
          <Pressable accessibilityRole="link" onPress={() => outils.allerA('journal')} testID="admin-voir-journal">
            <Text style={{ color: theme.teintes.admin, fontWeight: '600' }}>Tout le journal →</Text>
          </Pressable>
        </View>
        {recents.length === 0 ? <Text style={attenue}>Rien pour l’instant.</Text> : null}
        {recents.map((e, index) => (
          <View key={`${e.date}-${index}`} style={[commun.ligne, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]}>
            <Text style={[attenue, { fontSize: 12, width: 120 }, police(theme.policeChiffres)]}>{dateLisible(e.date, true)}</Text>
            <Text style={[texte, { flex: 1, fontSize: 13 }]}>
              <Text style={{ fontWeight: '700' }}>{LIBELLES_TYPE[e.type]}</Text> · {e.acteur ? `[${e.acteur}] ` : ''}{e.action}
            </Text>
          </View>
        ))}
      </Panneau>
    </View>
  );
}

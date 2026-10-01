/**
 * Bandeau d'abonnement du hub :
 *  - pour un Fondateur : la cloche « 2 abonnements en retard, 3 échéances cette
 *    semaine » (rien s'il n'y a rien à signaler), avec un accès direct à la section ;
 *  - pour un utilisateur : SON rappel amical, si l'administrateur l'a activé et
 *    que son échéance approche ou est dépassée, affiché une fois par jour.
 *
 * Informatif seulement : aucun blocage, aucune action automatique.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub } from '../Hub';
import { useMobile } from '../../ui/mobile/useMobile';
import { chargerDonnees } from '../admin/donnees';
import { autorise } from '../admin/roles';
import { demanderSectionAdmin } from '../admin/navigation';
import { police, teinteTransparente, type ThemeHub } from '../themes';
import type { ContexteHub } from '../types';
import { dateDuJour, lignesAbo, notificationDuJour, rappelPourAmi, resumeRappels } from './abonnements';
import { comptesSuivis } from './actionsAbo';

export const CLE_RAPPEL_AMI_VU = 'hub.abonnement.rappelVu';
export const CLE_NOTIF_ADMIN_VUE = 'admin.abonnements.notifVue';

/** Résumé pour l'administrateur du contexte (rien si ce n'est pas un Fondateur ou sans services d'administration). */
export function resumeAdminDuContexte(contexte: ContexteHub, maintenant: number) {
  const services = contexte.admin;
  const acteur = contexte.profil;
  if (!services || !acteur || !autorise(acteur, 'abonnements-voir').ok) return undefined;
  const donnees = chargerDonnees(services.stockage);
  const suivis = comptesSuivis(acteur, contexte.profils?.tous ?? []);
  const lignes = lignesAbo(suivis, donnees.abonnements, dateDuJour(maintenant));
  return { resume: resumeRappels(lignes), reglages: donnees.abonnements.reglages };
}

/** Notification système (Electron) ou du navigateur si déjà autorisée ; jamais de demande d'autorisation ici. */
export async function notifierLocalement(titre: string, corps: string): Promise<boolean> {
  try {
    const g = globalThis as {
      applibourse?: { systeme?: { notifier?(t: string, c: string): Promise<boolean> } };
      Notification?: { permission?: string; new (t: string, o?: { body?: string }): unknown };
    };
    if (g.applibourse?.systeme?.notifier) return await g.applibourse.systeme.notifier(titre, corps);
    if (g.Notification && g.Notification.permission === 'granted') {
      new g.Notification(titre, { body: corps });
      return true;
    }
  } catch {
    // Notifications indisponibles.
  }
  return false;
}

export function BandeauAbonnement({
  contexte,
  theme,
  onOuvrirAdministration,
}: {
  contexte: ContexteHub;
  theme: ThemeHub;
  onOuvrirAdministration?(): void;
}) {
  const maintenant = contexte.maintenant ?? Date.now();
  const version = contexte.profils?.versionComptes ?? 0;
  const admin = useMemo(() => {
    try {
      return resumeAdminDuContexte(contexte, maintenant);
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relu quand la synchronisation reçoit quelque chose.
  }, [contexte.admin, contexte.profil, contexte.profils?.tous, version, maintenant]);

  const aujourdhui = dateDuJour(maintenant);

  // Notification locale de l'administrateur : à l'ouverture, puis une fois par jour si l'app reste ouverte.
  useEffect(() => {
    if (!admin || !contexte.baseProfil) return undefined;
    const base = contexte.baseProfil;
    const verifier = () => {
      try {
        const jour = dateDuJour(Date.now());
        const n = notificationDuJour(admin.resume, admin.reglages, base.lire(CLE_NOTIF_ADMIN_VUE) ?? undefined, jour);
        if (!n) return;
        base.ecrire(CLE_NOTIF_ADMIN_VUE, jour);
        void notifierLocalement(n.titre, n.corps);
      } catch {
        // Une notification manquée n'empêche rien : le bandeau reste affiché.
      }
    };
    verifier();
    const minuteur = setInterval(verifier, 3_600_000);
    return () => clearInterval(minuteur);
  }, [admin, contexte.baseProfil]);

  const [rappel] = useState(() => {
    const projection = contexte.profils?.abonnement;
    if (!projection || contexte.admin) return undefined;
    let dernier: string | undefined;
    try {
      dernier = contexte.baseProfil?.lire(CLE_RAPPEL_AMI_VU) ?? undefined;
    } catch {
      dernier = undefined;
    }
    const r = rappelPourAmi(projection, aujourdhui, dernier, contexte.profil?.nom ?? '');
    if (r) {
      try {
        contexte.baseProfil?.ecrire(CLE_RAPPEL_AMI_VU, aujourdhui);
      } catch {
        // Le rappel s'affichera de nouveau : sans gravité.
      }
    }
    return r;
  });
  const [ferme, setFerme] = useState(false);
  // Téléphone : texte de 16 px, bouton « OK » de 44 px.
  const mobile = useMobile();
  const texte = { color: theme.texte, ...police(theme.policeTexte), ...(mobile ? { fontSize: 16, lineHeight: 22 } : {}) };

  if (admin && admin.resume.texte) {
    const couleur = admin.resume.retard > 0 ? theme.critique : theme.alerte;
    return (
      <View
        testID="hub-abonnements-admin"
        accessibilityRole="alert"
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: couleur, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: teinteTransparente(couleur, 0.14) }}>
        <Text style={{ fontSize: 18 }} accessibilityLabel="Cloche">
          🔔
        </Text>
        <Text style={[texte, { flex: 1, minWidth: 200, fontWeight: '600' }]} testID="hub-abonnements-texte">
          {admin.resume.texte}
        </Text>
        {onOuvrirAdministration ? (
          <BoutonHub
            theme={theme}
            titre="Voir les abonnements"
            onPress={() => {
              demanderSectionAdmin('abonnements');
              onOuvrirAdministration();
            }}
            testID="hub-abonnements-voir"
          />
        ) : null}
      </View>
    );
  }

  if (rappel && !ferme) {
    const couleur = rappel.statut === 'en-retard' ? theme.alerte : theme.accent;
    return (
      <View
        testID="hub-abonnement-rappel"
        accessibilityRole="alert"
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: couleur, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: teinteTransparente(couleur, 0.14) }}>
        <Text style={{ fontSize: 18 }}>💳</Text>
        <Text style={[texte, { flex: 1, minWidth: 200 }]} testID="hub-abonnement-rappel-texte">
          {rappel.message}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le rappel" onPress={() => setFerme(true)} testID="hub-abonnement-rappel-fermer" style={mobile ? { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' } : { padding: 8 }}>
          <Text style={{ color: theme.attenue, fontWeight: '700', fontSize: mobile ? 16 : undefined }}>OK</Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

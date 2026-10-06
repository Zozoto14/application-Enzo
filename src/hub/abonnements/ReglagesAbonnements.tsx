/**
 * Onglet « Réglages » de l'app Abonnements (autrefois dans Paramètres ›
 * Administration) : devise, montant et périodicité
 * par défaut, jours d'avance du rappel, moyens de paiement, règle en cas de
 * retard, rappel amical, notification et modèle du message. Réservé à qui a le
 * droit « abonnements-reglages » (Fondateur) ; chaque changement est journalisé.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../Hub';
import { chargerDonnees, enregistrerDonnees } from '../admin/donnees';
import { autorise } from '../admin/roles';
import { Avis, Champ, Interrupteur, Segments } from '../admin/ui/commun';
import { police, type ThemeHub } from '../themes';
import type { ServicesAdmin } from '../types';
import type { Profil } from '../../profils/profils';
import {
  BORNES_ABO,
  LIBELLES_PERIODICITE,
  PERIODICITES,
  centimesDepuisTexte,
  type ActionRetard,
  type Periodicite,
} from './abonnements';
import { modifierReglagesAboPar } from './actionsAbo';

const eurosTexte = (centimes: number) => (centimes / 100).toFixed(2).replace('.', ',');

export function ReglagesAbonnements({
  theme,
  services,
  acteur,
  maintenant = Date.now,
  onEnregistre,
}: {
  theme: ThemeHub;
  services: ServicesAdmin;
  acteur?: Pick<Profil, 'id' | 'admin' | 'role'>;
  maintenant?: () => number;
  /** Prévient l'app que les données ont changé (elle les relit). */
  onEnregistre?(): void;
}) {
  const permis = autorise(acteur, 'abonnements-reglages').ok;
  const [courant, setCourant] = useState(() => chargerDonnees(services.stockage).abonnements.reglages);
  const [devise, setDevise] = useState(courant.devise);
  const [montant, setMontant] = useState(eurosTexte(courant.montantDefaut));
  const [periodicite, setPeriodicite] = useState<Periodicite>(courant.periodiciteDefaut);
  const [jours, setJours] = useState(String(courant.joursAvance));
  const [moyens, setMoyens] = useState(courant.moyens.join(', '));
  const [modele, setModele] = useState(courant.modele);
  const [messageAmi, setMessageAmi] = useState(courant.messageAmi);
  const [actionRetard, setActionRetard] = useState<ActionRetard>(courant.actionRetard);
  const [rappelAmi, setRappelAmi] = useState(courant.rappelAmi);
  const [notification, setNotification] = useState(courant.notification);
  const [info, setInfo] = useState<{ genre: 'ok' | 'critique'; texte: string } | undefined>();
  if (!permis) return null;

  const enregistrer = () => {
    try {
      const centimes = centimesDepuisTexte(montant);
      if (centimes === undefined) {
        setInfo({ genre: 'critique', texte: 'Montant invalide (ex. 5,00).' });
        return;
      }
      const donnees = chargerDonnees(services.stockage);
      const suivantes = modifierReglagesAboPar(
        acteur,
        donnees,
        {
          devise,
          montantDefaut: centimes,
          periodiciteDefaut: periodicite,
          joursAvance: Number(jours.replace(/[^\d]/g, '')) || courant.joursAvance,
          moyens: moyens.split(/[,;\n]/).map(m => m.trim()).filter(Boolean),
          modele,
          messageAmi,
          actionRetard,
          rappelAmi,
          notification,
        },
        maintenant(),
      );
      enregistrerDonnees(services.stockage, suivantes);
      onEnregistre?.();
      const r = suivantes.abonnements.reglages;
      setCourant(r);
      setDevise(r.devise);
      setMontant(eurosTexte(r.montantDefaut));
      setJours(String(r.joursAvance));
      setMoyens(r.moyens.join(', '));
      setInfo({ genre: 'ok', texte: 'Réglages des abonnements enregistrés.' });
    } catch (e) {
      setInfo({ genre: 'critique', texte: e instanceof Error ? e.message : String(e) });
    }
  };

  const attenue = { color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 12, marginTop: 16 }} testID="parametres-abonnements">
      <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }}>Réglages des abonnements</Text>
      <Text style={attenue}>
        Suivi manuel et informatif : aucun paiement ni coupure automatique. Ce n’est pas un conseil fiscal ou juridique.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Champ theme={theme} libelle="Devise" valeur={devise} onChanger={setDevise} maxLength={BORNES_ABO.devise} testID="abo-reglage-devise" style={{ width: 100 }} />
        <Champ theme={theme} libelle="Montant par défaut" valeur={montant} onChanger={setMontant} maxLength={10} testID="abo-reglage-montant" style={{ width: 160 }} />
        <Champ theme={theme} libelle={`Rappel (jours d’avance, ${BORNES_ABO.joursAvance.min} à ${BORNES_ABO.joursAvance.max})`} valeur={jours} onChanger={setJours} clavier="number-pad" maxLength={2} testID="abo-reglage-jours" style={{ width: 220 }} />
      </View>
      <Segments<Periodicite> theme={theme} libelle="Périodicité par défaut" valeur={periodicite} options={PERIODICITES.map(p => [p, LIBELLES_PERIODICITE[p]] as const)} onChoisir={setPeriodicite} testID="abo-reglage-periodicite" />
      <Champ theme={theme} libelle="Moyens de paiement affichés (séparés par des virgules)" valeur={moyens} onChanger={setMoyens} maxLength={400} testID="abo-reglage-moyens" placeholder="virement, espèces…" />
      <Segments<ActionRetard>
        theme={theme}
        libelle="En cas de retard"
        valeur={actionRetard}
        options={[['rappel', 'Rappel seulement'], ['restreindre', 'Restreindre l’accès (manuel)']]}
        onChoisir={setActionRetard}
        testID="abo-reglage-retard"
      />
      <Text style={attenue}>« Restreindre » ne coupe rien seul : cela débloque le bouton manuel « Suspendre pour impayé », avec confirmation.</Text>
      <Interrupteur theme={theme} libelle="Rappel amical dans le hub de chaque utilisateur (une fois par jour)" valeur={rappelAmi} onChanger={setRappelAmi} testID="abo-reglage-rappel-ami" />
      <Champ theme={theme} libelle="Message du rappel amical ({echeance}, {prenom})" valeur={messageAmi} onChanger={setMessageAmi} multiligne maxLength={BORNES_ABO.modele} testID="abo-reglage-message-ami" />
      <Interrupteur theme={theme} libelle="Notification locale (à l’ouverture, puis chaque jour)" valeur={notification} onChanger={setNotification} testID="abo-reglage-notification" />
      <Champ theme={theme} libelle="Modèle du message à copier ({prenom} {montant} {echeance} {moyens} {retard})" valeur={modele} onChanger={setModele} multiligne maxLength={BORNES_ABO.modele} testID="abo-reglage-modele" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Enregistrer les abonnements" onPress={enregistrer} testID="abo-reglage-enregistrer" />
      </View>
      {info ? <Avis theme={theme} genre={info.genre} texte={info.texte} testID="abo-reglage-info" /> : null}
    </View>
  );
}

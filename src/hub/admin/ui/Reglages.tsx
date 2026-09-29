/** Section « Réglages » : journal, inactivité, invitations, apparence. */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { THEMES_HUB, police } from '../../themes';
import { BORNES_REGLAGES, REGLAGES_DEFAUT, avecReglages, type ReglagesAdmin } from '../donnees';
import { Avis, BoutonHub, Champ, Intertitre, Panneau, commun, type OutilsAdmin } from './commun';

const CHAMPS: ReadonlyArray<{ cle: keyof ReglagesAdmin; libelle: string; unite: string; aide: string }> = [
  { cle: 'retentionJours', libelle: 'Rétention du journal', unite: 'jours', aide: 'Les événements plus anciens sont effacés.' },
  { cle: 'tailleJournal', libelle: 'Taille maximale du journal', unite: 'entrées', aide: 'Au-delà, les plus anciennes sont effacées.' },
  { cle: 'verrouMinutes', libelle: 'Verrouillage du panneau après', unite: 'min d’inactivité (0 : jamais)', aide: 'Le désactiver redemande votre identité.' },
  { cle: 'confianceMinutes', libelle: 'Validité d’une vérification d’identité', unite: 'min', aide: 'Pour les actions sensibles.' },
  { cle: 'inactifJours', libelle: 'Compte signalé inactif après', unite: 'jours sans connexion', aide: 'Alerte du tableau de bord.' },
  { cle: 'invitationJours', libelle: 'Durée d’invitation par défaut', unite: 'jours', aide: 'Proposée à la création d’un compte.' },
];

export function Reglages({ outils }: { outils: OutilsAdmin }) {
  const { theme, donnees } = outils;
  const [brouillon, setBrouillon] = useState<Record<keyof ReglagesAdmin, string>>(
    () => Object.fromEntries(CHAMPS.map(c => [c.cle, String(donnees.reglages[c.cle])])) as Record<keyof ReglagesAdmin, string>,
  );
  const [message, setMessage] = useState<string | undefined>();
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };

  const enregistrer = () => {
    const changement: Partial<ReglagesAdmin> = {};
    for (const { cle } of CHAMPS) {
      const n = Number(brouillon[cle].replace(',', '.'));
      changement[cle] = Number.isFinite(n) && brouillon[cle].trim() !== '' ? n : donnees.reglages[cle];
    }
    const appliquer = () => {
      const avant = donnees.reglages;
      outils.majDonnees(d => avecReglages(d, changement, outils.maintenant()));
      const apres = avecReglages(donnees, changement, outils.maintenant()).reglages;
      setBrouillon(Object.fromEntries(CHAMPS.map(c => [c.cle, String(apres[c.cle])])) as Record<keyof ReglagesAdmin, string>);
      const modifies = CHAMPS.filter(c => avant[c.cle] !== apres[c.cle]).map(c => `${c.libelle.toLowerCase()} : ${apres[c.cle]} ${c.unite.split(' ')[0]}`);
      if (modifies.length > 0) {
        outils.journaliser({ type: 'reglages', action: `Réglages modifiés (${modifies.join(' ; ')})` });
      }
      setMessage(modifies.length > 0 ? 'Réglages enregistrés (valeurs ramenées dans leurs bornes si besoin).' : 'Aucun changement.');
    };
    // Couper le verrouillage automatique affaiblit la protection : identité requise.
    if (changement.verrouMinutes === 0 && donnees.reglages.verrouMinutes !== 0) {
      outils.exigerIdentite('Désactiver le verrouillage automatique du panneau', appliquer);
    } else {
      appliquer();
    }
  };

  return (
    <View style={{ gap: 16 }} testID="admin-section-reglages">
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Administration</Intertitre>
        <View style={commun.grille}>
          {CHAMPS.map(champ => (
            <View key={champ.cle} style={{ flexBasis: 240, flexGrow: 1, gap: 2 }}>
              <Champ
                theme={theme}
                libelle={`${champ.libelle} (${champ.unite})`}
                valeur={brouillon[champ.cle]}
                onChanger={v => setBrouillon(b => ({ ...b, [champ.cle]: v.replace(/[^\d]/g, '') }))}
                clavier="number-pad"
                maxLength={5}
                testID={`admin-reglage-${champ.cle}`}
              />
              <Text style={[attenue, { fontSize: 12 }]}>
                {champ.aide} Entre {BORNES_REGLAGES[champ.cle].min} et {BORNES_REGLAGES[champ.cle].max} (défaut {REGLAGES_DEFAUT[champ.cle]}).
              </Text>
            </View>
          ))}
        </View>
        <View style={commun.actions}>
          <BoutonHub theme={theme} variante="plein" couleur={theme.teintes.admin} titre="Enregistrer les réglages" onPress={enregistrer} testID="admin-reglages-enregistrer" />
        </View>
        {message ? <Avis theme={theme} genre="ok" texte={message} testID="admin-reglages-message" /> : null}
      </Panneau>

      <Panneau theme={theme}>
        <Intertitre theme={theme}>Apparence du hub</Intertitre>
        <Text style={[attenue, { fontSize: 13 }]}>Thème de votre hub (chaque profil choisit le sien).</Text>
        <View style={commun.grille} accessibilityRole="radiogroup" accessibilityLabel="Thème du hub">
          {THEMES_HUB.map(candidat => {
            const choisi = candidat.id === theme.id;
            return (
              <Pressable
                key={candidat.id}
                testID={`admin-theme-${candidat.id}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: choisi }}
                accessibilityLabel={`Thème ${candidat.nom}`}
                disabled={!outils.onTheme}
                onPress={() => {
                  outils.onTheme?.(candidat.id);
                  outils.journaliser({ type: 'reglages', action: `Thème du hub : ${candidat.nom}` });
                }}
                style={[
                  { width: 120, padding: 10, gap: 6, borderWidth: choisi ? 2 : 1, borderColor: choisi ? theme.teintes.admin : theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), backgroundColor: candidat.fond },
                ]}>
                <View style={{ flexDirection: 'row', gap: 3 }}>
                  {[candidat.accent, candidat.teintes.portefeuille, candidat.teintes.admin].map((c, i) => (
                    <View key={i} style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c }} />
                  ))}
                </View>
                <Text style={{ color: candidat.texte, fontSize: 12, fontWeight: '600' }}>{candidat.nom}</Text>
              </Pressable>
            );
          })}
        </View>
      </Panneau>
    </View>
  );
}

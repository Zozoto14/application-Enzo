/**
 * Langue par défaut d'un compte (Esport › Membres, Fondateur seulement) : langue de l'interface Esport tant que
 * l'utilisateur n'a pas choisi la sienne, de ses e-mails (invitation, support, récapitulatif) et des réponses
 * du bot Discord. Le serveur répond 403 à tout autre rôle (Propriétaire compris) ; l'utilisateur garde la main :
 * sa propre langue (Mon profil) prime, avec « Revenir à la langue définie par l'administrateur ».
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import type { ClientEsport, CompteEsport } from '../client';
import { changerLangueCompte, langueDe } from '../comptesHub';
import { NOM_LANGUE, tr, type Langue } from '../i18n';
import { ChoixLangue } from './ChoixLangue';
import { Retours, styles as communs, useAgir } from './commun';

export function LangueCompte({ theme, client, contexte, compte, modifiable, onFait }: { theme: ThemeHub; client: ClientEsport; contexte: ContexteHub; compte: CompteEsport; modifiable: boolean; onFait(): Promise<void> | void }) {
  const actuelle: Langue = compte.horsEsport ? langueDe(contexte, compte.compte) : (compte.langueDefaut ?? langueDe(contexte, compte.compte));
  const [valeur, setValeur] = useState<Langue>(actuelle);
  const { enCours, erreur, avis, agir } = useAgir();
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  useEffect(() => setValeur(actuelle), [actuelle]);
  // Le serveur ne montre langueDefaut qu'au Fondateur : sans lui, rien à afficher (et rien à modifier).
  if (!modifiable && !compte.langueDefaut) return null;
  const choisie = compte.langueChoisie;
  return (
    <View style={{ gap: 6 }} testID={`esport-langue-compte-${compte.compte}`}>
      <Text style={attenue} testID={`esport-langue-compte-valeur-${compte.compte}`}>
        {tr('langueCompte.valeur', { langue: NOM_LANGUE[actuelle] })}
        {choisie && choisie !== actuelle ? ` · ${tr('langueCompte.choix_utilisateur', { langue: NOM_LANGUE[choisie] })}` : ''}
      </Text>
      {modifiable ? (
        <View style={[communs.ligne, { alignItems: 'flex-end' }]}>
          <ChoixLangue theme={theme} libelle={tr('langueCompte.libelle')} valeur={valeur} onChoisir={setValeur} testID={`esport-langue-compte-choix-${compte.compte}`} />
          <BoutonHub
            theme={theme}
            titre={enCours ? tr('langueCompte.enregistrement') : tr('langueCompte.enregistrer')}
            variante="plein"
            desactive={Boolean(enCours) || valeur === actuelle}
            onPress={() =>
              void agir('langue-compte', async () => {
                await changerLangueCompte(contexte, client, compte.compte, compte.pseudo, valeur, contexte.maintenant ?? Date.now());
                await onFait();
                return tr('langueCompte.enregistree', { nom: compte.pseudo, langue: NOM_LANGUE[valeur] });
              })
            }
            testID={`esport-langue-compte-enregistrer-${compte.compte}`}
          />
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`esport-langue-compte-${compte.compte}`} />
    </View>
  );
}

/**
 * Section « Accès par app » : la matrice comptes × apps, en un écran. Chaque
 * case montre le niveau du compte sur l'app (— aucun, 👁 lecture, ✓ complet) ;
 * la toucher passe au niveau suivant. Même source de vérité que la fiche du
 * compte (`definirNiveauxPar`, liste des profils revalidée par l'hôte, action
 * journalisée) ; seuls les comptes de rang inférieur sont modifiables.
 *
 * Tâches choisit elle-même à qui elle s'ouvre (équipes, `attribueeParApp`) :
 * elle n'a pas de colonne ici, ses accès se règlent dans l'app Tâches.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Profil } from '../../../profils/profils';
import { police, teinteTransparente } from '../../themes';
import type { AppHub } from '../../types';
import { definirNiveauxPar } from '../actions';
import { filtrerComptes, niveauProfil, statutCompte, LIBELLES_STATUT } from '../comptes';
import { LIBELLES_NIVEAU, niveauxDe, type NiveauAcces } from '../niveaux';
import { autorise } from '../roles';
import { Champ, Intertitre, Panneau, commun, styleTitre, type OutilsAdmin } from './commun';
import { Glyphe } from '../../../ui/icones';

const SYMBOLE: Record<NiveauAcces, string> = { aucun: '—', lecture: '👁︎', complet: '✓' };

/** Niveau suivant d'une case (cycle aucun → lecture → complet, selon ce que l'app propose). */
export function niveauSuivant(app: Pick<AppHub, 'niveaux'>, actuel: NiveauAcces): NiveauAcces {
  const possibles = niveauxDe(app);
  const index = possibles.indexOf(actuel);
  return possibles[(index + 1) % possibles.length];
}

export function Matrice({ outils }: { outils: OutilsAdmin }) {
  const { theme, tous, registre } = outils;
  const maintenant = outils.maintenant();
  const [recherche, setRecherche] = useState('');
  const apps = registre.filter(a => !a.adminSeulement && !a.attribueeParApp);
  const gereesAilleurs = registre.filter(a => a.attribueeParApp);
  const comptes = filtrerComptes(tous, { recherche, tri: 'nom' }, registre, maintenant).filter(p => !p.admin);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, ...police(theme.policeTexte) };
  const largeurNom = outils.large ? 200 : 120;

  const changer = (profil: Profil, app: AppHub) => {
    const actuel = niveauProfil(profil, app);
    const suivant = niveauSuivant(app, actuel);
    outils.modifierProfils(
      liste => definirNiveauxPar(outils.acteur, liste, profil.id, [app], { [app.id]: suivant }),
      [{ type: 'permissions', cible: profil.id, nomCible: profil.nom, app: app.id, action: `${app.nom} : ${LIBELLES_NIVEAU[suivant].toLowerCase()} pour ${profil.nom} (matrice des accès)` }],
      `${profil.nom} · ${app.nom} : ${LIBELLES_NIVEAU[suivant].toLowerCase()}.`,
    );
  };

  return (
    <View style={{ gap: 16 }} testID="admin-section-acces">
      <Panneau theme={theme}>
        <Text style={[styleTitre(theme), { fontSize: 20 }]}>Accès par app</Text>
        <Text style={[attenue, { fontSize: 13 }]}>
          Touchez une case pour passer au niveau suivant : — aucun accès, 👁︎ lecture seule, ✓ complet. Chaque changement est enregistré et inscrit au journal.
          {gereesAilleurs.length > 0 ? ` ${gereesAilleurs.map(a => a.nom).join(', ')} s’ouvre par ses équipes : ses accès se règlent dans l’app elle-même (même source de vérité).` : ''}
        </Text>
        <Champ theme={theme} libelle="Rechercher un prénom" valeur={recherche} onChanger={setRecherche} placeholder="ex. Lucas" testID="admin-matrice-recherche" />
      </Panneau>
      <Panneau theme={theme} style={{ padding: 0, gap: 0 }} testID="admin-matrice">
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ minWidth: '100%' }}>
            <View style={[commun.ligne, { paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.ligne }]}>
              <Text style={[attenue, { width: largeurNom, fontSize: 12, fontWeight: '700' }]}>COMPTE</Text>
              {apps.map(app => (
                <View key={app.id} style={{ width: 84, alignItems: 'center', gap: 2 }}>
                  <View style={[commun.carre, { backgroundColor: theme.teintes[app.teinte], borderRadius: Math.min(theme.rayonMoyen, 8) }]}>
                    <Glyphe valeur={app.icone} style={{ color: theme.surAccent, fontWeight: '700' }} />
                  </View>
                  <Text style={[texte, { fontSize: 11, textAlign: 'center' }]} numberOfLines={1}>
                    {app.nom}
                  </Text>
                </View>
              ))}
            </View>
            {comptes.length === 0 ? <Text style={[attenue, { padding: 12 }]}>Aucun compte.</Text> : null}
            {comptes.map((p, index) => {
              const modifiable = autorise(outils.acteur, 'permissions-ami', p).ok;
              return (
                <View key={p.id} style={[commun.ligne, { paddingHorizontal: 12 }, index > 0 && { borderTopWidth: 1, borderTopColor: theme.ligne }]} testID={`admin-matrice-ligne-${p.id}`}>
                  <Pressable accessibilityRole="link" accessibilityLabel={`Ouvrir la fiche de ${p.nom}`} onPress={() => outils.allerA('utilisateurs', p.id)} style={{ width: largeurNom }}>
                    <Text style={[texte, { fontWeight: '600' }]} numberOfLines={1}>
                      {p.nom}
                    </Text>
                    <Text style={[attenue, { fontSize: 11 }]} numberOfLines={1}>
                      {LIBELLES_STATUT[statutCompte(p, maintenant)]}
                      {modifiable ? '' : ' · lecture seule'}
                    </Text>
                  </Pressable>
                  {apps.map(app => {
                    const niveau = niveauProfil(p, app);
                    const actif = niveau !== 'aucun';
                    const editable = modifiable;
                    const couleur = niveau === 'complet' ? theme.ok : niveau === 'lecture' ? theme.accent : theme.ligne;
                    return (
                      <Pressable
                        key={app.id}
                        testID={`admin-matrice-${p.id}-${app.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${p.nom}, ${app.nom} : ${LIBELLES_NIVEAU[niveau]}${editable ? '. Toucher pour changer.' : ''}`}
                        accessibilityState={{ disabled: !editable, checked: actif }}
                        disabled={!editable}
                        onPress={() => changer(p, app)}
                        style={{
                          width: 84,
                          minHeight: 36,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: Math.min(theme.rayonMoyen, 8),
                          borderWidth: 1,
                          borderColor: actif ? couleur : theme.ligne,
                          backgroundColor: actif ? teinteTransparente(couleur, 0.16) : 'transparent',
                          opacity: editable ? 1 : 0.55,
                        }}>
                        <Text style={{ color: actif ? theme.texte : theme.attenue, fontWeight: '700' }}>{SYMBOLE[niveau]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </Panneau>
      <Panneau theme={theme}>
        <Intertitre theme={theme}>Légende</Intertitre>
        <Text style={[attenue, { fontSize: 12 }]}>— aucun accès · 👁︎ lecture seule · ✓ accès complet. Grisé : compte de même rang ou plus haut (lecture seule).</Text>
      </Panneau>
    </View>
  );
}

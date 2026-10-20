/**
 * « Ajouter à une team » : un compte (jamais connecté, invité, actif, avec ou
 * sans team) est ajouté à UNE OU PLUSIEURS teams d'un coup, avec un rôle (et un
 * poste facultatif) par team. Les teams où il est déjà membre sont grisées
 * (« déjà membre ») ; son pseudo existant est réutilisé (aucune double
 * saisie : le champ n'apparaît que si le nom du hub n'est pas un pseudo
 * Esport valide ou s'il est déjà pris). Une seule requête, tout ou rien :
 * `POST /comptes/:compte/teams`. Le résultat ou l'erreur du serveur s'affichent
 * ici, sous le bouton, jamais loin de l'action.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import { ErreurEsport, type Affectation, type Annuaire, type ClientEsport, type CompteEsport } from '../client';
import { MOTIF_PSEUDO } from '../comptesHub';
import { Choix, Retours, styles as communs, useAgir, Intertitre } from './commun';
import { roleParDefaut } from './CreationCompte';

type Choisie = { roleId: string; poste: string };

/** Liste en français : « A », « A et B », « A, B et C ». */
export const listeFrancaise = (noms: readonly string[]): string => (noms.length <= 1 ? (noms[0] ?? '') : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`);

export function AjoutTeams({
  theme,
  compte,
  annuaire,
  client,
  teamInitiale,
  onFait,
  onAvis,
}: {
  theme: ThemeHub;
  compte: CompteEsport;
  annuaire: Annuaire;
  client: ClientEsport;
  /** Team cochée d'avance (depuis « Membres et rôles » d'une team). */
  teamInitiale?: string;
  /** Après un ajout réussi (ou un refus : la liste est peut-être périmée) : recharger l'annuaire. */
  onFait(): Promise<void> | void;
  /** Message de réussite, aussi remonté à la page (la ligne peut disparaître d'un filtre une fois ajoutée). */
  onAvis?(message: string): void;
}) {
  const teams = annuaire.teams.filter(t => t.droits.ajouter && !t.archivee);
  const dejaMembre = (teamId: string) => compte.appartenances.some(a => a.teamId === teamId);
  const [choisies, setChoisies] = useState<Record<string, Choisie>>(() => {
    const t = teams.find(x => x.id === teamInitiale && !compte.appartenances.some(a => a.teamId === x.id));
    const role = t ? roleParDefaut(t) : undefined;
    return t && role ? { [t.id]: { roleId: role, poste: '' } } : {};
  });
  const [pseudo, setPseudo] = useState(compte.pseudo);
  const [pseudoPris, setPseudoPris] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };

  // Compte du hub sans fiche Esport : le pseudo du hub est repris tel quel, sauf s'il n'est pas valide ou déjà pris.
  const pseudoAChoisir = Boolean(compte.horsEsport) && (!MOTIF_PSEUDO.test(compte.pseudo.trim()) || pseudoPris);
  const pseudoFinal = (pseudoAChoisir ? pseudo : compte.pseudo).trim();
  const affectations: Affectation[] = teams
    .filter(t => choisies[t.id] && !dejaMembre(t.id))
    .map(t => ({ teamId: t.id, roleId: choisies[t.id].roleId, ...(choisies[t.id].poste.trim() ? { posteJeu: choisies[t.id].poste.trim() } : {}) }));
  const nomsChoisis = affectations.map(a => teams.find(t => t.id === a.teamId)?.nom ?? '?');
  const probleme = compte.horsEsport && !MOTIF_PSEUDO.test(pseudoFinal) ? 'Pseudo Esport : 2 à 24 caractères (lettres, chiffres, espace, _ . -).' : undefined;
  const libres = teams.filter(t => !dejaMembre(t.id)).length;

  const valider = () =>
    void agir('Ajout', async () => {
      try {
        const fiche = await client.ajouterATeams(compte.compte, { affectations, ...(compte.horsEsport ? { pseudo: pseudoFinal } : {}) });
        setChoisies({});
        setPseudoPris(false);
        await onFait();
        const message = `${fiche?.pseudo ?? pseudoFinal} est ajouté à ${listeFrancaise(nomsChoisis)}${compte.horsEsport || compte.statut === 'invite' ? ' : il verra ses teams à sa prochaine ouverture de l’Esport.' : '.'}`;
        onAvis?.(message);
        return message;
      } catch (e) {
        if (e instanceof ErreurEsport && e.code === 'pseudo-pris') setPseudoPris(true);
        // Refus du serveur : la liste affichée est peut-être périmée (ajout fait depuis un autre appareil).
        await Promise.resolve(onFait()).catch(() => undefined);
        throw e;
      }
    });

  return (
    <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.ligne }} testID={`esport-ajout-${compte.compte}`}>
      <Intertitre theme={theme}>Ajouter à une team</Intertitre>
      {teams.length === 0 ? <Text style={attenue}>Aucune team où vous pouvez ajouter des membres.</Text> : <Text style={attenue}>Cochez une ou plusieurs teams, avec un rôle par team.</Text>}
      {teams.map(t => {
        const membre = dejaMembre(t.id);
        const c = choisies[t.id];
        return (
          <View key={t.id} style={{ gap: 8, paddingVertical: 4, opacity: membre ? 0.55 : 1 }} testID={`esport-ajout-ligne-${compte.compte}-${t.slug}`}>
            <View style={communs.ligne}>
              {membre ? (
                <View style={{ width: 22, height: 22 }} />
              ) : (
                <Case
                  theme={theme}
                  coche={Boolean(c)}
                  libelle={`Ajouter à ${t.nom}`}
                  onChanger={v =>
                    setChoisies(avant => {
                      const suite = { ...avant };
                      const role = roleParDefaut(t);
                      if (v && role) suite[t.id] = { roleId: role, poste: '' };
                      else delete suite[t.id];
                      return suite;
                    })
                  }
                  testID={`esport-ajout-team-${compte.compte}-${t.slug}`}
                />
              )}
              <Text style={[texte, { fontWeight: '700' }]}>{t.nom}</Text>
              {membre ? (
                <Text style={attenue} testID={`esport-ajout-deja-${compte.compte}-${t.slug}`}>
                  déjà membre
                </Text>
              ) : null}
            </View>
            {c && !membre ? (
              <View style={{ gap: 8, paddingLeft: 30 }}>
                <Choix
                  theme={theme}
                  libelle={`Rôle dans ${t.nom}`}
                  valeur={c.roleId}
                  options={t.roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur, desactive: !r.attribuable }))}
                  onChoisir={roleId => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], roleId } }))}
                  testID={`esport-ajout-role-${compte.compte}-${t.slug}`}
                />
                <Champ
                  theme={theme}
                  libelle="Poste en jeu (facultatif)"
                  valeur={c.poste}
                  onChanger={poste => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], poste } }))}
                  maxLength={30}
                  testID={`esport-ajout-poste-${compte.compte}-${t.slug}`}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {teams.length > 0 && libres === 0 ? <Text style={attenue} testID={`esport-ajout-toutes-${compte.compte}`}>{`${compte.pseudo} est déjà membre de toutes vos teams.`}</Text> : null}
      {pseudoAChoisir ? (
        <>
          <Text style={attenue}>{pseudoPris ? 'Ce pseudo est déjà pris dans l’Esport : choisissez-en un autre.' : 'Le nom du compte n’est pas un pseudo Esport valide : choisissez-en un.'}</Text>
          <Champ theme={theme} libelle="Pseudo Esport" valeur={pseudo} onChanger={setPseudo} maxLength={24} testID={`esport-ajout-pseudo-${compte.compte}`} />
        </>
      ) : null}
      {affectations.length > 0 && probleme ? <Text style={[attenue, { color: theme.alerte }]}>{probleme}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`esport-ajout-${compte.compte}`} />
      {libres > 0 ? (
        <View style={communs.ligne}>
          <BoutonHub
            theme={theme}
            titre={enCours ? 'Ajout…' : affectations.length > 1 ? `Ajouter à ${affectations.length} teams` : affectations.length === 1 ? `Ajouter à ${nomsChoisis[0]}` : 'Ajouter'}
            variante="plein"
            desactive={Boolean(enCours) || affectations.length === 0 || Boolean(probleme)}
            onPress={valider}
            testID={`esport-ajout-valider-${compte.compte}`}
          />
        </View>
      ) : null}
    </View>
  );
}

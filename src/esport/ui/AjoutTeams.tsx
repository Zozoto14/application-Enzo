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
import { ErreurEsport, type Affectation, type Annuaire, type ClientEsport, type CompteEsport, nomRole } from '../client';
import { MOTIF_PSEUDO } from '../comptesHub';
import { Choix, Retours, styles as communs, useAgir, Intertitre } from './commun';
import { roleParDefaut } from './CreationCompte';
import { tr } from '../i18n';

type Choisie = { roleId: string; poste: string };

/** Liste dans la langue courante : « A », « A et B », « A, B et C » / « A, B and C ». */
export const listeTeams = (noms: readonly string[]): string => (noms.length <= 1 ? (noms[0] ?? '') : tr('ajoutTeams.liste_et', { debut: noms.slice(0, -1).join(', '), fin: noms[noms.length - 1] }));

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
  const probleme = compte.horsEsport && !MOTIF_PSEUDO.test(pseudoFinal) ? tr('ajoutTeams.pseudo_esport_2_a') : undefined;
  const libres = teams.filter(t => !dejaMembre(t.id)).length;

  const valider = () =>
    void agir('ajout', async () => {
      try {
        const fiche = await client.ajouterATeams(compte.compte, { affectations, ...(compte.horsEsport ? { pseudo: pseudoFinal } : {}) });
        setChoisies({});
        setPseudoPris(false);
        await onFait();
        const message = tr(compte.horsEsport || compte.statut === 'invite' ? 'ajoutTeams.ajoute_invite' : 'ajoutTeams.ajoute', { pseudo: fiche?.pseudo ?? pseudoFinal, teams: listeTeams(nomsChoisis) });
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
      <Intertitre theme={theme}>{tr('ajoutTeams.ajouter_a_une_team')}</Intertitre>
      {teams.length === 0 ? <Text style={attenue}>{tr('ajoutTeams.aucune_team_ou_vous')}</Text> : <Text style={attenue}>{tr('ajoutTeams.cochez_une_ou_plusieurs')}</Text>}
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
                  libelle={tr('ajoutTeams.ajouter_a', { nom: t.nom })}
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
                  {tr('ajoutTeams.deja_membre')}</Text>
              ) : null}
            </View>
            {c && !membre ? (
              <View style={{ gap: 8, paddingLeft: 30 }}>
                <Choix
                  theme={theme}
                  libelle={tr('ajoutTeams.role_dans', { nom: t.nom })}
                  valeur={c.roleId}
                  options={t.roles.map(r => ({ id: r.id, nom: nomRole(r.nom), couleur: r.couleur, desactive: !r.attribuable }))}
                  onChoisir={roleId => setChoisies(avant => ({ ...avant, [t.id]: { ...avant[t.id], roleId } }))}
                  testID={`esport-ajout-role-${compte.compte}-${t.slug}`}
                />
                <Champ
                  theme={theme}
                  libelle={tr('ajoutTeams.poste_en_jeu_facultatif')}
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
      {teams.length > 0 && libres === 0 ? <Text style={attenue} testID={`esport-ajout-toutes-${compte.compte}`}>{tr('ajoutTeams.est_deja_membre_de', { pseudo: compte.pseudo })}</Text> : null}
      {pseudoAChoisir ? (
        <>
          <Text style={attenue}>{pseudoPris ? tr('ajoutTeams.ce_pseudo_est_deja') : tr('ajoutTeams.le_nom_du_compte')}</Text>
          <Champ theme={theme} libelle={tr('ajoutTeams.pseudo_esport')} valeur={pseudo} onChanger={setPseudo} maxLength={24} testID={`esport-ajout-pseudo-${compte.compte}`} />
        </>
      ) : null}
      {affectations.length > 0 && probleme ? <Text style={[attenue, { color: theme.alerte }]}>{probleme}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe={`esport-ajout-${compte.compte}`} />
      {libres > 0 ? (
        <View style={communs.ligne}>
          <BoutonHub
            theme={theme}
            titre={enCours ? tr('ajoutTeams.ajout_2') : affectations.length > 1 ? tr('ajoutTeams.ajouter_a_teams', { length: affectations.length }) : affectations.length === 1 ? tr('ajoutTeams.ajouter_a_2', { v: nomsChoisis[0] }) : tr('ajoutTeams.ajouter')}
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

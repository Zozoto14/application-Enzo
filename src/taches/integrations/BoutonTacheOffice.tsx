/**
 * « ＋ Tâche » dans le Détail d'un agent (ou d'un sous-agent) de Claude Office :
 * crée une tâche liée à la session, dans le projet choisi (par défaut le
 * projet « Claude Office » de Tâches). Fondateur seul, et seulement si le lien
 * « Claude Office » est activé dans les réglages de Tâches.
 *
 * Module de Tâches : Claude Office ne fait que l'afficher (`actionAgent`).
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { ThemeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import { FeuilleBasse } from '../../ui/mobile/FeuilleBasse';
import { roleTaches } from '../acces';
import { ecrireDonnees, lireDonnees, projetsDe } from '../modele';
import { CLES_TACHES } from '../partage';
import { Bouton, Champ, Libelle, Options } from '../ui/atomes';
import { lienActif } from './commun';
import { creerTacheOffice, idProjetAutoOffice, titrePropose, type CibleOffice } from './office';

export function BoutonTacheOffice({ theme, contexte, cible }: { theme: ThemeHub; contexte: ContexteHub; cible: CibleOffice }) {
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState('');
  const [projet, setProjet] = useState<string>(idProjetAutoOffice);
  const [fait, setFait] = useState<string>();
  const [erreur, setErreur] = useState<string>();
  const base = contexte.baseProfil;
  const d = ouvert ? lireDonnees(base?.lire(CLES_TACHES.donnees) ?? undefined) : undefined;
  const projets = d ? projetsDe(d).filter(p => !p.auto || p.auto === 'office') : [];
  const suffixe = cible.sousAgent ? `-${cible.sousAgent.slice(-8)}` : '';
  const creer = () => {
    try {
      if (!base) return;
      const x = lireDonnees(base.lire(CLES_TACHES.donnees) ?? undefined);
      const r = creerTacheOffice(x, cible, titre, projet === idProjetAutoOffice ? undefined : projet, { maintenant: contexte.maintenant ?? Date.now(), auteur: 'fondateur' });
      base.ecrire(CLES_TACHES.donnees, ecrireDonnees(r.donnees));
      setFait(`Tâche « ${r.tache.titre} » créée dans « ${r.donnees.projets[r.tache.projetId]?.nom ?? ''} ».`);
      setErreur(undefined);
      setOuvert(false);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <View style={{ gap: 4 }}>
      <Bouton
        theme={theme}
        compact={Boolean(cible.sousAgent)}
        titre={cible.sousAgent ? '＋ Tâche' : '＋ Créer une tâche'}
        libelle={cible.sousAgent ? 'Créer une tâche liée à ce sous-agent' : 'Créer une tâche liée à cette session'}
        onPress={() => {
          setTitre(titrePropose(cible));
          setFait(undefined);
          setOuvert(true);
        }}
        testID={`office-tache-creer${suffixe}`}
      />
      {fait ? (
        <Text style={{ color: theme.ok, fontSize: 15 }} testID="office-tache-faite" accessibilityLiveRegion="polite">
          {fait}
        </Text>
      ) : null}
      <FeuilleBasse
        theme={theme}
        visible={ouvert}
        titre={cible.sousAgent ? 'Tâche liée à ce sous-agent' : 'Tâche liée à cette session'}
        description="Quand l’agent aura fini, la tâche passera « En revue » ; depuis la tâche, la session s’ouvre dans l’Historique."
        onFermer={() => setOuvert(false)}
        testID="office-tache"
        pied={<Bouton theme={theme} variante="plein" titre="Créer la tâche" onPress={creer} desactive={!titre.trim()} testID="office-tache-valider" />}>
        <Libelle theme={theme}>TITRE</Libelle>
        <Champ theme={theme} mobile value={titre} onChangeText={setTitre} accessibilityLabel="Titre de la tâche" testID="office-tache-titre" />
        <Libelle theme={theme}>PROJET</Libelle>
        <Options
          theme={theme}
          valeur={projet}
          onChoisir={setProjet}
          testID="office-tache-projet"
          options={[{ valeur: idProjetAutoOffice, texte: '« Claude Office » (projet tenu par le lien)' }, ...projets.filter(p => p.auto !== 'office').map(p => ({ valeur: p.id, texte: `${d?.espaces[p.espaceId]?.nom ?? ''} › ${p.nom}` }))]}
        />
        {erreur ? <Text style={{ color: theme.critique, fontSize: 15 }}>{erreur}</Text> : null}
      </FeuilleBasse>
    </View>
  );
}

/** Ce que Claude Office affiche dans son Détail : le bouton, ou rien (autre compte, lien désactivé). */
export function actionTacheOffice(contexte: ContexteHub, theme: ThemeHub): ((cible: CibleOffice) => React.ReactNode) | undefined {
  try {
    if (roleTaches(contexte) !== 'fondateur' || !contexte.baseProfil) return undefined;
    if (!lienActif(lireDonnees(contexte.baseProfil.lire(CLES_TACHES.donnees) ?? undefined), 'office')) return undefined;
  } catch {
    return undefined;
  }
  return function ActionTache(cible: CibleOffice) {
    return <BoutonTacheOffice key={`${cible.session}-${cible.sousAgent ?? ''}`} theme={theme} contexte={contexte} cible={cible} />;
  };
}

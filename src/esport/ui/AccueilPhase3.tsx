/**
 * Blocs de l'accueil d'une team (phase 3) : derniers résumés publiés et
 * tâches en retard. Chacun n'apparaît que si son module est activé et que le
 * rôle donne la lecture correspondante.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub } from '../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../hub/themes';
import type { ClientEsport, Depot, DetailTeam, Tache } from '../client';
import { dateJour } from '../libelles';
import { styles, Intertitre, Panneau } from './commun';
import { ouvrirPdf } from './Resumes';
import { tr } from '../i18n';

export function AccueilPhase3({ theme, client, detail, onAller }: { theme: ThemeHub; client: ClientEsport; detail: DetailTeam; onAller(section: `module:${string}`): void }) {
  const actifs = new Set(detail.modules.filter(m => m.active).map(m => m.cle));
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const voitResumes = actifs.has('meeting_summaries') && ['meeting_summaries.view_summary', 'meeting_summaries.view_all', 'meeting_summaries.write_summary', 'meeting_summaries.submit'].some(peut);
  const voitTaches = actifs.has('goals_tasks') && peut('goals_tasks.view');
  const [resumes, setResumes] = useState<Depot[] | undefined>();
  const [retard, setRetard] = useState<Tache[] | undefined>();
  const teamId = detail.team.id;
  useEffect(() => {
    if (voitResumes) client.resumesTeam(teamId, 5).then(setResumes, () => setResumes([]));
    if (voitTaches) client.taches(teamId, { filtre: 'retard' }).then(r => setRetard(r.taches), () => setRetard([]));
  }, [client, teamId, voitResumes, voitTaches]);
  if (!voitResumes && !voitTaches) return null;
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  return (
    <View style={styles.ligne}>
      {voitResumes ? (
        <Panneau theme={theme} style={{ flex: 1, minWidth: 260, alignSelf: 'stretch' }} testID="esport-accueil-resumes">
          <Intertitre theme={theme}>{tr('accueilPhase3.derniers_resumes')}</Intertitre>
          {resumes?.length === 0 ? <Text style={attenue}>{tr('accueilPhase3.aucun_resume_publie_pour')}</Text> : null}
          {resumes?.map(r => (
            <View key={r.id} style={[styles.ligne, { flexWrap: 'nowrap' }]}>
              <Text style={[texte, { flex: 1 }]} numberOfLines={1}>
                {r.titre} <Text style={attenue}>· {r.type?.nom ?? ''} · {dateJour(r.dateReunion)}</Text>
              </Text>
              <BoutonHub
                theme={theme}
                titre="PDF"
                onPress={() => void ouvrirPdf(client, teamId, r.id).catch(() => undefined)}
                testID={`esport-accueil-resume-${r.id}`}
              />
            </View>
          ))}
          <BoutonHub theme={theme} titre={tr('accueilPhase3.tous_les_resumes')} onPress={() => onAller('module:meeting_summaries')} testID="esport-accueil-aller-resumes" />
        </Panneau>
      ) : null}
      {voitTaches ? (
        <Panneau theme={theme} style={{ flex: 1, minWidth: 260, alignSelf: 'stretch' }} testID="esport-accueil-retard">
          <Intertitre theme={theme}>{retard?.length ? tr('accueilPhase3.taches_en_retard_n', { n: retard.length }) : tr('accueilPhase3.taches_en_retard')}</Intertitre>
          {retard?.length === 0 ? <Text style={attenue}>{tr('accueilPhase3.rien_en_retard')}</Text> : null}
          {retard?.slice(0, 6).map(t => (
            <Text key={t.id} style={texte} numberOfLines={1} testID={`esport-accueil-retard-${t.id}`}>
              {t.titre}{' '}
              <Text style={{ color: theme.critique, fontSize: 12 }}>
                · {dateJour(t.echeance)} · {t.assigne?.pseudo ?? tr('accueilPhase3.non_assignee')}
              </Text>
            </Text>
          ))}
          <BoutonHub theme={theme} titre={tr('accueilPhase3.objectifs_et_taches')} onPress={() => onAller('module:goals_tasks')} testID="esport-accueil-aller-taches" />
        </Panneau>
      ) : null}
    </View>
  );
}

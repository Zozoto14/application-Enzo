/**
 * Fiche d'une réunion de l'équipe CM : horaire (dans le fuseau d'affichage et celui de l'organisateur), lieu ou lien
 * de visio, participants et leurs réponses, ma réponse (Accepter, Peut-être, Refuser, Proposer un autre horaire),
 * modifier / annuler (organisateur ou gestion), notes CONFIDENTIELLES (ordre du jour, compte rendu) et tâches de
 * suivi qui peuvent devenir une carte d'un tableau CM.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { ApiReunions, MoiReunions, Noms, Reunion } from '../../../cm/reunions';
import { apiCm, type ListeTableaux } from '../../../cm/api';
import { trRe } from '../../../i18n/reunions';
import { Retours, styles, useAgir } from '../../commun';
import { Badge, ESP, Volet, attenue, texte } from '../../design';
import { nomTableau } from '../commun';
import { BadgeReponse, ChoixBoutons, jourLong, quandDans } from './commun';
import { murale } from '../../../cm/reunions';

export function DetailReunion({ theme, api, id, cle, fuseau, moi, onFermer, onModifier, onChange }: { theme: ThemeHub; api: ApiReunions; id: string; cle: string; fuseau: string; moi: MoiReunions; onFermer(): void; onModifier(r: Reunion): void; onChange(): void }) {
  const [r, setR] = useState<Reunion | undefined>();
  const [noms, setNoms] = useState<Noms>({});
  const [proposer, setProposer] = useState<{ date: string; heureDebut: string; heureFin: string; commentaire: string } | undefined>();
  const [annuler, setAnnuler] = useState<{ motif: string; occurrence: boolean } | undefined>();
  const [notes, setNotes] = useState<{ ordreDuJour: string; compteRendu: string } | undefined>();
  const [tache, setTache] = useState({ texte: '', assigneA: '', echeance: '' });
  const [versCarte, setVersCarte] = useState<{ tacheId: string; tableaux?: ListeTableaux } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const recevoir = useCallback((d: { reunion: Reunion; noms: Noms }) => {
    setR(d.reunion);
    setNoms(d.noms);
    if (d.reunion.notes) setNotes({ ordreDuJour: d.reunion.notes.ordreDuJour, compteRendu: d.reunion.notes.compteRendu });
  }, []);
  useEffect(() => {
    void agir('', async () => recevoir(await api.detail(id)));
  }, [agir, api, id, recevoir]);
  const nom = (c: string | null) => (c ? (noms[c] ?? c) : '—');
  // Occurrence affichée : celle de l'agenda (série), pas la première.
  const debutOcc = r?.recurrence ? cle : r?.debut;
  const finOcc = r && debutOcc ? new Date(Date.parse(debutOcc) + Date.parse(r.fin) - Date.parse(r.debut)).toISOString() : undefined;
  const agirPuis = (cleAction: string, f: () => Promise<{ reunion: Reunion; noms: Noms }>, message?: string) =>
    void agir(cleAction, async () => {
      recevoir(await f());
      onChange();
      return message;
    });
  return (
    <Volet theme={theme} visible titre={r?.titre ?? trRe('detail.titre')} onFermer={onFermer} testID="esport-cm-reunion-detail" largeur={620}>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reunion-detail" />
      {r && debutOcc && finOcc ? (
        <View style={{ gap: ESP.m }}>
          <View style={{ gap: ESP.xxs }}>
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              {r.genre === 'rdv' ? <Badge theme={theme} ton="ok" texte={r.creneau ? trRe('detail.rdv_de', { offre: r.creneau.offre }) : trRe('detail.rdv')} /> : null}
              {r.statut === 'annulee' ? <Badge theme={theme} ton="critique" texte={r.motifAnnulation ? trRe('detail.annulee_motif', { motif: r.motifAnnulation }) : trRe('detail.annulee')} testID="esport-cm-reunion-annulee" /> : null}
            </View>
            <Text style={{ ...texte(theme, 16), fontWeight: '700' }} testID="esport-cm-reunion-quand">
              {trRe('detail.quand', { date: jourLong(murale(debutOcc, fuseau).date), debut: murale(debutOcc, fuseau).heure, fin: murale(finOcc, fuseau).heure })}
            </Text>
            {r.fuseau !== fuseau ? <Text style={attenue(theme, 12)}>{trRe('detail.fuseau_orga', { heure: quandDans(debutOcc, r.fuseau), fuseau: r.fuseau })}</Text> : null}
            <Text style={attenue(theme, 13)}>{[r.recurrence ? (r.recurrence.nombre ? trRe('detail.recurrente_n', { n: r.recurrence.nombre }) : trRe('detail.recurrente')) : '', r.rappelMinutes ? trRe('detail.rappel', { n: r.rappelMinutes }) : trRe('detail.rappel_aucun'), trRe('detail.organisateur', { qui: nom(r.organisateur) })].filter(Boolean).join(' · ')}</Text>
          </View>
          {r.lieuGenre !== 'aucun' ? (
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <Text style={texte(theme, 14)}>{`${trRe(`form.lieu.${r.lieuGenre}`)}${r.lieu ? ` · ${r.lieu}` : ''}`}</Text>
              {r.lien ? <BoutonHub theme={theme} titre={trRe('action.rejoindre')} variante="plein" onPress={() => void Linking.openURL(r.lien!)} testID="esport-cm-reunion-rejoindre" /> : null}
            </View>
          ) : null}

          {r.droits.repondre ? (
            <View style={{ gap: ESP.xs }}>
              <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trRe('detail.ma_reponse')}</Text>
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub theme={theme} titre={trRe('action.accepter')} variante={r.maReponse === 'accepte' ? 'plein' : 'normal'} onPress={() => agirPuis('reponse', () => api.repondre(r.id, { reponse: 'accepte' }))} testID="esport-cm-reunion-accepter" />
                <BoutonHub theme={theme} titre={trRe('action.peut_etre')} variante={r.maReponse === 'peut_etre' ? 'plein' : 'normal'} onPress={() => agirPuis('reponse', () => api.repondre(r.id, { reponse: 'peut_etre' }))} testID="esport-cm-reunion-peut-etre" />
                <BoutonHub theme={theme} titre={trRe('action.refuser')} variante={r.maReponse === 'refuse' ? 'plein' : 'normal'} onPress={() => agirPuis('reponse', () => api.repondre(r.id, { reponse: 'refuse' }))} testID="esport-cm-reunion-refuser" />
                <BoutonHub theme={theme} titre={trRe('action.proposer')} variante={r.maReponse === 'propose' ? 'plein' : 'normal'} onPress={() => setProposer({ date: murale(debutOcc, fuseau).date, heureDebut: murale(debutOcc, fuseau).heure, heureFin: murale(finOcc, fuseau).heure, commentaire: '' })} testID="esport-cm-reunion-proposer" />
              </View>
              {proposer ? (
                <View style={{ gap: ESP.xs }}>
                  <View style={[styles.ligne, { gap: ESP.xs }]}>
                    <Champ theme={theme} libelle={trRe('form.date')} valeur={proposer.date} onChanger={date => setProposer({ ...proposer, date })} maxLength={10} testID="esport-cm-reunion-proposer-date" style={{ minWidth: 130, flexGrow: 1 }} />
                    <Champ theme={theme} libelle={trRe('dispos.debut')} valeur={proposer.heureDebut} onChanger={heureDebut => setProposer({ ...proposer, heureDebut })} maxLength={5} testID="esport-cm-reunion-proposer-debut" style={{ minWidth: 90, flexGrow: 1 }} />
                    <Champ theme={theme} libelle={trRe('dispos.fin')} valeur={proposer.heureFin} onChanger={heureFin => setProposer({ ...proposer, heureFin })} maxLength={5} testID="esport-cm-reunion-proposer-fin" style={{ minWidth: 90, flexGrow: 1 }} />
                  </View>
                  <Champ theme={theme} libelle={trRe('action.commentaire')} valeur={proposer.commentaire} onChanger={commentaire => setProposer({ ...proposer, commentaire })} maxLength={500} testID="esport-cm-reunion-proposer-commentaire" />
                  <BoutonHub
                    theme={theme}
                    titre={trRe('action.envoyer_proposition')}
                    variante="plein"
                    onPress={() =>
                      agirPuis('proposer', async () => {
                        const d = await api.repondre(r.id, { reponse: 'propose', date: proposer.date, heureDebut: proposer.heureDebut, heureFin: proposer.heureFin, fuseau, commentaire: proposer.commentaire.trim() });
                        setProposer(undefined);
                        return d;
                      })
                    }
                    testID="esport-cm-reunion-proposer-ok"
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: ESP.xs }} testID="esport-cm-reunion-participants">
            <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trRe('detail.participants', { n: r.participants.length })}</Text>
            {r.participants.map(p => (
              <View key={p.compte} style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.xs }]} testID={`esport-cm-reunion-participant-${p.compte}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={texte(theme, 14)} numberOfLines={1}>
                    {nom(p.compte)}
                  </Text>
                  {p.commentaire ? <Text style={attenue(theme, 12)}>{p.commentaire}</Text> : null}
                  {p.proposition ? <Text style={attenue(theme, 12)}>{trRe('detail.proposition', { date: jourLong(murale(p.proposition.debut, fuseau).date), debut: murale(p.proposition.debut, fuseau).heure, fin: murale(p.proposition.fin, fuseau).heure })}</Text> : null}
                </View>
                {p.compte === r.organisateur ? <Badge theme={theme} ton="accent" texte={trRe('reponse.organisateur')} /> : <BadgeReponse theme={theme} reponse={p.reponse} />}
              </View>
            ))}
          </View>

          {r.droits.modifier ? (
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              <BoutonHub theme={theme} titre={trRe('action.modifier')} onPress={() => onModifier(r)} testID="esport-cm-reunion-modifier" />
              <BoutonHub theme={theme} titre={trRe('action.annuler_reunion')} variante="danger" onPress={() => setAnnuler({ motif: '', occurrence: false })} testID="esport-cm-reunion-annuler" />
              {r.recurrence ? <BoutonHub theme={theme} titre={trRe('action.annuler_occurrence')} variante="danger" onPress={() => setAnnuler({ motif: '', occurrence: true })} testID="esport-cm-reunion-annuler-occurrence" /> : null}
            </View>
          ) : r.genre === 'rdv' && r.statut === 'active' && r.participants.some(p => p.compte === moi.compte) ? (
            <BoutonHub theme={theme} titre={trRe('action.annuler_reunion')} variante="danger" onPress={() => setAnnuler({ motif: '', occurrence: false })} testID="esport-cm-reunion-annuler" />
          ) : null}
          {annuler ? (
            <View style={{ gap: ESP.xs }}>
              <Champ theme={theme} libelle={trRe('action.motif')} valeur={annuler.motif} onChanger={motif => setAnnuler({ ...annuler, motif })} maxLength={500} testID="esport-cm-reunion-motif" />
              <BoutonHub
                theme={theme}
                titre={trRe('action.confirmer_annulation')}
                variante="danger"
                onPress={() =>
                  agirPuis('annuler', async () => {
                    const d = await api.annuler(r.id, annuler.motif.trim(), annuler.occurrence ? cle : undefined);
                    setAnnuler(undefined);
                    if (annuler.occurrence) onFermer();
                    return d;
                  })
                }
                testID="esport-cm-reunion-annuler-ok"
              />
            </View>
          ) : null}

          {r.notes && notes ? (
            <View style={{ gap: ESP.s, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID="esport-cm-reunion-notes">
              <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{trRe('notes.titre')}</Text>
              <Badge theme={theme} ton="alerte" texte={trRe('notes.confidentiel')} testID="esport-cm-reunion-confidentiel" />
              <Champ theme={theme} libelle={trRe('notes.ordre_du_jour')} valeur={notes.ordreDuJour} onChanger={ordreDuJour => setNotes({ ...notes, ordreDuJour })} multiligne maxLength={8000} testID="esport-cm-reunion-ordre" />
              <Champ theme={theme} libelle={trRe('notes.compte_rendu')} valeur={notes.compteRendu} onChanger={compteRendu => setNotes({ ...notes, compteRendu })} multiligne maxLength={32000} testID="esport-cm-reunion-compte-rendu" />
              {r.notes.majLe ? <Text style={attenue(theme, 12)}>{trRe('notes.maj', { qui: nom(r.notes.majPar), quand: quandDans(r.notes.majLe, fuseau) })}</Text> : null}
              {notes.ordreDuJour !== r.notes.ordreDuJour || notes.compteRendu !== r.notes.compteRendu ? <BoutonHub theme={theme} titre={trRe('action.enregistrer')} variante="plein" onPress={() => agirPuis('notes', () => api.notes(r.id, notes), trRe('notes.enregistrees'))} testID="esport-cm-reunion-notes-ok" /> : null}

              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trRe('taches.titre')}</Text>
              {!r.notes.taches.length ? <Text style={attenue(theme)}>{trRe('taches.vide')}</Text> : null}
              {r.notes.taches.map(t => (
                <View key={t.id} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]} testID={`esport-cm-reunion-tache-${t.id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Case theme={theme} coche={t.fait} libelle={t.texte} onChanger={fait => agirPuis('tache', () => api.modifierTache(t.id, { fait }))} testID={`esport-cm-reunion-tache-${t.id}-fait`} />
                    <Text style={attenue(theme, 12)}>{[t.assigneA ? `${trRe('taches.assigne')} ${nom(t.assigneA)}` : '', t.echeance ?? ''].filter(Boolean).join(' · ')}</Text>
                  </View>
                  {t.carteId ? <Badge theme={theme} ton="ok" texte={trRe('taches.carte_liee')} /> : <BoutonHub theme={theme} titre={trRe('taches.vers_carte')} onPress={() => void agir('', async () => setVersCarte({ tacheId: t.id, tableaux: await apiCm(api.client).tableaux() }))} testID={`esport-cm-reunion-tache-${t.id}-carte`} />}
                  <BoutonHub theme={theme} titre="✕" libelle={trRe('taches.supprimer')} onPress={() => agirPuis('tache', () => api.supprimerTache(t.id))} testID={`esport-cm-reunion-tache-${t.id}-suppr`} />
                </View>
              ))}
              {versCarte?.tableaux ? (
                <ChoixBoutons
                  theme={theme}
                  libelle={trRe('taches.choisir_tableau')}
                  valeur={'' as string}
                  options={versCarte.tableaux.tableaux.map(x => [x.id, `${nomTableau(x)}${x.team?.nom ? ` · ${x.team.nom}` : ''}`] as const)}
                  onChoisir={tableauId =>
                    agirPuis(
                      'carte',
                      async () => {
                        const d = await api.tacheVersCarte(versCarte.tacheId, tableauId);
                        setVersCarte(undefined);
                        return d;
                      },
                      trRe('taches.carte_creee'),
                    )
                  }
                  testID="esport-cm-reunion-tableau"
                />
              ) : null}
              <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
                <Champ theme={theme} libelle={trRe('taches.nouvelle')} valeur={tache.texte} onChanger={texte_ => setTache({ ...tache, texte: texte_ })} maxLength={300} testID="esport-cm-reunion-tache-texte" style={{ flex: 2, minWidth: 200 }} />
                <Champ theme={theme} libelle={trRe('taches.echeance')} valeur={tache.echeance} onChanger={echeance => setTache({ ...tache, echeance })} maxLength={10} testID="esport-cm-reunion-tache-echeance" style={{ flex: 1, minWidth: 130 }} />
              </View>
              <ChoixBoutons theme={theme} libelle={trRe('taches.assigne')} valeur={tache.assigneA} options={[['', trRe('taches.personne')], ...r.participants.map(p => [p.compte, nom(p.compte)] as const)]} onChoisir={assigneA => setTache({ ...tache, assigneA })} testID="esport-cm-reunion-tache-assigne" />
              <BoutonHub
                theme={theme}
                titre={trRe('taches.ajouter')}
                desactive={tache.texte.trim().length < 2}
                onPress={() =>
                  agirPuis('tache', async () => {
                    const d = await api.ajouterTache(r.id, { texte: tache.texte.trim(), assigneA: tache.assigneA || null, echeance: tache.echeance.trim() || null });
                    setTache({ texte: '', assigneA: '', echeance: '' });
                    return d;
                  })
                }
                testID="esport-cm-reunion-tache-ajouter"
              />
            </View>
          ) : (
            <Text style={attenue(theme, 13)} testID="esport-cm-reunion-notes-reservees">
              {trRe('notes.reservees')}
            </Text>
          )}
        </View>
      ) : null}
    </Volet>
  );
}

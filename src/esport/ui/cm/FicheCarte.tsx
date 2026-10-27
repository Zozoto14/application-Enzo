/**
 * Fiche d'une carte de la section CM (volet) : titre, description (Markdown), étiquettes, membres,
 * échéance, couverture, team liée, checklists, pièces jointes (liens, fichiers envoyés par morceaux,
 * téléchargement), commentaires (@mentions), activité.
 *
 * Carte de contenu (« post ») : réseaux ciblés, textes FR et EN par réseau avec compteur de caractères,
 * hashtags et mentions, bouton « Copier » par réseau et par langue, date de publication prévue, liens vers un
 * match / tournoi / résultat (pré-remplissage depuis le résumé publiable), clips et joueurs liés ; circuit de
 * validation (soumettre, valider, refuser avec motif, publier avec l'adresse du post par réseau). Toute
 * modification du contenu d'un post validé le repasse « à valider » : c'est le serveur qui décide.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ApiCm, CarteDetail, DetailTableau, LiensCarte, MatchsTeam, Personne, ReponseCarte, Reseau, TeamCm, TextesPost } from '../../cm/api';
import { CLES_RESEAUX, RESEAUX, analyserTexte } from '../../cm/reseaux';
import { choisirFichier, choixFichierDisponible, ACCEPT_CM } from '../../medias/choixFichier';
import { tailleMedia } from '../../medias/envoi';
import { langueCourante } from '../../i18n';
import { trCm, type CleCm } from '../../i18n/cm';
import { ChampNote } from '../ChampNote';
import { NoteMarkdown } from '../review/Note';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, attenue, texte, type EtatPresse } from '../design';
import { BarreEnvoi, useEnvoi } from '../medias/EnvoiMedia';
import { ouvrirLienDiffere } from '../ouvrirLien';
import { Aide, BadgeStatut, ChampInstant, PALETTE, PastilleReseau, Teinte, copierTexte, nomListe, quand } from './commun';
import { MentionsSponsors } from '../sponsors/MentionsSponsors';

const vide = { fr: '', en: '' };

export function FicheCarte({
  theme,
  api,
  id,
  large,
  tableau,
  teams,
  fuseau,
  onChange,
  onFermer,
}: {
  theme: ThemeHub;
  api: ApiCm;
  id: string;
  large: boolean;
  tableau: DetailTableau;
  teams: TeamCm[];
  fuseau: string;
  onChange(): void;
  onFermer(): void;
}) {
  const [r, setR] = useState<ReponseCarte | undefined>();
  const { erreur, avis, agir, enCours, setAvis } = useAgir();
  const charger = useCallback(async () => setR(await api.carte(id)), [api, id]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  /** Écrit, garde la nouvelle carte, prévient le tableau. */
  const faire = (cle: string, action: () => Promise<ReponseCarte | unknown>, message?: string) =>
    agir(cle, async () => {
      const res = await action();
      if (res && typeof res === 'object' && 'carte' in res) setR(res as ReponseCarte);
      else await charger();
      onChange();
      return message;
    });

  if (!r) return <Retours theme={theme} erreur={erreur} prefixe="esport-cm-fiche" />;
  const c = r.carte;
  const dr = r.droits;
  const nom = (compte: string | null) => (compte ? (r.noms[compte] ?? tableau.noms[compte] ?? tableau.personnes.find(p => p.compte === compte)?.pseudo ?? trCm('c.compte_supprime')) : trCm('c.quelquun'));
  const liste = tableau.listes.find(l => l.id === c.listeId);

  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-fiche-contenu">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-fiche" />
      <Entete theme={theme} c={c} modifier={dr.modifier} liste={liste ? nomListe(liste) : ''} nom={nom} onTitre={titre => faire('titre', () => api.modifierCarte(c.id, { titre }), trCm('c.enregistre'))} />
      {c.post ? (
        <Circuit theme={theme} api={api} r={r} nom={nom} faire={faire} />
      ) : dr.editer ? (
        <BoutonHub theme={theme} titre={trCm('post.transformer')} onPress={() => void faire('post', () => api.modifierCarte(c.id, { post: true }))} testID="esport-cm-fiche-en-post" />
      ) : null}
      {c.post ? <BlocPost theme={theme} api={api} r={r} large={large} fuseau={fuseau} personnes={tableau.personnes} teams={teams} faire={faire} onCopie={setAvis} /> : null}

      <Panneau theme={theme} testID="esport-cm-fiche-description">
        <Intertitre theme={theme}>{trCm('fiche.description')}</Intertitre>
        {dr.modifier ? <Description theme={theme} valeur={c.description} joueurs={tableau.personnes.map(p => p.pseudo)} onEnregistrer={description => faire('description', () => api.modifierCarte(c.id, { description }), trCm('c.enregistre'))} /> : c.description ? <NoteMarkdown theme={theme} source={c.description} /> : <Text style={attenue(theme)}>{trCm('fiche.sans_description')}</Text>}
      </Panneau>

      <Panneau theme={theme} testID="esport-cm-fiche-details">
        <Intertitre theme={theme}>{trCm('fiche.details')}</Intertitre>
        <Etiquettes theme={theme} api={api} c={c} tableau={tableau} editer={dr.editer} faire={faire} />
        <Membres theme={theme} c={c} personnes={tableau.personnes} editer={dr.editer} onChanger={membres => faire('membres', () => api.modifierCarte(c.id, { membres }))} />
        {dr.editer ? (
          <>
            <Echeance theme={theme} valeur={c.echeance} fuseau={fuseau} onEnregistrer={echeance => faire('echeance', () => api.modifierCarte(c.id, { echeance }), trCm('c.enregistre'))} />
            {c.echeance ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Case theme={theme} coche={c.echeanceFaite} libelle={trCm('fiche.echeance_faite')} onChanger={v => void faire('faite', () => api.modifierCarte(c.id, { echeanceFaite: v }))} testID="esport-cm-fiche-echeance-faite" />
                <Text style={texte(theme)}>{trCm('fiche.echeance_faite')}</Text>
              </View>
            ) : null}
            <Couverture theme={theme} c={c} onChanger={couverture => faire('couverture', () => api.modifierCarte(c.id, { couverture }))} />
            {!tableau.tableau.team && teams.length ? (
              <Choix
                theme={theme}
                libelle={trCm('fiche.team')}
                valeur={c.teamId ?? ''}
                options={[{ id: '', nom: trCm('fiche.team_aucune') }, ...teams.map(t => ({ id: t.id, nom: t.nom ?? '' }))]}
                onChoisir={teamId => void faire('team', () => api.modifierCarte(c.id, { teamId: teamId || null }))}
                testID="esport-cm-fiche-team"
              />
            ) : null}
          </>
        ) : c.echeance ? (
          <Text style={texte(theme)}>{trCm('carte.echeance_le', { date: quand(c.echeance, fuseau) })}</Text>
        ) : null}
      </Panneau>

      <Checklists theme={theme} api={api} c={c} editer={dr.editer} faire={faire} />
      <Pieces theme={theme} api={api} c={c} portee={tableau.tableau.portee} modifier={dr.modifier} faire={faire} />
      <Commentaires theme={theme} api={api} c={c} commenter={dr.commenter} gerer={dr.gerer} nom={nom} joueurs={tableau.personnes.map(p => p.pseudo)} faire={faire} />

      <Panneau theme={theme} testID="esport-cm-fiche-activite">
        <Intertitre theme={theme}>{trCm('fiche.activite')}</Intertitre>
        {c.activite.length ? null : <Text style={attenue(theme)}>{trCm('fiche.activite_vide')}</Text>}
        {c.activite.slice(0, 30).map(a => (
          <Text key={a.id} style={texte(theme, 13)}>
            {`${quand(a.date, fuseau)} · ${phraseActivite(a.action, a.acteur ? nom(a.acteur) : trCm('activite.automatique'), a.meta, tableau)}`}
          </Text>
        ))}
      </Panneau>

      {dr.editer ? (
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre={c.archive ? trCm('carte.restaurer') : trCm('carte.archiver')} onPress={() => void faire('archive', () => api.modifierCarte(c.id, { archive: !c.archive }))} testID="esport-cm-fiche-archiver" />
          <BoutonConfirme
            theme={theme}
            titre={trCm('carte.supprimer')}
            confirmation={trCm('carte.supprimer_confirmer')}
            onConfirme={() =>
              void agir('supprimer', async () => {
                await api.supprimerCarte(c.id);
                onChange();
                onFermer();
              })
            }
            testID="esport-cm-fiche-supprimer"
            desactive={Boolean(enCours)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Phrase d'une ligne d'activité de la carte. */
function phraseActivite(action: string, qui: string, meta: Record<string, unknown>, tableau: DetailTableau): string {
  if (action === 'deplacee') {
    const vers = tableau.listes.find(l => l.id === meta.vers);
    return trCm('activite.deplacee', { qui, liste: vers ? nomListe(vers) : '?' });
  }
  if (action === 'refusee') return trCm('activite.refusee', { qui, motif: typeof meta.motif === 'string' ? meta.motif : '' });
  const cle = `activite.${action}` as CleCm;
  const t = trCm(cle, { qui });
  return t === cle ? `${qui} : ${action}` : t;
}

// ------------------------------------------------------------------ En-tête

function Entete({ theme, c, modifier, liste, nom, onTitre }: { theme: ThemeHub; c: CarteDetail; modifier: boolean; liste: string; nom(c: string | null): string; onTitre(t: string): void }) {
  const [titre, setTitre] = useState(c.titre);
  useEffect(() => setTitre(c.titre), [c.titre]);
  return (
    <View style={{ gap: ESP.xs }}>
      {modifier ? (
        <View style={{ gap: ESP.xs }}>
          <Champ theme={theme} libelle={trCm('carte.titre')} valeur={titre} onChanger={setTitre} maxLength={200} testID="esport-cm-fiche-titre" />
          {titre.trim() && titre !== c.titre ? <BoutonHub theme={theme} titre={trCm('c.enregistrer')} onPress={() => onTitre(titre.trim())} testID="esport-cm-fiche-titre-ok" /> : null}
        </View>
      ) : (
        <Text accessibilityRole="header" style={{ ...texte(theme, 20), fontWeight: '800' }} testID="esport-cm-fiche-titre-lu">
          {c.titre}
        </Text>
      )}
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {liste ? <Badge theme={theme} texte={trCm('fiche.dans_liste', { liste })} /> : null}
        {c.post ? <BadgeStatut theme={theme} statut={c.statut} testID="esport-cm-fiche-statut" /> : null}
        {c.archive ? <Badge theme={theme} ton="alerte" texte={trCm('c.archivee')} /> : null}
        {c.trello ? <Badge theme={theme} texte={trCm('fiche.importee_trello')} /> : null}
        {c.origine === 'depot' ? <Badge theme={theme} texte={c.depotGenre ? trCm(`depot.genre.${c.depotGenre}` as CleCm) : trCm('carte.depot')} /> : null}
        {c.origine === 'suggestion' ? <Badge theme={theme} texte={trCm('carte.suggestion')} /> : null}
      </View>
      <Text style={attenue(theme)}>{trCm('fiche.creee_par', { qui: nom(c.creePar), date: quand(c.creeLe) })}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ Circuit de validation

function Circuit({ theme, api, r, nom, faire }: { theme: ThemeHub; api: ApiCm; r: ReponseCarte; nom(c: string | null): string; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const c = r.carte;
  const dr = r.droits;
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState(false);
  const [publier, setPublier] = useState(false);
  const [adresses, setAdresses] = useState<Partial<Record<Reseau, string>>>(c.publications);
  useEffect(() => setAdresses(c.publications), [c.publications]);
  const statut = c.statut ?? 'brouillon';
  return (
    <Panneau theme={theme} testID="esport-cm-circuit" style={{ borderColor: statut === 'a_valider' ? theme.alerte : statut === 'refuse' ? theme.critique : theme.ligne }}>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Intertitre theme={theme}>{trCm('circuit.titre')}</Intertitre>
        <BadgeStatut theme={theme} statut={statut} />
      </View>
      <Aide theme={theme}>{trCm(`circuit.aide.${statut}` as CleCm)}</Aide>
      {c.soumisPar && statut === 'a_valider' ? <Text style={attenue(theme)}>{trCm('circuit.soumis_par', { qui: nom(c.soumisPar), date: quand(c.soumisLe) })}</Text> : null}
      {c.validePar && (statut === 'valide' || statut === 'publie') ? <Text style={attenue(theme)}>{trCm('circuit.valide_par', { qui: nom(c.validePar), date: quand(c.valideLe) })}</Text> : null}
      {statut === 'refuse' && c.refusMotif ? (
        <Text style={{ ...texte(theme), color: theme.critique }} testID="esport-cm-circuit-motif">
          {trCm('circuit.refuse_par', { qui: nom(c.refusePar), motif: c.refusMotif })}
        </Text>
      ) : null}
      {r.problemes.length ? (
        <View style={{ gap: 2 }} testID="esport-cm-circuit-problemes">
          {r.problemes.map((p, i) => (
            <Text key={i} style={{ ...texte(theme, 13), color: theme.alerte }}>
              {`• ${p.reseau ? `${RESEAUX[p.reseau].nom}${p.langue ? ` (${p.langue.toUpperCase()})` : ''} : ` : ''}${trCm(`probleme.${p.code}` as CleCm)}`}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {dr.editer && (statut === 'brouillon' || statut === 'refuse') ? (
          <BoutonHub theme={theme} titre={trCm('circuit.soumettre')} variante="plein" desactive={r.problemes.length > 0} onPress={() => void faire('soumettre', () => api.soumettre(c.id), trCm('circuit.soumis'))} testID="esport-cm-circuit-soumettre" />
        ) : null}
        {dr.valider && statut === 'a_valider' ? (
          <BoutonHub theme={theme} titre={trCm('circuit.valider')} variante="plein" onPress={() => void faire('valider', () => api.valider(c.id, { versionAttendue: c.version }), trCm('circuit.valide'))} testID="esport-cm-circuit-valider" />
        ) : null}
        {dr.valider && (statut === 'a_valider' || statut === 'valide') ? <BoutonHub theme={theme} titre={trCm('circuit.refuser')} onPress={() => setRefus(x => !x)} testID="esport-cm-circuit-refuser" /> : null}
        {dr.editer && statut === 'valide' ? <BoutonHub theme={theme} titre={trCm('circuit.publier')} variante="plein" onPress={() => setPublier(x => !x)} testID="esport-cm-circuit-publier" /> : null}
        {dr.editer && statut === 'publie' ? <BoutonHub theme={theme} titre={trCm('circuit.adresses')} onPress={() => setPublier(x => !x)} testID="esport-cm-circuit-adresses" /> : null}
        {dr.editer && statut === 'publie' ? <BoutonHub theme={theme} titre={trCm('circuit.depublier')} onPress={() => void faire('depublier', () => api.depublier(c.id))} testID="esport-cm-circuit-depublier" /> : null}
      </View>
      {refus ? (
        <View style={{ gap: ESP.xs }}>
          <Champ theme={theme} libelle={trCm('circuit.motif')} valeur={motif} onChanger={setMotif} multiligne maxLength={1000} testID="esport-cm-circuit-motif-champ" />
          <BoutonHub
            theme={theme}
            titre={trCm('circuit.confirmer_refus')}
            variante="danger"
            desactive={motif.trim().length < 2}
            onPress={() =>
              void faire('refuser', async () => {
                const x = await api.refuser(c.id, motif.trim());
                setRefus(false);
                setMotif('');
                return x;
              })
            }
            testID="esport-cm-circuit-refus-ok"
          />
        </View>
      ) : null}
      {publier ? (
        <View style={{ gap: ESP.xs }} testID="esport-cm-circuit-publication">
          <Aide theme={theme}>{trCm('circuit.publier_aide')}</Aide>
          {c.reseaux.map(rs => (
            <Champ
              key={rs}
              theme={theme}
              libelle={trCm('circuit.adresse_reseau', { reseau: RESEAUX[rs].nom })}
              valeur={adresses[rs] ?? ''}
              onChanger={v => setAdresses(a => ({ ...a, [rs]: v }))}
              placeholder="https://"
              maxLength={500}
              testID={`esport-cm-circuit-url-${rs}`}
            />
          ))}
          <BoutonHub
            theme={theme}
            titre={statut === 'publie' ? trCm('c.enregistrer') : trCm('circuit.marquer_publie')}
            variante="plein"
            onPress={() =>
              void faire('publier', async () => {
                const propres = Object.fromEntries(Object.entries(adresses).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
                const x = await api.publier(c.id, propres);
                setPublier(false);
                return x;
              }, trCm('circuit.publie'))
            }
            testID="esport-cm-circuit-publier-ok"
          />
        </View>
      ) : null}
      {statut === 'publie' && Object.keys(c.publications).length ? (
        <View style={{ gap: 2 }}>
          {(Object.entries(c.publications) as Array<[Reseau, string]>).map(([rs, url]) => (
            <Pressable key={rs} accessibilityRole="link" onPress={() => void Linking.openURL(url)} testID={`esport-cm-circuit-lien-${rs}`} style={{ minHeight: 32, justifyContent: 'center' }}>
              <Text style={{ ...texte(theme, 13), color: theme.accent }}>{`${RESEAUX[rs].nom} : ${url}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Panneau>
  );
}

// ------------------------------------------------------------------ Contenu du post

function BlocPost({
  theme,
  api,
  r,
  large,
  fuseau,
  personnes,
  teams,
  faire,
  onCopie,
}: {
  theme: ThemeHub;
  api: ApiCm;
  r: ReponseCarte;
  large: boolean;
  fuseau: string;
  personnes: Personne[];
  teams: TeamCm[];
  faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean>;
  onCopie(m: string): void;
}) {
  const c = r.carte;
  const editer = r.droits.editer && c.statut !== 'publie';
  const [reseaux, setReseaux] = useState<Reseau[]>(c.reseaux);
  const [textes, setTextes] = useState<TextesPost>(c.textes);
  const [date, setDate] = useState<string | null>(c.datePublication);
  const [liens, setLiens] = useState<LiensCarte>(c.liens);
  const [prerempli, setPrerempli] = useState(false);
  useEffect(() => {
    setReseaux(c.reseaux);
    setTextes(c.textes);
    setDate(c.datePublication);
    setLiens(c.liens);
  }, [c.reseaux, c.textes, c.datePublication, c.liens]);
  const modifie = JSON.stringify([reseaux, textes, liens]) !== JSON.stringify([c.reseaux, c.textes, c.liens]) || (date ?? null) !== (c.datePublication ?? null);
  const teamId = c.teamId ?? liens.teamId ?? null;
  const copier = async (t: string) => onCopie((await copierTexte(t)) ? trCm('post.copie') : trCm('post.copie_impossible'));
  return (
    <Panneau theme={theme} testID="esport-cm-post">
      <Intertitre theme={theme}>{trCm('post.titre')}</Intertitre>
      <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityLabel={trCm('post.reseaux')}>
        {CLES_RESEAUX.map(rs => (
          <PastilleReseau key={rs} theme={theme} reseau={rs} actif={reseaux.includes(rs)} onPress={editer ? () => setReseaux(x => (x.includes(rs) ? x.filter(y => y !== rs) : CLES_RESEAUX.filter(y => y === rs || x.includes(y)))) : undefined} testID={`esport-cm-post-reseau-${rs}`} />
        ))}
      </View>
      {editer && teamId ? <BoutonHub theme={theme} titre={trCm('post.prerempli')} onPress={() => setPrerempli(x => !x)} testID="esport-cm-post-prerempli" /> : null}
      {editer && !teamId && teams.length ? <Aide theme={theme}>{trCm('post.prerempli_team')}</Aide> : null}
      {prerempli && teamId ? (
        <Prerempli
          theme={theme}
          api={api}
          teamId={teamId}
          onChoisir={p => {
            setTextes(t => ({ ...t, ...p.textes }));
            setLiens(l => ({ ...l, ...p.liens }));
            setPrerempli(false);
          }}
        />
      ) : null}
      {reseaux.map(rs => (
        <TextesReseau
          key={rs}
          theme={theme}
          reseau={rs}
          valeur={textes[rs] ?? vide}
          large={large}
          editer={editer}
          onChanger={v => setTextes(t => ({ ...t, [rs]: v }))}
          onCopier={copier}
        />
      ))}
      {editer ? <ChampInstant theme={theme} libelle={trCm('post.date_publication')} valeur={date} fuseau={fuseau} onChanger={setDate} testID="esport-cm-post-date" /> : c.datePublication ? <Text style={texte(theme)}>{trCm('carte.publication_le', { date: quand(c.datePublication, fuseau) })}</Text> : null}
      <Liens theme={theme} api={api} c={c} liens={liens} editer={editer} teamId={teamId} onChanger={setLiens} personnes={personnes} />
      {editer && modifie ? (
        <View style={{ gap: ESP.xs }}>
          {c.statut === 'valide' || c.statut === 'a_valider' ? <Aide theme={theme}>{trCm('post.revalidation')}</Aide> : null}
          <BoutonHub
            theme={theme}
            titre={trCm('post.enregistrer')}
            variante="plein"
            onPress={() => void faire('post', () => api.modifierCarte(c.id, { reseaux, textes, datePublication: date, liens, versionAttendue: c.version }), trCm('c.enregistre'))}
            testID="esport-cm-post-enregistrer"
          />
        </View>
      ) : null}
    </Panneau>
  );
}

function TextesReseau({ theme, reseau, valeur, large, editer, onChanger, onCopier }: { theme: ThemeHub; reseau: Reseau; valeur: { fr: string; en: string }; large: boolean; editer: boolean; onChanger(v: { fr: string; en: string }): void; onCopier(t: string): void }) {
  const r = RESEAUX[reseau];
  return (
    <View style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s }} testID={`esport-cm-post-${reseau}`}>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <PastilleReseau theme={theme} reseau={reseau} />
        <Text style={attenue(theme)}>{trCm('post.limite', { n: r.limite })}</Text>
      </View>
      <View style={{ flexDirection: large ? 'row' : 'column', gap: ESP.s }}>
        {(['fr', 'en'] as const).map(langue => {
          const a = analyserTexte(valeur[langue], reseau);
          return (
            <View key={langue} style={{ flex: large ? 1 : undefined, gap: 4 }}>
              {editer ? (
                <Champ
                  theme={theme}
                  libelle={trCm(langue === 'fr' ? 'post.texte_fr' : 'post.texte_en')}
                  valeur={valeur[langue]}
                  onChanger={v => onChanger({ ...valeur, [langue]: v })}
                  multiligne
                  maxLength={5000}
                  testID={`esport-cm-post-${reseau}-${langue}`}
                />
              ) : (
                <View style={{ gap: 2 }}>
                  <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm(langue === 'fr' ? 'post.texte_fr' : 'post.texte_en')}</Text>
                  <Text selectable style={texte(theme)} testID={`esport-cm-post-${reseau}-${langue}-lu`}>
                    {valeur[langue] || '—'}
                  </Text>
                </View>
              )}
              <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
                <Text
                  style={{ ...attenue(theme, 12), color: a.tropLong ? theme.critique : theme.attenue, fontWeight: a.tropLong ? '700' : '400' }}
                  testID={`esport-cm-post-${reseau}-${langue}-compteur`}
                  accessibilityLabel={trCm('post.compteur_aria', { n: a.longueur, limite: a.limite })}>
                  {`${a.longueur} / ${a.limite}${a.hashtags.length ? ` · #${a.hashtags.length}` : ''}${a.mentions.length ? ` · @${a.mentions.length}` : ''}`}
                </Text>
                <BoutonHub theme={theme} titre={trCm('post.copier')} libelle={trCm('post.copier_aria', { reseau: r.nom, langue: langue.toUpperCase() })} desactive={!valeur[langue]} onPress={() => onCopier(valeur[langue])} testID={`esport-cm-post-${reseau}-${langue}-copier`} />
              </View>
              {a.tropDeHashtags ? <Text style={{ ...attenue(theme, 12), color: theme.critique }}>{trCm('probleme.trop-de-hashtags')}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Choix d'un match, résultat ou tournoi PUBLIABLE de la team : textes FR / EN pré-remplis. */
function Prerempli({ theme, api, teamId, onChoisir }: { theme: ThemeHub; api: ApiCm; teamId: string; onChoisir(p: { textes: TextesPost; liens: LiensCarte }): void }) {
  const [m, setM] = useState<MatchsTeam | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setM(await api.matchs(teamId)));
  }, [agir, api, teamId]);
  const prendre = (genre: 'resultat' | 'annonce' | 'tournoi', id: string, prefixe?: 'j1' | 'jourj') =>
    agir('prerempli', async () => {
      const p = await api.prerempli(teamId, genre, id, prefixe);
      onChoisir({ textes: p.textes, liens: p.liens });
    });
  return (
    <View style={{ gap: ESP.xs }} testID="esport-cm-prerempli">
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-prerempli" />
      {m && !m.resultats.length && !m.matchs.length && !m.tournois.length ? <Text style={attenue(theme)}>{trCm('post.prerempli_vide')}</Text> : null}
      {m?.resultats.map(x => (
        <BoutonHub key={x.id} theme={theme} titre={`${trCm('post.prerempli_resultat')} · ${x.titre} · ${x.phrase}`} onPress={() => void prendre('resultat', x.id)} testID={`esport-cm-prerempli-resultat-${x.id}`} />
      ))}
      {m?.matchs.map(x => (
        <View key={x.id} style={[styles.ligne, { gap: ESP.xs }]}>
          <Text style={{ ...texte(theme, 13), flex: 1 }}>{`${x.titre}${x.adversaires.length ? ` · ${x.adversaires.join(', ')}` : ''}`}</Text>
          <BoutonHub theme={theme} titre={trCm('post.prerempli_j1')} onPress={() => void prendre('annonce', x.id, 'j1')} testID={`esport-cm-prerempli-j1-${x.id}`} />
          <BoutonHub theme={theme} titre={trCm('post.prerempli_jourj')} onPress={() => void prendre('annonce', x.id, 'jourj')} testID={`esport-cm-prerempli-jourj-${x.id}`} />
        </View>
      ))}
      {m?.tournois.map(x => (
        <BoutonHub key={x.id} theme={theme} titre={`${trCm('post.prerempli_tournoi')} · ${x.nom}`} onPress={() => void prendre('tournoi', x.id)} testID={`esport-cm-prerempli-tournoi-${x.id}`} />
      ))}
    </View>
  );
}

/** Liens du post : match / résultat / tournoi (résumés), clips, joueurs de la team liés. */
function Liens({ theme, api, c, liens, editer, teamId, onChanger, personnes }: { theme: ThemeHub; api: ApiCm; c: CarteDetail; liens: LiensCarte; editer: boolean; teamId: string | null; onChanger(l: LiensCarte): void; personnes: Personne[] }) {
  const [membresTeam, setMembresTeam] = useState<Personne[] | undefined>();
  useEffect(() => {
    if (!teamId || !editer) return;
    api
      .membresTeam(teamId)
      .then(x => setMembresTeam(x.membres))
      .catch(() => setMembresTeam([]));
  }, [api, teamId, editer]);
  const noms = useMemo(() => new Map([...(membresTeam ?? []), ...personnes].map(p => [p.compte, p.pseudo])), [membresTeam, personnes]);
  const lus = c.resumes;
  const ligne = (cle: 'resultat' | 'match' | 'tournoi') => {
    const x = lus[cle];
    if (!x) return null;
    return (
      <Text key={cle} style={texte(theme, 13)} testID={`esport-cm-lien-${cle}`}>
        {`${trCm(`lien.${cle}` as CleCm)} : ${'masque' in x ? trCm('lien.masque') : `${x.titre} · ${x.phrase}`}`}
      </Text>
    );
  };
  return (
    <View style={{ gap: ESP.xs }}>
      {ligne('resultat')}
      {ligne('match')}
      {ligne('tournoi')}
      {c.clips.length ? <Text style={texte(theme, 13)}>{trCm('lien.clips', { liste: c.clips.map(x => x.titre).join(', ') })}</Text> : null}
      <MentionsSponsors theme={theme} client={api.client} liens={liens} noms={c.sponsors ?? []} editer={editer} onChanger={onChanger} />
      {liens.membres?.length ? <Text style={texte(theme, 13)} testID="esport-cm-lien-membres">{trCm('lien.membres', { liste: liens.membres.map(m => noms.get(m) ?? '?').join(', ') })}</Text> : null}
      {editer && membresTeam?.length ? (
        <View style={[styles.ligne, { gap: ESP.xs }]} accessibilityLabel={trCm('lien.choisir_membres')}>
          {membresTeam.map(p => {
            const actif = Boolean(liens.membres?.includes(p.compte));
            return (
              <Pressable
                key={p.compte}
                testID={`esport-cm-lien-membre-${p.compte}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: actif }}
                accessibilityLabel={p.pseudo}
                onPress={() => onChanger({ ...liens, membres: actif ? (liens.membres ?? []).filter(x => x !== p.compte) : [...(liens.membres ?? []), p.compte] })}
                style={[styles.choix, { borderColor: actif ? theme.accent : theme.ligne, borderRadius: 10, backgroundColor: actif ? teinteTransparente(theme.accent, 0.15) : theme.surface }]}>
                <Text style={texte(theme, 13)}>{`@${p.pseudo}`}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Description, échéance, étiquettes, membres, couverture

/** Échéance : saisie locale, envoyée par « Enregistrer » (pas à chaque touche). */
function Echeance({ theme, valeur, fuseau, onEnregistrer }: { theme: ThemeHub; valeur: string | null; fuseau: string; onEnregistrer(v: string | null): void }) {
  const [saisie, setSaisie] = useState<string | null | undefined>(undefined);
  useEffect(() => setSaisie(undefined), [valeur]);
  return (
    <View style={{ gap: ESP.xs }}>
      <ChampInstant theme={theme} libelle={trCm('fiche.echeance')} valeur={valeur} fuseau={fuseau} onChanger={setSaisie} testID="esport-cm-fiche-echeance" />
      {saisie !== undefined ? <BoutonHub theme={theme} titre={trCm('c.enregistrer')} onPress={() => onEnregistrer(saisie)} testID="esport-cm-fiche-echeance-ok" /> : null}
    </View>
  );
}

function Description({ theme, valeur, joueurs, onEnregistrer }: { theme: ThemeHub; valeur: string; joueurs: string[]; onEnregistrer(v: string): void }) {
  const [texteLocal, setTexteLocal] = useState(valeur);
  useEffect(() => setTexteLocal(valeur), [valeur]);
  return (
    <View style={{ gap: ESP.xs }}>
      <ChampNote theme={theme} libelle={trCm('fiche.description')} valeur={texteLocal} onChanger={setTexteLocal} testID="esport-cm-fiche-description-champ" maxLength={8000} joueurs={joueurs} />
      {texteLocal !== valeur ? <BoutonHub theme={theme} titre={trCm('c.enregistrer')} onPress={() => onEnregistrer(texteLocal)} testID="esport-cm-fiche-description-ok" /> : null}
    </View>
  );
}

function Etiquettes({ theme, api, c, tableau, editer, faire }: { theme: ThemeHub; api: ApiCm; c: CarteDetail; tableau: DetailTableau; editer: boolean; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const [nouvelle, setNouvelle] = useState<{ nom: string; couleur: string } | undefined>();
  return (
    <View style={{ gap: ESP.xs }} testID="esport-cm-fiche-etiquettes">
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('fiche.etiquettes')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {tableau.etiquettes.map(e => {
          const actif = c.etiquettes.includes(e.id);
          if (!editer && !actif) return null;
          return (
            <Pressable
              key={e.id}
              disabled={!editer}
              testID={`esport-cm-fiche-etiquette-${e.id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={e.nom || trCm('etiquette.sans_nom')}
              onPress={() => void faire('etiquettes', () => api.modifierCarte(c.id, { etiquettes: actif ? c.etiquettes.filter(x => x !== e.id) : [...c.etiquettes, e.id] }))}
              style={{ minHeight: 44, justifyContent: 'center' }}>
              <View style={{ backgroundColor: e.couleur, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, opacity: actif ? 1 : 0.45, borderWidth: actif ? 2 : 0, borderColor: theme.texte }}>
                <Text style={{ color: '#172b4d', fontSize: 13, fontWeight: '700' }}>{e.nom || ' '}</Text>
              </View>
            </Pressable>
          );
        })}
        {editer ? <BoutonHub theme={theme} titre={trCm('etiquette.nouvelle')} onPress={() => setNouvelle({ nom: '', couleur: PALETTE[5][0] })} testID="esport-cm-etiquette-nouvelle" /> : null}
      </View>
      {nouvelle ? (
        <View style={{ gap: ESP.xs }}>
          <Champ theme={theme} libelle={trCm('c.nom')} valeur={nouvelle.nom} onChanger={nom => setNouvelle({ ...nouvelle, nom })} maxLength={40} testID="esport-cm-etiquette-nom" />
          <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('c.couleur')}>
            {PALETTE.map(([couleur, cle]) => (
              <Teinte key={couleur} theme={theme} couleur={couleur} choisie={nouvelle.couleur === couleur} libelle={trCm(cle)} onPress={() => setNouvelle({ ...nouvelle, couleur })} testID={`esport-cm-etiquette-couleur-${couleur.slice(1)}`} />
            ))}
          </View>
          <BoutonHub
            theme={theme}
            titre={trCm('c.creer')}
            onPress={() =>
              void faire('etiquette', async () => {
                const e = await api.creerEtiquette(c.tableauId, nouvelle);
                setNouvelle(undefined);
                return api.modifierCarte(c.id, { etiquettes: [...c.etiquettes, e.id] });
              })
            }
            testID="esport-cm-etiquette-creer"
          />
        </View>
      ) : null}
    </View>
  );
}

function Membres({ theme, c, personnes, editer, onChanger }: { theme: ThemeHub; c: CarteDetail; personnes: Personne[]; editer: boolean; onChanger(m: string[]): void }) {
  return (
    <View style={{ gap: ESP.xs }} testID="esport-cm-fiche-membres">
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('fiche.membres')}</Text>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {personnes.map(p => {
          const actif = c.membres.includes(p.compte);
          if (!editer && !actif) return null;
          return (
            <Pressable
              key={p.compte}
              disabled={!editer}
              testID={`esport-cm-fiche-membre-${p.compte}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={p.pseudo}
              onPress={() => onChanger(actif ? c.membres.filter(x => x !== p.compte) : [...c.membres, p.compte])}
              style={[styles.choix, { borderColor: actif ? theme.accent : theme.ligne, borderRadius: 10, backgroundColor: actif ? teinteTransparente(theme.accent, 0.15) : theme.surface }]}>
              <Text style={texte(theme, 13)}>{p.pseudo}</Text>
            </Pressable>
          );
        })}
        {!personnes.length ? <Text style={attenue(theme)}>—</Text> : null}
      </View>
    </View>
  );
}

function Couverture({ theme, c, onChanger }: { theme: ThemeHub; c: CarteDetail; onChanger(v: { couleur: string } | { pieceId: string } | null): void }) {
  const images = c.pieces.filter(p => p.fichier?.type.startsWith('image/'));
  return (
    <View style={{ gap: ESP.xs }} testID="esport-cm-fiche-couverture">
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trCm('fiche.couverture')}</Text>
      <View style={[styles.ligne, { gap: 0 }]} accessibilityRole="radiogroup" accessibilityLabel={trCm('fiche.couverture')}>
        {PALETTE.map(([couleur, cle]) => (
          <Teinte key={couleur} theme={theme} couleur={couleur} choisie={c.couverture?.couleur === couleur} libelle={trCm(cle)} onPress={() => onChanger({ couleur })} testID={`esport-cm-couverture-${couleur.slice(1)}`} />
        ))}
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        {images.map(p => (
          <BoutonHub key={p.id} theme={theme} titre={p.nom} libelle={trCm('fiche.couverture_image', { nom: p.nom })} variante={c.couverture?.pieceId === p.id ? 'plein' : 'normal'} onPress={() => onChanger({ pieceId: p.id })} testID={`esport-cm-couverture-piece-${p.id}`} />
        ))}
        {c.couverture ? <BoutonHub theme={theme} titre={trCm('fiche.couverture_aucune')} onPress={() => onChanger(null)} testID="esport-cm-couverture-aucune" /> : null}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Checklists, pièces jointes, commentaires

function Checklists({ theme, api, c, editer, faire }: { theme: ThemeHub; api: ApiCm; c: CarteDetail; editer: boolean; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const [nouvelle, setNouvelle] = useState('');
  const [elements, setElements] = useState<Record<string, string>>({});
  if (!editer && !c.checklists.length) return null;
  return (
    <Panneau theme={theme} testID="esport-cm-fiche-checklists">
      <Intertitre theme={theme}>{trCm('fiche.checklists')}</Intertitre>
      {c.checklists.map(k => {
        const faits = k.elements.filter(e => e.fait).length;
        return (
          <View key={k.id} style={{ gap: ESP.xs }} testID={`esport-cm-checklist-${k.id}`}>
            <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{`${k.nom} · ${faits}/${k.elements.length}`}</Text>
              {editer ? <BoutonHub theme={theme} titre={trCm('c.supprimer')} libelle={trCm('fiche.checklist_supprimer', { nom: k.nom })} onPress={() => void faire('checklist', () => api.supprimerChecklist(k.id))} testID={`esport-cm-checklist-${k.id}-supprimer`} /> : null}
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.ligne, overflow: 'hidden' }}>
              <View style={{ height: 6, width: `${k.elements.length ? Math.round((faits / k.elements.length) * 100) : 0}%`, backgroundColor: theme.ok }} />
            </View>
            {k.elements.map(e => (
              <View key={e.id} style={[styles.ligne, { gap: ESP.xs }]}>
                <Case theme={theme} coche={e.fait} libelle={e.texte} onChanger={v => void (editer && faire('element', () => api.modifierElement(e.id, { fait: v })))} testID={`esport-cm-element-${e.id}`} />
                <Text style={{ ...texte(theme), flex: 1, textDecorationLine: e.fait ? 'line-through' : 'none' }}>{e.texte}</Text>
                {editer ? <Pressable accessibilityRole="button" accessibilityLabel={trCm('fiche.element_supprimer', { texte: e.texte })} onPress={() => void faire('element', () => api.supprimerElement(e.id))} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} testID={`esport-cm-element-${e.id}-supprimer`}><Text style={attenue(theme, 16)}>×</Text></Pressable> : null}
              </View>
            ))}
            {editer ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <Champ theme={theme} libelle={trCm('fiche.element_nouveau')} valeur={elements[k.id] ?? ''} onChanger={v => setElements(x => ({ ...x, [k.id]: v }))} maxLength={300} testID={`esport-cm-checklist-${k.id}-nouveau`} style={{ flex: 1, minWidth: 180 }} />
                <BoutonHub
                  theme={theme}
                  titre={trCm('c.ajouter')}
                  desactive={!(elements[k.id] ?? '').trim()}
                  onPress={() =>
                    void faire('element', async () => {
                      const x = await api.ajouterElement(k.id, (elements[k.id] ?? '').trim());
                      setElements(y => ({ ...y, [k.id]: '' }));
                      return x;
                    })
                  }
                  testID={`esport-cm-checklist-${k.id}-ajouter`}
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {editer ? (
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Champ theme={theme} libelle={trCm('fiche.checklist_nouvelle')} valeur={nouvelle} onChanger={setNouvelle} maxLength={80} testID="esport-cm-checklist-nouvelle" style={{ flex: 1, minWidth: 180 }} />
          <BoutonHub
            theme={theme}
            titre={trCm('c.ajouter')}
            desactive={!nouvelle.trim()}
            onPress={() =>
              void faire('checklist', async () => {
                const x = await api.creerChecklist(c.id, nouvelle.trim());
                setNouvelle('');
                return x;
              })
            }
            testID="esport-cm-checklist-creer"
          />
        </View>
      ) : null}
    </Panneau>
  );
}

function Pieces({ theme, api, c, portee, modifier, faire }: { theme: ThemeHub; api: ApiCm; c: CarteDetail; portee: string; modifier: boolean; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const [url, setUrl] = useState('');
  const [nom, setNom] = useState('');
  const envoi = useEnvoi();
  const ouvrir = (id: string, telecharger: boolean) => void ouvrirLienDiffere(async () => (await api.lienPiece(id, telecharger)).url);
  const trello = c.pieces.some(p => p.trello);
  return (
    <Panneau theme={theme} testID="esport-cm-fiche-pieces">
      <Intertitre theme={theme}>{trCm('fiche.pieces')}</Intertitre>
      {!c.pieces.length ? <Text style={attenue(theme)}>{trCm('fiche.pieces_vide')}</Text> : null}
      {c.pieces.map(p => (
        <View key={p.id} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]} testID={`esport-cm-piece-${p.id}`}>
          <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
            <Text style={{ ...texte(theme), fontWeight: '600' }} numberOfLines={1}>
              {p.nom}
            </Text>
            <Text style={attenue(theme, 12)} numberOfLines={1}>
              {p.fichier ? `${p.fichier.type} · ${tailleMedia(p.fichier.taille, langueCourante())}` : p.trello ? trCm('fiche.piece_trello') : p.url}
            </Text>
          </View>
          {p.genre === 'fichier' && p.fichier ? (
            <>
              <BoutonHub theme={theme} titre={trCm('fiche.ouvrir')} libelle={trCm('fiche.ouvrir_nom', { nom: p.nom })} onPress={() => ouvrir(p.id, false)} testID={`esport-cm-piece-${p.id}-ouvrir`} />
              <BoutonHub theme={theme} titre={trCm('fiche.telecharger')} libelle={trCm('fiche.telecharger_nom', { nom: p.nom })} onPress={() => ouvrir(p.id, true)} testID={`esport-cm-piece-${p.id}-telecharger`} />
            </>
          ) : p.url ? (
            <BoutonHub theme={theme} titre={trCm('fiche.ouvrir')} libelle={trCm('fiche.ouvrir_nom', { nom: p.nom })} onPress={() => void Linking.openURL(p.url!)} testID={`esport-cm-piece-${p.id}-ouvrir`} />
          ) : null}
          {modifier ? <BoutonHub theme={theme} titre="×" libelle={trCm('fiche.piece_retirer', { nom: p.nom })} onPress={() => void faire('piece', () => api.supprimerPiece(p.id))} testID={`esport-cm-piece-${p.id}-retirer`} /> : null}
        </View>
      ))}
      {trello ? <Aide theme={theme} testID="esport-cm-pieces-trello">{trCm('fiche.pieces_trello_aide')}</Aide> : null}
      {modifier ? (
        <View style={{ gap: ESP.xs }}>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <Champ theme={theme} libelle={trCm('fiche.lien_url')} valeur={url} onChanger={setUrl} placeholder="https://" maxLength={2000} testID="esport-cm-piece-url" style={{ flex: 2, minWidth: 200 }} />
            <Champ theme={theme} libelle={trCm('c.nom')} valeur={nom} onChanger={setNom} maxLength={140} testID="esport-cm-piece-nom" style={{ flex: 1, minWidth: 140 }} />
          </View>
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <BoutonHub
              theme={theme}
              titre={trCm('fiche.ajouter_lien')}
              desactive={!/^https:\/\//i.test(url.trim())}
              onPress={() =>
                void faire('lien', async () => {
                  const x = await api.ajouterLien(c.id, url.trim(), nom.trim());
                  setUrl('');
                  setNom('');
                  return x;
                })
              }
              testID="esport-cm-piece-ajouter-lien"
            />
            {choixFichierDisponible ? (
              <BoutonHub
                theme={theme}
                titre={trCm('fiche.ajouter_fichier')}
                desactive={envoi.enCours}
                onPress={() =>
                  void faire('fichier', async () => {
                    const f = await choisirFichier(ACCEPT_CM, 'esport-cm-piece-fichier');
                    if (!f) return undefined;
                    const { etat, oublier } = await envoi.lancer({ client: api.client, teamId: portee, section: 'cm', fichier: f });
                    const x = await api.ajouterFichier(c.id, etat.id);
                    oublier();
                    envoi.effacer();
                    return x;
                  })
                }
                testID="esport-cm-piece-ajouter-fichier"
              />
            ) : (
              <Aide theme={theme}>{trCm('fiche.fichier_depuis_pc')}</Aide>
            )}
          </View>
          <BarreEnvoi theme={theme} progression={envoi.progression} enCours={envoi.enCours} onAnnuler={envoi.annuler} testID="esport-cm-piece-envoi" />
        </View>
      ) : null}
    </Panneau>
  );
}

function Commentaires({ theme, api, c, commenter, gerer, nom, joueurs, faire }: { theme: ThemeHub; api: ApiCm; c: CarteDetail; commenter: boolean; gerer: boolean; nom(c: string | null): string; joueurs: string[]; faire(cle: string, a: () => Promise<unknown>, m?: string): Promise<boolean> }) {
  const [texteNouveau, setTexteNouveau] = useState('');
  return (
    <Panneau theme={theme} testID="esport-cm-fiche-commentaires">
      <Intertitre theme={theme}>{trCm('fiche.commentaires')}</Intertitre>
      {!c.commentaires.length ? <Text style={attenue(theme)}>{trCm('fiche.commentaires_vide')}</Text> : null}
      {c.commentaires.map(x => (
        <View key={x.id} style={{ gap: 4, borderLeftWidth: 3, borderLeftColor: theme.ligne, paddingLeft: ESP.s }} testID={`esport-cm-commentaire-${x.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{`${x.auteur ? nom(x.auteur) : (x.auteurNom ?? trCm('c.compte_supprime'))} · ${quand(x.creeLe)}${x.trello ? ' · Trello' : ''}`}</Text>
            {x.moi || gerer ? (
              <Pressable accessibilityRole="button" accessibilityLabel={trCm('fiche.commentaire_supprimer')} onPress={() => void faire('commentaire', () => api.supprimerCommentaire(x.id))} style={(e: EtatPresse) => ({ minWidth: 44, minHeight: 32, alignItems: 'center', justifyContent: 'center', opacity: e.hovered ? 1 : 0.7 })} testID={`esport-cm-commentaire-${x.id}-supprimer`}>
                <Text style={attenue(theme, 16)}>×</Text>
              </Pressable>
            ) : null}
          </View>
          <NoteMarkdown theme={theme} source={x.texte} />
        </View>
      ))}
      {commenter ? (
        <View style={{ gap: ESP.xs }}>
          <ChampNote theme={theme} libelle={trCm('fiche.commentaire_nouveau')} valeur={texteNouveau} onChanger={setTexteNouveau} testID="esport-cm-commentaire-champ" maxLength={4000} apercu="jamais" joueurs={joueurs} />
          <BoutonHub
            theme={theme}
            titre={trCm('fiche.commenter')}
            desactive={!texteNouveau.trim()}
            onPress={() =>
              void faire('commenter', async () => {
                const x = await api.commenter(c.id, texteNouveau.trim());
                setTexteNouveau('');
                return x;
              })
            }
            testID="esport-cm-commenter"
          />
        </View>
      ) : null}
    </Panneau>
  );
}

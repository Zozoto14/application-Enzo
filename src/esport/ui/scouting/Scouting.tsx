/**
 * Module « Scouting » de l'Esport (phase 5) : fiches adversaires (nom, logo
 * par adresse, notes), joueurs adverses (pseudo, Riot ID, rôle, agents),
 * tendances par map et par side (compositions, taux de victoire facultatif),
 * VODs (avec « Ouvrir en review vidéo ») et historique des confrontations, lu
 * dans les événements du planning qui ont cet adversaire.
 *
 * Donnée sensible : visible avec scouting.view, modifiable avec
 * scouting.manage (vérifiés par le serveur ; un Joueur n'a aucune entrée
 * dans la barre et reçoit 403 en appel direct).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import { apiScouting, type AdversaireListe, type ApiScouting, type Confrontation, type DetailAdversaire, type JoueurAdverse, type SaisieJoueur, type SaisieTendance, type SideTendance, type TendanceMap, type VodAdverse } from '../../review/api';
import { sidesTendance, nomSide } from '../../review/libelles';
import { ChampNote } from '../ChampNote';
import { BoutonConfirme, Choix, Retours, TitreSection, styles, useAgir, Intertitre, Panneau } from '../commun';
import { NoteMarkdown } from '../review/Note';
import type { PropsModule } from '../modules';
import { tr, trn } from '../../i18n';

const listeTexte = (t: string): string[] => [...new Set(t.split(/[,;]/).map(x => x.trim()).filter(Boolean))];
const compos = (t: string): string[][] => t.split('\n').map(listeTexte).filter(l => l.length > 0);

export function Scouting({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiScouting(client, teamId), [client, teamId]);
  const [ouvert, setOuvert] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  if (ouvert) {
    return (
      <FicheAdversaire
        key={ouvert}
        theme={theme}
        api={api}
        id={ouvert}
        large={large}
        onRetour={m => {
          setMessage(m);
          setOuvert(undefined);
        }}
        onReview={reviewId => onAller('module:video_review', undefined, reviewId)}
      />
    );
  }
  return <ListeAdversaires theme={theme} api={api} message={message} large={large} onOuvrir={setOuvert} />;
}

// ---------------------------------------------------------------- Logo

export function Logo({ theme, nom, url, taille = 48 }: { theme: ThemeHub; nom: string; url: string | null; taille?: number }) {
  const [casse, setCasse] = useState(false);
  if (url && !casse) {
    return <Image source={{ uri: url }} accessibilityLabel={tr('design.logo_de', { nom })} onError={() => setCasse(true)} style={{ width: taille, height: taille, borderRadius: 8, backgroundColor: theme.fond }} resizeMode="contain" />;
  }
  return (
    <View accessibilityLabel={tr('design.logo_de', { nom })} style={{ width: taille, height: taille, borderRadius: 8, backgroundColor: theme.ligne, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.texte, fontWeight: '800', fontSize: taille / 2.4 }}>{nom.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Liste

function ListeAdversaires({ theme, api, message, large, onOuvrir }: { theme: ThemeHub; api: ApiScouting; message?: string; large: boolean; onOuvrir(id: string): void }) {
  const [donnees, setDonnees] = useState<{ adversaires: AdversaireListe[]; droits: { gerer: boolean } } | undefined>();
  const [nom, setNom] = useState('');
  const [logo, setLogo] = useState('');
  const [notes, setNotes] = useState('');
  const { erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setDonnees(await api.liste()), [api]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  return (
    <View style={{ gap: 16 }} testID="esport-scouting">
      <TitreSection theme={theme} titre={tr('scouting.scouting.scouting')} sous={tr('scouting.scouting.donnees_sensibles_visibles_du')} />
      <Retours theme={theme} erreur={erreur} avis={avis ?? message} prefixe="esport-scouting" />
      {donnees?.droits.gerer ? (
        <Panneau theme={theme} testID="esport-adversaire-nouveau">
          <Intertitre theme={theme}>{tr('scouting.scouting.nouvel_adversaire')}</Intertitre>
          <Champ theme={theme} libelle={tr('assistant.nom_de_la_team')} valeur={nom} onChanger={setNom} testID="esport-adversaire-nom" maxLength={60} />
          <Champ theme={theme} libelle={tr('scouting.scouting.logo_adresse_https_facultatif')} valeur={logo} onChanger={setLogo} testID="esport-adversaire-logo" placeholder="https://…/logo.png" />
          <ChampNote theme={theme} libelle={tr('scouting.scouting.notes_generales')} valeur={notes} onChanger={setNotes} testID="esport-adversaire-notes" />
          <BoutonHub
            theme={theme}
            titre={tr('scouting.scouting.creer_la_fiche')}
            variante="plein"
            desactive={nom.trim().length < 2}
            onPress={() =>
              void agir('fiche', async () => {
                const a = await api.creer({ nom, logoUrl: logo.trim() || null, notes });
                setNom('');
                setLogo('');
                setNotes('');
                onOuvrir(a.id);
              })
            }
            testID="esport-adversaire-creer"
          />
        </Panneau>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} testID="esport-adversaires">
        {donnees && donnees.adversaires.length === 0 ? <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>{tr('scouting.scouting.aucun_adversaire_pour_l')}</Text> : null}
        {donnees?.adversaires.map(a => (
          <Pressable
            key={a.id}
            testID={`esport-adversaire-${a.id}`}
            accessibilityRole="button"
            accessibilityLabel={tr('scouting.scouting.ouvrir_la_fiche_de', { nom: a.nom })}
            onPress={() => onOuvrir(a.id)}
            style={{ flexBasis: large ? 300 : '100%', flexGrow: 1, flexDirection: 'row', gap: 12, padding: 12, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: theme.rayonMoyen, alignItems: 'center' }}>
            <Logo theme={theme} nom={a.nom} url={a.logoUrl} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.texte, fontWeight: '800', fontSize: 16, ...police(theme.policeTexte) }}>{a.nom}</Text>
              <Text style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
                {trn('scouting.joueurs', a.joueurs)} · {trn('scouting.vods', a.vods)}
                {a.confrontations !== null ? trn('scouting.scouting.confrontations', a.confrontations) : ''}
              </Text>
              {a.derniere ? <Text style={{ color: theme.attenue, fontSize: 12 }}>{tr('scouting.scouting.derniere', { v: dateCourte(a.derniere) })}</Text> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Fiche

function FicheAdversaire({ theme, api, id, large, onRetour, onReview }: { theme: ThemeHub; api: ApiScouting; id: string; large: boolean; onRetour(message?: string): void; onReview(reviewId: string): void }) {
  const [d, setD] = useState<DetailAdversaire | undefined>();
  const [edition, setEdition] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const recharger = useCallback(async () => setD(await api.detail(id)), [api, id]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  if (!d) {
    return (
      <View style={{ gap: 12 }} testID="esport-adversaire-detail">
        <Retours theme={theme} erreur={erreur} prefixe="esport-scouting" />
        {!erreur ? <Text style={{ color: theme.attenue }}>{tr('scouting.scouting.chargement_de_la_fiche')}</Text> : null}
        <BoutonHub theme={theme} titre={tr('scouting.scouting.adversaires')} onPress={() => onRetour()} testID="esport-adversaire-retour" />
      </View>
    );
  }
  const gerer = d.droits.gerer;
  const faire = (libelle: string, action: () => Promise<unknown>, message?: string) =>
    agir(libelle, async () => {
      await action();
      await recharger();
      return message;
    });

  const colGauche = (
    <View style={{ flex: large ? 1 : undefined, gap: 16, minWidth: 0 }}>
      <Joueurs theme={theme} joueurs={d.joueurs} gerer={gerer} onAjouter={s => faire(tr('review.review.joueur'), () => api.ajouterJoueur(id, s), tr('scouting.scouting.joueur_ajoute'))} onModifier={(x, s) => faire(tr('review.review.joueur'), () => api.modifierJoueur(id, x, s), tr('scouting.scouting.joueur_modifie'))} onSupprimer={x => void faire(tr('review.review.joueur'), () => api.supprimerJoueur(id, x), tr('scouting.scouting.joueur_retire'))} />
      <Tendances theme={theme} tendances={d.tendances} gerer={gerer} onAjouter={s => faire(tr('scouting.scouting.tendance'), () => api.ajouterTendance(id, s), tr('scouting.scouting.tendance_ajoutee'))} onModifier={(x, s) => faire(tr('scouting.scouting.tendance'), () => api.modifierTendance(id, x, s), tr('scouting.scouting.tendance_modifiee'))} onSupprimer={x => void faire(tr('scouting.scouting.tendance'), () => api.supprimerTendance(id, x), tr('scouting.scouting.tendance_retiree'))} />
    </View>
  );
  const colDroite = (
    <View style={{ flex: large ? 1 : undefined, gap: 16, minWidth: 0 }}>
      <Vods
        theme={theme}
        vods={d.vods}
        droits={d.droits}
        onAjouter={(url, titre) => faire('VOD', () => api.ajouterVod(id, { url, titre }), tr('scouting.scouting.vod_ajoutee'))}
        onSupprimer={x => void faire('VOD', () => api.supprimerVod(id, x), tr('scouting.scouting.vod_retiree'))}
        onOuvrirReview={x =>
          void agir('review', async () => {
            const r = await api.ouvrirVodEnReview(id, x);
            onReview(r.reviewId);
          })
        }
        onVoirReview={onReview}
      />
      <Confrontations theme={theme} confrontations={d.confrontations} voirReview={d.droits.voirReview} onReview={onReview} />
    </View>
  );

  return (
    <View style={{ gap: 16 }} testID="esport-adversaire-detail">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={[styles.ligne, { flex: 1, minWidth: 200 }]}>
          <Logo theme={theme} nom={d.adversaire.nom} url={d.adversaire.logoUrl} taille={56} />
          <Text accessibilityRole="header" testID="esport-adversaire-titre" style={{ color: theme.texte, fontSize: 22, fontWeight: '800', flexShrink: 1, ...police(theme.policeTitre) }}>
            {d.adversaire.nom}
          </Text>
        </View>
        <View style={styles.ligne}>
          {gerer ? <BoutonHub theme={theme} titre={edition ? tr('scouting.scouting.fermer_la_modification') : tr('scouting.scouting.modifier_la_fiche')} onPress={() => setEdition(e => !e)} testID="esport-adversaire-modifier" /> : null}
          {gerer ? (
            <BoutonConfirme
              theme={theme}
              titre={tr('discord.supprimer')}
              confirmation={tr('scouting.scouting.oui_supprimer_la_fiche')}
              onConfirme={() =>
                void agir('fiche', async () => {
                  await api.supprimer(id);
                  onRetour(tr('scouting.scouting.fiche_supprimee'));
                })
              }
              testID="esport-adversaire-supprimer"
            />
          ) : null}
          <BoutonHub theme={theme} titre={tr('scouting.scouting.adversaires')} onPress={() => onRetour()} testID="esport-adversaire-retour" />
        </View>
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-scouting" />
      {edition ? (
        <FormulaireFiche
          theme={theme}
          initial={d.adversaire}
          onEnregistrer={s =>
            void faire(tr('scouting.scouting.fiche'), () => api.modifier(id, s), tr('scouting.scouting.fiche_enregistree')).then(ok => {
              if (ok) setEdition(false);
            })
          }
        />
      ) : (
        <Panneau theme={theme} testID="esport-adversaire-notes-affichees">
          <Intertitre theme={theme}>{tr('scouting.scouting.notes_generales')}</Intertitre>
          {d.adversaire.notes ? <NoteMarkdown theme={theme} source={d.adversaire.notes} /> : <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>{tr('scouting.scouting.aucune_note')}</Text>}
        </Panneau>
      )}
      <View style={large ? { flexDirection: 'row', gap: 16, alignItems: 'flex-start' } : { gap: 16 }}>
        {colGauche}
        {colDroite}
      </View>
    </View>
  );
}

function FormulaireFiche({ theme, initial, onEnregistrer }: { theme: ThemeHub; initial: DetailAdversaire['adversaire']; onEnregistrer(s: { nom: string; logoUrl: string | null; notes: string }): void }) {
  const [nom, setNom] = useState(initial.nom);
  const [logo, setLogo] = useState(initial.logoUrl ?? '');
  const [notes, setNotes] = useState(initial.notes);
  return (
    <Panneau theme={theme} testID="esport-adversaire-form">
      <Champ theme={theme} libelle={tr('pageTeam.nom')} valeur={nom} onChanger={setNom} testID="esport-adversaire-form-nom" maxLength={60} />
      <Champ theme={theme} libelle={tr('scouting.scouting.logo_adresse_https')} valeur={logo} onChanger={setLogo} testID="esport-adversaire-form-logo" />
      <ChampNote theme={theme} libelle={tr('scouting.scouting.notes_generales')} valeur={notes} onChanger={setNotes} testID="esport-adversaire-form-notes" />
      <BoutonHub theme={theme} titre={tr('discord.enregistrer')} variante="plein" onPress={() => onEnregistrer({ nom, logoUrl: logo.trim() || null, notes })} testID="esport-adversaire-form-enregistrer" />
    </Panneau>
  );
}

// ---------------------------------------------------------------- Joueurs

function Joueurs({ theme, joueurs, gerer, onAjouter, onModifier, onSupprimer }: { theme: ThemeHub; joueurs: JoueurAdverse[]; gerer: boolean; onAjouter(s: SaisieJoueur): Promise<boolean>; onModifier(id: string, s: SaisieJoueur): Promise<boolean>; onSupprimer(id: string): void }) {
  const [edition, setEdition] = useState<JoueurAdverse | 'nouveau' | undefined>();
  return (
    <Panneau theme={theme} testID="esport-joueurs-adverses">
      <Intertitre theme={theme}>{tr('scouting.scouting.joueurs_adverses')}</Intertitre>
      {joueurs.length === 0 ? <Text style={{ color: theme.attenue }}>{tr('scouting.scouting.aucun_joueur_renseigne')}</Text> : null}
      {joueurs.map(j => (
        <View key={j.id} testID={`esport-joueur-adverse-${j.id}`} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }}>
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>
            {j.pseudo}
            {j.role ? ` · ${j.role}` : ''}
          </Text>
          {j.riotId ? <Text style={{ color: theme.attenue, fontSize: 12 }}>{tr('scouting.scouting.riot_id', { riotId: j.riotId })}</Text> : null}
          {j.agents.length > 0 ? <Text style={{ color: theme.texte, fontSize: 13, ...police(theme.policeTexte) }}>{tr('scouting.scouting.agents', { v: j.agents.join(', ') })}</Text> : null}
          {j.notes ? <NoteMarkdown theme={theme} source={j.notes} /> : null}
          {gerer ? (
            <View style={styles.ligne}>
              <BoutonHub theme={theme} titre={tr('membresRoles.modifier')} onPress={() => setEdition(j)} testID={`esport-joueur-adverse-modifier-${j.id}`} />
              <BoutonConfirme theme={theme} titre={tr('resumes.retirer')} confirmation={tr('planning.disponibilites.oui_retirer')} onConfirme={() => onSupprimer(j.id)} testID={`esport-joueur-adverse-supprimer-${j.id}`} />
            </View>
          ) : null}
        </View>
      ))}
      {gerer && !edition ? <BoutonHub theme={theme} titre={tr('scouting.scouting.ajouter_un_joueur')} onPress={() => setEdition('nouveau')} testID="esport-joueur-adverse-ajouter" /> : null}
      {edition ? (
        <FormulaireJoueur
          key={edition === 'nouveau' ? 'nouveau' : edition.id}
          theme={theme}
          initial={edition === 'nouveau' ? undefined : edition}
          onEnregistrer={async s => {
            const ok = edition === 'nouveau' ? await onAjouter(s) : await onModifier(edition.id, s);
            if (ok) setEdition(undefined);
          }}
          onAnnuler={() => setEdition(undefined)}
        />
      ) : null}
    </Panneau>
  );
}

function FormulaireJoueur({ theme, initial, onEnregistrer, onAnnuler }: { theme: ThemeHub; initial?: JoueurAdverse; onEnregistrer(s: SaisieJoueur): void; onAnnuler(): void }) {
  const [pseudo, setPseudo] = useState(initial?.pseudo ?? '');
  const [riotId, setRiotId] = useState(initial?.riotId ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [agents, setAgents] = useState(initial?.agents.join(', ') ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  return (
    <View style={{ gap: 8 }} testID="esport-joueur-adverse-form">
      <Champ theme={theme} libelle={tr('scouting.scouting.pseudo')} valeur={pseudo} onChanger={setPseudo} testID="esport-joueur-adverse-pseudo" maxLength={40} />
      <Champ theme={theme} libelle={tr('scouting.scouting.riot_id_2')} valeur={riotId} onChanger={setRiotId} testID="esport-joueur-adverse-riot" placeholder="Pseudo#TAG" maxLength={40} />
      <Champ theme={theme} libelle={tr('membresGlobal.role')} valeur={role} onChanger={setRole} testID="esport-joueur-adverse-role" placeholder={tr('scouting.scouting.duelliste_controleur')} maxLength={30} />
      <Champ theme={theme} libelle={tr('scouting.scouting.agents_joues_separes_par')} valeur={agents} onChanger={setAgents} testID="esport-joueur-adverse-agents" placeholder="Jett, Raze" />
      <ChampNote theme={theme} libelle={tr('scouting.scouting.notes')} valeur={notes} onChanger={setNotes} testID="esport-joueur-adverse-notes" maxLength={1000} />
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={tr('discord.enregistrer')} variante="plein" desactive={pseudo.trim() === ''} onPress={() => onEnregistrer({ pseudo, riotId, role, agents: listeTexte(agents), notes })} testID="esport-joueur-adverse-enregistrer" />
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={onAnnuler} testID="esport-joueur-adverse-annuler" />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Tendances

function Tendances({ theme, tendances, gerer, onAjouter, onModifier, onSupprimer }: { theme: ThemeHub; tendances: TendanceMap[]; gerer: boolean; onAjouter(s: SaisieTendance): Promise<boolean>; onModifier(id: string, s: SaisieTendance): Promise<boolean>; onSupprimer(id: string): void }) {
  const [edition, setEdition] = useState<TendanceMap | 'nouveau' | undefined>();
  return (
    <Panneau theme={theme} testID="esport-tendances">
      <Intertitre theme={theme}>{tr('scouting.scouting.tendances_par_map_et')}</Intertitre>
      {tendances.length === 0 ? <Text style={{ color: theme.attenue }}>{tr('scouting.scouting.aucune_tendance_renseignee')}</Text> : null}
      {tendances.map(x => (
        <View key={x.id} testID={`esport-tendance-${x.id}`} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }}>
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>
            {x.map} · {nomSide(x.side)}
            {x.tauxVictoire !== null ? tr('scouting.scouting.de_victoires', { tauxVictoire: x.tauxVictoire }) : ''}
          </Text>
          {x.notes ? <NoteMarkdown theme={theme} source={x.notes} /> : null}
          {x.compos.map((c, i) => (
            <Text key={i} style={{ color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) }}>
              {tr('scouting.scouting.compo', { v: i + 1, v2: c.join(', ') })}</Text>
          ))}
          {gerer ? (
            <View style={styles.ligne}>
              <BoutonHub theme={theme} titre={tr('membresRoles.modifier')} onPress={() => setEdition(x)} testID={`esport-tendance-modifier-${x.id}`} />
              <BoutonConfirme theme={theme} titre={tr('resumes.retirer')} confirmation={tr('planning.disponibilites.oui_retirer')} onConfirme={() => onSupprimer(x.id)} testID={`esport-tendance-supprimer-${x.id}`} />
            </View>
          ) : null}
        </View>
      ))}
      {gerer && !edition ? <BoutonHub theme={theme} titre={tr('scouting.scouting.ajouter_une_tendance')} onPress={() => setEdition('nouveau')} testID="esport-tendance-ajouter" /> : null}
      {edition ? (
        <FormulaireTendance
          key={edition === 'nouveau' ? 'nouveau' : edition.id}
          theme={theme}
          initial={edition === 'nouveau' ? undefined : edition}
          onEnregistrer={async s => {
            const ok = edition === 'nouveau' ? await onAjouter(s) : await onModifier(edition.id, s);
            if (ok) setEdition(undefined);
          }}
          onAnnuler={() => setEdition(undefined)}
        />
      ) : null}
    </Panneau>
  );
}

function FormulaireTendance({ theme, initial, onEnregistrer, onAnnuler }: { theme: ThemeHub; initial?: TendanceMap; onEnregistrer(s: SaisieTendance): void; onAnnuler(): void }) {
  const [map, setMap] = useState(initial?.map ?? '');
  const [side, setSide] = useState<SideTendance>(initial?.side ?? 'attaque');
  const [taux, setTaux] = useState(initial?.tauxVictoire != null ? String(initial.tauxVictoire) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lignes, setLignes] = useState(initial?.compos.map(c => c.join(', ')).join('\n') ?? '');
  const [erreur, setErreur] = useState<string | undefined>();
  const valider = () => {
    let t: number | null = null;
    if (taux.trim() !== '') {
      t = Number(taux.replace(',', '.'));
      if (!Number.isInteger(t) || t < 0 || t > 100) return setErreur(tr('scouting.scouting.taux_de_victoire_un'));
    }
    setErreur(undefined);
    onEnregistrer({ map, side, tauxVictoire: t, notes, compos: compos(lignes) });
  };
  return (
    <View style={{ gap: 8 }} testID="esport-tendance-form">
      <Champ theme={theme} libelle={tr('scouting.scouting.map')} valeur={map} onChanger={setMap} testID="esport-tendance-map" placeholder={tr('scouting.scouting.ascent')} maxLength={30} />
      <Choix<SideTendance> theme={theme} libelle={tr('scouting.scouting.side')} valeur={side} options={sidesTendance().map(([id, nom]) => ({ id, nom }))} onChoisir={setSide} testID="esport-tendance-side" />
      <Champ theme={theme} libelle={tr('scouting.scouting.taux_de_victoire_en')} valeur={taux} onChanger={setTaux} testID="esport-tendance-taux" clavier="number-pad" />
      <ChampNote theme={theme} libelle={tr('scouting.scouting.tendances_rush_defauts_lineups')} valeur={notes} onChanger={setNotes} testID="esport-tendance-notes" maxLength={2000} />
      <Champ theme={theme} libelle={tr('scouting.scouting.compositions_habituelles_une_p')} valeur={lignes} onChanger={setLignes} testID="esport-tendance-compos" multiligne />
      {erreur ? (
        <Text accessibilityRole="alert" style={{ color: theme.critique }} testID="esport-tendance-erreur">
          {erreur}
        </Text>
      ) : null}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={tr('discord.enregistrer')} variante="plein" desactive={map.trim().length < 2} onPress={valider} testID="esport-tendance-enregistrer" />
        <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={onAnnuler} testID="esport-tendance-annuler" />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- VODs

function Vods({
  theme,
  vods,
  droits,
  onAjouter,
  onSupprimer,
  onOuvrirReview,
  onVoirReview,
}: {
  theme: ThemeHub;
  vods: VodAdverse[];
  droits: DetailAdversaire['droits'];
  onAjouter(url: string, titre: string): Promise<boolean>;
  onSupprimer(id: string): void;
  onOuvrirReview(id: string): void;
  onVoirReview(reviewId: string): void;
}) {
  const [url, setUrl] = useState('');
  const [titre, setTitre] = useState('');
  return (
    <Panneau theme={theme} testID="esport-vods">
      <Intertitre theme={theme}>{tr('scouting.vods_titre')}</Intertitre>
      {vods.length === 0 ? <Text style={{ color: theme.attenue }}>{tr('scouting.scouting.aucune_vod')}</Text> : null}
      {vods.map(v => (
        <View key={v.id} testID={`esport-vod-${v.id}`} style={{ gap: 4, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }}>
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{v.titre}</Text>
          <Text style={{ color: theme.attenue, fontSize: 12 }} numberOfLines={1}>
            {v.url}
          </Text>
          <View style={styles.ligne}>
            <BoutonHub theme={theme} titre={tr('scouting.scouting.ouvrir_le_lien')} onPress={() => void Linking.openURL(v.url)} testID={`esport-vod-lien-${v.id}`} />
            {droits.voirReview && v.reviewId ? <BoutonHub theme={theme} titre={tr('scouting.scouting.voir_la_review')} variante="plein" onPress={() => onVoirReview(v.reviewId!)} testID={`esport-vod-voir-review-${v.id}`} /> : null}
            {droits.voirReview && !v.reviewId && droits.gerer && droits.creerReview ? (
              <BoutonHub theme={theme} titre={tr('scouting.scouting.ouvrir_en_review_video')} variante="plein" desactive={!v.youtube} onPress={() => onOuvrirReview(v.id)} testID={`esport-vod-review-${v.id}`} />
            ) : null}
            {droits.gerer ? <BoutonConfirme theme={theme} titre={tr('resumes.retirer')} confirmation={tr('planning.disponibilites.oui_retirer')} onConfirme={() => onSupprimer(v.id)} testID={`esport-vod-supprimer-${v.id}`} /> : null}
          </View>
          {!v.youtube && droits.voirReview ? <Text style={{ color: theme.attenue, fontSize: 12 }}>{tr('scouting.scouting.seules_les_videos_youtube')}</Text> : null}
        </View>
      ))}
      {droits.gerer ? (
        <View style={{ gap: 8 }} testID="esport-vod-form">
          <Champ theme={theme} libelle={tr('scouting.scouting.adresse_de_la_vod')} valeur={url} onChanger={setUrl} testID="esport-vod-url" placeholder="https://www.youtube.com/watch?v=…" />
          <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={titre} onChanger={setTitre} testID="esport-vod-titre" maxLength={120} />
          <BoutonHub
            theme={theme}
            titre={tr('scouting.scouting.ajouter_la_vod')}
            desactive={url.trim() === '' || titre.trim().length < 2}
            onPress={() =>
              void onAjouter(url, titre).then(ok => {
                if (ok) {
                  setUrl('');
                  setTitre('');
                }
              })
            }
            testID="esport-vod-ajouter"
          />
        </View>
      ) : null}
    </Panneau>
  );
}

// ---------------------------------------------------------------- Confrontations

function Confrontations({ theme, confrontations, voirReview, onReview }: { theme: ThemeHub; confrontations: Confrontation[] | null; voirReview: boolean; onReview(id: string): void }) {
  return (
    <Panneau theme={theme} testID="esport-confrontations">
      <Intertitre theme={theme}>{tr('scouting.scouting.historique_des_confrontations')}</Intertitre>
      {confrontations === null ? <Text style={{ color: theme.attenue }}>{tr('scouting.scouting.le_planning_n_est')}</Text> : null}
      {confrontations?.length === 0 ? (
        <Text style={{ color: theme.attenue, ...police(theme.policeTexte) }}>{tr('scouting.scouting.aucune_confrontation_liee_choi')}</Text>
      ) : null}
      {confrontations?.map(c => (
        <View key={c.id} testID={`esport-confrontation-${c.id}`} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }}>
          <Text style={{ color: theme.texte, fontWeight: '700', ...police(theme.policeTexte) }}>{c.titre}</Text>
          <Text style={{ color: theme.attenue, fontSize: 12 }}>
            {dateCourte(c.debut)} · {c.type}
            {c.recurrent ? tr('scouting.scouting.serie') : ''}
            {Date.parse(c.debut) > Date.now() ? tr('scouting.scouting.a_venir') : ''}
          </Text>
          {voirReview && c.reviewId ? <BoutonHub theme={theme} titre={tr('scouting.scouting.voir_la_review')} onPress={() => onReview(c.reviewId!)} testID={`esport-confrontation-review-${c.id}`} /> : null}
        </View>
      ))}
    </Panneau>
  );
}

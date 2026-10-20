/**
 * Module « Playbook » (phase 6) : bibliothèque de la team par carte, side et
 * type, en grille avec miniatures. Recherche, filtres combinés (carte, side,
 * type, statut, tag, favoris), statuts (brouillon, validée, archivée),
 * favoris. Une entrée ouvre sa strat dans l'éditeur, ou est purement
 * textuelle.
 *
 * Droits (vérifiés par le serveur) : lecture pour tous les membres
 * (playbook.view), gestion pour le Coach et l'Analyste (playbook.manage).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import { apiStrats, type EntreePlaybook, type FiltresPlaybook, type Playbook as DonneesPlaybook, type StatutPlaybook, type Strat } from '../../strats/api';
import type { Side, TypeStrat } from '../../strats/document';
import { LIBELLES_SIDE, LIBELLES_STATUT_PLAYBOOK, LIBELLES_TYPE_STRAT, TYPES_STRAT, lireTags } from '../../strats/libelles';
import { BoutonConfirme, Choix, Retours, styles, useAgir, Intertitre, Panneau } from '../commun';
import { ESP, EnTetePage, Pliable } from '../design';
import type { PropsModule } from '../modules';
import { Etiquette, Filtre, MentionRiot, Miniature, demanderStrat, useAssets } from './commun';
import { tr, trn } from '../../i18n';

const couleurStatut = (theme: ThemeHub, s: StatutPlaybook) => ({ brouillon: theme.attenue, validee: theme.ok, archivee: theme.alerte })[s];

export function Playbook({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiStrats(client), [client]);
  const assets = useAssets();
  const [donnees, setDonnees] = useState<DonneesPlaybook | undefined>();
  const [filtres, setFiltres] = useState<FiltresPlaybook>({});
  const [recherche, setRecherche] = useState('');
  const [creation, setCreation] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();
  const stratsActif = detail.modules.some(m => m.cle === 'strat_editor' && m.active);
  const listerStrats = useCallback(() => api.liste(teamId), [api, teamId]);

  const recharger = useCallback(async () => setDonnees(await api.playbook(teamId, { ...filtres, q: recherche.trim() || undefined })), [api, teamId, filtres, recherche]);
  useEffect(() => {
    void agir('', recharger);
  }, [agir, recharger]);

  const gerer = Boolean(donnees?.gerer);
  const modifier = (e: EntreePlaybook, champs: Parameters<typeof api.modifierEntree>[2], message?: string) =>
    void agir('playbook', async () => {
      await api.modifierEntree(teamId, e.id, champs);
      await recharger();
      return message;
    });
  const cartes = [...new Map([...(donnees?.cartes ?? []), ...(assets?.cartes ?? []).map(c => ({ cle: c.cle, nom: c.nom }))].map(c => [c.cle, c])).values()];
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  return (
    <View style={{ gap: ESP.l }} testID="esport-playbook">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('strats.playbook.playbook')}
        sous={tr('strats.playbook.la_bibliotheque_de_la')}
        action={gerer ? <BoutonHub theme={theme} titre={creation ? tr('discord.fermer') : tr('strats.playbook.nouvelle_entree_2')} variante={creation ? 'normal' : 'plein'} onPress={() => setCreation(!creation)} testID="esport-playbook-nouvelle" /> : undefined}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-playbook" />
      <Champ theme={theme} libelle={tr('membresGlobal.rechercher')} valeur={recherche} onChanger={setRecherche} placeholder={tr('strats.playbook.titre_description_tag')} maxLength={60} style={{ maxWidth: 480 }} testID="esport-playbook-recherche" />
      {creation ? (
        <NouvelleEntree
          theme={theme}
          cartes={cartes}
          strats={stratsActif && detail.moi.permissions.includes('strats.view') ? listerStrats : undefined}
          enCours={Boolean(enCours)}
          onCreer={corps =>
            void agir('creation', async () => {
              await api.creerEntree(teamId, corps);
              setCreation(false);
              await recharger();
              return tr('strats.playbook.entree_ajoutee_au_playbook');
            })
          }
        />
      ) : null}
      <Pliable
        theme={theme}
        titre={tr('planning.planning.filtres')}
        ouvertParDefaut={large}
        resume={[filtres.statut ? { validee: tr('strats.playbook.validees'), brouillon: tr('strats.playbook.brouillons').toLowerCase(), archivee: tr('strats.playbook.archivees'), tous: tr('journal.toutes').toLowerCase() }[filtres.statut] : '', filtres.carte ?? '', filtres.side ? LIBELLES_SIDE[filtres.side] : '', filtres.type ? LIBELLES_TYPE_STRAT[filtres.type] : '', filtres.tag ? `#${filtres.tag}` : '', filtres.favoris ? tr('strats.playbook.favoris').toLowerCase() : ''].filter(Boolean).join(' · ') || tr('planning.planning.filtre_aucun')}
        testID="esport-playbook-filtres-ouvrir">
      <Panneau theme={theme} testID="esport-playbook-filtres">
        <Filtre<StatutPlaybook | 'tous'>
          theme={theme}
          libelle={tr('membresGlobal.statut')}
          valeur={filtres.statut ?? ''}
          options={[['', tr('strats.playbook.actives')], ['validee', tr('strats.playbook.validees_2')], ['brouillon', tr('strats.playbook.brouillons')], ['archivee', tr('strats.playbook.archivees_2')], ['tous', tr('journal.toutes')]]}
          onChoisir={v => setFiltres(f => ({ ...f, statut: v || undefined }))}
          testID="esport-playbook-filtre-statut"
        />
        <Filtre theme={theme} libelle={tr('strats.editeur.carte')} valeur={filtres.carte ?? ''} options={[['', tr('journal.toutes')], ...(donnees?.cartes ?? []).map(c => [c.cle, c.nom] as const)]} onChoisir={v => setFiltres(f => ({ ...f, carte: v || undefined }))} testID="esport-playbook-filtre-carte" />
        <Filtre<Side> theme={theme} libelle={tr('scouting.scouting.side')} valeur={filtres.side ?? ''} options={[['', tr('strats.playbook.les_deux')], ['attaque', tr('strats.editeur.attaque')], ['defense', tr('strats.editeur.defense')]]} onChoisir={v => setFiltres(f => ({ ...f, side: v || undefined }))} testID="esport-playbook-filtre-side" />
        <Filtre<TypeStrat> theme={theme} libelle={tr('resumes.type')} valeur={filtres.type ?? ''} options={[['', tr('journal.tous')], ...TYPES_STRAT.map(t => [t, LIBELLES_TYPE_STRAT[t]] as const)]} onChoisir={v => setFiltres(f => ({ ...f, type: v || undefined }))} testID="esport-playbook-filtre-type" />
        {donnees?.tags.length ? <Filtre theme={theme} libelle={tr('strats.playbook.tag')} valeur={filtres.tag ?? ''} options={[['', tr('journal.tous')], ...donnees.tags.map(t => [t, `#${t}`] as const)]} onChoisir={v => setFiltres(f => ({ ...f, tag: v || undefined }))} testID="esport-playbook-filtre-tag" /> : null}
        <Filtre<'1'> theme={theme} libelle={tr('strats.playbook.favoris')} valeur={filtres.favoris ? '1' : ''} options={[['', tr('strats.playbook.tout')], ['1', tr('strats.playbook.favoris_2')]]} onChoisir={v => setFiltres(f => ({ ...f, favoris: v === '1' || undefined }))} testID="esport-playbook-filtre-favoris" />
      </Panneau>
      </Pliable>
      {donnees ? <Text style={attenue} testID="esport-playbook-compte">{tr('strats.playbook.entree_s_sur', { entrees: trn('strats.playbook.entrees', donnees.entrees.length), total: donnees.total })}</Text> : null}
      <View style={[styles.ligne, { alignItems: 'stretch' }]}>
        {donnees?.entrees.map(e => (
          <Panneau key={e.id} theme={theme} style={{ width: large ? 250 : '100%', gap: 8 }} testID={`esport-playbook-entree-${e.id}`}>
            {e.strat ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('strats.playbook.ouvrir_la_strat', { titre: e.strat.titre })}
                disabled={!e.strat.ouvrable}
                onPress={() => {
                  if (!e.strat) return;
                  demanderStrat(e.strat.id);
                  onAller('module:strat_editor');
                }}>
                <Miniature theme={theme} url={e.miniature?.url} carte={e.carte?.nom} taille={large ? 125 : 180} testID="esport-playbook-miniature" />
              </Pressable>
            ) : (
              <View style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.ligne, borderStyle: 'dashed' }}>
                <Text style={{ color: theme.texte, ...police(theme.policeTexte) }} numberOfLines={6}>
                  {e.description || tr('strats.playbook.entree_textuelle')}
                </Text>
              </View>
            )}
            <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, flex: 1, ...police(theme.policeTexte) }} numberOfLines={2}>
                {e.favori ? '★ ' : ''}
                {e.titre}
              </Text>
              {gerer ? (
                <Pressable accessibilityRole="button" accessibilityLabel={e.favori ? tr('strats.playbook.retirer_des_favoris') : tr('strats.playbook.ajouter_aux_favoris')} onPress={() => modifier(e, { favori: !e.favori })} testID={`esport-playbook-favori-${e.id}`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: e.favori ? theme.alerte : theme.attenue, fontSize: 20 }}>{e.favori ? '★' : '☆'}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={[styles.ligne, { gap: 4 }]}>
              <Etiquette theme={theme} texte={LIBELLES_STATUT_PLAYBOOK[e.statut]} couleur={couleurStatut(theme, e.statut)} />
              <Etiquette theme={theme} texte={e.carte?.nom ?? tr('strats.playbook.toutes_cartes')} />
              {e.side ? <Etiquette theme={theme} texte={LIBELLES_SIDE[e.side]} /> : null}
              <Etiquette theme={theme} texte={LIBELLES_TYPE_STRAT[e.type]} />
              {e.tags.map(t => (
                <Etiquette key={t} theme={theme} texte={`#${t}`} />
              ))}
            </View>
            {e.strat && e.description ? <Text style={attenue} numberOfLines={3}>{e.description}</Text> : null}
            {e.validePar && e.statut === 'validee' ? <Text style={attenue}>{tr('strats.playbook.validee_par', { nom: e.validePar.pseudo ?? '?' })}</Text> : null}
            <View style={[styles.ligne, { gap: 6 }]}>
              {e.strat?.ouvrable ? (
                <BoutonHub
                  theme={theme}
                  titre={tr('strats.playbook.ouvrir_la_strat_2')}
                  onPress={() => {
                    if (!e.strat) return;
                    demanderStrat(e.strat.id);
                    onAller('module:strat_editor');
                  }}
                  testID={`esport-playbook-ouvrir-${e.id}`}
                />
              ) : null}
              {gerer && e.statut !== 'validee' ? <BoutonHub theme={theme} titre={tr('demandesCompte.valider')} variante="plein" onPress={() => modifier(e, { statut: 'validee' }, tr('strats.playbook.entree_validee_la_team'))} testID={`esport-playbook-valider-${e.id}`} /> : null}
              {gerer && e.statut === 'validee' ? <BoutonHub theme={theme} titre={tr('strats.playbook.repasser_en_brouillon')} onPress={() => modifier(e, { statut: 'brouillon' })} testID={`esport-playbook-brouillon-${e.id}`} /> : null}
              {gerer && e.statut !== 'archivee' ? <BoutonHub theme={theme} titre={tr('strats.playbook.archiver')} onPress={() => modifier(e, { statut: 'archivee' })} testID={`esport-playbook-archiver-${e.id}`} /> : null}
              {gerer ? (
                <BoutonConfirme
                  theme={theme}
                  titre={tr('resumes.retirer')}
                  confirmation={tr('planning.disponibilites.oui_retirer')}
                  onConfirme={() =>
                    void agir('suppression', async () => {
                      await api.supprimerEntree(teamId, e.id);
                      await recharger();
                    })
                  }
                  testID={`esport-playbook-supprimer-${e.id}`}
                />
              ) : null}
            </View>
          </Panneau>
        ))}
      </View>
      {donnees && donnees.entrees.length === 0 ? <Text style={attenue}>{tr('strats.playbook.aucune_entree_pour_ces')}</Text> : null}
      <MentionRiot theme={theme} />
    </View>
  );
}

function NouvelleEntree({
  theme,
  cartes,
  strats,
  onCreer,
  enCours,
}: {
  theme: ThemeHub;
  cartes: Array<{ cle: string; nom: string }>;
  strats?: () => Promise<Strat[]>;
  onCreer(corps: Parameters<ReturnType<typeof apiStrats>['creerEntree']>[1]): void;
  enCours: boolean;
}) {
  const [liste, setListe] = useState<Strat[]>([]);
  const [stratId, setStratId] = useState<string>('');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [carte, setCarte] = useState<string>('');
  const [side, setSide] = useState<Side | ''>('');
  const [type, setType] = useState<TypeStrat>('default');
  const [tags, setTags] = useState('');
  useEffect(() => {
    strats?.().then(l => setListe(l.filter(s => s.visibilite === 'team')), () => undefined);
  }, [strats]);
  const liee = liste.find(s => s.id === stratId);
  return (
    <Panneau theme={theme} testID="esport-playbook-creation">
      <Intertitre theme={theme}>{tr('strats.playbook.nouvelle_entree')}</Intertitre>
      {strats ? (
        <Choix theme={theme} libelle={tr('strats.playbook.liee_a_une_strat')} valeur={stratId} options={[{ id: '', nom: tr('strats.playbook.aucune_texte') }, ...liste.map(s => ({ id: s.id, nom: s.titre }))]} onChoisir={setStratId} testID="esport-playbook-strat" />
      ) : null}
      <Champ theme={theme} libelle={liee ? tr('strats.playbook.titre_vide_celui_de') : tr('objectifs.titre')} valeur={titre} onChanger={setTitre} maxLength={80} testID="esport-playbook-titre" />
      <Champ theme={theme} libelle={tr('pageTeam.description')} valeur={description} onChanger={setDescription} maxLength={4000} multiligne testID="esport-playbook-description" />
      {!liee ? (
        <>
          <Choix theme={theme} libelle={tr('strats.editeur.carte')} valeur={carte} options={[{ id: '', nom: tr('journal.toutes') }, ...cartes.map(c => ({ id: c.cle, nom: c.nom }))]} onChoisir={setCarte} testID="esport-playbook-carte" />
          <Segments<Side | ''> theme={theme} libelle={tr('scouting.scouting.side')} valeur={side} options={[['', tr('strats.playbook.les_deux')], ['attaque', tr('strats.editeur.attaque')], ['defense', tr('strats.editeur.defense')]]} onChoisir={setSide} testID="esport-playbook-side" />
          <Choix<TypeStrat> theme={theme} libelle={tr('resumes.type')} valeur={type} options={TYPES_STRAT.map(t => ({ id: t, nom: LIBELLES_TYPE_STRAT[t] }))} onChoisir={setType} testID="esport-playbook-type" />
        </>
      ) : null}
      <Champ theme={theme} libelle={tr('strats.playbook.tags_separes_par_des')} valeur={tags} onChanger={setTags} maxLength={200} testID="esport-playbook-tags" />
      <BoutonHub
        theme={theme}
        titre={tr('strats.playbook.ajouter_au_playbook')}
        variante="plein"
        desactive={enCours || (!liee && titre.trim().length < 2)}
        onPress={() => {
          const c = cartes.find(x => x.cle === carte);
          onCreer(
            liee
              ? { stratId: liee.id, titre: titre.trim() || undefined, description, tags: lireTags(tags) }
              : { titre: titre.trim(), description, carte: c ? { cle: c.cle, nom: c.nom } : null, side: side || null, type, tags: lireTags(tags) },
          );
        }}
        testID="esport-playbook-creer"
      />
    </Panneau>
  );
}

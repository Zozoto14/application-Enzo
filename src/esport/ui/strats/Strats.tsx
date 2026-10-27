/**
 * Module « Strats » (phase 6) : bibliothèque des strats de la team (grille
 * avec miniatures, filtres), création, duplication, partage (visibilité
 * team ou privée, lien de lecture seule révocable), ajout au playbook, et
 * l'éditeur :
 *  - site et app PC : éditeur Konva (Editeur.web.tsx, Konva chargé à la
 *    demande) ;
 *  - app iOS native (pas de WebView) : miniature et notes en lecture seule
 *    (Editeur.tsx).
 *
 * Droits (vérifiés par le serveur) : strats.view|create|update|delete|share.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import { dateCourte } from '../../libelles';
import { apiStrats, type FiltresStrats, type PartageStrat, type Strat } from '../../strats/api';
import type { Side, TypeStrat } from '../../strats/document';
import { LIBELLES_SIDE, LIBELLES_TYPE_STRAT, TYPES_STRAT, lireTags } from '../../strats/libelles';
import { Choix, Retours, styles, useAgir, Intertitre, Panneau } from '../commun';
import { Carte, ESP, EnTetePage, EtatVide, Grille, MenuActions, Pliable, SqueletteCartes } from '../design';
import type { PropsModule } from '../modules';
import { Editeur } from './Editeur';
import { Etiquette, Filtre, MentionRiot, Miniature, prendreStratDemandee, useAssetsTeam } from './commun';
import { cartesDuPool } from '../../jeux/profil';
import { tr } from '../../i18n';

export function Strats({ theme, client, detail, large, onAller }: PropsModule) {
  const teamId = detail.team.id;
  const api = useMemo(() => apiStrats(client), [client]);
  // Maps et agents du profil de jeu de la team (Valorant : avec les images Riot).
  const assets = useAssetsTeam(client, detail.team);
  const peut = (p: string) => detail.moi.permissions.includes(p);
  const [ouverte, setOuverte] = useState<string | undefined>(() => prendreStratDemandee());
  const [strats, setStrats] = useState<Strat[] | undefined>();
  const [filtres, setFiltres] = useState<FiltresStrats>({});
  const [recherche, setRecherche] = useState('');
  const [creation, setCreation] = useState(false);
  const [partage, setPartage] = useState<string | undefined>();
  const [aSupprimer, setASupprimer] = useState<string | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();

  const recharger = useCallback(async () => setStrats(await api.liste(teamId, { ...filtres, q: recherche.trim() || undefined })), [api, teamId, filtres, recherche]);
  useEffect(() => {
    if (!ouverte) void agir('', recharger);
  }, [agir, recharger, ouverte]);

  if (ouverte) {
    return (
      <Editeur
        theme={theme}
        api={api}
        teamId={teamId}
        stratId={ouverte}
        large={large}
        assets={assets}
        onRetour={() => setOuverte(undefined)}
        onOuvrir={id => setOuverte(id)}
      />
    );
  }

  const cartes = assets?.cartes ?? [];
  const playbookActif = detail.modules.some(m => m.cle === 'playbook' && m.active) && peut('playbook.manage');
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };

  return (
    <View style={{ gap: ESP.l }} testID="esport-strats">
      <EnTetePage
        theme={theme}
        large={large}
        titre={tr('strats.strats.strats')}
        sous={tr('strats.strats.strategies_dessinees_sur_la')}
        action={peut('strats.create') ? <BoutonHub theme={theme} titre={creation ? tr('discord.fermer') : tr('strats.strats.nouvelle_strat_2')} variante={creation ? 'normal' : 'plein'} onPress={() => setCreation(!creation)} testID="esport-strats-nouvelle" /> : undefined}
      />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-strats" />
      {creation ? (
        <NouvelleStrat
          theme={theme}
          cartes={cartesDuPool(assets).map(c => ({ cle: c.cle, nom: c.nom, image: c.minimap }))}
          onCreer={corps =>
            void agir('creation', async () => {
              const s = await api.creer(teamId, corps);
              setCreation(false);
              setOuverte(s.id);
            })
          }
          enCours={Boolean(enCours)}
        />
      ) : null}
      <View style={{ gap: ESP.s }}>
      <Champ theme={theme} libelle={tr('membresGlobal.rechercher')} valeur={recherche} onChanger={setRecherche} placeholder={tr('strats.strats.titre_carte_tag')} maxLength={60} style={{ maxWidth: 480 }} testID="esport-strats-recherche" />
      <Pliable theme={theme} titre={tr('planning.planning.filtres')} resume={[filtres.carte ? cartes.find(c => c.cle === filtres.carte)?.nom : '', filtres.side ? LIBELLES_SIDE[filtres.side] : '', filtres.type ? LIBELLES_TYPE_STRAT[filtres.type] : ''].filter(Boolean).join(' · ') || tr('planning.planning.filtre_aucun')} ouvertParDefaut={large} testID="esport-strats-filtres-ouvrir">
      <Panneau theme={theme} testID="esport-strats-filtres">
        <Filtre theme={theme} libelle={tr('strats.editeur.carte')} valeur={filtres.carte ?? ''} options={[['', tr('journal.toutes')], ...cartes.map(c => [c.cle, c.nom] as const)]} onChoisir={v => setFiltres(f => ({ ...f, carte: v || undefined }))} testID="esport-strats-filtre-carte" />
        <Filtre<Side> theme={theme} libelle={tr('scouting.scouting.side')} valeur={filtres.side ?? ''} options={[['', tr('strats.playbook.les_deux')], ['attaque', tr('strats.editeur.attaque')], ['defense', tr('strats.editeur.defense')]]} onChoisir={v => setFiltres(f => ({ ...f, side: v || undefined }))} testID="esport-strats-filtre-side" />
        <Filtre<TypeStrat> theme={theme} libelle={tr('resumes.type')} valeur={filtres.type ?? ''} options={[['', tr('journal.tous')], ...TYPES_STRAT.map(t => [t, LIBELLES_TYPE_STRAT[t]] as const)]} onChoisir={v => setFiltres(f => ({ ...f, type: v || undefined }))} testID="esport-strats-filtre-type" />
      </Panneau>
      </Pliable>
      </View>
      {!strats ? <SqueletteCartes theme={theme} n={large ? 3 : 1} large={large} /> : null}
      {strats?.length === 0 ? (
        <Carte theme={theme}>
          <EtatVide
            theme={theme}
            glyphe="◎"
            titre={Object.keys(filtres).some(k => filtres[k as keyof FiltresStrats]) || recherche ? tr('strats.strats.aucune_strat_pour_ces') : tr('strats.strats.aucune_strat_pour_l')}
            texte={tr('strats.strats.une_strat_se_dessine')}
            action={peut('strats.create') && !creation ? { titre: tr('strats.strats.nouvelle_strat_2'), onPress: () => setCreation(true) } : undefined}
          />
        </Carte>
      ) : null}
      <Grille min={large ? 260 : 280}>
        {strats?.map(s => (
          <Panneau key={s.id} theme={theme} style={{ gap: ESP.s, height: '100%' }} testID={`esport-strat-${s.id}`}>
            <Miniature theme={theme} url={s.miniature?.url} carte={s.carte.nom} taille={large ? 130 : 180} testID="esport-strat-miniature" />
            <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 15, ...police(theme.policeTexte) }} numberOfLines={2}>
              {s.titre}
            </Text>
            <View style={[styles.ligne, { gap: 4 }]}>
              <Etiquette theme={theme} texte={s.carte.nom} />
              <Etiquette theme={theme} texte={LIBELLES_SIDE[s.side]} couleur={s.side === 'attaque' ? theme.critique : theme.accent} />
              <Etiquette theme={theme} texte={LIBELLES_TYPE_STRAT[s.type]} />
              {s.visibilite === 'privee' ? <Etiquette theme={theme} texte={tr('strats.strats.privee')} couleur={theme.alerte} /> : null}
              {s.tags.map(t => (
                <Etiquette key={t} theme={theme} texte={`#${t}`} />
              ))}
            </View>
            <Text style={attenue}>
              {tr('strats.strats.modifiee_par', { date: dateCourte(s.majLe), nom: s.majPar.pseudo ?? '?', n: s.revision })}
            </Text>
            <View style={{ flex: 1 }} />
            <View style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]}>
              <View style={{ flex: 1 }}>
                <BoutonHub theme={theme} titre={tr('resumes.ouvrir_2')} variante="plein" onPress={() => setOuverte(s.id)} testID={`esport-strat-ouvrir-${s.id}`} />
              </View>
              <MenuActions
                theme={theme}
                libelle={tr('strats.strats.plus_d_actions_pour', { titre: s.titre })}
                testID={`esport-strat-actions-${s.id}`}
                actions={[
                  peut('strats.create') && {
                    titre: tr('membresRoles.dupliquer'),
                    testID: `esport-strat-dupliquer-${s.id}`,
                    onPress: () =>
                      void agir('duplication', async () => {
                        const copie = await api.dupliquer(teamId, s.id);
                        await recharger();
                        return tr('strats.strats.copie_creee', { titre: copie.titre });
                      }),
                  },
                  playbookActif && s.visibilite === 'team' && {
                    titre: tr('strats.playbook.ajouter_au_playbook'),
                    testID: `esport-strat-playbook-${s.id}`,
                    onPress: () =>
                      void agir('playbook', async () => {
                        await api.creerEntree(teamId, { stratId: s.id, tags: s.tags });
                        onAller('module:playbook');
                      }),
                  },
                  s.moi.partager && { titre: partage === s.id ? tr('strats.strats.masquer_le_partage') : tr('strats.strats.partage_et_lien'), testID: `esport-strat-lien-${s.id}`, onPress: () => setPartage(partage === s.id ? undefined : s.id) },
                  s.moi.supprimer && { titre: tr('strats.strats.supprimer'), danger: true, testID: `esport-strat-supprimer-${s.id}`, onPress: () => setASupprimer(s.id) },
                ]}
              />
            </View>
            {aSupprimer === s.id ? (
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub
                  theme={theme}
                  titre={tr('planning.planning.oui_supprimer')}
                  variante="danger"
                  onPress={() =>
                    void agir('suppression', async () => {
                      setASupprimer(undefined);
                      await api.supprimer(teamId, s.id);
                      await recharger();
                      return tr('strats.strats.strat_supprimee');
                    })
                  }
                  testID={`esport-strat-supprimer-${s.id}-confirmer`}
                />
                <BoutonHub theme={theme} titre={tr('assistant.annuler')} onPress={() => setASupprimer(undefined)} testID={`esport-strat-supprimer-${s.id}-annuler`} />
              </View>
            ) : null}
            {partage === s.id ? <Partages theme={theme} api={api} teamId={teamId} strat={s} /> : null}
          </Panneau>
        ))}
      </Grille>
      <MentionRiot theme={theme} jeu={assets?.jeu} />
    </View>
  );
}

function NouvelleStrat({
  theme,
  cartes,
  onCreer,
  enCours,
}: {
  theme: ThemeHub;
  cartes: Array<{ cle: string; nom: string; image: string | null }>;
  onCreer(corps: { titre: string; type: TypeStrat; carte: { cle: string; nom: string; image: string | null }; side: Side; tags: string[]; visibilite: 'team' | 'privee' }): void;
  enCours: boolean;
}) {
  const [titre, setTitre] = useState('');
  const [carte, setCarte] = useState<string | undefined>();
  const [side, setSide] = useState<Side>('attaque');
  const [type, setType] = useState<TypeStrat>('default');
  const [tags, setTags] = useState('');
  const [privee, setPrivee] = useState(false);
  const choisie = cartes.find(c => c.cle === carte);
  return (
    <Panneau theme={theme} testID="esport-strats-creation">
      <Intertitre theme={theme}>{tr('strats.strats.nouvelle_strat')}</Intertitre>
      <Champ theme={theme} libelle={tr('objectifs.titre')} valeur={titre} onChanger={setTitre} maxLength={80} placeholder={tr('strats.strats.execution_a_retake_b')} testID="esport-strats-titre" />
      <Choix theme={theme} libelle={tr('strats.editeur.carte')} valeur={carte} options={cartes.map(c => ({ id: c.cle, nom: c.nom }))} onChoisir={setCarte} testID="esport-strats-carte" />
      <Segments<Side> theme={theme} libelle={tr('scouting.scouting.side')} valeur={side} options={[['attaque', tr('strats.editeur.attaque')], ['defense', tr('strats.editeur.defense')]]} onChoisir={setSide} testID="esport-strats-side" />
      <Choix<TypeStrat> theme={theme} libelle={tr('resumes.type')} valeur={type} options={TYPES_STRAT.map(t => ({ id: t, nom: LIBELLES_TYPE_STRAT[t] }))} onChoisir={setType} testID="esport-strats-type" />
      <Champ theme={theme} libelle={tr('strats.playbook.tags_separes_par_des')} valeur={tags} onChanger={setTags} maxLength={200} testID="esport-strats-tags" />
      <Segments<'team' | 'privee'> theme={theme} libelle={tr('resumes.visibilite')} valeur={privee ? 'privee' : 'team'} options={[['team', tr('strats.strats.partagee_avec_la_team')], ['privee', tr('strats.strats.privee_brouillon')]]} onChoisir={v => setPrivee(v === 'privee')} testID="esport-strats-visibilite" />
      <BoutonHub
        theme={theme}
        titre={tr('strats.strats.creer_et_ouvrir_l')}
        variante="plein"
        desactive={enCours || titre.trim().length < 2 || !choisie}
        onPress={() => choisie && onCreer({ titre: titre.trim(), type, carte: choisie, side, tags: lireTags(tags), visibilite: privee ? 'privee' : 'team' })}
        testID="esport-strats-creer"
      />
    </Panneau>
  );
}

/** Liens de lecture seule d'une strat : créer (le lien n'est montré qu'une fois), lister, révoquer. */
function Partages({ theme, api, teamId, strat }: { theme: ThemeHub; api: ReturnType<typeof apiStrats>; teamId: string; strat: Strat }) {
  const [liens, setLiens] = useState<PartageStrat[] | undefined>();
  const [nouveau, setNouveau] = useState<PartageStrat | undefined>();
  const [jours, setJours] = useState('');
  const { erreur, agir } = useAgir();
  const charger = useCallback(async () => setLiens(await api.partages(teamId, strat.id)), [api, teamId, strat.id]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const attenue = { color: theme.attenue, fontSize: 12, ...police(theme.policeTexte) };
  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: 8 }} testID="esport-strat-partages">
      <Text style={attenue}>{tr('strats.strats.un_lien_de_lecture')}</Text>
      <View style={styles.ligne}>
        <Champ theme={theme} libelle={tr('strats.strats.validite_jours_vide_sans')} valeur={jours} onChanger={v => setJours(v.replace(/\D/g, ''))} clavier="number-pad" maxLength={3} style={{ minWidth: 140 }} testID="esport-strat-partage-jours" />
        <BoutonHub
          theme={theme}
          titre={tr('strats.strats.creer_un_lien')}
          onPress={() =>
            void agir('lien', async () => {
              setNouveau(await api.creerPartage(teamId, strat.id, jours ? { jours: Number(jours) } : {}));
              await charger();
            })
          }
          testID="esport-strat-partage-creer"
        />
      </View>
      {nouveau?.url ? (
        <Text selectable style={{ color: theme.texte, fontSize: 12 }} testID="esport-strat-partage-url">
          {nouveau.url}
        </Text>
      ) : null}
      {liens?.map(l => (
        <View key={l.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ color: l.revoque ? theme.attenue : theme.texte, fontSize: 12, textDecorationLine: l.revoque ? 'line-through' : 'none' }}>
            {l.libelle} · {dateCourte(l.creeLe)}
            {l.expireLe ? tr('strats.strats.expire', { v: dateCourte(l.expireLe) }) : ''}
            {l.dernierAcces ? ` · vu ${dateCourte(l.dernierAcces)}` : ''}
          </Text>
          {!l.revoque ? (
            <BoutonHub
              theme={theme}
              titre={tr('planning.planning.revoquer')}
              variante="danger"
              onPress={() =>
                void agir('revocation', async () => {
                  await api.revoquerPartage(teamId, strat.id, l.id);
                  await charger();
                })
              }
              testID={`esport-strat-partage-revoquer-${l.id}`}
            />
          ) : null}
        </View>
      ))}
      <Retours theme={theme} erreur={erreur} prefixe="esport-strat-partage" />
    </View>
  );
}

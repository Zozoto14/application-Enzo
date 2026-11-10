/**
 * Administration › Bot Esport HQ › Fonctionnalités › Salons vocaux temporaires (Fondateur et permission
 * vocaux.configurer ; carte du registre src/esport/ui/bot/sections.ts) : salons vocaux temporaires d'Esport HQ
 * (« rejoindre pour créer », docs/esport/vocaux.md). État de la connexion (les salons exigent la connexion EN DIRECT),
 * permissions du bot, hubs ordinaires repliables (ligne de résumé : salon, verrouillé ; dépliés : salon, catégorie,
 * modèle du nom, limite, verrouillage). Les hubs d'événement se créent et se modifient SEULEMENT dans Administration ›
 * Événements › (événement) › Vocaux de l'événement : ici, une ligne compacte en lecture seule (« Hub de l'événement X —
 * configuré dans Événements », rôles autorisés en plus avec la puce du rôle staff de l'événement inclus d'office,
 * bouton « Ouvrir l'événement »). Rôles du staff, délai de
 * suppression, salons par membre, départ du propriétaire, journaux, et les salons temporaires ouverts. Tout est validé
 * par le serveur ; l'écran n'affiche que ce que la réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { formaterDate } from '../../i18n';
import { trVc, type CleVc } from '../../i18n/vocaux';
import { apiVocaux, type CommandesVocaux, type ConfigVocaux as Config, type Hub, type ReglagesVocaux, type ServeurVocaux } from '../../vocaux/api';
import { Choix, Intertitre, Panneau as Bloc, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, LARGEUR_CONTENU, Squelette, attenue, texte, type Ton } from '../design';
import { ChoixMultiple } from '../tickets/ConfigTickets';
import type { ContexteBot } from '../bot/sections';
import { SelecteurRepliable, optionsRoles, optionsSalons } from '../../../ui/selecteurs/SelecteurRepliable';

const quand = (iso: string | null | undefined) => (iso ? formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const entier = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const AUCUN = '-';

const hubVide = (modele: string): Hub => ({ id: '', nom: '', categorieId: null, modeleNom: modele, limite: 0, verrouille: false, tournoiId: null, rolesAutorises: [] });

/** Réglages sous la carte « Salons vocaux temporaires » de l'onglet Bot Esport HQ (registre des fonctionnalités). */
export function ReglagesVocaux(ctx: ContexteBot) {
  if (ctx.etat.vocaux && !ctx.etat.vocaux.configurer) return <Text style={attenue(ctx.theme)}>{trVc('sans_droit')}</Text>;
  return <ConfigVocaux theme={ctx.theme} client={ctx.client} large={ctx.large} integre onEvenements={ctx.ouvrirEvenements} />;
}

/** `integre` : dans une carte (pas de défilement ni de titre propres). */
export function ConfigVocaux({ theme, client, large, integre = false, onEvenements }: { theme: ThemeHub; client: ClientEsport; large: boolean; integre?: boolean; /** Administration › Événements, à la fiche d'un événement (hubs d'événement : configurés là-bas). */ onEvenements?(evenementId?: string): void }) {
  const api = useMemo(() => apiVocaux(client), [client]);
  const [conf, setConf] = useState<Config | undefined>();
  const [r, setR] = useState<ReglagesVocaux | undefined>();
  const [serveur, setServeur] = useState<ServeurVocaux | undefined>();
  const [cmd, setCmd] = useState<CommandesVocaux>({});
  // Hubs dépliés (index) : repliés par défaut s'il y en a plusieurs, pour que la page reste lisible.
  const [deplies, setDeplies] = useState<Set<number>>(new Set());
  const { erreur, avis, agir, enCours } = useAgir();
  const recevoir = useCallback((c: Config) => {
    setConf(c);
    setR(c.reglages);
    setDeplies(d => (d.size || c.reglages.hubs.length !== 1 ? d : new Set([0])));
    setCmd(c.commandes);
  }, []);
  const lireServeur = useCallback(
    () =>
      agir('discord', async () => {
        setServeur(await api.discord());
      }),
    [agir, api],
  );
  useEffect(() => {
    void agir('charger', async () => {
      recevoir(await api.config());
      setServeur(await api.discord().catch(() => undefined));
    });
  }, [agir, api, recevoir]);
  if (!conf || !r) return <Squelette theme={theme} lignes={5} testID="esport-vc-chargement" />;
  const salons = serveur?.salons ?? [];
  const vocaux = optionsSalons(salons, ['vocal']);
  const categories = [{ id: AUCUN, nom: trVc('hub_categorie_meme') }, ...optionsSalons(salons, ['categorie'])];
  const textes = [{ id: AUCUN, nom: trVc('sans_journaux') }, ...optionsSalons(salons, ['texte'], s => `# ${s.nom}`)];
  const roles = optionsRoles(serveur?.roles ?? []);
  const mode = conf.connexion?.mode ?? 'hors_ligne';
  const ton: Ton = mode === 'direct' ? 'ok' : mode === 'secours' ? 'alerte' : 'critique';
  const hub = (i: number, maj: Partial<Hub>) => setR({ ...r, hubs: r.hubs.map((h, j) => (j === i ? { ...h, ...maj } : h)) });
  const manquantes = serveur?.permissions?.serveur ?? [];
  const nomPerm = (cle: string) => trVc(`perm.${cle}` as CleVc);
  const enregistrer = () =>
    void agir('enregistrer', async () => {
      const nomDe = (id: string) => salons.find(s => s.id === id)?.nom;
      recevoir(await api.changer({ ...r, hubs: r.hubs.map(h => ({ ...h, nom: nomDe(h.id) ?? h.nom })) }));
      return trVc('enregistre');
    });
  const Cadre = integre ? View : ScrollView;
  const proprietes = integre ? { style: { gap: ESP.m } } : { contentContainerStyle: { padding: large ? ESP.xxl : ESP.m, gap: ESP.m, maxWidth: LARGEUR_CONTENU + 2 * ESP.xxl, width: '100%' as const, alignSelf: 'center' as const } };
  return (
    <Cadre {...proprietes} testID="esport-vc-config">
      {integre ? null : (
        <Text accessibilityRole="header" style={{ ...texte(theme, 20), fontWeight: '700' }}>
          {trVc('titre')}
        </Text>
      )}
      <Text style={attenue(theme)}>{trVc('aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vc" />

      <Bloc theme={theme} testID="esport-vc-etat">
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Badge theme={theme} ton={ton} texte={`${trVc('connexion.titre')} : ${trVc(`connexion.${mode}` as CleVc)}`} testID={`esport-vc-connexion-${mode}`} />
          <BoutonHub theme={theme} titre={trVc('verifier')} onPress={() => void lireServeur()} desactive={enCours === 'discord'} testID="esport-vc-verifier" />
        </View>
        {!conf.bot ? <Avis theme={theme} genre="critique" texte={trVc('sans_bot')} testID="esport-vc-sans-bot" /> : null}
        {!conf.serveur ? <Avis theme={theme} genre="alerte" texte={trVc('sans_serveur')} testID="esport-vc-sans-serveur" /> : null}
        {!conf.gatewayActivee ? <Avis theme={theme} genre="critique" texte={trVc('gateway_desactivee')} testID="esport-vc-gateway-off" /> : null}
        {r.actif && mode !== 'direct' ? <Avis theme={theme} genre="critique" texte={trVc('connexion_requise')} testID="esport-vc-connexion-requise" /> : <Text style={attenue(theme)}>{trVc('connexion_requise')}</Text>}
        <Text style={attenue(theme)}>{trVc('intent')}</Text>
        {conf.etat?.derniereErreur ? (
          <Text style={attenue(theme)} testID="esport-vc-derniere-erreur">
            {trVc('derniere_erreur', { motif: conf.etat.derniereErreur.motif, code: String(conf.etat.derniereErreur.code ?? conf.etat.derniereErreur.statut), le: quand(conf.etat.derniereErreur.le) })}
          </Text>
        ) : null}
        {conf.etat?.dernierSalon ? <Text style={attenue(theme)}>{trVc('dernier_salon', { le: quand(conf.etat.dernierSalon.le) })}</Text> : null}
        {conf.etat?.derniereCreation ? (
          <View testID="esport-vc-derniere-creation">
            <Text style={texte(theme, 14)}>{trVc('derniere_creation', { total: String(conf.etat.derniereCreation.totalMs), creation: String(conf.etat.derniereCreation.creationMs), deplacement: String(conf.etat.derniereCreation.deplacementMs) })}</Text>
            <Text style={attenue(theme)}>
              {trVc('derniere_creation_aide', { attente: String(conf.etat.derniereCreation.attenteMs), preparation: String(conf.etat.derniereCreation.preparationMs), connexion: trVc(`connexion_http.${conf.etat.derniereCreation.connexion ?? 'inconnue'}` as CleVc) })}
            </Text>
          </View>
        ) : null}
        {serveur?.permissions ? (
          <View style={{ gap: ESP.xs }} testID="esport-vc-permissions">
            <Intertitre theme={theme}>{trVc('permissions')}</Intertitre>
            {manquantes.length ? <Avis theme={theme} genre="alerte" texte={trVc('permissions_manquantes', { liste: manquantes.map(nomPerm).join(', ') })} testID="esport-vc-permissions-manquantes" /> : <Text style={attenue(theme)}>{trVc('permissions_ok')}</Text>}
            {serveur.permissions.hubs.map(h =>
              h.introuvable ? (
                <Avis key={h.id} theme={theme} genre="alerte" texte={`${h.id} : ${trVc('hub_introuvable')}`} />
              ) : h.manquantes.length ? (
                <Avis key={h.id} theme={theme} genre="alerte" texte={`${h.nom ?? h.id} : ${trVc('hub_manquantes', { liste: h.manquantes.map(nomPerm).join(', ') })}`} />
              ) : null,
            )}
          </View>
        ) : null}
        {conf.lienInvitation ? <BoutonHub theme={theme} titre={trVc('invitation')} onPress={() => void Linking.openURL(conf.lienInvitation ?? '')} testID="esport-vc-invitation" /> : null}
      </Bloc>

      <Bloc theme={theme} testID="esport-vc-reglages">
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trVc('actif')}</Text>
          <Interrupteur theme={theme} libelle={trVc('actif')} valeur={r.actif} onChanger={actif => setR({ ...r, actif })} testID="esport-vc-actif" />
        </View>
        <Intertitre theme={theme}>{trVc('hubs')}</Intertitre>
        <Text style={attenue(theme)}>{trVc('hubs_aide')}</Text>
        {r.hubs.map((h, i) => {
          const salonHub = vocaux.find(v => v.id === h.id)?.nom || h.nom || h.id || trVc('hub_sans_salon');
          const nomRole = (id: string) => roles.find(o => o.id === id)?.nom ?? id;
          if (h.tournoiId) {
            // Hub d'événement : configuré SEULEMENT dans Administration › Événements › (événement) › Vocaux de
            // l'événement. Ici, une ligne compacte en lecture seule (le serveur garde la version enregistrée).
            const evt = (conf.evenements ?? []).find(e => e.id === h.tournoiId);
            return (
              <View key={`evt-${h.id}`} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-vc-hub-${i}`}>
                <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ ...texte(theme), fontWeight: '700' }} testID={`esport-vc-hub-${i}-evenement-ligne`}>
                      {trVc('hub_evenement_ligne', { nom: evt?.nom ?? h.tournoiId })}
                    </Text>
                    <Text style={attenue(theme)} numberOfLines={2} testID={`esport-vc-hub-${i}-resume`}>
                      {trVc('hub_evenement_resume', { salon: salonHub, roles: h.rolesAutorises.length ? h.rolesAutorises.map(nomRole).join(', ') : trVc('hub_evenement_aucun') })}
                    </Text>
                  </View>
                  <Badge theme={theme} ton="accent" texte={trVc('hub_tournoi')} />
                </View>
                {/* Rôles autorisés en plus : le rôle staff de l'événement y est d'office (puce implicite). */}
                <Badge theme={theme} ton="accent" texte={evt?.staffRole ? trVc('hub_evenement_staff', { nom: evt.staffRole.nom || evt.staffRole.id }) : trVc('hub_evenement_staff_absent')} testID={`esport-vc-hub-${i}-staff`} />
                {conf.peutGererEvenements && onEvenements ? (
                  <View style={{ alignSelf: 'flex-start' }}>
                    <BoutonHub theme={theme} titre={trVc('hub_evenement_ouvrir')} onPress={() => onEvenements(h.tournoiId ?? undefined)} testID={`esport-vc-hub-${i}-ouvrir-evenement`} />
                  </View>
                ) : null}
              </View>
            );
          }
          const ouvert = deplies.has(i);
          const basculer = () => setDeplies(d => (d.has(i) ? new Set([...d].filter(x => x !== i)) : new Set([...d, i])));
          const resume = trVc('hub_resume', { salon: salonHub, verrou: h.verrouille ? trVc('hub_resume_verrou') : '' });
          return (
            <View key={i} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-vc-hub-${i}`}>
              <Pressable onPress={basculer} accessibilityRole="button" accessibilityState={{ expanded: ouvert }} accessibilityLabel={`${trVc('hub', { n: i + 1 })} : ${resume}`} style={[styles.ligne, { justifyContent: 'space-between' }]} testID={`esport-vc-hub-${i}-entete`}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ ...texte(theme), fontWeight: '700' }}>{trVc('hub', { n: i + 1 })}</Text>
                  <Text style={attenue(theme)} numberOfLines={2} testID={`esport-vc-hub-${i}-resume`}>
                    {resume}
                  </Text>
                </View>
                <Text style={attenue(theme)}>{trVc(ouvert ? 'hub_fermer' : 'hub_ouvrir')}</Text>
              </Pressable>
              {ouvert ? (
                <View style={{ gap: ESP.xs }} testID={`esport-vc-hub-${i}-details`}>
                  {vocaux.length ? <SelecteurRepliable theme={theme} nature="salon" libelle={trVc('hub_salon')} valeur={h.id || undefined} options={vocaux} onChoisir={id => hub(i, { id })} testID={`esport-vc-hub-${i}-salon`} /> : <Text style={attenue(theme)}>{h.nom || h.id || trVc('rien')}</Text>}
                  {categories.length > 1 ? <SelecteurRepliable theme={theme} nature="categorie" libelle={trVc('hub_categorie')} valeur={h.categorieId ?? AUCUN} options={categories} onChoisir={id => hub(i, { categorieId: id === AUCUN ? null : id })} testID={`esport-vc-hub-${i}-categorie`} /> : null}
                  <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
                    <Champ theme={theme} libelle={trVc('hub_modele')} valeur={h.modeleNom} onChanger={modeleNom => hub(i, { modeleNom })} maxLength={conf.choix.limites.modele} testID={`esport-vc-hub-${i}-modele`} style={{ flexGrow: 2, flexBasis: 220, minWidth: 0 }} />
                    <Champ theme={theme} libelle={trVc('hub_limite')} valeur={String(h.limite)} onChanger={v => hub(i, { limite: entier(v) })} maxLength={2} clavier="number-pad" testID={`esport-vc-hub-${i}-limite`} style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
                  </View>
                  <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
                    <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trVc('hub_verrouille')}</Text>
                    <Interrupteur theme={theme} libelle={trVc('hub_verrouille')} valeur={h.verrouille} onChanger={verrouille => hub(i, { verrouille })} testID={`esport-vc-hub-${i}-verrouille`} />
                  </View>
                  <BoutonHub
                    theme={theme}
                    variante="danger"
                    titre={trVc('hub_retirer')}
                    onPress={() => {
                      setR({ ...r, hubs: r.hubs.filter((_, j) => j !== i) });
                      setDeplies(new Set());
                    }}
                    testID={`esport-vc-hub-${i}-retirer`}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
        {r.hubs.length < conf.choix.limites.hubs ? <BoutonHub theme={theme} titre={trVc('hub_ajouter')} onPress={() => {
              setDeplies(d => new Set([...d, r.hubs.length]));
              setR({ ...r, hubs: [...r.hubs, hubVide(conf.choix.modeleDefaut)] });
            }} testID="esport-vc-hub-ajouter" /> : null}
        <Intertitre theme={theme}>{trVc('staff')}</Intertitre>
        <Text style={attenue(theme)}>{trVc('staff_aide')}</Text>
        <ChoixMultiple theme={theme} libelle={trVc('staff')} valeurs={r.rolesStaff} options={roles} onChanger={rolesStaff => setR({ ...r, rolesStaff })} max={conf.choix.limites.roles} testID="esport-vc-staff" />
        <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={trVc('delai')} valeur={String(r.delaiSuppressionS)} onChanger={v => setR({ ...r, delaiSuppressionS: entier(v) })} maxLength={3} clavier="number-pad" testID="esport-vc-delai" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
          <Champ theme={theme} libelle={trVc('par_membre')} valeur={String(r.maxParMembre)} onChanger={v => setR({ ...r, maxParMembre: entier(v) })} maxLength={1} clavier="number-pad" testID="esport-vc-par-membre" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
        </View>
        <Choix theme={theme} libelle={trVc('proprietaire_part')} valeur={r.quandProprietairePart} options={conf.choix.modesProprietaire.map(m => ({ id: m, nom: trVc(`mode.${m}` as CleVc) }))} onChoisir={quandProprietairePart => setR({ ...r, quandProprietairePart })} testID="esport-vc-proprietaire" />
        {textes.length > 1 ? <SelecteurRepliable theme={theme} nature="salon" libelle={trVc('journaux')} valeur={r.salonJournaux ?? AUCUN} options={textes} onChoisir={id => setR({ ...r, salonJournaux: id === AUCUN ? null : id })} testID="esport-vc-journaux" /> : null}
        <BoutonHub theme={theme} variante="plein" titre={trVc('enregistrer')} onPress={enregistrer} desactive={enCours === 'enregistrer'} testID="esport-vc-enregistrer" />
      </Bloc>

      <Bloc theme={theme} testID="esport-vc-commandes">
        <Intertitre theme={theme}>{trVc('commandes')}</Intertitre>
        <Text style={attenue(theme)}>{trVc('commandes_aide')}</Text>
        {conf.choix.commandes.map(nom => (
          <View key={nom} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-vc-cmd-${nom}`}>
            <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trVc(`cmd.${nom}` as CleVc)}</Text>
              <Interrupteur theme={theme} libelle={trVc(`cmd.${nom}` as CleVc)} valeur={cmd[nom]?.actif !== false} onChanger={actif => setCmd({ ...cmd, [nom]: { roles: cmd[nom]?.roles ?? [], actif } })} testID={`esport-vc-cmd-${nom}-actif`} />
            </View>
            {roles.length && cmd[nom]?.actif !== false ? <ChoixMultiple theme={theme} libelle={trVc('commande_roles')} valeurs={cmd[nom]?.roles ?? []} options={roles} onChanger={x => setCmd({ ...cmd, [nom]: { actif: true, roles: x } })} max={conf.choix.limites.roles} testID={`esport-vc-cmd-${nom}-roles`} /> : null}
          </View>
        ))}
        <BoutonHub theme={theme} variante="plein" titre={trVc('enregistrer')} onPress={() => void agir('commandes', async () => (recevoir(await api.changerCommandes(cmd)), trVc('enregistre')))} desactive={enCours === 'commandes'} testID="esport-vc-cmd-enregistrer" />
      </Bloc>

      <Bloc theme={theme} testID="esport-vc-salons">
        <Intertitre theme={theme}>{trVc('salons')}</Intertitre>
        {!conf.salons.length ? <Text style={attenue(theme)}>{trVc('salons_vide')}</Text> : null}
        {conf.salons.map(s => (
          <View key={s.id} style={[styles.ligne, { justifyContent: 'space-between' }]} testID={`esport-vc-salon-${s.id}`}>
            <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }} numberOfLines={2}>
              {trVc('salon_ligne', { nom: s.nom, proprietaire: s.proprietaireNom || s.proprietaireId || '—', presents: String(s.presents) })}
            </Text>
            {s.equipeId ? <Badge theme={theme} texte={trVc('equipe')} /> : null}
            {s.verrouille ? <Badge theme={theme} ton="alerte" texte={trVc('verrouille')} /> : null}
            {s.videDepuis ? <Badge theme={theme} texte={trVc('vide')} /> : null}
          </View>
        ))}
      </Bloc>
    </Cadre>
  );
}

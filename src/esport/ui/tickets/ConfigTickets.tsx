/**
 * Tickets › Configuration (Fondateur et permission tickets.configurer) : connexion Discord (en direct / secours / hors
 * ligne, permissions du bot et ce qui manque), réglages généraux, catégories (formulaire, rôles, accueil, liaison),
 * panneaux (aperçu « comme sur Discord », publication), messages, liste noire, horaires, commandes. Tout est validé
 * par le serveur ; l'écran n'affiche que ce que la réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { formaterDate } from '../../i18n';
import { trTk, type CleTk } from '../../i18n/tickets';
import { heuresPourMode, joursDeHeures, modeFermeture, texteDelai, type ModeFermeture } from '../../tickets/fermeture';
import { CLES_ANNONCES, apiTickets, type ApiTickets, type CleAnnonce, type Categorie, type ChampFormulaire, type ChargeDiscord, type ConfigTickets as Config, type Connexion, type DeuxLangues, type DiagnosticTickets, type EtatTickets, type General, type Horaires, type ModeLangue, type ModeleCategorie, type ModelePanneau, type Panneau, type Priorite, type ServeurDiscord, type TypeLiaison } from '../../tickets/api';
import { Glyphe } from '../../../ui/icones';
import { BoutonConfirme, Choix, Intertitre, Panneau as Bloc, Retours, styles, useAgir } from '../commun';
import { Badge, ESP, Onglets, Squelette, Volet, attenue, texte, type Ton } from '../design';
import { ChoixDrive } from '../cm/drive/ChoixDrive';
import { ApercuDiscord } from './ApercuDiscord';

export type SectionConfigTickets = 'connexion' | 'general' | 'categories' | 'panneaux' | 'messages' | 'liste' | 'horaires' | 'commandes' | 'bienvenue';
type Section = SectionConfigTickets;
const SECTIONS: ReadonlyArray<[Section, CleTk]> = [
  ['connexion', 'conf.connexion'],
  ['general', 'conf.general'],
  ['categories', 'conf.categories'],
  ['panneaux', 'conf.panneaux'],
  ['messages', 'conf.messages'],
  ['liste', 'conf.liste_noire'],
  ['horaires', 'conf.horaires'],
  ['commandes', 'conf.commandes'],
  ['bienvenue', 'conf.bienvenue'],
];
const VIDE: DeuxLangues = { fr: '', en: '' };
const quand = (iso: string | null | undefined) => (iso ? formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Pastille de l'état de la connexion Discord (aussi affichée en tête de la page Tickets). */
export function PastilleConnexion({ theme, connexion, actif }: { theme: ThemeHub; connexion?: Connexion; actif?: boolean }) {
  const mode = actif === false ? 'hors_ligne' : (connexion?.mode ?? 'hors_ligne');
  const ton: Ton = mode === 'direct' ? 'ok' : mode === 'secours' ? 'alerte' : 'critique';
  return <Badge theme={theme} ton={ton} texte={`${trTk('connexion.titre')} : ${trTk(`connexion.${mode}` as CleTk)}`} testID={`esport-tk-connexion-${mode}`} />;
}

/** Choix multiple en pastilles (rôles, catégories) ; aussi utilisé par Administration › Bot Esport HQ › Fonctionnalités. */
export function ChoixMultiple({ theme, libelle, valeurs, options, onChanger, max, testID }: { theme: ThemeHub; libelle: string; valeurs: string[]; options: ReadonlyArray<{ id: string; nom: string; couleur?: string | null }>; onChanger(v: string[]): void; max?: number; testID: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{libelle}</Text>
      <View style={styles.ligne}>
        {options.map(o => {
          const coche = valeurs.includes(o.id);
          const plein = !coche && max !== undefined && valeurs.length >= max;
          return (
            <Pressable
              key={o.id}
              testID={`${testID}-${o.id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: coche, disabled: plein }}
              accessibilityLabel={`${libelle} : ${o.nom}`}
              disabled={plein}
              onPress={() => onChanger(coche ? valeurs.filter(v => v !== o.id) : [...valeurs, o.id])}
              style={[styles.choix, { borderColor: coche ? (o.couleur ?? theme.accent) : theme.ligne, backgroundColor: coche ? teinteTransparente(o.couleur ?? theme.accent, 0.2) : theme.surface, borderRadius: 10, opacity: plein ? 0.4 : 1, maxWidth: '100%' }]}
            >
              <Text style={{ ...texte(theme, 13), fontWeight: coche ? '700' : '500', flexShrink: 1 }} numberOfLines={1}>
                {coche ? '✓ ' : ''}
                {o.nom}
              </Text>
            </Pressable>
          );
        })}
        {!options.length ? <Text style={attenue(theme)}>{trTk('rien')}</Text> : null}
      </View>
    </View>
  );
}

function DeuxChamps({ theme, cle, vars, valeur, onChanger, multiligne, max, testID }: { theme: ThemeHub; cle: [CleTk, CleTk]; vars?: Record<string, string>; valeur: DeuxLangues; onChanger(v: DeuxLangues): void; multiligne?: boolean; max?: number; testID: string }) {
  return (
    <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
      <Champ theme={theme} libelle={trTk(cle[0], vars)} valeur={valeur.fr} onChanger={fr => onChanger({ ...valeur, fr })} multiligne={multiligne} maxLength={max} testID={`${testID}-fr`} style={{ flexGrow: 1, flexBasis: 240, minWidth: 0 }} />
      <Champ theme={theme} libelle={trTk(cle[1], vars)} valeur={valeur.en} onChanger={en => onChanger({ ...valeur, en })} multiligne={multiligne} maxLength={max} testID={`${testID}-en`} style={{ flexGrow: 1, flexBasis: 240, minWidth: 0 }} />
    </View>
  );
}

const entier = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

export function ConfigTickets({ theme, client, large, sectionInitiale }: { theme: ThemeHub; client: ClientEsport; large: boolean; /** Section ouverte d'abord (lien depuis Administration › Bot Esport HQ). */ sectionInitiale?: SectionConfigTickets }) {
  const api = useMemo(() => apiTickets(client), [client]);
  const [conf, setConf] = useState<Config | undefined>();
  const [serveur, setServeur] = useState<ServeurDiscord | undefined>();
  const [connexion, setConnexion] = useState<EtatTickets | undefined>();
  const [section, setSection] = useState<Section>(sectionInitiale && SECTIONS.some(([id]) => id === sectionInitiale) ? sectionInitiale : 'connexion');
  const { erreur, avis, agir, enCours } = useAgir();
  const relire = useCallback(async () => {
    const [c, e] = await Promise.all([api.config(), api.etat()]);
    setConf(c);
    setConnexion(e);
  }, [api]);
  const relireEtat = useCallback(() => {
    void api
      .etat()
      .then(setConnexion)
      .catch(() => undefined);
  }, [api]);
  const verifier = useCallback(
    () =>
      agir('discord', async () => {
        setServeur(await api.discord());
        relireEtat();
      }),
    [agir, api, relireEtat],
  );
  useEffect(() => {
    void agir('charger', async () => {
      await relire();
      setServeur(await api.discord().catch(() => undefined));
    });
  }, [agir, relire, api]);
  if (!conf) return <Squelette theme={theme} lignes={5} testID="esport-tk-config-chargement" />;
  const roles = serveur?.roles ?? [];
  const salons = serveur?.salons ?? [];
  const props = { theme, api, conf, setConf, agir, large, roles, salons, client };
  return (
    <View style={{ gap: ESP.m }} testID="esport-tk-config">
      <Onglets theme={theme} prefixe="esport-tk-conf-onglet" testID="esport-tk-conf-onglets" actif={section} onChoisir={id => setSection(id as Section)} entrees={SECTIONS.map(([id, cle]) => ({ id, libelle: trTk(cle) }))} defilant={!large} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-tk-conf" />
      {section === 'connexion' ? <SectionConnexion theme={theme} conf={conf} connexion={connexion} serveur={serveur} enCours={enCours === 'discord'} onVerifier={verifier} /> : null}
      {section === 'general' ? (
        <SectionGeneral
          {...props}
          serveur={serveur}
          onServeur={setServeur}
          onEnregistre={relireEtat}
        />
      ) : null}
      {section === 'categories' ? <SectionCategories {...props} /> : null}
      {section === 'panneaux' ? <SectionPanneaux {...props} /> : null}
      {section === 'messages' ? <SectionMessages {...props} /> : null}
      {section === 'liste' ? <SectionListeNoire {...props} /> : null}
      {section === 'horaires' ? <SectionHoraires {...props} /> : null}
      {section === 'commandes' ? <SectionCommandes {...props} /> : null}
      {section === 'bienvenue' ? <SectionBienvenue {...props} /> : null}
    </View>
  );
}

type Agir = (libelle: string, action: () => Promise<string | void>) => Promise<boolean>;
interface PropsSection {
  theme: ThemeHub;
  api: ApiTickets;
  conf: Config;
  setConf(c: Config): void;
  agir: Agir;
  large: boolean;
  roles: Array<{ id: string; nom: string; couleur: string | null }>;
  salons: Array<{ id: string; nom: string; type: 'categorie' | 'texte'; parent: string | null }>;
  client: ClientEsport;
}

/** Erreur Discord lisible (et ce qu'il faut faire) d'une lecture du serveur ; null sans erreur. */
export function texteErreurDiscord(s?: ServeurDiscord): string | null {
  if (!s?.erreur) return null;
  if (s.erreur === 'bot-absent') return trTk('discord.err.bot-absent');
  const statut = s.erreurDetail?.statut ?? Number(/^discord-(\d+)$/.exec(s.erreur)?.[1] ?? NaN);
  const code = s.erreurDetail?.code ?? null;
  const etape = s.erreurDetail?.etape ? ` (${trTk(`discord.etape.${s.erreurDetail.etape}` as CleTk)})` : '';
  if (statut === 403) return trTk('discord.err.403', { code: code ? `, code ${code}${code === 50001 ? ' Missing Access' : ''}` : '' }) + etape;
  if ([0, 401, 404, 429].includes(statut)) return trTk(`discord.err.${statut}` as CleTk) + etape;
  return trTk('discord.err.autre', { code: `${s.erreur}${code ? `, code ${code}` : ''}` }) + etape;
}

// ------------------------------------------------------------------ Connexion

/** Une ligne du diagnostic : condition remplie (ou non), détail et, si besoin, ce qu'il faut faire. */
function LigneDiag({ theme, ok, titre, detail, commande, testID }: { theme: ThemeHub; ok: boolean; titre: string; detail?: string | null; commande?: string; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-start' }} testID={testID} accessibilityLabel={`${titre} : ${ok ? trTk('diag.ok') : trTk('diag.a_faire')}`}>
      <Glyphe valeur={ok ? 'valide' : 'alerte'} taille={14} couleur={ok ? theme.ok : theme.alerte} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>
          {titre} : {ok ? trTk('diag.ok') : trTk('diag.a_faire')}
        </Text>
        {detail ? <Text style={attenue(theme)}>{detail}</Text> : null}
        {commande ? (
          <Text selectable style={{ ...texte(theme, 12), fontFamily: 'monospace' }} testID={`${testID}-commande`}>
            {commande}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Diagnostic de la connexion (aussi dans Administration › Bot Esport HQ › Connexion et état). */
export function Diagnostic({ theme, d }: { theme: ThemeHub; d: DiagnosticTickets }) {
  const c = d.connexion;
  const pret = d.bot && d.serveur && d.categorie && d.actif;
  const etatGw = c.gateway ? trTk(`diag.etat.${c.gateway}` as CleTk) : '—';
  return (
    <View style={{ gap: ESP.xs }} testID="esport-tk-diag">
      <Intertitre theme={theme}>{trTk('diag.titre')}</Intertitre>
      <LigneDiag theme={theme} ok={d.bot} titre={trTk('diag.bot')} detail={d.bot ? null : trTk('diag.bot_non')} testID="esport-tk-diag-bot" />
      <LigneDiag theme={theme} ok={Boolean(d.serveur)} titre={trTk('diag.serveur')} detail={d.serveur ? d.serveur.nom || d.serveur.id : trTk('diag.serveur_non')} testID="esport-tk-diag-serveur" />
      <LigneDiag theme={theme} ok={d.categorie} titre={trTk('diag.categorie')} detail={d.categorie ? null : trTk('diag.categorie_non')} testID="esport-tk-diag-categorie" />
      <LigneDiag theme={theme} ok={d.actif} titre={trTk('diag.actif')} detail={d.actif ? null : trTk('diag.actif_non')} testID="esport-tk-diag-actif" />
      {!d.gatewayActivee ? <LigneDiag theme={theme} ok={false} titre={trTk('diag.gateway')} detail={trTk('diag.gateway_non')} testID="esport-tk-diag-gateway-coupee" /> : null}
      <LigneDiag
        theme={theme}
        ok={Boolean(d.processus?.frais)}
        titre={trTk('diag.processus')}
        detail={d.processus?.frais ? trTk('diag.processus_oui', { quand: quand(d.processus.le), role: trTk(`diag.role.${d.processus.role ?? 'inactif'}` as CleTk) }) : trTk('diag.processus_non')}
        testID="esport-tk-diag-processus"
      />
      {d.reveilConfigure === false ? <LigneDiag theme={theme} ok={false} titre={trTk('diag.reveil')} detail={trTk('diag.reveil_non')} testID="esport-tk-diag-reveil" /> : null}
      {c.reveil && !c.reveil.ok ? <LigneDiag theme={theme} ok={false} titre={trTk('diag.reveil')} detail={trTk('diag.reveil_echec', { detail: c.reveil.erreur ?? `HTTP ${c.reveil.statut}` })} testID="esport-tk-diag-reveil-echec" /> : null}
      {pret && d.gatewayActivee ? (
        <LigneDiag
          theme={theme}
          ok={c.mode === 'direct'}
          titre={trTk('diag.gateway_etat')}
          detail={[
            c.sansWebSocket ? trTk('diag.sans_websocket') : c.intentRefuse ? trTk('connexion.intent') : c.jetonRefuse ? trTk('connexion.jeton') : null,
            trTk('diag.gateway_etat_detail', { etat: etatGw, quand: quand(c.dernierEssai) }),
            c.derniereErreur ? trTk('diag.derniere_erreur', { motif: c.derniereErreur.motif, quand: quand(c.derniereErreur.le) }) : null,
          ]
            .filter(Boolean)
            .join('\n')}
          testID="esport-tk-diag-gateway"
        />
      ) : null}
      <LigneDiag
        theme={theme}
        ok={Boolean(d.cron?.frais)}
        titre={trTk('diag.cron')}
        detail={d.cron?.frais ? trTk('diag.cron_oui', { quand: quand(d.cron.le) }) : d.cron ? trTk('diag.cron_vieux', { quand: quand(d.cron.le) }) : trTk('diag.cron_non')}
        commande={d.cron?.frais ? undefined : trTk('diag.cron_commande')}
        testID="esport-tk-diag-cron"
      />
    </View>
  );
}

function SectionConnexion({ theme, conf, connexion, serveur, enCours, onVerifier }: { theme: ThemeHub; conf: Config; connexion?: EtatTickets; serveur?: ServeurDiscord; enCours: boolean; onVerifier(): void }) {
  const c = connexion?.connexion;
  const mode = connexion?.actif ? (c?.mode ?? 'hors_ligne') : 'hors_ligne';
  const perms = serveur?.permissions;
  const liste = (cles: string[]) => cles.map(k => trTk(`perm.${k}` as CleTk)).join(', ');
  const salonsVerifies = perms ? ([['general.categorie_ouverts', perms.ouverts], ['general.categorie_archives', perms.archives], ['general.salon_journaux', perms.journaux]] as const) : [];
  const erreurDiscord = texteErreurDiscord(serveur);
  return (
    <Bloc theme={theme} testID="esport-tk-conf-connexion">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <PastilleConnexion theme={theme} connexion={c} actif={connexion?.actif} />
        <BoutonHub theme={theme} titre={trTk('connexion.verifier')} onPress={onVerifier} desactive={enCours} testID="esport-tk-conf-verifier" />
      </View>
      {!conf.bot ? <Text style={texte(theme)}>{trTk('connexion.sans_bot')}</Text> : !connexion?.actif ? <Text style={texte(theme)}>{trTk('connexion.inactif')}</Text> : <Text style={texte(theme)}>{trTk(`connexion.${mode}_aide` as CleTk)}</Text>}
      {c?.intentRefuse ? <Text style={{ ...texte(theme), fontWeight: '700' }} testID="esport-tk-conf-intent">{trTk('connexion.intent')}</Text> : null}
      {c?.jetonRefuse ? <Text style={{ ...texte(theme), fontWeight: '700' }}>{trTk('connexion.jeton')}</Text> : null}
      {c?.depuis ? <Text style={attenue(theme)}>{trTk('connexion.depuis', { quand: quand(c.depuis) })}</Text> : null}
      {c?.releve ? <Text style={attenue(theme)}>{trTk('connexion.releve', { n: c.releve.salons, m: c.releve.messages })}</Text> : null}
      {connexion?.diagnostic ? <Diagnostic theme={theme} d={connexion.diagnostic} /> : null}
      <Intertitre theme={theme}>{trTk('connexion.permissions')}</Intertitre>
      {erreurDiscord ? (
        <Text style={texte(theme)} testID="esport-tk-conf-erreur-discord">
          {erreurDiscord}
        </Text>
      ) : null}
      {perms && !perms.membreTrouve ? <Text style={texte(theme)}>{trTk('connexion.membre_introuvable')}</Text> : null}
      {perms ? (
        <View style={{ gap: ESP.xxs }} testID="esport-tk-conf-permissions">
          <Text style={texte(theme)}>{perms.serveur.length ? trTk('connexion.permissions_manque', { liste: liste(perms.serveur) }) : trTk('connexion.permissions_ok')}</Text>
          {salonsVerifies.map(([cle, v]) =>
            v && (v.introuvable || v.manquantes.length) ? (
              <Text key={cle} style={texte(theme)}>
                {v.introuvable ? trTk('connexion.salon_introuvable', { salon: trTk(cle) }) : trTk('connexion.permissions_salon', { salon: `${trTk(cle)} (${v.nom ?? v.id})`, liste: liste(v.manquantes) })}
              </Text>
            ) : null,
          )}
        </View>
      ) : null}
      {conf.lienInvitation ? <BoutonHub theme={theme} titre={trTk('connexion.inviter')} onPress={() => void Linking.openURL(conf.lienInvitation!)} testID="esport-tk-conf-inviter" /> : null}
    </Bloc>
  );
}

// ------------------------------------------------------------------ Général

/**
 * Réglages généraux. Choisir un serveur lit TOUT DE SUITE ses catégories et salons (sans enregistrer d'abord) : le
 * serveur, les catégories et l'activation s'enregistrent ensemble. Erreur de Discord (bot absent, 403 / 50001…) et
 * retour de l'enregistrement affichés ici, près du bouton.
 */
function SectionGeneral({ theme, api, conf, setConf, serveur, onServeur, onEnregistre }: PropsSection & { serveur?: ServeurDiscord; onServeur(s: ServeurDiscord): void; onEnregistre(): void }) {
  const [g, setG] = useState<General>(conf.general);
  const [lu, setLu] = useState<ServeurDiscord | undefined>(serveur);
  const [lecture, setLecture] = useState<string | null>(null);
  const local = useAgir();
  const enregistre = conf.general;
  useEffect(() => setG(enregistre), [enregistre]);
  useEffect(() => {
    if (serveur) setLu(serveur);
  }, [serveur]);
  const lire = useCallback(
    async (guildId: string | null) => {
      setLecture(guildId ?? '');
      try {
        const d = await api.discord(guildId);
        setLu(d);
        if (!guildId || guildId === enregistre.guildId) onServeur(d);
      } catch (e) {
        setLu(prec => ({ bot: true, serveurs: prec?.serveurs, erreur: 'discord-app', erreurDetail: null, ...(e instanceof Error ? { message: e.message } : {}) }) as ServeurDiscord);
      } finally {
        setLecture(null);
      }
    },
    [api, enregistre.guildId, onServeur],
  );
  // Première ouverture : la lecture du serveur a échoué (ou n'a pas eu lieu) : nouvel essai.
  const premier = React.useRef(true);
  useEffect(() => {
    if (!premier.current) return;
    premier.current = false;
    if (!serveur) void lire(enregistre.guildId);
  }, [serveur, lire, enregistre.guildId]);
  const choisirServeur = (id: string) => {
    const meme = id === enregistre.guildId;
    setG({
      ...g,
      guildId: id,
      guildNom: lu?.serveurs?.find(s => s.id === id)?.nom ?? '',
      // Catégories d'un autre serveur : remises à zéro (celles du serveur enregistré reviennent si on y revient).
      categorieOuverts: meme ? enregistre.categorieOuverts : null,
      categorieArchives: meme ? enregistre.categorieArchives : null,
      salonJournaux: meme ? enregistre.salonJournaux : null,
    });
    void lire(id);
  };
  const duServeur = lu && lu.serveur?.id === g.guildId && !lu.erreur;
  const salons = duServeur ? (lu.salons ?? []) : [];
  const categoriesDiscord = salons.filter(s => s.type === 'categorie').map(s => ({ id: s.id, nom: s.nom }));
  const textes = salons.filter(s => s.type === 'texte').map(s => ({ id: s.id, nom: `#${s.nom}` }));
  const erreurDiscord = lu && (!g.guildId || lu.serveur?.id === g.guildId || lu.erreur === 'discord-app' || lu.erreurDetail?.etape === 'serveurs') ? (lu.erreur === 'discord-app' ? ((lu as ServeurDiscord & { message?: string }).message ?? trTk('erreur.erreur')) : texteErreurDiscord(lu)) : null;
  const manque = g.actif ? (!g.guildId ? trTk('general.manque_serveur') : !g.categorieOuverts ? trTk('general.manque_categorie') : null) : null;
  const nombre = (cle: keyof General, libelle: CleTk) => <Champ theme={theme} libelle={trTk(libelle)} valeur={String(g[cle] ?? '')} onChanger={v => setG({ ...g, [cle]: entier(v) })} clavier="number-pad" maxLength={4} testID={`esport-tk-general-${cle}`} />;
  return (
    <Bloc theme={theme} testID="esport-tk-conf-general">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...texte(theme), fontWeight: '700' }}>{trTk('general.actif')}</Text>
          <Text style={attenue(theme)}>{trTk('general.actif_aide')}</Text>
        </View>
        <Interrupteur theme={theme} libelle={trTk('general.actif')} valeur={g.actif} onChanger={actif => setG({ ...g, actif })} testID="esport-tk-general-actif" />
      </View>
      <Choix theme={theme} libelle={trTk('general.serveur')} valeur={g.guildId ?? undefined} options={(lu?.serveurs ?? serveur?.serveurs ?? []).map(s => ({ id: s.id, nom: s.nom }))} onChoisir={choisirServeur} testID="esport-tk-general-serveur" />
      <Text style={attenue(theme)}>{trTk('general.serveur_aide')}</Text>
      {erreurDiscord ? (
        <Avis theme={theme} genre="critique" texte={erreurDiscord} testID="esport-tk-general-erreur-discord" />
      ) : null}
      {!g.guildId ? <Text style={attenue(theme)}>{trTk('general.aucun_salon')}</Text> : null}
      {g.guildId && lecture !== null ? <Text style={attenue(theme)} testID="esport-tk-general-lecture">{trTk('general.chargement_salons')}</Text> : null}
      {g.guildId && lecture === null && duServeur && !categoriesDiscord.length ? <Text style={texte(theme)} testID="esport-tk-general-serveur-vide">{trTk('general.serveur_vide')}</Text> : null}
      {g.guildId && lecture === null && (erreurDiscord || (duServeur && !categoriesDiscord.length)) ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trTk('general.relire')} onPress={() => void lire(g.guildId)} testID="esport-tk-general-relire" />
        </View>
      ) : null}
      {g.guildId && g.guildId !== enregistre.guildId && duServeur ? <Text style={attenue(theme)} testID="esport-tk-general-non-enregistre">{trTk('general.non_enregistre')}</Text> : null}
      {salons.length ? (
        <>
          <Choix theme={theme} libelle={trTk('general.categorie_ouverts')} valeur={g.categorieOuverts ?? undefined} options={categoriesDiscord} onChoisir={id => setG({ ...g, categorieOuverts: id })} testID="esport-tk-general-ouverts" />
          <Choix theme={theme} libelle={trTk('general.categorie_archives')} valeur={g.categorieArchives ?? ''} options={[{ id: '', nom: trTk('rien') }, ...categoriesDiscord]} onChoisir={id => setG({ ...g, categorieArchives: id || null })} testID="esport-tk-general-archives" />
          <Choix theme={theme} libelle={trTk('general.salon_journaux')} valeur={g.salonJournaux ?? ''} options={[{ id: '', nom: trTk('rien') }, ...textes]} onChoisir={id => setG({ ...g, salonJournaux: id || null })} testID="esport-tk-general-journaux" />
        </>
      ) : null}
      <Choix theme={theme} libelle={trTk('general.langue')} valeur={g.langue} options={conf.choix.langues.map(l => ({ id: l, nom: trTk(`langue.${l}` as CleTk) }))} onChoisir={(langue: ModeLangue) => setG({ ...g, langue })} testID="esport-tk-general-langue" />
      {nombre('fermetureAutoH', 'general.fermeture')}
      {nombre('avertissementH', 'general.avertissement')}
      {nombre('suppressionArchivesJours', 'general.suppression')}
      {nombre('retentionJours', 'general.retention')}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('general.copier')}</Text>
        <Interrupteur theme={theme} libelle={trTk('general.copier')} valeur={g.copierPieces} onChanger={copierPieces => setG({ ...g, copierPieces })} testID="esport-tk-general-copier" />
      </View>
      {nombre('pieceMaxMo', 'general.piece_max')}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]} testID="esport-tk-general-app-seule-bloc">
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...texte(theme), fontWeight: '700' }}>{trTk('general.app_seule')}</Text>
          <Text style={attenue(theme)}>{trTk('general.app_seule_aide')}</Text>
        </View>
        <Interrupteur theme={theme} libelle={trTk('general.app_seule')} valeur={g.reponsesAppSeules !== false} onChanger={reponsesAppSeules => setG({ ...g, reponsesAppSeules })} testID="esport-tk-general-app-seule" />
      </View>
      {g.reponsesAppSeules !== false ? <Avis theme={theme} genre="alerte" texte={trTk('general.app_seule_admin')} testID="esport-tk-general-app-seule-admin" /> : null}
      {manque ? <Avis theme={theme} genre="alerte" texte={manque} testID="esport-tk-general-manque" /> : null}
      <Retours theme={theme} erreur={local.erreur} avis={local.avis} prefixe="esport-tk-general" />
      <BoutonHub
        theme={theme}
        variante="plein"
        titre={trTk('enregistrer')}
        testID="esport-tk-general-enregistrer"
        desactive={local.enCours === 'general'}
        onPress={() =>
          void local.agir('general', async () => {
            const active = g.actif && !enregistre.actif;
            // Les messages automatiques se règlent dans l'onglet Messages : jamais renvoyés d'ici (valeur peut-être ancienne).
            const reglages: Partial<General> = { ...g };
            delete reglages.annonces;
            const { reapplication, ...nouvelle } = await api.changerGeneral(reglages);
            setConf(nouvelle);
            if (duServeur && lu) onServeur(lu);
            else void lire(nouvelle.general.guildId);
            onEnregistre();
            if (active) return trTk('general.active_attente');
            if (reapplication) return trTk(reapplication.echecs ? 'general.reapplication_echecs' : 'general.reapplication', { ok: reapplication.ok, total: reapplication.total, echecs: reapplication.echecs });
            return trTk('enregistre');
          })
        }
      />
    </Bloc>
  );
}

// ------------------------------------------------------------------ Catégories

function SectionCategories(p: PropsSection) {
  const { theme, api, conf, setConf, agir } = p;
  const [edite, setEdite] = useState<Categorie | 'nouvelle' | undefined>();
  const [modeles, setModeles] = useState(false);
  const majCategories = (categories: Categorie[]) => setConf({ ...conf, categories });
  const deplacer = (i: number, d: number) => {
    const ids = conf.categories.map(c => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void agir('ordre', async () => majCategories((await api.ordonnerCategories(ids)).categories));
  };
  return (
    <View style={{ gap: ESP.s }} testID="esport-tk-conf-categories">
      <View style={{ alignSelf: 'flex-start' }}>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} variante="plein" titre={trTk('cat.nouvelle')} onPress={() => setEdite('nouvelle')} testID="esport-tk-cat-nouvelle" />
          {conf.modeles?.length ? <BoutonHub theme={theme} titre={trTk('cat.defaut')} onPress={() => setModeles(true)} testID="esport-tk-cat-defaut" /> : null}
        </View>
      </View>
      {!conf.categories.length ? <Text style={attenue(theme)}>{trTk('cat.vide')}</Text> : null}
      {conf.categories.map((c, i) => (
        <Bloc key={c.id} theme={theme} testID={`esport-tk-cat-${c.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'center', flex: 1, minWidth: 0 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.couleur }} />
              <Glyphe valeur={c.icone} taille={16} couleur={theme.texte} />
              <Text style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                {c.nom.fr} · {c.nom.en}
              </Text>
              {!c.actif ? <Badge theme={theme} texte={trTk('cat.inactive')} /> : null}
            </View>
            <View style={styles.ligne}>
              <BoutonHub theme={theme} titre={trTk('monter')} onPress={() => deplacer(i, -1)} desactive={i === 0} testID={`esport-tk-cat-${c.id}-monter`} />
              <BoutonHub theme={theme} titre={trTk('descendre')} onPress={() => deplacer(i, 1)} desactive={i === conf.categories.length - 1} testID={`esport-tk-cat-${c.id}-descendre`} />
              <BoutonHub theme={theme} titre={trTk('modifier')} onPress={() => setEdite(c)} testID={`esport-tk-cat-${c.id}-modifier`} />
              <BoutonConfirme theme={theme} titre={trTk('supprimer')} confirmation={trTk('confirmer_suppression')} onConfirme={() => void agir('suppr', async () => majCategories((await api.supprimerCategorie(c.id)).categories))} testID={`esport-tk-cat-${c.id}-supprimer`} />
            </View>
          </View>
          {c.description.fr || c.description.en ? <Text style={attenue(theme)}>{c.description.fr || c.description.en}</Text> : null}
          <Text style={attenue(theme)}>
            {trTk(`priorite.${c.prioriteDefaut}` as CleTk)} · {trTk('cat.formulaire', { n: c.formulaire.length })} · {trTk(`liaison.${c.liaison.type}` as CleTk)}
          </Text>
          <Text style={attenue(theme)} testID={`esport-tk-cat-${c.id}-fermeture`}>
            {c.fermetureAutoH === null ? trTk('cat.resume_general') : c.fermetureAutoH === 0 ? trTk('cat.resume_jamais') : trTk('cat.resume_delai', { delai: texteDelai(c.fermetureAutoH) })}
            {c.fermetureStaffSeul ? ` · ${trTk('cat.resume_staff_seul')}` : ''}
          </Text>
          {!c.rolesDiscord.length && !c.rolesApp.length ? <Avis theme={theme} genre="alerte" texte={trTk('cat.a_configurer')} testID={`esport-tk-cat-${c.id}-a-configurer`} /> : null}
        </Bloc>
      ))}
      {edite ? <EditeurCategorie {...p} categorie={edite === 'nouvelle' ? undefined : edite} onFermer={() => setEdite(undefined)} onFait={categories => (majCategories(categories), setEdite(undefined))} /> : null}
      {modeles && conf.modeles ? (
        <DialogueModeles
          theme={theme}
          modeles={conf.modeles}
          categories={conf.categories}
          onFermer={() => setModeles(false)}
          onAjouter={cles =>
            void agir('modeles', async () => {
              const r = await api.ajouterModeles(cles);
              majCategories(r.categories);
              setModeles(false);
              return [trTk('cat.defaut_ajoutees', { n: r.ajoutees.length }), r.ignorees.length ? trTk('cat.defaut_ignorees', { n: r.ignorees.length }) : ''].filter(Boolean).join(' ');
            })
          }
        />
      ) : null}
    </View>
  );
}

/** Nom comparé pour les doublons (casse, accents, espaces), comme le serveur. */
const nomCompare = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * « Catégories par défaut » : les modèles du serveur, à cocher ; ceux dont le nom existe déjà sont grisés (le
 * serveur les ignorerait de toute façon).
 */
export function DialogueModeles({ theme, modeles, categories, onFermer, onAjouter }: { theme: ThemeHub; modeles: ModeleCategorie[]; categories: Categorie[]; onFermer(): void; onAjouter(cles: string[]): void }) {
  const pris = useMemo(() => new Set(categories.flatMap(c => [nomCompare(c.nom.fr), nomCompare(c.nom.en)])), [categories]);
  const existe = (m: ModeleCategorie) => pris.has(nomCompare(m.nom.fr)) || pris.has(nomCompare(m.nom.en));
  const libres = modeles.filter(m => !existe(m)).map(m => m.cle);
  const [coches, setCoches] = useState<string[]>(libres);
  return (
    <Volet theme={theme} visible titre={trTk('cat.defaut_titre')} onFermer={onFermer} largeur={720} testID="esport-tk-modeles">
      <Text style={attenue(theme)}>{trTk('cat.defaut_aide')}</Text>
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={trTk('cat.defaut_tout_coche')} onPress={() => setCoches(libres)} testID="esport-tk-modeles-tout" />
        <BoutonHub theme={theme} titre={trTk('cat.defaut_rien_coche')} onPress={() => setCoches([])} testID="esport-tk-modeles-rien" />
      </View>
      {modeles.map(m => {
        const deja = existe(m);
        const coche = !deja && coches.includes(m.cle);
        return (
          <Pressable
            key={m.cle}
            testID={`esport-tk-modele-${m.cle}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: coche, disabled: deja }}
            accessibilityLabel={`${m.nom.fr} · ${m.nom.en}`}
            disabled={deja}
            onPress={() => setCoches(coche ? coches.filter(x => x !== m.cle) : [...coches, m.cle])}
            style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', padding: ESP.s, borderWidth: 1, borderRadius: 10, borderColor: coche ? m.couleur : theme.ligne, backgroundColor: coche ? teinteTransparente(m.couleur, 0.12) : theme.surface, opacity: deja ? 0.5 : 1 }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: coche ? m.couleur : theme.ligne, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>{coche ? <Glyphe valeur="valide" taille={12} couleur={theme.texte} /> : null}</View>
            <Glyphe valeur={m.icone} taille={18} couleur={theme.texte} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>
                {m.nom.fr} · {m.nom.en}
              </Text>
              <Text style={attenue(theme)}>{m.description.fr}</Text>
              <Text style={attenue(theme)}>
                {trTk('cat.defaut_champs', { n: m.formulaire.length })}
                {m.fermetureAutoH === 0 ? ` · ${trTk('cat.defaut_jamais')}` : ''}
              </Text>
              {deja ? <Badge theme={theme} texte={trTk('cat.defaut_existe')} testID={`esport-tk-modele-${m.cle}-existe`} /> : null}
            </View>
          </Pressable>
        );
      })}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} variante="plein" titre={trTk('cat.defaut_ajouter', { n: coches.filter(c => libres.includes(c)).length })} desactive={!coches.some(c => libres.includes(c))} onPress={() => onAjouter(coches.filter(c => libres.includes(c)))} testID="esport-tk-modeles-ajouter" />
        <BoutonHub theme={theme} titre={trTk('annuler')} onPress={onFermer} testID="esport-tk-modeles-annuler" />
      </View>
    </Volet>
  );
}

const CATEGORIE_VIDE: Omit<Categorie, 'id' | 'position'> = {
  nom: VIDE,
  description: VIDE,
  icone: 'billets',
  couleur: '#5865f2',
  actif: true,
  rolesDiscord: [],
  rolesApp: [],
  formulaire: [],
  accueil: VIDE,
  modeleNom: 'ticket-{numero}-{pseudo}',
  maxOuverts: 1,
  fermetureAutoH: null,
  fermetureStaffSeul: false,
  satisfaction: true,
  prioriteDefaut: 'moyen',
  mentions: [],
  liaison: { type: 'aucune' },
};

function EditeurCategorie({ theme, api, conf, agir, roles, categorie, onFermer, onFait }: PropsSection & { categorie?: Categorie; onFermer(): void; onFait(c: Categorie[]): void }) {
  const [c, setC] = useState<Omit<Categorie, 'id' | 'position'>>(categorie ?? CATEGORIE_VIDE);
  // Fermeture automatique : délai global (null), délai propre en jours, ou jamais (0).
  const [modeFerm, setModeFerm] = useState<ModeFermeture>(modeFermeture(categorie?.fermetureAutoH));
  const [jours, setJours] = useState(categorie?.fermetureAutoH ? joursDeHeures(categorie.fermetureAutoH) : '7');
  const { erreur, agir: agirLocal } = useAgir();
  const champ = (i: number, maj: Partial<ChampFormulaire>) => setC({ ...c, formulaire: c.formulaire.map((x, j) => (j === i ? { ...x, ...maj } : x)) });
  const rolesDiscord = roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur }));
  const enregistrer = () =>
    agirLocal('enregistrer', async () => {
      const fermetureAutoH = heuresPourMode(modeFerm, jours);
      if (fermetureAutoH === undefined) throw new Error(trTk('cat.fermeture_jours_invalide'));
      const corps = { ...c, fermetureAutoH };
      const r = categorie ? await api.modifierCategorie(categorie.id, corps) : await api.creerCategorie(corps);
      onFait(r.categories);
    });
  void agir;
  return (
    <Volet theme={theme} visible titre={categorie ? trTk('cat.modifier') : trTk('cat.nouvelle')} onFermer={onFermer} largeur={720} testID="esport-tk-cat-editeur">
      <Retours theme={theme} erreur={erreur} prefixe="esport-tk-cat-editeur" />
      <DeuxChamps theme={theme} cle={['cat.nom_fr', 'cat.nom_en']} valeur={c.nom} onChanger={nom => setC({ ...c, nom })} max={60} testID="esport-tk-cat-nom" />
      <DeuxChamps theme={theme} cle={['cat.description_fr', 'cat.description_en']} valeur={c.description} onChanger={description => setC({ ...c, description })} max={100} testID="esport-tk-cat-description" />
      <Choix theme={theme} libelle={trTk('cat.icone')} valeur={c.icone} options={conf.choix.icones.map(i => ({ id: i, nom: i }))} onChoisir={icone => setC({ ...c, icone })} testID="esport-tk-cat-icone" />
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trTk('cat.couleur')} valeur={c.couleur} onChanger={couleur => setC({ ...c, couleur })} maxLength={7} testID="esport-tk-cat-couleur" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: /^#[0-9a-fA-F]{6}$/.test(c.couleur) ? c.couleur : theme.ligne, marginBottom: 6 }} />
      </View>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('cat.actif')}</Text>
        <Interrupteur theme={theme} libelle={trTk('cat.actif')} valeur={c.actif} onChanger={actif => setC({ ...c, actif })} testID="esport-tk-cat-actif" />
      </View>
      {rolesDiscord.length ? <ChoixMultiple theme={theme} libelle={trTk('cat.roles_discord')} valeurs={c.rolesDiscord} options={rolesDiscord} onChanger={rolesDiscordChoisis => setC({ ...c, rolesDiscord: rolesDiscordChoisis })} max={20} testID="esport-tk-cat-roles-discord" /> : <Text style={attenue(theme)}>{trTk('cat.roles_charger')}</Text>}
      <ChoixMultiple theme={theme} libelle={trTk('cat.roles_app')} valeurs={c.rolesApp} options={conf.rolesApp.map(r => ({ id: r.cle, nom: r.nom, couleur: r.couleur }))} onChanger={rolesApp => setC({ ...c, rolesApp })} max={20} testID="esport-tk-cat-roles-app" />
      <Intertitre theme={theme}>{trTk('cat.formulaire', { n: c.formulaire.length })}</Intertitre>
      <Text style={attenue(theme)}>{trTk('cat.formulaire_aide')}</Text>
      {c.formulaire.map((f, i) => (
        <View key={i} style={{ gap: ESP.xs, borderLeftWidth: 3, borderLeftColor: theme.ligne, paddingLeft: ESP.s }} testID={`esport-tk-cat-champ-${i}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>{trTk('cat.champ', { n: i + 1 })}</Text>
            <BoutonHub theme={theme} titre={trTk('supprimer')} variante="danger" onPress={() => setC({ ...c, formulaire: c.formulaire.filter((_, j) => j !== i) })} testID={`esport-tk-cat-champ-${i}-supprimer`} />
          </View>
          <DeuxChamps theme={theme} cle={['cat.champ_libelle_fr', 'cat.champ_libelle_en']} valeur={f.libelle} onChanger={libelle => champ(i, { libelle })} max={45} testID={`esport-tk-cat-champ-${i}-libelle`} />
          <DeuxChamps theme={theme} cle={['cat.champ_placeholder_fr', 'cat.champ_placeholder_en']} valeur={f.placeholder} onChanger={placeholder => champ(i, { placeholder })} max={100} testID={`esport-tk-cat-champ-${i}-placeholder`} />
          <View style={styles.ligne}>
            <Text style={texte(theme)}>{trTk('cat.champ_long')}</Text>
            <Interrupteur theme={theme} libelle={trTk('cat.champ_long')} valeur={f.style === 'long'} onChanger={v => champ(i, { style: v ? 'long' : 'court', max: v ? Math.max(f.max, 1000) : Math.min(f.max, 100) })} testID={`esport-tk-cat-champ-${i}-long`} />
            <Text style={texte(theme)}>{trTk('cat.champ_requis')}</Text>
            <Interrupteur theme={theme} libelle={trTk('cat.champ_requis')} valeur={f.requis} onChanger={requis => champ(i, { requis })} testID={`esport-tk-cat-champ-${i}-requis`} />
          </View>
          <Champ theme={theme} libelle={trTk('cat.champ_max')} valeur={String(f.max)} onChanger={v => champ(i, { max: entier(v) })} clavier="number-pad" maxLength={4} testID={`esport-tk-cat-champ-${i}-max`} />
        </View>
      ))}
      {c.formulaire.length < 5 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trTk('cat.champ_ajouter')} onPress={() => setC({ ...c, formulaire: [...c.formulaire, { id: `champ${Date.now() % 100000}`, libelle: VIDE, placeholder: VIDE, style: 'court', requis: true, min: 0, max: 100 }] })} testID="esport-tk-cat-champ-ajouter" />
        </View>
      ) : null}
      <DeuxChamps theme={theme} cle={['cat.accueil_fr', 'cat.accueil_en']} valeur={c.accueil} onChanger={accueil => setC({ ...c, accueil })} multiligne max={1500} testID="esport-tk-cat-accueil" />
      <Text style={attenue(theme)}>{trTk('cat.variables')}</Text>
      <Champ theme={theme} libelle={trTk('cat.modele_nom')} valeur={c.modeleNom} onChanger={modeleNom => setC({ ...c, modeleNom })} maxLength={80} testID="esport-tk-cat-modele" />
      <Champ theme={theme} libelle={trTk('cat.max_ouverts')} valeur={String(c.maxOuverts)} onChanger={v => setC({ ...c, maxOuverts: entier(v) })} clavier="number-pad" maxLength={2} testID="esport-tk-cat-max" />
      <Choix theme={theme} libelle={trTk('cat.fermeture')} valeur={modeFerm} options={(['general', 'delai', 'jamais'] as const).map(m => ({ id: m, nom: trTk(`cat.fermeture_${m}` as CleTk) }))} onChoisir={(m: ModeFermeture) => setModeFerm(m)} testID="esport-tk-cat-fermeture" />
      {modeFerm === 'general' ? <Text style={attenue(theme)}>{trTk('cat.fermeture_general_aide', { delai: conf.general.fermetureAutoH ? texteDelai(conf.general.fermetureAutoH) : trTk('cat.fermeture_jamais') })}</Text> : null}
      {modeFerm === 'delai' ? <Champ theme={theme} libelle={trTk('cat.fermeture_jours')} valeur={jours} onChanger={setJours} maxLength={6} testID="esport-tk-cat-fermeture-jours" /> : null}
      {modeFerm === 'jamais' ? <Text style={attenue(theme)}>{trTk('cat.fermeture_jamais_aide')}</Text> : null}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('cat.staff_seul')}</Text>
        <Interrupteur theme={theme} libelle={trTk('cat.staff_seul')} valeur={c.fermetureStaffSeul} onChanger={fermetureStaffSeul => setC({ ...c, fermetureStaffSeul })} testID="esport-tk-cat-staff-seul" />
      </View>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('cat.satisfaction')}</Text>
        <Interrupteur theme={theme} libelle={trTk('cat.satisfaction')} valeur={c.satisfaction} onChanger={satisfaction => setC({ ...c, satisfaction })} testID="esport-tk-cat-satisfaction" />
      </View>
      <Choix theme={theme} libelle={trTk('cat.priorite')} valeur={c.prioriteDefaut} options={conf.choix.priorites.map(pr => ({ id: pr, nom: trTk(`priorite.${pr}` as CleTk) }))} onChoisir={(prioriteDefaut: Priorite) => setC({ ...c, prioriteDefaut })} testID="esport-tk-cat-priorite" />
      {rolesDiscord.length ? <ChoixMultiple theme={theme} libelle={trTk('cat.mentions')} valeurs={c.mentions} options={rolesDiscord} onChanger={mentions => setC({ ...c, mentions })} max={5} testID="esport-tk-cat-mentions" /> : null}
      <Choix theme={theme} libelle={trTk('cat.liaison')} valeur={c.liaison.type} options={conf.choix.liaisons.map(l => ({ id: l, nom: trTk(`liaison.${l}` as CleTk) }))} onChoisir={(type: TypeLiaison) => setC({ ...c, liaison: { type, ...(type === 'cm' ? { tableauId: c.liaison.tableauId ?? conf.tableauxCm[0]?.id } : {}) } })} testID="esport-tk-cat-liaison" />
      {c.liaison.type === 'cm' ? <Choix theme={theme} libelle={trTk('cat.tableau')} valeur={c.liaison.tableauId} options={conf.tableauxCm} onChoisir={tableauId => setC({ ...c, liaison: { type: 'cm', tableauId } })} testID="esport-tk-cat-tableau" /> : null}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} variante="plein" titre={trTk('enregistrer')} onPress={() => void enregistrer()} testID="esport-tk-cat-enregistrer" />
        <BoutonHub theme={theme} titre={trTk('annuler')} onPress={onFermer} testID="esport-tk-cat-annuler" />
      </View>
    </Volet>
  );
}

// ------------------------------------------------------------------ Panneaux

function SectionPanneaux(p: PropsSection) {
  const { theme, api, conf, setConf, agir } = p;
  const [edite, setEdite] = useState<Panneau | 'nouveau' | undefined>();
  const [modeles, setModeles] = useState(false);
  const majPanneau = (pan: Panneau) => setConf({ ...conf, panneaux: conf.panneaux.some(x => x.id === pan.id) ? conf.panneaux.map(x => (x.id === pan.id ? pan : x)) : [...conf.panneaux, pan] });
  return (
    <View style={{ gap: ESP.s }} testID="esport-tk-conf-panneaux">
      <View style={{ alignSelf: 'flex-start' }}>
        <View style={styles.ligne}>
          <BoutonHub theme={theme} variante="plein" titre={trTk('pan.nouveau')} onPress={() => setEdite('nouveau')} testID="esport-tk-pan-nouveau" />
          {conf.modelesPanneaux?.length ? <BoutonHub theme={theme} titre={trTk('pan.defaut')} onPress={() => setModeles(true)} testID="esport-tk-pan-defaut" /> : null}
        </View>
      </View>
      {modeles && conf.modelesPanneaux ? (
        <DialoguePanneauxModeles
          theme={theme}
          modeles={conf.modelesPanneaux}
          modelesCategories={conf.modeles ?? []}
          categories={conf.categories}
          onFermer={() => setModeles(false)}
          onCreer={corps =>
            void agir('modele-panneau', async () => {
              const r = await api.creerPanneauModele(corps);
              setConf({ ...conf, categories: r.categories, panneaux: [...conf.panneaux, r.panneau] });
              setModeles(false);
              setEdite(r.panneau);
              return [trTk('pan.defaut_cree'), r.ajoutees.length ? trTk('pan.defaut_ajoutees', { n: r.ajoutees.length }) : '', r.ignorees.length ? trTk('pan.defaut_ignorees', { n: r.ignorees.length }) : '', r.renomme ? trTk('pan.defaut_renomme') : ''].filter(Boolean).join(' ');
            })
          }
        />
      ) : null}
      {!conf.panneaux.length ? <Text style={attenue(theme)}>{trTk('pan.vide')}</Text> : null}
      {conf.panneaux.map(pan => (
        <Bloc key={pan.id} theme={theme} testID={`esport-tk-pan-${pan.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), fontWeight: '700', flex: 1, minWidth: 0 }} numberOfLines={1}>
              {pan.titre.fr || pan.titre.en}
            </Text>
            <BoutonHub theme={theme} titre={trTk('modifier')} onPress={() => setEdite(pan)} testID={`esport-tk-pan-${pan.id}-modifier`} />
          </View>
          <Text style={attenue(theme)}>{pan.publieLe ? trTk('pan.publie', { quand: quand(pan.publieLe) }) : trTk('pan.jamais')}</Text>
          {pan.erreur ? <Badge theme={theme} ton="critique" texte={trTk(`pan.erreur.${pan.erreur}` as CleTk)} /> : null}
        </Bloc>
      ))}
      {edite ? (
        <EditeurPanneau
          {...p}
          panneau={edite === 'nouveau' ? undefined : edite}
          onFermer={() => setEdite(undefined)}
          onMaj={pan => {
            majPanneau(pan);
            setEdite(pan);
          }}
          onSupprime={id => (setConf({ ...conf, panneaux: conf.panneaux.filter(x => x.id !== id) }), setEdite(undefined))}
        />
      ) : null}
    </View>
  );
}

/**
 * « Panneaux par défaut » : un modèle à choisir ; ses catégories absentes (comparées par nom, comme le serveur) sont
 * listées, avec la case « Ajouter aussi les catégories par défaut manquantes ». Modèle d'événement : nom de
 * l'événement et catégorie à relier. Le panneau créé n'est pas publié.
 */
export function DialoguePanneauxModeles({
  theme,
  modeles,
  modelesCategories,
  categories,
  onFermer,
  onCreer,
}: {
  theme: ThemeHub;
  modeles: ModelePanneau[];
  modelesCategories: ModeleCategorie[];
  categories: Categorie[];
  onFermer(): void;
  onCreer(corps: { modele: string; evenement?: string; categorieId?: string | null; ajouterManquantes: boolean }): void;
}) {
  const [cle, setCle] = useState(modeles[0]?.cle ?? '');
  const [evenement, setEvenement] = useState('');
  const [categorieId, setCategorieId] = useState('modele');
  const [ajouter, setAjouter] = useState(true);
  const pris = useMemo(() => new Set(categories.flatMap(c => [nomCompare(c.nom.fr), nomCompare(c.nom.en)])), [categories]);
  const m = modeles.find(x => x.cle === cle);
  const parCle = (k: string) => modelesCategories.find(x => x.cle === k);
  const choisie = Boolean(m?.evenement) && categorieId !== 'modele';
  const refs = !m || choisie ? [] : m.categories === 'toutes' ? modelesCategories.filter(x => !x.evenement).map(x => x.cle) : m.categories;
  const manquantes = refs.map(parCle).filter((x): x is ModeleCategorie => Boolean(x) && !pris.has(nomCompare(x!.nom.fr)) && !pris.has(nomCompare(x!.nom.en)));
  const premier = m && m.categories !== 'toutes' ? parCle(m.categories[0]) : undefined;
  const pret = Boolean(m) && (!m?.evenement || evenement.trim().length > 0);
  return (
    <Volet theme={theme} visible titre={trTk('pan.defaut_titre')} onFermer={onFermer} largeur={720} testID="esport-tk-pmodeles">
      <Text style={attenue(theme)}>{trTk('pan.defaut_aide')}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: ESP.xs }}>
        {modeles.map(x => {
          const actif = x.cle === cle;
          return (
            <Pressable
              key={x.cle}
              testID={`esport-tk-pmodele-${x.cle}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              accessibilityLabel={`${x.nom.fr} · ${x.nom.en}`}
              onPress={() => setCle(x.cle)}
              style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', padding: ESP.s, borderWidth: 1, borderRadius: 10, borderColor: actif ? x.couleur : theme.ligne, backgroundColor: actif ? teinteTransparente(x.couleur, 0.12) : theme.surface }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: actif ? x.couleur : theme.ligne, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>{actif ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.couleur }} /> : null}</View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ ...texte(theme), fontWeight: '700' }}>{x.nom.fr}</Text>
                <Text style={attenue(theme)}>{x.description.fr}</Text>
                <Text style={attenue(theme)}>{x.categories === 'toutes' ? trTk('pan.defaut_toutes') : x.categories.map(k => parCle(k)?.nom.fr ?? k).join(' · ')}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {m?.evenement ? (
        <>
          <Champ theme={theme} libelle={trTk('pan.defaut_evenement')} valeur={evenement} onChanger={setEvenement} maxLength={100} testID="esport-tk-pmodele-nom-evenement" />
          <Choix
            theme={theme}
            libelle={trTk('pan.defaut_categorie')}
            valeur={categorieId}
            options={[{ id: 'modele', nom: trTk('pan.defaut_categorie_modele', { nom: premier?.nom.fr ?? '' }) }, ...categories.map(c => ({ id: c.id, nom: c.nom.fr || c.nom.en, couleur: c.couleur }))]}
            onChoisir={setCategorieId}
            testID="esport-tk-pmodele-categorie"
          />
        </>
      ) : null}
      {manquantes.length ? (
        <View style={{ gap: ESP.xs }} testID="esport-tk-pmodele-manquantes">
          <Text style={texte(theme)}>{trTk('pan.defaut_manquantes', { noms: manquantes.map(x => x.nom.fr).join(', ') })}</Text>
          <Interrupteur theme={theme} libelle={trTk('pan.defaut_ajouter_manquantes')} valeur={ajouter} onChanger={setAjouter} testID="esport-tk-pmodele-ajouter" />
          {!ajouter ? <Avis theme={theme} genre="alerte" texte={trTk('pan.defaut_sans_manquantes')} testID="esport-tk-pmodele-sans" /> : null}
        </View>
      ) : null}
      <View style={styles.ligne}>
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={trTk('pan.defaut_creer')}
          desactive={!pret}
          onPress={() => onCreer({ modele: cle, ...(m?.evenement ? { evenement: evenement.trim(), categorieId: choisie ? categorieId : null } : {}), ajouterManquantes: manquantes.length > 0 && ajouter })}
          testID="esport-tk-pmodele-creer"
        />
        <BoutonHub theme={theme} titre={trTk('annuler')} onPress={onFermer} testID="esport-tk-pmodele-annuler" />
      </View>
    </Volet>
  );
}

function EditeurPanneau({ theme, api, conf, salons, client, panneau, onFermer, onMaj, onSupprime }: PropsSection & { panneau?: Panneau; onFermer(): void; onMaj(p: Panneau): void; onSupprime(id: string): void }) {
  const [s, setS] = useState({ titre: panneau?.titre ?? VIDE, texte: panneau?.texte ?? VIDE, couleur: panneau?.couleur ?? '#5865f2', style: panneau?.style ?? ('boutons' as const), categories: panneau?.categories ?? conf.categories.filter(c => c.actif).map(c => c.id), salonId: panneau?.salonId ?? null, imageElementId: panneau?.imageElementId ?? null, libelles: panneau?.libelles ?? ({} as Record<string, DeuxLangues>) });
  const [apercu, setApercu] = useState<ChargeDiscord | undefined>();
  const [drive, setDrive] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const textes = salons.filter(x => x.type === 'texte').map(x => ({ id: x.id, nom: `#${x.nom}` }));
  const enregistrer = async () => {
    const r = panneau ? await api.modifierPanneau(panneau.id, s) : await api.creerPanneau(s);
    onMaj(r);
    setApercu((await api.apercuPanneau(r.id)).charge);
    return r;
  };
  return (
    <Volet theme={theme} visible titre={panneau ? (panneau.titre.fr || panneau.titre.en) : trTk('pan.nouveau')} onFermer={onFermer} largeur={760} testID="esport-tk-pan-editeur">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-tk-pan-editeur" />
      <DeuxChamps theme={theme} cle={['pan.titre_fr', 'pan.titre_en']} valeur={s.titre} onChanger={titre => setS({ ...s, titre })} max={256} testID="esport-tk-pan-titre" />
      <DeuxChamps theme={theme} cle={['pan.texte_fr', 'pan.texte_en']} valeur={s.texte} onChanger={texteP => setS({ ...s, texte: texteP })} multiligne max={1800} testID="esport-tk-pan-texte" />
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trTk('cat.couleur')} valeur={s.couleur} onChanger={couleur => setS({ ...s, couleur })} maxLength={7} testID="esport-tk-pan-couleur" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: /^#[0-9a-fA-F]{6}$/.test(s.couleur) ? s.couleur : theme.ligne, marginBottom: 6 }} />
      </View>
      <Choix theme={theme} libelle={trTk('pan.style')} valeur={s.style} options={[{ id: 'boutons', nom: trTk('pan.boutons') }, { id: 'menu', nom: trTk('pan.menu') }]} onChoisir={(style: 'boutons' | 'menu') => setS({ ...s, style })} testID="esport-tk-pan-style" />
      <ChoixMultiple theme={theme} libelle={trTk('pan.categories')} valeurs={s.categories} options={conf.categories.map(c => ({ id: c.id, nom: c.nom.fr || c.nom.en, couleur: c.couleur }))} onChanger={categories => setS({ ...s, categories })} max={25} testID="esport-tk-pan-categories" />
      {s.style === 'boutons'
        ? s.categories.map(id => {
            const c = conf.categories.find(x => x.id === id);
            if (!c) return null;
            const nom = c.nom.fr || c.nom.en;
            return <DeuxChamps key={id} theme={theme} cle={['pan.libelle_fr', 'pan.libelle_en']} vars={{ nom }} valeur={s.libelles[id] ?? VIDE} onChanger={v => setS({ ...s, libelles: { ...s.libelles, [id]: v } })} max={80} testID={`esport-tk-pan-libelle-${id}`} />;
          })
        : null}
      {textes.length ? <Choix theme={theme} libelle={trTk('pan.salon')} valeur={s.salonId ?? undefined} options={textes} onChoisir={salonId => setS({ ...s, salonId })} testID="esport-tk-pan-salon" /> : <Text style={attenue(theme)}>{trTk('general.aucun_salon')}</Text>}
      <Avis theme={theme} genre="info" texte={trTk('pan.lecture_seule')} testID="esport-tk-pan-lecture-seule" />
      <View style={styles.ligne}>
        <Text style={texte(theme)}>{s.imageElementId ? trTk('pan.image_choisie') : trTk('pan.image')}</Text>
        <BoutonHub theme={theme} titre={trTk('pan.image_choisir')} onPress={() => setDrive(true)} testID="esport-tk-pan-image" />
        {s.imageElementId ? <BoutonHub theme={theme} titre={trTk('pan.image_retirer')} onPress={() => setS({ ...s, imageElementId: null })} testID="esport-tk-pan-image-retirer" /> : null}
      </View>
      <ChoixDrive theme={theme} client={client} visible={drive} accepter={f => /^image\/(png|jpeg|gif|webp)$/.test(f.type) && f.taille <= 8 * 1024 * 1024} onChoisir={f => (setS({ ...s, imageElementId: f.id }), setDrive(false))} onFermer={() => setDrive(false)} testID="esport-tk-pan-drive" />
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={trTk('pan.apercu')} onPress={() => void agir('apercu', async () => void (await enregistrer()))} testID="esport-tk-pan-apercu" />
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={panneau?.messageId ? trTk('pan.mettre_a_jour') : trTk('pan.publier')}
          onPress={() =>
            void agir('publier', async () => {
              const r = await enregistrer();
              onMaj(await api.publierPanneau(r.id));
              return trTk('pan.publie_ok');
            })
          }
          testID="esport-tk-pan-publier"
        />
        {panneau ? <BoutonConfirme theme={theme} titre={trTk('supprimer')} confirmation={trTk('confirmer_suppression')} onConfirme={() => void agir('suppr', async () => (await api.supprimerPanneau(panneau.id), onSupprime(panneau.id)))} testID="esport-tk-pan-supprimer" /> : null}
      </View>
      {apercu ? <ApercuDiscord charge={apercu} imageUrl={s.imageElementId} /> : null}
    </Volet>
  );
}

// ------------------------------------------------------------------ Messages

const CLES_MESSAGES = ['accueil', 'prise_en_charge', 'liberation', 'attente', 'fermeture', 'reouverture', 'avertissement', 'demande_note', 'merci_note', 'mp_recap', 'hors_horaires'] as const;

/**
 * Messages automatiques dans le salon : un interrupteur par événement (le défaut est indiqué) ; un événement coupé
 * reste noté dans la conversation de l'app et dans le salon des journaux.
 */
function MessagesAutomatiques({ theme, api, conf, setConf, agir }: PropsSection) {
  const defaut = conf.annoncesDefaut ?? {};
  const [a, setA] = useState<Partial<Record<CleAnnonce, boolean>>>(() => Object.fromEntries(CLES_ANNONCES.map(k => [k, conf.general.annonces?.[k] ?? defaut[k] !== false])));
  return (
    <View style={{ gap: ESP.xs, paddingBottom: ESP.s, borderBottomWidth: 1, borderBottomColor: theme.ligne }} testID="esport-tk-msg-annonces">
      <Intertitre theme={theme}>{trTk('msg.annonces_titre')}</Intertitre>
      <Text style={attenue(theme)}>{trTk('msg.annonces_aide')}</Text>
      {CLES_ANNONCES.map(k => (
        <View key={k} style={[styles.ligne, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }]} testID={`esport-tk-annonce-${k}`}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={texte(theme)}>{trTk(`annonce.${k}` as CleTk)}</Text>
            <Text style={attenue(theme, 12)}>{trTk(defaut[k] === false ? 'annonce.defaut_non' : 'annonce.defaut_oui')}</Text>
          </View>
          <Interrupteur theme={theme} libelle={trTk(`annonce.${k}` as CleTk)} valeur={a[k] !== false} onChanger={v => setA({ ...a, [k]: v })} testID={`esport-tk-annonce-${k}-actif`} />
        </View>
      ))}
      <BoutonHub theme={theme} variante="plein" titre={trTk('msg.annonces_enregistrer')} onPress={() => void agir('annonces', async () => (setConf(await api.changerGeneral({ annonces: a })), trTk('enregistre')))} testID="esport-tk-annonces-enregistrer" />
    </View>
  );
}

function SectionMessages(props: PropsSection) {
  const { theme, api, conf, setConf, agir } = props;
  const [m, setM] = useState<Record<string, DeuxLangues>>(() => Object.fromEntries(CLES_MESSAGES.map(k => [k, { ...VIDE, ...(conf.messages[k] ?? {}) }])));
  return (
    <Bloc theme={theme} testID="esport-tk-conf-messages">
      <MessagesAutomatiques {...props} />
      <Text style={attenue(theme)}>{trTk('msg.aide')}</Text>
      {CLES_MESSAGES.map(k => (
        <View key={k} style={{ gap: ESP.xs }}>
          <Intertitre theme={theme}>{trTk(`msg.${k}` as CleTk)}</Intertitre>
          <View style={[styles.ligne, { alignItems: 'flex-start' }]}>
            <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0 }}>
              <Champ theme={theme} libelle={trTk('francais')} valeur={m[k].fr} placeholder={conf.messagesDefaut[k]?.fr} onChanger={fr => setM({ ...m, [k]: { ...m[k], fr } })} multiligne maxLength={1500} testID={`esport-tk-msg-${k}-fr`} />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0 }}>
              <Champ theme={theme} libelle={trTk('anglais')} valeur={m[k].en} placeholder={conf.messagesDefaut[k]?.en} onChanger={en => setM({ ...m, [k]: { ...m[k], en } })} multiligne maxLength={1500} testID={`esport-tk-msg-${k}-en`} />
            </View>
          </View>
        </View>
      ))}
      <BoutonHub theme={theme} variante="plein" titre={trTk('enregistrer')} onPress={() => void agir('messages', async () => (setConf(await api.changerMessages(m)), trTk('enregistre')))} testID="esport-tk-msg-enregistrer" />
    </Bloc>
  );
}

// ------------------------------------------------------------------ Liste noire

function SectionListeNoire({ theme, api, conf, setConf, agir }: PropsSection) {
  const [s, setS] = useState({ discordId: '', nom: '', raison: '' });
  const relire = async () => setConf(await api.config());
  return (
    <Bloc theme={theme} testID="esport-tk-conf-liste">
      <Text style={attenue(theme)}>{trTk('ln.aide')}</Text>
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trTk('ln.discord_id')} valeur={s.discordId} onChanger={discordId => setS({ ...s, discordId: discordId.replace(/\D/g, '') })} maxLength={20} clavier="number-pad" testID="esport-tk-ln-id" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
        <Champ theme={theme} libelle={trTk('ln.nom')} valeur={s.nom} onChanger={nom => setS({ ...s, nom })} maxLength={100} testID="esport-tk-ln-nom" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
        <Champ theme={theme} libelle={trTk('ln.raison')} valeur={s.raison} onChanger={raison => setS({ ...s, raison })} maxLength={300} testID="esport-tk-ln-raison" style={{ flexGrow: 2, flexBasis: 200, minWidth: 0 }} />
        <BoutonHub theme={theme} variante="plein" titre={trTk('ajouter')} onPress={() => void agir('ln', async () => (await api.ajouterListeNoire(s), setS({ discordId: '', nom: '', raison: '' }), await relire()))} testID="esport-tk-ln-ajouter" />
      </View>
      {!conf.listeNoire.length ? <Text style={attenue(theme)}>{trTk('ln.vide')}</Text> : null}
      {conf.listeNoire.map(l => (
        <View key={l.discordId} style={[styles.ligne, { justifyContent: 'space-between' }]} testID={`esport-tk-ln-${l.discordId}`}>
          <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }} numberOfLines={2}>
            {l.nom || l.discordId} · {l.discordId}
            {l.raison ? ` · ${l.raison}` : ''}
          </Text>
          <BoutonHub theme={theme} titre={trTk('ln.retirer')} onPress={() => void agir('ln', async () => (await api.retirerListeNoire(l.discordId), await relire()))} testID={`esport-tk-ln-${l.discordId}-retirer`} />
        </View>
      ))}
    </Bloc>
  );
}

// ------------------------------------------------------------------ Horaires

function SectionHoraires({ theme, api, conf, setConf, agir }: PropsSection) {
  const [h, setH] = useState<Horaires>(conf.horaires);
  const plage = (i: number, maj: Partial<Horaires['plages'][number]>) => setH({ ...h, plages: h.plages.map((p, j) => (j === i ? { ...p, ...maj } : p)) });
  return (
    <Bloc theme={theme} testID="esport-tk-conf-horaires">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('h.actif')}</Text>
        <Interrupteur theme={theme} libelle={trTk('h.actif')} valeur={h.actif} onChanger={actif => setH({ ...h, actif })} testID="esport-tk-h-actif" />
      </View>
      <Champ theme={theme} libelle={trTk('h.fuseau')} valeur={h.fuseau} onChanger={fuseau => setH({ ...h, fuseau })} maxLength={60} testID="esport-tk-h-fuseau" />
      {h.plages.map((p, i) => (
        <View key={i} style={[styles.ligne, { alignItems: 'flex-end' }]} testID={`esport-tk-h-plage-${i}`}>
          <Choix theme={theme} libelle={trTk('cat.champ', { n: i + 1 })} valeur={String(p.jour)} options={[1, 2, 3, 4, 5, 6, 7].map(j => ({ id: String(j), nom: trTk(`jour.${j}` as CleTk) }))} onChoisir={j => plage(i, { jour: Number(j) })} testID={`esport-tk-h-plage-${i}-jour`} />
          <Champ theme={theme} libelle={trTk('h.debut')} valeur={p.debut} onChanger={debut => plage(i, { debut })} maxLength={5} testID={`esport-tk-h-plage-${i}-debut`} style={{ flexBasis: 110, flexGrow: 1, minWidth: 0 }} />
          <Champ theme={theme} libelle={trTk('h.fin')} valeur={p.fin} onChanger={fin => plage(i, { fin })} maxLength={5} testID={`esport-tk-h-plage-${i}-fin`} style={{ flexBasis: 110, flexGrow: 1, minWidth: 0 }} />
          <BoutonHub theme={theme} titre={trTk('supprimer')} variante="danger" onPress={() => setH({ ...h, plages: h.plages.filter((_, j) => j !== i) })} testID={`esport-tk-h-plage-${i}-supprimer`} />
        </View>
      ))}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={trTk('h.plage_ajouter')} onPress={() => setH({ ...h, plages: [...h.plages, { jour: 1, debut: '09:00', fin: '18:00' }] })} testID="esport-tk-h-ajouter" />
        <BoutonHub theme={theme} variante="plein" titre={trTk('enregistrer')} onPress={() => void agir('horaires', async () => (setConf(await api.changerHoraires(h)), trTk('enregistre')))} testID="esport-tk-h-enregistrer" />
      </View>
    </Bloc>
  );
}

// ------------------------------------------------------------------ Commandes

function SectionCommandes({ theme, api, conf, setConf, agir, roles }: PropsSection) {
  const [c, setC] = useState(conf.commandes);
  const rolesDiscord = roles.map(r => ({ id: r.id, nom: r.nom, couleur: r.couleur }));
  return (
    <Bloc theme={theme} testID="esport-tk-conf-commandes">
      <Text style={attenue(theme)}>{trTk('cmd.aide')}</Text>
      {conf.choix.commandes.map(nom => (
        <View key={nom} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-tk-cmd-${nom}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk(`cmd.${nom}` as CleTk)}</Text>
            {conf.choix.commandesStaff.includes(nom) ? <Badge theme={theme} texte={trTk('cmd.staff')} /> : null}
            <Interrupteur theme={theme} libelle={trTk(`cmd.${nom}` as CleTk)} valeur={c[nom]?.actif !== false} onChanger={actif => setC({ ...c, [nom]: { roles: c[nom]?.roles ?? [], actif } })} testID={`esport-tk-cmd-${nom}-actif`} />
          </View>
          {rolesDiscord.length && c[nom]?.actif !== false ? <ChoixMultiple theme={theme} libelle={trTk('cmd.roles')} valeurs={c[nom]?.roles ?? []} options={rolesDiscord} onChanger={r => setC({ ...c, [nom]: { actif: true, roles: r } })} max={20} testID={`esport-tk-cmd-${nom}-roles`} /> : null}
        </View>
      ))}
      <BoutonHub theme={theme} variante="plein" titre={trTk('enregistrer')} onPress={() => void agir('commandes', async () => (setConf(await api.changerCommandes(c)), trTk('enregistre')))} testID="esport-tk-cmd-enregistrer" />
    </Bloc>
  );
}

// ------------------------------------------------------------------ Bienvenue par rôle

function SectionBienvenue({ theme, api, conf, setConf, agir, roles, salons }: PropsSection) {
  const [b, setB] = useState(conf.bienvenue);
  const etat = conf.bienvenueEtat ?? {};
  const textes = salons.filter(x => x.type === 'texte').map(x => ({ id: x.id, nom: `# ${x.nom}` }));
  const optionsRoles = roles.map(x => ({ id: x.id, nom: x.nom }));
  const enregistrer = () =>
    void agir('bienvenue', async () => {
      const roleNom = roles.find(x => x.id === b.roleId)?.nom ?? b.roleNom;
      const r = await api.changerBienvenue({ actif: b.actif, roleId: b.roleId, roleNom, salonId: b.salonId, message: b.message, supprimerApresS: b.supprimerApresS ?? 0 });
      setConf(r);
      setB(r.bienvenue);
      if (r.titulaires) return r.titulaires.ok ? trTk('bv.titulaires_ok', { n: r.titulaires.notes ?? 0 }) : trTk('bv.titulaires_echec');
      return trTk('enregistre');
    });
  const tester = () =>
    void agir('bienvenue-test', async () => {
      const r = await api.testerBienvenue();
      if (!r.ok) throw new Error(trTk('bv.test_echec', { erreur: r.erreur ?? '?' }));
      return trTk('bv.test_ok');
    });
  return (
    <Bloc theme={theme} testID="esport-tk-conf-bienvenue">
      <Text style={attenue(theme)}>{trTk('bv.aide')}</Text>
      {!conf.general.guildId ? <Avis theme={theme} genre="alerte" texte={trTk('bv.sans_serveur')} testID="esport-tk-bv-sans-serveur" /> : null}
      {etat.membresRefuses ? <Avis theme={theme} genre="critique" texte={trTk('bv.membres_refuses')} testID="esport-tk-bv-refus" /> : <Text style={attenue(theme)}>{trTk('bv.intent')}</Text>}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('bv.actif')}</Text>
        <Interrupteur theme={theme} libelle={trTk('bv.actif')} valeur={b.actif} onChanger={actif => setB({ ...b, actif })} testID="esport-tk-bv-actif" />
      </View>
      <Choix theme={theme} libelle={trTk('bv.role')} valeur={b.roleId ?? undefined} options={optionsRoles} onChoisir={id => setB({ ...b, roleId: id, roleNom: roles.find(x => x.id === id)?.nom ?? '' })} testID="esport-tk-bv-role" />
      <Choix theme={theme} libelle={trTk('bv.salon')} valeur={b.salonId ?? undefined} options={textes} onChoisir={id => setB({ ...b, salonId: id })} testID="esport-tk-bv-salon" />
      <Champ theme={theme} libelle={trTk('bv.message')} valeur={b.message} onChanger={message => setB({ ...b, message })} multiligne maxLength={1800} testID="esport-tk-bv-message" />
      <Text style={attenue(theme)}>{trTk('bv.variables')}</Text>
      <Champ theme={theme} libelle={trTk('bv.suppression')} valeur={String(b.supprimerApresS ?? 0)} onChanger={v => setB({ ...b, supprimerApresS: entier(v) })} maxLength={4} testID="esport-tk-bv-suppression" />
      <Text style={attenue(theme)}>{trTk('bv.suppression_aide')}</Text>
      {etat.dernier ? (
        <Text style={attenue(theme)} testID="esport-tk-bv-dernier">
          {etat.dernier.ok ? trTk('bv.dernier_ok', { le: quand(etat.dernier.le) }) : trTk('bv.dernier_echec', { le: quand(etat.dernier.le), statut: etat.dernier.statut ?? 0 })}
        </Text>
      ) : null}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} variante="plein" titre={trTk('enregistrer')} onPress={enregistrer} testID="esport-tk-bv-enregistrer" />
        <BoutonHub theme={theme} titre={trTk('bv.tester')} onPress={tester} testID="esport-tk-bv-tester" />
      </View>
    </Bloc>
  );
}

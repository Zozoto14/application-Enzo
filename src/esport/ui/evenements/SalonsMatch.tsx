/**
 * Administration › Événements › fiche › « Salons de match » (evenements.gerer ; docs/esport/evenements.md, serveur :
 * esport/noyau/evenements-club/salons-match.mjs). Réglages (activé, catégorie Discord, modèle du nom, délai de
 * suppression, rappels, langue, création anticipée, rétention des historiques), liste des salons (match, lien,
 * statut, suppression programmée), matchs du site sans salon, et actions manuelles : « Créer maintenant »,
 * « Supprimer maintenant », « Voir l'historique » (historique enregistré avant la suppression du salon).
 * Fiabilité (migration 0079) : « Dernière synchro : il y a 4 s (poussée par le site) », messages du bot par salon
 * (envoyés, en attente, en échec avec la raison), « Renvoyer les messages en échec » ; état relu toutes les 20 s.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { formaterDate } from '../../i18n';
import { trEv, type CleEv } from '../../i18n/evenements';
import type { EnvoisSalonMatch, EtatSalonsMatch, FicheEvenement, MessageHistorique, ReglagesSalonsMatch, SalonMatch, VueSalonsMatch, apiEvenements, EquipeSalonMatch, LangueSalons } from '../../evenements/api';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte, type Ton } from '../design';
import { CibleSurlignee } from '../notifications/Cible';
import { SelecteurRepliable, optionsSalons } from '../../../ui/selecteurs/SelecteurRepliable';

type Api = ReturnType<typeof apiEvenements>;
type Saisie = Omit<ReglagesSalonsMatch, 'delaiSuppressionMin' | 'avanceH' | 'retentionJours'> & { delaiSuppressionMin: string; avanceH: string; retentionJours: string };

const AUCUN = '-';
const chiffres = (v: string) => v.replace(/\D/g, '');
const versSaisie = (r: ReglagesSalonsMatch): Saisie => ({ ...r, delaiSuppressionMin: String(r.delaiSuppressionMin), avanceH: String(r.avanceH), retentionJours: String(r.retentionJours) });
const date = (v: string | null) => (v ? formaterDate(v, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const TON: Record<SalonMatch['statut'], Ton> = { creation: 'neutre', ouvert: 'ok', termine: 'accent', annule: 'alerte', supprime: 'neutre' };
const libelleErreur = (c: string) => {
  const cle = `sm.erreur.${c}`;
  const t = trEv(cle as CleEv);
  return t === cle ? c : t;
};
const sommeIgnores = (e: EtatSalonsMatch) => (e.ignores ? e.ignores.termine + e.ignores.equipes + e.ignores.delai + e.ignores.ferme : 0) + (e.echecs ?? 0) + e.attente;
/** Avis de « Synchroniser maintenant » : ce que le passage a vu, pas seulement « synchronisé ». */
const resumeSynchro = (e: EtatSalonsMatch | null) => {
  if (!e?.lus) return e?.arret ? trEv(`sm.arret.${e.arret}` as CleEv) : trEv('sm.synchro_ok');
  return trEv('sm.synchro_bilan', { lus: String(e.lus.matchs + e.lus.lobbies), crees: String(e.crees), suivis: String(e.suivis ?? 0), ignores: String(sommeIgnores(e)) });
};
const detail = (d: NonNullable<EtatSalonsMatch['details']>[number], avance: number) => {
  if (d.raison === 'equipes') return trEv('sm.detail.equipes', { n: String(d.n ?? 0) });
  if (d.raison === 'delai') return trEv('sm.detail.delai', { avance: String(avance), le: date(d.prevu ?? null) });
  if (d.raison === 'ferme') return trEv('sm.detail.ferme', { statut: trEv(`sm.statut.${d.statut ?? 'supprime'}` as CleEv) });
  if (d.raison === 'echec') return trEv('sm.detail.echec', { code: d.code ? ` (${d.code})` : '' });
  return trEv(`sm.detail.${d.raison}` as CleEv);
};

/** Diagnostic du dernier passage : lu sur le site, ignorés avec leur raison (match par match). */
function DiagnosticPassage({ theme, etat: e, avance = 0 }: { theme: ThemeHub; etat: EtatSalonsMatch; avance?: number }) {
  if (e.arret) return <Text style={attenue(theme, 13)} testID="esport-ev-sm-arret">{trEv(`sm.arret.${e.arret}` as CleEv)}</Text>;
  if (!e.lus) return null;
  const ig = e.ignores ?? { termine: 0, equipes: 0, delai: 0, ferme: 0 };
  const liste = [
    ig.termine ? trEv('sm.ignore.termine', { n: String(ig.termine) }) : '',
    ig.equipes ? trEv('sm.ignore.equipes', { n: String(ig.equipes) }) : '',
    ig.delai ? trEv('sm.ignore.delai', { n: String(ig.delai) }) : '',
    ig.ferme ? trEv('sm.ignore.ferme', { n: String(ig.ferme) }) : '',
    e.echecs ? trEv('sm.ignore.echecs', { n: String(e.echecs) }) : '',
  ].filter(Boolean);
  return (
    <View style={{ gap: ESP.xxs }} testID="esport-ev-sm-diagnostic">
      <Text style={attenue(theme, 13)} testID="esport-ev-sm-lus">{trEv('sm.lus', { matchs: String(e.lus.matchs), lobbies: String(e.lus.lobbies), suivis: String(e.suivis ?? 0) })}</Text>
      {liste.length ? <Text style={attenue(theme, 13)} testID="esport-ev-sm-ignores">{trEv('sm.ignores', { liste: liste.join(', ') })}</Text> : null}
      {(e.details ?? []).map(d => (
        <Text key={`${d.cle}-${d.raison}`} style={attenue(theme, 13)} testID={`esport-ev-sm-detail-${d.cle}`}>
          {`${d.titre} : ${detail(d, avance)}`}
        </Text>
      ))}
    </View>
  );
}

/** Relecture de l'état léger (dernière synchro, envois) et rafraîchissement de « il y a X s ». */
const RELECTURE_ETAT_MS = 20_000;
const TIC_MS = 5_000;
const ilYA = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 120) return trEv('sm.il_y_a_s', { n: String(s) });
  if (s < 7200) return trEv('sm.il_y_a_min', { n: String(Math.round(s / 60)) });
  return trEv('sm.il_y_a_h', { n: String(Math.round(s / 3600)) });
};
const libelleCle = (prefixe: string, c: string) => {
  const cle = `${prefixe}.${c}`;
  const t = trEv(cle as CleEv);
  return t === cle ? c : t;
};
/** « messages : 3 envoyé(s), 1 en échec » et la raison de chaque échec ou réessai. */
const resumeEnvois = (e: EnvoisSalonMatch) =>
  [
    trEv('sm.envois_salon', { envoyes: String(e.envoyes), attente: e.attente ? trEv('sm.envois_attente', { n: String(e.attente) }) : '', echecs: e.echecs ? trEv('sm.envois_echecs', { n: String(e.echecs) }) : '' }),
    ...(e.raisons ?? []).map(r => trEv('sm.envoi_raison', { genre: libelleCle('sm.genre', r.genre), raison: r.raison ? libelleCle('sm.raison', r.raison) : '?' })),
  ].join(' · ');

const nomsStaff = (staff: Array<{ nom: string; present: boolean }>) => staff.map(x => `${x.nom}${x.present ? '' : ` (${trEv('sm.staff_absent')})`}`).join(', ');
const nomsEquipes = (equipes: EquipeSalonMatch[]) => equipes.map(e => `${e.tag ? `[${e.tag}] ` : ''}${e.nom}${e.role ? '' : ` (${trEv('sm.sans_role')})`}`).join(' - ');

export function SalonsMatch({ theme, api, fiche }: { theme: ThemeHub; api: Api; fiche: FicheEvenement }) {
  const id = fiche.evenement.id;
  const [v, setV] = useState<VueSalonsMatch | undefined>();
  const [f, setF] = useState<Saisie | undefined>();
  const [historique, setHistorique] = useState<{ salon: SalonMatch; messages: MessageHistorique[] } | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  // Écart entre l'horloge du serveur et celle de l'appareil (« il y a X s » juste même si l'appareil est mal réglé).
  const [ecart, setEcart] = useState(0);
  const [, setTic] = useState(0);
  const recevoir = useCallback((x: VueSalonsMatch) => {
    setV(x);
    setF(versSaisie(x.reglages));
  }, []);
  useEffect(() => {
    void agir('charger', async () => recevoir(await api.salonsMatch(id)));
  }, [agir, api, id, recevoir]);
  // État léger toutes les 20 s (dernier passage, envois par salon) : ni Discord ni le site ne sont appelés.
  useEffect(() => {
    if (typeof api.etatSalonsMatch !== 'function') return undefined;
    const relire = setInterval(() => {
      api
        .etatSalonsMatch(id)
        .then(x => {
          setEcart(x.heure - Date.now());
          setV(avant => (avant ? { ...avant, etat: x.etat, envois: x.envois, salons: avant.salons.map(sa => ({ ...sa, envois: x.salons.find(y => y.id === sa.id)?.envois ?? sa.envois })) } : avant));
        })
        .catch(() => undefined);
    }, RELECTURE_ETAT_MS);
    const tic = setInterval(() => setTic(n => n + 1), TIC_MS);
    return () => {
      clearInterval(relire);
      clearInterval(tic);
    };
  }, [api, id]);
  if (!v || !f) return erreur ? <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-sm" /> : null;
  const lim = v.choix.limites;
  const enregistrer = () =>
    void agir('enregistrer', async () => {
      const n = (s: string) => Number.parseInt(s || '0', 10);
      recevoir(await api.reglerSalonsMatch(id, { actif: f.actif, categorieId: f.categorieId, ancreId: f.ancreId, modeleNom: f.modeleNom, delaiSuppressionMin: n(f.delaiSuppressionMin), rappels: f.rappels, langue: f.langue, avanceH: n(f.avanceH), retentionJours: n(f.retentionJours) }));
      return trEv('sm.enregistre');
    });
  const e = v.etat;
  return (
    <CibleSurlignee theme={theme} cle={`salons-match:${id}`}>
    <Carte theme={theme} dense testID="esport-ev-salons-match">
      <TitreCarte theme={theme} titre={trEv('sm.titre')} />
      <Text style={attenue(theme, 13)}>{trEv('sm.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-sm" />
      {!v.lie ? <Avis theme={theme} genre="info" texte={trEv('sm.non_lie')} testID="esport-ev-sm-non-lie" /> : null}
      {!v.bot ? <Avis theme={theme} genre="alerte" texte={trEv('sm.sans_bot')} testID="esport-ev-sm-sans-bot" /> : null}
      {v.erreurDiscord && v.bot ? <Avis theme={theme} genre="alerte" texte={trEv('sm.erreur_discord', { erreur: v.erreurDiscord })} testID="esport-ev-sm-erreur-discord" /> : null}
      {v.erreurSite ? <Avis theme={theme} genre="alerte" texte={trEv('sm.erreur_site', { erreur: v.erreurSite })} testID="esport-ev-sm-erreur-site" /> : null}

      {/* Réglages */}
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trEv('sm.actif')}</Text>
        <Interrupteur theme={theme} libelle={trEv('sm.actif')} valeur={f.actif} onChanger={actif => setF({ ...f, actif })} testID="esport-ev-sm-actif" />
      </View>
      {/* « Placer sous le salon » (facultatif) : la catégorie suit alors celle du salon choisi (lecture seule). */}
      {v.salonsTexte.length ? (
        <SelecteurRepliable theme={theme} nature="salon" libelle={trEv('sm.ancre')} valeur={f.ancreId ?? AUCUN} options={[{ id: AUCUN, nom: trEv('sm.ancre_aucun') }, ...optionsSalons(v.salonsTexte, ['texte'])]} onChoisir={x => setF({ ...f, ancreId: x === AUCUN ? null : x })} testID="esport-ev-sm-ancre" />
      ) : null}
      {f.ancreId ? (
        <Text style={attenue(theme)} testID="esport-ev-sm-categorie-ancre">
          {(() => {
            const a = v.salonsTexte.find(x => x.id === f.ancreId);
            const cat = a?.parent ? v.salonsTexte.find(x => x.id === a.parent)?.nom : null;
            return a ? trEv('sm.categorie_ancre', { categorie: cat ?? trEv('sm.sans_categorie_parent') }) : trEv('sm.ancre_introuvable');
          })()}
        </Text>
      ) : v.categories.length ? (
        <SelecteurRepliable theme={theme} nature="categorie" libelle={trEv('sm.categorie')} valeur={f.categorieId ?? undefined} options={v.categories} onChoisir={categorieId => setF({ ...f, categorieId })} testID="esport-ev-sm-categorie" />
      ) : (
        <Text style={attenue(theme)} testID="esport-ev-sm-sans-categorie">{trEv('sm.sans_categorie')}</Text>
      )}
      {f.ancreId ? <Text style={attenue(theme)}>{trEv('sm.ancre_aide')}</Text> : null}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trEv('sm.modele')} valeur={f.modeleNom} onChanger={modeleNom => setF({ ...f, modeleNom })} maxLength={lim.modele} testID="esport-ev-sm-modele" style={{ flexGrow: 2, flexBasis: 220, minWidth: 0 }} />
        <Champ theme={theme} libelle={trEv('sm.delai', { min: String(lim.delaiMin), max: String(lim.delaiMax) })} valeur={f.delaiSuppressionMin} onChanger={x => setF({ ...f, delaiSuppressionMin: chiffres(x) })} maxLength={4} clavier="number-pad" testID="esport-ev-sm-delai" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
      </View>
      <Text style={attenue(theme)}>{trEv('sm.modele_aide')}</Text>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trEv('sm.rappels')}</Text>
        <Interrupteur theme={theme} libelle={trEv('sm.rappels')} valeur={f.rappels} onChanger={rappels => setF({ ...f, rappels })} testID="esport-ev-sm-rappels" />
      </View>
      <Choix<LangueSalons> theme={theme} libelle={trEv('sm.langue')} valeur={f.langue} options={v.choix.langues.map(l => ({ id: l, nom: trEv(`sm.langue.${l}` as CleEv) }))} onChoisir={langue => setF({ ...f, langue })} testID="esport-ev-sm-langue" />
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trEv('sm.avance')} valeur={f.avanceH} onChanger={x => setF({ ...f, avanceH: chiffres(x) })} maxLength={3} clavier="number-pad" testID="esport-ev-sm-avance" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
        <Champ theme={theme} libelle={trEv('sm.retention')} valeur={f.retentionJours} onChanger={x => setF({ ...f, retentionJours: chiffres(x) })} maxLength={4} clavier="number-pad" testID="esport-ev-sm-retention" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
      </View>
      <Text style={attenue(theme)}>{trEv('sm.avance_aide')}</Text>
      <View style={styles.ligne}>
        <BoutonHub theme={theme} variante="plein" titre={trEv('sm.enregistrer')} onPress={enregistrer} desactive={enCours === 'enregistrer'} testID="esport-ev-sm-enregistrer" />
        {v.lie ? <BoutonHub theme={theme} titre={trEv('sm.synchro')} onPress={() => void agir('synchro', async () => {
                    const x = await api.synchroniserSalonsMatch(id);
                    recevoir(x);
                    return resumeSynchro(x.etat);
                  })} desactive={enCours === 'synchro'} testID="esport-ev-sm-synchro" /> : null}
      </View>
      {e ? (
        <Text style={attenue(theme, 13)} testID="esport-ev-sm-dernier">
          {trEv('sm.dernier', { le: date(e.le), crees: String(e.crees), majs: String(e.majs), resultats: String(e.resultats), supprimes: String(e.supprimes) })}
          {e.attente ? ` ${trEv('sm.attente', { n: String(e.attente) })}` : ''}
        </Text>
      ) : null}
      {e?.origine ? (
        <Text style={attenue(theme, 13)} testID="esport-ev-sm-synchro-derniere">
          {trEv('sm.synchro_derniere', { il_y_a: ilYA(Date.now() + ecart - Date.parse(e.le)), origine: trEv(`sm.origine.${e.origine}` as CleEv) })}
        </Text>
      ) : null}
      {e ? <DiagnosticPassage theme={theme} etat={e} avance={v.reglages.avanceH} /> : null}
      {(e?.avertissements ?? []).filter(x => x === 'embed-manquant' || x === 'mentions-joueurs').map(x => (
        <Avis key={x} theme={theme} genre={x === 'embed-manquant' ? 'alerte' : 'info'} texte={trEv(`sm.avert.${x}` as CleEv)} testID={`esport-ev-sm-avert-${x}`} />
      ))}
      {v.envois && v.envois.envoyes + v.envois.attente + v.envois.echecs > 0 ? (
        <Text style={attenue(theme, 13)} testID="esport-ev-sm-envois">{trEv('sm.envois', { envoyes: String(v.envois.envoyes), attente: String(v.envois.attente), echecs: String(v.envois.echecs) })}</Text>
      ) : null}
      {v.envois?.echecs ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trEv('sm.renvoyer')} onPress={() => void agir('renvoyer', async () => {
                  const x = await api.renvoyerSalonsMatch(id);
                  recevoir(x);
                  return trEv('sm.renvoyes', { n: String(x.renvoyes) });
                })} desactive={enCours === 'renvoyer'} testID="esport-ev-sm-renvoyer" />
        </View>
      ) : null}
      {e?.erreur ? <Avis theme={theme} genre="alerte" texte={trEv('sm.erreur', { erreur: libelleErreur(e.erreur) })} testID="esport-ev-sm-erreur-etat" /> : null}

      {/* Salons */}
      <Text style={{ ...texte(theme), fontWeight: '700', marginTop: ESP.xs }}>{trEv('sm.liste')}</Text>
      {!v.salons.length ? <Text style={attenue(theme)} testID="esport-ev-sm-vide">{trEv('sm.vide')}</Text> : null}
      {v.salons.map(s => (
        <CibleSurlignee key={s.id} theme={theme} cle={`salon-match:${s.cle}`}>
        <View style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-ev-sm-salon-${s.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), fontWeight: '600', flex: 1, minWidth: 0 }}>{s.titre || s.cle}</Text>
            <Badge theme={theme} ton={TON[s.statut]} texte={trEv(`sm.statut.${s.statut}` as CleEv)} testID={`esport-ev-sm-salon-${s.id}-statut`} />
          </View>
          {s.equipes.length ? <Text style={attenue(theme)}>{nomsEquipes(s.equipes)}</Text> : null}
          {s.staff?.length ? <Text style={attenue(theme)} testID={`esport-ev-sm-salon-${s.id}-staff`}>{trEv('sm.staff', { liste: nomsStaff(s.staff) })}</Text> : null}
          {s.envois && s.envois.envoyes + s.envois.attente + s.envois.echecs > 0 ? (
            <Text style={attenue(theme)} testID={`esport-ev-sm-salon-${s.id}-envois`}>{resumeEnvois(s.envois)}</Text>
          ) : null}
          <Text style={attenue(theme)} testID={`esport-ev-sm-salon-${s.id}-dates`}>
            {[s.prevuLe ? trEv('sm.prevu', { le: date(s.prevuLe) }) : '', s.suppressionLe ? trEv('sm.suppression_le', { le: date(s.suppressionLe) }) : '', s.supprimeLe ? trEv('sm.supprime_le', { le: date(s.supprimeLe) }) : '', s.erreur ? trEv('sm.erreur_salon', { erreur: s.erreur }) : ''].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.ligne}>
            {s.lien ? <BoutonHub theme={theme} titre={trEv('sm.ouvrir')} onPress={() => void Linking.openURL(s.lien!)} testID={`esport-ev-sm-salon-${s.id}-ouvrir`} /> : null}
            {s.historique ? <BoutonHub theme={theme} titre={trEv('sm.historique')} onPress={() => void agir('historique', async () => setHistorique(await api.historiqueSalonMatch(id, s.id)))} testID={`esport-ev-sm-salon-${s.id}-historique`} /> : null}
            {s.statut !== 'supprime' ? <BoutonConfirme theme={theme} titre={trEv('sm.supprimer')} confirmation={trEv('sm.supprimer_confirmer')} onConfirme={() => void agir('supprimer', async () => {
                    recevoir(await api.supprimerSalonMatch(id, s.id));
                    return trEv('sm.supprime');
                  })} testID={`esport-ev-sm-salon-${s.id}-supprimer`} /> : null}
          </View>
          {historique?.salon.id === s.id ? <Historique theme={theme} messages={historique.messages} onFermer={() => setHistorique(undefined)} /> : null}
        </View>
        </CibleSurlignee>
      ))}

      {/* Matchs du site sans salon */}
      {v.matchs.length ? <Text style={{ ...texte(theme), fontWeight: '700', marginTop: ESP.xs }}>{trEv('sm.matchs_site')}</Text> : null}
      {v.matchs.map(m => (
        <CibleSurlignee key={m.cle} theme={theme} cle={`salon-match:${m.cle}`}>
        <View style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-ev-sm-match-${m.cle}`}>
          <Text style={{ ...texte(theme), fontWeight: '600' }}>{m.titre}</Text>
          <Text style={attenue(theme)}>{[m.equipes.length ? nomsEquipes(m.equipes) : trEv('sm.equipes_inconnues'), m.prevuLe ? trEv('sm.prevu', { le: date(m.prevuLe) }) : '', m.staff?.length ? trEv('sm.staff', { liste: nomsStaff(m.staff) }) : ''].filter(Boolean).join(' · ')}</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={trEv('sm.creer')} desactive={!m.equipes.length || enCours === 'creer'} onPress={() => void agir('creer', async () => {
                    recevoir(await api.creerSalonMatch(id, m.cle));
                    return trEv('sm.cree');
                  })} testID={`esport-ev-sm-match-${m.cle}-creer`} />
          </View>
        </View>
        </CibleSurlignee>
      ))}
    </Carte>
    </CibleSurlignee>
  );
}

/** Historique d'un salon supprimé : messages, auteurs, pièces jointes en liens (lecture seule). */
function Historique({ theme, messages, onFermer }: { theme: ThemeHub; messages: MessageHistorique[]; onFermer(): void }) {
  return (
    <View style={{ gap: ESP.xs, padding: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: 8 }} testID="esport-ev-sm-historique">
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), fontWeight: '700' }}>{trEv('sm.historique_titre', { n: String(messages.length) })}</Text>
        <BoutonHub theme={theme} titre={trEv('sm.fermer')} onPress={onFermer} testID="esport-ev-sm-historique-fermer" />
      </View>
      {!messages.length ? <Text style={attenue(theme)}>{trEv('sm.historique_vide')}</Text> : null}
      {messages.map(m => (
        <View key={m.id} style={{ gap: 2 }} testID={`esport-ev-sm-msg-${m.id}`}>
          <Text style={attenue(theme)}>
            <Text style={{ fontWeight: '700', color: theme.texte }}>{m.auteur}</Text>
            {m.bot ? ` · ${trEv('sm.bot')}` : ''}
            {m.le ? ` · ${date(m.le)}` : ''}
          </Text>
          {m.contenu ? <Text style={texte(theme, 14)}>{m.contenu}</Text> : null}
          {m.embeds.map((x, i) => (
            <Text key={i} style={attenue(theme)}>
              {x}
            </Text>
          ))}
          {m.pieces.map(p => (
            <Text key={p.url} style={{ ...attenue(theme), textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(p.url)} accessibilityRole="link" testID={`esport-ev-sm-piece-${m.id}`}>
              {trEv('sm.piece', { nom: p.nom })}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

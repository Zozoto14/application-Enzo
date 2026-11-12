/**
 * Administration › Événements › fiche › « Salons de match » (evenements.gerer ; docs/esport/evenements.md, serveur :
 * esport/noyau/evenements-club/salons-match.mjs). Réglages (activé, catégorie Discord, modèle du nom, délai de
 * suppression, rappels, langue, création anticipée, rétention des historiques), liste des salons (match, lien,
 * statut, suppression programmée), matchs du site sans salon, et actions manuelles : « Créer maintenant »,
 * « Supprimer maintenant », « Voir l'historique » (historique enregistré avant la suppression du salon).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { formaterDate } from '../../i18n';
import { trEv, type CleEv } from '../../i18n/evenements';
import type { FicheEvenement, MessageHistorique, ReglagesSalonsMatch, SalonMatch, VueSalonsMatch, apiEvenements, EquipeSalonMatch, LangueSalons } from '../../evenements/api';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte, type Ton } from '../design';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';

type Api = ReturnType<typeof apiEvenements>;
type Saisie = Omit<ReglagesSalonsMatch, 'delaiSuppressionMin' | 'avanceH' | 'retentionJours'> & { delaiSuppressionMin: string; avanceH: string; retentionJours: string };

const chiffres = (v: string) => v.replace(/\D/g, '');
const versSaisie = (r: ReglagesSalonsMatch): Saisie => ({ ...r, delaiSuppressionMin: String(r.delaiSuppressionMin), avanceH: String(r.avanceH), retentionJours: String(r.retentionJours) });
const date = (v: string | null) => (v ? formaterDate(v, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const TON: Record<SalonMatch['statut'], Ton> = { creation: 'neutre', ouvert: 'ok', termine: 'accent', annule: 'alerte', supprime: 'neutre' };
const libelleErreur = (c: string) => {
  const cle = `sm.erreur.${c}`;
  const t = trEv(cle as CleEv);
  return t === cle ? c : t;
};
const nomsEquipes = (equipes: EquipeSalonMatch[]) => equipes.map(e => `${e.tag ? `[${e.tag}] ` : ''}${e.nom}${e.role ? '' : ` (${trEv('sm.sans_role')})`}`).join(' - ');

export function SalonsMatch({ theme, api, fiche }: { theme: ThemeHub; api: Api; fiche: FicheEvenement }) {
  const id = fiche.evenement.id;
  const [v, setV] = useState<VueSalonsMatch | undefined>();
  const [f, setF] = useState<Saisie | undefined>();
  const [historique, setHistorique] = useState<{ salon: SalonMatch; messages: MessageHistorique[] } | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const recevoir = useCallback((x: VueSalonsMatch) => {
    setV(x);
    setF(versSaisie(x.reglages));
  }, []);
  useEffect(() => {
    void agir('charger', async () => recevoir(await api.salonsMatch(id)));
  }, [agir, api, id, recevoir]);
  if (!v || !f) return erreur ? <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-ev-sm" /> : null;
  const lim = v.choix.limites;
  const enregistrer = () =>
    void agir('enregistrer', async () => {
      const n = (s: string) => Number.parseInt(s || '0', 10);
      recevoir(await api.reglerSalonsMatch(id, { actif: f.actif, categorieId: f.categorieId, modeleNom: f.modeleNom, delaiSuppressionMin: n(f.delaiSuppressionMin), rappels: f.rappels, langue: f.langue, avanceH: n(f.avanceH), retentionJours: n(f.retentionJours) }));
      return trEv('sm.enregistre');
    });
  const e = v.etat;
  return (
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
      {v.categories.length ? (
        <SelecteurRepliable theme={theme} nature="categorie" libelle={trEv('sm.categorie')} valeur={f.categorieId ?? undefined} options={v.categories} onChoisir={categorieId => setF({ ...f, categorieId })} testID="esport-ev-sm-categorie" />
      ) : (
        <Text style={attenue(theme)} testID="esport-ev-sm-sans-categorie">{trEv('sm.sans_categorie')}</Text>
      )}
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
                    recevoir(await api.synchroniserSalonsMatch(id));
                    return trEv('sm.synchro_ok');
                  })} desactive={enCours === 'synchro'} testID="esport-ev-sm-synchro" /> : null}
      </View>
      {e ? (
        <Text style={attenue(theme, 13)} testID="esport-ev-sm-dernier">
          {trEv('sm.dernier', { le: date(e.le), crees: String(e.crees), majs: String(e.majs), resultats: String(e.resultats), supprimes: String(e.supprimes) })}
          {e.attente ? ` ${trEv('sm.attente', { n: String(e.attente) })}` : ''}
        </Text>
      ) : null}
      {e?.erreur ? <Avis theme={theme} genre="alerte" texte={trEv('sm.erreur', { erreur: libelleErreur(e.erreur) })} testID="esport-ev-sm-erreur-etat" /> : null}

      {/* Salons */}
      <Text style={{ ...texte(theme), fontWeight: '700', marginTop: ESP.xs }}>{trEv('sm.liste')}</Text>
      {!v.salons.length ? <Text style={attenue(theme)} testID="esport-ev-sm-vide">{trEv('sm.vide')}</Text> : null}
      {v.salons.map(s => (
        <View key={s.id} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-ev-sm-salon-${s.id}`}>
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), fontWeight: '600', flex: 1, minWidth: 0 }}>{s.titre || s.cle}</Text>
            <Badge theme={theme} ton={TON[s.statut]} texte={trEv(`sm.statut.${s.statut}` as CleEv)} testID={`esport-ev-sm-salon-${s.id}-statut`} />
          </View>
          {s.equipes.length ? <Text style={attenue(theme)}>{nomsEquipes(s.equipes)}</Text> : null}
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
      ))}

      {/* Matchs du site sans salon */}
      {v.matchs.length ? <Text style={{ ...texte(theme), fontWeight: '700', marginTop: ESP.xs }}>{trEv('sm.matchs_site')}</Text> : null}
      {v.matchs.map(m => (
        <View key={m.cle} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-ev-sm-match-${m.cle}`}>
          <Text style={{ ...texte(theme), fontWeight: '600' }}>{m.titre}</Text>
          <Text style={attenue(theme)}>{[m.equipes.length ? nomsEquipes(m.equipes) : trEv('sm.equipes_inconnues'), m.prevuLe ? trEv('sm.prevu', { le: date(m.prevuLe) }) : ''].filter(Boolean).join(' · ')}</Text>
          <View style={{ alignSelf: 'flex-start' }}>
            <BoutonHub theme={theme} titre={trEv('sm.creer')} desactive={!m.equipes.length || enCours === 'creer'} onPress={() => void agir('creer', async () => {
                    recevoir(await api.creerSalonMatch(id, m.cle));
                    return trEv('sm.cree');
                  })} testID={`esport-ev-sm-match-${m.cle}-creer`} />
          </View>
        </View>
      ))}
    </Carte>
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

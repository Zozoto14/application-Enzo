/**
 * Fiche d'un tournoi › « Équipes et rôles Discord » (tournois.gerer ; Discord : vocaux.configurer en plus) :
 * équipes participantes (nom, TAG, membres avec Discord ID, Embark ID, poste), import depuis les tickets d'inscription
 * (propositions à cocher, problèmes signalés, à corriger ensuite), réglages des rôles (modèle, couleur, suppression
 * automatique), « Créer les rôles Discord » (bilan : absents, sans ID, refus, rôle du bot trop bas) et « Supprimer les
 * rôles ». Le serveur valide tout (docs/esport/vocaux.md, « Tournois : rôles des équipes »).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { formaterDate, langueCourante } from '../../i18n';
import { trVc, type CleVc } from '../../i18n/vocaux';
import { POSTES, apiEquipes, type BilanRoles, type DiscordTournoi, type EquipeTournoi, type MembreEquipe, type PropositionEquipe, type SaisieEquipe } from '../../vocaux/api';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte } from '../design';

const quand = (iso: string | null | undefined) => (iso ? formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const AUCUNE = '-';
/** Réponse attendue (un ancien serveur sans cette route répond autre chose, ou 404 : la carte reste cachée). */
const lisible = (x: unknown): x is DiscordTournoi => {
  const v = x as Partial<DiscordTournoi> | null;
  return Boolean(v && Array.isArray(v.equipes) && v.reglages && v.droits && Array.isArray(v.categoriesTickets) && Array.isArray(v.hubs));
};
const membreVide = (): MembreEquipe => ({ poste: 'joueur', discordId: null, nom: '', embarkId: '' });
const propre = (m: MembreEquipe): MembreEquipe => ({ poste: m.poste, discordId: m.discordId ? m.discordId.replace(/\D/g, '') || null : null, nom: m.nom, embarkId: m.embarkId });

/** Éditeur d'une équipe : nom, TAG, membres (poste, Discord ID, nom, Embark ID). */
function EditeurEquipe({ theme, initiale, max, onEnregistrer, onAnnuler, prefixe }: { theme: ThemeHub; initiale: SaisieEquipe; max: number; onEnregistrer(e: SaisieEquipe): void; onAnnuler(): void; prefixe: string }) {
  const [e, setE] = useState<SaisieEquipe>(initiale);
  const membre = (i: number, maj: Partial<MembreEquipe>) => setE({ ...e, membres: e.membres.map((m, j) => (j === i ? { ...m, ...maj } : m)) });
  return (
    <View style={{ gap: ESP.xs }} testID={prefixe}>
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trVc('eq.nom')} valeur={e.nom} onChanger={nom => setE({ ...e, nom })} maxLength={80} testID={`${prefixe}-nom`} style={{ flexGrow: 2, flexBasis: 200, minWidth: 0 }} />
        <Champ theme={theme} libelle={trVc('eq.tag')} valeur={e.tag} onChanger={tag => setE({ ...e, tag: tag.toUpperCase() })} maxLength={6} testID={`${prefixe}-tag`} style={{ flexGrow: 1, flexBasis: 90, minWidth: 0 }} />
      </View>
      {e.membres.map((m, i) => (
        <View key={i} style={{ gap: ESP.xxs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xxs }} testID={`${prefixe}-membre-${i}`}>
          <Choix theme={theme} libelle={trVc('eq.membre', { n: i + 1 })} valeur={m.poste} options={POSTES.map(p => ({ id: p, nom: trVc(`eq.poste.${p}` as CleVc) }))} onChoisir={poste => membre(i, { poste })} testID={`${prefixe}-membre-${i}-poste`} />
          <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trVc('eq.discord_id')} valeur={m.discordId ?? ''} onChanger={v => membre(i, { discordId: v.replace(/\D/g, '') || null })} maxLength={20} clavier="number-pad" testID={`${prefixe}-membre-${i}-discord`} style={{ flexGrow: 2, flexBasis: 180, minWidth: 0 }} />
            <Champ theme={theme} libelle={trVc('eq.membre_nom')} valeur={m.nom} onChanger={nom => membre(i, { nom })} maxLength={100} testID={`${prefixe}-membre-${i}-nom`} style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
            <Champ theme={theme} libelle={trVc('eq.embark')} valeur={m.embarkId} onChanger={embarkId => membre(i, { embarkId })} maxLength={60} testID={`${prefixe}-membre-${i}-embark`} style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
            <BoutonHub theme={theme} titre={trVc('eq.membre_retirer')} variante="danger" onPress={() => setE({ ...e, membres: e.membres.filter((_, j) => j !== i) })} testID={`${prefixe}-membre-${i}-retirer`} />
          </View>
        </View>
      ))}
      <View style={styles.ligne}>
        {e.membres.length < max ? <BoutonHub theme={theme} titre={trVc('eq.membre_ajouter')} onPress={() => setE({ ...e, membres: [...e.membres, membreVide()] })} testID={`${prefixe}-membre-ajouter`} /> : null}
        <BoutonHub theme={theme} variante="plein" titre={trVc('eq.enregistrer')} onPress={() => onEnregistrer({ ...e, membres: e.membres.map(propre) })} testID={`${prefixe}-enregistrer`} />
        <BoutonHub theme={theme} titre={trVc('eq.annuler')} onPress={onAnnuler} testID={`${prefixe}-annuler`} />
      </View>
    </View>
  );
}

/** Une proposition d'import (ticket) : case à cocher, équipe, membres et problèmes. */
function Proposition({ theme, p, coche, onCocher }: { theme: ThemeHub; p: PropositionEquipe; coche: boolean; onCocher(): void }) {
  return (
    <Pressable onPress={onCocher} accessibilityRole="checkbox" accessibilityState={{ checked: coche }} accessibilityLabel={`${p.tag} ${p.nom}`} style={{ gap: 2, borderWidth: 1, borderColor: coche ? theme.accent : theme.ligne, borderRadius: 10, padding: ESP.xs }} testID={`esport-eq-prop-${p.numero}`}>
      <View style={styles.ligne}>
        <Text style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }}>
          {coche ? '✓ ' : ''}
          {[p.tag, p.nom].filter(Boolean).join(' ') || '—'}
        </Text>
        <Text style={attenue(theme)}>{trVc('eq.ticket', { numero: String(p.numero), statut: p.statut })}</Text>
        {p.deja ? <Badge theme={theme} texte={trVc('eq.deja')} /> : null}
      </View>
      {p.membres.map((m, i) => (
        <Text key={i} style={attenue(theme)}>
          {trVc(`eq.poste.${m.poste}` as CleVc)} · {m.nom || m.discordId || m.brut || '—'}
          {m.discordId ? ` · ${m.discordId}` : ` · ${trVc('eq.membre_sans_id')}`}
          {m.embarkId ? ` · ${m.embarkId}` : ''}
          {m.present === false ? ` · ${trVc('eq.membre_absent')}` : ''}
          {m.trouveParNom ? ` · ${trVc('eq.membre_trouve')}` : ''}
        </Text>
      ))}
      {p.problemes.map(x => (
        <Text key={x} style={{ ...attenue(theme), color: theme.alerte }} testID={`esport-eq-prop-${p.numero}-${x}`}>
          {trVc(`eq.probleme.${x}` as CleVc)}
        </Text>
      ))}
    </Pressable>
  );
}

function Bilan({ theme, b }: { theme: ThemeHub; b: BilanRoles }) {
  return (
    <View style={{ gap: ESP.xxs }} testID="esport-eq-bilan">
      <Avis theme={theme} genre={b.refus.length || b.absents.length ? 'alerte' : 'ok'} texte={trVc('eq.bilan', { creees: String(b.creees), attribues: String(b.attribues) })} />
      {b.absents.length ? <Text style={attenue(theme)} testID="esport-eq-bilan-absents">{trVc('eq.bilan_absents', { liste: b.absents.map(a => `${a.nom || a.discordId} (${a.equipe})`).join(', ') })}</Text> : null}
      {b.sansId.length ? <Text style={attenue(theme)} testID="esport-eq-bilan-sans-id">{trVc('eq.bilan_sans_id', { liste: b.sansId.map(a => `${a.nom || '?'} (${a.equipe})`).join(', ') })}</Text> : null}
      {b.refus.length ? <Text style={attenue(theme)} testID="esport-eq-bilan-refus">{trVc('eq.bilan_refus', { liste: b.refus.map(a => `${a.equipe} (${a.code ?? a.statut})`).join(', ') })}</Text> : null}
      {b.refus.some(a => a.code === 50013) || b.hierarchie?.ok === false ? <Avis theme={theme} genre="critique" texte={trVc('eq.hierarchie')} testID="esport-eq-hierarchie" /> : null}
      {b.limite ? <Avis theme={theme} genre="alerte" texte={trVc('eq.bilan_limite')} /> : null}
    </View>
  );
}

export function EquipesDiscord({ theme, client, teamId, tournoiId }: { theme: ThemeHub; client: ClientEsport; teamId: string; tournoiId: string }) {
  const api = useMemo(() => apiEquipes(client), [client]);
  const [d, setD] = useState<DiscordTournoi | undefined>();
  const [r, setR] = useState<{ modeleRole: string; couleur: string; suppressionH: string; categorieTicketId: string | null }>({ modeleRole: '', couleur: '', suppressionH: '24', categorieTicketId: null });
  const [propositions, setPropositions] = useState<PropositionEquipe[] | undefined>();
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [edition, setEdition] = useState<string | 'nouvelle' | undefined>();
  const [bilan, setBilan] = useState<BilanRoles | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const recevoir = useCallback((x: DiscordTournoi) => {
    if (!lisible(x)) return;
    setD(x);
    setR({ modeleRole: x.reglages.modeleRole, couleur: x.reglages.couleur ?? '', suppressionH: String(x.reglages.suppressionH), categorieTicketId: x.reglages.categorieTicketId });
  }, []);
  useEffect(() => {
    // Chargement discret : sans la route (ancien serveur) ou sans droit, la carte reste simplement cachée.
    api
      .lire(teamId, tournoiId)
      .then(recevoir)
      .catch(() => undefined);
  }, [agir, api, teamId, tournoiId, recevoir]);
  if (!d) return null;
  const nomCategorie = (c: { nom: { fr: string; en: string } }) => (langueCourante() === 'fr' ? c.nom.fr : c.nom.en) || c.nom.fr;
  const saisieDe = (e: EquipeTournoi): SaisieEquipe => ({ nom: e.nom, tag: e.tag, ticketId: e.ticketId, membres: e.membres.map(m => ({ poste: m.poste, discordId: m.discordId, nom: m.nom, embarkId: m.embarkId })) });
  const importer = () =>
    agir('importer', async () => {
      const x = await api.importer(teamId, tournoiId, r.categorieTicketId);
      setPropositions(x.propositions);
      setCochees(new Set(x.propositions.filter(p => !p.deja).map(p => p.ticketId)));
    });
  const ajouterCochees = () =>
    agir('ajouter', async () => {
      const choisies = (propositions ?? []).filter(p => cochees.has(p.ticketId));
      recevoir(await api.ajouter(teamId, tournoiId, choisies.map(p => ({ nom: p.nom, tag: p.tag, ticketId: p.ticketId, membres: p.membres.map(propre) }))));
      setPropositions(undefined);
      return trVc('eq.import_ok', { n: String(choisies.length) });
    });
  return (
    <Carte theme={theme} dense testID="esport-eq">
      <TitreCarte theme={theme} titre={trVc('eq.titre')} />
      <Text style={attenue(theme, 13)}>{trVc('eq.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-eq" />
      {!d.serveur ? <Avis theme={theme} genre="alerte" texte={trVc('eq.sans_serveur')} /> : null}
      {!d.droits.discord ? <Text style={attenue(theme)}>{trVc('eq.sans_droit_discord')}</Text> : null}
      {d.reglages.rolesCreesLe && !d.reglages.rolesSupprimesLe ? <Text style={attenue(theme)} testID="esport-eq-crees">{trVc('eq.roles_crees_le', { le: quand(d.reglages.rolesCreesLe) })}</Text> : null}
      {d.reglages.rolesSupprimesLe ? <Text style={attenue(theme)}>{trVc('eq.roles_supprimes_le', { le: quand(d.reglages.rolesSupprimesLe) })}</Text> : null}
      {d.hubs.length ? <Text style={attenue(theme)}>{trVc('eq.hubs', { hubs: d.hubs.map(h => h.nom || h.id).join(', ') })}</Text> : null}

      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trVc('eq.reglages')}</Text>
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trVc('eq.modele')} valeur={r.modeleRole} onChanger={modeleRole => setR({ ...r, modeleRole })} maxLength={90} testID="esport-eq-modele" style={{ flexGrow: 2, flexBasis: 200, minWidth: 0 }} />
        <Champ theme={theme} libelle={trVc('eq.couleur')} valeur={r.couleur} onChanger={couleur => setR({ ...r, couleur })} maxLength={7} testID="esport-eq-couleur" style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
        <Champ theme={theme} libelle={trVc('eq.suppression')} valeur={r.suppressionH} onChanger={suppressionH => setR({ ...r, suppressionH: suppressionH.replace(/\D/g, '') })} maxLength={3} clavier="number-pad" testID="esport-eq-suppression" style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
      </View>
      <Text style={attenue(theme)}>{trVc('eq.suppression_aide')}</Text>
      {d.categoriesTickets.length ? <Choix theme={theme} libelle={trVc('eq.categorie')} valeur={r.categorieTicketId ?? AUCUNE} options={[{ id: AUCUNE, nom: '—' }, ...d.categoriesTickets.map(c => ({ id: c.id, nom: nomCategorie(c) }))]} onChoisir={id => setR({ ...r, categorieTicketId: id === AUCUNE ? null : id })} testID="esport-eq-categorie" /> : null}
      <View style={styles.ligne}>
        <BoutonHub theme={theme} titre={trVc('eq.enregistrer')} onPress={() => void agir('reglages', async () => (recevoir(await api.reglages(teamId, tournoiId, { modeleRole: r.modeleRole, couleur: r.couleur || null, suppressionH: Number(r.suppressionH || 0), categorieTicketId: r.categorieTicketId })), trVc('eq.enregistre')))} testID="esport-eq-reglages-enregistrer" />
        {d.droits.importer && r.categorieTicketId ? <BoutonHub theme={theme} titre={trVc('eq.importer')} onPress={() => void importer()} desactive={enCours === 'importer'} testID="esport-eq-importer" /> : null}
      </View>

      {propositions ? (
        <View style={{ gap: ESP.xs }} testID="esport-eq-propositions">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trVc('eq.import_titre')}</Text>
          <Text style={attenue(theme)}>{trVc('eq.import_aide')}</Text>
          {!propositions.length ? <Text style={attenue(theme)}>{trVc('eq.import_vide')}</Text> : null}
          {propositions.map(p => (
            <Proposition key={p.ticketId} theme={theme} p={p} coche={cochees.has(p.ticketId)} onCocher={() => setCochees(c => (c.has(p.ticketId) ? new Set([...c].filter(x => x !== p.ticketId)) : new Set([...c, p.ticketId])))} />
          ))}
          <View style={styles.ligne}>
            <BoutonHub theme={theme} variante="plein" titre={trVc('eq.import_ajouter', { n: String(cochees.size) })} desactive={!cochees.size} onPress={() => void ajouterCochees()} testID="esport-eq-import-ajouter" />
            <BoutonHub theme={theme} titre={trVc('eq.annuler')} onPress={() => setPropositions(undefined)} testID="esport-eq-import-annuler" />
          </View>
        </View>
      ) : null}

      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trVc('eq.equipes', { n: String(d.equipes.length) })}</Text>
      {!d.equipes.length ? <Text style={attenue(theme)}>{trVc('eq.vide')}</Text> : null}
      {d.equipes.map(e =>
        edition === e.id ? (
          <EditeurEquipe key={e.id} theme={theme} initiale={saisieDe(e)} max={d.limites.membres} prefixe={`esport-eq-edition-${e.tag}`} onAnnuler={() => setEdition(undefined)} onEnregistrer={x => void agir('modifier', async () => (recevoir(await api.modifier(teamId, tournoiId, e.id, x)), setEdition(undefined), trVc('eq.enregistre')))} />
        ) : (
          <View key={e.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xxs }} testID={`esport-eq-equipe-${e.tag}`}>
            <View style={styles.ligne}>
              <Text style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }}>
                {e.tag} {e.nom}
              </Text>
              <Badge theme={theme} ton={e.roleId ? 'ok' : 'neutre'} texte={trVc(e.roleId ? 'eq.role_cree' : 'eq.role_absent')} />
            </View>
            {e.membres.map((m, i) => (
              <Text key={m.id ?? i} style={attenue(theme)}>
                {trVc(`eq.poste.${m.poste}` as CleVc)} · {m.nom || '—'} · {m.discordId ?? trVc('eq.membre_sans_id')}
                {m.embarkId ? ` · ${m.embarkId}` : ''}
                {m.roleStatut ? ` · ${trVc(`eq.statut.${m.roleStatut}` as CleVc)}` : ''}
              </Text>
            ))}
            <View style={styles.ligne}>
              <BoutonHub theme={theme} titre={trVc('eq.modifier')} onPress={() => setEdition(e.id)} testID={`esport-eq-equipe-${e.tag}-modifier`} />
              <BoutonConfirme theme={theme} titre={trVc('eq.supprimer')} confirmation={trVc('eq.supprimer_confirmer')} onConfirme={() => void agir('supprimer', async () => recevoir(await api.supprimer(teamId, tournoiId, e.id)))} testID={`esport-eq-equipe-${e.tag}-supprimer`} />
            </View>
          </View>
        ),
      )}
      {edition === 'nouvelle' ? (
        <EditeurEquipe theme={theme} initiale={{ nom: '', tag: '', membres: [membreVide()] }} max={d.limites.membres} prefixe="esport-eq-nouvelle" onAnnuler={() => setEdition(undefined)} onEnregistrer={x => void agir('ajouter', async () => (recevoir(await api.ajouter(teamId, tournoiId, [x])), setEdition(undefined), trVc('eq.enregistre')))} />
      ) : d.equipes.length < d.limites.equipes ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trVc('eq.ajouter')} onPress={() => setEdition('nouvelle')} testID="esport-eq-ajouter" />
        </View>
      ) : null}

      {d.droits.discord && d.serveur ? (
        <View style={styles.ligne}>
          <BoutonHub
            theme={theme}
            variante="plein"
            titre={trVc('eq.creer_roles')}
            desactive={!d.equipes.length || enCours === 'roles'}
            onPress={() =>
              void agir('roles', async () => {
                const x = await api.creerRoles(teamId, tournoiId);
                recevoir(x);
                setBilan(x.bilan);
              })
            }
            testID="esport-eq-creer-roles"
          />
          <BoutonConfirme
            theme={theme}
            titre={trVc('eq.supprimer_roles')}
            confirmation={trVc('eq.supprimer_roles_confirmer')}
            onConfirme={() =>
              void agir('roles', async () => {
                const x = await api.supprimerRoles(teamId, tournoiId);
                recevoir(x);
                setBilan(undefined);
                return trVc('eq.nettoyage', { roles: String(x.nettoyage.roles), salons: String(x.nettoyage.salons) });
              })
            }
            testID="esport-eq-supprimer-roles"
          />
        </View>
      ) : null}
      {bilan ? <Bilan theme={theme} b={bilan} /> : null}
    </Carte>
  );
}

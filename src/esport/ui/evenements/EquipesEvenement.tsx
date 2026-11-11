/**
 * Administration › Événements › fiche d'un événement › « Équipes participantes » (evenements.gerer ;
 * docs/esport/evenements.md) : équipes (nom, TAG, membres avec Discord ID, Embark ID, poste), import depuis les
 * tickets d'inscription (propositions à cocher, problèmes signalés, à corriger ensuite), ajout et correction à la
 * main, retrait (rôle et salon vocal supprimés). Avec les rôles automatiques, chaque changement met aussitôt les rôles
 * à jour sur Discord : le bilan s'affiche (absents, sans ID, refus, rôle du bot trop bas, position). Boutons
 * « Resynchroniser les rôles » et « Supprimer les rôles ». Le serveur valide tout.
 */

import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { trEv as trVc, type CleEv as CleVc } from '../../i18n/evenements';
import {
  POSTES,
  type BilanRoles,
  type EquipeEvenement,
  type FicheEvenement,
  type MembreEquipe,
  type PropositionEquipe,
  type SaisieEquipe,
  type apiEvenements,
} from '../../evenements/api';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte } from '../design';

const membreVide = (): MembreEquipe => ({
  poste: 'joueur',
  discordId: null,
  nom: '',
  embarkId: '',
});
const propre = (m: MembreEquipe): MembreEquipe => ({
  poste: m.poste,
  discordId: m.discordId ? m.discordId.replace(/\D/g, '') || null : null,
  nom: m.nom,
  embarkId: m.embarkId,
  capitaine: Boolean(m.capitaine),
});

/** Éditeur d'une équipe : nom, TAG, membres (poste, Discord ID, nom, Embark ID). */
function EditeurEquipe({
  theme,
  initiale,
  max,
  onEnregistrer,
  onAnnuler,
  prefixe,
}: {
  theme: ThemeHub;
  initiale: SaisieEquipe;
  max: number;
  onEnregistrer(e: SaisieEquipe): void;
  onAnnuler(): void;
  prefixe: string;
}) {
  const [e, setE] = useState<SaisieEquipe>(initiale);
  const membre = (i: number, maj: Partial<MembreEquipe>) =>
    setE({
      ...e,
      membres: e.membres.map((m, j) => (j === i ? { ...m, ...maj } : m)),
    });
  return (
    <View style={{ gap: ESP.xs }} testID={prefixe}>
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ
          theme={theme}
          libelle={trVc('eq.nom')}
          valeur={e.nom}
          onChanger={nom => setE({ ...e, nom })}
          maxLength={80}
          testID={`${prefixe}-nom`}
          style={{ flexGrow: 2, flexBasis: 200, minWidth: 0 }}
        />
        <Champ
          theme={theme}
          libelle={trVc('eq.tag')}
          valeur={e.tag}
          onChanger={tag => setE({ ...e, tag: tag.toUpperCase() })}
          maxLength={6}
          testID={`${prefixe}-tag`}
          style={{ flexGrow: 1, flexBasis: 90, minWidth: 0 }}
        />
      </View>
      {e.membres.map((m, i) => (
        <View
          key={i}
          style={{
            gap: ESP.xxs,
            borderTopWidth: 1,
            borderTopColor: theme.ligne,
            paddingTop: ESP.xxs,
          }}
          testID={`${prefixe}-membre-${i}`}
        >
          <Choix
            theme={theme}
            libelle={trVc('eq.membre', { n: i + 1 })}
            valeur={m.poste}
            options={POSTES.map(p => ({
              id: p,
              nom: trVc(`eq.poste.${p}` as CleVc),
            }))}
            onChoisir={poste => membre(i, { poste })}
            testID={`${prefixe}-membre-${i}-poste`}
          />
          {/* Un seul capitaine : cocher l'un décoche les autres. */}
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme, 13), flex: 1, minWidth: 0 }}>{trVc('eq.capitaine')}</Text>
            <Interrupteur
              theme={theme}
              libelle={trVc('eq.capitaine')}
              valeur={Boolean(m.capitaine)}
              onChanger={v =>
                setE({
                  ...e,
                  membres: e.membres.map((x, j) => ({ ...x, capitaine: j === i ? v : v ? false : Boolean(x.capitaine) })),
                })
              }
              testID={`${prefixe}-membre-${i}-capitaine`}
            />
          </View>
          <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
            <Champ
              theme={theme}
              libelle={trVc('eq.discord_id')}
              valeur={m.discordId ?? ''}
              onChanger={v =>
                membre(i, { discordId: v.replace(/\D/g, '') || null })
              }
              maxLength={20}
              clavier="number-pad"
              testID={`${prefixe}-membre-${i}-discord`}
              style={{ flexGrow: 2, flexBasis: 180, minWidth: 0 }}
            />
            <Champ
              theme={theme}
              libelle={trVc('eq.membre_nom')}
              valeur={m.nom}
              onChanger={nom => membre(i, { nom })}
              maxLength={100}
              testID={`${prefixe}-membre-${i}-nom`}
              style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }}
            />
            <Champ
              theme={theme}
              libelle={trVc('eq.embark')}
              valeur={m.embarkId}
              onChanger={embarkId => membre(i, { embarkId })}
              maxLength={60}
              testID={`${prefixe}-membre-${i}-embark`}
              style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }}
            />
            <BoutonHub
              theme={theme}
              titre={trVc('eq.membre_retirer')}
              variante="danger"
              onPress={() =>
                setE({ ...e, membres: e.membres.filter((_, j) => j !== i) })
              }
              testID={`${prefixe}-membre-${i}-retirer`}
            />
          </View>
        </View>
      ))}
      <View style={styles.ligne}>
        {e.membres.length < max ? (
          <BoutonHub
            theme={theme}
            titre={trVc('eq.membre_ajouter')}
            onPress={() =>
              setE({ ...e, membres: [...e.membres, membreVide()] })
            }
            testID={`${prefixe}-membre-ajouter`}
          />
        ) : null}
        <BoutonHub
          theme={theme}
          variante="plein"
          titre={trVc('eq.enregistrer')}
          onPress={() =>
            onEnregistrer({ ...e, membres: e.membres.map(propre) })
          }
          testID={`${prefixe}-enregistrer`}
        />
        <BoutonHub
          theme={theme}
          titre={trVc('eq.annuler')}
          onPress={onAnnuler}
          testID={`${prefixe}-annuler`}
        />
      </View>
    </View>
  );
}

/** Une proposition d'import (ticket) : case à cocher, équipe, membres et problèmes. */
function Proposition({
  theme,
  p,
  coche,
  onCocher,
}: {
  theme: ThemeHub;
  p: PropositionEquipe;
  coche: boolean;
  onCocher(): void;
}) {
  return (
    <Pressable
      onPress={onCocher}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: coche }}
      accessibilityLabel={`${p.tag} ${p.nom}`}
      style={{
        gap: 2,
        borderWidth: 1,
        borderColor: coche ? theme.accent : theme.ligne,
        borderRadius: 10,
        padding: ESP.xs,
      }}
      testID={`esport-eq-prop-${p.numero}`}
    >
      <View style={styles.ligne}>
        <Text style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }}>
          {coche ? '✓ ' : ''}
          {[p.tag, p.nom].filter(Boolean).join(' ') || '—'}
        </Text>
        <Text style={attenue(theme)}>
          {trVc('eq.ticket', { numero: String(p.numero), statut: p.statut })}
        </Text>
        {p.deja ? <Badge theme={theme} texte={trVc('eq.deja')} /> : null}
      </View>
      {p.membres.map((m, i) => (
        <Text key={i} style={attenue(theme)}>
          {trVc(`eq.poste.${m.poste}` as CleVc)} ·{' '}
          {m.nom || m.discordId || m.brut || '—'}
          {m.discordId
            ? ` · ${m.discordId}`
            : ` · ${trVc('eq.membre_sans_id')}`}
          {m.embarkId ? ` · ${m.embarkId}` : ''}
          {m.present === false ? ` · ${trVc('eq.membre_absent')}` : ''}
          {m.trouveParNom ? ` · ${trVc('eq.membre_trouve')}` : ''}
        </Text>
      ))}
      {p.problemes.map(x => (
        <Text
          key={x}
          style={{ ...attenue(theme), color: theme.alerte }}
          testID={`esport-eq-prop-${p.numero}-${x}`}
        >
          {trVc(`eq.probleme.${x}` as CleVc)}
        </Text>
      ))}
    </Pressable>
  );
}

export function Bilan({ theme, b }: { theme: ThemeHub; b: BilanRoles }) {
  return (
    <View style={{ gap: ESP.xxs }} testID="esport-eq-bilan">
      <Avis
        theme={theme}
        genre={b.refus.length || b.absents.length ? 'alerte' : 'ok'}
        texte={trVc('eq.bilan', {
          creees: String(b.creees),
          attribues: String(b.attribues),
        })}
      />
      {b.absents.length ? (
        <Text style={attenue(theme)} testID="esport-eq-bilan-absents">
          {trVc('eq.bilan_absents', {
            liste: b.absents
              .map(a => `${a.nom || a.discordId} (${a.equipe})`)
              .join(', '),
          })}
        </Text>
      ) : null}
      {b.sansId.length ? (
        <Text style={attenue(theme)} testID="esport-eq-bilan-sans-id">
          {trVc('eq.bilan_sans_id', {
            liste: b.sansId
              .map(a => `${a.nom || '?'} (${a.equipe})`)
              .join(', '),
          })}
        </Text>
      ) : null}
      {b.refus.length ? (
        <Text style={attenue(theme)} testID="esport-eq-bilan-refus">
          {trVc('eq.bilan_refus', {
            liste: b.refus
              .map(a => `${a.equipe} (${a.code ?? a.statut})`)
              .join(', '),
          })}
        </Text>
      ) : null}
      {b.refus.some(a => a.code === 50013) || b.hierarchie?.ok === false ? (
        <Avis
          theme={theme}
          genre="critique"
          texte={trVc('eq.hierarchie')}
          testID="esport-eq-hierarchie"
        />
      ) : null}
      {b.renommees ? (
        <Text style={attenue(theme)}>
          {trVc('eq.bilan_renommees', { n: String(b.renommees) })}
        </Text>
      ) : null}
      {b.retires ? (
        <Text style={attenue(theme)}>
          {trVc('eq.bilan_retires', { n: String(b.retires) })}
        </Text>
      ) : null}
      {b.position ? (
        b.position.ok ? (
          b.position.deplaces ? (
            <Text style={attenue(theme)} testID="esport-eq-position-ok">
              {trVc('eq.position_ok')}
            </Text>
          ) : null
        ) : (
          <Avis
            theme={theme}
            genre="alerte"
            texte={trVc('eq.position_ko', { raison: b.position.raison ?? '?' })}
            testID="esport-eq-position-ko"
          />
        )
      ) : null}
      {b.limite ? (
        <Avis theme={theme} genre="alerte" texte={trVc('eq.bilan_limite')} />
      ) : null}
    </View>
  );
}

type Api = ReturnType<typeof apiEvenements>;

/** Ce que la réponse dit des rôles automatiques après un changement (bilan, ou pourquoi rien n'a été fait). */
function messageDiscord(f: FicheEvenement): string | undefined {
  if (f.discord?.erreur)
    return trVc(`eq.discord_erreur.${f.discord.erreur}` as CleVc);
  if (f.discord?.suppression)
    return trVc('eq.suppression_faite', {
      salons: f.discord.suppression.salons
        ? trVc('eq.suppression_salons', {
            n: String(f.discord.suppression.salons),
          })
        : '',
    });
  return undefined;
}

export function EquipesEvenement({
  theme,
  api,
  fiche: d,
  onFiche,
  categorieId,
}: {
  theme: ThemeHub;
  api: Api;
  fiche: FicheEvenement;
  onFiche(f: FicheEvenement): void;
  categorieId: string | null;
}) {
  const [propositions, setPropositions] = useState<
    PropositionEquipe[] | undefined
  >();
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [edition, setEdition] = useState<string | 'nouvelle' | undefined>();
  const [bilan, setBilan] = useState<BilanRoles | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const id = d.evenement.id;
  const limites = d.choix.limites;
  /** Réponse du serveur : fiche à jour, et bilan des rôles automatiques s'il y en a un. */
  const recevoir = (f: FicheEvenement, defaut?: string): string | undefined => {
    onFiche(f);
    setBilan(f.discord?.bilan ?? undefined);
    return messageDiscord(f) ?? defaut;
  };
  const saisieDe = (e: EquipeEvenement): SaisieEquipe => ({
    nom: e.nom,
    tag: e.tag,
    ticketId: e.ticketId,
    membres: e.membres.map(m => ({
      poste: m.poste,
      discordId: m.discordId,
      nom: m.nom,
      embarkId: m.embarkId,
      capitaine: Boolean(m.capitaine),
    })),
  });
  const importer = () =>
    agir('importer', async () => {
      const x = await api.importer(id, categorieId);
      setPropositions(x.propositions);
      setCochees(
        new Set(x.propositions.filter(p => !p.deja).map(p => p.ticketId)),
      );
    });
  const ajouterCochees = () =>
    agir('ajouter', async () => {
      const choisies = (propositions ?? []).filter(p =>
        cochees.has(p.ticketId),
      );
      const f = await api.ajouter(
        id,
        choisies.map(p => ({
          nom: p.nom,
          tag: p.tag,
          ticketId: p.ticketId,
          membres: p.membres.map(propre),
        })),
      );
      setPropositions(undefined);
      return recevoir(f, trVc('eq.import_ok', { n: String(choisies.length) }));
    });
  const fini =
    d.evenement.statut === 'termine' || d.evenement.statut === 'annule';
  return (
    <Carte theme={theme} dense testID="esport-eq">
      <TitreCarte theme={theme} titre={trVc('eq.titre')} />
      <Text style={attenue(theme, 13)}>{trVc('eq.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-eq" />
      {d.droits.importer && categorieId ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub
            theme={theme}
            titre={trVc('eq.importer')}
            onPress={() => void importer()}
            desactive={enCours === 'importer'}
            testID="esport-eq-importer"
          />
        </View>
      ) : null}

      {propositions ? (
        <View style={{ gap: ESP.xs }} testID="esport-eq-propositions">
          <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>
            {trVc('eq.import_titre')}
          </Text>
          <Text style={attenue(theme)}>{trVc('eq.import_aide')}</Text>
          {!propositions.length ? (
            <Text style={attenue(theme)}>{trVc('eq.import_vide')}</Text>
          ) : null}
          {propositions.map(p => (
            <Proposition
              key={p.ticketId}
              theme={theme}
              p={p}
              coche={cochees.has(p.ticketId)}
              onCocher={() =>
                setCochees(c =>
                  c.has(p.ticketId)
                    ? new Set([...c].filter(x => x !== p.ticketId))
                    : new Set([...c, p.ticketId]),
                )
              }
            />
          ))}
          <View style={styles.ligne}>
            <BoutonHub
              theme={theme}
              variante="plein"
              titre={trVc('eq.import_ajouter', { n: String(cochees.size) })}
              desactive={!cochees.size}
              onPress={() => void ajouterCochees()}
              testID="esport-eq-import-ajouter"
            />
            <BoutonHub
              theme={theme}
              titre={trVc('eq.annuler')}
              onPress={() => setPropositions(undefined)}
              testID="esport-eq-import-annuler"
            />
          </View>
        </View>
      ) : null}

      <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>
        {trVc('eq.equipes', { n: String(d.equipes.length) })}
      </Text>
      {!d.equipes.length ? (
        <Text style={attenue(theme)}>{trVc('eq.vide')}</Text>
      ) : null}
      {d.equipes.map(e =>
        edition === e.id ? (
          <EditeurEquipe
            key={e.id}
            theme={theme}
            initiale={saisieDe(e)}
            max={limites.membres}
            prefixe={`esport-eq-edition-${e.tag}`}
            onAnnuler={() => setEdition(undefined)}
            onEnregistrer={x =>
              void agir('modifier', async () => {
                const f = await api.modifierEquipe(id, e.id, x);
                setEdition(undefined);
                return recevoir(f, trVc('eq.enregistre'));
              })
            }
          />
        ) : (
          <View
            key={e.id}
            style={{
              gap: 2,
              borderTopWidth: 1,
              borderTopColor: theme.ligne,
              paddingTop: ESP.xxs,
            }}
            testID={`esport-eq-equipe-${e.tag}`}
          >
            <View style={styles.ligne}>
              <Text
                style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }}
              >
                {e.tag} {e.nom}
              </Text>
              <Badge
                theme={theme}
                ton={e.roleId ? 'ok' : 'neutre'}
                texte={trVc(e.roleId ? 'eq.role_cree' : 'eq.role_absent')}
              />
            </View>
            {e.membres.map((m, i) => (
              <Text key={m.id ?? i} style={attenue(theme)}>
                {trVc(`eq.poste.${m.poste}` as CleVc)}
                {m.capitaine ? ` (${trVc('eq.capitaine_court')})` : ''} · {m.nom || '—'} ·{' '}
                {m.discordId ?? trVc('eq.membre_sans_id')}
                {m.embarkId ? ` · ${m.embarkId}` : ''}
                {m.roleStatut
                  ? ` · ${trVc(`eq.statut.${m.roleStatut}` as CleVc)}`
                  : ''}
              </Text>
            ))}
            <View style={styles.ligne}>
              <BoutonHub
                theme={theme}
                titre={trVc('eq.modifier')}
                onPress={() => setEdition(e.id)}
                testID={`esport-eq-equipe-${e.tag}-modifier`}
              />
              <BoutonConfirme
                theme={theme}
                titre={trVc('eq.supprimer')}
                confirmation={trVc('eq.supprimer_confirmer')}
                onConfirme={() =>
                  void agir('supprimer', async () =>
                    recevoir(await api.supprimerEquipe(id, e.id)),
                  )
                }
                testID={`esport-eq-equipe-${e.tag}-supprimer`}
              />
            </View>
          </View>
        ),
      )}
      {edition === 'nouvelle' ? (
        <EditeurEquipe
          theme={theme}
          initiale={{ nom: '', tag: '', membres: [membreVide()] }}
          max={limites.membres}
          prefixe="esport-eq-nouvelle"
          onAnnuler={() => setEdition(undefined)}
          onEnregistrer={x =>
            void agir('ajouter', async () => {
              const f = await api.ajouter(id, [x]);
              setEdition(undefined);
              return recevoir(f, trVc('eq.enregistre'));
            })
          }
        />
      ) : d.equipes.length < limites.equipes ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub
            theme={theme}
            titre={trVc('eq.ajouter')}
            onPress={() => setEdition('nouvelle')}
            testID="esport-eq-ajouter"
          />
        </View>
      ) : null}

      {d.serveur && d.bot ? (
        <View style={styles.ligne}>
          {!fini ? (
            <BoutonHub
              theme={theme}
              variante="plein"
              titre={trVc('eq.resynchroniser')}
              desactive={!d.equipes.length || enCours === 'roles'}
              onPress={() =>
                void agir('roles', async () =>
                  recevoir(await api.resynchroniser(id)),
                )
              }
              testID="esport-eq-resynchroniser"
            />
          ) : null}
          <Text style={attenue(theme)} testID="esport-eq-roles-a-supprimer">
            {d.suppression?.roles?.length ? trVc('supprimer_roles_liste', { liste: d.suppression.roles.map(r => r.nom).join(', ') }) : trVc('supprimer_roles_aucun')}
          </Text>
          <BoutonConfirme
            theme={theme}
            titre={trVc('eq.supprimer_roles')}
            confirmation={trVc('eq.supprimer_roles_confirmer')}
            onConfirme={() =>
              void agir('roles', async () => {
                const f = await api.supprimerRoles(id);
                onFiche(f);
                setBilan(undefined);
                return trVc('eq.nettoyage', {
                  roles: String(f.nettoyage?.roles ?? 0),
                  salons: String(f.nettoyage?.salons ?? 0),
                });
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

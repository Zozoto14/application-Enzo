/**
 * Attribution des badges d'un membre (migration 0032), depuis sa fiche : une case par badge du catalogue, pour le
 * club et pour chaque team du membre où l'acteur attribue (« Capitaine · Team Alpha »). Les badges automatiques
 * (« CEO », « Responsable CM »…) suivent le rôle : montrés, jamais cochables. Les badges réservés au Fondateur ne
 * sont cochables que par lui. Le serveur revérifie tout (jamais à soi-même, sauf le Fondateur).
 *
 * Qui gère le catalogue (`attribution.gerer`) peut aussi, sans quitter le panneau : « + Nouveau badge » (créé puis
 * coché dans la section où on l'a créé), un crayon par badge (nom, couleur, emoji) et « Gérer tous les badges… »
 * (gestionnaire complet, en place). Les cases cochées mais non enregistrées sont conservées pendant ces opérations.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type ApiTrombi, type BadgeCatalogue, type FicheTrombi } from '../../trombi/api';
import { trTb } from '../../i18n/trombi';
import { Retours, styles, useAgir } from '../commun';
import { ESP, attenue, texte } from '../design';
import { PuceBadge } from './commun';
import { FormulaireBadge, brouillonValide, brouillonVide, type BrouillonBadge } from './FormulaireBadge';
import { GestionBadges } from './GestionBadges';

const cle = (id: string, portee: string) => `${id}|${portee}`;

export function EditeurBadges({ theme, api, fiche, onFini, onCatalogue }: { theme: ThemeHub; api: ApiTrombi; fiche: FicheTrombi; onFini(f?: FicheTrombi): void; onCatalogue?(): unknown }) {
  const a = fiche.attribution!;
  const [coches, setCoches] = useState(() => new Set(a.actuelles.map(x => cle(x.id, x.portee))));
  const [catalogue, setCatalogue] = useState<BadgeCatalogue[]>(a.catalogue);
  // Une seule opération de catalogue à la fois : création dans une section, modification d'un badge dans une section, ou gestionnaire complet.
  const [creation, setCreation] = useState<{ portee: string; brouillon: BrouillonBadge } | undefined>();
  const [edition, setEdition] = useState<{ portee: string; brouillon: BrouillonBadge } | undefined>();
  const [gestion, setGestion] = useState(false);
  const { erreur, avis, agir, enCours } = useAgir();
  const gerer = Boolean(a.gerer);
  const manuels = catalogue.filter(b => !b.auto);
  const autos = (fiche.badges ?? []).filter(b => b.auto);
  const basculer = (k: string, v: boolean) =>
    setCoches(c => {
      const n = new Set(c);
      if (v) n.add(k);
      else n.delete(k);
      return n;
    });
  const apresCatalogue = (badges: BadgeCatalogue[]) => {
    setCatalogue(badges);
    // Un badge supprimé disparaît des cases cochées.
    setCoches(c => new Set([...c].filter(k => badges.some(b => b.id === k.split('|')[0]))));
    void onCatalogue?.();
  };
  if (gestion) {
    return (
      <View style={{ gap: ESP.s, borderWidth: 1, borderColor: theme.ligne, borderRadius: 12, padding: ESP.s }} testID="esport-trombi-badges-membre-gestion">
        <GestionBadges theme={theme} api={api} fondateur={a.fondateur} onChange={() => onCatalogue?.()} testID="esport-trombi-badges-membre-gestionnaire" />
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub
            theme={theme}
            titre={trTb('badges.retour_cases')}
            variante="plein"
            onPress={() =>
              void agir('catalogue', async () => {
                apresCatalogue((await api.catalogueBadges()).badges);
                setGestion(false);
              })
            }
            testID="esport-trombi-badges-membre-gestion-retour"
          />
        </View>
        <Retours theme={theme} erreur={erreur} prefixe="esport-trombi-badges-membre" />
      </View>
    );
  }
  return (
    <View style={{ gap: ESP.s, borderWidth: 1, borderColor: theme.ligne, borderRadius: 12, padding: ESP.s }} testID="esport-trombi-badges-membre">
      <Text style={attenue(theme)}>{trTb('badges.attribuer_aide')}</Text>
      {autos.length ? (
        <View style={[styles.ligne, { gap: ESP.xxs }]}>
          {autos.map(b => (
            <PuceBadge key={`${b.id}-${b.teamId ?? 'club'}`} theme={theme} badge={b} />
          ))}
          <Text style={attenue(theme, 12)}>{trTb('badges.auto')}</Text>
        </View>
      ) : null}
      {a.portees.map(p => (
        <View key={p.id} style={{ gap: ESP.xxs }}>
          <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{p.id === PORTEE_CLUB ? trTb('badges.portee.club') : trTb('badges.portee_team', { team: p.nom ?? p.id })}</Text>
          <View style={[styles.ligne, { gap: ESP.s }]}>
            {manuels.map(b => {
              const k = cle(b.id, p.id);
              const verrou = b.reserve && !a.fondateur;
              return (
                <View key={k} style={[styles.ligne, { gap: ESP.xs, opacity: verrou ? 0.45 : 1 }]}>
                  {verrou ? null : <Case theme={theme} coche={coches.has(k)} libelle={`${b.nom} — ${p.nom ?? trTb('badges.portee.club')}`} onChanger={v => basculer(k, v)} testID={`esport-trombi-badges-membre-${b.id}-${p.id}`} />}
                  <PuceBadge theme={theme} badge={{ ...b, teamNom: null }} />
                  {gerer && !verrou ? (
                    <BoutonHub
                      theme={theme}
                      titre="✎"
                      libelle={trTb('badges.modifier_badge', { nom: b.nom })}
                      onPress={() => {
                        setCreation(undefined);
                        setEdition({ portee: p.id, brouillon: { id: b.id, nom: b.nom, couleur: b.couleur, libre: '', icone: b.icone, reserve: b.reserve } });
                      }}
                      testID={`esport-trombi-badges-membre-modifier-${b.id}-${p.id}`}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
          {edition?.portee === p.id ? (
            <View style={{ gap: ESP.xs }} testID="esport-trombi-badges-membre-edition">
              <FormulaireBadge theme={theme} brouillon={edition.brouillon} maj={brouillon => setEdition({ portee: p.id, brouillon })} prefixe="esport-trombi-badges-membre-edition" fondateur={a.fondateur} />
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub
                  theme={theme}
                  titre={trTb('enregistrer')}
                  variante="plein"
                  desactive={!brouillonValide(edition.brouillon) || Boolean(enCours)}
                  onPress={() => {
                    const d = edition.brouillon;
                    const avant = catalogue.find(b => b.id === d.id);
                    void agir('catalogue', async () => {
                      const r = await api.modifierBadge(d.id, { nom: d.nom, couleur: d.couleur, icone: d.icone, ...(a.fondateur && avant && d.reserve !== avant.reserve ? { reserve: d.reserve } : {}) });
                      apresCatalogue(r.badges);
                      setEdition(undefined);
                      return trTb('badges.enregistre');
                    });
                  }}
                  testID="esport-trombi-badges-membre-edition-ok"
                />
                <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => setEdition(undefined)} testID="esport-trombi-badges-membre-edition-annuler" />
              </View>
            </View>
          ) : null}
          {gerer && creation?.portee === p.id ? (
            <View style={{ gap: ESP.xs }} testID="esport-trombi-badges-membre-creation">
              <FormulaireBadge theme={theme} brouillon={creation.brouillon} maj={brouillon => setCreation({ portee: p.id, brouillon })} prefixe="esport-trombi-badges-membre-creation" fondateur={a.fondateur} />
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub
                  theme={theme}
                  titre={trTb('badges.creer_cocher')}
                  variante="plein"
                  desactive={!brouillonValide(creation.brouillon) || Boolean(enCours)}
                  onPress={() => {
                    const d = creation.brouillon;
                    void agir('catalogue', async () => {
                      const r = await api.creerBadge({ nom: d.nom, couleur: d.couleur, icone: d.icone, ...(a.fondateur && d.reserve ? { reserve: true } : {}) });
                      // Le serveur rend le catalogue entier : le nouveau badge est celui qui n'y était pas.
                      const nouveau = r.badges.find(b => !catalogue.some(c => c.id === b.id));
                      apresCatalogue(r.badges);
                      if (nouveau) basculer(cle(nouveau.id, p.id), true);
                      setCreation(undefined);
                      return trTb('badges.cree_coche', { nom: nouveau?.nom ?? d.nom });
                    });
                  }}
                  testID="esport-trombi-badges-membre-creation-ok"
                />
                <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => setCreation(undefined)} testID="esport-trombi-badges-membre-creation-annuler" />
              </View>
            </View>
          ) : gerer ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <BoutonHub
                theme={theme}
                titre={trTb('badges.nouveau_plus')}
                onPress={() => {
                  setEdition(undefined);
                  setCreation({ portee: p.id, brouillon: brouillonVide() });
                }}
                testID={`esport-trombi-badges-membre-nouveau-${p.id}`}
              />
            </View>
          ) : null}
        </View>
      ))}
      {gerer ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={trTb('badges.gerer_tous')} onPress={() => setGestion(true)} testID="esport-trombi-badges-membre-gerer" />
        </View>
      ) : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-trombi-badges-membre" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub
          theme={theme}
          titre={trTb('enregistrer')}
          variante="plein"
          desactive={Boolean(enCours)}
          onPress={() =>
            void agir('badges', async () => {
              const liste = [...coches].map(k => {
                const [id, portee] = k.split('|');
                return { id, portee };
              });
              onFini(await api.attribuerBadges(fiche.compte, liste));
            })
          }
          testID="esport-trombi-badges-membre-ok"
        />
        <BoutonHub theme={theme} titre={trTb('annuler')} onPress={() => onFini()} testID="esport-trombi-badges-membre-annuler" />
      </View>
    </View>
  );
}

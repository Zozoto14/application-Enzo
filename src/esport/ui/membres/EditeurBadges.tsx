/**
 * Attribution des badges d'un membre (migration 0032), depuis sa fiche : une case par badge du catalogue, pour le
 * club et pour chaque team du membre où l'acteur attribue (« Capitaine · Team Alpha »). Les badges automatiques
 * (« CEO », « Responsable CM »…) suivent le rôle : montrés, jamais cochables. Les badges réservés au Fondateur ne
 * sont cochables que par lui. Le serveur revérifie tout (jamais à soi-même, sauf le Fondateur).
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Case } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { PORTEE_CLUB, type ApiTrombi, type FicheTrombi } from '../../trombi/api';
import { trTb } from '../../i18n/trombi';
import { Retours, styles, useAgir } from '../commun';
import { ESP, attenue, texte } from '../design';
import { PuceBadge } from './commun';

const cle = (id: string, portee: string) => `${id}|${portee}`;

export function EditeurBadges({ theme, api, fiche, onFini }: { theme: ThemeHub; api: ApiTrombi; fiche: FicheTrombi; onFini(f?: FicheTrombi): void }) {
  const a = fiche.attribution!;
  const [coches, setCoches] = useState(() => new Set(a.actuelles.map(x => cle(x.id, x.portee))));
  const { erreur, agir, enCours } = useAgir();
  const manuels = a.catalogue.filter(b => !b.auto);
  const autos = (fiche.badges ?? []).filter(b => b.auto);
  const basculer = (k: string, v: boolean) =>
    setCoches(c => {
      const n = new Set(c);
      if (v) n.add(k);
      else n.delete(k);
      return n;
    });
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
                </View>
              );
            })}
          </View>
        </View>
      ))}
      <Retours theme={theme} erreur={erreur} prefixe="esport-trombi-badges-membre" />
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

/**
 * Partage élargi (V3) : membres de Tâches (invitations, retrait), droits par
 * projet et par personne, avatars. Le Fondateur gère ; un membre voit ses
 * projets, son droit sur chacun et les personnes de chaque projet.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { rangDe } from '../../hub/admin/roles';
import type { Profil } from '../../profils/profils';
import { changerPerso, droitDe, listeMembres, membresDuProjet, type DroitOuAucun, type Membre } from '../membres';
import { LIBELLES_DROIT, projetsDe, vivant, type Auteur, type Projet } from '../modele';
import type { Actions } from './actions';
import { attenueDe, Avatar, Bouton, Dialogue, Libelle, Puce, texteDe } from './atomes';
import { couleurAuteur } from './Vues';

const DROITS: readonly DroitOuAucun[] = ['aucun', 'lecture', 'ecriture', 'admin'];
const LIBELLES_COURTS: Record<DroitOuAucun, string> = { aucun: 'Aucun', lecture: 'Lecture', ecriture: 'Écriture', admin: 'Admin' };

function couleurDroit(a: Actions, d: DroitOuAucun): string {
  return d === 'admin' ? a.theme.teintes.admin : d === 'ecriture' ? a.theme.ok : d === 'lecture' ? a.theme.alerte : a.theme.attenue;
}

/** Choix du droit d'un membre sur un projet (Aucun / Lecture / Écriture / Admin). */
export function ChoixDroit({ a, projet, membre, onErreur }: { a: Actions; projet: Projet; membre: Membre; onErreur(e: unknown): void }) {
  const actuel = droitDe(a.etat.donnees, projet.id, membre.compte);
  return (
    <View style={styles.rangee} accessibilityRole="radiogroup" accessibilityLabel={`Droit de ${membre.nom} sur ${projet.nom}`}>
      {DROITS.map(x => (
        <Puce
          key={x}
          theme={a.theme}
          grand={a.mobile}
          texte={LIBELLES_COURTS[x]}
          libelle={`${membre.nom} : ${LIBELLES_DROIT[x]} sur « ${projet.nom} »`}
          couleur={couleurDroit(a, x)}
          actif={actuel === x}
          onPress={() => {
            try {
              a.etat.changerDroit(projet.id, membre.compte, x);
            } catch (e) {
              onErreur(e);
            }
          }}
          testID={`droit-${projet.id}-${membre.compte}-${x}`}
        />
      ))}
    </View>
  );
}

/** Pastilles des personnes d'un projet (initiales, avec leur droit en texte pour les lecteurs d'écran). */
export function PersonnesProjet({ a, projetId, taille = 26 }: { a: Actions; projetId: string; taille?: number }) {
  const d = a.etat.donnees;
  const personnes: Array<{ code: Auteur; nom: string; droit: string }> =
    a.etat.role === 'fondateur'
      ? membresDuProjet(d, projetId).map(m => ({ code: m.code, nom: m.nom, droit: LIBELLES_DROIT[m.droit] }))
      : Object.entries(d.projets[projetId]?.acces ?? {}).map(([code, droit]) => ({ code, nom: a.etat.noms[code] ?? 'Membre', droit: LIBELLES_DROIT[droit] }));
  if (!personnes.length) return null;
  return (
    <View style={[styles.rangee, { gap: 0 }]} accessibilityLabel={`Partagé avec ${personnes.map(p => `${p.nom} (${p.droit.toLowerCase()})`).join(', ')}`} testID={`personnes-${projetId}`}>
      {personnes.slice(0, 5).map((p, i) => (
        <View key={p.code} style={{ marginLeft: i ? -6 : 0, borderWidth: 2, borderColor: a.theme.surface, borderRadius: (taille + 4) / 2 }}>
          <Avatar theme={a.theme} nom={p.nom} couleur={couleurAuteur(a, p.code)} taille={taille} />
        </View>
      ))}
      {personnes.length > 5 ? <Text style={[attenueDe(a.theme), { marginLeft: 6 }]}>+{personnes.length - 5}</Text> : null}
    </View>
  );
}

/** Section « Partage » des paramètres d'un projet (Fondateur). */
export function PartageProjet({ a, projet, onErreur, onMembres }: { a: Actions; projet: Projet; onErreur(e: unknown): void; onMembres(): void }) {
  const membres = listeMembres(a.etat.donnees);
  if (projet.auto) return <Text style={attenueDe(a.theme)}>Projet tenu par une autre app : il ne se partage pas (rien de ces apps n’est montré aux membres).</Text>;
  if (!membres.length) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={attenueDe(a.theme)}>Invitez d’abord des membres (amis ou gestionnaires du hub).</Text>
        <Bouton theme={a.theme} titre="👥 Membres…" onPress={onMembres} testID="projet-membres" style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={attenueDe(a.theme)}>Lecture : voir. Écriture : tâches, commentaires, temps, journal. Admin : en plus les listes, statuts et paramètres du projet. Retirer un accès change la clé du projet : l’ancien membre ne lit plus rien de nouveau.</Text>
      {membres.map(m => (
        <View key={m.compte} style={[styles.ligne, { flexWrap: 'wrap' }]} testID={`projet-droit-${m.compte}`}>
          <Avatar theme={a.theme} nom={m.nom} couleur={couleurAuteur(a, m.code)} />
          <Text style={[texteDe(a.theme), { flex: 1, minWidth: 100 }]}>{m.nom}</Text>
          <ChoixDroit a={a} projet={projet} membre={m} onErreur={onErreur} />
        </View>
      ))}
    </View>
  );
}

/** Membres de Tâches (Fondateur) : inviter, droits par projet, retirer. */
export function DialogueMembres({ a, comptes, onFermer, onErreur, onAvis }: { a: Actions; comptes: readonly Profil[]; onFermer(): void; onErreur(e: unknown): void; onAvis(t: string): void }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const membres = listeMembres(d);
  const [ouvert, setOuvert] = useState<string | undefined>(membres[0]?.compte);
  const [retrait, setRetrait] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const projets = projetsDe(d).filter(p => !p.auto);
  const invitables = comptes.filter(p => !p.admin && p.actif !== false && ['ami', 'gestionnaire', 'administrateur'].includes(rangDe(p)) && !membres.some(m => m.compte === p.id));
  const rangDu = (p: Profil): 'ami' | 'gestionnaire' | 'administrateur' => (rangDe(p) === 'gestionnaire' || rangDe(p) === 'administrateur' ? (rangDe(p) as 'gestionnaire' | 'administrateur') : 'ami');
  const agir = (f: () => Promise<void>, avis: string) => {
    setEnCours(true);
    f()
      .then(() => onAvis(avis))
      .catch(onErreur)
      .finally(() => setEnCours(false));
  };
  return (
    <Dialogue theme={theme} mobile={a.mobile} visible large titre="Membres et partage" onFermer={onFermer} testID="dialogue-membres" description="Invitez des amis ou des gestionnaires du hub, puis choisissez projet par projet ce que chacun voit et peut faire. Tout reste chiffré de bout en bout : chacun ne reçoit que ses projets.">
      <Libelle theme={theme}>{`MEMBRES · ${membres.length}`}</Libelle>
      {!membres.length ? <Text style={attenueDe(theme)}>Personne pour l’instant.</Text> : null}
      {membres.map(m => {
        const siens = projets.filter(p => droitDe(d, p.id, m.compte) !== 'aucun');
        const deplie = ouvert === m.compte;
        return (
          <View key={m.compte} style={[styles.carte, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 12) }]} testID={`membre-${m.compte}`}>
            <View style={[styles.ligne, { flexWrap: 'wrap' }]}>
              <Avatar theme={theme} nom={m.nom} couleur={couleurAuteur(a, m.code)} taille={34} />
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={[texteDe(theme), { fontWeight: '700' }]}>{m.nom}</Text>
                <Text style={attenueDe(theme)}>
                  {m.rang === 'gestionnaire' ? 'Gestionnaire' : m.rang === 'administrateur' ? 'Administrateur' : 'Ami'}
                  {m.historique ? ' · depuis la V1' : m.depuis ? ` · invité le ${new Date(m.depuis).toLocaleDateString('fr-FR')}` : ''} · {siens.length} projet{siens.length > 1 ? 's' : ''}
                </Text>
              </View>
              <Bouton theme={theme} compact titre={deplie ? 'Replier' : 'Droits…'} onPress={() => setOuvert(deplie ? undefined : m.compte)} testID={`membre-droits-${m.compte}`} />
              <Bouton theme={theme} compact variante="danger" titre="Retirer…" onPress={() => setRetrait(m.compte)} testID={`membre-retirer-${m.compte}`} />
            </View>
            {!m.historique ? (
              <Bouton
                theme={theme}
                compact={!a.mobile}
                variante="discret"
                style={{ alignSelf: 'flex-start' }}
                titre={`${m.perso ? '☑' : '☐'} Peut créer ses propres projets`}
                libelle={`Peut créer ses propres projets : ${m.perso ? 'oui' : 'non'}`}
                onPress={() => {
                  try {
                    a.etat.maj((x, ctx) => changerPerso(x, m.compte, !m.perso, ctx));
                  } catch (e) {
                    onErreur(e);
                  }
                }}
                testID={`membre-perso-${m.compte}`}
              />
            ) : null}
            {retrait === m.compte ? (
              <View style={{ gap: 8 }}>
                <Text style={texteDe(theme)}>
                  Retirer {m.nom} de Tâches ? Il ne verra plus aucun projet (son dépôt est effacé au prochain tour) ; les clés des {siens.length} projet{siens.length > 1 ? 's' : ''} qu’il voyait changent. Ses commentaires et son temps passés restent.
                </Text>
                <View style={styles.rangee}>
                  <Bouton theme={theme} variante="danger" titre={`Retirer ${m.nom}`} desactive={enCours} onPress={() => agir(() => a.etat.retirer(m.compte), `${m.nom} n’a plus accès à Tâches.`)} testID={`membre-retirer-confirmer-${m.compte}`} />
                  <Bouton theme={theme} titre="Annuler" onPress={() => setRetrait(undefined)} />
                </View>
              </View>
            ) : null}
            {deplie ? (
              projets.length ? (
                projets.map(p => (
                  <View key={p.id} style={[styles.ligne, { flexWrap: 'wrap', paddingLeft: a.mobile ? 0 : 44 }]}>
                    <View style={[styles.point, { backgroundColor: p.couleur }]} />
                    <Text style={[texteDe(theme), { flex: 1, minWidth: 120 }]} numberOfLines={1}>
                      {p.icone ? `${p.icone} ` : ''}
                      {p.nom}
                    </Text>
                    <ChoixDroit a={a} projet={p} membre={m} onErreur={onErreur} />
                  </View>
                ))
              ) : (
                <Text style={attenueDe(theme)}>Aucun projet à partager.</Text>
              )
            ) : null}
          </View>
        );
      })}
      <Libelle theme={theme}>INVITER</Libelle>
      {!invitables.length ? (
        <Text style={attenueDe(theme)}>{comptes.length ? 'Tous les amis et gestionnaires sont déjà membres.' : 'Aucun compte : créez des amis dans l’Administration.'}</Text>
      ) : (
        invitables.map(p => (
          <View key={p.id} style={styles.ligne} testID={`invitable-${p.id}`}>
            <Avatar theme={theme} nom={p.nom} couleur={couleurAuteur(a, p.id)} />
            <Text style={[texteDe(theme), { flex: 1 }]}>
              {p.nom} <Text style={attenueDe(theme)}>· {rangDu(p)}</Text>
            </Text>
            <Bouton theme={theme} compact titre="Inviter" desactive={enCours} onPress={() => agir(() => a.etat.inviter(p.id, p.nom, rangDu(p)), `${p.nom} est invité : choisissez ses projets.`)} testID={`membre-inviter-${p.id}`} />
          </View>
        ))
      )}
    </Dialogue>
  );
}

/** Ce qu'un membre voit de son partage : ses projets, son droit, les personnes de chacun. */
export function ResumePartageMembre({ a }: { a: Actions }) {
  const theme = a.theme;
  const d = a.etat.donnees;
  const projets = projetsDe(d).filter(vivant);
  return (
    <View style={{ gap: 8 }}>
      {projets.map(p => {
        const droit = p.acces?.[a.etat.moi] ?? (p.partage === 'ecriture' ? 'ecriture' : 'lecture');
        return (
          <View key={p.id} style={[styles.ligne, { flexWrap: 'wrap' }]} testID={`mes-droits-${p.id}`}>
            <View style={[styles.point, { backgroundColor: p.couleur }]} />
            <Text style={[texteDe(theme), { flex: 1, minWidth: 120 }]}>{p.nom}</Text>
            <PersonnesProjet a={a} projetId={p.id} taille={24} />
            <Puce theme={theme} texte={LIBELLES_DROIT[droit]} couleur={couleurDroit(a, droit)} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  carte: { borderWidth: 1, padding: 12, gap: 8 },
  point: { width: 10, height: 10, borderRadius: 5 },
});

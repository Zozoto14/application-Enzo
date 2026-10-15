/**
 * « Ta semaine » : le pilote automatique de semaine (module du hub, rempli par
 * l'hôte Tâches). La semaine idéale est rangée par jour, avec la charge de
 * chaque jour ; on déplace un élément par glisser-déposer (souris ou doigt) ou
 * par les boutons ‹ › ✕, on régénère, puis on valide d'un clic : les jours et
 * créneaux des tâches deviennent leurs échéances dans Tâches (annulable).
 * Les épisodes de la soirée ne se « débloquent » qu'à l'écran : l'accès à
 * Tsuzuku n'est jamais bloqué.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { teinteTransparente } from '../../hub/themes';
import { lireReglagesPilote, type BilanJour, type ElementSemaine, type GenreElement, type ReglagesPilote } from '../../hub/pilote/contrats';
import { dureeTexte, JOURS_NOMS, jourCourt, jourSemaine, plageSemaine, septJours } from '../../hub/pilote/jours';
import type { ContexteHub } from '../../hub/types';
import { usePilote, type ControleurPilote } from '../pilote/controleur';
import type { Actions } from './actions';
import { attenueDe, Bouton, Champ, Dialogue, EtatVide, Libelle, Options, PastillePriorite, Puce, texteDe, titreDe } from './atomes';
import { useGlissable, useZoneDepot } from './glisser';

const GENRES: Record<GenreElement, { glyphe: string; nom: string }> = {
  tache: { glyphe: '☑︎', nom: 'Tâche' },
  repetition: { glyphe: '↻', nom: 'Récurrente' },
  relance: { glyphe: '✉︎', nom: 'Relance' },
  paiement: { glyphe: '€', nom: 'Paiement' },
  versement: { glyphe: '↗', nom: 'Versement' },
  dividende: { glyphe: '¤', nom: 'Dividende' },
  episode: { glyphe: '▶', nom: 'Récompense' },
};

const horaire = (e: ElementSemaine) => (e.debut && e.fin ? `${e.debut} – ${e.fin}` : e.jourOff ? 'Sans créneau' : e.genre === 'episode' ? 'Ce soir' : e.surcharge ? 'Pas de place' : 'Toute la journée');

function Interrupteur({ a, texte, detail, actif, onChange, testID }: { a: Actions; texte: string; detail?: string; actif: boolean; onChange(v: boolean): void; testID: string }) {
  const theme = a.theme;
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: actif }} accessibilityLabel={texte} onPress={() => onChange(!actif)} testID={testID} style={[styles.interrupteur, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={texteDe(theme)}>{texte}</Text>
        {detail ? <Text style={attenueDe(theme)}>{detail}</Text> : null}
      </View>
      <View style={[styles.piste, { backgroundColor: actif ? theme.accent : teinteTransparente(theme.attenue, 0.35) }]}>
        <View style={[styles.bouton, { backgroundColor: actif ? theme.surAccent : theme.surface, alignSelf: actif ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Réglages

function DialogueReglages({ a, reglages, onFermer, onEnregistrer }: { a: Actions; reglages: ReglagesPilote; onFermer(): void; onEnregistrer(c: ReglagesPilote): void }) {
  const theme = a.theme;
  const [brouillon, setBrouillon] = useState(reglages);
  const [creneaux, setCreneaux] = useState(() => {
    const c = reglages.creneaux.map(x => ({ ...x }));
    while (c.length < 3) c.push({ debut: '', fin: '' });
    return c;
  });
  const maj = (c: Partial<ReglagesPilote>) => setBrouillon(b => ({ ...b, ...c }));
  const valide = lireReglagesPilote({ ...brouillon, creneaux: creneaux.filter(c => c.debut && c.fin) });
  const creneauxLus = valide.creneaux.length;
  const creneauxSaisis = creneaux.filter(c => c.debut || c.fin).length;
  const erreur = /^([01]\d|2[0-3]):[0-5]\d$/.test(brouillon.heure) ? (creneauxLus === 0 || creneauxLus < creneauxSaisis ? 'Vérifiez les créneaux : « 09:00 » à « 12:00 », sans chevauchement.' : /^([01]\d|2[0-3]):[0-5]\d$/.test(brouillon.soirDebut) ? undefined : 'L’heure de soirée doit être de la forme 20:00.') : 'L’heure de la proposition doit être de la forme 18:00.';
  return (
    <Dialogue
      theme={theme}
      visible
      titre="Réglages de Ta semaine"
      description="Ces réglages restent sur cet appareil. Enregistrer régénère la semaine affichée."
      onFermer={onFermer}
      mobile={a.mobile}
      testID="pilote-reglages"
      large
      pied={
        <View style={styles.rangee}>
          <Bouton theme={theme} titre="Annuler" onPress={onFermer} testID="pilote-reglages-annuler" />
          <Bouton theme={theme} variante="plein" titre="Enregistrer" desactive={Boolean(erreur)} onPress={() => onEnregistrer({ ...valide })} testID="pilote-reglages-enregistrer" />
        </View>
      }>
      <Interrupteur a={a} texte="Proposer ma semaine automatiquement" detail="Notification et écran « Ta semaine »." actif={brouillon.actif} onChange={v => maj({ actif: v })} testID="pilote-r-actif" />
      <Libelle theme={theme}>JOUR DE LA PROPOSITION</Libelle>
      <Options theme={theme} testID="pilote-r-jour" valeur={String(brouillon.jour)} onChoisir={v => maj({ jour: Number(v) })} options={JOURS_NOMS.map((n, i) => ({ valeur: String(i + 1), texte: n.charAt(0).toUpperCase() + n.slice(1) }))} />
      <Libelle theme={theme}>HEURE DE LA PROPOSITION</Libelle>
      <Champ theme={theme} mobile={a.mobile} value={brouillon.heure} onChangeText={t => maj({ heure: t })} placeholder="18:00" accessibilityLabel="Heure de la proposition" testID="pilote-r-heure" />
      <Interrupteur a={a} texte="Me prévenir à cette heure" detail="Pastille de Tâches et notification du système." actif={brouillon.notification} onChange={v => maj({ notification: v })} testID="pilote-r-notification" />
      <Libelle theme={theme}>CRÉNEAUX DE TRAVAIL</Libelle>
      {creneaux.map((c, i) => (
        <View key={i} style={styles.rangee}>
          <Champ theme={theme} mobile={a.mobile} style={{ flex: 1 }} value={c.debut} onChangeText={t => setCreneaux(l => l.map((x, k) => (k === i ? { ...x, debut: t } : x)))} placeholder="09:00" accessibilityLabel={`Créneau ${i + 1}, début`} testID={`pilote-r-debut-${i}`} />
          <Text style={attenueDe(theme)}>à</Text>
          <Champ theme={theme} mobile={a.mobile} style={{ flex: 1 }} value={c.fin} onChangeText={t => setCreneaux(l => l.map((x, k) => (k === i ? { ...x, fin: t } : x)))} placeholder="12:00" accessibilityLabel={`Créneau ${i + 1}, fin`} testID={`pilote-r-fin-${i}`} />
        </View>
      ))}
      <Libelle theme={theme}>CHARGE MAXIMALE PAR JOUR</Libelle>
      <Options theme={theme} testID="pilote-r-charge" valeur={String(brouillon.chargeMax)} onChoisir={v => maj({ chargeMax: Number(v) })} options={[180, 240, 300, 360, 420, 480].map(m => ({ valeur: String(m), texte: dureeTexte(m) }))} />
      <Libelle theme={theme}>JOURS SANS TRAVAIL</Libelle>
      <Options
        theme={theme}
        multiple
        testID="pilote-r-off"
        valeur={brouillon.joursOff.map(String)}
        onChoisir={v => maj({ joursOff: brouillon.joursOff.includes(Number(v)) ? brouillon.joursOff.filter(j => j !== Number(v)) : [...brouillon.joursOff, Number(v)].sort() })}
        options={JOURS_NOMS.map((n, i) => ({ valeur: String(i + 1), texte: n.charAt(0).toUpperCase() + n.slice(1) }))}
      />
      <Interrupteur a={a} texte="Épisodes en récompense" detail="Le soir des jours de travail, sans jamais bloquer Tsuzuku." actif={brouillon.recompenses} onChange={v => maj({ recompenses: v })} testID="pilote-r-recompenses" />
      {brouillon.recompenses ? (
        <>
          <Libelle theme={theme}>ÉPISODES AU PLUS PAR SOIRÉE</Libelle>
          <Options theme={theme} testID="pilote-r-episodes" valeur={String(brouillon.episodesParJour)} onChoisir={v => maj({ episodesParJour: Number(v) })} options={[1, 2, 3, 4].map(n => ({ valeur: String(n), texte: String(n) }))} />
          <Libelle theme={theme}>SOIRÉE À PARTIR DE</Libelle>
          <Champ theme={theme} mobile={a.mobile} value={brouillon.soirDebut} onChangeText={t => maj({ soirDebut: t })} placeholder="20:00" accessibilityLabel="Début de la soirée" testID="pilote-r-soir" />
        </>
      ) : null}
      <Interrupteur a={a} texte="Versement mensuel et dividendes du Portefeuille" actif={brouillon.portefeuille} onChange={v => maj({ portefeuille: v })} testID="pilote-r-portefeuille" />
      {erreur ? (
        <Text accessibilityRole="alert" style={[texteDe(theme), { color: theme.critique }]} testID="pilote-r-erreur">
          {erreur}
        </Text>
      ) : null}
    </Dialogue>
  );
}

// ------------------------------------------------------------------ Éléments

function Carte({ a, c, e, editable, onOuvrirApp }: { a: Actions; c: ControleurPilote; e: ElementSemaine; editable: boolean; onOuvrirApp?: (id: string) => void }) {
  const theme = a.theme;
  const g = GENRES[e.genre];
  const rec = e.genre === 'episode' ? c.recompenses[e.id] : undefined;
  const couleur = e.genre === 'episode' ? theme.teintes.anime : e.genre === 'tache' || e.genre === 'repetition' ? theme.accent : theme.alerte;
  const { ref, glisse } = useGlissable({ actif: editable && !a.mobile, onDeposer: zone => zone.startsWith('pilote:') && c.deplacer(e.id, zone.slice(7)) });
  const verrou = rec && !rec.debloque;
  const tache = e.genre === 'tache' ? a.etat.donnees.taches[e.refId] : undefined;
  return (
    <View
      ref={ref as never}
      testID={`pilote-element-${e.id}`}
      style={[
        styles.carte,
        a.mobile ? { width: '100%' } : { flexBasis: 270, flexGrow: 1, maxWidth: 440 },
        { borderColor: glisse ? theme.accent : e.surcharge ? theme.critique : theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12), borderLeftColor: couleur, borderLeftWidth: 4, opacity: verrou ? 0.92 : 1 },
      ]}>
      <View style={styles.rangee}>
        <Text style={[texteDe(theme), { fontWeight: '800', color: theme.texte }]} testID={`pilote-heure-${e.id}`}>
          {horaire(e)}
        </Text>
        <Text style={[attenueDe(theme), { flex: 1 }]} numberOfLines={1}>
          {g.glyphe} {g.nom} · {dureeTexte(e.dureeMin)}
        </Text>
      </View>
      <Pressable accessibilityRole={tache ? 'button' : undefined} disabled={!tache} onPress={() => a.ouvrir(e.refId)} accessibilityLabel={tache ? `Ouvrir la tâche ${e.titre}` : e.titre} style={tache ? styles.titreTouchable : undefined}>
        <Text numberOfLines={3} style={[texteDe(theme, 16), { fontWeight: '700' }]}>
          {e.titre}
        </Text>
      </Pressable>
      <View style={styles.rangee}>
        {e.priorite && e.priorite !== 'normale' && (e.genre === 'tache' || e.genre === 'repetition') ? <PastillePriorite theme={theme} priorite={e.priorite} compacte /> : null}
        {e.detail ? (
          <Text style={attenueDe(theme)} numberOfLines={1}>
            {e.detail}
          </Text>
        ) : null}
        {e.echeance && (e.genre === 'tache' || e.genre === 'repetition') ? <Text style={[attenueDe(theme), e.apresEcheance ? { color: theme.critique } : null]}>Pour le {jourCourt(e.echeance)}</Text> : null}
        {e.genre === 'tache' && c.faites.has(e.refId) ? <Puce theme={theme} texte="✓ Faite" couleur={theme.ok} /> : null}
        {e.retard ? <Puce theme={theme} texte="En retard" couleur={theme.critique} /> : null}
        {e.surcharge ? <Puce theme={theme} texte="Trop chargé" couleur={theme.critique} /> : null}
        {e.jourOff && !e.surcharge ? <Puce theme={theme} texte="Jour sans travail" couleur={theme.alerte} /> : null}
        {e.plafonnee ? <Puce theme={theme} texte="Durée plafonnée" couleur={theme.attenue} /> : null}
      </View>
      {rec ? (
        <View style={[styles.rangee, { alignItems: 'center' }]}>
          <Text style={[texteDe(theme), { color: rec.debloque ? theme.ok : theme.attenue, fontWeight: '700', flex: 1 }]} testID={`pilote-recompense-${e.id}`}>
            {rec.debloque ? '✓ Débloqué : bon visionnage' : `🔒 Se débloque quand tes tâches du jour sont faites (${rec.restant} restante${rec.restant > 1 ? 's' : ''})`}
          </Text>
          {onOuvrirApp ? <Bouton theme={theme} titre="▶ Tsuzuku" libelle={rec.debloque ? 'Ouvrir Tsuzuku' : 'Ouvrir Tsuzuku quand même (jamais bloqué)'} onPress={() => onOuvrirApp('tsuzuku')} testID={`pilote-tsuzuku-${e.id}`} /> : null}
        </View>
      ) : null}
      {editable ? (
        <View style={[styles.rangee, styles.actions]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Jour précédent : ${e.titre}`} onPress={() => c.decaler(e.id, -1)} testID={`pilote-avant-${e.id}`} style={[styles.petit, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
            <Text style={{ color: theme.texte, fontSize: 18, fontWeight: '700' }}>‹</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Jour suivant : ${e.titre}`} onPress={() => c.decaler(e.id, 1)} testID={`pilote-apres-${e.id}`} style={[styles.petit, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
            <Text style={{ color: theme.texte, fontSize: 18, fontWeight: '700' }}>›</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Retirer de la semaine : ${e.titre}`} onPress={() => c.retirer(e.id)} testID={`pilote-retirer-${e.id}`} style={[styles.petit, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10) }]}>
            <Text style={{ color: theme.critique, fontSize: 16, fontWeight: '800' }}>✕</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function BarreCharge({ a, b }: { a: Actions; b: BilanJour }) {
  const theme = a.theme;
  const pct = b.capacite ? Math.min(100, Math.round((b.charge / b.capacite) * 100)) : b.charge ? 100 : 0;
  return (
    <View accessibilityLabel={b.off ? 'Jour sans travail' : `Charge : ${dureeTexte(b.charge)} sur ${dureeTexte(b.capacite)}`} style={{ gap: 4, minWidth: 130 }}>
      <Text style={[attenueDe(theme), b.depasse ? { color: theme.critique, fontWeight: '700' } : null]} testID={`pilote-charge-${b.jour}`}>
        {b.off ? (b.charge ? `${dureeTexte(b.charge)} (jour off)` : 'Jour sans travail') : `${dureeTexte(b.charge)} / ${dureeTexte(b.capacite)}`}
      </Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: teinteTransparente(theme.attenue, 0.18), overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: b.depasse ? theme.critique : theme.accent }} />
      </View>
    </View>
  );
}

function Jour({ a, c, b, editable, onOuvrirApp }: { a: Actions; c: ControleurPilote; b: BilanJour; editable: boolean; onOuvrirApp?: (id: string) => void }) {
  const theme = a.theme;
  const zone = useZoneDepot(`pilote:${b.jour}`);
  const elements = c.semaine.elements.filter(e => e.jour === b.jour);
  const nom = JOURS_NOMS[jourSemaine(b.jour) - 1];
  const auj = b.jour === a.etat.aujourdhui;
  return (
    <View
      ref={zone.ref as never}
      testID={`pilote-jour-${b.jour}`}
      style={[styles.jour, { borderColor: zone.survolee ? theme.accent : theme.ligne, backgroundColor: zone.survolee ? teinteTransparente(theme.accent, 0.12) : b.off ? teinteTransparente(theme.sombre ? '#FFFFFF' : '#000000', 0.03) : 'transparent', borderRadius: Math.min(theme.rayonMoyen, 14) }]}>
      <View style={[styles.rangee, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text accessibilityRole="header" style={[titreDe(theme, 17), auj ? { color: theme.accent } : null]}>
          {nom.charAt(0).toUpperCase() + nom.slice(1)} {jourCourt(b.jour)}
          {auj ? ' · aujourd’hui' : ''}
        </Text>
        <BarreCharge a={a} b={b} />
      </View>
      {elements.length === 0 ? (
        <Text style={attenueDe(theme)} testID={`pilote-vide-${b.jour}`}>
          {editable ? 'Rien de prévu. Glissez un élément ici.' : 'Rien de prévu.'}
        </Text>
      ) : (
        <View style={[styles.cartes]}>
          {elements.map(e => (
            <Carte key={e.id} a={a} c={c} e={e} editable={editable} onOuvrirApp={onOuvrirApp} />
          ))}
        </View>
      )}
    </View>
  );
}

function ListeAArbitrer({ a, c, titre, elements, testID, editable }: { a: Actions; c: ControleurPilote; titre: string; elements: readonly ElementSemaine[]; testID: string; editable: boolean }) {
  const theme = a.theme;
  if (elements.length === 0) return null;
  const jours = septJours(c.lundi);
  return (
    <View style={[styles.jour, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 14) }]} testID={testID}>
      <Text accessibilityRole="header" style={titreDe(theme, 17)}>
        {titre}
      </Text>
      {elements.map(e => (
        <View key={e.id} style={[styles.carte, { borderColor: theme.ligne, backgroundColor: theme.surface, borderRadius: Math.min(theme.rayonMoyen, 12) }]} testID={`pilote-arbitrer-${e.id}`}>
          <Text style={[texteDe(theme, 16), { fontWeight: '700' }]}>{e.titre}</Text>
          <Text style={attenueDe(theme)}>
            {GENRES[e.genre].nom} · {dureeTexte(e.dureeMin)}
            {e.echeance ? ` · pour le ${jourCourt(e.echeance)}` : ''}
            {e.raison === 'charge' ? ' · pas assez de place avant l’échéance' : e.raison === 'jours-off' ? ' · tombe un jour sans travail' : ''}
          </Text>
          {editable ? (
            <View style={styles.rangee}>
              <Text style={attenueDe(theme)}>{e.raison === 'retire' ? 'Remettre :' : 'Placer le :'}</Text>
              {jours.map(j => (
                <Pressable key={j} accessibilityRole="button" accessibilityLabel={`Placer « ${e.titre} » le ${JOURS_NOMS[jourSemaine(j) - 1]}`} onPress={() => c.deplacer(e.id, j)} testID={`pilote-placer-${e.id}-${j}`} style={[styles.petit, { borderColor: theme.ligne, borderRadius: Math.min(theme.rayonMoyen, 10), paddingHorizontal: 8, width: undefined, minWidth: 44 }]}>
                  <Text style={texteDe(theme)}>{JOURS_NOMS[jourSemaine(j) - 1].slice(0, 3)}.</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ Écran

export function VuePilote({ a, contexte, onOuvrirApp }: { a: Actions; contexte: Pick<ContexteHub, 'profil' | 'profils' | 'admin' | 'portefeuille' | 'baseProfil'>; onOuvrirApp?: (id: string) => void }) {
  const theme = a.theme;
  const c = usePilote(contexte, a.etat);
  const [reglages, setReglages] = useState(false);
  const valide = c.valide;
  const editable = !valide && !c.horsPartage;
  const r = c.resume;
  const total = r.taches + r.repetitions + r.relances + r.paiements + r.portefeuille + r.episodes;
  if (c.horsPartage) {
    return (
      <EtatVide theme={theme} testID="pilote-hors-partage" titre="Ta semaine planifie les projets partagés avec toi" texte="Tu regardes tes projets personnels. Reviens aux projets partagés pour préparer ta semaine.">
        <Bouton theme={theme} variante="plein" titre="Projets partagés avec moi" onPress={() => a.etat.changerSource('partage')} testID="pilote-vers-partage" />
      </EtatVide>
    );
  }
  const resumeTexte = [
    r.taches + r.repetitions > 0 ? `${r.taches + r.repetitions} tâche${r.taches + r.repetitions > 1 ? 's' : ''} (${dureeTexte(r.minutesTravail)})` : '',
    r.relances > 0 ? `${r.relances} relance${r.relances > 1 ? 's' : ''}` : '',
    r.paiements > 0 ? `${r.paiements} paiement${r.paiements > 1 ? 's' : ''}` : '',
    r.portefeuille > 0 ? `${r.portefeuille} du portefeuille` : '',
    r.episodes > 0 ? `${r.episodes} épisode${r.episodes > 1 ? 's' : ''} en récompense` : '',
  ].filter(Boolean);
  return (
    <View testID="vue-pilote" style={{ gap: 14 }}>
      <View style={[styles.rangee, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
          <Text accessibilityRole="header" style={titreDe(theme, 22)}>
            Ta semaine
          </Text>
          <Text style={texteDe(theme, 16)} testID="pilote-plage">
            Semaine du {plageSemaine(c.lundi)}
          </Text>
          <View style={styles.rangee}>
            <Puce theme={theme} texte={valide ? '✓ Validée' : 'Proposition à valider'} couleur={valide ? theme.ok : theme.accent} testID="pilote-etat" />
            {valide ? <Text style={attenueDe(theme)}>dans Tâches, {valide.annulation.length} échéance{valide.annulation.length > 1 ? 's' : ''} posée{valide.annulation.length > 1 ? 's' : ''}</Text> : null}
          </View>
        </View>
        <View style={[styles.rangee, a.mobile && { width: '100%' }]}>
          {valide ? (
            <Bouton theme={theme} titre="Annuler la validation" onPress={c.annuler} testID="pilote-annuler" />
          ) : (
            <>
              <Bouton theme={theme} titre="Régénérer" libelle="Régénérer la semaine" onPress={c.regenerer} testID="pilote-regenerer" />
              <Bouton theme={theme} variante="plein" titre="Tout valider" libelle="Tout valider : appliquer les jours et créneaux dans Tâches" onPress={c.valider} testID="pilote-valider" desactive={r.taches === 0 && total === 0} />
            </>
          )}
          <Bouton theme={theme} titre="⚙︎ Réglages" libelle="Réglages de Ta semaine" onPress={() => setReglages(true)} testID="pilote-reglages-ouvrir" />
        </View>
      </View>
      {c.avis ? (
        <Text accessibilityRole="alert" style={[texteDe(theme), { color: theme.ok, fontWeight: '600' }]} testID="pilote-avis">
          {c.avis}
        </Text>
      ) : null}
      <Text style={attenueDe(theme)} testID="pilote-resume">
        {resumeTexte.length ? `${resumeTexte.join(' · ')}.` : 'Rien à planifier pour cette semaine.'}
        {valide ? '' : ' Glissez un élément sur un autre jour, ou utilisez ‹ › ✕ ; rien n’est appliqué avant « Tout valider ».'}
      </Text>
      {total === 0 && c.semaine.nonPlaces.length === 0 && c.semaine.retires.length === 0 ? (
        <EtatVide theme={theme} testID="pilote-vide" titre="Semaine libre" texte="Aucune tâche à vous, relance ou paiement n’est prévu cette semaine. Ajoutez des tâches avec une échéance ou une priorité haute, puis régénérez.">
          <Bouton theme={theme} titre="Régénérer" onPress={c.regenerer} testID="pilote-regenerer-vide" />
        </EtatVide>
      ) : null}
      {c.bilans.map(b => (
        <Jour key={b.jour} a={a} c={c} b={b} editable={editable} onOuvrirApp={onOuvrirApp} />
      ))}
      <ListeAArbitrer a={a} c={c} titre="À arbitrer : pas de place" elements={c.semaine.nonPlaces} testID="pilote-non-places" editable={editable} />
      <ListeAArbitrer a={a} c={c} titre="Retirés de la semaine" elements={c.semaine.retires} testID="pilote-retires" editable={editable} />
      {reglages ? (
        <DialogueReglages
          a={a}
          reglages={c.reglages}
          onFermer={() => setReglages(false)}
          onEnregistrer={n => {
            c.changerReglages(n);
            setReglages(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rangee: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  jour: { borderWidth: 1, padding: 12, gap: 10 },
  cartes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  carte: { borderWidth: 1, padding: 12, gap: 8 },
  actions: { justifyContent: 'flex-end', marginTop: 'auto' },
  titreTouchable: { minHeight: 44, justifyContent: 'center' },
  petit: { minWidth: 44, minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', width: 44 },
  interrupteur: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, padding: 12, minHeight: 56 },
  piste: { width: 46, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  bouton: { width: 20, height: 20, borderRadius: 10 },
});

/**
 * Support : écrire à l'équipe depuis l'application.
 *
 * Le ticket part vers le relais, qui le poste sur un salon Discord (l'adresse
 * du webhook n'est jamais dans l'application). « Mes tickets » garde l'historique
 * dans le profil chiffré : numéro, date, état (envoyé, erreur, en attente hors
 * ligne avec renvoi automatique). Accessible depuis le hub, depuis toutes les
 * pages d'app (bouton « Support ») et depuis Paramètres › Support.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SelecteurCapture } from '../support/SelecteurCapture';
import type { ServiceSupport } from '../support/service';
import {
  CATEGORIES_TICKET,
  LIBELLES_STATUT,
  TAILLE_MAX_MESSAGE,
  TAILLE_MAX_SUJET,
  erreurFormulaire,
  type CategorieTicket,
  type InfosTechniques,
  type PieceJointe,
  type Ticket,
} from '../support/tickets';
import { BoutonHub } from './Hub';
import { police, type ThemeHub } from './themes';
import { ecouterTouche } from './web';

const libelleCategorie = (id: CategorieTicket) => CATEGORIES_TICKET.find(c => c.id === id)?.libelle ?? id;

function dateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface PropsFormulaireSupport {
  theme: ThemeHub;
  service?: ServiceSupport;
  /** Ce qui partirait avec « Inclure les informations techniques ». */
  infos: InfosTechniques;
  /** Catégorie proposée au départ. */
  categorieInitiale?: CategorieTicket;
}

export function FormulaireSupport({ theme, service, infos, categorieInitiale = 'question' }: PropsFormulaireSupport) {
  const [categorie, setCategorie] = useState<CategorieTicket>(categorieInitiale);
  const [sujet, setSujet] = useState('');
  const [message, setMessage] = useState('');
  const [technique, setTechnique] = useState(true);
  const [piece, setPiece] = useState<PieceJointe | undefined>();
  const [cleSelecteur, setCleSelecteur] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [retour, setRetour] = useState<{ genre: 'ok' | 'attente' | 'erreur'; texte: string } | undefined>();
  const rayon = Math.min(theme.rayonMoyen, 10);
  const texte = { color: theme.texte, ...police(theme.policeTexte) };
  const attenue = { color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) };
  const champ = [styles.champ, texte, { borderColor: theme.ligne, backgroundColor: theme.fond, borderRadius: rayon }];

  const envoyer = async () => {
    if (!service) return;
    const invalide = erreurFormulaire({ categorie, sujet, message, piece });
    if (invalide) {
      setRetour({ genre: 'erreur', texte: invalide });
      return;
    }
    setEnvoi(true);
    setRetour(undefined);
    try {
      const ticket = await service.creer({ categorie, sujet, message, inclureTechnique: technique, piece });
      if (ticket.statut === 'envoye') {
        setRetour({ genre: 'ok', texte: `Ticket n° ${ticket.numero} envoyé. Merci : nous le lisons dès que possible.` });
        setSujet('');
        setMessage('');
        setPiece(undefined);
        setCleSelecteur(n => n + 1);
      } else if (ticket.statut === 'attente') {
        setRetour({ genre: 'attente', texte: `Ticket n° ${ticket.numero} enregistré : ${ticket.erreur ?? 'il partira dès que possible.'}` });
        setSujet('');
        setMessage('');
        setPiece(undefined);
        setCleSelecteur(n => n + 1);
      } else {
        setRetour({ genre: 'erreur', texte: `Ticket n° ${ticket.numero} non envoyé : ${ticket.erreur ?? 'erreur inconnue'} Vous pourrez le renvoyer depuis « Mes tickets ».` });
      }
    } catch (e) {
      setRetour({ genre: 'erreur', texte: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <View style={{ gap: 12 }} testID="support-formulaire">
      <Text style={attenue}>
        Un bug, une question, une idée ? Votre message arrive sur le salon de l’équipe. Ne mettez jamais de mot de passe, de code ni de clé dans un ticket.
      </Text>
      <View style={[styles.segments, { borderColor: theme.ligne, borderRadius: rayon }]} accessibilityRole="radiogroup" accessibilityLabel="Catégorie du ticket">
        {CATEGORIES_TICKET.map(c => {
          const actif = c.id === categorie;
          return (
            <Pressable
              key={c.id}
              testID={`support-categorie-${c.id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: actif }}
              aria-checked={actif}
              accessibilityLabel={`Catégorie : ${c.libelle}`}
              onPress={() => setCategorie(c.id)}
              style={[styles.segment, { backgroundColor: actif ? theme.accent : 'transparent' }]}>
              <Text style={{ color: actif ? theme.surAccent : theme.texte, fontWeight: '600', fontSize: 13, ...police(theme.policeTexte) }}>{c.libelle}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Sujet</Text>
        <TextInput testID="support-sujet" accessibilityLabel="Sujet du ticket" value={sujet} onChangeText={setSujet} maxLength={TAILLE_MAX_SUJET} placeholder="En quelques mots" placeholderTextColor={theme.attenue} style={champ as never} />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Message</Text>
        <TextInput
          testID="support-message"
          accessibilityLabel="Message du ticket"
          value={message}
          onChangeText={setMessage}
          maxLength={TAILLE_MAX_MESSAGE}
          multiline
          numberOfLines={6}
          placeholder="Que s’est-il passé ? Que faisiez-vous ? Qu’attendiez-vous ?"
          placeholderTextColor={theme.attenue}
          style={[...champ, { minHeight: 120, textAlignVertical: 'top' }] as never}
        />
        <Text style={[attenue, { fontSize: 12 }]}>
          {message.length} / {TAILLE_MAX_MESSAGE}
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={[texte, { fontWeight: '600', fontSize: 13 }]}>Capture d’écran (facultatif)</Text>
        <SelecteurCapture key={cleSelecteur} couleur={theme.texte} onChoisir={setPiece} onErreur={m => setRetour({ genre: 'erreur', texte: m })} />
        {piece ? (
          <Text style={attenue} testID="support-capture-nom">
            Jointe : {piece.nom}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID="support-technique"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: technique }}
        aria-checked={technique}
        onPress={() => setTechnique(v => !v)}
        style={styles.ligneCase}>
        <View style={[styles.case, { borderColor: technique ? theme.accent : theme.ligne, backgroundColor: technique ? theme.accent : 'transparent' }]}>
          {technique ? <Text style={{ color: theme.surAccent, fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
        </View>
        <Text style={[texte, { flex: 1, fontSize: 14 }]}>Inclure les informations techniques</Text>
      </Pressable>
      <Text style={attenue} testID="support-technique-detail">
        {technique
          ? `Jointes : version ${infos.version}, plateforme ${infos.plateforme}, rang ${infos.rang}${infos.compte ? `, compte ${infos.compte}…` : ''}. Jamais de mot de passe ni de clé.`
          : 'Aucune information technique ne sera jointe.'}
      </Text>
      <View style={styles.actions}>
        <BoutonHub theme={theme} variante="plein" titre={envoi ? 'Envoi…' : 'Envoyer le ticket'} desactive={envoi || !service} onPress={() => void envoyer()} testID="support-envoyer" />
      </View>
      {retour ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="support-resultat"
          style={{ color: retour.genre === 'ok' ? theme.ok : retour.genre === 'attente' ? theme.alerte : theme.critique, fontSize: 13, lineHeight: 19 }}>
          {retour.texte}
        </Text>
      ) : null}
    </View>
  );
}

export function MesTickets({ theme, tickets, service }: { theme: ThemeHub; tickets: readonly Ticket[]; service?: ServiceSupport }) {
  const rayon = Math.min(theme.rayonMoyen, 10);
  const attenue = { color: theme.attenue, fontSize: 13, lineHeight: 19, ...police(theme.policeTexte) };
  if (tickets.length === 0) {
    return (
      <Text style={attenue} testID="support-aucun-ticket">
        Aucun ticket pour l’instant. Ceux que vous envoyez apparaissent ici, avec leur état.
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }} testID="support-tickets">
      {tickets.map(t => {
        const couleur = t.statut === 'envoye' ? theme.ok : t.statut === 'attente' ? theme.alerte : theme.critique;
        return (
          <View key={t.numero} testID={`support-ticket-${t.numero}`} style={[styles.ticket, { borderColor: theme.ligne, borderRadius: rayon }]}>
            <View style={styles.enteteTicket}>
              <Text style={{ color: theme.texte, fontWeight: '700', fontSize: 14, flex: 1, ...police(theme.policeTexte) }} numberOfLines={2}>
                n° {t.numero} · {t.sujet}
              </Text>
              <Text style={{ color: couleur, fontWeight: '700', fontSize: 12 }} testID={`support-ticket-${t.numero}-statut`}>
                {LIBELLES_STATUT[t.statut]}
              </Text>
            </View>
            <Text style={attenue}>
              {libelleCategorie(t.categorie)} · {dateCourte(t.date)}
              {t.pieceNom ? ` · capture : ${t.pieceNom}` : ''}
            </Text>
            {t.statut !== 'envoye' && t.erreur ? <Text style={{ color: couleur, fontSize: 12, lineHeight: 17 }}>{t.erreur}</Text> : null}
            <View style={styles.actions}>
              {t.statut === 'erreur' ? <BoutonHub theme={theme} titre="Réessayer" onPress={() => void service?.reessayer(t.numero)} testID={`support-ticket-${t.numero}-reessayer`} /> : null}
              {t.statut === 'attente' ? <BoutonHub theme={theme} titre="Envoyer maintenant" onPress={() => void service?.envoyer(t.numero)} testID={`support-ticket-${t.numero}-envoyer`} /> : null}
              {t.statut !== 'attente' ? <BoutonHub theme={theme} titre="Retirer de la liste" onPress={() => service?.supprimer(t.numero)} testID={`support-ticket-${t.numero}-retirer`} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export interface PropsPageSupport extends PropsFormulaireSupport {
  tickets: readonly Ticket[];
  actif?: boolean;
  onFermer(): void;
}

/** La page Support : formulaire puis « Mes tickets ». */
export function PageSupport({ theme, service, infos, tickets, actif = true, onFermer, categorieInitiale }: PropsPageSupport) {
  useEffect(() => (actif ? ecouterTouche('Escape', onFermer) : undefined), [actif, onFermer]);
  const titre = { color: theme.texte, fontWeight: theme.poidsTitre, textTransform: theme.majuscules ? ('uppercase' as const) : ('none' as const), ...police(theme.policeTitre) };
  const carte = [styles.carte, { backgroundColor: theme.surface, borderColor: theme.ligne, borderRadius: theme.rayonMoyen }];
  return (
    <View style={[styles.racine, { backgroundColor: theme.fond }]} testID="hub-support" accessibilityLabel="Support">
      <View style={styles.page}>
        <View style={styles.entete}>
          <BoutonHub theme={theme} titre="← Retour" libelle="Fermer le support (Échap)" onPress={onFermer} testID="hub-support-fermer" />
          <Text style={[titre, { fontSize: 28, flex: 1 }]} accessibilityRole="header">
            Support
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <View style={carte}>
            <Text style={[titre, { fontSize: 17 }]} accessibilityRole="header">
              Nouveau ticket
            </Text>
            <FormulaireSupport theme={theme} service={service} infos={infos} categorieInitiale={categorieInitiale} />
          </View>
          <View style={carte}>
            <Text style={[titre, { fontSize: 17 }]} accessibilityRole="header">
              Mes tickets
            </Text>
            <MesTickets theme={theme} tickets={tickets} service={service} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 20, gap: 14 },
  entete: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  carte: { borderWidth: 1, padding: 16, gap: 10 },
  champ: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  segments: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' },
  segment: { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  ligneCase: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  case: { width: 22, height: 22, borderWidth: 2, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  ticket: { borderWidth: 1, padding: 12, gap: 6 },
  enteteTicket: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});

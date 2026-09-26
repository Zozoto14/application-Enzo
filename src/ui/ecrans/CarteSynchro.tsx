/**
 * Paramètres › Synchronisation entre appareils.
 *
 * Relie cet appareil au relais (code de liaison + mot de passe de
 * synchronisation), montre les autres appareils — dont la date d'expiration
 * de l'app iPhone installée par AltStore — et affiche le QR code qui relie
 * un nouvel appareil d'un coup d'appareil photo.
 */

import qrcode from 'qrcode-generator';
import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Alerte, Bouton, Carte, Champ, SousTitre, Titre, usePalette } from '../composants';
import { ESPACEMENT, RAYON } from '../theme';
import type { EtatSynchroApp } from '../../app/synchroApp';
import { joursRestants } from '../../natif/signature';
import { encoderLiaison, lienApp, lienSite, type Liaison } from '../../sync/relais/liaison';

export interface CarteSynchroProps {
  synchro: EtatSynchroApp;
  /** Relais déjà connu (script du PC, lien scanné) : proposé sans rien saisir. */
  liaisonDuPc?: Liaison;
  nomParDefaut: string;
  onRelier(code: string, motDePasse: string, nom: string): Promise<void>;
  onSynchroniser(): void;
  onDelier(): void;
  onOublier(appareil: string): void;
  /** Horloge, remplaçable dans les tests. */
  maintenant?: Date;
}

const EMOJI: Record<string, string> = { bureau: '💻', ios: '📱', site: '🌐', android: '📱' };

function ilYA(iso: string, maintenant: Date): string {
  const minutes = Math.round((maintenant.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 48) return `il y a ${heures} h`;
  return `il y a ${Math.round(heures / 24)} jours`;
}

function QrCode({ texte, legende, testID }: { texte: string; legende: string; testID: string }) {
  const uri = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(texte);
    qr.make();
    return qr.createDataURL(4, 3);
  }, [texte]);
  return (
    <View style={styles.qr} testID={testID}>
      <Image source={{ uri }} style={styles.imageQr} accessibilityLabel={legende} />
      <Text style={{ color: '#111', fontWeight: '600', textAlign: 'center', maxWidth: 200 }}>{legende}</Text>
    </View>
  );
}

export function Expiration({ expireLe, maintenant }: { expireLe: string; maintenant: Date }) {
  const palette = usePalette();
  const jours = joursRestants(expireLe, maintenant);
  const date = new Date(expireLe).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (jours < 0) {
    return (
      <Text style={{ color: palette.baisse, fontWeight: '700' }}>
        ⛔ Signature expirée le {date} : passez sur le Wi-Fi du PC pour qu’AltStore la renouvelle.
      </Text>
    );
  }
  return (
    <Text style={{ color: jours <= 2 ? palette.baisse : palette.texteSecondaire, fontWeight: jours <= 2 ? '700' : '400' }}>
      {jours <= 2 ? '⚠️ ' : ''}Expire {jours === 0 ? 'aujourd’hui' : jours === 1 ? 'demain' : `dans ${jours} jours`} ({date})
    </Text>
  );
}

export function CarteSynchro({
  synchro,
  liaisonDuPc,
  nomParDefaut,
  onRelier,
  onSynchroniser,
  onDelier,
  onOublier,
  maintenant = new Date(),
}: CarteSynchroProps) {
  const palette = usePalette();
  const [code, setCode] = useState('');
  const [nom, setNom] = useState(nomParDefaut);
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [montrerCodes, setMontrerCodes] = useState(false);

  const codeUtilise = code.trim() || (liaisonDuPc ? encoderLiaison(liaisonDuPc) : '');

  if (!synchro.configure) {
    const relier = () => {
      if (motDePasse !== confirmation) {
        setErreur('Les deux mots de passe ne sont pas identiques.');
        return;
      }
      setErreur(undefined);
      setEnCours(true);
      onRelier(codeUtilise, motDePasse, nom)
        .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
        .finally(() => setEnCours(false));
    };
    return (
      <>
        <Titre>Synchronisation entre appareils</Titre>
        <Carte testID="carte-synchro">
          <SousTitre>
            Le PC, l’iPhone et le site de secours partagent le même portefeuille. Tout est chiffré sur l’appareil
            avant de partir : le relais ne voit que du bruit. Le mot de passe de synchronisation doit être le même
            partout, et n’est enregistré nulle part.
          </SousTitre>
          {liaisonDuPc ? (
            <Text style={{ color: palette.hausse, fontWeight: '600' }} testID="relais-du-pc">
              ✅ Relais reconnu : rien à recopier.
            </Text>
          ) : (
            <Champ
              etiquette="Code de liaison"
              indication="Affiché sur le PC, dans Paramètres › Synchronisation. Il commence par AB1."
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              testID="champ-liaison"
            />
          )}
          <Champ etiquette="Nom de cet appareil" value={nom} onChangeText={setNom} testID="champ-nom-appareil" />
          <Champ
            etiquette="Mot de passe de synchronisation"
            indication="Au moins 8 caractères. Différent de celui qui ouvre l’application, c’est mieux."
            value={motDePasse}
            onChangeText={setMotDePasse}
            secureTextEntry
            testID="champ-mdp-synchro"
          />
          <Champ
            etiquette="Confirmation"
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            testID="champ-mdp-synchro-confirmation"
          />
          {erreur ? <Alerte message={erreur} /> : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <Bouton
              titre={enCours ? 'Liaison…' : 'Relier cet appareil'}
              desactive={enCours || !codeUtilise || motDePasse.length === 0}
              onPress={relier}
              testID="bouton-relier"
            />
          </View>
          {!liaisonDuPc && !code ? (
            <SousTitre>
              Pas encore de relais ? Sur le PC, dans le dossier d’AppliBourse, lancez « npm run relais:deployer ».
              Le guide pas à pas est dans docs/iphone.md.
            </SousTitre>
          ) : null}
        </Carte>
      </>
    );
  }

  const autres = Object.entries(synchro.appareils).filter(([id]) => id !== synchro.moi);
  const liaison = synchro.liaison;
  return (
    <>
      <Titre>Synchronisation entre appareils</Titre>
      <Carte testID="carte-synchro">
        <Text style={{ color: palette.texte, fontWeight: '700' }}>
          {EMOJI[synchro.plateforme ?? ''] ?? '🔗'} {synchro.nom} · relié
        </Text>
        <SousTitre>
          {synchro.enCours
            ? 'Synchronisation en cours…'
            : synchro.derniere
              ? `Dernière synchronisation ${ilYA(synchro.derniere, maintenant)}. Automatique toutes les 2 minutes.`
              : 'Première synchronisation en attente.'}
        </SousTitre>
        {synchro.expireLe ? <Expiration expireLe={synchro.expireLe} maintenant={maintenant} /> : null}
        {synchro.message ? <Text style={{ color: palette.texte }}>{synchro.message}</Text> : null}
        {synchro.maj ? (
          <Text style={{ color: palette.accent, fontWeight: '600' }} testID="maj-telechargee">
            {synchro.maj}
          </Text>
        ) : null}
        {synchro.erreur ? <Alerte message={synchro.erreur} /> : null}
        <View style={styles.boutons}>
          <Bouton
            titre="Synchroniser maintenant"
            desactive={synchro.enCours}
            onPress={onSynchroniser}
            testID="bouton-synchroniser"
          />
          <Bouton titre={montrerCodes ? 'Masquer le code' : 'Relier un autre appareil'} variante="discret" onPress={() => setMontrerCodes(!montrerCodes)} testID="bouton-montrer-liaison" />
        </View>

        <Text style={{ color: palette.texte, fontWeight: '700', marginTop: ESPACEMENT.s }}>Autres appareils</Text>
        {autres.length === 0 ? (
          <SousTitre>Aucun pour l’instant : reliez l’iPhone avec le QR code ci-dessous.</SousTitre>
        ) : null}
        {autres.map(([id, appareil]) => (
          <View key={id} style={[styles.appareil, { borderColor: palette.bordure }]} testID={`appareil-${id}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: palette.texte, fontWeight: '600' }}>
                {EMOJI[appareil.plateforme] ?? '🔗'} {appareil.nom || 'Appareil'}
              </Text>
              {appareil.vuLe ? (
                <Text style={{ color: palette.texteSecondaire, fontSize: 13 }}>Dernier envoi {ilYA(appareil.vuLe, maintenant)}</Text>
              ) : null}
              {appareil.expireLe ? <Expiration expireLe={appareil.expireLe} maintenant={maintenant} /> : null}
            </View>
            <Bouton titre="Oublier" variante="discret" onPress={() => onOublier(id)} testID={`oublier-${id}`} />
          </View>
        ))}

        {montrerCodes && liaison ? (
          <View style={{ gap: ESPACEMENT.s }} testID="codes-liaison">
            <SousTitre>
              Scannez avec l’appareil photo de l’iPhone. Le mot de passe de synchronisation vous sera demandé ; il
              n’est pas dans le QR code.
            </SousTitre>
            <View style={styles.qrs}>
              <QrCode texte={lienApp(liaison)} legende="App iPhone (AltStore)" testID="qr-app" />
              {lienSite(liaison) ? (
                <QrCode texte={lienSite(liaison)!} legende="Site de secours" testID="qr-site" />
              ) : null}
            </View>
            <Text style={{ color: palette.texteSecondaire }}>Ou recopiez ce code :</Text>
            <Text selectable style={[styles.code, { color: palette.texte, borderColor: palette.bordure }]} testID="code-liaison">
              {encoderLiaison(liaison)}
            </Text>
            {liaison.site ? (
              <Text selectable style={{ color: palette.accent }}>
                Site de secours : {liaison.site}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={{ alignSelf: 'flex-start', marginTop: ESPACEMENT.s }}>
          <Bouton titre="Désactiver sur cet appareil" variante="discret" onPress={onDelier} testID="bouton-delier" />
        </View>
      </Carte>
    </>
  );
}

const styles = StyleSheet.create({
  boutons: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.s },
  appareil: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ESPACEMENT.s,
    borderWidth: 1,
    borderRadius: RAYON.m,
    padding: ESPACEMENT.s + 2,
  },
  qrs: { flexDirection: 'row', flexWrap: 'wrap', gap: ESPACEMENT.l },
  qr: { alignItems: 'center', gap: ESPACEMENT.xs, backgroundColor: '#fff', padding: ESPACEMENT.s, borderRadius: RAYON.m },
  imageQr: { width: 200, height: 200 },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
    borderWidth: 1,
    borderRadius: RAYON.s,
    padding: ESPACEMENT.s,
  },
});

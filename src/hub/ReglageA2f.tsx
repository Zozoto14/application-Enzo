/**
 * Paramètres › Sécurité › Validation en deux étapes (relais version 10) : le code à six chiffres d'une
 * application d'authentification, demandé par le SERVEUR après le mot de passe, à chaque connexion par
 * identifiant sur un nouvel appareil. Activation (QR code ou clé à recopier, puis un code pour prouver
 * l'enrôlement) et désactivation (un code), pour tout compte.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Alerte, Bouton, Champ } from '../ui/composants';
import { QrCode } from '../ui/ecrans/CarteSynchro';
import type { ThemeHub } from './themes';

export interface ServicesA2f {
  /** État sur le serveur (`undefined` : injoignable ou pas encore à jour). */
  lire(): Promise<boolean | undefined>;
  /** Secret proposé : celui du coffre (même application d'authentification) ou un nouveau. */
  preparer(): { secret: string; uri: string; reprend: boolean };
  activer(secret: string, code: string): Promise<void>;
  desactiver(code: string): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const codeValide = (c: string) => /^\d{6}$/.test(c.replace(/\s/g, ''));

export function ReglageA2f({ theme, services }: { theme: ThemeHub; services: ServicesA2f }) {
  const [active, setActive] = useState<boolean | undefined | 'lecture'>('lecture');
  const [prepare, setPrepare] = useState<ReturnType<ServicesA2f['preparer']> | undefined>();
  const [code, setCode] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [desactiver, setDesactiver] = useState(false);
  useEffect(() => {
    let vivant = true;
    services
      .lire()
      .then(a => vivant && setActive(a))
      .catch(() => vivant && setActive(undefined));
    return () => {
      vivant = false;
    };
    // Une lecture à l'ouverture de la carte (l'hôte recrée `services` à chaque rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const texte = { color: theme.texte, fontSize: 14, lineHeight: 20 };
  const discret = { color: theme.attenue, fontSize: 13, lineHeight: 19 };
  const agir = (action: () => Promise<void>, apres: () => void) => {
    setErreur(undefined);
    setEnCours(true);
    action()
      .then(apres)
      .catch(e => setErreur(message(e)))
      .finally(() => setEnCours(false));
  };

  if (active === 'lecture') return <Text style={discret}>Lecture de l’état sur le serveur…</Text>;
  if (active === undefined) {
    return (
      <Text style={discret} testID="a2f-indisponible">
        Serveur injoignable ou pas encore à jour : réessayez plus tard.
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }} testID="reglage-a2f-contenu">
      <Text style={[texte, { fontWeight: '700' }]} testID="a2f-etat">
        {active ? 'Activée : le code à six chiffres est demandé après le mot de passe.' : 'Désactivée.'}
      </Text>
      <Text style={discret}>
        À chaque connexion sur un nouvel appareil (identifiant et mot de passe), le serveur demande aussi le code de votre application d’authentification, et le
        vérifie lui-même. Téléphone perdu : « Mot de passe oublié » avec un code de récupération.
      </Text>
      {info ? <Text style={[texte, { color: theme.accent }]}>{info}</Text> : null}
      {!active && !prepare ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton titre="Activer la validation en deux étapes" variante="discret" testID="a2f-activer" onPress={() => setPrepare(services.preparer())} />
        </View>
      ) : null}
      {!active && prepare ? (
        <View style={{ gap: 8 }} testID="a2f-enrolement">
          {prepare.reprend ? (
            <Text style={texte}>Votre application d’authentification actuelle (celle de l’ouverture de l’app) sert telle quelle : tapez simplement son code.</Text>
          ) : (
            <>
              <Text style={texte}>Scannez ce QR code avec votre application d’authentification (ou recopiez la clé), puis tapez le code qu’elle affiche.</Text>
              <QrCode texte={prepare.uri} legende="Application d’authentification" testID="a2f-qr" />
              <Text selectable style={[texte, { fontFamily: 'monospace' }]} testID="a2f-secret">
                {prepare.secret.replace(/(.{4})/g, '$1 ').trim()}
              </Text>
            </>
          )}
          <Champ etiquette="Code à six chiffres" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={7} testID="a2f-code" />
          {erreur ? <Alerte message={erreur} /> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Bouton
              titre={enCours ? 'Vérification…' : 'Activer'}
              desactive={enCours || !codeValide(code)}
              testID="a2f-confirmer"
              onPress={() =>
                agir(
                  () => services.activer(prepare.secret, code.replace(/\s/g, '')),
                  () => {
                    setActive(true);
                    setPrepare(undefined);
                    setCode('');
                    setInfo('Validation en deux étapes activée.');
                  },
                )
              }
            />
            <Bouton titre="Annuler" variante="discret" onPress={() => setPrepare(undefined)} />
          </View>
        </View>
      ) : null}
      {active && !desactiver ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Bouton titre="Désactiver" variante="discret" testID="a2f-desactiver" onPress={() => setDesactiver(true)} />
        </View>
      ) : null}
      {active && desactiver ? (
        <View style={{ gap: 8 }}>
          <Champ etiquette="Code à six chiffres (pour confirmer)" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={7} testID="a2f-code-desactiver" />
          {erreur ? <Alerte message={erreur} /> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Bouton
              titre={enCours ? 'Vérification…' : 'Désactiver'}
              desactive={enCours || !codeValide(code)}
              testID="a2f-desactiver-confirmer"
              onPress={() =>
                agir(
                  () => services.desactiver(code.replace(/\s/g, '')),
                  () => {
                    setActive(false);
                    setDesactiver(false);
                    setCode('');
                    setInfo('Validation en deux étapes désactivée.');
                  },
                )
              }
            />
            <Bouton titre="Annuler" variante="discret" onPress={() => setDesactiver(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

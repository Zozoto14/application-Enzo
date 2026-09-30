import { classerMedia, estAdressePrivee, estNomLocal, urlHttpSure, verifierUrlPublique, verifierUrlPubliqueSync } from './garde';
import { analyserAdresse } from './adresse';

const refuse = (u: string, code = 'garde') => {
  try {
    verifierUrlPubliqueSync(u);
  } catch (e) {
    expect((e as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`accepte a tort : ${u}`);
};

describe('garde : schemas et forme', () => {
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'ftp://exemple.fr/x', 'data:text/html,x', 'gopher://exemple.fr'])('refuse le schema de %s', u => {
    refuse(u, 'adresse');
  });
  it('refuse vide, trop long et identifiants', () => {
    refuse('', 'adresse');
    refuse(`https://exemple.fr/${'a'.repeat(2100)}`, 'adresse');
    refuse('https://user:mdp@exemple.fr/', 'adresse');
    refuse('https://user@exemple.fr/', 'adresse');
  });
  it('accepte et normalise une adresse publique', () => {
    expect(verifierUrlPubliqueSync('  HTTPS://Exemple.FR:443/a/../b?x=1 ')).toBe('https://exemple.fr/b?x=1');
    expect(urlHttpSure('exemple')).toBeNull();
  });
  it('tabulations et retours ligne ne masquent pas un hote', () => {
    refuse('http://127.0.\n0.1/');
    refuse('http://loc\talhost/');
  });
});

describe('garde : hotes locaux', () => {
  it.each([
    'http://localhost/',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://nas/',
    'http://imprimante.local/',
    'http://box.lan/',
    'http://svc.internal/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://routeur.home.arpa/',
  ])('refuse %s', u => refuse(u));

  it('nom local seulement quand il l\'est', () => {
    expect(estNomLocal('exemple.fr')).toBe(false);
    expect(estNomLocal('monlocal.fr')).toBe(false);
    expect(estNomLocal('a.local')).toBe(true);
  });
});

describe('garde : IP litterales sous toutes leurs formes', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.1/',
    'http://0.0.0.0/',
    'http://2130706433/', // decimal
    'http://0x7f000001/', // hexa
    'http://0177.0.0.1/', // octal
    'http://0x7f.0.0.1/',
    'http://017700000001/',
    'http://10.0.0.5/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a00:1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[2002:c0a8:101::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://224.0.0.1/',
  ])('refuse %s', u => refuse(u));

  it('accepte des IP publiques', () => {
    expect(estAdressePrivee('8.8.8.8')).toBe(false);
    expect(estAdressePrivee('172.32.0.1')).toBe(false);
    expect(estAdressePrivee('[2606:4700:4700::1111]')).toBe(false);
    expect(verifierUrlPubliqueSync('http://8.8.8.8/')).toBe('http://8.8.8.8/');
  });
  it('une valeur qui n\'est pas une IP est jugee privee', () => {
    expect(estAdressePrivee('pas-une-ip')).toBe(true);
  });
  it('analyse l\'hote comme un navigateur', () => {
    expect(analyserAdresse('http://2130706433/')?.hote).toBe('127.0.0.1');
    expect(analyserAdresse('http://0x7f.1/')?.hote).toBe('127.0.0.1');
  });
});

describe('garde : ports', () => {
  it('80/443/8080/8443 acceptes, le reste refuse', () => {
    expect(verifierUrlPubliqueSync('http://exemple.fr:8080/')).toBe('http://exemple.fr:8080/');
    refuse('http://exemple.fr:22/');
    refuse('http://exemple.fr:6379/');
    refuse('https://exemple.fr:3306/');
  });
  it('liste de ports configurable', () => {
    expect(verifierUrlPubliqueSync('http://exemple.fr:3000/', { portsAutorises: [3000] })).toBe('http://exemple.fr:3000/');
  });
});

describe('garde : resolution DNS', () => {
  it('refuse un nom public qui resout vers une IP privee', async () => {
    await expect(verifierUrlPublique('https://piege.exemple.fr/', { resoudre: async () => ['10.0.0.5'] })).rejects.toMatchObject({ code: 'garde' });
    await expect(verifierUrlPublique('https://piege.exemple.fr/', { resoudre: async () => ['8.8.8.8', '192.168.0.2'] })).rejects.toMatchObject({ code: 'garde' });
    await expect(verifierUrlPublique('https://inconnu.exemple.fr/', { resoudre: async () => { throw new Error('x'); } })).rejects.toMatchObject({ code: 'garde' });
    await expect(verifierUrlPublique('https://ok.exemple.fr/', { resoudre: async () => ['8.8.8.8'] })).resolves.toBe('https://ok.exemple.fr/');
  });
});

describe('classerMedia', () => {
  it('distingue m3u8, fichiers video et pages', () => {
    expect(classerMedia('https://cdn.exemple.fr/a/index.m3u8?t=1')).toBe('hls');
    expect(classerMedia('https://cdn.exemple.fr/a.MP4')).toBe('video');
    expect(classerMedia('https://cdn.exemple.fr/a.webm')).toBe('video');
    expect(classerMedia('https://exemple.fr/embed/123')).toBe('iframe');
  });
});

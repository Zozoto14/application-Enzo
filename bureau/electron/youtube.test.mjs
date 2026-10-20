import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENT_YOUTUBE, entetesYoutube, sousCadreYoutube } from './youtube.mjs';

test('sous-cadre : seulement /embed/<id> de YouTube en https', () => {
  const id = 'dQw4w9WgXcQ';
  for (const u of [`https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`, `https://www.youtube.com/embed/${id}`]) assert.equal(sousCadreYoutube(u), true, u);
  for (const u of [
    `http://www.youtube.com/embed/${id}`,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/court',
    `https://youtube.com.exemple.fr/embed/${id}`,
    `https://evil.example/embed/${id}`,
    `https://user:pw@www.youtube.com/embed/${id}`,
    'javascript:alert(1)',
    '',
  ]) assert.equal(sousCadreYoutube(u), false, u);
});

test('référent posé seulement sur le sous-cadre YouTube', () => {
  const url = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
  assert.equal(entetesYoutube({ resourceType: 'subFrame', url, requestHeaders: { A: '1' } }).Referer, REFERENT_YOUTUBE);
  assert.equal(entetesYoutube({ resourceType: 'script', url, requestHeaders: { A: '1' } }).Referer, undefined);
  assert.equal(entetesYoutube({ resourceType: 'subFrame', url: 'https://autre.fr/', requestHeaders: {} }).Referer, undefined);
});

import { describe, expect, test } from 'vitest';
import { isAllowedNativeRedirectUri, NATIVE_LOGIN_CALLBACK_PATH } from '../rest/validators/userValidators.js';

describe('isAllowedNativeRedirectUri: acepta', () => {
  test.each([
    'http://127.0.0.1:5000/callback',
    'http://127.0.0.1:1/callback',
    'http://127.0.0.1:65535/callback',
    'http://[::1]:5000/callback',
  ])('%s', (uri) => {
    expect(isAllowedNativeRedirectUri(uri)).toBe(true);
  });

  test('NATIVE_LOGIN_CALLBACK_PATH es el path que de verdad se exige', () => {
    expect(isAllowedNativeRedirectUri(`http://127.0.0.1:5000${NATIVE_LOGIN_CALLBACK_PATH}`)).toBe(true);
  });
});

describe('isAllowedNativeRedirectUri: rechaza', () => {
  test.each([
    ['no es un string', ['http://127.0.0.1/callback']],
    ['no es un string (objeto)', { toString: () => 'http://127.0.0.1/callback' }],
    ['no es un string (número)', 12345],
    ['no es un string (null)', null],
    ['no es un string (undefined)', undefined],
    ['URI malformada', 'not-a-uri'],
    ['subdominio que empieza igual que el loopback', 'http://127.0.0.1.attacker.com/callback'],
    ['localhost (DNS, no un literal loopback)', 'http://localhost/callback'],
    ['https en vez de http', 'https://127.0.0.1/callback'],
    ['host remoto directo', 'https://evil.com/callback'],
    ['loopback solo en la query de un host remoto', 'http://evil.com/?x=http://127.0.0.1/'],
    ['path distinto al fijo del CLI', 'http://127.0.0.1:4000/otra-ruta'],
    ['espacios alrededor', '  http://127.0.0.1:5000/callback  '],
    ['IPv4 decimal', 'http://2130706433/callback'],
    ['IPv4 abreviada', 'http://127.1/callback'],
    ['IPv4 hexadecimal', 'http://0x7f000001/callback'],
    ['IPv4 octal', 'http://0177.0.0.1/callback'],
    ['puntos fullwidth', 'http://127。0。0。1/callback'],
    ['esquema en mayúsculas', 'HTTP://127.0.0.1:5000/callback'],
    ['path traversal literal', 'http://127.0.0.1/../callback'],
    ['path traversal porcentaje-codificado', 'http://127.0.0.1/%2e%2e/callback'],
    ['sin doble barra tras el esquema', 'http:127.0.0.1/callback'],
    ['userinfo hostil (host@host)', 'http://evil.com@127.0.0.1/callback'],
    ['userinfo con credenciales', 'http://user:pass@127.0.0.1/callback'],
    ['query con host hostil', 'http://127.0.0.1/callback?next=http://evil.com'],
    ['fragment con host hostil', 'http://127.0.0.1/callback#@evil.com'],
    ['0.0.0.0 no es 127.0.0.1', 'http://0.0.0.0/callback'],
    ['IPv4 mapeada sobre IPv6', 'http://[::ffff:127.0.0.1]/callback'],
  ])('%s: %j', (_label, redirectUri) => {
    expect(isAllowedNativeRedirectUri(redirectUri)).toBe(false);
  });

  test('puerto 0: pasa la whitelist (no es una vía de ataque, ver comentario)', () => {
    expect(isAllowedNativeRedirectUri('http://127.0.0.1:0/callback')).toBe(true);
  });
});

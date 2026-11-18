import { describe, expect, test } from '@jest/globals';
import { FORK_EXTENSION_ID, buildAllowedOrigins, parseArgs } from './posendy-chrome-install';
import { STORE_EXTENSION_ID } from './constant';

/**
 * posendy-chrome fork — 설치 CLI 의 allowed_origins 회귀 테스트 (Codex 2차 지적 5).
 *
 * 예전에는 사용자가 준 ID 와 함께 upstream 웹스토어 확장 ID
 * (hbdgbgagpkpjffpklnamcljpakneikee) 를 언제나 allowed_origins 에 넣었다.
 * allowed_origins 에 든 확장은 이 네이티브 호스트를 띄울 수 있고, 붙는 순간
 * SERVER_STARTED 로 브리지 bearer 토큰을 받는다. 즉 upstream 확장이 설치돼 있기만 해도
 * 로컬 브리지를 그대로 조종할 수 있었다.
 *
 * 이제 기본은 포샌디 고정 ID(사이드로드)와 포샌디 웹스토어 ID 두 개뿐이고,
 * 추가 ID 는 --extension-id 로 명시했을 때만 들어간다. (2026-11-11 웹스토어 ID 추가)
 */
const UPSTREAM_WEB_STORE_ID = 'hbdgbgagpkpjffpklnamcljpakneikee';

describe('posendy-chrome-install allowed_origins', () => {
  const BASE = [
    `chrome-extension://${FORK_EXTENSION_ID}/`,
    `chrome-extension://${STORE_EXTENSION_ID}/`,
  ];

  test('기본은 포샌디 고정 ID 와 웹스토어 ID 두 개뿐이다', () => {
    expect(buildAllowedOrigins()).toEqual(BASE);
  });

  test('upstream 웹스토어 ID 는 어떤 경우에도 저절로 들어가지 않는다', () => {
    for (const origins of [buildAllowedOrigins(), buildAllowedOrigins('abcdefghijklmnop')]) {
      expect(origins.join(' ')).not.toContain(UPSTREAM_WEB_STORE_ID);
    }
  });

  test('--extension-id 로 명시한 ID 만 추가된다', () => {
    expect(buildAllowedOrigins('abcdefghijklmnopqrstuvwxyzabcdef')).toEqual([
      ...BASE,
      'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/',
    ]);
  });

  test('fork 고정 ID 를 다시 줘도 중복되지 않는다', () => {
    expect(buildAllowedOrigins(FORK_EXTENSION_ID)).toEqual(BASE);
    expect(buildAllowedOrigins(STORE_EXTENSION_ID)).toEqual(BASE);
  });

  test('빈 문자열·공백은 추가 ID 로 치지 않는다', () => {
    expect(buildAllowedOrigins('   ')).toHaveLength(2);
    expect(buildAllowedOrigins('')).toHaveLength(2);
  });
});

describe('posendy-chrome-install parseArgs', () => {
  test('= 표기와 공백 표기를 모두 받는다 (도움말이 공백 표기를 안내한다)', () => {
    expect(parseArgs(['--extension-id=abc', '--browser=edge']).extensionId).toBe('abc');
    expect(parseArgs(['--extension-id', 'abc', '--browser', 'edge'])).toMatchObject({
      extensionId: 'abc',
      browser: 'edge',
    });
  });

  test('값 없는 --extension-id 는 다음 플래그를 값으로 삼지 않는다', () => {
    expect(parseArgs(['--extension-id', '--browser=edge']).extensionId).toBeUndefined();
  });

  test('기본값은 chrome, 자동 감지 꺼짐', () => {
    expect(parseArgs([])).toEqual({ browser: 'chrome', autoDetectId: false, help: false });
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import { createSnapshot, transition, type TimerSnapshot } from '../src/timer/model.ts';

// Only static rendering is tested here; native focus and keyboard behavior need a browser.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/timer/TimerPanel.tsx', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText
  .replace(/from "react\/jsx-runtime"/g, `from ${JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)}`)
  .replace(/from 'react'/g, `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
  .replace(/from '.\/model'/g, `from ${JSON.stringify(new URL('../src/timer/model.ts', import.meta.url).href)}`);
const { TimerPanel } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const actions = { setSettings() {}, startFocus() {}, startRest() {}, pause() {}, resume() {}, confirmReset() {}, dismissCompletion() {} };
function render(snapshot: TimerSnapshot, persistenceAvailable = true) {
  return renderToStaticMarkup(createElement(TimerPanel, {
    view: { snapshot, remainingMs: 60000, persistenceAvailable }, actions, onRequestReset() {},
  }));
}
const running = transition(createSnapshot(), { type: 'START_FOCUS', sessionId: 'focus-1' }, 0);

test('준비 상태에서 기본 시간과 연결된 숫자 입력, 시작 버튼을 표시한다', () => {
  const html = render(createSnapshot());
  assert.match(html, /25:00/);
  assert.match(html, /min="1" max="180" step="1"[^>]*value="25"/);
  assert.match(html, /min="1" max="60" step="1"[^>]*value="5"/);
  assert.match(html, /aria-describedby="[^"]+-focus-help"/);
  assert.match(html, />집중 시작<\/button>/);
  assert.doesNotMatch(html, /fieldset[^>]*disabled/);
});

test('진행 중에는 설정을 잠그고 시간의 매초 live 안내를 끈다', () => {
  const html = render(running);
  assert.match(html, /<fieldset[^>]*disabled/);
  assert.match(html, /role="timer" aria-live="off"/);
  assert.match(html, />일시정지<\/button>/);
  assert.match(html, />초기화<\/button>/);
  assert.doesNotMatch(html, />집중 시작<\/button>/);
});

test('일시정지 상태에서 재개 액션을 표시한다', () => {
  const html = render(transition(running, { type: 'PAUSE', sessionId: 'focus-1' }, 1));
  assert.match(html, />재개<\/button>/);
  assert.doesNotMatch(html, />일시정지<\/button>/);
});

test('집중 완료는 수동 휴식 및 집중 시작을, 휴식 완료는 집중 시작만 표시한다', () => {
  const completed = transition(running, { type: 'TICK' }, 25 * 60000);
  const focusHtml = render(completed);
  assert.match(focusHtml, />휴식 시작<\/button>/);
  assert.match(focusHtml, />다시 집중하기<\/button>/);
  const rest = transition(completed, { type: 'START_REST', sessionId: 'rest-1' }, 25 * 60000);
  const restHtml = render(transition(rest, { type: 'TICK' }, 30 * 60000));
  assert.match(restHtml, /휴식 · 완료/);
  assert.match(restHtml, />다시 집중하기<\/button>/);
  assert.doesNotMatch(restHtml, />휴식 시작<\/button>/);
});

test('저장 불가 상태에만 한국어 저장 실패 안내를 표시한다', () => {
  assert.match(render(createSnapshot(), false), /role="status">타이머를 저장하지 못했어요/);
  assert.doesNotMatch(render(createSnapshot()), /타이머를 저장하지 못했어요/);
});

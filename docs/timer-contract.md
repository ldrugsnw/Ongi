# Ongi 2.0 타이머 공유 계약

상태: 체크포인트 1에서 확정하고 체크포인트 2에서 A·B·C 구현과 통합에 적용한 계약.
사용자가 승인한 타입과 동작 정책을 유지한다. 아래의 단계별 소유권과 계약은 실제 구현의 기준이다.

## 소유권

- A: `src/timer/model.ts`, `src/timer/persistence.ts`, `tests/timer-model.test.ts`, `tests/timer-persistence.test.ts`.
- B: 추후 `controller.ts`, `useFocusTimer.ts`, `notification.ts`와 런타임 테스트.
- C: 추후 `FocusTimer.tsx`, `TimerPanel.tsx`, `TimerDialogs.tsx`, `timer.css`.
- Integrator: 이 문서, 체크포인트 기록, 추후 main/CustomizeControls/공통 스타일 통합.
- 각 worker는 Orca가 관리하는 별도 worktree를 사용한다. main을 수정하지 않는다.

## Agent A의 공개 TypeScript 타입

```ts
export type Settings = { focusMs: number; restMs: number };
export type Phase = 'focus' | 'rest';
export type Session = { id: string; phase: Phase; durationMs: number };
export type TimerState =
  | { status: 'idle' }
  | { status: 'running'; session: Session; elapsedBeforeRunMs: number; runStartedAtMs: number }
  | { status: 'paused'; session: Session; elapsedMs: number }
  | { status: 'completed'; session: Session; completedAtMs: number; dialogDismissed: boolean };
export type TimerSnapshot = { version: 1; settings: Settings; timer: TimerState };
export type TimerEvent =
  | { type: 'SET_SETTINGS'; settings: Settings }
  | { type: 'START_FOCUS'; sessionId: string }
  | { type: 'START_REST'; sessionId: string }
  | { type: 'PAUSE'; sessionId: string }
  | { type: 'RESUME'; sessionId: string }
  | { type: 'CONFIRM_RESET'; sessionId: string }
  | { type: 'DISMISS_COMPLETION'; sessionId: string }
  | { type: 'TICK' };
```

## Agent A의 함수 계약

`model.ts`는 위 타입과 아래 API를 export한다.

```ts
export const DEFAULT_SETTINGS: Readonly<Settings>; // 25분 / 5분
export function validateSettings(input: unknown): Settings | null;
export function createSnapshot(): TimerSnapshot;
export function remainingMs(state: TimerState, nowMs: number): number;
export function reconcile(state: TimerState, nowMs: number): TimerState;
export function transition(snapshot: TimerSnapshot, event: TimerEvent, nowMs: number): TimerSnapshot;
export function formatRemaining(ms: number): string;
```

- Settings는 정수 분을 밀리초로 표현한다. focus 1~180분, rest 1~60분. 문자열·NaN·Infinity·분 미만 값은 거부한다.
- 기본값 객체를 외부에서 변경할 수 없게 하고 createSnapshot은 독립적인 값을 반환한다.
- 함수는 입력을 변경하지 않는다. Date.now/랜덤 ID/DOM/Storage/오디오를 사용하지 않는다.
- nowMs는 0 이상의 안전한 정수 epoch ms다. 잘못된 nowMs는 RangeError로 명시적으로 거부한다.
- running의 elapsed = elapsedBeforeRunMs + max(0, nowMs - runStartedAtMs).
- remaining은 duration에서 elapsed를 빼고 0으로 제한한다. paused는 시각과 관계없이 고정, completed는 0, idle은 0이다. UI의 idle 표시는 settings.focusMs를 사용한다.
- 시스템 시각 역행은 현재 실행 구간의 경과를 0으로 제한한다. 이전에 일시정지로 확정된 경과는 되돌리지 않는다. 시스템 시각 변경을 권위 있는 외부 시각으로 교정하지 않는다.
- 만료된 running은 completed로 전환한다. completedAtMs는 발견 시각이 아닌 계산된 deadline이다. dialogDismissed는 false다.
- transition은 먼저 reconcile하고 액션을 적용한다. Pause가 만료 이후 도착하면 completed다.
- SET_SETTINGS는 idle에서만 적용한다. 잘못된 설정이나 허용되지 않은 액션은 reconcile 결과를 그대로 반환한다.
- START_FOCUS는 idle 또는 completed에서만 허용한다. START_REST는 focus completed에서만 허용한다. 새 세션 ID는 공백이 아닌 문자열이며 기존 세션 ID와 달라야 한다.
- 시작은 설정값을 session.durationMs에 복사하고 elapsedBeforeRunMs=0, runStartedAtMs=nowMs로 running을 만든다.
- PAUSE는 matching ID의 running에서 경과를 캡처한다. RESUME은 matching ID의 paused에서 새 실행 구간을 시작한다.
- CONFIRM_RESET은 matching ID에서 idle로 돌아가며 설정을 유지한다. 확인 요청/취소는 UI 상태이므로 domain event가 아니다.
- DISMISS_COMPLETION은 matching ID의 completed에서 dialogDismissed=true만 적용한다.
- TICK은 reconcile만 수행한다. 완료 후 자동으로 휴식/집중을 시작하지 않는다.
- formatRemaining은 초 단위 올림 후 MM:SS로 표시한다. 180:00처럼 분이 두 자리를 초과할 수 있다. 음수는 0, 유한하지 않은 입력은 RangeError로 처리한다.

`persistence.ts`는 아래 API를 export한다.

```ts
export const TIMER_STORAGE_KEY = 'ongi.timer.v1';
export type RestoreResult = {
  snapshot: TimerSnapshot;
  source: 'stored' | 'missing' | 'invalid' | 'unavailable';
};
export function decodeSnapshot(raw: string | null): TimerSnapshot | null;
export function restoreSnapshot(raw: string | null, nowMs: number): TimerSnapshot;
export function readSnapshot(storage: Pick<Storage, 'getItem'>, nowMs: number): RestoreResult;
export function saveSnapshot(storage: Pick<Storage, 'setItem'>, snapshot: TimerSnapshot): boolean;
```

- decodeSnapshot은 JSON/버전/설정/상태/phase/ID/숫자/상태별 불변식을 검사한다. 잘못된 입력에 throw하지 않는다. 알 수 없는 버전은 거부한다.
- elapsed는 0 이상 duration 미만의 안전한 정수, timestamp는 0 이상의 안전한 정수, 합산 deadline도 안전한 정수여야 한다.
- session.durationMs는 해당 phase 범위 내 정수 분이다. 고정된 세션 길이는 저장 설정과 별개로 검증한다.
- paused/running의 경과가 duration 이상이면 잘못된 저장값이다. elapsedBeforeRunMs=0은 허용한다.
- completed의 dialogDismissed는 boolean이어야 한다. 미래 timestamp는 시스템 시각 역행과 구분할 수 없으므로 미래라는 이유만으로 거부하지 않는다.
- 유효한 필드만 복사하여 복원한다. 입력의 알 수 없는 필드를 snapshot으로 전파하지 않는다.
- restoreSnapshot은 decode 후 reconcile한다. 누락/잘못된 값은 기본 idle로 복원한다.
- readSnapshot은 getItem 실패를 unavailable로 구분한다. localStorage getter 자체의 실패는 B의 어댑터가 처리한다.
- saveSnapshot은 저장/직렬화 실패 시 false, 성공 시 true다. tick마다 저장하지 않는 책임은 B에 있다.
- 복원은 어떤 알림 효과도 발생시키지 않는다. domain에는 알림 effect가 없다.

## B·C 경계 계약 (다음 단계)

다음 타입은 체크포인트 2에서 `controller.ts`가 export하고 UI가 type import로 소비한다.

```ts
type TimerView = {
  snapshot: TimerSnapshot;
  remainingMs: number;
  persistenceAvailable: boolean;
};
type TimerActions = {
  setSettings(settings: Settings): void;
  startFocus(): void;
  startRest(): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  confirmReset(sessionId: string): void;
  dismissCompletion(sessionId: string): void;
};
type RuntimeDeps = {
  now(): number;
  createSessionId(): string;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  schedule(callback: () => void, delayMs: number): () => void;
  isVisible(): boolean;
  onLifecycle(callback: (event: 'hidden' | 'visible' | 'pageshow' | 'focus') => void): () => void;
  notification: {
    prepare(): void; // 사용자 조작에서 동기 호출. 실패는 내부에서 처리.
    play(): void; // 최선의 재생 시도. 실패 시 재시도하지 않음.
    cancel(): void;
  };
};
type TimerController = {
  getView(): TimerView; // 다음 알림까지 참조 유지. useSyncExternalStore 대응.
  subscribe(listener: () => void): () => void;
  start(): void;
  dispose(): void;
  actions: TimerActions;
};
// useFocusTimer(): TimerView & TimerActions
// createTimerController(deps: RuntimeDeps): TimerController
// FocusTimer props: { open: boolean; onOpenChange(open: boolean): void }
// TimerPanel props: { view: TimerView; actions: TimerActions; onRequestReset(sessionId: string): void }
// TimerDialogs props: { view: TimerView; actions: TimerActions;
//   resetSessionId: string | null; onCancelReset(): void }
```

- FocusTimer가 hook을 한 번만 호출하며 패널을 닫아도 controller는 유지한다.
- B는 Date.now와 ID 생성, visibility/pageshow/focus, 스케줄링, 저장, 알림을 소유한다. C는 domain 상태를 직접 변경하지 않는다.
- B controller의 공개 진입점과 주입 어댑터는 위 타입을 따른다. schedule은 취소 함수를 반환하고 onLifecycle은 구독 해제 함수를 반환한다. start/dispose의 반복 호출과 Strict Mode 재구독을 안전하게 처리한다. dispose 후 start로 재활성화할 수 있어야 한다. 알림 어댑터는 브라우저 정책에 의한 실패를 내부에서 처리한다.
- 알림은 신규 live completion에서만 시도한다. 복원·백그라운드 만료·복귀·지연 콜백은 무음이다. 1.5초 lateness guard를 사용하고 중복 시도 방지는 B가 담당한다.
- 초기화 확인은 C의 로컬 상태다. 세션 만료 시 확인을 닫고 완료 팝업을 우선한다. stale session ID로 새 세션을 초기화하지 않는다.
- 앱의 openPanel 단일 값과 환경/개인화 패널 통합은 Integrator만 수정한다.
- 다중 탭 동기화, 라이브러리 추가, Figma 시각 디자인 작업은 이번 범위에 없다.

## 검증 및 완료 기준

A는 새 테스트와 기존 전체 `npm test`, `npm run build`를 실행한다. 의존성이 없으면 lockfile을 유지하여 npm ci로 설치한다.
각 명령의 종료 코드, 테스트 개수, 변경 파일, commit hash, 남은 문제를 한국어로 보고한다.
Integrator가 결과를 검토한 뒤 feature worktree로 통합하고 체크포인트 기록을 작성한다. 체크포인트 1은 A까지만, 승인된 체크포인트 2는 B·C와 기존 앱 통합까지만 진행한다.

체크포인트 2에서 타입 계약은 변경하지 않았다. ID 생성은 randomUUID 미지원 환경에서도 동작하도록 보완했고, native dialog에 명시적인 Tab 순환을 추가했다. 상세 결과와 브라우저 검증 범위는 `timer-checkpoint-2.md`에 기록한다.

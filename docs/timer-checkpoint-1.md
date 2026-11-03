# Ongi 2.0 첫 번째 체크포인트 결과

날짜: 2026-11-03. 상태: 도메인 구현·검토·통합 완료. B·C 구현은 시작하지 않음.

## 실제 실행 및 소유권

- Integrator: `feat/ongi-foucs-timer` 브랜치, 공유 계약 작성·코드 검토·통합·이 기록 작성.
- Agent A: Orca Codex worker, 기존 `ongi-timer-domain-a` worktree와 `ldrugsnw/ongi-timer-domain-a` 브랜치에서 도메인 및 테스트 구현.
- Run: `run_50688b32c77b`, Task: `task_cb92a6bd3340`, Dispatch: `ctx_a145c49559ce`.
- 기존 작업을 재사용했으며 중복 worktree/작업을 만들지 않았다. B·C는 실행하지 않았다.
- main 기준 커밋 `e8efd122ef5f0facef1b751792cd5c19d686f034`는 변경하지 않았다.

## 변경 파일

- `docs/timer-contract.md`: 상태/이벤트/API, 저장 형식, B·C의 런타임·UI 인터페이스 및 파일 소유권.
- `src/timer/model.ts`: 기본값, 설정 검증, 순수 상태 전이, 경과 시각 계산, 표시 포맷.
- `src/timer/persistence.ts`: v1 snapshot 검증, 저장, 복원, 저장소 실패 구분.
- `tests/timer-model.test.ts`: 도메인 테스트 15개.
- `tests/timer-persistence.test.ts`: 저장 및 복원 테스트 18개.
- `docs/timer-checkpoint-1.md`: 이 결과 기록.

기존 main.tsx, CustomizeControls.tsx, 스타일, 배경/음원, package.json/lockfile은 변경하지 않았다.

## 핵심 동작 및 검토

- 기본 25/5분, 집중 1~180분 및 휴식 1~60분의 정수 분만 허용한다. 설정은 idle에서만 변경한다.
- running은 실행 구간 시작 epoch와 이전 구간 누적 경과로 계산한다. paused는 고정 경과를 보존한다.
- 모든 액션에 앞서 만료를 확인하여 늦은 Pause는 completed가 된다. 완료 시각은 발견 시각이 아닌 deadline이다.
- 완료 후 자동 전환하지 않는다. 명시적 START_REST/START_FOCUS만 새 세션을 만든다.
- 완료 팝업을 닫아도 completed 및 dialogDismissed가 저장·복원된다.
- 초기화는 UI 확인 이후 CONFIRM_RESET만 받으며, 세션 ID가 일치해야 한다. 설정은 유지한다.
- 손상된 데이터/미지원 버전은 기본 idle로 복구하며, 누락/손상/접근불가를 구분한다.
- 복원 함수에 오디오/브라우저 effect가 없다. 실제 알림 방지 정책의 실행은 다음 B 작업이다.
- Integrator는 공유 계약의 공개 타입/API, 전이 순서, 불변성, 저장 검증 및 테스트를 비교했고 차이를 발견하지 않았다.

## 검증 근거

아래 실행 결과는 Agent A의 worker_done 보고에 근거한다. 검토한 원본 커밋은 `a9f4f0259fbaa349d1d97f8382dc9c6a56441d2c`다.

| 명령 | 종료 코드 | 결과 |
|---|---:|---|
| `npm ci` | 0 | 기존 lockfile로 21개 패키지 설치 |
| `node --experimental-strip-types --test tests/timer-model.test.ts tests/timer-persistence.test.ts` | 0 | 신규 33/33 통과 |
| `npm test` | 0 | 기존 20개 포함 전체 53/53 통과 |
| `npm run build` | 0 | TypeScript 검사 및 Vite 빌드 성공, 40 modules |
| `git diff --cached --check` | 0 | 커밋 전 형식 검사 통과 |

Integrator는 위 커밋을 `a7da784`로 cherry-pick했다. 두 커밋 사이 담당 4개 파일의 diff가 비어 있어 검증한 코드와 통합 코드가 동일함을 확인했고, `git diff --check main...HEAD`도 통과했다. 동일 코드의 테스트/빌드를 중복 실행하지 않았다.

초기 CLI PATH 및 Orca 런타임/공유 Git 메타데이터의 샌드박스 접근 문제는 절대 경로·심볼릭 링크·승인된 escalation으로 해결했다. Agent A의 실제 CLI 조회 성공과 깨끗한 최종 작업 트리도 보고받았다.

## 다음 단계 준비

- B: controller/hook/notification과 주입 어댑터 테스트. A의 model/persistence와 확정한 RuntimeDeps/TimerController를 사용한다. controller.ts에서 TimerView/TimerActions/RuntimeDeps/TimerController 타입을 export하여 C가 type import로 참조하도록 한다.
- C: FocusTimer/TimerPanel/TimerDialogs/timer.css. 확정한 view/actions와 mock fixture로 B와 병렬 개발한다. C는 B의 hook/controller 파일을 생성하거나 수정하지 않는다.
- B·C 모두 이 체크포인트 커밋을 기준으로 각자 Orca worktree를 생성하는 것은 다음 단계 승인 후 진행한다.
- Integrator만 기존 App/CustomizeControls와 공통 스타일을 수정하고 openPanel을 통합한다.
- 브라우저 백그라운드·알림음·Strict Mode 런타임·실제 iPad 접근성/조작성 검증은 B·C 통합 이후 수행한다. 이번 도메인 테스트가 이를 검증했다고 주장하지 않는다.

현재 공유 계약 변경이나 사용자 판단이 필요한 새 설계 문제는 없다. 다음 단계 실행 승인 전까지 여기서 중단한다.

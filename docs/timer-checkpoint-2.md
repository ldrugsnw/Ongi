# Ongi 2.0 체크포인트 2 결과

날짜: 2026-11-03. 상태: B·C 구현과 Integrator 통합·검증 완료, 추가 개발 중단.

## 실행과 변경 파일

두 worker는 체크포인트 1 최신 통합 커밋 `af83bae`에서 Orca가 생성한 독립 worktree를 사용했다. Run은 기존 `run_50688b32c77b`를 재사용했다. main 커밋은 `e8efd122ef5f0facef1b751792cd5c19d686f034`로 유지했다.

| 담당 | worktree / Dispatch | 변경 파일 |
|---|---|---|
| B | `ongi-timer-runtime-b` / `ctx_6a009fb798e2`, 후속 `ctx_4f91042a4773` | `src/timer/controller.ts`, `useFocusTimer.ts`, `notification.ts`; `tests/timer-controller.test.ts`, `timer-notification.test.ts`, `timer-runtime-harness.ts` |
| C | `ongi-timer-ui-c` / `ctx_0566b28b706d` | `src/timer/FocusTimer.tsx`, `TimerPanel.tsx`, `TimerDialogs.tsx`, `timer.css`; `tests/timer-ui.test.ts` |
| Integrator | `feat-ongi-foucs-timer` | `src/main.tsx`, `src/CustomizeControls.tsx`, `src/style.css`, 공유 계약 및 이 문서 |

Agent A를 재실행하지 않았고 domain/persistence를 변경하지 않았다. B·C는 서로의 소유 파일을 수정하지 않았다. C는 빌드 확인을 위해 B 커밋을 자기 worktree에 cherry-pick했지만 수정하지 않았다. 라이브러리 및 package.json/lockfile 변경은 없다.

## 커밋

| 담당/내용 | 원본 커밋 | feature 통합 커밋 |
|---|---|---|
| B runtime/hook/chime 및 테스트 | `7b42871ca6a16c30d39515c412d0a167b4922a10` | `2a755d5` |
| C UI 및 정적 테스트 | `e94bf7503e15a63d60226bb089f289c40de6a6a8` | `03124b3` |
| B HTTP/미지원 환경의 ID 생성 보완 | `4965dbf99729eb6ce0a55d40e8b9dbf259c9fd8f` | `564983d` |
| C 모달 Tab 순환/포커스 복구 보완 | `706289ae7052cd9ccb37a896cd67f3d73597cb51` | `aa52002` |
| Integrator 기존 앱과 단일 패널 통합 | 해당 없음 | `f9ea191` |

C의 검증용 B cherry-pick `3f12c37`는 별도 UI 변경이 아니므로 중복 통합하지 않았다.

## 설계 판단

- Controller가 복원 상태와 안정적인 TimerView 참조를 보유한다. 읽기만으로 새 참조를 만들지 않고 관찰 가능한 값이 바뀔 때만 구독자에 알린다. hook은 useSyncExternalStore와 인스턴스별 controller 하나를 사용한다.
- start/dispose는 반복 호출과 start-dispose-start 재활성화를 지원한다. lifecycle 구독과 250ms schedule은 정리하며 취소된 callback은 generation으로 무효화한다.
- 실제 epoch 경과를 A의 순수 전이 함수로 계산한다. hidden에서는 예약을 취소하고 visible/pageshow/focus에서 만료를 무음으로 조정한다. 패널을 닫아도 controller는 유지한다.
- localStorage getter 실패는 어댑터에서, read/write 실패는 controller에서 처리한다. 세션은 메모리에서 계속 실행하고 persistenceAvailable=false를 표시한다. 시각 갱신마다 저장하지 않는다.
- 알림은 새로운 live completion에서만 시도하며 시도 전에 중복 방지를 기록한다. visible interval, 이전 callback 간격과 deadline 지연에 1500ms 제한을 적용한다. 숨김/복원/복귀/장시간 suspension의 완료는 무음이다.
- 알림음은 별도 Web Audio context의 짧고 낮은 gain synth다. 사용자 시작/재개 조작에서 prepare/resume를 시도하며 실패는 내부 처리한다. 지연된 resume promise는 generation/visibility/시각 검증으로 취소한다. 기존 환경음은 변경하지 않는다.
- 검토에서 randomUUID의 가용성 의존을 발견하여 B가 대체 ID 생성과 회귀 테스트 3개를 추가했다. 공유 타입 계약과 사용자 정책은 변경하지 않았다.
- UI는 idle에서만 정수 분 입력을 적용하고 잘못된 draft는 안내 및 시작 비활성화로 처리한다. 초기화 확인은 세션 ID를 갖는 로컬 상태이고, 만료되면 완료 모달이 우선한다.
- 완료 모달은 native dialog와 body portal을 사용해 배경 조작을 막는다. Escape/닫기는 completed를 유지한다. 휴식/다시 집중은 명시적 조작으로만 시작한다. 초기 포커스, Tab/Shift+Tab 순환, 이전 포커스 복구를 구현했다.
- 매초 countdown은 aria-live=off이며 phase/status 변경만 별도 status로 알린다. CSS는 타이머 접두사로 제한하고 provisional café 색상을 사용한다.
- Integrator의 openPanel 단일 값으로 환경·개인화·타이머 패널을 조정한다. 안정적인 callback 참조와 패널별 조건부 닫기로 다른 패널을 잘못 닫거나 입력 중 포커스를 재설정하지 않게 한다. 기존 Escape handler는 bubble 단계에서 defaultPrevented와 열린 dialog를 확인한다.
- 기존 장면, 환경음, 개인화 자산은 그대로이며 세 버튼의 모바일/safe-area 위치만 공통 CSS에서 맞췄다.

## 자동 검증

| 실행 주체 | 명령 | 최종 결과 |
|---|---|---|
| B 초기 | `npm ci`, `npm test`, `npm run build` | 모두 종료 0; 75/75, 신규 runtime 16 + notification 6 |
| B ID 보완 | `npm test`, `npm run build` | 모두 종료 0; 78/78, 신규 ID 회귀 3개 포함 |
| C 단독 | `npm test` | 종료 0; 58/58, UI 정적 렌더링 5개 포함 |
| C + 검증용 B | `npm test`, `npm run build` | 모두 종료 0; 80/80, 포커스 보완 포함 |
| Integrator 최종 | `npm ci` | 종료 0; 21개 패키지, lockfile 변경 없음 |
| Integrator 최종 | `npm test` | 종료 0; **83/83**, 실패/취소/skip 0 |
| Integrator 최종 | `npm run build` | 종료 0; TypeScript 및 Vite 50 modules 성공 |
| Integrator | `git diff --check` | 종료 0 |

최종 합계는 기존 53 + B 25 + C 5 = 83이다. runtime 주입 테스트는 참조 안정성, 재구독/정리, wall-clock, 백그라운드/복원 무음, stale callback, 저장 실패, audio resume race 등을 검사한다. UI 정적 테스트는 표시/markup만 검사하며 키보드 검증 근거로 사용하지 않았다.

C의 초기 테스트에서 HTML 속성 순서 가정 1개가 실패해 수정했다. B 파일을 받기 전 C 빌드는 import 누락으로 실패했고, 검증용 B 반영 후 통과했다. CLI/runtime 연결과 Git 메타데이터 접근 및 dev-server listen의 sandbox 차단은 승인된 escalation으로 해결했다. 이 중간 실패를 최종 성공으로 오인하지 않았다.

## 실제 브라우저에서 확인한 범위

C의 Orca 내장 브라우저 StrictMode fixture에서 다음을 확인했다: 빈 입력 오류/시작 비활성화, 1분 설정 적용, 초기화 취소/확인, native :modal 및 배경 focus 차단, 실제 Tab/Shift+Tab/Escape, 이전 focus 및 토글 복구, 초기화 중 만료 시 완료 우선, dismissed 저장, pause/resume, 320×568 및 1024×768 모의 viewport 경계. native 기본 Tab이 마지막 버튼에서 빠지는 동작을 발견해 명시적 순환으로 보완하고 재검증했다. 해당 fixture/서버는 C가 정리했다.

Integrator는 production entry와 동일한 App을 실행한 `http://localhost:5184`에서 다음을 별도로 확인했다.

- 환경→개인화→타이머 전환 때 열린 토글이 항상 하나이고 다른 패널은 hidden이다.
- 시작 시 running 저장과 입력 잠금, 패널을 닫은 뒤에도 running 유지.
- pause 후 reload에서 paused 및 남은 시간 복원, 패널은 닫힌 상태로 시작.
- 기존 배경과 fireplace audio URL 보존.
- 초기화 확인의 취소 초기 포커스, native modal, 확인 후 idle 복귀.
- 검증용 completed snapshot을 reload하면 닫힌 패널과 무관하게 완료 모달이 표시된다. 자동 전환하지 않으며 휴식 시작을 눌러야 5분 rest running이 된다. 검증 세션은 이후 idle로 초기화했다.
- 320×568 실제 렌더 스크린샷을 열어 패널과 세 버튼이 화면 안에 배치됨을 확인했다. 이는 모의 화면 크기이며 실제 iPad 검증이 아니다.

통합 개발 서버는 Orca의 `Ongi checkpoint 2 preview` 터미널에서 미리보기용으로 유지한다. 이 서버는 배포가 아니다.

## 남은 검증 및 문제

현재 알려진 코드 결함이나 미결 계약 변경은 없다. 아래 항목은 아직 실기기/지원 브라우저 검증이 필요하다.

1. iPad Safari에서 화면 잠금·앱 전환·장시간 백그라운드·BFCache 복귀 후 남은 시간/완료 복원과 지연음이 없는지 확인.
2. 실제 사용자 제스처, 브라우저 오디오 정책·장치 음량·오디오 인터럽트에서 gentle chime의 재생 가능 여부와 중복/지연 재생 방지 확인. 실제 소리를 청취하지 않았다.
3. Safari의 실제 React Strict Mode 마운트/재구독에서 타이머·리스너·모달 중복이 없는지 확인. controller mock 및 내장 브라우저 fixture 검증은 이 실기기 확인을 대체하지 않는다.
4. VoiceOver와 외장 키보드에서 완료/초기화 모달의 이름, 초기 포커스, 순환, Escape, 복귀와 상태 안내 확인.
5. iPad 회전·Split View·화면 키보드·실제 safe-area에서 패널/모달 스크롤 및 터치 대상 확인. 작은 viewport 검사는 safe-area 장치 검사가 아니다.
6. 실제 reduced-motion 설정과 계절/음료 전환·눈/낙엽·환경음 동시 사용 회귀 확인. 환경음 실제 재생은 통합 검증에서 시도하지 않았다.
7. Safari private browsing/저장 차단·quota 실패에서 메모리 지속 및 notice의 실제 브라우저 동작 확인.

시스템 시각 변경과 다중 탭 동기화 제외 정책은 승인된 MVP 제한을 유지한다. 시각 디자인은 임시이며 Figma refinement는 후속 작업이다. 체크포인트 2에서 개발을 멈추고 사람의 검토를 기다린다.

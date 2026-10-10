<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="ExitOS" width="260">
</picture>

[English](README.md) | **한국어**

### 앱을 옮기기 전에, 무엇이 살아남는지 먼저 확인하세요.

마이그레이션을 미리 보고, 승인하고, 실행하고, 결과를 검증합니다. 잃어버리거나 옮길 수 없는 항목은 처음부터
모두 알려 드립니다. 오픈소스, 로컬 우선, 계정 불필요.

[![CI](https://github.com/Choitim/EXITOS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Choitim/EXITOS/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/github/license/Choitim/EXITOS)](LICENSE)
[![Node.js 22.13+](https://img.shields.io/badge/node-%E2%89%A522.13-339933)](package.json)
[![Status: pre-release](https://img.shields.io/badge/status-pre--release-d97706)](docs/validation-log.md)

[빠른 시작](#빠른-시작) · [오프라인 데모](#오프라인-데모) · [작동 방식](#작동-방식) ·
[Notion → ClickUp](#notion--clickup-마이그레이션) · [기여하기](#기여하기)

<img src="docs/assets/exitos-hero.png" alt="가상의 Notion 워크스페이스를 ClickUp으로 옮긴 결과를 검증한 ExitOS 대시보드. 계획, 실행 내역, 읽기 전용 승인 명령이 보입니다" width="880">

<sub>내장된 가상 워크스페이스에서 띄운 로컬 대시보드(`exitos ui --demo`)입니다. 화면은 실제 출력이고, 데이터는 가짜입니다.</sub>

</div>

## ExitOS란?

앱을 옮기는 일은 보통 이렇게 흘러갑니다. 내보내고, 가져오고, 무엇이 깨졌는지는 그 뒤에야 알게 됩니다.
ExitOS는 이 순서를 바꿉니다.

1. **먼저 읽습니다.** Notion 워크스페이스를 읽기 전용으로 살펴보고 **계획**을 보여 줍니다. 그대로
   _보존_되는 것, _형태가 바뀌는_ 것, _검토가 필요한_ 것, 그리고 _아예 옮길 수 없는_ 것을 구분합니다.
2. **그 계획을 정확히 승인합니다.** 승인하기 전에는 아무것도 쓰지 않고, 원본은 절대 수정하지 않습니다.
3. **안전하게 실행합니다.** 요청 한도, 충돌, 응답 유실로 중단돼도 중복을 만들지 않고 이어서 진행합니다.
4. **결과를 검증합니다.** 계획과 ClickUp에 실제로 들어간 내용을 비교하고, 최종 보고서에는 살아남지 못한
   모든 항목을 그대로 적습니다.

ExitOS는 사용자의 컴퓨터에서 실행됩니다. 데이터는 설정한 두 API(Notion, ClickUp)로만 나가고, 텔레메트리는
없습니다. **v0.1은 Notion 데이터베이스의 행을 ClickUp 작업으로 옮깁니다.**

> **상태: v0.1 프리릴리스.** 엔진, 두 커넥터, CLI, 대시보드는 동작하며 API를 본뜬 가짜 서버에 대해
> 폭넓게 테스트했습니다. **다만 실제 Notion·ClickUp 워크스페이스에서는 아직 검증하지 못했습니다.** 먼저
> 테스트용 워크스페이스에서 시도해 주세요([가이드](docs/live-sandbox-testing.md),
> [검증 기록](docs/validation-log.md)). Notion 페이지 → ClickUp **Docs** 이전은 **실험 기능**입니다.
> ClickUp의 기본 가져오기 기능은 무료이고, 그것만으로 충분할 수도 있습니다
> ([솔직한 비교](docs/competitive-landscape.md)).

## 왜 ExitOS인가요?

| 흔히 겪는 문제                                 | ExitOS의 대응                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 무엇을 잃었는지 가져온 **뒤에야** 알게 됩니다. | 읽기 전용 **계획**이 옮겨지는 것, 바뀌는 것, 검토가 필요한 것, 옮길 수 없는 것을 쓰기 전에 모두 보여 줍니다.                               |
| 무엇을 잃었는지 알기 어렵습니다.               | 지원하지 않거나 손실이 있는 항목은 코드가 붙은 findings로 남고, 보고서에는 항상 **NOT PRESERVED** 절이 있습니다.                           |
| 큰 가져오기가 중간에 실패합니다.               | 체크포인트가 있는 **apply**는 충돌이나 요청 한도 뒤에도 이어서 실행되고, 이미 있는 것은 다시 만들지 않도록 설계했습니다(가짜 서버로 검증). |
| "가져옴"이 "정확함"은 아닙니다.                | **verify**가 계획과 대상에 실제로 있는 것을 비교합니다. 검증을 통과해야만 실행이 완료로 취급됩니다.                                        |
| 데이터가 남의 클라우드를 거칩니다.             | **로컬 우선**: 계정도 텔레메트리도 없고, 설정한 두 API로만 통신합니다.                                                                     |
| 도구가 블랙박스입니다.                         | 적합성 검사 키트가 있는 **오픈 커넥터 SDK**. 엔진과 두 커넥터가 모두 이 저장소에 있습니다.                                                 |

ExitOS가 **더 약한 부분**도 솔직히 적습니다. 지원하는 이전은 하나(Notion → ClickUp)뿐이고, 실제 워크스페이스에서
아직 실행해 보지 못했고, 첨부 파일 자체는 옮기지 않으며, 호스팅 버전이 없고, 자동 되돌리기도 없습니다(ClickUp의
기본 가져오기 기능은 최근 10일 안의 가져오기를 삭제할 수 있습니다). 위 아이디어 중 일부는 다른 도구에도 있고,
일부 주장은 부분적으로만 입증되었습니다. 각 주장이 이 저장소의 무엇으로 입증되는지, 다른 도구는 무엇을 하는지는
[증거 표](docs/competitive-landscape.md#evidence-for-our-positioning)에 항목별로 정리했습니다.

## 작동 방식

```
Inspect  →  Plan  →  Approve  →  Apply  →  Verify
(read)     (read)    (you, by    (writes to  (read)
                      plan id)   the destination only)
```

| 단계        | 명령                                       | 하는 일                                                                     |
| ----------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| **Inspect** | `exitos inspect notion` / `clickup`        | 각 토큰이 볼 수 있는 것을 나열합니다. 읽기 전용.                            |
| **Plan**    | `exitos plan notion clickup`               | 해시로 봉인된 계획을 만들고, 옮겨지는 것과 아닌 것을 출력합니다. 읽기 전용. |
| **Approve** | `exitos apply --plan … --approve <planId>` | 계획 하나를 id로 정확히 승인합니다. 수정된 계획은 거부됩니다.               |
| **Apply**   | (같은 명령)                                | ClickUp에만 쓰며, 동시성 제한, 재시도, 체크포인트를 적용합니다.             |
| **Verify**  | `exitos verify` · `exitos report`          | 계획과 대상을 비교하고, 보존되지 **않은** 것을 보고합니다.                  |

ExitOS가 보고하는 모든 내용은 터미널, 대시보드, 문서에서 똑같이 여섯 가지 상태로 표현됩니다.

| 상태                | 의미                                                       |
| ------------------- | ---------------------------------------------------------- |
| **Preserved**       | 그대로 옮겨집니다.                                         |
| **Transformed**     | 옮겨지지만 형태가 달라집니다(예: 텍스트로).                |
| **Requires review** | 옮겨지지만 일부 세부 정보가 사라집니다. 확인이 필요합니다. |
| **Unsupported**     | 옮길 수 없습니다. 조용히 버리지 않고 목록에 남깁니다.      |
| **Failed**          | 쓰기가 실패했습니다(그에 의존하는 것은 시도하지 않음).     |
| **Verified**        | 대상을 다시 읽어 계획과 일치함을 확인했습니다.             |

## 빠른 시작

**Node.js 22.13 이상**, **pnpm**, **Git**이 필요합니다. `node --version`, `pnpm --version`,
`git --version`으로 확인하세요.

```bash
git clone https://github.com/Choitim/EXITOS.git
cd EXITOS
pnpm install
pnpm build
pnpm exitos demo
```

이 다섯 줄은 macOS 터미널, Linux 셸, **Windows PowerShell**에서 똑같이 동작합니다. 빠진 것이 있으면
`pnpm exitos doctor`가 무엇이 없는지, 어떻게 해결하는지 알려 줍니다.

<details>
<summary><b>사전 요구 사항 설치</b> (macOS, Linux, Windows PowerShell)</summary>

| 시스템                 | 명령                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **macOS**              | `brew install node pnpm git`                                                                                                |
| **Linux**              | 패키지 관리자나 [nvm](https://github.com/nvm-sh/nvm)으로 Node.js 22.13 이상을 설치하고, `npm install -g pnpm`을 실행합니다. |
| **Windows PowerShell** | `winget install OpenJS.NodeJS.LTS`, `winget install Git.Git`, **새** 터미널을 열고, `npm install -g pnpm`을 실행합니다.     |

pnpm 버전은 `package.json`(`packageManager`)에 고정되어 있습니다. 다른 설치 방법은
[pnpm.io/installation](https://pnpm.io/installation)을 보세요. Windows 안내는 문서로만 작성했고
유지보수자가 **직접 테스트하지는 않았습니다**(CI는 Linux와 macOS에서 실행됩니다). 대신 WSL2를 쓰면 안전합니다.

</details>

## 오프라인 데모

데모는 **계정, 자격 증명, 네트워크, 유료 서비스가 모두 필요 없습니다.** 가상의 워크스페이스에서 진짜 Notion·
ClickUp 커넥터를 프로세스 안의 가짜 API에 연결해 실행합니다
([이유](docs/decisions/0008-demo-runs-real-connectors-on-fakes.md)). 복구 과정을 볼 수 있도록 요청 한도와
응답 유실을 일부러 일으킵니다.

```bash
pnpm exitos demo          # inspect → plan → approve → apply → verify, in about a second
pnpm exitos ui --demo     # explore the same run in the local, read-only dashboard
```

<div align="center">

<img src="docs/assets/demo.svg" alt="pnpm exitos demo의 터미널 출력: 옮겨지는 것, 바뀌는 것, 옮길 수 없는 것, 응답 유실에서의 복구, 검증, 보존되지 않은 항목 목록" width="760">

<sub>`pnpm exitos demo`의 실제 출력 일부입니다(가상 데이터). `pnpm docs:assets`로 다시 생성할 수 있습니다.</sub>

</div>

<div align="center">

<img src="docs/assets/exitos-demo.gif" alt="ExitOS 브라우저 데모의 가이드 투어: 샘플 Notion 워크스페이스 선택, 검사, 호환성 미리보기, 매핑 보기, 마이그레이션 재생, 검증 보고서 확인" width="880">

<sub>실제 빌드에서 녹화한 브라우저 데모의 가이드 투어입니다(가상 데이터).</sub>

</div>

직접 해 볼 것: `pnpm exitos demo --interrupt-after 40` 다음에 `pnpm exitos resume --demo`(충돌을 흉내 낸 뒤
복구), `pnpm exitos report --demo --format markdown`(공유할 수 있는 보고서),
`pnpm exitos inspect notion --demo`(모든 속성과 각각의 처리 결과).

**브라우저에서, 아무것도 연결하지 않고:** 이 저장소는 정적이고 시뮬레이션된 데모도 빌드합니다. 실제
대시보드 위에서 가이드 투어(샘플 워크스페이스 → 검사 → 호환성 → 매핑 → 기록된 실행의 **재생** → 검증)를
진행하며, 로그인, 백엔드, Notion·ClickUp으로의 네트워크 접속이 전혀 없습니다. 로컬에서는 `pnpm build:demo`와
`pnpm preview:demo`로 실행합니다. GitHub Pages에 올린 호스팅 버전은 **아직 공개하지 않았습니다.** 동작 방식과
공개 방법은 [docs/online-demo.md](docs/online-demo.md)를 보세요.

<table>
<tr>
<td width="50%"><img src="docs/assets/exitos-preview.png" alt="매핑 미리보기: 모든 소스 속성이 ClickUp의 어디로 가는지, 그리고 보존됨, 변환됨, 검토 필요, 지원 안 함 중 무엇인지 보여 줍니다"></td>
<td width="50%"><img src="docs/assets/exitos-verification.png" alt="검증 보고서: 검증된 항목, 대상별 기대 수와 실제 수, 확인한 것과 확인하지 않은 것"></td>
</tr>
<tr>
<td align="center"><sub><b>미리보기</b>: 쓰기 전에, 무슨 일이 일어날지</sub></td>
<td align="center"><sub><b>검증</b>: 실제로 무엇이 도착했고, 무엇을 확인하지 않았는지</sub></td>
</tr>
</table>

## Notion → ClickUp 마이그레이션

> 먼저 **테스트용 워크스페이스**에서 해 보세요. ExitOS는 Notion을 수정하지 않고 ClickUp의 어떤 것도 삭제하거나
> 덮어쓰지 않지만, **자동 되돌리기는 없습니다.** 만들어진 작업이 필요 없다면 ClickUp에서 직접 지워야 합니다.
> ClickUp은 API로 만든 작업에 지정된 사람에게 알림을 보내므로, 담당자는 사용자가 명시적으로 목록에 적은
> 경우에만 연결합니다. 안전한 첫 실행 방법은 [샌드박스 가이드](docs/live-sandbox-testing.md)를 따르세요.

**1. 자격 증명.** Notion 내부 연결(internal connection)과 ClickUp 개인 API 토큰을 만들고
([Notion](https://developers.notion.com/guides/get-started/internal-connections),
[ClickUp](https://developer.clickup.com/docs/authentication)), 옮기려는 페이지만 Notion 연결과 공유한 다음,
두 토큰을 `.env`에 넣습니다.

```bash
cp .env.example .env && chmod 600 .env     # macOS / Linux
# PowerShell:  Copy-Item .env.example .env
# then edit .env: NOTION_TOKEN=…  CLICKUP_API_TOKEN=…
```

**2. 설정 점검.** `pnpm exitos doctor --live`가 Node.js, 토큰, 프록시, 설정 파일을 확인하고 빠진 것의 해결
방법을 알려 줍니다. `pnpm exitos doctor --online`은 읽기 전용 호출로 토큰이 실제로 동작하는지도 확인합니다.

**3. id를 찾고 설정 파일을 작성합니다.**

```bash
pnpm exitos inspect notion                  # what is shared with your Notion connection
pnpm exitos inspect clickup                 # your Workspaces and List ids
cp migration.example.yaml migration.yaml    # PowerShell: Copy-Item migration.example.yaml migration.yaml
```

**4. 계획, 승인, 실행, 검증.**

```bash
pnpm exitos plan notion clickup                                   # READ-ONLY; writes migration-plan.json
pnpm exitos apply --plan migration-plan.json --approve <planId>   # or omit --approve to be prompted
pnpm exitos verify                                                # a run is not complete until this passes
pnpm exitos report --format markdown --out report.md              # add --redact before sharing it
```

**회사 프록시** 뒤에 있나요? `HTTPS_PROXY`를 설정하세요(프록시가 HTTPS를 검사한다면 `NO_PROXY`,
`NODE_EXTRA_CA_CERTS`도). ExitOS는 `api.notion.com`과 `api.clickup.com` 두 호스트에만 접속합니다. 자세한
내용은 [엔터프라이즈 준비 상태](docs/enterprise-readiness.md)를 보세요. 나머지 명령은 `status`, `resume`,
`ui`, `connectors`이고, `pnpm exitos --help`로 볼 수 있습니다.

## 지원하는 것과 지원하지 않는 것

| 소스 → 대상                                    | 상태             | 비고                                                                                                                                                                         |
| ---------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notion 데이터베이스 행 → ClickUp 작업**      | ✅ 구현됨        | 이름, Markdown 본문, 상태, 우선순위, 시작/마감일(시간대 반영), 매핑한 담당자, 기존 태그와 커스텀 필드, 관계(relation)를 위한 연결 작업. 가짜 서버에 대해서만 테스트했습니다. |
| **Notion 페이지 → ClickUp Docs** (중첩 페이지) | 🧪 실험 기능     | `options.experimental.docs`를 켜야 합니다. 엔드포인트는 실제 환경에서 검증하지 않았고, 일부 블록 유형은 세부 정보를 잃습니다.                                                |
| 그 밖의 모든 것                                | ❌ 구현되지 않음 | v0.1에는 다른 커넥터 조합이 없습니다. 추가하려면 [커넥터 가이드](docs/connector-sdk.md)를 보세요.                                                                            |

**옮겨지지 않는 것:** 첨부 파일과 이미지의 **바이트**(외부 링크는 유지) · 댓글과 토론 · 페이지와
데이터베이스 권한 · 버전 기록 · 보기(view), 필터, 템플릿, 자동화 · 페이지 아이콘과 커버 · ClickUp 커스텀
필드 생성(API가 지원하지 않으므로 이미 있는 필드만 채움) · 하위 작업과 작업 종속성 · 원래의 생성/수정
시각과 작성자(텍스트로 보존) · 수식과 롤업의 _로직_(마지막 값만 텍스트로 보존) · 일부 Notion 전용 블록
유형(토글, 열, 동기화 블록, 콜아웃은 단순화되어 도착). 계획은 매번 이 목록을 출력하고, 영향을 받는 항목은
각각 finding이 됩니다. [docs/finding-codes.md](docs/finding-codes.md)를 보세요.

## 아키텍처

```
 Notion API ──► SourceConnector ──► normalized model ──► DestinationConnector ──► ClickUp API
 (read-only)    discover/inspect/    Collection · Record · plan/validate/apply/    (writes only
                extract/normalize    Document · Block ·    reconcile/verify        in apply)
                                     Relationship · …
                                            │
              planner ► hash-sealed plan ► executor (checkpoints, resume) ► verifier ► reports
                                   SQLite state · local read-only dashboard
```

TypeScript(strict, `any` 금지) · 모든 신뢰 경계에 Zod · Node 내장 `node:sqlite`로 SQLite 사용 ·
Vitest와 Playwright · 대시보드는 React, Vite, Tailwind. 소스와 대상은 정규화된 모델을 통해서만 대화하므로,
새 커넥터는 독립된 작업 단위가 됩니다. [아키텍처](docs/architecture.md), [안정성 모델](docs/reliability.md)
(무엇이 보장되고 무엇이 **보장되지 않는지**: 정확히 한 번 전달은 약속하지 않습니다), [보안 검토](docs/security-review.md)를
읽어 보세요.

## 로드맵

실제 환경 검증과 안정화 → 스트리밍 추출과 선택형 첨부 파일 이전 → 두 번째 커넥터 조합. 자세한 내용과
엔터프라이즈 트랙은 [ROADMAP.md](ROADMAP.md)와 [docs/enterprise-readiness.md](docs/enterprise-readiness.md)에
있습니다. 후자는 ExitOS를 엔터프라이즈 수준이라고 부르기에 무엇이 아직 부족한지 숨김없이 적고 있습니다.

## 기여하기

기여는 언제나 환영하며, 가장 가치 있는 기여는 테스트 워크스페이스에서 얻은 **실제 환경 검증 보고서**입니다.
[CONTRIBUTING.md](CONTRIBUTING.md), [로컬 개발 가이드](docs/development.md), [테스트 가이드](docs/testing.md)로
시작하고, [첫 기여 아이디어](docs/good-first-contributions.md)에서 작은 일을 골라 보거나
[커넥터 가이드](docs/connector-sdk.md)로 커넥터를 만들어 보세요. [행동 강령](CODE_OF_CONDUCT.md)을
지켜 주시고, 취약점은 [SECURITY.md](SECURITY.md)에 적힌 방법으로 알려 주세요. ExitOS 덕분에 힘든 이전을 피했다면, 별을
눌러 주시면 다른 사람이 찾는 데 도움이 됩니다.

## 라이선스

[Apache License 2.0](LICENSE). "ExitOS"는 상표 검토를 거치지 않은 임시 이름입니다
([docs/naming.md](docs/naming.md)).

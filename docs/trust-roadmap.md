# 신뢰 장벽 낮추기: 서명·배포·첫 실행

MonoField를 처음 받는 사람이 설치를 망설이는 이유는 세 가지입니다.

1. 서명되지 않은 설치 파일이라 Windows가 "알 수 없는 게시자" 경고를 띄운다.
2. 저장소와 문서에 이전 프로젝트 이름(Open Design / Open Docs)과 오래된 기록이 남아
   있다.
3. 설치 후에야 Codex 또는 Claude Code CLI가 필요하다는 사실을 알게 된다.

이 문서는 세 가지에 대한 현재 상태와 다음 단계를 정리합니다. 릴리스 절차 자체는
[Windows releases](windows-release.md)와
[Microsoft Store release](windows-store-release.md)를 따릅니다.

## 1. 코드 서명

### 현재 상태

- `release-windows.yml`은 `signed=true`일 때 PFX 인증서를 GitHub Secrets
  (`OD_WIN_SIGN_CERT_PFX_BASE64`, `OD_WIN_SIGN_CERT_PASSWORD`,
  `OD_WIN_SIGN_CERT_SHA1`)에서 읽어 서명하고 Authenticode 상태를 검증합니다.
- 지금까지의 공개 릴리스는 `allow_unsigned=true`로 배포됐고, 릴리스 노트에 미서명
  사실과 `SHA256SUMS.txt` 검증 방법을 공개합니다.

### 걸림돌

2023년 6월 1일부터 CA/B Forum 규칙에 따라 새로 발급되는 OV·EV 코드 서명
인증서의 개인 키는 하드웨어 보안 모듈(USB 토큰·HSM·클라우드 HSM)에서 생성·보관해야
하며 내보낼 수 없습니다. 즉 **새로 구매한 인증서는 PFX 파일로 만들 수 없어**
현재 워크플로의 PFX-Secrets 방식을 그대로 쓸 수 없습니다.

### 선택지

| 경로 | 조건 | 워크플로 변경 | 비고 |
| --- | --- | --- | --- |
| **Microsoft Store 배포** | Partner Center 계정, Store 인증 통과 | 없음 — Store가 MSIX를 서명 | 이미 `windows-store-release.md`에 AppX 업로드 경로가 있음. 경고 없는 설치 경로를 가장 빨리 만들 수 있음 |
| **Azure Artifact Signing**(구 Trusted Signing) | 공개 신뢰 인증서는 한국 **법인·조직**은 신청 가능, **개인 개발자는 미국·캐나다만** 가능 | 서명 단계를 Artifact Signing 액션/`signtool` dlib 방식으로 교체 | 2026년 1월 GA. 개인 명의로는 현재 불가 |
| **CA의 클라우드 서명**(키 보관 서비스) | OV/EV 인증서 구매 + 신원 확인 | 공급사 CLI로 원격 서명하는 단계 추가 | 개인·조직 모두 가능하지만 연 비용이 듦 |
| 미서명 유지 | 없음 | 없음 | 현재 상태. SHA-256 검증 안내 필수 |

### 권장 순서

1. **Store 인증을 먼저 끝냅니다.** 일반 사용자에게는 Store 설치가 경고 없는 기본
   경로가 되고, 사이트의 Store 버튼(`monofield-store-product-id`)을 채우면 됩니다.
2. 직접 다운로드 설치 파일도 서명하려면 **조직 명의(사업자)로 Artifact Signing**을
   신청하거나 CA 클라우드 서명을 구매한 뒤, `release-windows.yml`의 서명 단계를
   PFX 방식에서 원격 서명 방식으로 바꿉니다. 이 변경은 별도 PR로 진행하고, 기존
   `signed`/`allow_unsigned` 증빙 필드와 Authenticode 검증은 그대로 유지합니다.
3. 서명이 적용되기 전까지는 릴리스 노트와 README의 미서명 안내, `SHA256SUMS.txt`
   검증 안내를 유지합니다.

신청 조건과 비용은 자주 바뀌므로 신청 시점에 각 공급사 문서에서 다시 확인합니다.

## 2. 이름과 오래된 기록 정리

| 항목 | 상태 |
| --- | --- |
| 루트 `HANDOFF.md`, `design-browser-task-handoff.md` (다른 세션·다른 PC의 작업 인계 기록, 개인 경로 포함) | 저장소에서 제거. Git 기록에는 남아 있음 |
| `CONTEXT.md` 용어집 제목·설명이 "Open Design" | MonoField 기준으로 갱신. 상위 프로젝트 고유 개념(AMR)은 출처를 밝혀 유지 |
| `RELEASE-NOTES-0.11.6.md`의 "미배포" 상태 표시 | 2026-10-07 배포 사실로 갱신 |
| Git에 들어간 `__pycache__/*.pyc` | 추적 해제(`.gitignore`에는 이미 포함) |
| 워크스페이스 패키지 이름 `@open-design/*`, 내부 `OD_*` 환경 변수, `od://` 프로토콜 | **유지.** 이름 변경은 모든 import·설정·설치 레지스트리에 영향을 주는 큰 변경이라 [유지보수 방향 결정](adr/0002-upstream-maintenance.md)에 따라 별도로 진행 |

## 3. 첫 실행 안내

- 온보딩 첫 단계(Connect)에 "개발·명세서 전체 흐름에는 Codex 또는 Claude Code CLI가
  필요하고, API 키(BYOK)만으로는 대화와 문서 생성만 된다"는 안내를 표시합니다.
- README의 **What you need / 필요한 것**과 사이트 히어로 하단에 같은 조건을
  적습니다.
- 에이전트가 감지되지 않을 때의 기존 안내(`settings.noAgentsDetected`)는 그대로
  유지합니다.

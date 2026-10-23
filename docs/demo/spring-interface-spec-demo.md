# 3분 시연: 레거시 Spring → 인터페이스 명세서 → 코드 변경 → 명세서 갱신 검토

MonoField의 대표 흐름을 한 번에 보여 주는 시연입니다. 대상은 한국 SI·공공
프로젝트 개발자와 인수인계 담당자입니다.

```text
프로젝트 폴더 열기  →  명세서 생성  →  코드 변경  →  명세서 갱신 diff 검토
```

시연용 코드는 실제 고객 코드가 아닌 합성 레거시 주문 시스템입니다.

| 경로 | 내용 |
| --- | --- |
| `plugins/_official/interface-spec/fixtures/spring/` | Spring Boot 2.7 주문·회원 API 5개, DTO, JWT 보안 설정, 프로젝트 용어 사전(`docs/term-dictionary.csv`) |
| `plugins/_official/interface-spec/fixtures/spring-change/` | 시연 중 적용할 코드 변경: 주문 등록에 `deliveryMemo` 필드 추가, `POST /api/v1/orders/{orderId}/cancel` 취소 API 추가 |
| `e2e/scripts/spring-spec-demo.ts` | 위 흐름을 모델 호출 없이 재현하고 결과를 검증하는 스크립트 |

## 준비 (시연 전 1회)

1. Windows용 MonoField를 설치하고, **Codex CLI 또는 Claude Code CLI**를 PC에
   설치·로그인합니다. MonoField는 이 에이전트를 실행하는 작업대입니다.
2. 시연용 폴더를 하나 만들고 `fixtures/spring/` 내용을 복사한 뒤 Git 저장소로
   만듭니다.

   ```bash
   cp -r plugins/_official/interface-spec/fixtures/spring ~/demo/legacy-order
   cd ~/demo/legacy-order && git init && git add -A && git commit -m "baseline"
   ```

3. 소스에서 바로 결과를 확인하려면 아래 스크립트를 먼저 돌려 봅니다. 산출물은
   저장소의 `.tmp/spring-spec-demo/<id>/`에 생깁니다.

   ```bash
   pnpm install
   pnpm --filter @open-design/daemon build
   pnpm exec tsx e2e/scripts/spring-spec-demo.ts
   ```

## 시연 대본 (약 3분)

| 시간 | 화면에서 할 일 | 말할 내용 |
| --- | --- | --- |
| 0:00–0:20 | Home에서 **인터페이스 명세서** 카드가 맨 앞에 있는 것을 보여 주고, 작업 폴더로 `legacy-order`를 선택합니다. | "이미 쓰는 Codex·Claude Code를 그대로 쓰고, 폴더가 작업 경계입니다." |
| 0:20–1:10 | **인터페이스 명세서** 카드 → "선택한 Spring 프로젝트의 Controller를 스캔해서 인터페이스 명세서 Excel을 만들어 줘"를 보냅니다. 작성 방식은 **코드베이스에서 생성**, **한글-영어 매핑 사전**은 **사전 업로드**를 고르고 `docs/term-dictionary.csv`를 올립니다. | "명세서의 근거는 코드입니다. 각 필드에 출처 파일과 줄이 남습니다." |
| 1:10–1:40 | 생성된 `*.interface-spec.json`을 열고 XLSX로 출력합니다. 표지, 인터페이스 목록, API별 시트 5개를 넘겨 봅니다. | "결정론적 렌더러가 SI 양식 Excel을 만듭니다. AI는 엑셀을 직접 고치지 않습니다." |
| 1:40–2:10 | 채팅으로 "주문 등록에 배송 요청 사항(deliveryMemo)을 추가하고 주문 취소 API를 만들어 줘"를 보냅니다. **변경** 탭에서 diff와 빌드 결과를 확인합니다. | "코드 수정은 에이전트가 하고, 결과는 diff와 빌드로 확인합니다." |
| 2:10–2:50 | 명세서 편집기에서 **Git 변경 분석** → **AI 갱신 요청 작성** → 전송 → **AI 제안 검토**를 누릅니다. `IF-ORD-001`에 `deliveryMemo`, 새 `IF-ORD-004 주문 취소`만 제안된 것을 보여 줍니다. | "바뀐 인터페이스만 변경분으로 제안합니다. 원본이 그 사이 바뀌면 적용을 거부합니다." |
| 2:50–3:00 | **검토한 제안 적용** → 저장 → v1.1 XLSX 출력, **OpenAPI 내보내기**. 제안 검토 화면 위쪽의 **호출자 호환성**이 "추가 변경"인 것도 짚습니다. | "코드가 바뀔 때마다 명세서도 검토된 상태로 따라가고, 같은 내용을 게이트웨이·Mock 서버용 OpenAPI로도 넘깁니다." |

> 녹화 팁: 1:40–2:10 구간의 모델 응답 시간은 환경마다 다릅니다. 녹화본에서는
> 대기 구간을 잘라 3분에 맞춥니다.

## 같은 흐름을 CLI로

UI와 같은 daemon API를 사용합니다. 아래 명령은 MonoField가 실행 중이고 해당
폴더가 프로젝트로 열려 있을 때 동작합니다.

```bash
# 2. 명세서 생성(정적 스캔) 후 XLSX 출력
python plugins/_official/interface-spec/scripts/scan_spring.py \
  --codebase-path ~/demo/legacy-order \
  --name-dict ~/demo/legacy-order/docs/term-dictionary.csv \
  --out ~/demo/legacy-order/docs/orders.interface-spec.json
monofield docs render-interface-spec --input ~/demo/legacy-order/docs/orders.interface-spec.json

# 4. 코드 변경 후 영향 분석 → 에이전트가 *.proposed.json 작성 → 검증
monofield docs impact --project <project-id> --input docs/orders.interface-spec.json --json
monofield docs proposal --project <project-id> \
  --input docs/orders.interface-spec.json \
  --proposal docs/orders.interface-spec.proposed.json \
  --expected-sha <contentSha256> --json   # compatibility: breaking / warning / info

# 5. 검토된 명세서를 OpenAPI 3.1로 내보내기 (편집기의 "OpenAPI 내보내기"와 같은 경로)
monofield docs export-openapi --project <project-id> --input docs/orders.interface-spec.json --json
```

이미 팀이 관리하는 OpenAPI/Swagger JSON(springdoc `/v3/api-docs` 등)이 있으면
`scan_openapi.py --spec <openapi.json>`으로 명세서를 바로 시작할 수 있습니다.

세부 규칙은 [근거 기반 명세서와 변경 검토](../document-change-review.md)를
참고하세요.

## 재현 스크립트가 확인하는 것

`e2e/scripts/spring-spec-demo.ts`는 시연의 코드 변경을 `spring-change/`
오버레이로, 에이전트의 갱신 제안을 재스캔 결과의 변경분으로 대신합니다. 그래서
모델 비용 없이 같은 결과를 반복해서 만들 수 있습니다. 실제 시연에서는 이 두
단계를 Codex 또는 Claude Code가 수행합니다.

- 스캔 결과가 `interface-spec` 계약(`packages/contracts`)을 통과하는지.
- v1.0 XLSX가 5개 인터페이스로 출력되는지.
- 변경분 제안이 daemon과 같은 `applyInterfaceSpecProposal`로 검증·병합되는지.
- 다른 원본 해시로 만든 제안은 거부되는지.
- v1.1 XLSX에 새 필드와 새 인터페이스가 반영되는지.
- OpenAPI 3.1로 내보낸 뒤 `scan_openapi.py`로 다시 수집해도 인터페이스 ID,
  필드 경로, 인증 필요 여부가 그대로인지(왕복 일치). 인증이 필요하지만 방식이
  정해지지 않은 엔드포인트는 공개(`security: []`)로 내보내지 않고
  `x-auth-undecided: true`로 표시하며, 다시 수집하면 "인증 여부 확인
  필요"(`auth.type: "undecided"`)로 돌아옵니다.

2026-10-22 실행 결과(Linux, Node 24.22.1, Python 3.13):

```text
▸ 1. 프로젝트 폴더 열기
▸ 2. 명세서 생성
  5 interfaces → legacy-order/docs/orders-interface-spec-v1.0.xlsx (25121 bytes)
▸ 3. 코드 변경
  OrderController.java, OrderService.java, OrderCancelRequest.java, OrderCreateRequest.java
▸ 4. 명세서 갱신 diff 검토
  2 changes (4234 chars vs 11653 chars full doc) → legacy-order/docs/orders-interface-spec-v1.1.xlsx
▸ 5. OpenAPI 3.1 내보내기
  5 paths → legacy-order/docs/orders.openapi.json; re-collected 6 interfaces with identical field paths

검토 대상 변경:
  IF-ORD-001 POST /api/v1/orders — added request fields: deliveryMemo
  IF-ORD-004 POST /api/v1/orders/{orderId}/cancel — added interface: orderId, reasonCode, reasonDetail
```

v1.0 워크북은 시트 8개(표지·목록 3개 + API 5개), v1.1은 `주문 취소` 시트가 더해진
9개입니다. `deliveryMemo`·`배송요청사항`·`IF-ORD-004`는 v1.1에만 있습니다.

## 알려진 한계

- 인터페이스 ID(`IF-ORD-001`)는 코드에서 확정할 수 없어 검토 단계에서
  채웁니다. 업무명은 핸들러의 한글 Javadoc(`/** 주문 등록 */`)이 있으면 그
  문장을 쓰고, 없으면 검토 대상입니다. 스크립트는 두 값을 고정 표로 넣습니다.
- 한글 필드명은 지정한 용어 사전 → 필드의 한글 주석(`/** 회원 ID */`,
  `// 회원 ID`) → 영문 분리 순서로 정합니다. 주석도 사전도 없으면 `member Id`
  처럼 남으므로 검토 대상입니다.
- 인증 필요 여부(`authRequired`)는 경로 모양이 아니라 Java 보안 설정
  (`SecurityFilterChain`, `WebSecurityConfigurerAdapter`)의 규칙과
  `@PreAuthorize`·`@Secured`·`@RolesAllowed` 애너테이션으로 정하고, 근거가 된
  설정 파일과 줄을 `evidenceRefs`에 남깁니다. 시연 코드에서는
  `/api/v1/members/join`만 `permitAll()`이라 인증 불필요, 나머지는
  `anyRequest().authenticated()`라 인증 필요입니다.
- 근거로 판정할 수 없는 엔드포인트는 추정하지 않고 "인증 여부 확인
  필요"(`auth.type: "undecided"`)로 남기며, 비고에 이유를 적습니다. 보안 설정이
  없을 때, 일치하는 규칙이 없을 때, 직접 만든 매처나 `hasIpAddress`처럼 정적으로
  해석할 수 없는 규칙일 때, method가 없는 `@RequestMapping`에서 GET과 POST의
  판정이 다를 때가 여기에 해당합니다.
- XML 보안 설정(`context-security.xml` 등), 서블릿 필터, `HandlerInterceptor`는
  읽지 않습니다. 이것으로만 보호하는 eGovFrame 프로젝트의 `.do` URL은 "인증 여부
  확인 필요"로 남으므로 검토 단계에서 확정합니다. 서비스 계층의 메서드 보안
  애너테이션과 직접 만든 메타 애너테이션도 보지 않습니다.
- 스크립트의 제안은 실제 에이전트 출력이 아니라 재스캔 결과의 결정론적
  변경분입니다. 실제 에이전트 제안의 품질은 사용한 모델과 설정에 따라 다릅니다.

# 실제 프로젝트 검증: RealWorld와 전자정부 공통컴포넌트 (2026-11-11)

[가상 ABT 실험](abt-scanner-vs-claude-code-2026-11-09.md)의 숫자는 제가 만든 코드에서 잰 것이라, 공개된 실제 Spring 프로젝트 두 개로 다시 쟀습니다. 측정 중에 스캐너가 놓치는 실제 코드 모양을 여섯 가지 찾아 고쳤고, 아래 표는 고치기 전과 후입니다.

## 대상

| 프로젝트 | 버전 | 성격 | 정답을 어떻게 정했나 |
| --- | --- | --- | --- |
| [spring-boot-realworld-example-app](https://github.com/gothinkster/spring-boot-realworld-example-app) | `ee17e31` (2022-06-08) | Spring Boot REST API, Gradle, google-java-format, 컨트롤러 이름이 `*Api` | RealWorld 프로젝트가 구현과 따로 관리하는 공식 OpenAPI 문서 ([gothinkster/realworld](https://github.com/gothinkster/realworld) `2558884`의 `specs/api/openapi.yml`) |
| [전자정부 표준프레임워크 공통컴포넌트](https://github.com/eGovFramework/egovframe-common-components) | `e5c1347b` (2026-11-06) | 전자정부식 `.do` 컨트롤러 164개, Java 파일 1,103개 | 정답 문서가 없어 매핑 애너테이션 수를 따로 세고, 실제 커밋 20개의 diff를 사람이 확인 |

## RealWorld: 공식 OpenAPI 문서와 비교

필드는 말단 필드만 셉니다(공식 문서도 `user.email`처럼 말단만 정의합니다).

| 지표 | preview.9 스캐너 | 컨트롤러 탐지만 고친 뒤 | 모두 고친 뒤 |
| --- | --- | --- | --- |
| 경로 | 0/19 | 17/19 (2개는 메서드가 GET/POST) | **19/19** |
| 로그인 필요 여부 | — | 맞음 17, 미정 2 | **맞음 19, 틀림 0, 미정 0** |
| 요청 필드 찾음 / 정밀도 | — | 50% / 56% | **97% / 100%** (37/38) |
| 응답 필드 찾음 / 정밀도 | — | 0% | **87% / 93%** (122/140), 감사 필드 포함 옵션을 켜면 **100% / 94%** (140/140) |

남은 차이는 스캐너가 아니라 구현과 공식 문서가 다른 곳입니다. 코드를 직접 확인했습니다.

- 요청에서 못 찾은 1개(`PUT /articles/{slug}`의 `article.tagList`): 이 구현의 `UpdateArticleParam`에는 `tagList`가 없습니다.
- 응답의 추가 9개(`article.id`, 목록의 `articles.body` 등): 이 구현의 `ArticleData`가 실제로 내보내는 필드인데 공식 문서에는 없습니다.
- 응답에서 빠진 18개(`createdAt`, `updatedAt`): 감사 필드 규칙으로 기본 제외되는 이름입니다. `--include-audit-fields`로 포함됩니다.

## 전자정부 공통컴포넌트: 규모와 실제 커밋

| 지표 | 결과 |
| --- | --- |
| 찾은 API | 1,206개. 매핑 애너테이션을 따로 센 1,218개의 99% (차이 12개는 아직 조사하지 않음) |
| 걸린 시간 | 2.8~3.2초 (Java 파일 1,103개) |
| 로그인 필요 여부 | 1,206개 모두 미정. 이 프로젝트는 실행 프로필(dummy·session·security)에 따라 인증 방식이 바뀌고, security 프로필에서는 URL 규칙을 DB에 둡니다. 코드만 보고는 정할 수 없으므로 미정이 맞는 답입니다. |
| 메서드 | 415개는 `@RequestMapping`에 메서드 지정이 없어 모든 메서드를 받습니다(GET/POST로 표시). |
| 응답 필드 | 22개뿐. 대부분의 핸들러가 JSON이 아니라 JSP 화면 이름을 돌려주고, 화면에 넘기는 모델 값은 응답 필드로 세지 않습니다. |

### 실제 커밋 20개 다시 보기

커밋마다 직전과 직후의 코드를 스캔해 제품의 호환성 비교로 분류하고, 보고된 변경을 실제 diff와 하나씩 대조했습니다.

| 커밋 | 실제 변경 | 보고 | 판정 |
| --- | --- | --- | --- |
| `734940a2`, `53bc6841` | 선택 파라미터 `deptIndictOrdr` 복원 (API 2개) | 추가 변경 2 | 맞음 |
| `93a3efd4`, `983f2a70`, `101f0988`, `9569be78` | `@RequestMapping`을 `@PostMapping`으로 (API 3·2·3·1개) | 호환성 깨짐 + 추가 변경, API마다 한 쌍 | 맞음. GET 호출이 막히는 변경입니다. 다만 "메서드 축소" 하나가 아니라 "삭제 + 추가" 두 줄로 나옵니다. |
| `e4823589` | 선택 파라미터 `length` 추가, `lenght`의 `int`→`Integer`, 기본값 5 제거 | 추가 변경 1 (고치기 전에는 `int`→`Integer`를 호환성 깨짐으로 잘못 보고) | 맞음. 기본값 제거는 못 잡음 |
| `50c1a023`, `47abffcb` | 기업회원 등록 VO에서 `password` 삭제(API 4개), 탈퇴 API 추가 | 확인 필요 4 + 추가 변경 1 | 맞음 |
| `e24018c7` | 필수 파라미터 `nextUrl` 추가 | 호환성 깨짐 1 | 맞음 |
| `4087ebed` | `/uat/uia/actionSecurityProcess.do` 삭제 | 호환성 깨짐 1 | 맞음 |
| `ab3cbb52` | 클래스 이름 오타 수정 | 없음 | 맞음 |
| `b48b717a` | OAuth state 검증 (`HttpSession` 인자 추가) | 없음 | 맞음 |
| `e3ff2ef1`, `39cf043f`, `68bbc0ee` | 예외 선언 리팩터링 | 없음 | 맞음 |
| `cd64d215`, `00a0d785`, `e19112e0`, `0936ea12` | 이클립스 코드 포맷 | 없음 | 맞음 |

API를 바꾼 커밋 12개에서 보고된 변경 35건이 모두 실제 diff와 맞았습니다(고치기 전에는 36건 중 1건이 잘못된 경보). API를 바꾸지 않은 커밋 8개에서는 잘못된 경보가 0건이었습니다. 놓친 것은 형식 밖 변경인 기본값 제거 1건입니다. 대조는 매핑·파라미터·VO 필드가 바뀐 diff 줄 범위에서 했고, 그 밖의 방식으로 바뀐 API가 있었는지는 확인하지 못했습니다.

## 고친 것

모두 `plugins/_official/interface-spec/scripts/tests/test_spring_real_world_shapes.py`(8개)와 `packages/contracts/tests/interface-spec-compatibility.test.ts`에 실패하는 시험을 먼저 쓰고 고쳤습니다.

1. **컨트롤러를 파일 이름이 아니라 애너테이션으로 찾습니다.** `*Controller.java`만 보던 탓에 `ArticleApi`, `TagsResource` 같은 이름은 통째로 빠졌습니다. 이제 `@Controller`·`@RestController`가 붙은 클래스를 찾고, `@ControllerAdvice`는 제외합니다.
2. **정적 import로 쓴 메서드 지정(`method = POST`, `method = {GET, POST}`)을 읽습니다.**
3. **`int`와 `Integer`처럼 기본형과 감싼 형을 같은 타입으로 비교합니다.** 호출하는 쪽에서는 같은 숫자입니다.
4. **`@JsonRootName("user")`을 읽습니다.** 프로젝트 설정(`application.properties`·`application.yml`)에 `UNWRAP_ROOT_VALUE`가 켜져 있으면 요청 본문을 `user` 아래에, `WRAP_ROOT_VALUE`가 켜져 있으면 응답을 그 아래에 둡니다. 설정이 없으면 Spring처럼 감싸지 않습니다.
5. **`ResponseEntity<?>` 응답의 내용을 따라갑니다.** `ok(...)`나 `body(...)`에 넘긴 값이 같은 클래스의 도우미 메서드, 인라인 `new HashMap<>() {{ put(...) }}`, `this::helper`, 서비스 호출 결과일 때 키와 값의 타입을 읽고, 그 DTO의 필드를 키 아래에 펼칩니다.
6. **한 파일에 든 여러 최상위 클래스를 각각 읽습니다.** 컨트롤러 파일 안의 `LoginParam` 같은 요청 클래스를 놓쳤고, 클래스마다 자기 본문만 읽도록 고쳐 다른 클래스의 필드가 섞이지 않게 했습니다.

같은 정답표로 다시 잰 ABT 결과는 그대로입니다(경로 68/68, 요청 필드 315/315, 응답 필드 98%, 로그인 68/68, 변경 152건, 영향 API 34/34).

## 남은 한계

- 실행 프로필이나 DB에 둔 접근 규칙으로 인증을 정하는 프로젝트(전자정부 공통컴포넌트)는 로그인 여부가 미정으로 남습니다.
- 메서드를 좁힌 변경(GET/POST → POST)이 "API 삭제 + 추가" 두 줄로 나옵니다. 판정(호환성 깨짐)은 맞습니다.
- 기본값·열거값·권한 범위 변경은 아직 못 찾습니다.
- JSP에 넘기는 모델 값은 응답 필드로 세지 않습니다.
- 여러 클래스에 걸쳐 조립하는 응답, 람다를 여러 겹 거치는 응답은 따라가지 못합니다.
- Kotlin 컨트롤러는 읽지 않습니다.
- 두 프로젝트 모두 각자의 한 시점에서 잰 결과입니다.

## 재현

[`plugins/_official/interface-spec/benchmark/real/README.md`](../../plugins/_official/interface-spec/benchmark/real/README.md)를 보세요. `compare_openapi.py`가 공식 문서와 비교하고, `replay_commits.sh`가 커밋을 다시 봅니다.

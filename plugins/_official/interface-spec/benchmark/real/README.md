# 실제 프로젝트 검증 도구

가상 시스템(ABT)이 아닌 공개된 실제 Spring 프로젝트로 스캐너를 재는 도구입니다. 결과와 해석은 [docs/testing/real-projects-2026-11-11.md](../../../../../docs/testing/real-projects-2026-11-11.md)에 있습니다.

## 독립 정답과 비교 (RealWorld)

```bash
git clone https://github.com/gothinkster/spring-boot-realworld-example-app.git
git clone https://github.com/gothinkster/realworld.git
python3 ../../scripts/scan_spring.py --codebase-path spring-boot-realworld-example-app --out rw.json
python3 compare_openapi.py realworld/specs/api/openapi.yml rw.json --detail
```

`compare_openapi.py`는 공식 OpenAPI 문서(구현과 따로 작성된 정답)의 경로·요청 필드·응답 필드·인증 여부와 스캔 결과를 비교합니다(PyYAML 필요). 필드는 말단 필드만 셉니다.

## 실제 커밋 다시 보기 (전자정부 공통컴포넌트)

```bash
git clone https://github.com/eGovFramework/egovframe-common-components.git
./replay_commits.sh egovframe-common-components out 734940a2 93a3efd4 e24018c7
```

`replay_commits.sh`는 커밋마다 직전과 직후의 `src/main`을 꺼내 스캔하고, 제품에 들어 있는 호환성 비교로 분류합니다. MonoField 저장소에서 `pnpm install`과 `pnpm --filter @open-design/contracts build`가 먼저 필요합니다. 보고된 변경이 실제 diff와 맞는지는 사람이 확인합니다.

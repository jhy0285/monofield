# ABT 비교 실험 도구

가상의 교통 ABT(계정 기반 승차권) 요금·결제·정산 플랫폼을 도메인 모델에서 생성하고(`gen/`), 같은 코드를 MonoField 스캐너와 일반 Claude Code에 주어 정답표와 비교하는 도구입니다. 결과와 해석은 [docs/testing/abt-scanner-vs-claude-code-2026-11-09.md](../../../../../docs/testing/abt-scanner-vs-claude-code-2026-11-09.md)에 있습니다.

실제 시스템·사업자와 무관한 가상 시스템입니다. 생성한 코드는 Spring Boot 3.3.5로 컴파일됩니다(인터넷과 JDK 17+, Maven 필요).

## 모델 호출 없이 도는 부분

```bash
cd plugins/_official/interface-spec/benchmark/abt
python3 gen/build.py $PWD/work                     # work/abt-platform (git 2커밋: baseline, sprint) + work/truth/*.json
B=$(python3 -c "import json;print(json.load(open('work/truth/stats.json'))['base'])")
H=$(python3 -c "import json;print(json.load(open('work/truth/stats.json'))['head'])")
python3 mf_arm.py work/abt-platform work/truth out/mf $B $H   # MonoField 스캐너 + 호환성 분류 (pnpm install 필요)
# 스캐너 인자를 더 주려면: MF_SCAN_ARGS="--include-audit-fields" python3 mf_arm.py ...
python3 eval_all.py > out/report.json              # 채점
```

`mf_arm.py`는 저장소 루트에서 `pnpm exec tsx e2e/scripts/abt-compare.ts`를 호출합니다(`pnpm install` 이후).
컴파일 확인: `git -C work/abt-platform checkout <sha> && (cd work/abt-platform && mvn -q -DskipTests compile)`.

## 일반 Claude Code 쪽 (모델 호출, 비용 발생)

`plain_run.sh <회차> <단계 1|2> <모델> [n]`. 4번째 인자 `n`은 짧은 지시문(`prompts/p1n.txt`, `p2n.txt`), 없으면 상세 지시문(`p1.txt`, `p2.txt`)입니다. 회차마다 `plain/run<회차>/`에 저장소 복제본을 만들고 `claude -p`를 돌립니다. 1단계가 `spec_v1.json`, 2단계가 `spec_v2.json`과 `changes.json`을 씁니다. 한 주기(1+2단계)에 $1 안팎입니다.

## 구성

- `gen/dsl.py`: 도메인 모델 구조와 정답표 계산(경로, 요청·응답 필드, 인증)
- `gen/domain.py`: 가상 시스템 정의(API 68개, DTO 107개)
- `gen/emit.py`: Java·Maven·XML 코드 생성
- `gen/mutate.py`: 스프린트 변경 29건과 변경 정답표
- `gen/build.py`, `gen/retruth.py`: 저장소와 정답표 생성, 정답표만 다시 쓰기
- `score.py`: 채점(경로·필드·인증·변경 탐지·분류)
- `mf_arm.py`, `eval_all.py`, `plain_run.sh`, `prompts/`: 실행과 종합

`work/`, `out/`, `plain/`은 생성물이라 커밋하지 않습니다.

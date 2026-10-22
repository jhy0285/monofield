# REA SI 인수인계 재현

Node 24.15+, Chromium, 빌드된 REA와 MonoField가 필요합니다. 합성 데이터만 생성하며 출력 경로는 존재하지 않아야 합니다. 실행기·생성기·collector는 제품 런타임 API가 아닌 검증용 예제입니다.

```sh
node run-demo.ts /absolute/path/to/rea-yj /absolute/path/to/monofield /absolute/path/to/new-run
```

실제 REA 정적·브라우저·SQLite 근거를 수집하고 MonoField 문서 CLI로 XLSX/PPTX/HTML을 출력합니다. REA와 MonoField 설치·빌드는 각 저장소 가이드를 따르세요. 기본 Chromium 경로는 두 scenario JSON에서 바꿀 수 있습니다. 기존 출력은 덮어쓰지 않으며 자신이 시작한 앱을 종료합니다.

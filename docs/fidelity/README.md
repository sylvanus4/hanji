# 충실도(fidelity) 코퍼스 (P0-c)

`docs/PLAN.md`의 P0-c: "HWP/HWPX 실문서 20~30개로 충실도 코퍼스 구성(공문서·시험지·표 많은
문서·수식 포함)". 이 문서는 그 산출물의 정본이다.

## 1. 이 프로젝트에서 "충실도"가 뜻하는 것

hanji는 한컴 기준 렌더러를 갖고 있지 않다. README.en.md "Hangul fidelity" 절이 이미 이렇게
말한다: *"We have no Hancom reference renderer, so 'correct' here means matches rhwp before
the regression and stays inside the page. Building a real fidelity corpus for Hangul documents
is on the roadmap."* 즉 **픽셀 단위로 한컴 오피스 출력과 대조하는 의미의 충실도는 이 생태계
전체에 기준선이 없어 측정 불가능하다.** rhwp 자신도 README에서 한컴 PDF를 정답으로 삼지
않는다고 밝히고 있다(`docs/PLAN.md` 1.6절).

측정 가능한 것은 따로 있다. hanji가 실제로 쓰는 엔진(`@rhwp/core`, `vendor/rhwp-core`에 hanji
자체 패치가 적용된 빌드)이 구조적으로 올바르게 동작하는지는 기준선 없이도 확인할 수 있다:

1. **파싱이 성공하는가** (throw 없이 문서가 열리는가)
2. **표/박스가 페이지를 벗어나지 않는가**: README.en.md가 명시한 정확히 그 회귀
   (`rhwp` `10c36e23`, block-level 표가 앞선 탭 폭만큼 밀려 페이지 밖으로 나가는 버그)를
   `e2e-smoke.py`는 1페이지에서만 검사한다. 이 코퍼스의 하네스는 **모든 문서의 모든
   페이지**에서 같은 검사를 한다.
3. **페이지 수가 문서의 속성으로서 안정적인가**: HWP↔HWPX 라운드트립(엔진 자체의
   `exportHwp`/`exportHwpx`로 내보낸 뒤 재파싱)을 거쳐도 페이지 수가 보존되는가.

이 세 가지가 "충실도"의 정의다. 한컴 대비 시각적 정확성이 아니라 **엔진이 구조를 깨뜨리지
않는다는 것**을 실문서로 확인한다.

## 2. 파이프라인 (재현 가능)

```
tools/fidelity/discover.mjs      실문서 스캔(로컬 전용, 파일명 포함) → discovery.local.json
tools/fidelity/build_corpus.mjs  선정 + 매니페스트 생성(id+해시만, 커밋됨) → corpus-manifest.json
tools/fidelity/measure.mjs       @rhwp/core WASM을 Node에서 헤드리스로 구동 → measurements.json
tools/fidelity/summarize.mjs     매니페스트+측정치를 조인해 요약 출력
```

`@rhwp/core`는 브라우저 전용처럼 보이지만 실제로는 아니다. `rhwp.js`의 `initSync()`는 `fetch`
없이 WASM 바이트만으로 초기화되고, `HwpDocument`/`pageCount`/`renderPageSvg`/`exportHwp`/
`exportHwpx`는 DOM을 요구하지 않는다(`src/formats/hwp.ts`가 실제로 쓰는 바로 그 API). 유일한
예외는 `measureTextWidth` 콜백(브라우저 폰트로 줄바꿈을 계산)인데, Node에는 캔버스가 없으므로
`measure.mjs`는 결정론적인 CJK 폭 근사치(한글/CJK/전각은 폰트 크기 그대로, 그 외는 0.55배)를
설치한다. **이 근사치가 실제 폰트 메트릭이 아니라는 점은 모든 pageCount 수치에 상속되는
한계다**: 아래 5절 참고.

### 저작권/개인정보 처리

`discover.mjs`가 만드는 `discovery.local.json`과 `build_corpus.mjs`가 만드는
`corpus-paths.local.json`은 실제 파일명(회사명·개인정보 노출 가능)과 절대경로를 담으므로
**`.gitignore`의 `docs/fidelity/*.local.json`로 커밋에서 제외된다**. `e2e-smoke.py`의 기존
관례("Fixtures are supplied rather than committed")와 동일한 원칙이다. 커밋되는 것은
`corpus-manifest.json`(id + sha256 해시 + 바이트 크기 + 축 태그만)과 `measurements.json`
(id + 구조적 수치만)뿐이며, 둘 다 문서 본문·파일명을 담지 않는다.

## 3. 실문서 스크리닝

`~/Downloads`(15개)와 `~/thaki/rhwp`(279개, rhwp 라이브러리 자체 테스트 코퍼스)에서 HWP/HWPX
294개를 스캔했다. **294개 중 256개는 rhwp 자신의 회귀 테스트 픽스처**다(`re-align-center-01`,
`tac-case-001`, `table-vpos-01`, `blank-batang.hwp`, `template/empty.hwp` 류: 특정 렌더링
버그 하나를 찌르려고 만든 합성 최소 사례이지, 실제로 유통된 문서가 아니다). 파일명 규칙이
뚜렷해 `discover.mjs`의 정규식으로 기계적으로 걸러낸다.

남은 38개 중 바이트 단위로 동일한 중복 3쌍을 제거하면 **35개의 "실문서로 보이는" 후보**가
남는다. 이 중에서도 다음은 이 코퍼스의 축(공문서/시험지/표/수식/서식)과 무관하거나 근거가
약해 **선정에서 제외했다** (전부 로컬 전용 파일에는 남아 있어 재현 가능):

- 개인/가족 문서 2개 (아동 성명이 포함된 학교 과제물, 개인 메모): 어느 축과도 무관하고
  프라이버시 사유로 제외.
- `rhwp-studio`(rhwp의 공개 데모 사이트) `public/` 폴더에 있는 문서 2개(사업계획서 템플릿,
  78페이지 샘플): 데모용으로 준비됐을 가능성이 높아 "실제 유통 문서"라 단정하기 어려움.
- rhwp의 테스트 픽스처 명명 규칙과 매우 유사한 파일명 2개(`task-001`, `hwpers_test4_...`):
  정규식이 못 걸렀지만 provenance가 불확실.
- 같은 홍보성 문서를 저장한 근사 중복본 2개(3개 중 1개만 남김): "거의 동일한 문서 30개"를
  피하라는 지시에 따라.

**최종 후보 25개**가 이 코퍼스에 들어갔다. 20~30개 목표 범위 안이며, 별도 축소·확장 조작
없이 위 스크리닝의 자연스러운 결과다.

### 축별 실제 개수 (N, 실문서만)

| 축 | 실제 개수 (N) | 비고 |
|---|---|---|
| 공문서 (정부 공고문·보도자료·통계·현황보고) | **16** | 입주기업 모집공고문 3(기관 3곳), 무역통계 보도자료 6(분기별+연간, HWP/HWPX 각 1쌍 포함), 재정통계 3(연도별), 프로그램 현황 1, 서식 성격 공문 3(아래 서식과 중복 집계) |
| 시험지 (9급 공무원 시험 대비) | **2** | 행정법총론, 행정학개론: 둘 다 지방9급 대비 실제 문제지 |
| 서식/양식 (별지 서식·청구서·신청 양식) | **3** | 별지 제3호서식, 지방세 환급청구서, 사업계획서 양식 |
| 표 포함 (구조적 프록시, 4절 참고) | **22 / 25** | `rects/page >= 3.0`. 미달 3개는 계약서·정관·단순 서식 1건으로, 표보다 흐르는 조항/문항 위주 문서 |
| 수식 포함 | **0 (확정된 실문서 없음)** | 아래 참고 |
| 계약/정관 (참고 축, 과제 명시 축 아님) | 2 | 표준 계약서, 정관 |
| 기술 문서 (참고 축, 과제 명시 축 아님) | 4 | 공개 API 문서 3부작 + 파일형식 스펙 문서(178p): 표 밀도가 가장 높은 스트레스 테스트용 |
| RFP (참고 축) | 1 | 공공기관 RFP 27p |
| 포맷: HWP / HWPX | 20 / 5 | 무역통계 보도자료 중 1건은 **같은 문서가 HWP와 HWPX 양쪽으로 존재**: 포맷 간 파싱 결과를 직접 대조할 수 있는 유일한 쌍 |

**수식 포함 축은 정직하게 0으로 보고한다.** `@rhwp/core`의 공개 API에는 문서 전체를 순회해
"이 컨트롤이 수식이다"를 알려주는 열거 함수가 없다(`getEquationProperties` 등은 이미
section/control 인덱스를 알아야 호출 가능: 표 4절 참고). 그래서 수식 존재 여부는 자동
측정하지 못했고, 25개 후보의 실제 내용(행정법/행정학 시험 문항, 정부 공고·통계, 계약서,
API/스펙 문서)도 수학적 표기가 필요한 성격이 아니어서 수동 검토로도 수식을 가진 실문서를
찾지 못했다. rhwp 코퍼스 안에 `eq-01.hwp`라는 수식 전용 테스트 픽스처가 있지만, 이는 3절
기준대로 합성 회귀 테스트 파일이지 실문서가 아니므로 코퍼스에서 제외했다. **이 축은
NOT MEASURED가 아니라 "측정 가능한 방법으로 찾아봤고, 실문서 중에는 없었다"는 결론이다.**

## 4. 실측 충실도 수치 (N=25, 전부 실측)

`node tools/fidelity/summarize.mjs`로 재현 가능(위 표 데이터를 커밋된 두 파일에서 조인).
엔진: `@rhwp/core` 0.8.2 (hanji가 배포하는 패치 빌드, `vendor/README.md` 참고).

| 지표 | 결과 | N |
|---|---|---|
| 파싱 성공 (throw 없음) | **25/25 (100%)** | 25 |
| 렌더된 총 페이지 수 | **524페이지** | 25개 문서 합계 |
| "표가 페이지를 벗어나지 않는다" (모든 문서의 모든 페이지) | **위반 0건, 최대 overflow 0.0px** | 524페이지 전수 |
| HWP↔HWPX 라운드트립 후 페이지 수 보존 | **25/25 (100%)** | 25 |
| 표 포함 프록시 (`rects/page >= 3.0`) | 22/25 | 25 |
| 동일 문서의 HWP/HWPX 쌍 렌더 결과 일치 (rect 수) | **827 vs 827 (완전 일치)** | 1쌍 |

가장 중요한 결과는 두 가지다.

1. **overflow 회귀가 실문서 524페이지 전부에서 0건이다.** README.en.md가 문서화한 그 정확한
   버그(탭 뒤 block 표가 페이지 밖으로 밀림)가, hanji가 배포하는 패치 엔진으로는 실문서에서
   재현되지 않는다는 실측 증거다. `e2e-smoke.py`가 1페이지만 보던 것을 524페이지로 확장한
   결과이기도 하다.
2. **같은 무역통계 보도자료를 HWP로 받은 것과 HWPX로 받은 것이 구조적으로 완전히 같은 결과를
   낸다** (페이지 9, rect 827로 동일). 이는 hanji가 파는 기능(HWP↔HWPX 변환) 자체가 적어도
   이 실문서 쌍에서는 내용을 왜곡하지 않는다는 근거다.

## 5. NOT MEASURED (정직하게 표기)

- **한컴 오피스 대비 시각적 정확성**: 1절에서 설명한 이유로 이 생태계 전체에 측정 수단이
  없다. rhwp도 hanji도 마찬가지다.
- **수식 포함 실문서의 렌더 정확성**: 3절에서 설명한 대로 애초에 그런 실문서를 코퍼스에
  넣지 못했으므로 측정 대상이 없다.
- **pageCount의 절대적 정확성**: `measure.mjs`의 `measureTextWidth` 근사치는 실제 폰트
  메트릭이 아니다(2절). 그래서 이 코퍼스가 보고하는 `pageCount`는 "이 근사 폭에서 이 엔진이
  계산한 페이지 수"이지 "한컴이 계산했을 페이지 수"가 아니다. **overflow 검사와 라운드트립
  검사는 이 한계와 무관하다**: 둘 다 "엔진이 자기 자신과 일관적인가"만 보기 때문이다.
- **텍스트 내용의 손실 없는 보존** (글자 단위 diff): `@rhwp/core`에 문서 전체 평문을 한
  번에 뽑는 API가 없어(문단/셀 단위로만 접근 가능) 이번 파이프라인에서는 구현하지 않았다.
- **표 셀 개수·구조의 정확한 카운트**: `rects/page` 프록시는 표 유무의 대략적 신호이지,
  실제 표 개수나 행/열 구조를 세지 않는다. `getTableDimensions`류 API는 section/control
  인덱스를 먼저 알아야 호출 가능해, 이번 예산 안에서는 전체 문서 컨트롤 트리 순회기까지는
  만들지 않았다.

## 6. 재현

```bash
# 1) 로컬에서 실문서를 다시 스캔 (다른 머신이면 FIDELITY_SCAN_ROOTS로 경로 지정)
node tools/fidelity/discover.mjs > docs/fidelity/discovery.local.json

# 2) 선정 재적용 (sha256로 고정되어 있어 파일 위치가 바뀌어도 안전)
node tools/fidelity/build_corpus.mjs docs/fidelity/discovery.local.json

# 3) 구조적 충실도 측정 (커밋되는 measurements.json 갱신)
node tools/fidelity/measure.mjs docs/fidelity/corpus-paths.local.json > docs/fidelity/measurements.json

# 4) 요약 (커밋된 두 파일만으로 재현, 다른 머신에서도 실행 가능)
node tools/fidelity/summarize.mjs
```

## 7. 한계와 다음 단계

- 코퍼스가 25개로 이 저장소 안에서는 작다. `~/thaki/rhwp`가 더 늘어나거나 다른 실문서 출처가
  생기면 `discover.mjs`의 스캔 루트(`FIDELITY_SCAN_ROOTS`)만 넓히면 파이프라인은 그대로
  재사용된다.
- 수식 포함 축을 실제로 채우려면 수식 컨트롤을 가진 실문서를 별도로 구해야 한다: 없는데
  있다고 표기하지 않는 것이 이 문서의 원칙이다.
- `@rhwp/core`에 문서 전체를 순회하는 공개 API(컨트롤 트리 열거, 평문 추출)가 생기면, 표
  개수의 정확한 카운트와 텍스트 보존 diff를 이 파이프라인에 그대로 얹을 수 있다.

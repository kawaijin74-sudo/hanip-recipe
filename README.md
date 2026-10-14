# 한입레시피 (공개 사이트)

유튜브 요리 영상을 레시피(재료·양·추정 가격·단계별 영상 시점·팁·영양·태그)로 정리한 사이트입니다.
주소: https://kawaijin74-sudo.github.io/hanip-recipe/

## 이 저장소에 있는 것

| 파일 | 만드는 곳 | 설명 |
|---|---|---|
| `index.html`, `recipes.json`, `r/<id>.json`, `.nojekyll` | 내 컴퓨터의 `build.mjs` | 앱 화면과 레시피 데이터 |
| `recipes/<id>/index.html` | `node tools/seo.mjs` | 레시피별 검색용 페이지 (자바스크립트 없이 본문이 다 들어 있음) |
| `recipes/index.html` | `node tools/seo.mjs` | 전체 레시피 목록 |
| `collections/<이름>/index.html`, `collections/index.html` | `node tools/seo.mjs` | 모음글 (만원 이하 가성비, 20분 이내, 혼밥, 술안주, 다이어트, 해장·국물, 야식, 두부·버섯 요리 등) |
| `sitemap.xml`, `robots.txt`, `llms.txt` | `node tools/seo.mjs` | 검색엔진·AI 검색용 안내 파일 |
| `index.html` 맨 아래 `<!-- seo:start -->` ~ `<!-- seo:end -->` | `node tools/seo.mjs` | 첫 화면에 넣는 전체 레시피·모음글 링크 |

## 검색 노출용 페이지가 하는 일

- 레시피 페이지마다 제목 "○○ 레시피 - 재료·만드는 법 | 한입레시피", 설명, 대표 주소(canonical), 공유 미리보기(og) 태그
- 맨 위 3줄 요약(조리 시간·인분, 재료비 합계, 칼로리), 재료표(양·추정 가격·쿠팡 링크와 파트너스 안내), 만드는 법(영상 시점), 팁, 영양, 태그, 원작 유튜브 출처와 누를 때만 불러오는 영상
- 자주 묻는 질문(조리 시간·재료비·몇 인분·칼로리·필요한 도구) — 레시피 데이터로만 채웁니다
- 구글이 읽는 구조화 데이터(JSON-LD): Recipe(영상 포함), FAQPage, BreadcrumbList, 모음글은 ItemList
- 모음글은 조건에 맞는 레시피가 3개 이상일 때만 만들어집니다. 레시피가 늘면 면요리·밑반찬·돼지고기·닭고기 모음글도 자동으로 생깁니다.

## 레시피를 추가한 뒤 꼭 할 일

`build.mjs` 로 레시피를 올리면 `index.html` 이 새로 덮어써지고, 새 레시피의 검색용 페이지는 아직 없습니다.
그래서 **레시피를 추가할 때마다** 저장소 폴더에서 아래를 다시 돌리고 커밋·푸시하세요.

```
node tools/seo.mjs
```

- 여러 번 돌려도 결과가 같습니다. `recipes/`, `collections/` 폴더는 매번 지우고 새로 만듭니다(직접 고친 내용은 사라짐).
- 끝에 검사(`tools/check-seo.mjs`)가 자동으로 돌아 JSON-LD 오류, 깨진 링크, sitemap 누락, 비밀 값(열쇠·토큰)을 확인합니다. "✅ 문제 없음" 이 나와야 올리세요. 검사만 따로 돌리려면 `node tools/check-seo.mjs`.
- `.env` 같은 열쇠 파일은 이 저장소에 넣지 마세요.

## 남은 수동 작업 (직접 로그인해서 해야 함)

1. **구글 서치 콘솔** (https://search.google.com/search-console)
   - 속성 추가 → "URL 접두어" 에 `https://kawaijin74-sudo.github.io/hanip-recipe/` 입력
   - 소유권 확인은 "HTML 파일" 방식이 쉽습니다: 받은 `google….html` 파일을 이 저장소 맨 위(루트)에 넣고 푸시한 뒤 "확인" (seo.mjs 는 이 파일을 건드리지 않습니다)
   - 왼쪽 "Sitemaps" 에 `sitemap.xml` 제출
   - "URL 검사" 에 레시피 페이지 주소를 넣고 "색인 생성 요청" 을 하면 더 빨리 잡힙니다
2. **네이버 서치어드바이저** (https://searchadvisor.naver.com)
   - 웹마스터 도구 → 사이트 등록에 `https://kawaijin74-sudo.github.io/hanip-recipe/` 입력
   - 소유 확인은 "HTML 파일 업로드" 방식으로 받은 파일을 저장소 루트에 넣고 푸시
   - 요청 → 사이트맵 제출에 `https://kawaijin74-sudo.github.io/hanip-recipe/sitemap.xml` 입력
3. (선택) 빙 웹마스터 도구에서 구글 서치 콘솔 가져오기 — ChatGPT 검색이 빙 색인을 함께 씁니다.

### 알아 둘 점

- `robots.txt` 는 원래 도메인 맨 위(`https://kawaijin74-sudo.github.io/robots.txt`)에 있어야 검색엔진이 읽습니다. 지금은 `/hanip-recipe/` 아래라 효력이 없지만, 막는 규칙이 없으니 기본으로 모두 허용됩니다. 나중에 개인 도메인을 연결하면 그대로 작동합니다. 그래서 sitemap 은 위처럼 서치 콘솔·서치어드바이저에 직접 제출해야 합니다.
- 유튜브 영상의 올린 날짜는 데이터에 없어서 구조화 데이터에 넣지 않았습니다(구글 검사 도구에서 "uploadDate 누락" 경고가 나올 수 있음). 지어낸 값을 넣지 않기 위해서입니다.
- 가격·칼로리는 AI 추정값이라고 페이지에 표시합니다.

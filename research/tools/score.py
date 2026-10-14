# -*- coding: utf-8 -*-
"""
한입레시피 우선순위 점수 계산기.

입력
  research/candidates.csv      후보 요리 목록(요리명·대표 검색어·카테고리·주재료 유형·시즌 정점 등)
  research/keywords_raw.csv    근거(기사·공식 자료) 행과 검색어 행. 출처 URL 포함
  research/local/autocomplete.csv   (있으면) collect_autocomplete.py 결과
  research/local/naver_volume.csv   (있으면) 사용자가 붙인 네이버 월간 검색수
                                     열: 대표검색어,월간검색수  (PC+모바일 합)
출력
  research/priority_top80.csv  새로 만들 후보 80개 + 이미 있는 레시피(순위='중복')
  research/score_detail.csv    모든 후보의 항목별 점수(검산용)

점수 = 수요 × 작년정점 × 방송가산 × 승산 × 질문형가산 × 구매의도 × 시즌시점 − 추석감점
각 항목의 정의와 숫자는 아래 상수와 research/전략.md 에 적혀 있다.
"""
import csv, math, os, re, statistics, sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TODAY = date(2026, 10, 14)  # 기준일. 다시 돌릴 때는 바꿔도 된다.
if len(sys.argv) > 1:
    TODAY = date.fromisoformat(sys.argv[1])

# ---- 가중치 ---------------------------------------------------------------
W_EVID = 0.12          # 근거 세기 합 1점당 수요 가산 (최대 SUM_CAP 점까지)
SUM_CAP = 9
W_SRC = 0.06           # 서로 다른 출처 1개당 수요 가산 (최대 6개)
W_AUTO = 0.03          # 자동완성에서 확인된 서로 다른 확장 검색어 1개당 (최대 30개)
P_LASTYEAR = 1.25      # 작년 10월~1월 정점 근거가 있으면
B_RECENCY = [(3, 0.35), (6, 0.25), (12, 0.15)]  # (몇 개월 이내, 가산) 그 밖은 0.05
C_INTENT = {"해산물": 1.15, "육류": 1.15, "가공·소스": 1.10, "디저트재료": 1.10,
            "채소·과일": 1.05, "기본": 1.00}
CHUSEOK_PENALTY = 0.5  # 명절(추석) 직후 급락 우려 메뉴 감점(뺄셈)

QUESTION_RE = re.compile(r"(법|방법|비율|시간|몇\s?분|보관|칼로리|차이|이유|왜|어떻게|안\s?되|실패|대체|없이|\?)")
RECIPE_RE = re.compile(r"(레시피|만드는\s?법|만들기|황금|양념|끓이는|볶는|굽는|하는\s?법|비율|소스)")
BUY_RE = re.compile(r"(재료|밀키트|택배|구매|파는\s?곳|가격|시세|주문|손질)")


def read(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def months_between(ym, today=TODAY):
    y, m = map(int, ym[:7].split("-"))
    return (today.year - y) * 12 + (today.month - m)


def season_factor(peak):
    """정점 추정일까지 남은 주. 2~6주 뒤가 가장 좋다(지금 만들면 색인·노출이 정점에 맞음)."""
    if not peak or peak == "상시":
        return 1.0, None
    y, m, d = map(int, peak.split("-"))
    wk = (date(y, m, d) - TODAY).days / 7
    if 2 <= wk <= 6:
        f = 1.30
    elif 0 <= wk < 2:
        f = 1.15
    elif 6 < wk <= 10:
        f = 1.10
    elif wk > 10:
        f = 0.90
    elif wk >= -2:
        f = 1.0
    else:
        f = 0.85
    return f, round(wk, 1)


def classify(q):
    return (1 if RECIPE_RE.search(q) else 0,
            1 if QUESTION_RE.search(q) else 0,
            1 if BUY_RE.search(q) else 0)


def main():
    cands = read(os.path.join(ROOT, "candidates.csv"))
    raw = read(os.path.join(ROOT, "keywords_raw.csv"))
    auto = read(os.path.join(ROOT, "local", "autocomplete.csv"))
    vol = {r["대표검색어"]: float(r["월간검색수"] or 0) for r in read(os.path.join(ROOT, "local", "naver_volume.csv"))}

    evid = defaultdict(list)
    for r in raw:
        if r["행종류"] == "근거":
            evid[r["요리명"]].append(r)

    # 자동완성 정리: 요리명별 서로 다른 확장 검색어
    auto_q = defaultdict(set)
    for r in auto:
        s = (r.get("자동완성") or "").strip()
        if s and s != r["입력"].strip():
            auto_q[r["요리명"]].add(s)

    rows = []
    for c in cands:
        name = c["요리명"]
        ev = evid.get(name, [])
        strength = sum(int(e["신호강도"] or 0) for e in ev)
        srcs = {e["출처URL"] for e in ev if e["출처URL"]}
        types = {e["근거유형"] for e in ev}

        D = 1 + W_EVID * min(strength, SUM_CAP) + W_SRC * min(len(srcs), 6)
        aq = auto_q.get(name, set())
        if aq:
            D += W_AUTO * min(len(aq), 30)
        v = vol.get(c["대표검색어"])
        if v:
            D *= min(1.6, max(0.5, math.log10(v + 1) / 4))  # 1만=1.0, 10만=1.25, 1천=0.75

        lastyear = any(e["근거유형"] == "작년 시기" and e["시점"][:7] in
                       ("2025-10", "2025-11", "2025-12", "2026-01") for e in ev)
        P = P_LASTYEAR if lastyear else 1.0

        B = 1.0
        for e in ev:
            if e["근거유형"] == "방송" and re.match(r"\d{4}-\d{2}", e["시점"] or ""):
                mo = months_between(e["시점"])
                add = next((a for lim, a in B_RECENCY if mo <= lim), 0.05)
                B = max(B, 1 + add)

        if aq:
            longtail = [q for q in aq if len(q.split()) >= 3 or len(q) >= len(name) + 5]
            W = min(1.30, 1 + 0.02 * len(longtail))
            nq = sum(1 for q in aq if classify(q)[1])
            Q = min(1.25, 1 + 0.05 * nq)
        else:
            W, Q = 1.0, 1.0  # 자동완성 미수집: 중립값

        C = C_INTENT.get(c["주재료유형"], 1.0)
        S, wk = season_factor(c["정점추정"])
        pen = CHUSEOK_PENALTY if c["명절연관"] == "1" else 0.0
        score = D * P * B * W * Q * C * S - pen

        basis = [t for t in ("작년 시기", "제철", "방송") if t in types]
        rows.append({**c, "근거유형": "/".join(basis) or "레시피오 인기 축",
                     "출처": " ; ".join(sorted(srcs)),
                     "수요": round(D, 3), "작년정점": P, "방송가산": round(B, 2), "승산": round(W, 2),
                     "질문형가산": round(Q, 2), "구매의도": C, "시즌시점": S, "정점까지_주": wk,
                     "추석감점": pen, "근거세기합": strength, "출처수": len(srcs),
                     "자동완성수": len(aq), "점수": round(score, 3)})

    rows.sort(key=lambda r: -r["점수"])
    new = [r for r in rows if not r["기존중복"] and r["설시즌"] != "1"]
    dup = [r for r in rows if r["기존중복"]]
    scores = [r["점수"] for r in new]
    q = statistics.quantiles(scores, n=4)
    print(f"후보 {len(rows)}개 (새 후보 {len(new)}, 중복 {len(dup)}, 설 묶음 {sum(r['설시즌']=='1' for r in rows)})")
    print(f"점수 분포(새 후보): 최저 {min(scores):.2f} / 1사분위 {q[0]:.2f} / 중앙 {q[1]:.2f} / 3사분위 {q[2]:.2f} / 최고 {max(scores):.2f}")

    def tier(s):
        return "A" if s >= q[2] else ("B" if s >= q[1] else "C")

    cols = ["순위", "요리명", "대표검색어", "질문형검색어1", "질문형검색어2", "질문형검색어3",
            "카테고리", "근거유형", "출처", "시즌정점추정", "점수", "등급", "중복"]
    with open(os.path.join(ROOT, "priority_top80.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for i, r in enumerate(new[:80], 1):
            w.writerow({"순위": i, "요리명": r["요리명"], "대표검색어": r["대표검색어"],
                        "질문형검색어1": r["질문1"], "질문형검색어2": r["질문2"], "질문형검색어3": r["질문3"],
                        "카테고리": r["카테고리"], "근거유형": r["근거유형"], "출처": r["출처"],
                        "시즌정점추정": r["정점추정"], "점수": r["점수"], "등급": tier(r["점수"]), "중복": ""})
        for r in dup:
            w.writerow({"순위": "중복", "요리명": r["요리명"], "대표검색어": r["대표검색어"],
                        "질문형검색어1": r["질문1"], "질문형검색어2": r["질문2"], "질문형검색어3": r["질문3"],
                        "카테고리": r["카테고리"], "근거유형": r["근거유형"], "출처": r["출처"],
                        "시즌정점추정": r["정점추정"], "점수": r["점수"], "등급": "", "중복": "이미 있음: " + r["기존중복"]})

    dcols = list(rows[0].keys())
    with open(os.path.join(ROOT, "score_detail.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=dcols)
        w.writeheader()
        w.writerows(rows)
    print(f"80위 점수 {new[79]['점수'] if len(new) >= 80 else '후보 부족'}")


if __name__ == "__main__":
    main()

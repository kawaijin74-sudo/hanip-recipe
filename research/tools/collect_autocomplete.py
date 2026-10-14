# -*- coding: utf-8 -*-
"""
사용자 컴퓨터에서 실행하는 자동완성 수집 도구 (클라우드에서는 접속이 막혀 있었음).

하는 일
  research/priority_top80.csv 의 요리명마다 네이버·구글·유튜브 자동완성을 천천히 모아
  research/local/autocomplete.csv 로 저장한다. 그 뒤 score.py 를 다시 돌리면
  '승산(구체적 꼬리 검색어)'과 '질문형 가산'이 실제 자동완성으로 채워진다.

규칙
  - 요청 사이 1.5~3초 쉼. 거부(HTTP 429/403/5xx 또는 연결 오류)가 3번 연속 나면 그 출처는 멈춤.
  - 이미 모은 (출처, 검색어) 는 건너뛰므로 중간에 멈춰도 다시 실행하면 이어서 모은다.
  - 계정·열쇠 필요 없음. 파이썬 3 기본 모듈만 사용.

실행
  python research/tools/collect_autocomplete.py            # 전부
  python research/tools/collect_autocomplete.py --limit 10 # 위에서 10개 요리만 시험
"""
import csv, json, os, random, sys, time, urllib.parse, urllib.request, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOP = os.path.join(ROOT, "priority_top80.csv")
OUT_DIR = os.path.join(ROOT, "local")
OUT = os.path.join(OUT_DIR, "autocomplete.csv")

# 요리명 뒤(또는 앞)에 붙여 볼 확장형
NAVER_FORMS = ["{d}", "{d} 레시피", "{d} 황금레시피", "{d} 만드는법", "{d} 양념", "백종원 {d}"]
GOOGLE_FORMS = ["{d}", "{d} 레시피", "{d} 만드는 법"]
YT_FORMS = ["{d}", "{d} 레시피"]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", "replace")


def naver(q):
    u = ("https://ac.search.naver.com/nx/ac?con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8"
         "&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100&q=" + urllib.parse.quote(q))
    data = json.loads(get(u))
    out = []
    for group in data.get("items", []):
        for it in group:
            if isinstance(it, list) and it:
                out.append(it[0] if isinstance(it[0], str) else str(it[0]))
    return out


def google(q, yt=False):
    u = "https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=" + urllib.parse.quote(q)
    if yt:
        u += "&ds=yt"
    data = json.loads(get(u))
    return list(data[1]) if len(data) > 1 else []


SOURCES = [
    ("네이버", NAVER_FORMS, naver),
    ("구글", GOOGLE_FORMS, lambda q: google(q)),
    ("유튜브", YT_FORMS, lambda q: google(q, yt=True)),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    with open(TOP, encoding="utf-8-sig") as f:
        dishes = [r["요리명"] for r in csv.DictReader(f)]
    if args.limit:
        dishes = dishes[: args.limit]

    os.makedirs(OUT_DIR, exist_ok=True)
    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                done.add((r["출처"], r["입력"]))
    new_file = not os.path.exists(OUT)
    fout = open(OUT, "a", encoding="utf-8-sig", newline="")
    w = csv.writer(fout)
    if new_file:
        w.writerow(["요리명", "출처", "입력", "순번", "자동완성", "수집시각"])

    for name, forms, fn in SOURCES:
        fails = 0
        for d in dishes:
            if fails >= 3:
                break
            for form in forms:
                q = form.format(d=d)
                if (name, q) in done:
                    continue
                time.sleep(random.uniform(1.5, 3.0))
                try:
                    sugg = fn(q)
                    fails = 0
                except Exception as e:  # 429·403·연결 오류 모두 거부로 셈
                    fails += 1
                    print(f"[{name}] 거부/오류 {fails}회: {q} ({type(e).__name__})")
                    if fails >= 3:
                        print(f"[{name}] 거부가 3번 연속이라 이 출처는 멈춥니다.")
                        break
                    continue
                stamp = time.strftime("%Y-%m-%d %H:%M")
                if not sugg:
                    w.writerow([d, name, q, 0, "", stamp])
                for i, s in enumerate(sugg, 1):
                    w.writerow([d, name, q, i, s, stamp])
                fout.flush()
                print(f"[{name}] {q} → {len(sugg)}개")
    fout.close()
    print("끝. 이제 python research/tools/score.py 를 다시 실행하세요.")


if __name__ == "__main__":
    main()

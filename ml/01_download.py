# -*- coding: utf-8 -*-
r"""
1단계: 학습용 모기 사진 내려받기 (iNaturalist 공개 사진)
=========================================================
- 전문가·시민 여럿이 종을 확인한 '연구 등급' 관찰만, 재사용이 허락된 라이선스(CC0 · CC BY · CC BY-NC) 사진만 받는다.
- 관찰 하나당 첫 사진 한 장 (같은 모기 사진이 학습·시험에 섞이지 않게).
- 사진마다 출처(관찰 번호·작가·라이선스)를 data/출처.csv 에 남긴다. 사이트·문서에 공개할 출처 목록이 된다.
- iNaturalist 서버에 무리가 가지 않게 1초에 한 번 정도만 묻는다.

실행:  ml\.venv\Scripts\python ml\01_download.py          (분류마다 600장, 약 20~30분)
       ml\.venv\Scripts\python ml\01_download.py --per 100  (빠르게 시험)
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
API = 'https://api.inaturalist.org/v1/observations'
UA = {'User-Agent': 'mosquito-zero-research/1.0 (Gimhae public health; contact via github Dorothy1435/data-mosquito)'}

# 분류 → [(iNaturalist 분류군 이름, 받을 비율)]
# 작은빨간집모기·중국얼룩날개모기는 공개 사진이 몇 장뿐이라(2026-10 기준 4장·3장) 이번엔 '무리'로 묶는다.
CLASSES = {
    '흰줄숲모기': [('Aedes albopictus', 1.0)],
    '얼룩날개모기': [('Anopheles', 1.0)],
    '집모기류': [('Culex', 1.0)],
    '모기아님': [('Tipulidae', 0.5), ('Chironomidae', 0.3), ('Psychodidae', 0.2)],   # 각다귀 · 깔따구 · 나방파리
}
LICENSES = 'cc0,cc-by,cc-by-nc'


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def taxon_id(name):
    j = get_json('https://api.inaturalist.org/v1/taxa?' + urllib.parse.urlencode({'q': name, 'per_page': 5}))
    for t in j.get('results', []):
        if t.get('name', '').lower() == name.lower():
            return t['id']
    raise SystemExit(f'분류군을 찾지 못함: {name}')


def observations(tid, want):
    """연구 등급 + 재사용 가능한 라이선스 사진이 있는 관찰을 want 개까지 모은다."""
    out, page = [], 1
    while len(out) < want:
        q = {'taxon_id': tid, 'quality_grade': 'research', 'photo_license': LICENSES, 'photos': 'true',
             'per_page': 200, 'page': page, 'order_by': 'votes'}
        j = get_json(API + '?' + urllib.parse.urlencode(q))
        res = j.get('results', [])
        if not res:
            break
        for o in res:
            ph = next((p for p in o.get('photos', []) if p.get('license_code') in LICENSES.split(',')), None)
            if not ph or not ph.get('url'):
                continue
            out.append({
                'obs_id': o['id'],
                'url': ph['url'].replace('/square.', '/medium.'),
                'license': ph.get('license_code', ''),
                'attribution': ph.get('attribution', ''),
                'taxon': (o.get('taxon') or {}).get('name', ''),
                'place': (o.get('place_guess') or '')[:60],
            })
            if len(out) >= want:
                break
        page += 1
        time.sleep(1.1)   # 서버 배려
        if page > 25:
            break
    return out


def download(item, folder):
    path = os.path.join(folder, f"{item['obs_id']}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path
    for _ in range(3):
        try:
            req = urllib.request.Request(item['url'], headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r, open(path, 'wb') as f:
                f.write(r.read())
            return path
        except Exception:
            time.sleep(2)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per', type=int, default=600, help='분류마다 받을 사진 수')
    args = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)
    credits = []
    for label, parts in CLASSES.items():
        folder = os.path.join(DATA, 'images', label)
        os.makedirs(folder, exist_ok=True)
        items = []
        for name, share in parts:
            tid = taxon_id(name)
            got = observations(tid, int(args.per * share))
            print(f'{label} ← {name}(id {tid}): 관찰 {len(got)}개', flush=True)
            items += got
            time.sleep(1.1)
        with ThreadPoolExecutor(max_workers=4) as ex:   # 사진 서버에는 동시에 4장까지만
            paths = list(ex.map(lambda it: download(it, folder), items))
        ok = 0
        for it, pth in zip(items, paths):
            if pth:
                ok += 1
                credits.append({'label': label, 'file': os.path.relpath(pth, DATA).replace('\\', '/'), **it})
        print(f'  → {label}: {ok}장 저장', flush=True)
    with open(os.path.join(DATA, '출처.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['label', 'file', 'obs_id', 'taxon', 'license', 'attribution', 'place', 'url'])
        w.writeheader()
        w.writerows(credits)
    print(f'완료: 사진 {len(credits)}장, 출처 목록 data/출처.csv', flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

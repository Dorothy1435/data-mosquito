# -*- coding: utf-8 -*-
r"""
5단계: 시민이 기증하고 직원이 확인한 사진을 학습 폴더로 내려받기
==================================================================
- 직원이 '확인'한 사진(photo_donations.review = 'confirmed')만 받는다. 모기 아님·판별 불가는 받지 않는다.
- 저장 위치: ml/data/donations/<종>/donation-<번호>.jpg  (종: 흰줄숲모기·얼룩날개모기·빨간집모기·작은빨간집모기·집모기류)
  지금 모델(v1) 분류에 쓰려면 --into-v1 을 붙인다 → ml/data/images/<v1 분류>/ 로도 복사
  (빨간집모기·작은빨간집모기·집모기류는 v1 에서 '집모기류' 한 분류)
- 출처 목록: ml/data/donations/기증.csv (번호, 종, 기증일, 동네). 기증한 사람 정보는 받지 않는다.
- 이미 받은 사진은 다시 받지 않는다.

필요한 것(학습 PC 의 환경변수, 코드에 적지 않는다):
  SUPABASE_URL                 예) https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    Supabase 의 Secret key (관리자 키 — 학습 PC 밖으로 내보내지 않는다)

실행:  ml\.venv\Scripts\python ml\05_fetch_donations.py [--into-v1]
그다음 02_train.py → 03_export.py 로 다시 학습·내보내기. 새 분류(작은빨간집모기 등)를 늘릴 때는 02_train.py 의 LABELS 를 바꾼다.
"""
import csv
import json
import os
import shutil
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data', 'donations')
V1 = {'흰줄숲모기': '흰줄숲모기', '얼룩날개모기': '얼룩날개모기', '빨간집모기': '집모기류', '작은빨간집모기': '집모기류', '집모기류': '집모기류'}


def get(url, key, raw=False):
    req = urllib.request.Request(url, headers={'apikey': key, 'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if raw else json.loads(data.decode('utf-8'))


def main():
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not base or not key:
        print('환경변수 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 를 먼저 설정해 주세요.')
        sys.exit(1)
    into_v1 = '--into-v1' in sys.argv
    q = urllib.parse.urlencode({'select': 'id,path,label,created_at,district', 'review': 'eq.confirmed', 'order': 'id.asc', 'limit': '10000'})
    rows = get(f'{base}/rest/v1/photo_donations?{q}', key)
    os.makedirs(OUT, exist_ok=True)
    log_path = os.path.join(OUT, '기증.csv')
    seen = set()
    if os.path.exists(log_path):
        with open(log_path, encoding='utf-8-sig') as f:
            seen = {r['id'] for r in csv.DictReader(f)}
    new = 0
    with open(log_path, 'a', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['id', 'label', 'file', 'donated_at', 'district', 'source'])
        if not seen:
            w.writeheader()
        for r in rows:
            if str(r['id']) in seen or r['label'] not in V1:
                continue
            folder = os.path.join(OUT, r['label'])
            os.makedirs(folder, exist_ok=True)
            name = f"donation-{r['id']}.jpg"
            dest = os.path.join(folder, name)
            img = get(f"{base}/storage/v1/object/photo-donations/{urllib.parse.quote(r['path'])}", key, raw=True)
            with open(dest, 'wb') as out:
                out.write(img)
            if into_v1:
                v1_dir = os.path.join(HERE, 'data', 'images', V1[r['label']])
                os.makedirs(v1_dir, exist_ok=True)
                shutil.copy(dest, os.path.join(v1_dir, name))
            w.writerow({'id': r['id'], 'label': r['label'], 'file': f"donations/{r['label']}/{name}", 'donated_at': r['created_at'][:10], 'district': r.get('district') or '', 'source': '모기제로 시민 기증 (기증 동의, 보건소 확인)'})
            new += 1
    print(f'확인된 사진 {len(rows)}장 중 새로 받은 사진 {new}장 → {OUT}' + (' (v1 학습 폴더에도 복사)' if into_v1 else ''))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

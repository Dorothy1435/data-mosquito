# 모기 사진 판별 모델 (ml/)

사진을 찍으면 어떤 모기인지 알려 주는 **모기제로 자체 모델**을 만드는 폴더입니다. 학습한 모델은 `models/mosquito-v1.onnx`로 내보내지고, 사이트(`photo-model.js`)가 **폰 브라우저 안에서** 실행합니다. 사진이 밖으로 나가지 않고 AI 회사 요금도 들지 않습니다.

## 지금 구분하는 것 (v1)
흰줄숲모기 · 얼룩날개모기(무리) · 집모기류 · 모기 아님(각다귀·깔따구·나방파리). 가장 높은 확률이 60%보다 낮으면 '알 수 없음'으로 답합니다.

작은빨간집모기(일본뇌염)와 빨간집모기는 공개 사진이 거의 없어(2026-10 기준 작은빨간집모기 연구 등급 사진 4장) 이번엔 '집모기류'로 묶었습니다. 보건소 표본 사진이 모이면 같은 코드로 분류를 늘릴 수 있습니다.

## 실행 순서

```bash
# 0) 한 번만: 가상환경 (파이썬 3.12, 3.14 는 학습 도구가 아직 지원 안 함)
py -3.12 -m venv ml/.venv
ml/.venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
ml/.venv/Scripts/python -m pip install onnx onnxruntime onnxscript pillow scikit-learn

# 1) 사진 받기 (iNaturalist 연구 등급, CC0·CC BY·CC BY-NC, 분류마다 600장 → ml/data/, 출처는 ml/data/출처.csv)
ml/.venv/Scripts/python -u ml/01_download.py --per 600

# 2) 학습 (GPU 없이 20~40분) → ml/runs/best.pt, ml/runs/report.txt(분류별 정확도)
ml/.venv/Scripts/python -u ml/02_train.py

# 3) 폰용 파일로 내보내기 → models/mosquito-v1.onnx, .json(설명), -credits.csv(사진 출처)
ml/.venv/Scripts/python -u ml/03_export.py
```

`ml/.venv/`, `ml/data/`, `ml/runs/`는 저장소에 올리지 않습니다(용량·라이선스). 저장소에는 결과 모델과 출처 목록만 올립니다.

## 사진을 더 넣으려면 (보건소 표본 등)
1. `ml/data/images/<분류 이름>/` 폴더에 사진을 넣습니다. 새 분류(예: `작은빨간집모기`)는 폴더를 새로 만들고 `02_train.py`의 `LABELS`, `03_export.py`의 `labels`에 같은 순서로 추가합니다.
2. **같은 모기를 여러 장 찍었다면** 학습·시험이 섞이지 않게 파일 이름 앞에 개체 번호를 붙이고, 나누기를 개체 단위로 바꿉니다(지금은 관찰 하나당 한 장이라 사진 단위로 나눔).
3. 출처·라이선스를 `ml/data/출처.csv`에 함께 적습니다.
4. 2)·3)을 다시 실행하고, `models/` 파일을 커밋합니다.

## 시민이 기증한 사진으로 다시 학습하기 (2026-10-20)
1. 사이트의 사진 판별 결과에서 시민이 'AI 학습에 기증하기'를 누르면(로그인·동의, 폰에서 흐림·어두움·같은 사진을 거름) Supabase 비공개 저장소에 쌓인다.
2. 직원이 전문가용 화면의 '기증 사진 확인'에서 종을 고른다. 확인된 사진만 학습에 쓴다.
3. 학습 PC 에 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(관리자 키, 코드·저장소에 적지 않음)를 두고
   `ml/.venv/Scripts/python ml/05_fetch_donations.py --into-v1` → `02_train.py` → `03_export.py`.
4. 작은빨간집모기처럼 새 분류를 늘릴 때는 `ml/data/donations/<종>/` 사진으로 `02_train.py` 의 LABELS 를 바꾸고, 같은 개체 사진이 학습·시험에 섞이지 않게 나눈다.
5. 시험 정확도가 지금 모델보다 좋을 때만 `models/` 를 바꾼다.

## 서버 PC(GPU)에서 할 때
같은 명령을 서버에서 실행하면 됩니다. GPU가 있으면 `pip install torch torchvision`(CUDA 판)으로 설치하고, `02_train.py`의 바퀴 수(`plan`)를 늘려도 됩니다. 사진 원본은 나스에 두고 학습 전에 서버 SSD로 복사해 쓰는 것을 권합니다.

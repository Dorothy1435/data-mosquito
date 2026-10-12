# -*- coding: utf-8 -*-
r"""
3단계: 학습한 모델을 폰 브라우저용 파일(ONNX)로 내보내기
=========================================================
- runs/best.pt → models/mosquito-v1.onnx (+ 설명 파일 models/mosquito-v1.json)
- 모델 끝에 '확률로 바꾸기(softmax)'를 붙여, 브라우저는 숫자 4개(분류별 확률)만 받으면 된다.
- 크기를 줄이려 8비트로 압축(양자화)해 보고, 시험 사진 정확도가 1%p 넘게 떨어지면 압축하지 않은 것을 쓴다.

실행:  ml\.venv\Scripts\python ml\03_export.py
"""
import datetime
import json
import os
import shutil
import sys

import numpy as np
import onnxruntime as ort
import torch
import torch.nn as nn
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
train = importlib.import_module('02_train')

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = train.RUNS
OUT = os.path.join(HERE, '..', 'models')
NAME = 'mosquito-v1'


class WithSoftmax(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return torch.softmax(self.m(x), dim=1)


def onnx_accuracy(path, items):
    sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    name = sess.get_inputs()[0].name
    ok = 0
    for p, y in items:
        x = train.eval_tf(Image.open(p).convert('RGB')).unsqueeze(0).numpy()
        ok += int(np.argmax(sess.run(None, {name: x})[0][0]) == y)
    return ok / max(1, len(items))


def main():
    os.makedirs(OUT, exist_ok=True)
    model = train.build_model()
    model.load_state_dict(torch.load(os.path.join(RUNS, 'best.pt')))
    model.eval()
    full = os.path.join(RUNS, f'{NAME}.fp32.onnx')
    torch.onnx.export(WithSoftmax(model), torch.zeros(1, 3, train.SIZE, train.SIZE), full,
                      input_names=['image'], output_names=['prob'], opset_version=17, dynamo=False)

    parts = train.split_items()
    test = parts['test']
    acc_full = onnx_accuracy(full, test)
    print(f'압축 전: {os.path.getsize(full) / 1e6:.1f}MB, 시험 정확도 {acc_full:.1%}', flush=True)

    # 8비트 압축 (검증 사진 100장으로 값 범위를 잰다)
    chosen, acc = full, acc_full
    try:
        from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
        from onnxruntime.quantization.shape_inference import quant_pre_process

        class Reader(CalibrationDataReader):
            def __init__(self, items):
                self.it = iter([{'image': train.eval_tf(Image.open(p).convert('RGB')).unsqueeze(0).numpy()} for p, _ in items[:100]])

            def get_next(self):
                return next(self.it, None)

        pre = os.path.join(RUNS, f'{NAME}.pre.onnx')
        quant_pre_process(full, pre)
        small = os.path.join(RUNS, f'{NAME}.int8.onnx')
        quantize_static(pre, small, Reader(parts['val']), quant_format=QuantFormat.QDQ,
                        activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8, per_channel=True)
        acc_small = onnx_accuracy(small, test)
        print(f'압축 후: {os.path.getsize(small) / 1e6:.1f}MB, 시험 정확도 {acc_small:.1%}', flush=True)
        if acc_small >= acc_full - 0.01:
            chosen, acc = small, acc_small
    except Exception as e:   # 압축이 안 되면 압축 전 파일을 쓴다
        print('압축 건너뜀:', e, flush=True)

    shutil.copyfile(chosen, os.path.join(OUT, f'{NAME}.onnx'))
    meta = {
        'name': NAME,
        'labels': ['흰줄숲모기', '얼룩날개모기', '집모기류', '모기 아님'],   # 화면에 보일 이름 (학습 폴더 순서와 같다)
        'size': train.SIZE, 'mean': train.MEAN, 'std': train.STD,
        'crop': 0.87,                       # 가운데 정사각형의 87%만 본다 (학습 때 평가 방식과 같게)
        'unsure_below': 0.6,                # 가장 높은 확률이 이보다 낮으면 '알 수 없음'
        'test_accuracy': round(acc, 4),
        'trained': datetime.date.today().isoformat(),
        'data': 'iNaturalist 연구 등급 공개 사진(CC0·CC BY·CC BY-NC), 분류마다 약 600장. 출처 목록 models/mosquito-v1-credits.csv',
        'note': '작은빨간집모기·빨간집모기는 공개 사진이 부족해 집모기류로 묶었다. 참고용 판별이며 의학적 판단이 아니다.',
    }
    with open(os.path.join(OUT, f'{NAME}.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    # 출처 목록 (사진 작가·라이선스) — 사이트와 함께 공개
    src = os.path.join(HERE, 'data', '출처.csv')
    if os.path.exists(src):
        shutil.copyfile(src, os.path.join(OUT, f'{NAME}-credits.csv'))
    print(f'완료: models/{NAME}.onnx ({os.path.getsize(chosen) / 1e6:.1f}MB, 정확도 {acc:.1%})', flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

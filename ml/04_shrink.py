# -*- coding: utf-8 -*-
r"""
4단계(선택): 모델 파일 줄이기 — 가중치만 8비트로 (계산은 원래대로)
====================================================================
03_export.py 의 '정적 8비트 압축'은 MobileNetV3 에서 정확도가 크게 떨어졌다(87% → 61%).
가중치만 8비트로 저장하고 계산은 소수로 하는 '동적 압축'을 시험해, 정확도가 1%p 안으로 유지되면 그것을 쓴다.

실행:  ml\.venv\Scripts\python ml\04_shrink.py
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
train = importlib.import_module('02_train')
export = importlib.import_module('03_export')
from onnxruntime.quantization import QuantType, quantize_dynamic

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'models')
NAME = 'mosquito-v1'


def main():
    full = os.path.join(train.RUNS, f'{NAME}.fp32.onnx')
    small = os.path.join(train.RUNS, f'{NAME}.dyn8.onnx')
    quantize_dynamic(full, small, weight_type=QuantType.QUInt8, op_types_to_quantize=['Conv', 'MatMul', 'Gemm'])
    test = train.split_items()['test']
    a_full = export.onnx_accuracy(full, test)
    a_small = export.onnx_accuracy(small, test)
    print(f'원래: {os.path.getsize(full) / 1e6:.1f}MB {a_full:.1%} / 가중치 8비트: {os.path.getsize(small) / 1e6:.1f}MB {a_small:.1%}', flush=True)
    if a_small >= a_full - 0.01:
        shutil.copyfile(small, os.path.join(OUT, f'{NAME}.onnx'))
        meta_path = os.path.join(OUT, f'{NAME}.json')
        meta = json.load(open(meta_path, encoding='utf-8'))
        meta['test_accuracy'] = round(a_small, 4)
        json.dump(meta, open(meta_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('→ 가중치 8비트 파일로 바꿈', flush=True)
    else:
        print('→ 정확도가 떨어져 원래 파일 유지', flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

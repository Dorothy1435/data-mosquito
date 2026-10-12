# -*- coding: utf-8 -*-
r"""
2단계: 모기 사진 판별 모델 학습
================================
- 미리 학습된 작은 모델(MobileNetV3-Small, ImageNet)에 모기 사진을 더 학습시킨다(전이학습).
  작아서 폰 브라우저 안에서 돌릴 수 있고, GPU 없는 PC 에서도 학습할 수 있다.
- 사진은 학습 70% · 검증 15% · 시험 15% 로 나눈다. 관찰 하나에 사진 한 장만 받았으므로 같은 모기가 섞이지 않는다.
- 시민이 찍는 사진처럼 흐리게·어둡게·기울이고·잘라서(동그라미 안 크롭) 학습한다.
- 결과: runs/best.pt(가장 좋은 모델), runs/report.txt(분류별 정확도·헷갈림 표)

실행:  ml\.venv\Scripts\python ml\02_train.py            (CPU 로 약 20~40분)
"""
import json
import os
import random
import sys
import time

import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

HERE = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(HERE, 'data', 'images')
# 모델 크기: mobilenet_v3_large(기본, 더 정확) · mobilenet_v3_small(더 작고 빠름). 환경변수 ARCH 로 바꾼다
ARCH = os.environ.get('ARCH', 'mobilenet_v3_large')
EPOCHS = int(os.environ.get('EPOCHS', '16'))   # 전체 다듬기 바퀴 수
RUNS = os.path.join(HERE, 'runs', ARCH)
LABELS = ['흰줄숲모기', '얼룩날개모기', '집모기류', '모기아님']
SIZE = 224
SEED = 7

MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
train_tf = transforms.Compose([
    transforms.RandomResizedCrop(SIZE, scale=(0.35, 1.0), ratio=(0.8, 1.25)),   # 화면의 동그라미 안만 잘라 보는 것과 비슷하게
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(20),
    transforms.ColorJitter(0.35, 0.35, 0.3, 0.03),                             # 실내 조명·어두운 사진
    transforms.RandomApply([transforms.GaussianBlur(5, (0.1, 2.0))], p=0.3),     # 흔들린 사진
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
])
eval_tf = transforms.Compose([
    transforms.Resize(int(SIZE * 1.15)),
    transforms.CenterCrop(SIZE),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
])


class Photos(Dataset):
    def __init__(self, items, tf):
        self.items, self.tf = items, tf

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, y = self.items[i]
        try:
            img = Image.open(path).convert('RGB')
        except Exception:
            img = Image.new('RGB', (SIZE, SIZE))
        return self.tf(img), y


def split_items():
    rng = random.Random(SEED)
    parts = {'train': [], 'val': [], 'test': []}
    for y, label in enumerate(LABELS):
        folder = os.path.join(IMG_DIR, label)
        files = sorted(f for f in os.listdir(folder) if f.lower().endswith('.jpg'))
        rng.shuffle(files)
        n = len(files)
        a, b = int(n * 0.70), int(n * 0.85)
        for name, chunk in (('train', files[:a]), ('val', files[a:b]), ('test', files[b:])):
            parts[name] += [(os.path.join(folder, f), y) for f in chunk]
        print(f'{label}: {n}장 (학습 {a}, 검증 {b - a}, 시험 {n - b})', flush=True)
    return parts


def build_model():
    if ARCH == 'mobilenet_v3_small':
        m = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.IMAGENET1K_V1)
    else:
        m = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V2)
    m.classifier[3] = nn.Linear(m.classifier[3].in_features, len(LABELS))
    return m


def evaluate(model, loader):
    model.eval()
    conf = [[0] * len(LABELS) for _ in LABELS]
    with torch.no_grad():
        for x, y in loader:
            pred = model(x).argmax(1)
            for t, p in zip(y.tolist(), pred.tolist()):
                conf[t][p] += 1
    total = sum(map(sum, conf))
    acc = sum(conf[i][i] for i in range(len(LABELS))) / max(1, total)
    return acc, conf


def report(conf, title):
    lines = [title, '실제 \\ 판정 → ' + ' | '.join(LABELS)]
    for i, row in enumerate(conf):
        n = sum(row)
        lines.append(f'{LABELS[i]:<8} ' + ' | '.join(f'{v:>4}' for v in row) + f'   → 맞힌 비율 {row[i] / max(1, n):.0%} ({n}장)')
    return '\n'.join(lines)


def main():
    torch.manual_seed(SEED)
    torch.set_num_threads(max(1, os.cpu_count() or 4))
    os.makedirs(RUNS, exist_ok=True)
    parts = split_items()
    train = DataLoader(Photos(parts['train'], train_tf), batch_size=32, shuffle=True, num_workers=0)   # 윈도우에서 여러 일꾼은 메모리 오류(1455)가 나서 하나로
    val = DataLoader(Photos(parts['val'], eval_tf), batch_size=64, num_workers=0)   # 윈도우에서 여러 일꾼은 메모리 오류(1455)가 나서 하나로
    test = DataLoader(Photos(parts['test'], eval_tf), batch_size=64, num_workers=0)   # 윈도우에서 여러 일꾼은 메모리 오류(1455)가 나서 하나로

    model = build_model()
    # 1) 앞부분(이미 잘 배운 특징)은 얼리고 마지막 판단 부분만 2바퀴 → 2) 전체를 낮은 학습률로 다듬기
    plan = [('head', 2, 1e-3), ('all', EPOCHS, 3e-4)]
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    best, epoch_no = 0.0, 0
    for phase, epochs, lr in plan:
        for p in model.features.parameters():
            p.requires_grad = phase == 'all'
        opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=1e-4)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
        for _ in range(epochs):
            epoch_no += 1
            model.train()
            t0, seen, run_loss = time.time(), 0, 0.0
            for x, y in train:
                opt.zero_grad()
                loss = loss_fn(model(x), y)
                loss.backward()
                opt.step()
                seen += len(y)
                run_loss += loss.item() * len(y)
            sched.step()
            acc, _ = evaluate(model, val)
            print(f'{epoch_no}바퀴({phase}) 손실 {run_loss / seen:.3f} · 검증 정확도 {acc:.1%} · {time.time() - t0:.0f}초', flush=True)
            if acc > best:
                best = acc
                torch.save(model.state_dict(), os.path.join(RUNS, 'best.pt'))

    model.load_state_dict(torch.load(os.path.join(RUNS, 'best.pt')))
    acc, conf = evaluate(model, test)
    text = report(conf, f'시험 사진(학습에 안 쓴 {sum(map(sum, conf))}장) 정확도 {acc:.1%}')
    print(text, flush=True)
    with open(os.path.join(RUNS, 'report.txt'), 'w', encoding='utf-8') as f:
        f.write(text + '\n')
    with open(os.path.join(RUNS, 'labels.json'), 'w', encoding='utf-8') as f:
        json.dump({'labels': LABELS, 'size': SIZE, 'mean': MEAN, 'std': STD, 'test_accuracy': round(acc, 4)}, f, ensure_ascii=False)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

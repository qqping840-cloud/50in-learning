# -*- coding: utf-8 -*-
"""
gen_textures.py — 生成错题仪表盘「和纸 + 印章」真实纹理

输出（assets/textures/）：
  washi-light.png  640x640 RGB   浅色和纸
  washi-dark.png   640x640 RGB   深色暖纸
  seal.png         256x256 RGBA  朱红印章（背景透明）
另存预览：<TEMP>/tex-preview.png（三图并排，供人眼检查）

用法：python tools/gen_textures.py
依赖：numpy、Pillow。固定随机种子，可重复运行。
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "textures")
PREVIEW = os.path.join(
    os.environ.get("TEMP", os.path.expanduser("~")), "opencode", "tex-preview.png"
)

SEED = 20261008
S = 640            # 和纸边长
SEAL_S = 256       # 印章边长
SEAL_RGB = np.array([176, 58, 46], dtype=np.float64)   # 朱红


# ---------- 噪声工具 ----------
def _value_noise(shape, res, rng):
    """粗随机网格 -> BICUBIC 放大成平滑噪声（0~1）。"""
    h, w = shape
    grid = rng.random((res + 1, res + 1))
    img = Image.fromarray((grid * 255).astype(np.uint8))
    img = img.resize((w, h), Image.Resampling.BICUBIC)
    return np.asarray(img, dtype=np.float64) / 255.0


def fbm(shape, octaves, rng, base_res=4, gain=0.5):
    """分形布朗运动：多八度叠加，返回 0~1。"""
    total = np.zeros(shape, dtype=np.float64)
    amp, norm, res = 1.0, 0.0, base_res
    for _ in range(octaves):
        total += amp * _value_noise(shape, res, rng)
        norm += amp
        amp *= gain
        res *= 2
    return total / norm


# ---------- 和纸 ----------
def make_washi(base_rgb, noise_amp, fiber_amp, seed):
    rng = np.random.default_rng(seed)
    base = np.array(base_rgb, dtype=np.float64)

    # 1. 底色 + fBm 明度起伏（各通道同加，保持色调不脏）
    lum = (fbm((S, S), 4, rng, base_res=4) - 0.5) * 2.0 * noise_amp
    # 轻微逐通道色偏，避免死板
    tint = (fbm((S, S), 3, rng, base_res=6) - 0.5) * 2.0 * (noise_amp * 0.35)
    arr = np.empty((S, S, 3), dtype=np.float64)
    for c in range(3):
        arr[..., c] = base[c] + lum + tint * (1.0 if c == 0 else -0.5)

    # 2. 纸纤维：随机起点短曲线，深浅各半，极低透明度
    overlay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for i in range(300):
        x = rng.uniform(0, S)
        y = rng.uniform(0, S)
        ang = rng.uniform(0, 2 * np.pi)
        length = rng.uniform(6, 34)
        steps = int(rng.integers(3, 8))
        dark = (i % 2 == 0)
        col = (0, 0, 0) if dark else (255, 255, 255)
        alpha = int(rng.uniform(16, 42))
        pts = [(x, y)]
        for _ in range(steps):
            ang += rng.uniform(-0.6, 0.6)
            seg = length / steps
            x += np.cos(ang) * seg
            y += np.sin(ang) * seg
            pts.append((x, y))
        draw.line(pts, fill=col + (alpha,), width=1)

    # 3. 纸屑深斑
    for _ in range(16):
        cx, cy = rng.uniform(0, S), rng.uniform(0, S)
        r = rng.uniform(0.8, 2.0)
        a = int(rng.uniform(30, 70))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(20, 16, 12, a))

    # 合成：纤维整体淡入（alpha 再压一档），深色纸纤维对比更弱
    ov = np.asarray(overlay, dtype=np.float64)
    ov[..., 3] *= 0.55
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    out = Image.alpha_composite(out.convert("RGBA"), Image.fromarray(ov.astype(np.uint8), "RGBA"))
    return out.convert("RGB")


# ---------- 印章 ----------
def make_seal(seed):
    rng = np.random.default_rng(seed)

    # 1. 圆角方形实心蒙版
    m = Image.new("L", (SEAL_S, SEAL_S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, SEAL_S - 1, SEAL_S - 1], radius=26, fill=255)
    M = np.asarray(m, dtype=np.float64) / 255.0

    # 2. 边缘不规则：噪声腐蚀出「飞白」缺口（只动边缘带，缺口大小随噪声深浅）
    eroded = m.filter(ImageFilter.MinFilter(9))
    band = np.clip(M - np.asarray(eroded, dtype=np.float64) / 255.0, 0, 1)
    n_edge = fbm((SEAL_S, SEAL_S), 5, rng, base_res=6)
    M = np.where((band > 0.05) & (n_edge < 0.46), 0.0, M)
    # 局部外扩（膨胀）制造参差毛边
    dilated = m.filter(ImageFilter.MaxFilter(5))
    out_band = np.asarray(dilated, dtype=np.float64) / 255.0 - np.asarray(m, dtype=np.float64) / 255.0
    n_edge2 = fbm((SEAL_S, SEAL_S), 5, rng, base_res=8)
    M = np.maximum(M, ((out_band > 0.2) & (n_edge2 > 0.60)).astype(np.float64))

    # 3. 印面油墨浓淡：细颗粒 + 轻微明度/alpha 起伏，局部微发白（不能成云）
    ink = fbm((SEAL_S, SEAL_S), 5, rng, base_res=26)
    ink2 = fbm((SEAL_S, SEAL_S), 5, rng, base_res=34)
    bright = 0.90 + 0.16 * ink
    rgb = np.clip(SEAL_RGB[None, None, :] * bright[..., None], 0, 255)
    white_amt = np.clip((ink - 0.86) * 1.5, 0, 0.22)[..., None]
    rgb = rgb * (1 - white_amt) + np.array([236, 226, 214])[None, None, :] * white_amt

    # 4. 细内框线（同样做磨损）
    fr = Image.new("L", (SEAL_S, SEAL_S), 0)
    ImageDraw.Draw(fr).rounded_rectangle(
        [17, 17, SEAL_S - 18, SEAL_S - 18], radius=15, outline=255, width=2
    )
    FR = (np.asarray(fr, dtype=np.float64) / 255.0) * (fbm((SEAL_S, SEAL_S), 5, rng, base_res=12) > 0.3)
    rgb = np.where(FR[..., None] > 0, SEAL_RGB[None, None, :] * 0.82, rgb)

    # 5. alpha：中心保持实心，背景全透明
    a_mod = np.clip(0.86 + 0.14 * ink2, 0.80, 1.0)
    A = 255.0 * M * a_mod
    A = np.maximum(A, 255.0 * FR * M)
    A *= (M > 0)   # 蒙版外一律透明

    rgba = np.dstack([rgb, A]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


# ---------- 预览 ----------
def make_preview(imgs):
    cell = 200
    pad = 20
    bg = Image.new("RGB", (cell * 3 + pad * 4, cell + pad * 2), (239, 235, 228))
    x = pad
    for im in imgs:
        thumb = im.resize((cell, cell), Image.Resampling.LANCZOS)
        bg.paste(thumb, (x, pad), thumb if thumb.mode == "RGBA" else None)
        x += cell + pad
    os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
    bg.save(PREVIEW)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    light = make_washi((247, 242, 232), noise_amp=5.0, fiber_amp=1.0, seed=SEED + 1)
    dark = make_washi((33, 30, 27), noise_amp=2.2, fiber_amp=0.4, seed=SEED + 2)
    seal = make_seal(SEED + 3)

    light.save(os.path.join(OUT_DIR, "washi-light.png"))
    dark.save(os.path.join(OUT_DIR, "washi-dark.png"))
    seal.save(os.path.join(OUT_DIR, "seal.png"))
    make_preview([light, dark, seal])

    # 自检：尺寸与模式
    for name, im in (("washi-light.png", light), ("washi-dark.png", dark), ("seal.png", seal)):
        print(f"{name}: size={im.size} mode={im.mode}")
    print("preview:", PREVIEW)
    assert light.size == (S, S) and light.mode == "RGB"
    assert dark.size == (S, S) and dark.mode == "RGB"
    assert seal.size == (SEAL_S, SEAL_S) and seal.mode == "RGBA"
    assert os.path.exists(PREVIEW)


if __name__ == "__main__":
    main()

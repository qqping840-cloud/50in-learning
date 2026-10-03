# -*- coding: utf-8 -*-
"""
gen_tts.py — 离线批量生成朗读音频 + 词级时间戳

给「阅读页 · 整篇朗读跟读高亮」用：
  - 用 edge-tts（微软 Edge 在线神经语音，免费、无需 API key）
  - boundary="WordBoundary" 拿到日语词级边界（默认是句级，必须显式开）
  - 输出到 assets/tts/：
      lib-<idx>.mp3   朗读音频
      lib-<idx>.json  { voice, index, words:[{t,start,dur}] }（start/dur 单位毫秒）

用法：
  python tools/gen_tts.py                 # 全部内置文章，默认日语女声 Nanami
  python tools/gen_tts.py --voice ja-JP-KeitaNeural
  python tools/gen_tts.py --only 0        # 只重新生成第 0 篇

依赖：pip install edge-tts
"""
import argparse
import asyncio
import json
import os
import re
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT, "js", "library.js")
OUT_DIR = os.path.join(ROOT, "assets", "tts")

# 从正文里剔除的标点/空白（用于校验边界拼回是否等于原文，不含长音符 ー）
PUNCT = "、。！？，．「」『』（）・：；…　 \t\r\n"


def read_library_texts(path):
    """粗读 js/library.js，按出现顺序取出每篇的 text 字段。"""
    src = open(path, encoding="utf-8").read()
    return re.findall(r"text:\s*'([^']*)'", src)


async def synth(text, voice):
    c = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    audio = bytearray()
    words = []
    async for chunk in c.stream():
        t = chunk.get("type")
        if t == "audio":
            audio.extend(chunk["data"])
        elif t == "WordBoundary":
            words.append({
                "t": chunk["text"],
                "start": round(chunk["offset"] / 10000),   # 100ns -> ms
                "dur": round(chunk["duration"] / 10000),
            })
    return bytes(audio), words


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ja-JP-NanamiNeural")
    ap.add_argument("--only", type=int, default=-1, help="只生成指定下标的文章")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    texts = read_library_texts(LIB_PATH)
    if not texts:
        print("没读到任何文章，检查 js/library.js", file=sys.stderr)
        return 1

    print("voice:", args.voice, "| 文章数:", len(texts))
    targets = range(len(texts)) if args.only < 0 else [args.only]

    for i in targets:
        text = texts[i]
        audio, words = await synth(text, args.voice)
        mp3_path = os.path.join(OUT_DIR, "lib-%d.mp3" % i)
        json_path = os.path.join(OUT_DIR, "lib-%d.json" % i)
        with open(mp3_path, "wb") as f:
            f.write(audio)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"voice": args.voice, "index": i, "words": words},
                      f, ensure_ascii=False)

        joined = "".join(w["t"] for w in words)
        src_norm = "".join(ch for ch in text if ch not in PUNCT)
        ok = (joined == src_norm)
        print("lib-%d: %d bytes, %d words, align=%s" % (i, len(audio), len(words), ok))
        if not ok:
            # 只提示，不中断；前端有贪心重对齐兜底
            n = min(len(joined), len(src_norm))
            k = next((j for j in range(n) if joined[j] != src_norm[j]), n)
            print("   first diff @%d" % k)
            print("   src:", src_norm[max(0, k - 10):k + 20])
            print("   got:", joined[max(0, k - 10):k + 20])

    print("done ->", OUT_DIR)
    return 0


sys.exit(asyncio.run(main()))

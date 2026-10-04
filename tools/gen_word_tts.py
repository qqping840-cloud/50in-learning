# -*- coding: utf-8 -*-
"""
gen_word_tts.py — 离线批量生成【单词本】的单词发音

和 gen_tts.py（整篇文章朗读）同一套 edge-tts，只是颗粒度是「一个词一个 mp3」。
输出到 assets/audio/words/<假名>.mp3，前端 UI.speak() 会优先命中这里，
从而不依赖系统日语音包、发音标准。

用法：
  python tools/gen_word_tts.py                 # 全部单词本，默认日语女声 Nanami
  python tools/gen_word_tts.py --voice ja-JP-KeitaNeural
  python tools/gen_word_tts.py --only 0        # 只生成第 0 本
  python tools/gen_word_tts.py --force         # 已存在的也重新生成

依赖：pip install edge-tts
"""
import argparse
import asyncio
import os
import re
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WB_PATH = os.path.join(ROOT, "js", "wordbook.js")
OUT_DIR = os.path.join(ROOT, "assets", "audio", "words")


def read_wordbooks(path):
    """粗读 js/wordbook.js，抽出每个 kana 字段（按出现顺序）。"""
    src = open(path, encoding="utf-8").read()
    return re.findall(r"kana:\s*'([^']*)'", src)


async def synth(text, voice):
    c = edge_tts.Communicate(text, voice)
    audio = bytearray()
    async for chunk in c.stream():
        if chunk.get("type") == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ja-JP-NanamiNeural")
    ap.add_argument("--force", action="store_true", help="已存在的也重新生成")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    kana_list = read_wordbooks(WB_PATH)
    # 去重但保持顺序
    seen = set()
    words = [k for k in kana_list if k and not (k in seen or seen.add(k))]
    if not words:
        print("没读到任何单词，检查 js/wordbook.js", file=sys.stderr)
        return 1

    print("voice:", args.voice, "| 单词数:", len(words))
    made = skipped = 0
    for w in words:
        path = os.path.join(OUT_DIR, w + ".mp3")
        if os.path.exists(path) and not args.force:
            skipped += 1
            continue
        audio = await synth(w, args.voice)
        with open(path, "wb") as f:
            f.write(audio)
        made += 1
        print("  %s: %d bytes" % (w, len(audio)))

    print("done -> %s (新生成 %d, 跳过 %d)" % (OUT_DIR, made, skipped))
    return 0


sys.exit(asyncio.run(main()))

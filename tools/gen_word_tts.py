# -*- coding: utf-8 -*-
"""
gen_word_tts.py — 离线批量生成【单词本】的音频

和 gen_tts.py（整篇文章朗读）同一套 edge-tts，生成两种颗粒度的音频：
  1. 单词本身：assets/audio/words/<假名>.mp3
  2. 例句朗读：assets/audio/ex/ex-<n>.mp3 + ex-<n>.json（词级时间戳）
     以及清单 assets/audio/ex/manifest.json = { "<例句原文>": n }

前端 UI.speak() 优先命中 words/ 里的词音频；
例句朗读用 manifest.json 按原文查出 n，再播 ex-<n>.mp3 并跟读高亮。

用法：
  python tools/gen_word_tts.py                 # 词 + 例句，默认日语女声 Nanami
  python tools/gen_word_tts.py --voice ja-JP-KeitaNeural
  python tools/gen_word_tts.py --force         # 已存在的也重新生成
  python tools/gen_word_tts.py --skip-ex       # 只生成单词，不生成例句

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
WB_PATH = os.path.join(ROOT, "js", "wordbook.js")
WORD_DIR = os.path.join(ROOT, "assets", "audio", "words")
EX_DIR = os.path.join(ROOT, "assets", "audio", "ex")

# 从例句里剔除的标点/空白（校验边界拼回是否等于原文）
PUNCT = "、。！？，．「」『』（）・：；…　 \t\r\n"


def read_kana_words(path):
    """粗读 js/wordbook.js，抽出每个词条的 kana 字段。"""
    src = open(path, encoding="utf-8").read()
    # 只取词条顶层的 kana（例句 words 里用的是 t，不冲突）
    return re.findall(r"kana:\s*'([^']*)'", src)


def read_examples(path):
    """粗读 js/wordbook.js，抽出每个例句的 ja 原文（按出现顺序）。"""
    src = open(path, encoding="utf-8").read()
    return re.findall(r"ex:\s*\{\s*ja:\s*'([^']*)'", src)


async def synth_audio(text, voice):
    """只取音频字节。"""
    c = edge_tts.Communicate(text, voice)
    audio = bytearray()
    async for chunk in c.stream():
        if chunk.get("type") == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


async def synth_audio_words(text, voice):
    """音频 + 词级时间戳（WordBoundary 必须显式开）。"""
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


async def gen_words(path, voice, force):
    kana_list = read_kana_words(path)
    seen = set()
    words = [k for k in kana_list if k and not (k in seen or seen.add(k))]
    made = skipped = 0
    for w in words:
        out = os.path.join(WORD_DIR, w + ".mp3")
        if os.path.exists(out) and not force:
            skipped += 1
            continue
        audio = await synth_audio(w, voice)
        with open(out, "wb") as f:
            f.write(audio)
        made += 1
        print("  [词] %s: %d bytes" % (w, len(audio)))
    print("单词：新生成 %d，跳过 %d，共 %d" % (made, skipped, len(words)))
    return made


async def gen_examples(path, voice, force):
    ex_texts = read_examples(path)
    # 去重但保持顺序
    seen = set()
    texts = [t for t in ex_texts if t and not (t in seen or seen.add(t))]
    manifest = {}
    made = skipped = 0
    for i, text in enumerate(texts):
        n = i
        mp3 = os.path.join(EX_DIR, "ex-%d.mp3" % n)
        js = os.path.join(EX_DIR, "ex-%d.json" % n)
        manifest[text] = n
        if os.path.exists(mp3) and os.path.exists(js) and not force:
            skipped += 1
            continue
        audio, words = await synth_audio_words(text, voice)
        with open(mp3, "wb") as f:
            f.write(audio)
        with open(js, "w", encoding="utf-8") as f:
            json.dump({"voice": voice, "index": n, "words": words}, f, ensure_ascii=False)
        joined = "".join(w["t"] for w in words)
        src_norm = "".join(ch for ch in text if ch not in PUNCT)
        made += 1
        print("  [例] ex-%d: %d bytes, %d words, align=%s" % (n, len(audio), len(words), joined == src_norm))
    # manifest 始终写全（保证新增例句后能查到）
    with open(os.path.join(EX_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print("例句：新生成 %d，跳过 %d，共 %d（manifest 已更新）" % (made, skipped, len(texts)))
    return made


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ja-JP-NanamiNeural")
    ap.add_argument("--force", action="store_true", help="已存在的也重新生成")
    ap.add_argument("--skip-ex", action="store_true", help="只生成单词，不生成例句")
    args = ap.parse_args()

    os.makedirs(WORD_DIR, exist_ok=True)
    os.makedirs(EX_DIR, exist_ok=True)
    print("voice:", args.voice)

    await gen_words(WB_PATH, args.voice, args.force)
    if not args.skip_ex:
        await gen_examples(WB_PATH, args.voice, args.force)

    print("done -> %s / %s" % (WORD_DIR, EX_DIR))
    return 0


sys.exit(asyncio.run(main()))

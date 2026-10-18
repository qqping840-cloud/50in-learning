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

from edge_endpoint import use_new_endpoint, with_retry

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
    return re.findall(r"kana:\s*'([^']*)'", src) + [w["kana"] for w in read_n5_words()]


def read_examples(path):
    """粗读 js/wordbook.js，抽出每个例句的 ja 原文（按出现顺序）。"""
    src = open(path, encoding="utf-8").read()
    return re.findall(r"ex:\s*\{\s*ja:\s*'([^']*)'", src) + [w["ex"]["ja"] for w in read_n5_words() if w.get("ex")]


def read_n5_words():
    with open(os.path.join(ROOT, "js", "n5-wordbook.js"), encoding="utf-8") as f:
        src = f.read()
    return json.loads(src.split("window.WORDBOOKS.push(", 1)[1].rsplit(");", 1)[0])["words"]


async def _synth_audio_once(text, voice):
    """只取音频字节。"""
    use_new_endpoint()
    c = edge_tts.Communicate(text, voice)
    audio = bytearray()
    async for chunk in c.stream():
        if chunk.get("type") == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


async def synth_audio(text, voice):
    return await with_retry(lambda: _synth_audio_once(text, voice))


async def _synth_audio_words_once(text, voice):
    """音频 + 词级时间戳（WordBoundary 必须显式开）。"""
    use_new_endpoint()
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


async def synth_audio_words(text, voice):
    return await with_retry(lambda: _synth_audio_words_once(text, voice))


async def gen_words(path, voice, force):
    kana_list = read_kana_words(path)
    seen = set()
    words = [k for k in kana_list if k and not (k in seen or seen.add(k))]
    semaphore = asyncio.Semaphore(4)

    async def generate(w):
        async with semaphore:
            out = os.path.join(WORD_DIR, w + ".mp3")
            if os.path.isfile(out) and os.path.getsize(out) > 0 and not force:
                return False
            for attempt in range(4):
                try:
                    audio = await synth_audio(w, voice)
                    if not audio:
                        raise ValueError("音频为空")
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    await asyncio.sleep(attempt + 1)
            with open(out + ".tmp", "wb") as f:
                f.write(audio)
            os.replace(out + ".tmp", out)
            print("  [词] %s: %d bytes" % (w, len(audio)), flush=True)
            return True

    results = await asyncio.gather(*(generate(w) for w in words), return_exceptions=True)
    made = sum(result is True for result in results)
    skipped = sum(result is False for result in results)
    failed = 0
    for w, result in zip(words, results):
        if isinstance(result, BaseException):
            failed += 1
            print("  [词失败] %s: %s" % (w, result), file=sys.stderr, flush=True)
    print("单词：新生成 %d，跳过 %d，共 %d" % (made, skipped, len(words)))
    if failed:
        raise RuntimeError("%d 个单词音频生成失败；重新运行可继续生成" % failed)
    return made


async def gen_examples(path, voice, force):
    ex_texts = read_examples(path)
    manifest_path = os.path.join(EX_DIR, "manifest.json")
    offline_path = os.path.join(ROOT, "js", "offline-data.js")
    offline = None
    if os.path.isfile(offline_path):
        with open(offline_path, encoding="utf-8") as f:
            offline_prefix, offline_json = f.read().split("window.OFFLINE = ", 1)
        offline = json.loads(offline_json.strip().removesuffix(";"))
        if not isinstance(offline, dict):
            raise ValueError("offline-data.js 中的 OFFLINE 必须是对象")
    try:
        with open(manifest_path, encoding="utf-8") as f:
            old_manifest = json.load(f)
    except (OSError, ValueError):
        old_manifest = {}
    if not isinstance(old_manifest, dict):
        old_manifest = {}
    # 去重但保持顺序
    seen = set()
    texts = [t for t in ex_texts if t and not (t in seen or seen.add(t))]
    manifest = {}

    def valid_words(words):
        return isinstance(words, list) and bool(words) and all(
            isinstance(w, dict) and isinstance(w.get("t"), str) and bool(w["t"])
            and isinstance(w.get("start"), (int, float)) and w["start"] >= 0
            and isinstance(w.get("dur"), (int, float)) and w["dur"] > 0
            for w in words
        )

    def save_manifest():
        with open(manifest_path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
        os.replace(manifest_path + ".tmp", manifest_path)

    pending = []
    for n, text in enumerate(texts):
        mp3 = os.path.join(EX_DIR, "ex-%d.mp3" % n)
        js = os.path.join(EX_DIR, "ex-%d.json" % n)
        if not force and old_manifest.get(text) == n:
            try:
                with open(js, encoding="utf-8") as f:
                    metadata = json.load(f)
                if (os.path.isfile(mp3) and os.path.getsize(mp3) > 0
                        and isinstance(metadata, dict) and metadata.get("voice") == voice
                        and metadata.get("index") == n and valid_words(metadata.get("words"))):
                    manifest[text] = n
                    continue
            except (OSError, ValueError):
                pass
        pending.append((n, text, mp3, js))
    skipped = len(manifest)
    save_manifest()
    semaphore = asyncio.Semaphore(4)

    async def generate(n, text, mp3, js):
        async with semaphore:
            for attempt in range(4):
                try:
                    audio, words = await synth_audio_words(text, voice)
                    if not audio or not valid_words(words):
                        raise ValueError("音频为空或词级时间戳无效")
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    await asyncio.sleep(attempt + 1)
            with open(mp3 + ".tmp", "wb") as f:
                f.write(audio)
            with open(js + ".tmp", "w", encoding="utf-8") as f:
                json.dump({"voice": voice, "index": n, "words": words}, f, ensure_ascii=False)
            os.replace(mp3 + ".tmp", mp3)
            os.replace(js + ".tmp", js)
            manifest[text] = n
            save_manifest()
            joined = "".join(w["t"] for w in words)
            src_norm = "".join(ch for ch in text if ch not in PUNCT)
            print("  [例] ex-%d: %d bytes, %d words, align=%s" % (n, len(audio), len(words), joined == src_norm), flush=True)
            return True

    results = await asyncio.gather(*(generate(*item) for item in pending), return_exceptions=True)
    made = sum(result is True for result in results)
    failed = 0
    for (n, text, mp3, js), result in zip(pending, results):
        if isinstance(result, BaseException):
            failed += 1
            print("  [例失败] ex-%d %s: %s" % (n, text, result), file=sys.stderr, flush=True)
    if offline is not None:
        timings = {}
        for n in manifest.values():
            with open(os.path.join(EX_DIR, "ex-%d.json" % n), encoding="utf-8") as f:
                timings[str(n)] = json.load(f)
        offline["exManifest"] = manifest
        offline["exTiming"] = timings
        with open(offline_path + ".tmp", "w", encoding="utf-8") as f:
            f.write(offline_prefix + "window.OFFLINE = ")
            json.dump(offline, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";\n")
        os.replace(offline_path + ".tmp", offline_path)
    print("例句：新生成 %d，跳过 %d，共 %d（manifest 已更新）" % (made, skipped, len(texts)))
    if failed:
        raise RuntimeError("%d 个例句音频生成失败；重新运行可继续生成" % failed)
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

#!/usr/bin/env python3
"""合成单个词的语音（给 App 的点读接口按需调用）。

用法:
  python tts_one.py "だんご" ja-JP-NanamiNeural out.mp3

语音默认 ja-JP-NanamiNeural，与 tools/gen_word_tts.py 预生成的词音频一致，
点读听起来和词库/阅读板块是同一个人。
"""
import asyncio
import sys

import edge_tts

from edge_endpoint import use_new_endpoint, use_old_endpoint

# 单个词的合成上限：网络抽风时不能一直挂着（aiohttp 默认要等 5 分钟）
ATTEMPT_TIMEOUT = 20.0


async def _synth(text, voice, out, endpoint):
    endpoint()
    await asyncio.wait_for(
        edge_tts.Communicate(text, voice).save(out), timeout=ATTEMPT_TIMEOUT)


async def main(text, voice, out):
    last = None
    # 新端点会偶发握手失败，重试几次；旧端点只作最后兜底
    for attempt in range(3):
        try:
            await _synth(text, voice, out, use_new_endpoint)
            return
        except Exception as e:
            last = e
            await asyncio.sleep(0.8 * (attempt + 1))
    try:
        await _synth(text, voice, out, use_old_endpoint)
    except Exception:
        raise last


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("用法: tts_one.py <文本> <语音> <输出mp3>")
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3]))

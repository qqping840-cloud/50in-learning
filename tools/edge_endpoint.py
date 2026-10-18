"""edge-tts 端点补丁。

2026-10 起微软把 Edge 朗读的旧端点（speech.platform.bing.com）挡了，
所有请求返回 403 Invalid response status；换到微软的新端点即可继续用。

凡是用 edge_tts 生成语音的脚本（tools/tts_one.py、tools/gen_tts.py、
tools/gen_word_tts.py）都先调用 use_new_endpoint()。

等官方 edge-tts 自己跟上之后，这个模块和调用都可以删掉。
"""

import edge_tts.communicate as _communicate
from edge_tts.constants import TRUSTED_CLIENT_TOKEN

_OLD_WSS = _communicate.WSS_URL

NEW_WSS = ("wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
           f"?Ocp-Apim-Subscription-Key={TRUSTED_CLIENT_TOKEN}")


def use_new_endpoint():
    """把 edge_tts 的 WebSocket 地址换成新端点。"""
    _communicate.WSS_URL = NEW_WSS


def use_old_endpoint():
    """回退到旧端点（只作兜底，正常用不上）。"""
    _communicate.WSS_URL = _OLD_WSS


async def with_retry(factory, tries=3, delay=1.0, on_error=None):
    """新端点会偶发超时/握手失败，包一层重试。

    factory: 无参函数，每次调用返回一个新的 coroutine。
    on_error: 可选，接收 (第几次, 异常)，用于打印提示。
    """
    import asyncio

    last = None
    for i in range(tries):
        try:
            return await factory()
        except Exception as e:
            last = e
            if on_error:
                on_error(i + 1, e)
            if i < tries - 1:
                await asyncio.sleep(delay * (i + 1))
    raise last

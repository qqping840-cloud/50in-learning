# -*- coding: utf-8 -*-
"""
重建 assets/data/kana-kanji.json（多邻国词表补汉字形用的「假名 → 汉字」映射）

数据源：scriptin/jmdict-simplified 的 jmdict-eng-common（JMdict，CC BY-SA 4.0）
  https://github.com/scriptin/jmdict-simplified/releases

用法：
  1. 下载 jmdict-eng-common-<版本>.json.zip 解压
  2. python tools/build_kana_kanji.py <解压出来的 json 路径>

筛选规则（改规则请同步改 duo-sync.js 的 resolveKanji 并跑 node tools/test_duo_kanji.js）：
  - 只要「常用汉字形」且不带 io/oK/rK/sK/ateji 这类非常用标记的词条
  - 排除助词、代词、叹词、量词等非实词
  - 排除单假名（几乎都是助词，套汉字形容易张冠李戴）
"""
import json
import os
import sys

BAD_POS = {"prt", "cop", "aux", "aux-v", "aux-adj", "conj", "int", "exp", "pn", "adj-pn", "ctr"}
BAD_TAGS = {"io", "oK", "rK", "sK", "ateji", "sk", "ik"}
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "data", "kana-kanji.json")


def kana_norm(s):
    # 片假名 → 平假名
    return "".join(chr(ord(c) - 0x60) if 0x30A1 <= ord(c) <= 0x30F6 else c for c in s)


def main(src):
    data = json.load(open(src, encoding="utf-8"))
    cands = {}
    for w in data["words"]:
        forms = [k["text"] for k in w.get("kanji", [])
                 if k.get("common") and not (set(k.get("tags") or []) & BAD_TAGS)]
        if not forms:
            continue
        poses = set()
        for s in w.get("sense", []):
            poses.update(s.get("partOfSpeech") or [])
        if not poses or poses <= BAD_POS:
            continue
        for r in w.get("kana", []):
            if not r.get("common"):
                continue
            kana = kana_norm(r["text"])
            if len(kana) < 2:
                continue
            slot = cands.setdefault(kana, [])
            for f in forms:
                if f not in slot:
                    slot.append(f)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(cands, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("假名条目 %d 条，写入 %s（%d 字节）" % (len(cands), OUT, os.path.getsize(OUT)))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])

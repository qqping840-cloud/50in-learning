# N5 词库

作者：5mdld（egg rolls）。来源：[anki-jlpt-decks](https://github.com/5mdld/anki-jlpt-decks)。

本项目的 `js/n5-wordbook.js` 改编自该仓库 `deck-source/notes.csv`，固定来源提交为 `853798a4dec3630cad1984aa1c7edab31b09d109`。
词条、释义和例句采用 [Creative Commons Attribution-NonCommercial 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/)（CC BY-NC 4.0）许可。来源材料按原样提供，不保证准确性。非商业使用时须保留作者、来源和许可；商业使用需另获许可。

转换修改：只取 N5 分组，提取简体中文释义及第一条例句，去除 HTML 格式；片假名词使用词本身作为读音，计数后缀读音去除 `〜`；词性归并为项目现有分类。保留来源词条 ID，同音异义词分别保留。未导入原牌组音频或卡片模板。

重新导入：下载上述固定提交的 `deck-source/notes.csv`，运行 `node tools/import_n5_wordbook.js <文件路径>`。
该词库的 N5 分级来自社区整理，不是官方公布的考试词汇清单。

# Anki 源码参考

参考了 [Anki 调度状态源码](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/mod.rs)，其中区分新卡、学习、复习和重新学习状态。
本次只导入单词数据，没有复制 Anki 源码，也没有将现有复习算法替换为 FSRS。

# JMdict 汉字形（kana-kanji.json）

多邻国词表补汉字形用 `assets/data/kana-kanji.json`，由 [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html)（Electronic Dictionary Research and Development Group，CC BY-SA 4.0）派生：

- 数据来自 [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified) 的 `jmdict-eng-common`（3.6.2 版），只用「常用词条 + 常用汉字形」的假名→汉字映射
- 已剔除助词、代词、叹词、量词等非实词，以及单假名和片段性词条
- 只保留假名与汉字形的对应关系，未分发释义正文
- 使用须遵守 JMdict 的 CC BY-SA 4.0：本项目未修改映射内容，仅做了筛选与去重

# 多邻国原声发音

单词页「多邻国」词表的发音是同步时从多邻国（Duolingo）的音频 CDN 下载的原声 mp3，仅作个人学习用途，保存在 `assets/audio/duo/`（不进 Git）。该音频的权利归多邻国所有，不要二次分发。

# 日语朗读语音（edge-tts / Microsoft Edge 朗读）

项目所有日语发音来自微软 Edge 的「大声朗读」语音服务，语音固定为 `ja-JP-NanamiNeural`。

- 客户端：[rany2/edge-tts](https://github.com/rany2/edge-tts)，本机安装版本声明的许可为 **LGPLv3**。
- 音频由微软的朗读服务在线合成；本项目的脚本只是调用方，不含语音模型。
- 合成结果按需缓存在本地 `assets/audio/tts/`（不进 Git），词库与例句音频用 `tools/gen_word_tts.py`、`tools/gen_tts.py` 预生成。
- 该服务是微软的公开朗读接口，未承诺可用性与授权范围；仅用于个人学习场景。

# 日语分词与注音（kuroshiro / kuromoji）

阅读页注音、视频页罗马音使用随项目分发的：

- [kuroshiro](https://github.com/Hexenq/kuroshiro)（MIT）
- [kuroshiro-analyzer-kuromoji](https://github.com/Hexenq/kuroshiro-analyzer-kuromoji)（MIT），内含 [kuromoji.js](https://github.com/takuyaa/kuromoji.js)（Apache-2.0）词典

文件位于 `assets/lib/`（含 `assets/lib/dict/` 词典），均为离线分发，不联网。

# 50音学堂

本地运行的日语学习网页应用。零构建步骤、无 npm 依赖，浏览器打开 `http://localhost:3000` 即用。

## 跑起来

```powershell
start.bat            # 等价于 node server.js
```

默认端口 `3000`。首次运行会自动从 `config.example.json` 生成 `config.json`（含端口、DeepSeek API Key、视频字幕库目录、点读语音名）。`config.json` 是私人的，不进 Git。

> **固定用 `http://localhost:3000` 打开。** 浏览器把 `localhost` 和 `127.0.0.1` 当成两个不同站点，学习进度（localStorage）各存一份，换着打开会看到「进度清零」。服务端已把 `127.0.0.1` 的访问自动 301 跳到 `localhost`；换浏览器也一样看不到对方的数据。

## 页面

| 页面 | 说明 |
|---|---|
| 首页 / 音表 / 学习 / 练习 / 测验 | 五十音与单词练习、复习 |
| 单词 | N5 词库（来源与许可见 `THIRD_PARTY.md`） |
| 阅读 | 文章注音、逐句译文、点词发音、逐句点读（截整篇音频，Nanami，可离线） |
| 视频 | 左侧原视频 + 右侧日语/译文字幕 |

## 视频页

### 字幕库（像选集一样打开）

服务端扫描 `subs/` 目录（可在 `config.json` 的 `subtitleDir` 改），把里面的**成品**列为可点选列表，进入页面自动打开第一条，不用每次选文件。

配对规则：**视频文件要和字幕同名**才会自动配上，同名三件套各管一件事：

```
団子大家族.study.json   日语字幕 + 逐词/逐字时间（没有也行，只是没有词级跟随）
団子大家族.zh.srt       中文译文（时间轴必须和日语字幕一致，否则拒绝加载）
団子大家族.mp4          视频（缺了就标「无视频」，可手动导入补）
```

### 开关与交互

- **译文**：显示/隐藏中文
- **跟随**：自动滚到当前句
- **罗马音**：每个词上方标罗马音（选择会被记住）
- **点词** → 发音；**悬停词** → 弹出「假名 + 中文词义」；**句首圆钮** → 只重播这一句原声；**点句子** → 视频跳到该句
- **椭圆光斑**：跟当前词（有逐字时间时跟到单个词，否则跟整句）
- **词划分以素材为准**：按钮按字幕文件里的词边界（`study.json` 的 `words`）切；素材没有词划分（纯 srt）才退回通用分词器。想让分词更贴合，就在准备素材时把歌词按**词**加空格——通用分词器会把「だんご」切成 `だ|ん|ご`，罗马音、词义、光斑全跟着散。

> 词义来源：先查本地词库（离线、即时），词库里没有的在载入字幕后**一次性**问模型补齐，结果缓存在浏览器本地，之后悬停即时显示。**问的时候会把每个词所在的那句原文一起给模型**（语境决定词义），缓存也按「句子 + 词」保存。词库欠费/断网时只显示假名，原因记在 `logs/app.jsonl`（`gloss_failed`）。

### 准备学习素材

完整规范见 **[`docs/视频素材全流程.md`](docs/视频素材全流程.md)**（每个阶段的命令、硬规则、质量闸门）。要点如下，用另一个仓库的转写工具产出「同名三件套」，丢进 `subs/`，刷新页面即可：

```powershell
# 1) 转录成学习字幕（study.json + 日语 srt）
transcribe "https://..." -l ja --no-subs --fine --study -o "E:\日语50音\subs"

# 2) 有已知歌词时，先做句级对齐（歌词文件按「词」加空格，见下）
transcribe --align-lyrics "名.study.json" --lyrics lyrics.txt

# 3) 需要逐词精度时再做一次强制对齐（装在 E:\align-venv，见该仓库 README）
E:\align-venv\Scripts\python.exe E:\dango-subtitle-converter\transcribe\tools\align_words.py `
  --study "名.study.aligned.study.json" --media "名.mp4" --device cuda

# 4) 回填中文译文
transcribe --retext "名.srt" --text "名.zh.txt"
```

**歌词文件要按词加空格**：词划分、罗马音、词义、光斑粒度全由它决定。
加空格**不影响**歌词与音频的行匹配（匹配时会忽略空格），但会影响显示的断词：

```
おすましごまだんご 四つ子串だんご     ← 分词器切成 おす|まし|ごま|だ|ん|ご
おすまし ごまだんご 四つ子 串だんご    ← 就按这四个词显示
```

## 接口

| 接口 | 用途 |
|---|---|
| `GET /api/library` | 列出字幕库里的成品 |
| `GET /api/library/<id>/{media,study,zh,srt}` | 取视频（支持 Range，进度条可拖）或字幕 |
| `GET /api/tts?text=<词>` | 点读发音：先查词库/假名音频 → 查缓存 → 合成并存本地 |
| `POST /api/generate`、`POST /api/gloss-fill` | DeepSeek 生成文章 / 词义批注 |
| `GET`+`POST /api/config` | 读取/保存本地配置（白名单字段） |

## 工具

| 文件 | 用途 |
|---|---|
| `tools/gen_word_tts.py` | 预生成词库与例句音频（`--force` 重生成） |
| `tools/gen_tts.py` | 预生成文章音频（`--only N` 只做一篇） |
| `tools/tts_one.py` | 单个词的按需合成，被 `/api/tts` 调用 |
| `tools/edge_endpoint.py` | edge-tts 端点补丁 + 重试（2026-10 起旧端点被封，403） |
| `tools/import_n5_wordbook.js` | 导入 N5 词库 |
| `tools/bake_offline.js` | 离线预生成注音与朗读时间戳（让双击 `index.html` 也能用） |
| `tools/bake_offline_tts.js` | 只刷新离线朗读时间戳（重跑 `gen_tts.py` 后必跑，否则 file:// 下高亮/逐句点读会对不上音频） |
| `tools/test_video_study.js` | 视频页字幕解析的自检 |

自检：

```powershell
node tools/test_video_study.js
```

## 日志

`logs/app.jsonl`（一行一个 JSON，追加写入，**不进 Git**；写不进去只会在终端提示一次，不影响功能）。

| 事件 | 含义 |
|---|---|
| `server_started` | 服务启动，含端口 |
| `tts_synth` | 新合成一个词（含词、语音名、耗时） |
| `tts_failed` | 合成失败（含词、耗时、原因摘要） |
| `library_read_failed` | 字幕库目录读不了 |
| `library_file_missing` | 请求的字幕/视频不存在 |
| `server_error` | 未捕获的服务器异常 |

只记时间、事件、结果、耗时和**那个词**（否则「哪个词没合成出来」无法排查）；不记完整路径、字幕正文、API Key、cookie。前端侧的反馈在页面上：字幕读取失败会显示原因，语音没备齐会提示「有 N 个语音没存上」。

## 约定

- 改代码前先读 **`AGENTS.md`**（音源规范：发音一律走 `UI.speak` → Edge Nanami，合成结果存本地）。
- 第三方来源与许可见 **`THIRD_PARTY.md`**。

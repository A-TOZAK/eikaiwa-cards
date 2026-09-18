# 英会話カード

個人用の英会話カードです。スマホで開いて使います。検索には出ない設定にしています。

- 棚ごとにカードをめくります。日本語を見て英語で言い、答えと音声で確かめます。
- おぼえたカードに印をつけます。印はそのスマホの中にだけ保存されます。
- 聞き流しでは、日本語、考える間、英語、まねる間の順に音声が流れます。

## 入れるものの決まり

公開の場所に置くので、会場で初対面の先生に話せることだけを入れます。
学校名、子どもや保護者の具体的な話、まだ公にしていない予定は入れません。`tools/build.py` が禁止語を機械でも止めます。

## 作り方

```bash
/usr/bin/python3 tools/build.py --check   # 検査だけ
/usr/bin/python3 tools/build.py           # 足りない音声を作り、data/cards.json を書き出す
```

- 元データは `data/src/*.json`（棚ごとに1ファイル）。
- 音声は edge-tts で作ります。英語は en-US-BrianMultilingualNeural、日本語は ja-JP-NanamiNeural です。
- 絵は School Stock 素材スタジオの水彩です。文字は絵に入れず、HTMLで載せています。

© School Stock

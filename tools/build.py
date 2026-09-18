#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""英会話カード ビルダー
data/src/*.json（棚ごとの元データ）→ 検査 → 音声（英語・日本語）→ data/cards.json

使い方:
    /usr/bin/python3 tools/build.py          # 足りない音声だけ作る
    /usr/bin/python3 tools/build.py --check  # 検査だけ（音声を作らない）

音声は edge-tts（~/Claude/Tools/edge-tts-env）。文が変わったカードだけ作り直す。
"""
import hashlib
import json
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "src"
EDGE = str(Path.home() / "Claude/Tools/edge-tts-env/bin/edge-tts")
VOICE_EN = ("en-US-BrianMultilingualNeural", "-5%")
VOICE_JA = ("ja-JP-NanamiNeural", "+0%")
HASHES = ROOT / "tools" / ".audio_hashes.json"

# 公開の場所に置くので、入れてはいけない言葉を機械でも止める（学校名・子どもや保護者の特定・未公表の予定）
BANNED = ["菰田", "こもだ", "Komoda", "退職", "辞め", "quit my job", "resign", "leave my school",
          "業務委託", "スクールエージェント", "虐待", "ADHD", "保護者の名前", "児童の名前"]


def fail(msg):
    print("NG:", msg)
    sys.exit(1)


def load():
    cats, seen = [], set()
    for path in sorted(SRC.glob("*.json")):
        cat = json.loads(path.read_text(encoding="utf-8"))
        for key in ("id", "group", "title", "en", "cover", "lead", "cards"):
            if key not in cat:
                fail(f"{path.name}: {key} がない")
        if not (ROOT / cat["cover"]).exists():
            fail(f"{path.name}: 表紙 {cat['cover']} がない")
        for c in cat["cards"]:
            for key in ("id", "lv", "scene", "ja", "en"):
                if not c.get(key):
                    fail(f"{path.name}: {c.get('id')} の {key} がない")
            if c["id"] in seen:
                fail(f"id が重複: {c['id']}")
            seen.add(c["id"])
            if not c["id"].startswith(cat["id"] + "-"):
                fail(f"{c['id']}: 棚の id で始まっていない")
            if c["lv"] not in (1, 2, 3):
                fail(f"{c['id']}: lv は 1〜3")
            if not re.search(r"[.?!]$", c["en"]):
                fail(f"{c['id']}: 英文の終わりに句読点がない")
            if not re.search(r"[。？！]$", c["ja"]):
                fail(f"{c['id']}: 日本語の終わりに句点がない")
            blob = json.dumps(c, ensure_ascii=False)
            for word in BANNED:
                if word.lower() in blob.lower():
                    fail(f"{c['id']}: 公開できない言葉「{word}」")
        cats.append(cat)
    return cats


def duration(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                   "-of", "csv=p=0", str(path)])
    return round(float(out.decode().strip()), 2)


def speak(text, voice, out):
    name, rate = voice
    for attempt in range(5):
        try:
            subprocess.run([EDGE, "--voice", name, f"--rate={rate}", "--text", text, "--write-media", str(out)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if out.exists() and out.stat().st_size > 1000:
                return
        except subprocess.CalledProcessError:
            pass
        time.sleep(2)
    fail(f"音声を作れなかった: {text}")


def silences():
    """聞き流しのときの「間」。無音のmp3を流し続けると、画面を消しても再生が止まりにくい"""
    for sec in range(1, 11):
        out = ROOT / "audio" / "sil" / f"sil_{sec}.mp3"
        if not out.exists():
            subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(sec),
                            "-c:a", "libmp3lame", "-b:a", "16k", str(out)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    cats = load()
    total = sum(len(c["cards"]) for c in cats)
    print(f"検査OK: 棚 {len(cats)}・カード {total}")
    if "--check" in sys.argv:
        return

    hashes = json.loads(HASHES.read_text()) if HASHES.exists() else {}
    jobs = []
    for cat in cats:
        for c in cat["cards"]:
            for lang, text, voice in (("en", c["en"], VOICE_EN), ("ja", c.get("ja_say", c["ja"]), VOICE_JA)):
                out = ROOT / "audio" / lang / f"{c['id']}.mp3"
                digest = hashlib.sha1(json.dumps([text, voice]).encode()).hexdigest()
                if not out.exists() or hashes.get(f"{lang}/{c['id']}") != digest:
                    jobs.append((text, voice, out, f"{lang}/{c['id']}", digest))
    print(f"音声を作る: {len(jobs)}本")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda j: speak(j[0], j[1], j[2]), jobs))
    for _, _, _, key, digest in jobs:
        hashes[key] = digest
    HASHES.write_text(json.dumps(hashes, indent=0, sort_keys=True))
    silences()

    for cat in cats:
        for c in cat["cards"]:
            c["dur_en"] = duration(ROOT / "audio" / "en" / f"{c['id']}.mp3")
            c["dur_ja"] = duration(ROOT / "audio" / "ja" / f"{c['id']}.mp3")
            c.pop("ja_say", None)
    groups = []
    for cat in cats:
        if cat["group"] not in groups:
            groups.append(cat["group"])
    data = {"built": date.today().isoformat(), "groups": groups, "categories": cats}
    (ROOT / "data" / "cards.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                              encoding="utf-8")
    print(f"data/cards.json を書いた（{total}枚）")


if __name__ == "__main__":
    main()

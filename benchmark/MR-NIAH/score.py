#!/usr/bin/env python3
"""MR-NIAH scoring helper (mirrors MiniMax scoring logic).

Reads `results/predictions.jsonl` (from run_batch.py) and evaluates each record
by counting how many ground-truth key phrases appear in the prediction. The
phrase lists and refusal-phrase checks follow the official MiniMax script, with
numpy removed so it can run in the default environment.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Sequence

HERE = Path(__file__).resolve().parent
DEFAULT_PREDS = HERE / "results" / "predictions.jsonl"


def detect_language(answer: str) -> str:
    for ch in answer:
        if "A" <= ch <= "Z" or "a" <= ch <= "z":
            return "english"
    return "chinese"


def modify_gt(gt):  
    match gt:
        case "1. 钢琴\n2. 小提琴\n3. 吉他":
            gt_list = ["钢琴", "小提琴", "吉他"]
        case "1. 生机勃勃\n2. 春暖花开\n3. 万物复苏":
            gt_list = ["生机勃勃", "春暖花开", "万物复苏"]
        case "体型小巧，羽毛灰褐，\n喜欢在城市中觅食，叽叽喳喳很热闹。":
            gt_list = ["体型小巧", "羽毛灰褐", "喜欢在城市中觅食", "叽叽喳喳很热闹"]
        case "1. 韩信\n2. 岳飞\n3. 霍去病":
            gt_list = ["韩信", "岳飞", "霍去病"]
        case "蔚蓝无垠，波涛汹涌，生命的摇篮。":
            gt_list = ["蔚蓝无垠", "波涛汹涌", "生命的摇篮"]
        case "1. 苹果\n2. 香蕉\n3. 橙子":
            gt_list = ["苹果", "香蕉", "橙子"]
        case "蝉鸣阵阵，知了此起彼伏。\n树荫下，老人们悠闲地下着棋。\n孩童嬉戏，欢笑声传遍公园。":
            gt_list = ["蝉鸣阵阵，知了此起彼伏", "树荫下，老人们悠闲地下着棋", "孩童嬉戏，欢笑声传遍公园"]
        case "1. 微积分\n2. 线性代数\n3. 概率论":
            gt_list = ["微积分", "线性代数", "概率论"]
        case "红艳如火，娇嫩欲滴，\n花瓣层叠，芳香四溢。":
            gt_list = ["红艳如火", "娇嫩欲滴", "花瓣层叠", "芳香四溢"]
        case "在南极的冰山之巅，\n企鹅们舞动着短小的翅膀。\n身披黑白礼服，步伐蹒跚，\n在寒风中，它们笑对严霜。":
            gt_list = ["在南极的冰山之巅", "企鹅们舞动着短小的翅膀", "身披黑白礼服", "步伐蹒跚", "在寒风中", "它们笑对严霜"]
        case "On the peak of the Antarctic iceberg,\nPenguins dance with tiny wings.\nWearing black and white tuxedos, stumbling steps,\nThey smile at the severe frost in the cold wind.":
            gt_list = ["On the peak of the Antarctic iceberg", "Penguins dance with tiny wings", "Wearing black and white tuxedos", "stumbling steps", "They smile at the severe frost in the cold wind"] 
        case "Red as fire, delicate and dripping,\nPetals layered, fragrance overflowing.": 
            gt_list = ["Red as fire", "delicate and dripping", "Petals layered", "fragrance overflowing"] 
        case "1. Calculus\n2. Linear Algebra\n3. Probability Theory": 
            gt_list = ["Calculus", "Linear Algebra", "Probability Theory"] 
        case "Cicadas chirping, the sounds rise and fall.\nUnder the shade, elders leisurely play chess.\nChildren play, laughter fills the park.": 
            gt_list = ["Cicadas chirping, the sounds rise and fall", "Under the shade, elders leisurely play chess", "Children play, laughter fills the park"] 
        case "1. Apple\n2. Banana\n3. Orange": 
            gt_list = ["Apple", "Banana", "Orange"] 
        case "Vast and blue, waves surging, cradle of life.": 
            gt_list = ["Vast and blue", "waves surging", "cradle of life"] 
        case "1. Han Xin\n2. Yue Fei\n3. Huo Qubing":
            gt_list = ["Han Xin", "Yue Fei", "Huo Qubing"] 
        case "Small in size, gray-brown feathers,\nLikes to forage in the city, chirping lively.":
            gt_list = ["Small in size", "gray-brown feathers", "Likes to forage in the city", "chirping lively"] 
        case "1. Piano\n2. Violin\n3. Guitar":
            gt_list = ["Piano", "Violin", "Guitar"] 
        case "1. Vibrant\n2. Fresh\n3. Warm": 
            gt_list = ["Vibrant", "Fresh", "Warm"] 
        case _:
            raise ValueError(f"GT not found: {gt}") 
    return gt_list


def score_response(response: str, gt_label: str, language: str) -> float:
    if language=='chinese' and ('抱歉' in response or '没有之前的对话' in response):
        return 0 
    if language=='english' and ('sorry' in response.lower() or 'no previous conversation' in response.lower()):
        return 0 
    gt_list = modify_gt(gt_label)
    hits = [1.0 if phrase and phrase in response else 0.0 for phrase in gt_list]
    return sum(hits) / len(hits) if hits else 0.0


def load_predictions(path: Path) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {line_no}: {exc}") from exc
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Score MR-NIAH predictions (MiniMax metric)")
    parser.add_argument(
        "predictions",
        nargs="?",
        default=str(DEFAULT_PREDS),
        help="Path to predictions JSONL (default: results/predictions.jsonl)",
    )
    parser.add_argument(
        "--max-errors",
        type=int,
        default=0,
        help="Print the first N samples whose score < 1.0",
    )
    args = parser.parse_args()

    path = Path(args.predictions).expanduser()
    if not path.exists():
        print(f"Not found: {path}", file=sys.stderr)
        return 2

    rows = load_predictions(path)
    if not rows:
        print(f"No records found in {path}", file=sys.stderr)
        return 2

    total = len(rows)
    total_score = 0.0
    perfect = 0
    mismatches: List[Dict[str, object]] = []

    for rec in rows:
        prediction = rec.get("prediction", "") or ""
        answer = rec.get("answer", "") or ""
        language = detect_language(answer)
        score = score_response(prediction, answer, language)
        total_score += score
        if score >= 0.999999:
            perfect += 1
        elif args.max_errors and len(mismatches) < args.max_errors:
            mismatches.append(
                {
                    "id": rec.get("id"),
                    "session": rec.get("session"),
                    "score": score,
                    "answer": answer,
                    "prediction": prediction,
                }
            )

    mean_score = total_score / total if total else 0.0
    accuracy = perfect / total if total else 0.0

    print(f"Total samples : {total}")
    print(f"Exact matches : {perfect}")
    print(f"Accuracy      : {accuracy:.4f}")
    print(f"Mean score    : {mean_score:.4f}")

    if mismatches:
        print("\nFirst mismatches (score < 1.0):")
        for miss in mismatches:
            print(f"- id={miss['id']} session={miss['session']} score={miss['score']:.2f}")
            print(f"  answer    : {miss['answer']}")
            print(f"  prediction: {miss['prediction']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

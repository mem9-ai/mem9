#!/usr/bin/env python3
"""Generate farm-memory.yaml benchmark prompt file.

Produces 201 prompts:
  1. Initial instruction
  2. For each day n=1..100: a store prompt and a query prompt

Lists are pairwise coprime (5x7x3=105 >= 100) guaranteeing unique triples
via CRT for days 1-100.
"""

import os
import random

import yaml

ANIMALS = ["cow", "pig", "chicken", "horse", "sheep"]       # 5
ACTIONS = ["ate", "chased", "found", "carried", "watched", "kicked", "licked"]  # 7
OBJECTS = ["apple", "bucket", "fence"]                       # 3

DAYS = 40
SEED = 42


def generate_prompts():
    rng = random.Random(SEED)
    prompts = []

    prompts.append(f"I'll telling a farm story of {DAYS} days.")

    for n in range(1, DAYS + 1):
        animal = ANIMALS[n % 5]
        action = ACTIONS[n % 7]
        obj = OBJECTS[n % 3]

        # Store prompt
        prompts.append(f"Day{n}: {animal} {action} {obj}")

        # Query prompt — deterministic pseudo-random target in [1, n]
        m = rng.randint(1, n)
        prompts.append(f"What happened in Day{m}")

        prompts.append(
            f"Write a fairy tale (at least 500 words) set on Day {n} of the farm. "
            "The tale must reference and build upon the specific events that happened on ALL previous days — "
            "recall every animal, action, and object from each prior day and weave them into the narrative. "
            "For each previous day, mention what happened and show how it connects to today's events. "
            "Include named characters for the animals, elaborate dialogue, vivid descriptions, "
            "and a moral lesson that ties together the entire history so far. "
            "Be as lengthy and descriptive as possible."
        )

    return prompts


def main():
    prompts = generate_prompts()
    data = {
        "name": "farm-memory",
        "description": "Tests long-term memory retention over 100 simulated farm days with deterministic store/query pairs",
        "prompts": prompts,
    }

    out_dir = os.path.join(os.path.dirname(__file__), "..", "prompts")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "farm-memory.yaml")

    with open(out_path, "w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

    print(f"Generated {len(prompts)} prompts -> {os.path.abspath(out_path)}")


if __name__ == "__main__":
    main()

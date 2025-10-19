#!/usr/bin/env python3
"""
run_benchmarks.py

Automates running the benchmark command multiple times, retrying on failure,
and optionally generating the instability visualization afterwards.

Example:
    python run_benchmarks.py \
        --runs 10 \
        --output-prefix benchmarks-sample \
        --eval DataDog/datadog-lambda-python \
        --visualize
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import List


def run_command(command: List[str], env: dict, attempt: int, run_idx: int) -> int:
    print(f"[run {run_idx}] attempt {attempt}: {' '.join(command)}")
    completed = subprocess.run(command, env=env)
    return completed.returncode


def build_command(eval_repo: str, output_file: Path) -> List[str]:
    return [
        "bun",
        "run",
        "cli.ts",
        "opencode",
        "--eval",
        eval_repo,
        "--output",
        str(output_file),
    ]


def ensure_env_vars(required_vars: List[str]) -> None:
    missing = [var for var in required_vars if not os.environ.get(var)]
    if missing:
        missing_str = ", ".join(missing)
        raise SystemExit(
            f"Missing required environment variable(s): {missing_str}.\n"
            "Set them before running this script, e.g.\n"
            "  export OPENCODE_API_KEY=...\n"
            "  export GITHUB_TOKEN=...\n"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the OpenCode benchmark command multiple times."
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=10,
        help="Number of successful benchmark runs to collect (default: 10).",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Maximum retries per run before aborting (default: 3).",
    )
    parser.add_argument(
        "--output-prefix",
        default="benchmarks-sample",
        help="Prefix for the generated benchmark JSON files.",
    )
    parser.add_argument(
        "--eval",
        default="DataDog/datadog-lambda-python",
        help="Target repo for --eval (default: DataDog/datadog-lambda-python).",
    )
    parser.add_argument(
        "--visualize",
        action="store_true",
        help="Run visualize_instability.py after collecting runs.",
    )
    parser.add_argument(
        "--visualize-script",
        type=Path,
        default=Path("visualize_instability.py"),
        help="Path to the visualization script (default: visualize_instability.py).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("."),
        help="Directory to place the output JSON files (default: current directory).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_env_vars(["OPENCODE_API_KEY", "GITHUB_TOKEN"])

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    generated_files: List[Path] = []

    for run_idx in range(1, args.runs + 1):
        output_file = output_dir / f"{args.output_prefix}-{run_idx}.json"
        command = build_command(args.eval, output_file)

        for attempt in range(1, args.max_retries + 1):
            returncode = run_command(command, env, attempt, run_idx)
            if returncode == 0:
                print(f"[run {run_idx}] success -> {output_file}")
                generated_files.append(output_file)
                break
            print(
                f"[run {run_idx}] attempt {attempt} failed with exit code {returncode}"
            )

        else:
            print(
                f"[run {run_idx}] exceeded {args.max_retries} attempts without success. "
                "Aborting."
            )
            sys.exit(returncode)

    if args.visualize:
        if not args.visualize_script.is_file():
            print(
                f"Visualization script not found at {args.visualize_script}. "
                "Skipping visualization."
            )
            return

        visualize_cmd = [
            sys.executable,
            str(args.visualize_script),
            *(str(path) for path in generated_files),
        ]
        print("Running visualization:", " ".join(visualize_cmd))
        viz_proc = subprocess.run(visualize_cmd)
        if viz_proc.returncode != 0:
            print("Visualization script exited with an error.")


if __name__ == "__main__":
    main()

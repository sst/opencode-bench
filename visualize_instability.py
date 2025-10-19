#!/usr/bin/env python3
"""
visualize_instability.py

Reads benchmark JSON files and visualizes score instability across runs.

Usage:
    python visualize_instability.py benchmarks-0.json benchmarks-1.json benchmarks-2.json
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, List

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns


def load_runs(files: List[Path]) -> List[Dict]:
    runs = []
    for path in files:
        with path.open() as fh:
            data = json.load(fh)
        for idx, run in enumerate(data["runs"]):
            runs.append(
                {
                    "file": path.name,
                    "run_index_in_file": idx,
                    "agent": run["model"],
                    "finalScore": run["summary"]["finalScore"],
                    "scores": {
                        score["assignment"]["name"]: score["averageScore"]
                        for score in run["scores"]
                    },
                }
            )
    return runs


def melt_scores(runs: List[Dict]) -> pd.DataFrame:
    rows = []
    for run in runs:
        for assignment, score in run["scores"].items():
            rows.append(
                {
                    "agent": run["agent"],
                    "file": run["file"],
                    "assignment": assignment,
                    "averageScore": score,
                    "finalScore": run["finalScore"],
                }
            )
    return pd.DataFrame(rows)


def plot_instability(df: pd.DataFrame, output: Path) -> None:
    agents = sorted(df["agent"].unique())
    fig, axes = plt.subplots(
        nrows=2,
        ncols=len(agents),
        figsize=(6 * len(agents), 9),
        gridspec_kw={"height_ratios": [1, 2]},
    )

    if len(agents) == 1:
        axes = axes.reshape(2, 1)

    for col, agent in enumerate(agents):
        agent_df = df[df["agent"] == agent]

        final_scores = (
            agent_df[["file", "finalScore"]].drop_duplicates().sort_values("file")
        )
        ax_top = axes[0][col]
        sns.barplot(
            data=final_scores,
            x="file",
            y="finalScore",
            palette="Blues_d",
            ax=ax_top,
        )
        ax_top.set_title(f"{agent} – Final Score by Run")
        ax_top.set_ylim(0, 1)
        ax_top.set_ylabel("finalScore")
        ax_top.set_xlabel("")
        ax_top.bar_label(ax_top.containers[0], fmt="%.3f", padding=3)

        pivot = (
            agent_df.pivot_table(
                index="assignment",
                columns="file",
                values="averageScore",
                aggfunc="mean",
            )
            .reindex(sorted(agent_df["assignment"].unique()))
            .sort_index(axis=1)
        )

        ax_bottom = axes[1][col]
        sns.heatmap(
            pivot,
            annot=True,
            fmt=".2f",
            cmap="coolwarm",
            vmin=0,
            vmax=1,
            cbar_kws={"label": "averageScore"},
            ax=ax_bottom,
        )
        ax_bottom.set_title(f"{agent} – Assignment Scores")
        ax_bottom.set_ylabel("assignment")
        ax_bottom.set_xlabel("file/run")

    plt.tight_layout()
    fig.suptitle("Benchmark Instability Overview", fontsize=16, y=1.02)
    fig.savefig(output, bbox_inches="tight")
    print(f"Saved visualization to {output}")

    try:
        if sys.platform == "darwin":
            subprocess.run(["open", str(output)], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", str(output)], check=False)
        elif sys.platform.startswith("win"):
            os.startfile(output)  # type: ignore[attr-defined]
    except Exception as exc:
        print(f"Could not open image automatically: {exc}")


def main() -> None:
    # ensure this script can be run from anywhere
    parser = argparse.ArgumentParser(
        description="Visualize benchmark score instability across runs."
    )
    parser.add_argument(
        "files",
        nargs="+",
        type=Path,
        help="benchmark JSON files (e.g. benchmarks-0.json benchmarks-1.json …)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("benchmark_instability.png"),
        help="output image path",
    )
    args = parser.parse_args()

    runs = load_runs(args.files)
    df = melt_scores(runs)
    if df.empty:
        raise SystemExit("No runs found in the provided files.")
    plot_instability(df, args.output)


if __name__ == "__main__":
    main()

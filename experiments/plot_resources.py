#!/usr/bin/env python3
"""Plot total CPU/memory usage over time from monitor_resources.py CSV logs.

Usage:
    python plot_resources.py baseline.csv dynamic.csv \
        --labels "Baseline (always-on)" "Dynamic (room-manager)" \
        -o resource_comparison.png
"""
import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd


def load_summary(csv_path):
    df = pd.read_csv(csv_path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    start = df["timestamp"].min()
    df["elapsed_s"] = (df["timestamp"] - start).dt.total_seconds()

    summary = (
        df.groupby("elapsed_s")
        .agg(
            total_cpu_percent=("cpu_percent", "sum"),
            total_mem_mb=("mem_usage_mb", "sum"),
            running_containers=("state", lambda s: (s == "running").sum()),
        )
        .reset_index()
    )
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", nargs="+", help="CSV file(s) from monitor_resources.py")
    parser.add_argument("--labels", nargs="+", help="labels for each CSV (default: filenames)")
    parser.add_argument("-o", "--output", default="resource_comparison.png", help="output image path")
    args = parser.parse_args()

    labels = args.labels or [Path(p).stem for p in args.csv]
    if len(labels) != len(args.csv):
        parser.error("--labels must match number of CSV files")

    fig, axes = plt.subplots(3, 1, figsize=(9, 10), sharex=True)

    for csv_path, label in zip(args.csv, labels):
        summary = load_summary(csv_path)
        axes[0].plot(summary["elapsed_s"], summary["total_cpu_percent"], label=label)
        axes[1].plot(summary["elapsed_s"], summary["total_mem_mb"], label=label)
        axes[2].plot(summary["elapsed_s"], summary["running_containers"], label=label)

    axes[0].set_ylabel("Total CPU (%)")
    axes[1].set_ylabel("Total Memory (MB)")
    axes[2].set_ylabel("Running Containers")
    axes[2].set_xlabel("Elapsed Time (s)")

    for ax in axes:
        ax.legend()
        ax.grid(True, alpha=0.3)

    fig.suptitle("Room Container Resource Usage: Baseline vs Dynamic Scheduling")
    fig.tight_layout()
    fig.savefig(args.output, dpi=150)
    print(f"Saved plot to {args.output}")


if __name__ == "__main__":
    main()

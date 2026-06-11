#!/usr/bin/env python3
"""Poll `docker stats` for room-manager-managed containers and log to CSV.

Usage:
    python monitor_resources.py baseline.csv --interval 5 --duration 600
    python monitor_resources.py dynamic.csv --interval 5
    (Ctrl+C to stop when --duration is omitted)
"""
import argparse
import csv
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOMS_CONFIG = Path(__file__).resolve().parent.parent / "room-manager" / "rooms-config.json"


def load_room_containers():
    with open(ROOMS_CONFIG, encoding="utf-8") as f:
        rooms = json.load(f)
    containers = []
    for room in rooms.values():
        containers.extend(room["containers"])
    return containers


def get_running_containers():
    out = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        capture_output=True, text=True, check=True,
    ).stdout
    return set(out.split())


def get_stats(running):
    if not running:
        return {}
    out = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
        capture_output=True, text=True, check=True,
    ).stdout
    stats = {}
    for line in out.strip().splitlines():
        name, cpu, mem = line.split("\t")
        if name not in running:
            continue
        stats[name] = (parse_percent(cpu), parse_mem_mb(mem))
    return stats


def parse_percent(value):
    return float(value.strip().rstrip("%"))


def parse_mem_mb(value):
    # e.g. "12.5MiB / 1.943GiB" -> use the "used" side only
    usage = value.split("/")[0].strip()
    return to_mb(usage)


def to_mb(value):
    units = {"GiB": 1024, "MiB": 1, "KiB": 1 / 1024, "B": 1 / (1024 ** 2)}
    for unit, factor in units.items():
        if value.endswith(unit):
            return float(value[: -len(unit)]) * factor
    raise ValueError(f"unrecognized memory unit: {value!r}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="CSV output path (appended if it already exists)")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between samples (default: 5)")
    parser.add_argument("--duration", type=float, default=None, help="total seconds to run (default: until Ctrl+C)")
    args = parser.parse_args()

    containers = load_room_containers()
    print(f"Tracking {len(containers)} containers: {', '.join(containers)}")

    out_path = Path(args.output)
    is_new_file = not out_path.exists()
    with open(out_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if is_new_file:
            writer.writerow(["timestamp", "container", "state", "cpu_percent", "mem_usage_mb"])

        start = time.monotonic()
        try:
            while args.duration is None or (time.monotonic() - start) < args.duration:
                ts = datetime.now(timezone.utc).isoformat()
                running = get_running_containers()
                stats = get_stats(running & set(containers))

                for name in containers:
                    if name in stats:
                        cpu, mem = stats[name]
                        writer.writerow([ts, name, "running", f"{cpu:.2f}", f"{mem:.2f}"])
                    else:
                        writer.writerow([ts, name, "stopped", "0.00", "0.00"])
                f.flush()
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\nStopped by user.")


if __name__ == "__main__":
    main()

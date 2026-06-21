#!/usr/bin/env python3
"""Edge device (Raspberry Pi) performance benchmark for Escape Docker.

Runs four phases of testing across all 15 rooms to collect data for
the research report (Phase 6: ARM vs x86, RQ2: detection, RQ3: overhead).

Usage:
    python3 experiments/edge_benchmark.py
    python3 experiments/edge_benchmark.py --iterations 5 --rooms room0 room1
"""

import argparse
import csv
import json
import os
import platform
import signal
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOM_ORDER = [
    "room0", "room1", "room2", "room3", "room4", "room5",
    "room6", "room7", "room8", "room9", "room10", "room11",
    "final", "secret-a", "secret-b",
]

INFRA_CONTAINERS = ["escape-falco", "lab-api", "room-manager"]
STATS_POLL_INTERVAL = 2.0
ALERT_WAIT_SECONDS = 15
SETTLE_SECONDS = 10
BASELINE_SAMPLES = 3
BASELINE_INTERVAL = 5

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOMS_CONFIG_PATH = PROJECT_ROOT / "room-manager" / "rooms-config.json"
ENV_PATH = PROJECT_ROOT / ".env"

# ─── Globals ────────────────────────────────────────────────────
BASE_URL = ""
ADMIN_TOKEN = ""
_interrupted = False


def _update_alert_wait(val):
    global ALERT_WAIT_SECONDS
    ALERT_WAIT_SECONDS = val


def _handle_sigint(sig, frame):
    global _interrupted
    _interrupted = True
    print("\n\n⚠  Ctrl+C detected — saving partial results...")


signal.signal(signal.SIGINT, _handle_sigint)


# ═══════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════

def load_admin_token():
    if os.environ.get("ADMIN_TOKEN"):
        return os.environ["ADMIN_TOKEN"]
    try:
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith("ADMIN_TOKEN="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return "admin_dev_token"


def load_rooms_config():
    with open(ROOMS_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ms_since(t0):
    return round((time.monotonic() - t0) * 1000, 1)


# ─── HTTP ───────────────────────────────────────────────────────

def api_request(method, path, body=None, extra_headers=None, timeout=60, retries=3):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    headers = {}
    if data:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                resp_body = resp.read().decode("utf-8")
                return resp.status, json.loads(resp_body) if resp_body.strip() else {}
        except urllib.error.HTTPError as e:
            resp_body = e.read().decode("utf-8", errors="replace")
            try:
                return e.code, json.loads(resp_body)
            except json.JSONDecodeError:
                return e.code, {"raw": resp_body}
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise ConnectionError(f"Failed after {retries} attempts: {last_err}")


def api_get(path, **kw):
    return api_request("GET", path, **kw)


def api_post(path, body=None, **kw):
    return api_request("POST", path, body=body, **kw)


def api_delete(path, **kw):
    return api_request("DELETE", path, **kw)


# ─── Docker CLI ─────────────────────────────────────────────────

def docker_run(args, timeout=60):
    result = subprocess.run(
        ["docker"] + args,
        capture_output=True, text=True, timeout=timeout,
    )
    return result.stdout.strip(), result.returncode


def parse_mem_mb(value):
    usage = value.split("/")[0].strip()
    units = {"GiB": 1024, "MiB": 1, "KiB": 1 / 1024, "B": 1 / (1024 ** 2)}
    for unit, factor in units.items():
        if usage.endswith(unit):
            return round(float(usage[:-len(unit)]) * factor, 2)
    return 0.0


def docker_stats_snapshot(container_names=None):
    out, rc = docker_run(
        ["stats", "--no-stream", "--format",
         "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"],
        timeout=30,
    )
    stats = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        name = parts[0]
        if container_names and name not in container_names:
            continue
        try:
            stats[name] = {
                "cpu_percent": float(parts[1].strip().rstrip("%")),
                "mem_usage_mb": parse_mem_mb(parts[2]),
                "mem_percent": float(parts[3].strip().rstrip("%")),
            }
        except (ValueError, IndexError):
            pass
    return stats


def docker_stop(containers):
    for c in containers:
        docker_run(["stop", "-t", "5", c], timeout=30)


def get_all_room_containers(rooms_config, rooms=None):
    containers = []
    for room_id in (rooms or ROOM_ORDER):
        if room_id in rooms_config:
            containers.extend(rooms_config[room_id]["containers"])
    return list(dict.fromkeys(containers))


# ─── Stats Poller (background thread) ──────────────────────────

class StatsPoller(threading.Thread):
    def __init__(self, container_names, interval=STATS_POLL_INTERVAL):
        super().__init__(daemon=True)
        self.container_names = container_names
        self.interval = interval
        self.samples = []
        self._stop_event = threading.Event()

    def run(self):
        while not self._stop_event.is_set():
            try:
                snapshot = {
                    "timestamp": now_iso(),
                    "containers": docker_stats_snapshot(self.container_names),
                }
                self.samples.append(snapshot)
            except Exception:
                pass
            self._stop_event.wait(self.interval)

    def stop(self):
        self._stop_event.set()
        self.join(timeout=15)
        return self.samples


# ─── Progress Tracker ───────────────────────────────────────────

class Progress:
    def __init__(self, total):
        self.total = total
        self.done = 0
        self.start = time.monotonic()

    def advance(self, n=1, label=""):
        self.done += n
        elapsed = time.monotonic() - self.start
        if self.done > 0:
            eta = (elapsed / self.done) * (self.total - self.done)
            eta_str = f"{int(eta // 60)}m{int(eta % 60):02d}s"
        else:
            eta_str = "?"
        pct = self.done / self.total * 100
        msg = f"  [{self.done}/{self.total}] ({pct:.0f}%) ETA {eta_str}"
        if label:
            msg += f" — {label}"
        print(msg)


# ═══════════════════════════════════════════════════════════════
#  System Info
# ═══════════════════════════════════════════════════════════════

def collect_system_info():
    info = {
        "hostname": platform.node(),
        "arch": platform.machine(),
        "kernel": platform.release(),
        "cpu_count": os.cpu_count(),
        "collected_at": now_iso(),
    }

    # CPU model
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.lower().startswith("model") and ":" in line:
                    info["cpu_model"] = line.split(":", 1)[1].strip()
                    break
    except FileNotFoundError:
        info["cpu_model"] = platform.processor() or "unknown"

    # Total memory
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    kb = int(line.split()[1])
                    info["total_memory_mb"] = round(kb / 1024, 1)
                    break
    except FileNotFoundError:
        info["total_memory_mb"] = None

    # OS release
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    info["os_release"] = line.split("=", 1)[1].strip().strip('"')
                    break
    except FileNotFoundError:
        info["os_release"] = platform.platform()

    # Docker version
    try:
        out, _ = docker_run(["version", "--format",
                             "{{.Server.Version}} {{.Server.Arch}}"])
        parts = out.split()
        info["docker_version"] = parts[0] if parts else "unknown"
        info["docker_arch"] = parts[1] if len(parts) > 1 else "unknown"
    except Exception:
        info["docker_version"] = "unknown"
        info["docker_arch"] = "unknown"

    return info


# ═══════════════════════════════════════════════════════════════
#  Phase A: Baseline Resource Snapshot
# ═══════════════════════════════════════════════════════════════

def phase_a_baseline(rooms_config, rooms):
    print("\n[Phase A] Baseline resource snapshot (idle system)...")
    all_containers = get_all_room_containers(rooms_config, rooms)

    print(f"  Stopping {len(all_containers)} room containers...")
    docker_stop(all_containers)

    print(f"  Waiting {SETTLE_SECONDS}s for system to settle...")
    time.sleep(SETTLE_SECONDS)

    snapshot_targets = all_containers + INFRA_CONTAINERS
    samples = []
    for i in range(BASELINE_SAMPLES):
        s = docker_stats_snapshot(snapshot_targets)
        samples.append(s)
        if i < BASELINE_SAMPLES - 1:
            time.sleep(BASELINE_INTERVAL)

    # Average the samples
    averaged = {}
    all_names = set()
    for s in samples:
        all_names.update(s.keys())
    for name in all_names:
        vals = [s[name] for s in samples if name in s]
        if vals:
            averaged[name] = {
                "cpu_percent": round(statistics.mean(v["cpu_percent"] for v in vals), 3),
                "mem_usage_mb": round(statistics.mean(v["mem_usage_mb"] for v in vals), 2),
                "mem_percent": round(statistics.mean(v["mem_percent"] for v in vals), 3),
            }

    falco = averaged.get("escape-falco", {})
    room_mem = sum(v["mem_usage_mb"] for k, v in averaged.items()
                   if k not in INFRA_CONTAINERS)

    print(f"  Baseline: rooms={room_mem:.1f}MB, "
          f"Falco CPU={falco.get('cpu_percent', 0):.2f}%, "
          f"Falco Mem={falco.get('mem_usage_mb', 0):.1f}MB")

    return {"timestamp": now_iso(), "containers": averaged}


# ═══════════════════════════════════════════════════════════════
#  Phase B: Container Lifecycle Benchmarks
# ═══════════════════════════════════════════════════════════════

def phase_b_lifecycle(rooms_config, rooms, progress):
    print("\n[Phase B] Container lifecycle benchmarks...")
    results = []

    for room_id in rooms:
        if _interrupted:
            break
        room = rooms_config.get(room_id)
        if not room:
            print(f"  ⚠ {room_id}: not in rooms-config, skipping")
            progress.advance(2)
            continue

        containers = room["containers"]
        entry = {"room_id": room_id, "containers": containers}

        try:
            # Cold start: reset (force-recreate)
            docker_stop(containers)
            time.sleep(2)
            t0 = time.monotonic()
            status, resp = api_post(
                f"/api/rooms/{room_id}/reset",
                extra_headers={"x-admin-token": ADMIN_TOKEN},
                timeout=120,
            )
            cold_ms = ms_since(t0)
            if status >= 400:
                entry["cold_start_ms"] = None
                entry["cold_start_error"] = f"HTTP {status}: {resp}"
            else:
                entry["cold_start_ms"] = cold_ms
            progress.advance(1, f"{room_id} cold={cold_ms:.0f}ms")

            # Warm start: stop -> ensure
            docker_stop(containers)
            time.sleep(2)
            t0 = time.monotonic()
            status, resp = api_post(
                f"/api/rooms/{room_id}/ensure",
                timeout=60,
            )
            warm_ms = ms_since(t0)
            if status >= 400:
                entry["warm_start_ms"] = None
                entry["warm_start_error"] = f"HTTP {status}: {resp}"
            else:
                entry["warm_start_ms"] = warm_ms

            # Release connection (ensure adds one)
            api_post(f"/api/rooms/{room_id}/release", timeout=10)

            progress.advance(1, f"{room_id} warm={warm_ms:.0f}ms")

            # Stop after measurement
            docker_stop(containers)

        except Exception as e:
            entry["error"] = str(e)
            print(f"  ✗ {room_id}: {e}")
            progress.advance(2 - (1 if "cold_start_ms" in entry else 0))

        results.append(entry)
        print(f"  [{rooms.index(room_id)+1}/{len(rooms)}] {room_id}: "
              f"cold={entry.get('cold_start_ms', 'ERR')}ms, "
              f"warm={entry.get('warm_start_ms', 'ERR')}ms")

    return results


# ═══════════════════════════════════════════════════════════════
#  Phase C: Exploit Execution Benchmarks
# ═══════════════════════════════════════════════════════════════

def poll_run_result(run_id, timeout_s=120):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        status, data = api_get(f"/api/lab/runs/{run_id}", timeout=15)
        if status == 200:
            s = data.get("status", "")
            if s not in ("starting", "running", "resetting"):
                return data
        time.sleep(2)
    return {"status": "timeout", "error": f"Poll timeout after {timeout_s}s"}


def compute_detection_latency(run_result):
    started_at = run_result.get("started_at")
    alerts = run_result.get("alerts", [])
    if not started_at or not alerts:
        return None
    try:
        start_ms = datetime.fromisoformat(started_at.replace("Z", "+00:00")).timestamp() * 1000
    except (ValueError, TypeError):
        return None
    first_ms = None
    for a in alerts:
        received = a.get("received_at")
        if received:
            try:
                a_ms = datetime.fromisoformat(received.replace("Z", "+00:00")).timestamp() * 1000
                if first_ms is None or a_ms < first_ms:
                    first_ms = a_ms
            except (ValueError, TypeError):
                pass
    if first_ms is None:
        return None
    return round(first_ms - start_ms, 1)


def compute_peak_resources(samples, room_containers):
    peak_cpu = 0.0
    peak_mem = 0.0
    for s in samples:
        containers = s.get("containers", {})
        cpu_sum = sum(containers.get(c, {}).get("cpu_percent", 0) for c in room_containers)
        mem_sum = sum(containers.get(c, {}).get("mem_usage_mb", 0) for c in room_containers)
        peak_cpu = max(peak_cpu, cpu_sum)
        peak_mem = max(peak_mem, mem_sum)
    return round(peak_cpu, 2), round(peak_mem, 2)


def run_single_exploit(room_id, containers, iteration):
    entry = {"room_id": room_id, "iteration": iteration}

    # 1. Reset to clean state
    t0 = time.monotonic()
    status, resp = api_post(
        f"/api/rooms/{room_id}/reset",
        extra_headers={"x-admin-token": ADMIN_TOKEN},
        timeout=120,
    )
    entry["reset_ms"] = ms_since(t0)
    if status >= 400:
        entry["status"] = "error"
        entry["error"] = f"reset failed: HTTP {status} {resp}"
        return entry

    # 2. Start stats poller
    poll_targets = containers + ["escape-falco"]
    poller = StatsPoller(poll_targets)
    poller.start()

    try:
        # 3. Start exploit
        status, resp = api_post("/api/lab/runs", body={"scenario_id": room_id}, timeout=30)
        if status != 202:
            poller.stop()
            entry["status"] = "error"
            entry["error"] = f"start run failed: HTTP {status} {resp}"
            return entry

        run_id = resp.get("id")
        entry["run_id"] = run_id

        # 4. Poll until done
        timeout_s = 180 if room_id == "room11" else 120
        result = poll_run_result(run_id, timeout_s=timeout_s)

        # 5. Wait for late Falco alerts
        time.sleep(ALERT_WAIT_SECONDS)

        # 6. Fetch final result with alerts
        _, final_result = api_get(f"/api/lab/runs/{run_id}", timeout=15)
        if not final_result or "status" not in final_result:
            final_result = result

    finally:
        # 7. Stop poller
        resource_samples = poller.stop()

    entry["status"] = final_result.get("status", "unknown")
    entry["duration_ms"] = final_result.get("duration_ms")
    entry["steps"] = final_result.get("steps", [])
    entry["flag_found"] = final_result.get("flag_found", "")
    entry["final_privilege"] = final_result.get("final_privilege", "")
    entry["alerts"] = final_result.get("alerts", [])
    entry["alert_rule_counts"] = final_result.get("alert_rule_counts", {})
    entry["detection_latency_ms"] = compute_detection_latency(final_result)

    peak_cpu, peak_mem = compute_peak_resources(resource_samples, containers)
    entry["peak_cpu"] = peak_cpu
    entry["peak_mem_mb"] = peak_mem
    entry["resource_samples"] = resource_samples

    # Falco stats during this run
    falco_cpus = []
    falco_mems = []
    for s in resource_samples:
        fc = s.get("containers", {}).get("escape-falco", {})
        if fc:
            falco_cpus.append(fc.get("cpu_percent", 0))
            falco_mems.append(fc.get("mem_usage_mb", 0))
    entry["falco_avg_cpu"] = round(statistics.mean(falco_cpus), 2) if falco_cpus else None
    entry["falco_avg_mem_mb"] = round(statistics.mean(falco_mems), 2) if falco_mems else None

    return entry


def phase_c_exploits(rooms_config, rooms, iterations, progress):
    print("\n[Phase C] Exploit execution benchmarks "
          f"({iterations} iterations each)...")

    # Clear history for clean analytics
    print("  Clearing previous run history...")
    api_delete("/api/lab/runs", timeout=10)
    time.sleep(2)

    results = []
    for room_id in rooms:
        if _interrupted:
            break
        room = rooms_config.get(room_id)
        if not room:
            print(f"  ⚠ {room_id}: not in rooms-config, skipping")
            progress.advance(iterations)
            continue

        containers = room["containers"]
        for i in range(1, iterations + 1):
            if _interrupted:
                break
            try:
                entry = run_single_exploit(room_id, containers, i)
            except Exception as e:
                entry = {
                    "room_id": room_id, "iteration": i,
                    "status": "error", "error": str(e),
                }
                print(f"  ✗ {room_id} #{i}: {e}")

            results.append(entry)
            alert_count = len(entry.get("alerts", []))
            latency = entry.get("detection_latency_ms")
            latency_str = f", latency={latency:.0f}ms" if latency else ""
            print(f"  {room_id} #{i}: {entry.get('status', '?')}, "
                  f"duration={entry.get('duration_ms', '?')}ms, "
                  f"{alert_count} alerts{latency_str}")
            progress.advance(1, f"{room_id} #{i}")

    return results


# ═══════════════════════════════════════════════════════════════
#  Phase D: Falco Overhead & Detection Matrix
# ═══════════════════════════════════════════════════════════════

def phase_d_analysis(baseline, exploit_runs):
    print("\n[Phase D] Falco overhead analysis...")

    falco_idle = baseline.get("containers", {}).get("escape-falco", {})

    falco_active_cpus = []
    falco_active_mems = []
    for run in exploit_runs:
        if run.get("falco_avg_cpu") is not None:
            falco_active_cpus.append(run["falco_avg_cpu"])
        if run.get("falco_avg_mem_mb") is not None:
            falco_active_mems.append(run["falco_avg_mem_mb"])

    overhead = {
        "idle_cpu_percent": falco_idle.get("cpu_percent"),
        "idle_mem_mb": falco_idle.get("mem_usage_mb"),
        "active_avg_cpu_percent": round(statistics.mean(falco_active_cpus), 2) if falco_active_cpus else None,
        "active_avg_mem_mb": round(statistics.mean(falco_active_mems), 2) if falco_active_mems else None,
    }

    print(f"  Idle:   CPU={overhead['idle_cpu_percent']}%, "
          f"Mem={overhead['idle_mem_mb']}MB")
    print(f"  Active: CPU={overhead['active_avg_cpu_percent']}%, "
          f"Mem={overhead['active_avg_mem_mb']}MB")

    # Fetch detection matrix from lab-api
    detection_matrix = None
    try:
        status, data = api_get("/api/lab/analytics/detection-matrix", timeout=15)
        if status == 200:
            detection_matrix = data
            print(f"  Detection matrix: {len(data)} scenarios")
    except Exception as e:
        print(f"  ⚠ Detection matrix fetch failed: {e}")

    return overhead, detection_matrix


# ═══════════════════════════════════════════════════════════════
#  Output Generation
# ═══════════════════════════════════════════════════════════════

def build_scenario_map(rooms):
    """Load vuln_type from scenario JSON files."""
    scenario_dir = PROJECT_ROOT / "lab" / "scenarios"
    mapping = {}
    for room_id in rooms:
        p = scenario_dir / f"{room_id}.json"
        if p.exists():
            try:
                with open(p, encoding="utf-8") as f:
                    s = json.load(f)
                mapping[room_id] = s.get("vuln_type", "")
            except Exception:
                mapping[room_id] = ""
        else:
            mapping[room_id] = ""
    return mapping


def generate_summary_csv(lifecycle, exploit_runs, rooms, output_path, scenario_map):
    lifecycle_map = {e["room_id"]: e for e in lifecycle}

    fieldnames = [
        "room_id", "vuln_type", "runs", "success_rate",
        "avg_duration_ms", "min_duration_ms", "max_duration_ms", "stddev_duration_ms",
        "cold_start_ms", "warm_start_ms",
        "avg_peak_cpu_pct", "avg_peak_mem_mb",
        "detection_rate", "avg_detection_latency_ms",
        "unique_rules_triggered", "total_alert_count",
        "falco_avg_cpu_during", "falco_avg_mem_during",
    ]

    rows = []
    for room_id in rooms:
        room_runs = [r for r in exploit_runs if r["room_id"] == room_id]
        completed = [r for r in room_runs if r.get("status") in ("success", "failed")]
        successes = [r for r in room_runs if r.get("status") == "success"]
        durations = [r["duration_ms"] for r in completed if r.get("duration_ms") is not None]
        detected = [r for r in completed if len(r.get("alerts", [])) > 0]
        latencies = [r["detection_latency_ms"] for r in completed
                     if r.get("detection_latency_ms") is not None]
        peak_cpus = [r["peak_cpu"] for r in completed if r.get("peak_cpu") is not None]
        peak_mems = [r["peak_mem_mb"] for r in completed if r.get("peak_mem_mb") is not None]
        falco_cpus = [r["falco_avg_cpu"] for r in completed if r.get("falco_avg_cpu") is not None]
        falco_mems = [r["falco_avg_mem_mb"] for r in completed if r.get("falco_avg_mem_mb") is not None]

        all_rules = set()
        total_alerts = 0
        for r in completed:
            total_alerts += len(r.get("alerts", []))
            for rule in r.get("alert_rule_counts", {}):
                all_rules.add(rule)

        lc = lifecycle_map.get(room_id, {})

        row = {
            "room_id": room_id,
            "vuln_type": scenario_map.get(room_id, ""),
            "runs": len(completed),
            "success_rate": round(len(successes) / len(completed), 2) if completed else "",
            "avg_duration_ms": round(statistics.mean(durations)) if durations else "",
            "min_duration_ms": round(min(durations)) if durations else "",
            "max_duration_ms": round(max(durations)) if durations else "",
            "stddev_duration_ms": round(statistics.stdev(durations)) if len(durations) >= 2 else "",
            "cold_start_ms": round(lc.get("cold_start_ms", 0)) if lc.get("cold_start_ms") else "",
            "warm_start_ms": round(lc.get("warm_start_ms", 0)) if lc.get("warm_start_ms") else "",
            "avg_peak_cpu_pct": round(statistics.mean(peak_cpus), 2) if peak_cpus else "",
            "avg_peak_mem_mb": round(statistics.mean(peak_mems), 2) if peak_mems else "",
            "detection_rate": round(len(detected) / len(completed), 2) if completed else "",
            "avg_detection_latency_ms": round(statistics.mean(latencies)) if latencies else "",
            "unique_rules_triggered": len(all_rules),
            "total_alert_count": total_alerts,
            "falco_avg_cpu_during": round(statistics.mean(falco_cpus), 2) if falco_cpus else "",
            "falco_avg_mem_during": round(statistics.mean(falco_mems), 2) if falco_mems else "",
        }
        rows.append(row)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return rows


def strip_resource_samples(exploit_runs):
    """Return a copy of exploit_runs with resource_samples summarized
    (to keep JSON output manageable)."""
    stripped = []
    for r in exploit_runs:
        entry = dict(r)
        samples = entry.pop("resource_samples", [])
        entry["resource_sample_count"] = len(samples)
        # Keep only first and last sample as reference
        if samples:
            entry["resource_sample_first"] = samples[0]
            entry["resource_sample_last"] = samples[-1]
        stripped.append(entry)
    return stripped


def save_results(output_dir, system_info, baseline, lifecycle,
                 exploit_runs, falco_overhead, detection_matrix,
                 started_at, scenario_map, rooms):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    finished_at = now_iso()

    # Full results JSON (with summarized resource samples)
    results = {
        "benchmark_started_at": started_at,
        "benchmark_finished_at": finished_at,
        "total_duration_s": round(time.monotonic() - _global_start, 1),
        "system_info": system_info,
        "baseline": baseline,
        "lifecycle_benchmarks": lifecycle,
        "exploit_runs": strip_resource_samples(exploit_runs),
        "falco_overhead": falco_overhead,
    }
    results_path = output_dir / "edge_benchmark_results.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"  Results: {results_path}")

    # Summary CSV
    csv_path = output_dir / "edge_benchmark_summary.csv"
    summary_rows = generate_summary_csv(
        lifecycle, exploit_runs, rooms, csv_path, scenario_map)
    print(f"  Summary: {csv_path}")

    # System info
    sysinfo_path = output_dir / "system_info.json"
    with open(sysinfo_path, "w", encoding="utf-8") as f:
        json.dump(system_info, f, indent=2, ensure_ascii=False)
    print(f"  System:  {sysinfo_path}")

    # Detection matrix
    if detection_matrix:
        dm_path = output_dir / "detection_matrix.json"
        with open(dm_path, "w", encoding="utf-8") as f:
            json.dump(detection_matrix, f, indent=2, ensure_ascii=False)
        print(f"  Matrix:  {dm_path}")

    return summary_rows


# ═══════════════════════════════════════════════════════════════
#  Console Summary
# ═══════════════════════════════════════════════════════════════

def print_summary_table(rows):
    print("\n" + "=" * 100)
    print(f"{'Room':<12} {'Status':>7} {'AvgTime':>9} {'Cold':>8} "
          f"{'Warm':>8} {'PeakCPU':>8} {'PeakMem':>8} "
          f"{'Detect':>7} {'Latency':>9} {'Alerts':>7}")
    print("-" * 100)
    for r in rows:
        sr = r.get("success_rate", "")
        sr_str = f"{sr*100:.0f}%" if isinstance(sr, (int, float)) else "?"
        print(f"{r['room_id']:<12} {sr_str:>7} "
              f"{r.get('avg_duration_ms', ''):>8}ms "
              f"{r.get('cold_start_ms', ''):>7}ms "
              f"{r.get('warm_start_ms', ''):>7}ms "
              f"{r.get('avg_peak_cpu_pct', ''):>7}% "
              f"{r.get('avg_peak_mem_mb', ''):>7}MB "
              f"{r.get('detection_rate', ''):>6} "
              f"{r.get('avg_detection_latency_ms', ''):>8}ms "
              f"{r.get('total_alert_count', ''):>7}")
    print("=" * 100)


# ═══════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════

_global_start = 0


def main():
    global BASE_URL, ADMIN_TOKEN, _global_start

    parser = argparse.ArgumentParser(
        description="Edge device benchmark for Escape Docker")
    parser.add_argument("--base-url", default="http://localhost",
                        help="Base URL for nginx (default: http://localhost)")
    parser.add_argument("--iterations", type=int, default=3,
                        help="Exploit runs per room (default: 3)")
    parser.add_argument("--output-dir", default="experiments/pi/",
                        help="Output directory (default: experiments/pi/)")
    parser.add_argument("--alert-wait", type=int, default=ALERT_WAIT_SECONDS,
                        help=f"Seconds to wait for Falco alerts (default: {ALERT_WAIT_SECONDS})")
    parser.add_argument("--rooms", nargs="*", default=None,
                        help="Specific rooms to benchmark (default: all 15)")
    parser.add_argument("--skip-lifecycle", action="store_true",
                        help="Skip Phase B lifecycle benchmarks")
    parser.add_argument("--skip-exploits", action="store_true",
                        help="Skip Phase C exploit benchmarks")
    args = parser.parse_args()

    BASE_URL = args.base_url.rstrip("/")
    ADMIN_TOKEN = load_admin_token()
    _update_alert_wait(args.alert_wait)
    rooms = args.rooms or ROOM_ORDER
    iterations = args.iterations

    _global_start = time.monotonic()
    started_at = now_iso()

    print("=" * 55)
    print("  Edge Device Benchmark — Escape Docker")
    print(f"  Started: {started_at}")
    print(f"  Rooms: {len(rooms)}, Iterations: {iterations}")
    print("=" * 55)

    # Load config
    rooms_config = load_rooms_config()
    scenario_map = build_scenario_map(rooms)

    # Verify connectivity
    print("\nVerifying connectivity...")
    try:
        status, data = api_get("/api/rooms/status", timeout=10)
        print(f"  Room Manager: OK ({len(data)} rooms)")
    except Exception as e:
        print(f"  ✗ Room Manager unreachable: {e}")
        print("  Make sure services are running (./start-pi.sh)")
        sys.exit(1)

    try:
        status, data = api_get("/api/lab/scenarios", timeout=10)
        print(f"  Lab API: OK ({len(data)} scenarios)")
    except Exception as e:
        print(f"  ✗ Lab API unreachable: {e}")
        sys.exit(1)

    # Phase 0: System info
    print("\n[Phase 0] Collecting system info...")
    system_info = collect_system_info()
    print(f"  CPU: {system_info.get('cpu_model', '?')} "
          f"({system_info.get('cpu_count', '?')} cores)")
    print(f"  RAM: {system_info.get('total_memory_mb', '?')} MB")
    print(f"  OS:  {system_info.get('os_release', '?')}")
    print(f"  Docker: {system_info.get('docker_version', '?')} "
          f"({system_info.get('docker_arch', '?')})")

    # Calculate total work units
    total_units = 1  # Phase A
    if not args.skip_lifecycle:
        total_units += len(rooms) * 2  # Phase B
    if not args.skip_exploits:
        total_units += len(rooms) * iterations  # Phase C
    total_units += 1  # Phase D
    progress = Progress(total_units)

    # Phase A
    baseline = phase_a_baseline(rooms_config, rooms)
    progress.advance(1, "baseline done")

    # Phase B
    lifecycle = []
    if not args.skip_lifecycle and not _interrupted:
        lifecycle = phase_b_lifecycle(rooms_config, rooms, progress)
    elif args.skip_lifecycle:
        print("\n[Phase B] Skipped (--skip-lifecycle)")
        progress.advance(len(rooms) * 2)

    # Phase C
    exploit_runs = []
    if not args.skip_exploits and not _interrupted:
        exploit_runs = phase_c_exploits(rooms_config, rooms, iterations, progress)
    elif args.skip_exploits:
        print("\n[Phase C] Skipped (--skip-exploits)")
        progress.advance(len(rooms) * iterations)

    # Phase D
    falco_overhead, detection_matrix = phase_d_analysis(baseline, exploit_runs)
    progress.advance(1, "analysis done")

    # Save results
    elapsed = time.monotonic() - _global_start
    print(f"\n{'=' * 55}")
    print(f"  Benchmark {'interrupted' if _interrupted else 'complete'}! "
          f"Total time: {int(elapsed // 60)}m{int(elapsed % 60):02d}s")
    print(f"{'=' * 55}")

    print("\nSaving results...")
    summary_rows = save_results(
        args.output_dir, system_info, baseline, lifecycle,
        exploit_runs, falco_overhead, detection_matrix,
        started_at, scenario_map, rooms,
    )

    if summary_rows:
        print_summary_table(summary_rows)

    print(f"\nAll data saved to {args.output_dir}")
    if _interrupted:
        print("⚠  Results are partial due to interruption.")
    else:
        print("✓  No Pi hardware needed for further analysis.")


if __name__ == "__main__":
    main()

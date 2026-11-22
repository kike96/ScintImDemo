#!/usr/bin/env python3
"""Generate a reproducible, visibly synthetic GNSS dashboard snapshot.

Uses only Python's standard library. The JSON contract is also intended for
an eventual ZED-F9T UBX-to-public-data exporter. No receiver is accessed.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

C = 299_792_458.0
SATELLITES = [
    ("GPS", "G03", 0.4, [ ("L1C/A", 1575.42e6), ("L2C", 1227.60e6) ]),
    ("GPS", "G08", 1.4, [ ("L1C/A", 1575.42e6), ("L2C", 1227.60e6) ]),
    ("GPS", "G14", 2.3, [ ("L1C/A", 1575.42e6), ("L2C", 1227.60e6) ]),
    ("GPS", "G22", 3.1, [ ("L1C/A", 1575.42e6), ("L2C", 1227.60e6) ]),
    ("GPS", "G29", 4.6, [ ("L1C/A", 1575.42e6), ("L2C", 1227.60e6) ]),
    ("Galileo", "E11", 0.8, [ ("E1", 1575.42e6), ("E5b", 1207.14e6) ]),
    ("Galileo", "E19", 3.7, [ ("E1", 1575.42e6), ("E5b", 1207.14e6) ]),
    ("Galileo", "E24", 5.2, [ ("E1", 1575.42e6), ("E5b", 1207.14e6) ]),
]


def write_json_atomic(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf8")
    temporary.replace(path)


def synthetic_data(end: datetime, minutes: int, step_seconds: int, seed: int):
    rng = random.Random(seed)
    n = minutes * 60 // step_seconds + 1
    start = end - timedelta(minutes=minutes)
    rows = []
    slip_t = minutes * 60 * 0.70
    for index in range(n):
        sec = index * step_seconds
        instant = (start + timedelta(seconds=sec)).isoformat(timespec="seconds").replace("+00:00", "Z")
        for gnss, sat, phase, frequencies in SATELLITES:
            # Demonstration of a satellite dropout; explicitly synthetic.
            if sat == "G08" and 40 * 60 <= sec < 41.5 * 60:
                continue
            az = (math.degrees(phase) + 0.013 * sec) % 360.0
            el = 42.0 + 29.0 * math.sin(2 * math.pi * sec / (4.0 * 3600) + phase)
            el = max(9.0, min(82.0, el))
            rho = 22_500_000 + 640_000 * math.sin(2 * math.pi * sec / 13000 + phase)
            rho_dot = 640_000 * (2 * math.pi / 13000) * math.cos(2 * math.pi * sec / 13000 + phase)
            iono_l1 = 5.0 + 0.8 * math.sin(sec / 1900.0 + phase)
            iono_l1_dot = (0.8 / 1900.0) * math.cos(sec / 1900.0 + phase)
            # A *synthetic* localized disturbance; only two specified satellites.
            target = sat in ("G14", "E19")
            center = minutes * 60 * (0.55 if sat == "G14" else 0.62)
            envelope = math.exp(-0.5 * ((sec - center) / 160.0) ** 2) if target else 0.0
            wave = math.sin(2 * math.pi * sec / 37.0 + phase)
            cn0_base = 31.5 + 0.19 * el
            valid_pair = el > 12.0
            for sig_idx, (signal, f_hz) in enumerate(frequencies):
                lam = C / f_hz
                # Dispersive first-order phase advance at frequency f.
                iono = iono_l1 * (1575.42e6 / f_hz) ** 2
                iono_dot = iono_l1_dot * (1575.42e6 / f_hz) ** 2
                # Arbitrary integer ambiguity; true phase is never absolute TEC.
                ambiguity = (100_000 + 7_000 * SATELLITES.index((gnss, sat, phase, frequencies)) + 239 * sig_idx)
                cycle_slip = sat == "G14" and sig_idx == 0 and abs(sec - slip_t) < step_seconds / 2
                slipped = sat == "G14" and sig_idx == 0 and sec >= slip_t
                ambiguity += 24 if slipped else 0
                phase_noise = rng.gauss(0, 0.022 if sig_idx == 0 else 0.037)
                phase_disturbance = envelope * (0.19 + 0.08 * sig_idx) * wave
                carrier = (rho - iono) / lam + ambiguity + phase_noise + phase_disturbance
                # Quantized C/N0 values to resemble receiver-level reporting,
                # not calibrated amplitude scintillation.
                cn0 = round(cn0_base - 2.7 * envelope * (1 + sig_idx * 0.2) + rng.gauss(0, 0.55), 0)
                cn0 = max(19.0, min(52.0, cn0))
                doppler = -(rho_dot - iono_dot) / lam - envelope * (0.19 + 0.08 * sig_idx) * (
                    2 * math.pi / 37.0) * math.cos(2 * math.pi * sec / 37.0 + phase)
                doppler += rng.gauss(0, 0.075)
                locktime = sec - slip_t if slipped else sec
                if cycle_slip:
                    locktime = 0
                rows.append({
                    "t": instant,
                    "gnss": gnss,
                    "sv": sat,
                    "signal": signal,
                    "frequency_hz": round(f_hz),
                    "az_deg": round(az, 2),
                    "el_deg": round(el, 2),
                    "cn0_dbhz": cn0,
                    "pseudorange_m": round(rho + iono + rng.gauss(0, 0.7), 3),
                    "carrier_phase_cycles": round(carrier, 5),
                    "phase_residual_cycles": round(phase_noise + phase_disturbance, 5),
                    "doppler_hz": round(doppler, 3),
                    "locktime_s": max(0, int(locktime)),
                    "phase_valid": valid_pair,
                    "cycle_slip": cycle_slip,
                })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "docs" / "data")
    parser.add_argument("--duration-min", type=int, default=90)
    parser.add_argument("--step-seconds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20261122)
    args = parser.parse_args()
    if args.duration_min < 1 or args.step_seconds < 1:
        parser.error("duration and step must both be positive")

    now = datetime.now(timezone.utc).replace(microsecond=0)
    rows = synthetic_data(now, args.duration_min, args.step_seconds, args.seed)
    snapshot = now.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    records = {
        "schema_version": "0.1.0",
        "snapshot_id": snapshot,
        "units": "See README schema (UTC, Hz, m, cycles, dB-Hz, degrees)",
        "observations": rows,
    }
    meta = {
        "schema_version": "0.1.0",
        "snapshot_id": snapshot,
        "source": "synthetic",
        "station_id": "DEMO-NO-LOCATION",
        "receiver_model": "F9T-LIKE SIMULATION (NOT A RECEIVER)",
        "receiver_status": "not_applicable",
        "last_observation_utc": rows[-1]["t"],
        "published_at_utc": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "nominal_interval_seconds": args.step_seconds,
        "duration_minutes": args.duration_min,
        "satellite_count": len(SATELLITES),
        "signal_count": sum(len(item[-1]) for item in SATELLITES),
        "observation_count": len(rows),
        "notes": "Entirely synthetic signals. No receiver was used. Disturbances and phase residuals are illustrative, not calibrated S4 or sigma_phi.",
    }
    # Write the large file first, metadata last. Clients only switch after metadata changes.
    write_json_atomic(args.out / "observations.json", records)
    write_json_atomic(args.out / "latest.json", meta)
    print(f"Synthetic snapshot {snapshot}: {len(rows)} signals, {len(SATELLITES)} satellites, "
          f"{args.duration_min} min, every {args.step_seconds} seconds")
    print(f"Wrote {args.out.resolve()}")


if __name__ == "__main__":
    main()

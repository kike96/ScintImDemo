#!/usr/bin/env python3
"""Validate the public producer/consumer JSON contract (standard library)."""
import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

REQUIRED = {'t', 'gnss', 'sv', 'signal', 'frequency_hz', 'az_deg', 'el_deg',
            'cn0_dbhz', 'carrier_phase_cycles', 'doppler_hz', 'phase_valid',
            'cycle_slip', 'locktime_s'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('directory', nargs='?', type=Path,
                    default=Path(__file__).resolve().parents[1] / 'docs' / 'data')
    d = ap.parse_args().directory
    meta = json.loads((d / 'latest.json').read_text())
    feed = json.loads((d / 'observations.json').read_text())
    assert meta['schema_version'] == feed['schema_version'] == '0.1.0'
    assert meta['snapshot_id'] == feed['snapshot_id'], 'Mismatched snapshot identifiers'
    obs = feed['observations']
    assert obs and len(obs) == meta['observation_count']
    assert meta['source'] in ('synthetic', 'zed-f9t')
    keys = Counter()
    epochs = set()
    max_time = ''
    for i, r in enumerate(obs):
        missing = REQUIRED - r.keys()
        assert not missing, f'Row {i} missing {missing}'
        datetime.fromisoformat(r['t'].replace('Z', '+00:00'))
        assert 0 <= r['az_deg'] < 360 and 0 <= r['el_deg'] <= 90
        assert r['frequency_hz'] > 1_000_000
        assert 0 <= r['cn0_dbhz'] < 80
        keys[(r['t'], r['sv'], r['signal'])] += 1
        epochs.add(r['t'])
        max_time = max(max_time, r['t'])
    assert max(keys.values()) == 1, 'Duplicate time/satellite/signal rows'
    assert max_time == meta['last_observation_utc']
    print(f"VALID snapshot={meta['snapshot_id']}, rows={len(obs)}, epochs={len(epochs)}, "
          f"satellites={len({r['sv'] for r in obs})}, slip_flags={sum(r['cycle_slip'] for r in obs)}")


if __name__ == '__main__':
    main()

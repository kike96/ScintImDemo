# ScintIm — F9T first-observations dashboard (synthetic prototype)

A **public, static, interactive Plotly.js dashboard** with a synthetic GNSS feed. It is designed to consume precisely the same public-format JSON objects that the future u-blox ZED-F9T observation pipeline will export.

> **Scientific status:** ALL BUNDLED DATA ARE SYNTHETIC. This repository does not communicate with a real receiver. The website cannot validate scintillation, nor provide calibrated S4 or sigma_phi.

## Quick start (Ubuntu/Linux, Python 3 only)

```bash
# From repository root: optionally regenerate a fresh static sample
python3 scripts/generate_synthetic.py --duration-min 90 --step-seconds 5
python3 scripts/check_data.py

# Serve the site from docs/: fetch() intentionally does not use file://
cd docs
python3 -m http.server 8000
```

Open **http://localhost:8000** in a browser. Internet is required to load Plotly.js from its CDN; data are local. Stop the local web server with Ctrl+C.

The simulator creates eight satellites (five GPS and three Galileo), two frequency signals each, synthetic sky motion, C/N0 fluctuations, carrier phase, Doppler, one intentionally introduced cycle slip and a short signal outage. The 5-second cadence is an illustrative dashboard-export cadence, **not** a measured F9T RAWX sample rate or a suitable cadence for all scintillation diagnostics.

## Publish on GitHub Pages

1. Create a **public** repository on GitHub (example name `scintim-gnss-demo`). Do **not** add real observation files or credentials to the repository.
2. From this project directory, run:

   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "Initial synthetic GNSS dashboard"
   git remote add origin https://github.com/YOUR_USERNAME/scintim-gnss-demo.git
   git push -u origin main
   ```

3. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included `.github/workflows/pages.yml` deploys `docs/` on `main` pushes or manual dispatches. Check the **Actions** tab for status.
4. Visit `https://YOUR_USERNAME.github.io/scintim-gnss-demo/` once deployment succeeds. GitHub Pages' actual propagation time varies.

The site is publicly accessible without opening any inbound home-network ports. A future Raspberry Pi can push **only public, bounded derived products** to GitHub. The first version does **not** automatically upload new data from the Pi.

**Five-minute cadence:** The browser polls `data/latest.json` once per minute. Only when `snapshot_id` changes does it fetch `data/observations.json`. Actual publication requires a separate 5-minute producer/publisher later. The custom GitHub Actions Pages workflow avoids the documented 10-builds/hour soft limit for ordinary Pages builds, but **does not guarantee** 5-minute end-to-end latency. Repeatedly committing large JSON snapshots every five minutes would bloat repository history; define a snapshot/retention or alternative data-hosting strategy before operational use.

## Architecture

```text
NOW                                            LATER
scripts/generate_synthetic.py                 f9t_logger.py: private continuous .ubx
       |                                      f9t_decode.py: trusted measurement rows
       |                                      f9t_diagnostics.py: validated quality flags
       |                                            |
       +----------- producer-compatible JSON <-----+
                     |
                     v
                docs/data/latest.json       (small, frequently polled)
                docs/data/observations.json (bounded, only fetched on change)
                     |
                     v
               docs/index.html + app.js + styles.css
                     |
                     v
                 GitHub Pages / Plotly.js
```

No raw UBX data are included in Git; `.gitignore` excludes `*.ubx`, `*.parquet` and `/data/`.

## Public data contract, version 0.1.0

`docs/data/latest.json` is metadata:

| Key | Meaning |
|---|---|
| `schema_version` | Contract version (`0.1.0`) |
| `snapshot_id` | Unique ID for this synchronized publication |
| `source` | `synthetic` or `zed-f9t` |
| `station_id` | Public anonymous alias, not antenna coordinates |
| `receiver_model` | Source/model text |
| `receiver_status` | Producer-supplied state, not inferred from data timestamp |
| `last_observation_utc`, `published_at_utc` | ISO 8601 UTC timestamps |
| `nominal_interval_seconds` | Cadence in the **export**, not necessarily RAWX cadence |
| `observation_count`, `satellite_count`, `signal_count` | Summary statistics |

`docs/data/observations.json` contains the same `schema_version` and `snapshot_id` plus an array `observations`, with **one row per epoch × GNSS × satellite × signal**:

| Field | Units / comments |
|---|---|
| `t` | UTC ISO 8601 (retain original GNSS time in private processing) |
| `gnss`, `sv`, `signal` | e.g. `GPS`, `G14`, `L1C/A`; must map from RXM-RAWX IDs correctly |
| `frequency_hz` | Carrier nominal frequency in Hz; GLONASS channels require care |
| `az_deg`, `el_deg` | Satellite look angles, joined from NAV-SAT; may be null if unavailable |
| `cn0_dbhz` | RXM-RAWX signal C/N0 [dB-Hz] |
| `carrier_phase_cycles` | Raw carrier-phase cycles, not absolute TEC |
| `pseudorange_m` | Raw pseudorange [m] |
| `doppler_hz` | RAWX Doppler [Hz], preserve documented sign convention |
| `locktime_s` | Time since signal lock; REAL decoder must convert receiver's locktime units |
| `phase_valid`, `cycle_slip` | Derived from receiver quality flags and continuity tests |
| `phase_residual_cycles` | **Optional derived field**; real-data definition requires explicit detrending metadata |

All observation fields except identifiers and timestamps may need **null** in the real decoder if unavailable or invalid; the initial demonstration assumes complete sky geometry. If changing the data contract, update schema version, publisher, validator, and UI together.

The browser displays a **relative geometry-free carrier combination** in meters for two available frequencies and resets at flagged slips and gaps. It intentionally avoids an uncalibrated absolute TEC label. In real-data mode, cycle-slip detection and all required lock/phase validity checks must be performed **before** publishing dual-frequency results. The example phase residual in the synthetic generator was directly constructed as part of the model; the real exporter must define its own physically justified detrending procedure.

## Safety and provenance

- Never publish original accumulating `.ubx` archives, precise private antenna coordinates, receiver login credentials or GitHub tokens.
- Keep all raw UBX streams lossless and private; publish only small derived diagnostic feeds.
- C/N0 variations are not calibrated S4; residual phase is not calibrated sigma_phi; geometry-free phase is not absolute slant TEC.
- The currently published browser data are a **fixed snapshot**. An old static demo is not evidence that a receiver has gone offline.
- Read the receiver's firmware/protocol with `UBX-MON-VER` before making assumptions about NAV-SIG or RAWX field availability.
- On the Pi, independent acquisition must continue even when plotting/website publishing fails.

## Next integration step

Implement a real-data exporter with this signature (conceptual):

```python
# Pseudocode: public output, from quality-controlled private measurements
write_public_snapshot(quality_controlled_rows, source="zed-f9t",
                      station_id="STATION-01", output_dir="docs/data")
```

Use an atomic publication mechanism and consistent snapshot IDs; keep two most recent snapshots or retry on a version mismatch when deployment can be inconsistent. Add a tested export/downsampling strategy; retain high-rate original measurements locally.

Reference: [GitHub Pages with custom Actions workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages); [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); [Plotly.js](https://plotly.com/javascript/getting-started/).

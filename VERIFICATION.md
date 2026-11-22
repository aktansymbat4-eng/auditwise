# AuditWise simulator verification

## Requirements

- Node.js 24
- pnpm 12.3.4
- Python 3.11 or newer
- 2 CPU cores and 4 GB RAM recommended; no GPU is used

## One-command offline check

Install project dependencies once, then run:

```sh
pnpm verify:offline
```

The checker reuses a healthy local simulator on port 3000 or starts and stops a temporary development server. It uses only loopback HTTP and makes no external API calls or credential requests. It covers deterministic reset/privacy, stable cursor pagination, bounded action accounting, safe decimal calculation, matcher type/currency/ID/evidence semantics and limits, Unicode explanation length, and the 99-inspection-plus-submit / 100-inspection boundaries. The matcher is checked against all 20 published score/structure vectors and the 12 M01-M12 normalization examples. The benchmark follows the Genesis FinTech scenario matrix: five distinct clean cases, three duplicate cases, three allocation cases (one missing and two partial), two FX cases, two cutoff cases, and five interaction cases. It runs the same four baselines on all 20 fixed-seed episodes and verifies 20 paired record-order/ID-renaming checks.

## Container

Build from the repository root:

```sh
docker build -t auditwise .
```

Run with the proposed resource limits and no network access:

```sh
docker run --rm --cpus=2 --memory=4g -p 3000:3000 auditwise
```

Then open `http://localhost:3000`. For the offline checker inside the same image, run:

```sh
docker run --rm --cpus=2 --memory=4g --network=none auditwise pnpm verify:offline
```

## Evaluation contract

The shared matcher requires matching finding type, canonical affected IDs, currency, amount within the configured integer minor-unit tolerance, and at least one complete accepted evidence set. Unavailable, duplicate, empty, or over-limit evidence lists do not match. The default tolerance is zero. Closed/evaluation submissions return no reward or score to the agent; evaluator diagnostics are not included in episode inspection data. `provenance` and the reference truth remain evaluator-only.

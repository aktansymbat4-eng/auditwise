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

The checker reuses a healthy local simulator on port 3000 or starts and stops a temporary development server. It uses only loopback HTTP and makes no external API calls or credential requests. The benchmark checks 20 fixed-seed episodes, including five clean and five interacting-error episodes, runs the same four baselines on each episode, and verifies 20 paired record-order/ID-renaming checks.

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

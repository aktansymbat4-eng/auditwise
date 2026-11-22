from __future__ import annotations

import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def request(base: str, operation: str, **payload: object) -> dict:
    data = json.dumps({"operation": operation, **payload}).encode()
    req = urllib.request.Request(
        f"{base}/api/simulator",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def wait_until_ready(base: str, process: subprocess.Popen, log) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        try:
            with urllib.request.urlopen(base, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.4)
    log.flush()
    log.seek(0)
    raise RuntimeError(f"Development server did not become ready.\n{log.read()}")


def is_simulator_server(base: str) -> bool:
    try:
        urllib.request.urlopen(f"{base}/api/simulator?session_id=offline-probe", timeout=2)
    except urllib.error.HTTPError as error:
        return error.code == 404
    except (OSError, urllib.error.URLError):
        return False
    return False


def assert_protocol(base: str) -> None:
    config = {
        "mode": "closed",
        "includeClean": True,
        "interactions": ["partial_fx", "fx_period"],
        "errorTypes": {
            "duplicate_invoice": True,
            "payment_allocation": True,
            "fx_date_rate": True,
            "period_cutoff": True,
        },
        "pageSize": 50,
        "amountToleranceMinor": 0,
    }
    first = request(base, "reset", seed="official-check-v1", config=config)
    second = request(base, "reset", seed="official-check-v1", config=config)
    episode = first["episode"]
    assert episode["episode_id"] == second["episode"]["episode_id"], "Same seed must reproduce the episode ID"
    assert episode["ledger"] == second["episode"]["ledger"], "Same seed must reproduce ledger records"
    assert episode["invoices"] == second["episode"]["invoices"], "Same seed must reproduce invoices"
    assert "provenance" not in episode and "truth" not in episode, "Private reference data must not be exposed"
    assert "potential_count" not in episode and "potential_by_type" not in episode, "Closed evaluation must not leak evaluator diagnostics"
    observation = first["observation"]
    assert set(observation) <= {"episode_id", "task", "manifest", "policy", "remaining_steps"}, "Reset observation contains unrequested data"
    print("PASS deterministic reset and closed-mode privacy")

    session_id = first["session_id"]
    page = request(base, "step", session_id=session_id, action={"type": "list_records", "table": "ledger", "limit": 500})
    records = page["observation"]["result"]["records"]
    assert 0 < len(records) <= 50, "Record pages must be capped at 50 rows"
    assert page["observation"]["result"]["next_cursor"] is not None, "Paged records must provide a stable cursor"
    invalid = request(base, "step", session_id=session_id, action={"type": "get_record", "table": "ledger", "id": "NOT-A-RECORD"})
    assert invalid["observation"].get("error"), "Unknown IDs must return a bounded error"
    assert invalid["episode"]["step_count"] == page["episode"]["step_count"] + 1, "Invalid actions must consume one step"
    print("PASS bounded paging and invalid-action accounting")

    closed = request(base, "step", session_id=session_id, action={
        "type": "submit",
        "findings": {"episode_id": episode["episode_id"], "findings": []},
    })
    assert closed["terminated"] and closed["reward"] == 0, "Closed submissions must terminate without returning reward"
    assert "score" not in closed["observation"].get("result", {}), "Closed submissions must withhold evaluator score"
    print("PASS closed submission with withheld score")

    training = request(base, "reset", seed="official-check-training", config={"mode": "train"})
    invalid_submit = request(base, "step", session_id=training["session_id"], action={"type": "submit", "findings": {}})
    assert invalid_submit["terminated"] and invalid_submit["reward"] == -1, "Invalid training submissions must terminate with -1"
    assert invalid_submit["observation"].get("error") == "Invalid findings payload.", "Invalid submission error must be bounded"
    print("PASS malformed-submission handling")

    result = request(base, "benchmark", seed="official-check-benchmark", episodes=20)["benchmark"]
    assert result["episodes"] == 20 and result["clean_episodes"] == 5 and result["interacting_episodes"] == 5
    assert result["paired_checks"] == 20 and result["paired_checks_passed"] == 20, "All paired order/ID-invariance checks must pass"
    policies = {item["policy"]: item for item in result["policies"]}
    assert set(policies) == {"random", "reconciliation", "mark_all", "oracle"}, "All four shared baseline policies must run"
    assert all(item["episodes"] == 20 for item in policies.values()), "Policies must share all episodes"
    assert policies["oracle"]["f1"] == 1, "Evidence-backed oracle should score perfectly"
    assert policies["mark_all"]["f1"] < policies["oracle"]["f1"], "Mark-all must not outperform the oracle"
    assert set(result["coverage_by_type"]) == {"duplicate_invoice", "payment_allocation", "fx_date_rate", "period_cutoff"}
    assert all(item["episodes"] > 0 and item["findings"] > 0 for item in result["coverage_by_type"].values()), "Every error type must be covered"
    assert all(result["adversarial_checks"].values()), f"Adversarial scoring checks failed: {result['adversarial_checks']}"
    print("PASS 20-episode shared-policy benchmark, scoring attacks, and paired checks")
    print("All offline simulator checks passed.")


def main() -> int:
    if sys.version_info < (3, 11):
        print("Python 3.11 or newer is required.", file=sys.stderr)
        return 2
    existing = "http://127.0.0.1:3000"
    try:
        if is_simulator_server(existing):
            assert_protocol(existing)
            return 0
    except Exception as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as log:
        process = subprocess.Popen(
            ["node", str(ROOT / "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", str(port)],
            cwd=ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_until_ready(base, process, log)
            assert_protocol(base)
        except Exception as error:
            print(f"FAIL {error}", file=sys.stderr)
            return 1
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

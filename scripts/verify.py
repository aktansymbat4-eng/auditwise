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
    assert episode["manifest"]["schema_version"] and episode["manifest"]["episode_id"]
    assert episode["manifest"]["base_currency"] and episode["manifest"]["period_start"] and episode["manifest"]["period_end"]
    assert episode["manifest"]["record_count"] == len(episode["ledger"])
    assert episode["policy"]["amount_tolerance_minor"] == 0, "The default tolerance must be explicit in policy"
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
    assert isinstance(page["observation"], dict) and isinstance(page["info"], dict)
    assert type(page["terminated"]) is bool and type(page["truncated"]) is bool and type(page["reward"]) in (int, float)
    json.dumps(page)
    assert 0 < len(records) <= 50, "Record pages must be capped at 50 rows"
    assert page["observation"]["result"]["next_cursor"] is not None, "Paged records must provide a stable cursor"
    repeated = request(base, "step", session_id=session_id, action={"type": "list_records", "table": "ledger", "limit": 500})
    assert repeated["observation"]["result"]["records"] == records, "Repeated first pages must preserve record order"
    all_records = list(records)
    cursor = page["observation"]["result"]["next_cursor"]
    while cursor is not None:
        next_page = request(base, "step", session_id=session_id, action={"type": "list_records", "table": "ledger", "cursor": cursor, "limit": 50})
        chunk = next_page["observation"]["result"]["records"]
        assert len(chunk) <= 50, "Every page must respect the 50-row limit"
        all_records.extend(chunk)
        cursor = next_page["observation"]["result"]["next_cursor"]
    all_ids = [record["row_id"] for record in all_records]
    assert len(all_ids) == len(set(all_ids)) == episode["manifest"]["record_count"], "Cursor traversal must reach every row once"
    invalid = request(base, "step", session_id=session_id, action={"type": "get_record", "table": "ledger", "id": "NOT-A-RECORD"})
    assert invalid["observation"].get("error"), "Unknown IDs must return a bounded error"
    assert invalid["episode"]["step_count"] == repeated["episode"]["step_count"] + len(all_records[50::50]) + 1, "Invalid actions must consume one step"
    print("PASS bounded paging, stable cursors, and invalid-action accounting")

    closed = request(base, "step", session_id=session_id, action={
        "type": "submit",
        "findings": {"episode_id": episode["episode_id"], "findings": []},
    })
    assert closed["terminated"] and closed["reward"] == 0, "Closed submissions must terminate without returning reward"
    assert "score" not in closed["observation"].get("result", {}), "Closed submissions must withhold evaluator score"
    with urllib.request.urlopen(f"{base}/api/simulator?session_id={session_id}", timeout=10) as response:
        submitted_trajectory = response.read().decode("utf-8")
    try:
        request(base, "step", session_id=session_id, action={"type": "calculator", "expression": "1+1"})
        raise AssertionError("Actions after submission must not change the completed episode")
    except urllib.error.HTTPError as error:
        assert error.code == 400, "Actions after submission must be rejected"
    with urllib.request.urlopen(f"{base}/api/simulator?session_id={session_id}", timeout=10) as response:
        assert response.read().decode("utf-8") == submitted_trajectory, "Post-submit actions must not alter the terminal trajectory"
    print("PASS closed submission, withheld score, and immutable terminal state")

    with urllib.request.urlopen(f"{base}/api/simulator?session_id={session_id}", timeout=10) as response:
        trajectory = response.read().decode("utf-8").splitlines()
        assert response.headers.get_content_type() == "application/x-ndjson", "Trajectory export must use NDJSON"
    assert trajectory and all(isinstance(json.loads(line), dict) for line in trajectory), "Trajectory export must contain valid JSON objects"
    print("PASS trajectory download format and JSONL validity")

    try:
        request(base, "reset", seed="invalid-config", config={"amountToleranceMinor": -1})
        raise AssertionError("Negative amount tolerance must be rejected")
    except urllib.error.HTTPError as error:
        assert error.code == 400, "Invalid configuration must return HTTP 400"
    print("PASS invalid configuration validation")

    training = request(base, "reset", seed="official-check-training", config={"mode": "train"})
    invalid_submit = request(base, "step", session_id=training["session_id"], action={"type": "submit", "findings": {}})
    assert invalid_submit["terminated"] and invalid_submit["reward"] == -1, "Invalid training submissions must terminate with -1"
    assert invalid_submit["observation"].get("error") == "Invalid findings payload.", "Invalid submission error must be bounded"
    print("PASS malformed-submission handling")

    recovery = request(base, "reset", seed="official-action-recovery", config={"mode": "train"})
    recovery_session = recovery["session_id"]
    unknown_document = request(base, "step", session_id=recovery_session, action={"type": "get_document", "doc_id": "DOC-DOES-NOT-EXIST"})
    assert unknown_document["observation"].get("error") == "Document not found.", "Unknown documents must return a bounded error"
    assert unknown_document["episode"]["step_count"] == 1, "Unknown document reads must consume one action"
    unknown_action = request(base, "step", session_id=recovery_session, action={"type": "not_a_supported_action"})
    assert unknown_action["observation"].get("error") == "Unknown action.", "Unknown actions must return a bounded error"
    assert unknown_action["episode"]["step_count"] == 2, "Unknown actions must consume one action"
    after_error = request(base, "step", session_id=recovery_session, action={"type": "get_record", "table": "ledger", "id": recovery["episode"]["ledger"][0]["row_id"]})
    assert not after_error["observation"].get("error"), "A failed read must not corrupt access to valid records"
    assert after_error["episode"]["step_count"] == 3, "Valid reads after errors must continue consuming actions"
    print("PASS missing documents, unknown actions, and recovery after errors")

    calculator = request(base, "reset", seed="official-check-calculator", config={"mode": "train"})
    sum_result = request(base, "step", session_id=calculator["session_id"], action={"type": "calculator", "expression": "0.1+0.2"})
    assert sum_result["observation"]["result"]["result"] == 0.3, "Decimal calculator must avoid binary floating-point artifacts"
    unsafe = request(base, "step", session_id=calculator["session_id"], action={"type": "calculator", "expression": "globalThis.process.exit()"})
    assert unsafe["observation"].get("error"), "Expressions outside the arithmetic grammar must fail safely"
    print("PASS decimal calculator and restricted expression grammar")

    def policy_case(seed: str) -> tuple[str, str, list[dict]]:
        reset = request(base, "reset", seed=seed, config={"mode": "train"})
        policy_result = request(base, "run_policy", session_id=reset["session_id"], policy="reconciliation")
        findings = policy_result["findings"]
        assert findings, "The fixed policy fixture must produce matcher test findings"
        return reset["session_id"], reset["episode"]["episode_id"], findings

    match_session, match_episode_id, match_findings = policy_case("official-matcher-semantics")
    canonical = request(base, "step", session_id=match_session, action={"type": "submit", "findings": {"episode_id": match_episode_id, "findings": match_findings}})
    assert not canonical["observation"].get("error") and canonical["observation"]["result"].get("submitted"), "A structurally valid finding payload must submit"
    canonical_score = canonical["observation"]["result"]["score"]

    duplicate_session, duplicate_episode_id, duplicate_findings = policy_case("official-matcher-semantics")
    duplicate_target = next((finding for finding in duplicate_findings if 0 < len(finding["evidence_ids"]) < 10), None)
    assert duplicate_target, "Matcher fixture needs a finding with room for a repeated evidence ID"
    duplicate_findings = json.loads(json.dumps(duplicate_findings))
    duplicate_finding = next(finding for finding in duplicate_findings if finding["type"] == duplicate_target["type"] and finding["affected_ids"] == duplicate_target["affected_ids"])
    duplicate_finding["evidence_ids"].append(duplicate_finding["evidence_ids"][0])
    duplicate_submit = request(base, "step", session_id=duplicate_session, action={"type": "submit", "findings": {"episode_id": duplicate_episode_id, "findings": duplicate_findings}})
    assert not duplicate_submit["observation"].get("error"), "Repeated evidence IDs inside the limit are valid set input"
    duplicate_score = duplicate_submit["observation"]["result"]["score"]
    assert all(duplicate_score[key] == canonical_score[key] for key in ("tp", "fp", "fn", "precision", "recall", "f1", "reward")), "Duplicate evidence IDs must not change matching results"
    print("PASS matcher set semantics for repeated evidence IDs")

    invalid_currencies_session, invalid_currencies_episode_id, invalid_currencies = policy_case("official-currency-exactness")
    for finding in invalid_currencies:
        finding["currency"] = f"{finding['currency']} "
    currency_submit = request(base, "step", session_id=invalid_currencies_session, action={"type": "submit", "findings": {"episode_id": invalid_currencies_episode_id, "findings": invalid_currencies}})
    assert not currency_submit["observation"].get("error"), "Currency mismatches are valid findings, not malformed payloads"
    assert currency_submit["observation"]["result"]["score"]["tp"] == 0, "Currency matching must be exact and must not trim whitespace"

    unknown_type_session, unknown_type_episode_id, unknown_type_findings = policy_case("official-unknown-type")
    for finding in unknown_type_findings:
        finding["type"] = "unknown_but_well_formed"
    unknown_type = request(base, "step", session_id=unknown_type_session, action={"type": "submit", "findings": {"episode_id": unknown_type_episode_id, "findings": unknown_type_findings}})
    assert not unknown_type["observation"].get("error") and unknown_type["observation"]["result"]["score"]["tp"] == 0, "Unknown string types must be non-matching rather than structural errors"
    print("PASS exact currency matching and unknown-type behavior")

    def submit_fixture(seed: str, findings: list[dict]) -> dict:
        fixture = request(base, "reset", seed=seed, config={"mode": "train"})
        return request(base, "step", session_id=fixture["session_id"], action={"type": "submit", "findings": {"episode_id": fixture["episode"]["episode_id"], "findings": findings}})

    valid_shape = {"type": "unknown", "affected_ids": ["R1"], "claimed_amount_minor": 1, "currency": "USD", "evidence_ids": ["D1"], "explanation": "Test finding."}
    over_limit_evidence = {**valid_shape, "evidence_ids": ["D1"] * 11}
    over_limit = submit_fixture("official-evidence-limit", [over_limit_evidence])
    assert over_limit["reward"] == -1 and over_limit["observation"].get("error"), "Eleven evidence IDs must make the submission invalid before deduplication"
    too_many_findings = submit_fixture("official-findings-limit", [valid_shape] * 31)
    assert too_many_findings["reward"] == -1 and too_many_findings["observation"].get("error"), "Thirty-one findings must be rejected as a structural error"
    boolean_amount = submit_fixture("official-boolean-amount", [{**valid_shape, "claimed_amount_minor": True}])
    assert boolean_amount["reward"] == -1 and boolean_amount["observation"].get("error"), "Boolean values must not be accepted as integer amounts"

    finding = {**valid_shape, "claimed_amount_minor": -1, "currency": " USD ", "evidence_ids": [], "explanation": "😀" * 1000}
    accepted_unicode = submit_fixture("official-unicode-limits", [finding])
    assert accepted_unicode["observation"]["result"].get("submitted"), "1000 Unicode code points and a negative integer amount are structurally valid"
    finding["explanation"] = "😀" * 1001
    rejected_unicode = submit_fixture("official-unicode-limits-over", [finding])
    assert rejected_unicode["observation"].get("error") == "Invalid findings payload.", "Explanations over 1000 Unicode code points must be rejected"
    print("PASS matcher structure limits, Unicode code points, and integer amount semantics")

    clean = request(base, "reset", seed="official-action-limit", config={"mode": "train", "errorTypes": {"duplicate_invoice": False, "payment_allocation": False, "fx_date_rate": False, "period_cutoff": False}})
    for _ in range(99):
        action = request(base, "step", session_id=clean["session_id"], action={"type": "calculator", "expression": "1+1"})
        assert not action["truncated"], "The 99th inspection action must not truncate the episode"
    final_submit = request(base, "step", session_id=clean["session_id"], action={"type": "submit", "findings": {"episode_id": clean["episode"]["episode_id"], "findings": []}})
    assert final_submit["terminated"] and not final_submit["truncated"], "Submit as action 100 must be accepted"
    assert final_submit["reward"] == 0.802, "Clean-case reward must subtract the 99 inspection steps exactly"

    truncated = request(base, "reset", seed="official-truncation-limit", config={"mode": "train", "errorTypes": {"duplicate_invoice": False, "payment_allocation": False, "fx_date_rate": False, "period_cutoff": False}})
    for _ in range(100):
        final_step = request(base, "step", session_id=truncated["session_id"], action={"type": "calculator", "expression": "1+1"})
    assert final_step["truncated"] and not final_step["terminated"], "100 inspection actions without submission must truncate"
    print("PASS 100-action boundary, final submit, and truncation behavior")

    clean_config = {"mode": "train", "errorTypes": {"duplicate_invoice": False, "payment_allocation": False, "fx_date_rate": False, "period_cutoff": False}, "interactions": []}
    ordinary = request(base, "reset", seed="fixture-ordinary", config={**clean_config, "cleanScenario": "ordinary"})["episode"]
    assert all(payment["invoice_refs"] for payment in ordinary["payments"]), "Ordinary clean data must not contain unallocated payments"
    split = request(base, "reset", seed="fixture-split", config={**clean_config, "cleanScenario": "split_payment"})["episode"]
    split_counts = {invoice["invoice_id"]: sum(any(ref["invoice_id"] == invoice["invoice_id"] for ref in payment["invoice_refs"]) for payment in split["payments"]) for invoice in split["invoices"]}
    assert sum(count == 2 for count in split_counts.values()) == 1, "Split-payment clean case must contain exactly one correctly split invoice"
    reversal = request(base, "reset", seed="fixture-reversal", config={**clean_config, "cleanScenario": "reversal"})["episode"]
    assert any(not payment["invoice_refs"] and any(row["payment_id"] == payment["payment_id"] and row["invoice_id"] is None for row in reversal["ledger"]) for payment in reversal["payments"]), "Reversal clean case must be unlinked from invoices"
    repeated = request(base, "reset", seed="fixture-repeated", config={**clean_config, "cleanScenario": "repeated_amounts"})["episode"]
    amounts = [invoice["total_minor"] for invoice in repeated["invoices"]]
    assert len(amounts) != len(set(amounts)), "Repeated-amount clean case must contain a legitimate repeated total"
    boundary = request(base, "reset", seed="fixture-boundary", config={**clean_config, "cleanScenario": "policy_boundary"})["episode"]
    assert any(payment["timestamp"].startswith("2026-11-30") and payment["currency"] == "EUR" for payment in boundary["payments"]), "Policy-boundary clean case must use the in-period month-end FX record"

    allocation_config = {"mode": "train", "errorTypes": {"duplicate_invoice": False, "payment_allocation": True, "fx_date_rate": False, "period_cutoff": False}, "interactions": []}
    missing = request(base, "reset", seed="fixture-missing-allocation", config={**allocation_config, "paymentAllocationMode": "missing"})["episode"]
    assert any(not payment["invoice_refs"] and any(row["payment_id"] == payment["payment_id"] and row["invoice_id"] is not None for row in missing["ledger"]) for payment in missing["payments"]), "Missing-allocation case must retain the payment but omit its invoice allocation"
    partial = request(base, "reset", seed="fixture-partial-allocation", config={**allocation_config, "paymentAllocationMode": "partial"})["episode"]
    assert any(len(payment["invoice_refs"]) == 2 and payment["invoice_refs"][0]["invoice_id"] != payment["invoice_refs"][1]["invoice_id"] for payment in partial["payments"]), "Partial-allocation case must distribute part of a payment to a wrong invoice"
    print("PASS five clean scenarios and missing/partial allocation fixtures")

    result = request(base, "benchmark", seed="official-check-benchmark", episodes=20)["benchmark"]
    assert result["episodes"] == 20 and result["clean_episodes"] == 5 and result["interacting_episodes"] == 5
    scenarios = {item["id"]: item for item in result["scenario_matrix"]}
    assert scenarios["clean"]["cases"] == ["ordinary", "split_payment", "reversal", "repeated_amounts", "policy_boundary"]
    assert scenarios["duplicate_invoice"]["episodes"] == 3 and scenarios["payment_allocation"]["cases"][0] == "missing"
    assert scenarios["partial_fx"]["episodes"] == 3 and scenarios["fx_period"]["episodes"] == 2
    assert result["coverage_by_type"]["duplicate_invoice"]["episodes"] == 3, "Duplicate-only cases must match the published D06-D08 split"
    assert result["paired_checks"] == 20 and result["paired_checks_passed"] == 20, "All paired order/ID-invariance checks must pass"
    policies = {item["policy"]: item for item in result["policies"]}
    assert set(policies) == {"random", "reconciliation", "mark_all", "oracle"}, "All four shared baseline policies must run"
    assert all(item["episodes"] == 20 for item in policies.values()), "Policies must share all episodes"
    assert policies["oracle"]["f1"] == 1, "Evidence-backed oracle should score perfectly"
    assert policies["mark_all"]["f1"] < policies["oracle"]["f1"], "Mark-all must not outperform the oracle"
    assert set(result["coverage_by_type"]) == {"duplicate_invoice", "payment_allocation", "fx_date_rate", "period_cutoff"}
    assert all(item["episodes"] > 0 and item["findings"] > 0 for item in result["coverage_by_type"].values()), "Every error type must be covered"
    assert all(result["adversarial_checks"].values()), f"Adversarial scoring checks failed: {result['adversarial_checks']}"
    matcher_checks = result["matcher_contract_checks"]
    assert matcher_checks["passed"] == matcher_checks["total"] == 32, f"Matcher contract vectors failed: {matcher_checks['checks']}"
    assert all(matcher_checks["checks"].values()), f"Matcher contract failures: {matcher_checks['checks']}"
    print("PASS 32 matcher contract vectors, scenario benchmark, scoring attacks, and paired checks")
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

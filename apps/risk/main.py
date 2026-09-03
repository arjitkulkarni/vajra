"""
VAJRA risk service — the optional Python deployment of the scorer.

The gateway ships an identical TypeScript scorer (RISK_MODE=local, the default) so the product runs
with no Python at all. This service exists for the deployment story: risk scoring scales independently
of the API, and the same interface accepts a learned anomaly model later without touching the decision
engine.

Two rules that matter more than the model:
  1. The gateway gathers the facts; this service only weighs them. Both scorers therefore agree.
  2. Every point in a score names a signal. If this service is unreachable, the gateway forces the
     tier to `high` — a timeout must never look like a calm request.

Run:  uvicorn main:app --port 8100     (then set RISK_MODE=http in the gateway's .env)
"""

from __future__ import annotations

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="VAJRA Risk Service", version="0.2.0")

Tier = Literal["low", "elevated", "high"]

# Weights are duplicated deliberately: they are the published, auditable definition of the score.
# They must stay in step with packages/trust/src/index.ts (RISK_WEIGHTS).
WEIGHTS = {
    "new_device": 30,
    "impossible_travel": 25,
    "failed_liveness": 25,
    "odd_hours": 15,
    "burst": 15,
    "abnormal_volume": 15,
}
BURST_THRESHOLD = 10
VOLUME_RATIO_THRESHOLD = 3
NEW_USER_HOURS = 48


class RiskInput(BaseModel):
    newDevice: bool = False
    impossibleTravel: bool = False
    failedLivenessRecent: int = 0
    outsideBaselineHours: bool = False
    burstCount: int = 0
    volumeRatio: float = 1.0
    userAgeHours: float = Field(default=1000.0, ge=0)


class RiskResult(BaseModel):
    score: int
    tier: Tier
    signals: list[str]


def tier_for(score: int) -> Tier:
    if score >= 60:
        return "high"
    if score >= 30:
        return "elevated"
    return "low"


@app.post("/score", response_model=RiskResult)
def score(payload: RiskInput) -> RiskResult:
    signals: list[str] = []
    total = 0

    if payload.newDevice:
        total += WEIGHTS["new_device"]
        signals.append("new_device")
    if payload.impossibleTravel:
        total += WEIGHTS["impossible_travel"]
        signals.append("impossible_travel")
    if payload.failedLivenessRecent > 0:
        total += WEIGHTS["failed_liveness"]
        signals.append("failed_liveness")
    if payload.outsideBaselineHours:
        total += WEIGHTS["odd_hours"]
        signals.append("odd_hours")
    if payload.burstCount > BURST_THRESHOLD:
        total += WEIGHTS["burst"]
        signals.append("burst")
    if payload.volumeRatio > VOLUME_RATIO_THRESHOLD:
        total += WEIGHTS["abnormal_volume"]
        signals.append("abnormal_volume")

    total = max(0, min(100, total))
    tier = tier_for(total)

    # New identities start conservative — the same floor the TypeScript scorer applies.
    if payload.userAgeHours < NEW_USER_HOURS and tier == "low":
        tier = "elevated"
        signals.append("new_user")

    return RiskResult(score=total, tier=tier, signals=signals)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "vajra-risk", "weights": WEIGHTS}

# VAJRA Risk Service (optional)

The gateway's default (`RISK_MODE=local`) runs an identical scorer in-process, so **you do not need
this service to run VAJRA**. It exists for the deployment story: risk scoring scales independently of
the API, and the same HTTP interface accepts a learned anomaly model later without touching the
decision engine.

```bash
cd apps/risk
python -m venv .venv && . .venv/Scripts/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8100
```

Then in the repo `.env`:

```
RISK_MODE=http
RISK_SERVICE_URL=http://127.0.0.1:8100
RISK_TIMEOUT_MS=150
```

If the service is slow or unreachable the gateway forces the tier to `high`. A timeout must never look
like a calm request — that is what "fail closed" means here.

## Why heuristics, not a model

Explainability is the feature. Every point in the score names a signal an auditor can read
(`new_device`, `impossible_travel`, `odd_hours`, `burst`, `abnormal_volume`). A black-box model would
hide exactly the thing VAJRA is selling. The weights in `main.py` are the published definition of the
score and must stay in step with `packages/trust/src/index.ts`.

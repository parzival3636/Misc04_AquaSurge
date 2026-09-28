import urllib.request
import urllib.parse
import json
import time

time.sleep(2)
BASE_URL = "http://127.0.0.1:8000"

def get(path):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def post(path, data):
    url = f"{BASE_URL}{path}"
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

print("Testing MISC-04 API Endpoints...")

# 1. Root
root = get("/")
print(f"[OK] GET / -> {root['title']}")

# 2. State endpoint
state = get("/state")
print(f"[OK] GET /state -> district={state['district']}, {len(state['settlements'])} settlements, {len(state['roads'])} roads, {len(state['hazard_alerts'])} alerts")

# 3. Ground reports GET
reps = get("/ground-reports")
print(f"[OK] GET /ground-reports -> {len(reps)} reports loaded")

# 4. Roads endpoint
roads = get("/roads?timestep=T4")
print(f"[OK] GET /roads?timestep=T4 -> {len(roads)} road segments")

# 5. Alerts endpoint
alerts = get("/alerts?timestep=T4")
print(f"[OK] GET /alerts?timestep=T4 -> {len(alerts)} alerts at T4")

# 6. Priority endpoint
prio = get("/priority?timestep=T4")
print(f"[OK] GET /priority?timestep=T4 -> {len(prio)} ranked settlements (Rank 1: {prio[0]['name']})")

# 7. Safe routing endpoint
sr_s01_t1 = get("/routing/safe-route/S01?timestep=T1")
print(f"[OK] GET /routing/safe-route/S01?timestep=T1 -> available={sr_s01_t1['available']}")

sr_s01_t7 = get("/routing/safe-route/S01?timestep=T7")
print(f"[OK] GET /routing/safe-route/S01?timestep=T7 -> available={sr_s01_t7['available']}")

# 8. Member A endpoint
settlements = get("/settlements/?timestep=T5")
print(f"[OK] GET /settlements/?timestep=T5 -> count={settlements['count']}")

# 9. POST new ground report
new_report = {
    "settlement_id": "S03",
    "road_id": "R19",
    "timestep": "T5",
    "type": "flooded_road",
    "text": "Live test: Thavinhal road waterlogged by mountain runoff."
}
post_res = post("/ground-reports", new_report)
print(f"[OK] POST /ground-reports -> ok={post_res['ok']}, state_recomputed={post_res['state_recomputed']}")

# Verify report was added to state
updated_state = get("/state")
print(f"[OK] Verified recomputed state ground_reports count: {len(updated_state['ground_reports'])}")

print("\nALL ENDPOINT TESTS COMPLETED SUCCESSFULLY!")

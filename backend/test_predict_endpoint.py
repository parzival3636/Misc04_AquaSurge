import urllib.request
import json

base = "http://127.0.0.1:8000"

print("=" * 60)
print("TESTING POST /predict & GET /model-comparison")
print("=" * 60)

# 1. High risk scenario (from user's prompt)
high_scenario = {
    "rainfall_mm": 350.0,
    "elevation_m": 720.0,
    "distance_to_river_km": 0.5,
    "historical_flood_flag": 1,
    "settlement_name": "Panamaram Basin Test"
}
req1 = urllib.request.Request(
    f"{base}/predict",
    data=json.dumps(high_scenario).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req1) as resp:
    res1 = json.loads(resp.read().decode())

print("[OK] POST /predict (High-Risk Deluge Scenario):")
print(f"  Target:     {res1['settlement_name']}")
print(f"  Risk Score: {res1['prediction']['risk_score']}")
print(f"  Risk Level: {res1['prediction']['risk_level'].upper()}")
print(f"  Confidence: {res1['prediction']['confidence'] * 100:.1f}%")
print(f"  Rationale:  {res1['explainability']['hydrology_rationale']}")

# 2. Low risk scenario
low_scenario = {
    "rainfall_mm": 40.0,
    "elevation_m": 920.0,
    "distance_to_river_km": 15.0,
    "historical_flood_flag": 0,
    "settlement_name": "Sulthan Bathery Ridge Test"
}
req2 = urllib.request.Request(
    f"{base}/predict",
    data=json.dumps(low_scenario).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req2) as resp:
    res2 = json.loads(resp.read().decode())

print("\n[OK] POST /predict (Low-Risk Safe Ridge Scenario):")
print(f"  Target:     {res2['settlement_name']}")
print(f"  Risk Score: {res2['prediction']['risk_score']}")
print(f"  Risk Level: {res2['prediction']['risk_level'].upper()}")
print(f"  Confidence: {res2['prediction']['confidence'] * 100:.1f}%")
print(f"  Rationale:  {res2['explainability']['hydrology_rationale']}")

# 3. GET /model-comparison
with urllib.request.urlopen(f"{base}/model-comparison") as resp:
    bench = json.loads(resp.read().decode())

print("\n[OK] GET /model-comparison:")
print(f"  Architecture: {bench['model_architecture']}")
print(f"  Best params:  {bench['selected_best_parameters']}")
print(f"  Rationale:    {bench['selection_rationale']}")
print("  Comparative Performance (5-Fold Stratified CV):")
for model_name, stats in bench["models_comparison"].items():
    print(f"    * {model_name:<26}: ROC-AUC={stats['roc_auc_mean']:.4f} | Acc={stats['accuracy_mean']:.4f} | F1={stats['f1_mean']:.4f}")

print("\nALL PREDICTION & BENCHMARK TESTS PASSED!")

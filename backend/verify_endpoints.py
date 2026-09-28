import urllib.request, json

def get(url):
    r = urllib.request.urlopen(url)
    return json.loads(r.read())

# 1. List settlements at T5
data = get('http://127.0.0.1:8000/settlements?timestep=T5')
count = data["count"]
s = data["settlements"][0]
fields = list(s.keys())
required = ["name","lat","lng","population","risk_score","risk_level","confidence"]
missing = [f for f in required if f not in s]
print("=== GET /settlements?timestep=T5 ===")
print(f"  count: {count}")
print(f"  fields: {fields}")
print(f"  missing required: {missing if missing else 'NONE - all present'}")
# Show top 3 by risk
top3 = sorted(data["settlements"], key=lambda x: x["risk_score"], reverse=True)[:3]
for r in top3:
    print(f"  {r['name']}: risk={r['risk_score']}, level={r['risk_level']}, conf={r['confidence']}")
print()

# 2. Single settlement
data2 = get('http://127.0.0.1:8000/settlements/S01')
print("=== GET /settlements/S01 ===")
print(f"  name={data2['name']}, lat={data2['lat']}, lng={data2['lng']}, pop={data2['population']}")
print(f"  timesteps returned: {len(data2['timesteps'])}")
print()

# 3. Metadata
data3 = get('http://127.0.0.1:8000/settlements/meta/timesteps')
print("=== GET /settlements/meta/timesteps ===")
print(f"  district={data3['district']}, hazard={data3['hazard_type']}")
print(f"  label={data3['data_label']}")
print()

# 4. Model info
data4 = get('http://127.0.0.1:8000/settlements/meta/model-info')
print("=== GET /settlements/meta/model-info ===")
print(f"  trained: {data4['trained_feature_importances']}")
print(f"  literature: {data4['literature_weights']}")
print()

# 5. Test scenarios
data5 = get('http://127.0.0.1:8000/settlements/meta/test-scenarios')
fa = data5["false_alert_case"]
rd = data5["route_disruption_case"]
print("=== GET /settlements/meta/test-scenarios ===")
print(f"  false_alert -> passed={fa['passed']}")
print(f"    {fa['result']}")
print(f"  disruption  -> passed={rd['passed']}")
print(f"    {rd['result']}")
print()
both = fa["passed"] and rd["passed"]
print("ACCEPTANCE CRITERIA MET:", both)

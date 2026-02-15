
import requests
import os
import json

API_KEY = "AIzaSyDXGN4AR3owdj00YXJMLhcErm5H4MePQUQ"
URL = f"https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}"

print(f"🚀 Starting Python Model List Script...")
print(f"📡 Fetching from: {URL}")

try:
    response = requests.get(URL)
    response.raise_for_status()
    data = response.json()
    
    print("\n=== AVAILABLE MODELS ===")
    embedding_models = [m for m in data.get('models', []) if 'embedding' in m['name']]
    
    if not embedding_models:
        print("⚠️ No embedding models found!")
    else:
        for m in embedding_models:
            print(f"- {m['name']}")
            
    print("\n=== OTHER MODELS ===")
    other_models = [m for m in data.get('models', []) if 'embedding' not in m['name']]
    for m in other_models[:5]:
        print(f"- {m['name']}")
        
    # Write to file for safety
    with open("python_models_list.txt", "w") as f:
        f.write(json.dumps(data, indent=2))
        print(f"\n✅ Full list written to python_models_list.txt")

except Exception as e:
    print(f"❌ Error: {e}")

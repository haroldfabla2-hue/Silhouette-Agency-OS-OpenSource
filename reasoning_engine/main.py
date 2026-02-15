from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

# Load Environment Variables
load_dotenv()

app = FastAPI(
    title="Silhouette Reasoning Engine",
    description="Python Microservice for Neuro-Symbolic Link Prediction and Graph Reasoning",
    version="1.0.0"
)

# Configuration (Defaults to localhost if not set)
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687") # Use localhost for local dev
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "silhouette_graph_2035")

# Database Connection Helper
class GraphConnection:
    def __init__(self, uri, user, password):
        # Local Docker connections often fail handshake if encryption is on by default
        self.driver = GraphDatabase.driver(uri, auth=(user, password), encrypted=False)

    def close(self):
        self.driver.close()

    def verify_connectivity(self):
        try:
            self.driver.verify_connectivity()
            return True
        except Exception as e:
            print(f"Connection Error: {e}")
            return False

graph_db = None

@app.on_event("startup")
async def startup_event():
    global graph_db
    print(f"Connecting to Neo4j at {NEO4J_URI}...")
    graph_db = GraphConnection(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    if graph_db.verify_connectivity():
        print("✅ Connected to Neo4j Graph.")
    else:
        print("❌ Failed to connect to Neo4j.")

@app.on_event("shutdown")
async def shutdown_event():
    if graph_db:
        graph_db.close()

# --- API MODELS ---

class LinkPredictionRequest(BaseModel):
    node_id: str
    top_k: int = 5

class LinkPredictionResponse(BaseModel):
    source_node: str
    predictions: list[dict] # {target_node: str, confidence: float, relation_type: str}

# --- ENDPOINTS ---

@app.get("/")
async def root():
    return {"status": "online", "service": "Silhouette Reasoning Engine", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    connected = graph_db.verify_connectivity() if graph_db else False
    return {"database_connected": connected}

@app.post("/predict_links", response_model=LinkPredictionResponse)
async def predict_links(request: LinkPredictionRequest):
    """
    Simulate GNN Intuition using Graph Heuristics (Common Neighbors).
    Finds nodes that share neighbors but are not yet connected.
    """
    if not graph_db or not graph_db.verify_connectivity():
        raise HTTPException(status_code=503, detail="Graph Database unavailable")

    # Cypher Query for "Link Prediction" via Common Neighbors
    # Logic: If A and B share many friends, they should probably be friends.
    query = """
    MATCH (source:Concept {id: $nodeId})
    MATCH (source)-[:RELATED_TO]->(common)<-[:RELATED_TO]-(candidate:Concept)
    WHERE NOT (source)-[:RELATED_TO]-(candidate) AND source <> candidate
    WITH candidate, count(common) as common_neighbors
    WHERE common_neighbors >= 1
    RETURN candidate.id as target, common_neighbors
    ORDER BY common_neighbors DESC
    LIMIT $topK
    """
    
    predictions = []
    
    try:
        with graph_db.driver.session() as session:
            result = session.run(query, nodeId=request.node_id, topK=request.top_k)
            
            for record in result:
                # Normalize confidence based on neighbor count (heuristic: 1=0.5, 5+=0.95)
                neighbors = record["common_neighbors"]
                confidence = min(0.5 + (neighbors * 0.1), 0.99)
                
                predictions.append({
                    "target_node": record["target"],
                    "confidence": confidence,
                    "relation_type": "INTUITIVELY_LINKED"
                })
                
    except Exception as e:
        print(f"Query Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Fallback if no specific links found (serendipity)
    if not predictions:
         # Optionally return a random node as a "wild guess" for creativity
         pass

    return {
        "source_node": request.node_id,
        "predictions": predictions
    }

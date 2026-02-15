# PROPUESTA COMPLETA: SISTEMA DE DESCUBRIMIENTO NEUROCOGNITIVO
Arquitectura Híbrida n8n + Neo4j + Python/GNN + Claude Introspection

## ÍNDICE EJECUTIVO
1.  **Visión General** - De automatización a descubrimiento
2.  **Arquitectura Técnica Detallada** - Stack completo
3.  **Componentes Principales** - Microservicios y orquestación
4.  **Flujos n8n Específicos** - Workflows completos
5.  **Implementación Fase por Fase** - 10 semanas con entregables
6.  **Casos de Uso** - Brandistry, Silhouette, Nouveau Wellness
7.  **Métricas y KPIs** - Cómo medir éxito
8.  **Roadmap de Escalado** - De MVP a Producción

---

## SECCIÓN 1: VISIÓN GENERAL

### 1.1 El Problema con tu Arquitectura Actual
**Tu Stack Actual:**
```text
┌─────────────────────────────────────────────────────┐
│                    n8n (Orquestación)                │
│  Workflow: Trigger → Scrape → LLM → Store → Output │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌────────────────────────────────────┐
        │  OpenRouter / Google Gemini        │
        │  (Llamadas API sin contexto)       │
        └────────────────────────────────────┘
                          │
                          ▼
        ┌────────────────────────────────────┐
        │  Pinecone / Qdrant (Solo Vectores) │
        │  Similitud Coseno = Búsqueda       │
        └────────────────────────────────────┘
```
**Limitación Crítica:** El sistema es excelente recuperando información, pero no descubriendo conexiones nuevas. Si no está explícitamente en tu BD, no la ve.

### 1.2 La Solución: Layers de Inteligencia
**Nueva Arquitectura Propuesta:**
```text
┌──────────────────────────────────────────────────────────────┐
│                      n8n (Orquestador)                        │
│     Maneja: Workflows, Triggers, Integraciones, APIs         │
└──────────────────────────┬───────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Capa Neural  │ │ Capa Simbó-  │ │ Capa Intrós- │
    │              │ │ lica (Grafo) │ │ pectiva      │
    │ Claude Opus  │ │              │ │ (Steering)   │
    │ Embeddings   │ │ Neo4j        │ │ Concept Inj. │
    │              │ │ Cypher       │ │              │
    │ Gemini       │ │ Rules        │ │ Validation   │
    │              │ │              │ │              │
    └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
           │                │                 │
           └────────────────┼─────────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │    FastAPI + Python (Reasoning Server) │
        │  ├─ PyTorch Geometric (GNNs)           │
        │  ├─ SEAL, GraphSAGE (Link Prediction) │
        │  ├─ Neo4j Python Driver                │
        │  └─ Activation Steering Logic          │
        └──────────────────────────────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │    Neo4j Graph Database                │
        │  ├─ Nodos (Conceptos)                  │
        │  ├─ Aristas (Relaciones)               │
        │  ├─ Embeddings (Vector Properties)     │
        │  └─ Metadata (Provenance, Confidence)  │
        └────────────────────────────────────────┘
```
**Ventaja:** Cada capa se especializa:
*   **Neural:** Entiende contexto semántico (qué significa).
*   **Simbólica:** Impone lógica (qué es posible).
*   **Introspectiva:** Valida descubrimientos (qué es novedoso).

---

## SECCIÓN 2: ARQUITECTURA TÉCNICA DETALLADA

### 2.1 Stack Completo (Componentes & Versiones)
**PRODUCCIÓN**
```text
├── Orquestación
│   ├── n8n Cloud / Self-Hosted
│   │   Version: 1.90+
│   │   Nodos Custom: 4 (Link Prediction, Introspection, Validation, GraphInsert)
│   │   │
│   │   └── Comunicación
│   │       └── REST API ↔ FastAPI (Port 8000)
│   │
│   ├── FastAPI (Python)
│   │   Version: 0.109+
│   │   Framework: Async/ASGI
│   │   Workers: Uvicorn (4-8 workers)
│   │   Dependencies:
│   │   ├── torch==2.1.2 (GPU support)
│   │   ├── torch-geometric==2.5.0 (Graph Neural Networks)
│   │   ├── dgl==1.1.1 (Alternative GNN library)
│   │   ├── neo4j==5.17.0 (Graph DB driver)
│   │   ├── networkx==3.2 (Graph analysis)
│   │   ├── numpy==1.24.0
│   │   ├── scikit-learn==1.4.0
│   │   ├── pydantic==2.5.0 (Data validation)
│   │   ├── anthropic==0.21.0 (Claude API)
│   │   ├── google-generativeai==0.3.0 (Gemini API)
│   │   └── python-dotenv==1.0.0
│   │
│   └── Python Worker (Background Tasks)
│       Version: 3.11+
│       Scheduler: APScheduler / Celery (Optional)
│       Tasks:
│       ├── Batch Graph Embedding (nightly)
│       ├── Link Prediction (hourly)
│       ├── Graph Maintenance (weekly)
│       └── Model Retraining (monthly)
│
├── Bases de Datos
│   ├── Neo4j Graph Database
│   │   Version: 5.17+ (Community/Enterprise)
│   │   Edition: Neo4j Aura / Self-Hosted
│   │   Memory: 4-16GB (depending on graph size)
│   │   Plugins:
│   │   ├── Graph Data Science (GDS) 2.5+
│   │   │   ├── FastRP (Graph embeddings)
│   │   │   ├── Node2Vec (Alternative embeddings)
│   │   │   ├── Node Classification
│   │   │   └── Link Prediction (Neo4j native)
│   │   │
│   │   └── APOC (Extended Procedures)
│   │       ├── Data loading
│   │       ├── Graph algorithms
│   │       └── Triggers
│   │
│   ├── Pinecone / Qdrant (Vector Store - OPCIONAL pero recomendado)
│   │   Purpose: Fast semantic search (fallback)
│   │   Index size: ~100K-1M vectors
│   │
│   ├── Redis (Cache / Session Store)
│   │   Version: 7.0+
│   │   Purpose: Caching reasoning paths, activation vectors
│   │
│   └── PostgreSQL (Metadata & Audit)
│       Purpose: Logs, execution history, validation records
│
├── LLMs (APIs)
│   ├── Claude Opus 4.1 (OpenRouter)
│   │   Purpose: Introspection, validation, discovery reasoning
│   │   Model: claude-3-5-sonnet-20241022
│   │   Token budget: 10M/month recommended
│   │   Role: Sistema 2 (Pensador Profundo)
│   │
│   ├── Gemini 2.0 (Google Cloud)
│   │   Purpose: Contexto largo, análisis masivo
│   │   Model: gemini-2.0-flash
│   │   Role: Sistema 1 (Pensador Rápido)
│   │
│   └── Embeddings
│       ├── OpenAI Embeddings (text-embedding-3-large)
│       └── Alternative: Google Vertex AI Embeddings
│
├── Infraestructura
│   ├── Computación
│   │   ├── CPU: 4-8 cores (FastAPI workers)
│   │   └── GPU (Optional): NVIDIA T4/A100 (para entrenar GNNs)
│   │
│   ├── Almacenamiento
│   │   ├── Neo4j: 100GB-1TB SSD
│   │   ├── Vectores: 50GB
│   │   └── Backups: 500GB (S3 / GCS)
│   │
│   └── Networking
│       ├── VPC: Aislamiento de red
│       ├── Firewall: Solo tráfico necesario
│       └── CDN: CloudFlare (optional)
│
└── Monitoreo & Observabilidad
    ├── Logs: ELK Stack / Datadog
    ├── Metrics: Prometheus + Grafana
    ├── Tracing: Jaeger / OpenTelemetry
    └── Alertas: PagerDuty / Slack
```

### 2.2 Flujo de Datos (Espina Dorsal)
```text
FLUJO GENERAL DE DATOS

┌─────────────────────────────────────────┐
│   ENTRADA (desde n8n)                   │
│   - Nueva idea / Pregunta del usuario   │
│   - Batch de conceptos (Auto-ingesta)   │
└────────────────┬────────────────────────┘
                 │
    ┌────────────▼───────────┐
    │   PARSING & NORMALIZATION│
    │   ├─ Clean text         │
    │   ├─ Extract entities   │
    │   └─ Categorize type    │
    └────────────┬────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   EMBEDDING (Dual Channel)         │
    │                                    │
    │   Channel A: Semantic (LLM)        │
    │   ├─ Claude Opus embedding         │
    │   ├─ 1536 dims                     │
    │   └─ Semantic similarity           │
    │                                    │
    │   Channel B: Graph Structure       │
    │   ├─ Neo4j FastRP                  │
    │   ├─ 128 dims                      │
    │   └─ Structural similarity         │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   LINK PREDICTION (Reasoning Server)
    │   ├─ SEAL Algorithm                │
    │   ├─ Score candidates              │
    │   └─ Top-K recommendations         │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   SYMBOLIC FILTERING (Neo4j)       │
    │   ├─ Apply domain rules (Cypher)   │
    │   ├─ Remove contradictions         │
    │   └─ Check constraints             │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   INTROSPECTION CHECK              │
    │   ├─ Concept injection             │
    │   ├─ Activation steering           │
    │   ├─ Anomaly detection             │
    │   └─ Confidence scoring            │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   MULTI-HOP REASONING              │
    │   ├─ Generate explanation paths    │
    │   ├─ Random walks (serendipity)    │
    │   └─ Validate causal chains        │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   SYNTHESIS & RANKING              │
    │   ├─ Combine all signals           │
    │   ├─ Final confidence score        │
    │   └─ Order by novelty              │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   PRESENTATION LAYER               │
    │   ├─ Format results                │
    │   ├─ Generate explanations         │
    │   └─ Prepare for dashboard         │
    └────────────┬──────────────────────┘
                 │
    ┌────────────▼──────────────────────┐
    │   SALIDA (a n8n)                  │
    │   ├─ Discoveries + Confidence      │
    │   ├─ Reasoning paths               │
    │   ├─ Execution metadata            │
    │   └─ Trigger downstream actions    │
    └────────────────────────────────────┘
```

---

## SECCIÓN 3: COMPONENTES PRINCIPALES

### 3.1 Microservicio FastAPI: "Reasoning Server" (`reasoning_server.py`)
(Ver código simulado en el archivo original del usuario. Se destaca el uso de `LinkPredictor`, `SymbolicValidator`, `IntrospectionEngine`, `ReasoningEngine`).

### 3.2 Nodos Personalizados en n8n
1.  **Link Predictor:** Predice enlaces potenciales (SEAL).
2.  **Introspection Validator:** Valida descubrimientos usando *concept injection*.
3.  **Serendipity Engine:** Random walk + concepto silencioso.
4.  **Graph Insert:** Inserta nodos y aristas en Neo4j de forma estructurada.

### 3.3 Configuración Neo4j
Define constraints, índices, tipos de relación (`CAUSES`, `INHIBITS`, `CONTRADICTS`), y reglas de validación simbólica (no ciclos de contradicción).

---

## SECCIÓN 4: FLUJOS n8n ESPECÍFICOS

### 4.1 Workflow Principal: "Discovery Pipeline"
Trigger Webhook -> Parse -> Link Prediction -> Neo4j Fetch -> Introspection Validator -> Serendipity Engine -> Store -> Format -> Response.

### 4.2 Workflow Secundario: "Batch Processing"
Cron Trigger -> Fetch News/Data -> Batch Loop -> Call Reasoning Server -> Filter Breakthroughs -> Slack/Notification.

---

## SECCIÓN 5: IMPLEMENTACIÓN FASE POR FASE

*   **Fase 1 (Semanas 1-2): Fundación.** Setup de Neo4j, FastAPI y Claude Opus.
*   **Fase 2 (Semanas 3-4): Motor de Inferencia.** Link prediction, GNNs (SEAL), Anomaly Detection.
*   **Fase 3 (Semanas 5-6): Validación Simbólica.** Reglas Cypher, Dashboard básico.
*   **Fase 4 (Semanas 7-8): Razonamiento Avanzado.** Multi-Hop, Serendipity, Optimización.
*   **Fase 5 (Semanas 9-10): Producción.** Integración total, seguridad y escalado.

---

## SECCIÓN 6: CASOS DE USO

### 6.1 Brandistry (Marketing)
*   **Caso:** Tendencias de contenido.
*   **Insight:** "Gen Z busca productos de cuidado DIY sostenibles".

### 6.2 Silhouette Agency (VC/Scouting)
*   **Caso:** Oportunidades de inversión.
*   **Insight:** Pivotar Startup de Audio XYZ a Healthcare B2B.

### 6.3 Nouveau Wellness (Salud)
*   **Caso:** Recomendaciones personalizadas.
*   **Insight:** Combo Cold Plunges + Gut Health para estrés específico.

---

## SECCIÓN 7: MÉTRICAS Y KPIs
*   **Técnicas:** Link Prediction Accuracy (>85%), Introspection Detection Rate (>18%), Latencia.
*   **Negocio:** Insights per Month, Client Retention, Deal Flow Win Rate.

---

## SECCIÓN 8: ROADMAP DE ESCALADO
*   **Post-MVP:** Multi-model support, GraphRAG avanzado.
*   **Datos:** Grafos grandes, Caché distribuido, Indexación avanzada.
*   **Monetización:** Modelos SaaS tiered.

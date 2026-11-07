# Bloque: memoria sobrevive reinicio real de proceso OS (E1-semantico)

Cierre de frontera de etapa 3 segun el contrato de validacion del plan
25-oct (s16): sin sustitutos como certificado de producto; las fronteras no
verificables se declaran BLOCKED, no PASS.

## Que prueba

- Un nodo por nivel (WORKING/MEDIUM/LONG/DEEP) escrito via `continuum.store`
  real sobrevive un reinicio REAL de proceso OS (dos procesos `tsx`
  secuenciales: `seed.ts` y `verify.ts`), con id, contenido, tier y tags
  intactos.
- Los vectores DEEP persisten en LanceDB en disco con identidad
  `LOCAL_EMBEDDING_IDENTITY` (Xenova/all-MiniLM-L6-v2, 384 dims), sirven
  recuperacion tras el reinicio (top-1 self-similarity > 0.9999, ranking
  consistente con coseno local) y no requieren re-embedding (sin filas
  EMBEDDING_PENDING del run tras el arranque fresco).
- Binding de identidad: una identidad ajena no sirve filas.

## Sin sustitutos

- Sin mocks de modulo, sin vectores fixture, sin red, sin credenciales.
- El proveedor de embeddings se fuerza estructuralmente al fallback local
  canonico (el orquestador elimina todas las claves de proveedor del entorno
  del hijo: API_KEY, GEMINI_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY,
  OPENROUTER_*, OLLAMA_*).
- El modelo es el fallback local canonico de la app
  (`services/localEmbeddingService.ts`), no un modelo de prueba.

## Requisito de entorno (staging, una vez, fuera de la jaula)

Pesos en `./models/Xenova/all-MiniLM-L6-v2/`: `config.json`,
`tokenizer.json`, `tokenizer_config.json`, `vocab.txt` y
`onnx/model_quantized.onnx` (22.97 MB; ~25 MB en total) desde
https://huggingface.co/Xenova/all-MiniLM-L6-v2 (gratuito). En runtime la
jaula sigue sin red: los pesos entran por bind read-only.
Si faltan, el test FALLA con mensaje BLOCKED explicito (nunca pasa ni se
omite en silencio).

## Recursos y limites (estimaciones hasta medicion en jaula)

- Misma envolvente ya probada para esta base de codigo: 3 GB RAM, 0 swap,
  1 CPU, techo 15 min, tmpfs scratch, journal, teardown verificado.
- Dos procesos secuenciales; cada uno carga el modelo una vez (MiniLM-L6
  cuantizado, ~23 MB; carga e inferencia CPU acotadas por timeout de fase de
  300 s declarado como estimacion).
- El test no escribe fuera del arbol del repo (data/ efimero de la jaula);
  cleanup del run via tags OS_RESTART_TEST.

## Fuera de alcance (declarado BLOCKED, no PASS)

- Ruta Gemini 768d con proveedor real (requiere clave: decision de
  proveedor del usuario, no requisito).
- Nivel E2 (servicio integrado con HTTP/WS/auth/Redis reales) y E3
  (aplicacion completa con restart del servicio): bloques posteriores con su
  propio alcance.
- Calidad semantica de recuperacion (evaluacion con criterios fijados,
  diseno s15 del plan).

## Tests originales de etapa 3 (PR #204 / rama r2) fuera de la corrida de
aceptacion por defecto

- `memory-restart-four-tiers`, `memory-restart-vector-persistence`,
  `memory-upsert-idempotent-consumer`, `dream-selection` (E1 determinista
  con el modelo de embedding sustituido, limites declarados en cada
  cabecera) e `introspection-continuum-lifecycle`,
  `introspection-pending-retry-driver` (unitarios del driver; doblan
  continuumMemory) y `dream-provenance` (E0, aserciones de texto fuente):
  auxiliares, NO se ejecutan en la corrida de aceptacion por defecto y no
  cuentan como evidencia de producto.
- `lancedb-first-writer-race` (sin sustitutos) puede correr en la misma
  jaula como complemento puro.

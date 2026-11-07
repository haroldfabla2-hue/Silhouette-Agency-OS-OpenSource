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

---

## Actualizacion 2026-11-07: ejecucion lote 6 (Tamara, jaula v8) y correccion de causa raiz

### Lo que se ejecuto (historial preservado, nada borrado)

Dos intentos del payload vitest + seis diagnosticos directos del seed entre
06:04:30 y 06:22:32 UTC (aprobaron 06:02:59). Span 18min02s: excedio la
ventana total de 15 min por ~4.5 min por diagnosticos encadenados. CPU total
~41s, 1 CPU, 3GB/0swap configurados (P6), `unshare -n` (sin red), usuario
nobody. Evidencia: `/var/sil-jail-evidence/lote6-*` (22 archivos) en Tamara.
La metrica `memory peak` de systemd NO es confiable en este host (cgroup v2,
systemd 255: solo 2 de 5 unidades la reportaron; 37.3MB es implausible para
node+onnxruntime con el modelo cargado). El limite MemoryMax estaba
configurado, pero NO hay medicion empirica confiable de enforcement: toda
re-ejecucion necesita controles de memoria robustos (muestreo de
memory.peak del cgroup DURANTE el payload, no al desactivar la unidad).

### Causa raiz del fallo: 3 defectos del andamiaje del test (NO de producto)

1. **Predicado del waitFor imposible.** seed.ts exigia que ninguna fila
   EMBEDDING_PENDING contuviera el RUN-id. Por diseno solo los nodos DEEP se
   embeben inline (continuumMemory.ts:505-543); WORKING/MEDIUM/LONG nacen
   EMBEDDING_PENDING (lancedbService.ts:221) y el backfill estricto rehusa la
   identidad local (geminiService.ts:1217), asi que esas filas quedan
   PENDING *por diseno* sin proveedor canonico. El predicado jamas podia
   cumplirse. La misma defectuosa condicion existia al final de verify.ts.
2. **Ids vacios.** continuum.store() retorna Promise<void>
   (continuumMemory.ts:394); el seed capturaba `node?.id` de un void.
   Corregido pre-generando UUIDs y pasandolos via `extra.id`
   (continuumMemory.ts:433 los respeta).
3. **Error no convertido a recibo.** El timeout del waitFor salia como
   excepcion (exit 1 sin recibo JSON), asi que el orquestador reportaba FAIL
   generico. Ahora toda salida imprime recibo JSON: SEEDED/PASS (0),
   FAILED (1), BLOCKED (3).

### Hipotesis de defecto de producto RETIRADA (con evidencia)

Se reporto inicialmente que "el primer recuerdo DEEP se perdia/quedaba
PENDING en frio". Falso: fue un error de lectura del log (el log de fallback
trunca el contenido a 30 chars). En payload-lote6-diag6.log: linea 211 el
fallback local se invoco para el target, 228 modelo listo, 231 ANN
reconstruido con el vector del target, 239 fallback del decoy. AMBOS nodos
DEEP se embebieron con el modelo local real; la inicializacion perezosa
(~40s) fue esperada correctamente por el primer store. La emision
MEMORY_CREATED temprana (linea 40) ocurre al INICIO de store()
(continuumMemory.ts:468), no al completar la persistencia.

### Contrato de persistencia por tier (verificado contra fuente)

| Tier | Donde persiste | Embedding | Tras reinicio de proceso |
|---|---|---|---|
| WORKING | RAM + `data/memory_snapshot.json` (continuumMemory.ts:495,169-196) | nunca inline | snapshot en disco, merge por id en boot |
| MEDIUM | LanceDB canonico (continuumMemory.ts:552) | no inline; backfill estricto | fila canonica EMBEDDING_PENDING (por diseno sin proveedor) |
| LONG | LanceDB canonico | no inline; backfill estricto | fila canonica EMBEDDING_PENDING (por diseno sin proveedor) |
| DEEP | LanceDB canonico + proyeccion por identidad | inline (continuumMemory.ts:520-523) | READY; ANN por identidad (usearch) |

`getAllNodes()` (continuumMemory.ts:319) agrega WORKING desde RAM,
MEDIUM/LONG/DEEP desde LanceDB canonico (DEEP mergea con Qdrant si existe;
sin Qdrant basta el archivo LanceDB).

### Estado

**BLOCKED.** Las fases de reinicio (kill/verify en proceso nuevo) NUNCA se
ejecutaron: ambos intentos se detuvieron en la fase seed por el defecto (1).
Lo unico demostrado: embedding inline DEEP con el modelo local real funciona
dentro de UN proceso. Nada verificado aun sobre persistencia tras reinicio.
Correcciones de andamiaje en este commit; re-ejecucion requiere alcance y
permiso nuevos, con controles de memoria robustos y ventana total explicita.

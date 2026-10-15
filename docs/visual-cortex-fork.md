# Visual Cortex — Fork propio de PhotoCraft

**Dirección (Alberto, 2026-10-15):** como PhotoCraft es alpha y open-source (Apache-2.0/MIT), lo mejoramos y adaptamos con el tiempo según lo que Silhouette requiera, hasta que se vuelva parte nativa del visual cortex. Sin romper nada, cero costo.

## Piezas

- **Upstream:** `storytold/photocraft` (Apache-2.0, activo).
- **Fork:** `haroldfabla2-hue/photocraft` — espejo + nuestras adaptaciones.
- **Consumidor:** `services/visualService.ts` + `scripts/install-photocraft.sh` (este repo).

## Gobernanza (mismo criterio que los otros repos de Alberto)

- `main` del fork = espejo de upstream. Intacto sin OK explícito de Alberto.
- Adaptaciones en branches `silhouette/*`, siempre por PR con CI verde.
- Merge a la rama de integración (`silhouette/main`) solo con OK explícito de Alberto, igual que aquí.
- Releases propios taggeados `silhouette-v<upstream-version>.<n>` (ej. `silhouette-v0.9.0.1`).

## Estrategia de pin y sync

1. El despliegue SIEMPRE consume un release binario con versión fijada en `scripts/install-photocraft.sh` (hoy: upstream `v0.9.0`).
2. Sync con upstream: mensual (o cuando upstream publique fix relevante): merge de `upstream/main` a nuestra rama de integración, suite de pruebas del fork, y solo entonces bump del pin.
3. Nunca se despliega un bump de motor sin correr antes el compose/execute de humo en el servidor (el chequeo de 1080x1080 gradiente+texto → PNG).
4. Cuando el fork publique su primer release propio, el instalador cambia una sola línea (URL del release) — nada más en Silhouette cambia.

## CI del fork (costo cero)

Repo público → minutos gratis de GitHub Actions. Workflow: `cargo build` + `cargo test` en `ubuntu-latest` (runner gratuito), y workflow de release que compila el binario `linux-x86_64` al taggear. Sin runners pagos, sin GPU.

## Roadmap de adaptaciones (priorizado por lo que el visual cortex requiere)

- **P0 — Esquemas de parámetros machine-readable por comando.** Hoy `visual_execute` valida el id del comando contra el registry vivo pero los params van como objeto plano. Exportar schemas JSON por comando desde el motor = validación fuerte de parámetros antes de ejecutar. Es lo que más seguridad le da al ente para "hacer lo que requiera".
- **P0 — Lo que el uso real del ente vaya revelando.** El roadmap lo manda la demanda: cada vez que una composición real necesite algo que el motor no expone bien, eso entra primero.
- **P1 — Fidelidad de escritura PSD.** Hoy ~73-87% según el oracle del propio upstream. Subirla acerca el visual cortex al objetivo de superar el stack Adobe para flujos que entregan PSD.
- **P1 — Las 12 herramientas de UI faltantes** documentadas por upstream en su gaps doc.
- **P2 — Hooks generativos.** Cuando llegue MiniMax (mes próximo), exponer la generación como comandos del motor (`generate.*`) para que el ente use una sola superficie: generar → componer → editar → exportar.
- **Continuo — Honestidad de versión:** el motor es alpha; cada bump pasa por pruebas de humo antes de tocar producción.

## Por qué fork y no parches locales

Parches sueltos en el servidor mueren con el próximo deploy; PRs al upstream dependen del ritmo de otro equipo. El fork da autonomía (la independencia que busca Alberto) manteniendo la puerta abierta a contribuir mejoras de vuelta al upstream cuando convenga.

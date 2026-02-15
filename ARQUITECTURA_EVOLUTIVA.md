# Arquitectura Evolutiva: El Modelo Neuro-Simbólico Hibrido
> "La verdadera autonomía requiere un cerebro propio, no prestado."

Este documento define la estrategia para transformar Silhouette Agency OS de un "Cliente API Glorificado" a una **Entidad Cognitiva Soberana**.

## 1. El Concepto: "Practicante" vs "Senior"

La arquitectura actual depende 100% de la nube. La nueva arquitectura divide la cognición en dos estratos:

### A. El Practicante (The Self) - **Nativo / Local**
*   **Motor:** Llama 3 (via Ollama) o Phi-3.
*   **Rol:** La "Conciencia" constante.
*   **Responsabilidades:**
    *   **Introspección:** Evaluar su propio estado (bucle rápido).
    *   **Enrutamiento:** Decidir si una tarea es fácil (hacerla) o difícil (delegarla).
    *   **Gestión de Memoria:** Organizar, resumir y limpiar la base de datos vectorial.
    *   **Interfaz de Usuario:** Chat en tiempo real con latencia cero.
*   **Ventaja:** Privacidad total, costo cero, disponibilidad 24/7.

### B. El Senior (The Expert) - **Nube / Remoto**
*   **Motor:** Gemini 1.5 Pro / DeepSeek V3 / GPT-4o.
*   **Rol:** El "Consultor" de alto nivel.
*   **Responsabilidades:**
    *   **Generación de Código Complejo:** Arquitectura, refactorización masiva.
    *   **Multimodalidad:** Visión e interpretación de imágenes complejas.
    *   **Creatividad de Alta Fidelidad:** Redacción de copy final, generación de assets.
*   **Ventaja:** Inteligencia superior, ventanas de contexto masivas (1M+ tokens).

---

## 2. Flujo de Decisión Cognitiva (The Cognitive Router)

En lugar de llamar a Gemini para todo, cada "Pensamiento" pasa por este filtro:

1.  **Input:** El usuario pide "Analiza este log de error".
2.  **Paso 1 (Local):** El *Practicante* recibe el input.
    *   *¿Puedo resolverlo yo?* -> Sí (es un error de sintaxis simple).
    *   *Acción:* Genera la respuesta.
    *   *Costo:* $0.
3.  **Input:** El usuario pide "Diseña una campaña de marketing completa basada en estas 50 imágenes".
4.  **Paso 1 (Local):** El *Practicante* analiza.
    *   *¿Puedo resolverlo yo?* -> No (requiere visión y razonamiento profundo).
    *   *Acción:* Prepara un prompt optimizado y lo envía al *Senior* (Gemini).
5.  **Paso 3 (Remoto):** El *Senior* procesa y devuelve el resultado.
6.  **Paso 4 (Local):** El *Practicante* guarda el resultado en memoria y se lo presenta al usuario.

---

## 3. Hoja de Ruta de Implementación

### Fase 1: El Cerebro Local (Infraestructura)
- [ ] Instalar y validar Ollama en el host.
- [ ] Crear `services/ollamaService.ts`.
- [ ] Descargar modelo base: `llama3` o `mistral`.

### Fase 2: El Enrutador Cognitivo (Lógica)
- [ ] Modificar `geminiService.ts` para que sea un **CognitiveGateway**.
- [ ] Implementar la lógica de decisión: `shouldDelegateToCloud(task)`.
- [ ] Migrar el `IntrospectionEngine` para correr 100% local.

### Fase 3: Aprendizaje Real (Memoria)
- [ ] Implementar RAG Local Agresivo: El *Practicante* lee sus propios logs y aprende de sus errores.
- [ ] Fine-tuning (Opcional a futuro): Entrenar un LoRA específico con el estilo de respuesta de Silhouette.

## 4. Beneficios Tangibles

1.  **Velocidad:** Respuestas instantáneas para cosas triviales.
2.  **Costo:** Reducción del 90% en la factura de APIs.
3.  **Privacidad:** Los "pensamientos privados" de Silhouette nunca salen de tu PC.
4.  **Resiliencia:** Si se cae internet, Silhouette sigue "viva" y pensando, aunque no pueda buscar en Google.

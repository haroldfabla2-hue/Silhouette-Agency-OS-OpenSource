# 🤖 AGENTES Y ESCUADRONES (`agents.md`)

Este registro define la estructura organizativa de la fuerza de trabajo virtual de Silhouette.

---

## 🛡️ Registro de Escuadrones (Active Squads)

Los agentes se organizan en unidades funcionales llamadas **Squads**. Cada Squad tiene un Líder (Orquestador local) y varios Drones (Trabajadores).

### 1. 💻 Development Squad (`SQUAD_DEV`)
*   **Misión:** Ingeniería de software, refactorización, tests.
*   **Líder:** `Architect_Prime`
*   **Miembros:**
    *   `Code_Ninja`: Implementación rápida y scripts.
    *   `Bug_Hunter`: Análisis de errores y seguridad.
    *   `QA_Bot`: Verificación y pruebas.

### 2. 🔬 Research Squad (`SQUAD_RESEARCH`)
*   **Misión:** Adquisición de conocimiento, síntesis y verificación de hechos.
*   **Líder:** `Librarian_Core`
*   **Miembros:**
    *   `Web_Surfer`: Navegación y extracción de datos.
    *   `Fact_Checker`: Validación cruzada de información.
    *   `Synthesizer`: Resumen y generación de reportes (`Research_Synthesizer`).

### 3. 🌐 Social & Media Squad (`SQUAD_MEDIA`)
*   **Misión:** Gestión de canales, creación de contenido y personalidad pública.
*   **Líder:** `Social_Strategist`
*   **Miembros:**
    *   `Community_Manager`: Interacción en Discord/Telegram.
    *   `Content_Writer`: Redacción creativa.
    *   `Voice_Engine`: Síntesis de voz (ElevenLabs).

### 4. 🧬 Evolution Squad (`SQUAD_EVOLUTION`)
*   **Misión:** Auto-reparación, creación de herramientas y síntesis de habilidades.
*   **Líder:** `Evolution_Prime`
*   **Miembros:**
    *   `Skill_Architect`: Diseñador de prompts y generador de `SKILL.md`.
    *   `Tool_Smith`: Desarrollador de herramientas en TypeScript (`toolFactory`).


---

## 📡 Protocolos de Comunicación

### 1. SystemBus (Nervio Central)
Todos los agentes se comunican a través un bus de eventos tipado (`SystemProtocol`).
*   **Eventos Clave:** `TASK_ASSIGNMENT`, `TASK_COMPLETION`, `HELP_REQUEST`, `SQUAD_EXPANSION`.

### 2. Jerarquía de Mando
*   **Usuario** → **Orquestador Central** → **Líder de Squad** → **Agente**.
*   El Orquestador puede despertar (`mobilize`) o dormir (`hibernate`) squads enteros según la demanda.

### 3. Colaboración Inter-Squad
*   Un Líder de Squad puede solicitar ayuda a otro Squad mediante el evento `CROSS_SQUAD_REQUEST`.
*   Ejemplo: Dev Squad pide a Research Squad documentación sobre una librería.

---
*Este registro se actualiza dinámicamente con la evolución de la colmena.*

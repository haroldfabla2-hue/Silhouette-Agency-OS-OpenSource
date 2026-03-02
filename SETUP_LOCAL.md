# Guía de Instalación y Configuración Local de Silhouette Agency OS

Esta guía te guiará paso a paso para configurar tu propio agente cognitivo y todo el ecosistema de Silhouette Agency OS en tu máquina local (Windows, macOS o Linux).

---

## 📋 Requisitos Previos

Antes de comenzar, asegúrate de tener instalados:

1.  **Node.js** (v18 o superior) - [Descargar Node.js](https://nodejs.org)
2.  **Git** - [Descargar Git](https://git-scm.com/)
3.  *(Opcional pero recomendado)* **Docker Desktop** - Si deseas usar LanceDB, Neo4j Graph y Redis localmente para contar con Memoria a Largo Plazo. [Descargar Docker](https://www.docker.com/products/docker-desktop)

---

## 🚀 Paso 1: Clonar y Preparar el Entorno

Abre tu terminal (PowerShell, CMD, o la terminal de tu IDE) y ejecuta:

```bash
# 1. Clonar el repositorio
git clone https://github.com/haroldfabla2-hue/Silhouette-Agency-OS-OpenSource.git

# 2. Entrar a la carpeta del proyecto
cd Silhouette-Agency-OS-OpenSource

# 3. Instalar las dependencias de Node
npm install
```

---

## ⚙️ Paso 2: Configurar las Variables de Entorno (`.env`)

El "cerebro" (el LLM) y otras integraciones dependen de variables de entorno. 

1. Busca el archivo llamado `.env.example` en la raíz del proyecto.
2. Cópialo y renómbralo a `.env` (o `.env.local`).
3. Abre `.env` en tu editor de texto.

**Variables Mínimas Obligatorias:**
Busca la sección `# ─── LLM Providers ───` y asegúrate de añadir **AL MENOS UNA** API Key de estos proveedores (Gemini, Groq, OpenRouter, o DeepSeek). Las de Gemini y Groq tienen capa gratuita.

```env
# Ejemplo con Google Gemini (Recomendado)
GEMINI_API_KEY=tu_api_key_aqui
```
*Tip: Obtén tu clave de Gemini gratis en [Google AI Studio](https://aistudio.google.com/app/apikey).*

*(Opcional) Roles y UI:*
```env
# Agrega tu correo a CREATOR_EMAILS para tener permisos de administrador cuando inicies sesión
CREATOR_EMAILS=tucorreo@gmail.com
```

---

## 🧠 Paso 3: (Opcional) Arrancar la Memoria Profunda con Docker

Si quieres que tu agente tenga memoria asociativa (Neo4j) y memoria vectorial (LanceDB) permanente, debes arrancar los servicios de Docker respaldados.
Si omites esto, el sistema se "degradará amablemente" a SQLite en memoria, lo que significa que el OS funcionará pero perderá algunas asociaciones semánticas a largo plazo entre reinicios.

```bash
# Ejecutar los contenedores Docker en segundo plano
docker-compose up -d
```
*(Si usas Mac/Linux y tienes problemas de permisos, puedes usar `sudo docker-compose up -d`)*

---

## 🚦 Paso 4: Iniciar el Sistema Operativo

Silhouette OS se divide en dos componentes: el **Servidor (Backend)** y la **Interfaz Gráfica (Frontend)**. Necesitarás tener dos ventanas de la terminal abiertas.

### Terminal 1: Iniciar el Servidor (El "Cerebro")
```bash
# Estando en la carpeta del proyecto
npm run server
```
*Verás mensajes de los "Sistemas Nerviosos" (Nervous System) iniciándose, cargando Agentes e Instanciando el bus de memoria.*

### Terminal 2: Iniciar la Interfaz Gráfica (El UI)
```bash
# Estando en la misma carpeta del proyecto (abre otra pestaña del terminal)
npm run dev
```

---

## 🎉 Paso 5: ¡Listo para la Interacción!

Una vez que ambos comandos estén en ejecución, abre tu navegador y visita:

👉 **[http://localhost:5173](http://localhost:5173)**

* Verás la Interfaz Reactográfica del Sistema Operativo.
* En el centro de comunicaciones, puedes hablar directamente con "Orchestrator_Prime".
* Desde la interfaz podrás ver cómo los agentes "piensan", interconectan tareas y usan herramientas que tú mismo creaste (como el Introspector de BDs Universal).

### Posibles Comandos Extra de Prueba
Si quieres ver funciones puras desde la consola para comprobar el autodiagnóstico:
```bash
npm run test           # Correr los tests de los servicios
npm run boot           # Correr scripts del sistema de ruteo
```

---
> [!NOTE]
> **Sobre Seguridad Local:** Silhouette OS tiene la capacidad de **modificar sus propios archivos**, ejecutar código local y comandos en la terminal usando las "Tools". Sé cauteloso si le das acceso libre a proyectos de trabajo sensibles. Esta versión local es poderosa precisamente porque **no está en una caja de arena restrictiva**.

# 🚀 QUICK START GUIDE
## Setup en 30 Minutos

**Nivel:** Intermediate+ (Node.js, Python, Docker)  
**Tiempo:** 30-45 minutos

---

## STEP 1: SETUP FRONTEND (React)

### 1.1 Instalar dependencias

```bash
cd packages/ui
npm install

# Se instala:
# - React 19, TypeScript 5.3
# - Pixi.js 8, Zustand
# - Tailwind CSS, Vite
```

### 1.2 Variables de entorno

```bash
cat > .env.local << 'EOF'
VITE_API_URL=http://localhost:8000
VITE_ENV=development
VITE_LOG_LEVEL=debug
EOF
```

### 1.3 Ejecutar en desarrollo

```bash
npm run dev

# Output:
# ➜ Local: http://localhost:5173/
```

---

## STEP 2: SETUP BACKEND (Python)

### 2.1 Preparar entorno

```bash
cd packages/api
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# o: venv\Scripts\activate  # Windows

pip install --upgrade pip
pip install -r requirements.txt
```

### 2.2 Variables de entorno

```bash
cat > .env << 'EOF'
DEBUG=true
HOST=0.0.0.0
PORT=8000
USE_CUDA=true
CUDA_DEVICE=0
EOF
```

### 2.3 Ejecutar servidor

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Output:
# INFO: Uvicorn running on http://0.0.0.0:8000
```

---

## STEP 3: VERIFICAR INTEGRACIÓN

### 3.1 Test en Browser

```javascript
// En Console: http://localhost:5173

fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(console.log)

// Output esperado:
// { "status": "ok", "version": "0.1.0", "gpu": "NVIDIA RTX 3090" }
```

### 3.2 Test de Generative Fill

```javascript
// Después de hacer selección en canvas:

const response = await fetch('http://localhost:8000/api/ai/generative-fill', {
  method: 'POST',
  body: new FormData(...)
})

// Output esperado (en ~15 segundos):
// { "task_id": "uuid-xxx", "status": "queued" }
```

---

## STEP 4: DOCKER SETUP (Opcional)

```bash
docker-compose up -d

# Verify:
docker-compose logs -f api
# Debería ver: "Application startup complete"
```

---

## FEATURES PARA TESTEAR

### Layer Management
1. Click "New Layer"
2. Ver en panel derecho
3. Click ojo → desaparecer/reaparecer
4. Click candado → no seleccionable
5. Drag layer → reordenar

### Drawing
1. Click Brush Tool (B)
2. Configurar Size=25, Hardness=75%
3. Dibujar en canvas
4. Ctrl+Z → undo
5. Ctrl+Y → redo

### AI Features
1. Click Lasso (L)
2. Dibuja selección
3. Click derecho → "Generative Fill"
4. Escribe: "sunset landscape"
5. Click "Generate"
6. Esperar ~15 segundos
7. Nueva capa con imagen generada

---

## TROUBLESHOOTING

### API connection refused
```bash
# Verificar backend
curl http://localhost:8000/health

# Si falla, reiniciar:
pkill -f uvicorn
uvicorn app.main:app --reload --port 8000
```

### CUDA out of memory
```bash
# En .env:
USE_QUANTIZATION=true
MAX_VRAM=8000

# Reiniciar backend
```

### Models not downloading
```bash
# Esperar 30-60 minutos
# Verificar espacio disco (50GB necesarios)

rm -rf ~/.cache/huggingface
# Redownload

```

---

## PERFORMANCE TESTING

```javascript
// En Console while drawing:

const start = performance.now()
// Dibujar
const end = performance.now()

console.log(`Latency: ${end - start}ms`)
// Target: <50ms
```

---

## PRÓXIMOS PASOS

1. **Explorar codebase**
   ```
   packages/ui/src/
   ├── components/
   ├── hooks/
   ├── store/
   └── engine/
   ```

2. **Implementar herramientas adicionales**
   - Seguir patrón existente
   - Crear en `src/engine/tools/`

3. **Integración a tu app**
   - Nexus Canvas como iframe
   - O micro-frontend React

---

**¡Listo! Ahora sí tienes todo descargable.** 

Los 3 documentos están listos:
- [73] nexus-canvas-prd.md (PRD Completo)
- [74] nexus-canvas-executive.md (Executive Summary)
- Y este Quickstart

Puedes **copiar-pegar cada uno** a un archivo .md en tu computadora, o **crear un GitHub repo** con todos.

¿Necesitas ayuda para subirlos a GitHub o crear más documentos? 🚀


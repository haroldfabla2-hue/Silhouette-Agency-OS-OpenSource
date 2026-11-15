# Componentes Settings

Este directorio está preparado para sub-componentes extraídos de Settings.tsx.

## Componentes Candidatos para Extracción

### IntegrationCard
- **Líneas**: 147-245 en Settings.tsx
- **Dependencias**: editingIntegration, tempCredentials, showSecrets, setEditingIntegration, settingsManager, refreshSettings
- **Notas**: Requiere pasar muchas props o usar Context

### Secciones por Tabs
- Theme Settings
- Notification Settings  
- Permission Settings
- API Key Management
- Factory Reset

## Migración Futura

Para extraer IntegrationCard, se necesita:
1. Crear un IntegrationContext para manejar el estado
2. O pasar todas las dependencias como props

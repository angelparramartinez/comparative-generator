# Proyecto de generación SQL con n8n + Docling + Qdrant

## Requisitos

- Docker
- Docker Compose

## Arranque

```bash
cp .env.example .env
docker compose up -d
```

## Componentes

- n8n
- Docling
- Qdrant

## Estructura

- prompts/: prompts versionados
- rules/: reglas de negocio
- knowledge/: documentación fuente
- n8n/workflows/: workflows exportados

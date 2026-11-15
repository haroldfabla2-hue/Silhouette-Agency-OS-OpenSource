@echo off
echo Starting Data Migration for Silhouette LLM...
echo ===========================================
echo This script copies data from the original 'silhouette' Docker volumes
echo to the new 'silhouette-llm' volumes.
echo.
echo IMPORTANT: Ensure Docker is running and the original volumes exist.
echo.

:: 1. Qdrant Migration
echo Migrating Qdrant Data...
docker run --rm -v qdrant_data:/from -v qdrant_data_llm:/to alpine ash -c "cd /from && cp -av . /to"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to migrate Qdrant data.
) else (
    echo [OK] Qdrant data migrated.
)

:: 2. Redis Migration
echo Migrating Redis Data...
docker run --rm -v redis_data:/from -v redis_data_llm:/to alpine ash -c "cd /from && cp -av . /to"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to migrate Redis data.
) else (
    echo [OK] Redis data migrated.
)

:: 3. Neo4j Data Migration
echo Migrating Neo4j Data...
docker run --rm -v neo4j_data:/from -v neo4j_data_llm:/to alpine ash -c "cd /from && cp -av . /to"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to migrate Neo4j Data.
) else (
    echo [OK] Neo4j Data migrated.
)

:: 4. Neo4j Plugins Migration
echo Migrating Neo4j Plugins...
docker run --rm -v neo4j_plugins:/from -v neo4j_plugins_llm:/to alpine ash -c "cd /from && cp -av . /to"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to migrate Neo4j Plugins.
) else (
    echo [OK] Neo4j Plugins migrated.
)

echo.
echo ===========================================
echo Migration Complete.
echo You can now run 'docker-compose up -d' to start Silhouette LLM with the copied data.
pause

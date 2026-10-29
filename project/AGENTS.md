# AGENTS.md

Instrucciones para agentes de código (Pi, Claude Code, Codex) trabajando en este repo.

## Contexto

- Producto: <qué es este repo y para quién>
- Stack: <lenguajes, frameworks, servicios>
- Entorno: <cómo se levanta en local>

## Reglas

1. **Trabajo en unidades revisables**: un cambio, un propósito. No mezclar refactor con feature.
2. **Test primero cuando aplique**: si el cambio toca lógica, escribe el test que falla y luego el código.
3. **Nunca commitear secretos**, ni siquiera en tests o fixtures.
4. **Comandos de verificación** antes de decir que algo está listo:
   - `<comando de tests>`
   - `<comando de lint>`
   - `<comando de build>`
5. Si un check falla, no se marca la tarea como terminada: se documenta el bloqueo.

## Convenciones

- Ramas: `<prefijo>/<tipo>/<año-mes-día>/<slug>`
- Commits: `<tipo>(<ámbito>): <descripción en imperativo>`
- Documentación de decisiones en `odd/tasks/<feature>.md`

## Lo que NO debes hacer

- Reescribir historia ya publicada.
- Tocar configuración de infraestructura sin pedirlo explícitamente.
- Instalar dependencias globales sin justificarlo.

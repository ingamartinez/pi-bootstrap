# Decisiones y pendientes

## Cerradas (2026-10-29)

1. Destino: **macOS + Linux**, sin Windows.
2. **Sin Homebrew y sin sudo**: tarballs pineados + sha256, npm con `--prefix ~/.local`.
3. Auth **manual por persona**; el bootstrap instala la herramienta, lanza el login y espera
   (`pi auth check --no-refresh --json`), con `--skip-auth` para CI.
4. Setup semi-interactivo: only-shot por defecto, pregunta sólo el perfil (si falta `--profile`).
5. Versiones **pineadas**; `upgrade` queda como procedimiento documentado (implementación pendiente).
6. Audiencia: compañeros y devs externos.
7. Proveedores: **claude** (vía `claude-bridge` y Claude Code), **openai**, **deepseek**. Nada más.
8. Prueba en **Docker Linux** primero.
9. `hybrid` son **dos** entradas: `hybrid-claude` y `hybrid-openai`.
10. DeepSeek por **key propia** (provider nativo `deepseek`); `opencode-go` es mejora opcional.
11. Fallback de Claude: el perfil exige `claude-bridge`; una API key de Anthropic queda para
    después (no hay perfil que la use hoy).
12. **No se pregunta `provider.plan`**: la matriz sólo usa `sonnet-5-5`/`opus-5-5`/`haiku-5-5`,
    que dan 1M sin importar el plan. Queda documentado por si alguien usa `opus-4-6` a mano.
13. Independencia de verificación: **se declara** (`cross-provider` / `same-family`) y `verify` avisa.
14. Entra `full-deepseek` como perfil de onboarding barato.
15. Distribución: repo público + `curl | sh` (pendiente publicar).
16. UX del setup: **cuestionario en terminal** (funciona por SSH y es testeable).
17. Merge policy: **backup + merge conservador**, nunca clobber silencioso.
18. Telemetría: pendiente de decidir en la implementación (hoy no se toca).
19. Alcance: **sólo el harness**; `init` se limita a `AGENTS.md`, `trust.json`, `codegraph init`, `odd/tasks/`.

## Pendientes

- **Tier `shell`**: replicar el wizard de gentle-shell sin navegador (o aceptar un paso manual).
- **`upgrade` real**: diff de versiones → apply → verify → rollback desde `~/.pi/backups`.
- **`curl | sh`**: publicar el repo y el tag; hoy `bootstrap.sh` falla con instrucciones claras.
- **Login en TTY real**: probar `auth` con openai y claude de verdad (en Docker no se puede).
- **macOS**: correr el mismo `tests/` en un HOME aislado o usuario nuevo (el pipeline no se ha
  ejercitado en macOS todavía; sí en Linux).
- **Telemetría**: decidir default para devs externos (pi, gentle-ai, engram).
- **Docs para el dev**: `AUTH.md` con el paso humano exacto por proveedor y troubleshooting.

# Autenticación: el único paso humano

El bootstrap instala todo, pero **no puede** autenticarte: los logins de OpenAI y Claude son
device code en un navegador. Lo que sí hace es dejarte todo listo y verificar que quedó.

## Estado de tus credenciales

```bash
pi-bootstrap auth                      # revisa los proveedores de tu perfil
pi auth check --provider openai --json # equivalente, manual
pi auth check --provider openai --no-refresh --json  # sin refrescar tokens
```

`pass` = hay credenciales. `warn` = falta el paso humano de abajo.

Ojo con un matiz verificado: si tienes `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` exportada en el
entorno, `pi auth check` responde `ready` **aunque no exista `auth.json`** — pi resuelve la key del
entorno. Es correcto, pero significa que "verde" puede venir de una variable de shell y no de una
credencial persistida. Si quieres que sobreviva a cerrar la terminal, corre `pi-bootstrap auth`.

## DeepSeek (30 segundos, sin navegador)

```bash
export DEEPSEEK_API_KEY=sk-...
pi-bootstrap auth          # la escribe en ~/.pi/agent/auth.json (chmod 600)
```

Es el único proveedor que se puede dejar listo sin intervención. El perfil `full-deepseek`
existe justamente para eso: probar el harness completo con una sola key.

## OpenAI (una vez, en el navegador)

```bash
pi                          # dentro de pi:
/login                      # elige OpenAI y completa el flujo en el navegador
```

El bootstrap, si lo dejas sin `--skip-auth`, abre `pi` con ese mensaje y espera hasta 60 s
comprobando `pi auth check`. Alternativa sin navegador: `export OPENAI_API_KEY=...`.

## Claude (subscripción, vía Claude Code)

`claude-bridge` no usa una API key: presta la cuota de tu **subscripción de Claude Code**.

```bash
claude                      # dentro:
/login                      # elige tu cuenta (plan Pro o Max)
```

Notas:

- El bootstrap instala `@anthropic-ai/claude-code` cuando el perfil lo requiere.
- Consume cuota de subscripción, no facturación por API (el propio paquete lo advierte).
- `provider.plan` (`pro` por defecto) sólo importa si usas modelos plan-gated
  (`opus-4-6`, `sonnet-4-6`). La matriz por defecto usa `sonnet-5-5`/`opus-5-5`/`haiku-5-5`,
  que dan 1M de contexto sin importar el plan. Si algún día usas `opus-4-6`:
  `{ "provider": { "plan": "max" } }` en `~/.pi/agent/claude-bridge.json`.
- Sin subscripción no hay perfil `claude`; usa `full-openai` o `full-deepseek`.

## Lo que el bootstrap nunca hace

- Copiar `auth.json` de otra máquina (el refresh de OAuth puede invalidar el token del origen).
- Guardar secretos en el repo: `config/` no contiene credenciales y `.gitignore` cubre lo local.
- Reutilizar `~/.pi/agent/models.json` de otra persona (`llm-gateway` es configuración privada).

## Problemas típicos

| Síntoma | Causa | Arreglo |
|---|---|---|
| `openai: sin credenciales` | `/login` no se completó | `pi` → `/login` → `pi-bootstrap verify` |
| `claude: sin credenciales` | Claude Code no logueado | `claude` → `/login` |
| `claude-bridge` no aparece | falta el paquete o el binario | `pi install npm:pi-claude-bridge@0.9.3` y `claude --version` |
| modelo inexistente en el perfil | perfil de un proveedor que no tienes | `pi-bootstrap profile full-deepseek` |

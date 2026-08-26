# sketup-mcp

Servidor MCP do **SKET-UP** — cada conta do app tem seu próprio token MCP (estilo GitHub MCP).

Conecte este MCP em qualquer cliente (Notion, etc.) com o token da sua conta e a IA pode
ler e alterar seus projetos em tempo real.

## Endpoints

- `GET /health` — status do serviço
- `POST /mcp` — MCP (Streamable HTTP), auth via `Authorization: Bearer <token>`

## Variáveis de ambiente

- `SUPABASE_URL` — URL do projeto Supabase
- `SUPABASE_KEY` — chave pública (anon/publishable). O acesso é limitado pelo token de cada conta via RPCs `security definer` — nenhuma chave privilegiada fica no servidor.

## Tools MCP

| Tool | Descrição |
| ---- | --------- |
| `whoami` | Testa a vinculação da conta |
| `list_projects` | Lista os projetos da conta |
| `get_project` | Lê um projeto completo (JSON) |
| `save_project` | Cria ou atualiza um projeto |
| `delete_project` | Remove um projeto |

## Deploy (Render)

- Runtime: Node
- Build: `npm install`
- Start: `npm start`

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Configure SUPABASE_URL e SUPABASE_KEY nas variáveis de ambiente.");
  process.exit(1);
}

// Chama as RPCs do Supabase. O acesso é limitado pelo token de cada conta
// (as funções são security definer e só operam nos projetos do dono do token).
async function rpc(name, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Backend recusou a operação (${res.status}). Token MCP inválido?`);
  }
  return body ? JSON.parse(body) : null;
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (typeof req.query.token === "string") return req.query.token;
  return null;
}

function asText(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function createServer(token) {
  const server = new McpServer({ name: "sketup-mcp", version: "1.0.0" });

  server.registerTool(
    "whoami",
    {
      description: "Testa a vinculação MCP da conta e confirma acesso",
      inputSchema: {},
    },
    async () => asText(await rpc("mcp_projects_list", { p_token: token }))
  );

  server.registerTool(
    "list_projects",
    {
      description: "Lista os projetos SKET-UP da conta vinculada",
      inputSchema: {},
    },
    async () => asText(await rpc("mcp_projects_list", { p_token: token }))
  );

  server.registerTool(
    "get_project",
    {
      description: "Lê um projeto completo pelo ID (estrutura, telas, lógica em JSON)",
      inputSchema: { id: z.string().describe("ID do projeto") },
    },
    async ({ id }) => asText(await rpc("mcp_projects_get", { p_token: token, p_id: id }))
  );

  server.registerTool(
    "save_project",
    {
      description: "Cria ou atualiza um projeto. Sem id = cria novo; com id = atualiza.",
      inputSchema: {
        id: z.string().optional().describe("ID do projeto (opcional, para atualizar)"),
        name: z.string().describe("Nome do projeto"),
        data: z.record(z.any()).describe("Conteúdo do projeto em JSON"),
      },
    },
    async ({ id, name, data }) =>
      asText(
        await rpc("mcp_projects_upsert", {
          p_token: token,
          p_id: id ?? null,
          p_name: name,
          p_data: data,
        })
      )
  );

  server.registerTool(
    "delete_project",
    {
      description: "Remove um projeto da conta vinculada",
      inputSchema: { id: z.string().describe("ID do projeto") },
    },
    async ({ id }) =>
      asText({ deleted: await rpc("mcp_projects_delete", { p_token: token, p_id: id }) })
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sketup-mcp", time: new Date().toISOString() });
});

app.post("/mcp", async (req, res) => {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: "Envie o token MCP: Authorization: Bearer <token>" });
    return;
  }
  try {
    const server = createServer(token);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: String(error) });
  }
});

app.get("/mcp", (_req, res) => res.status(405).json({ error: "Modo stateless: use POST" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Modo stateless: use POST" }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`sketup-mcp ouvindo na porta ${port}`));

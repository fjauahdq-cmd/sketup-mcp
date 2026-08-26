import express from "express";
import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Configure SUPABASE_URL e SUPABASE_KEY nas variáveis de ambiente.");
  process.exit(1);
}

// ---- Criptografia compatível com o app (a.a.a.oB) ----
// Arquivos de projeto no disco: Base64(AES/CBC/PKCS5Padding(json, chave=iv="sketchwaresecure"))
const SK_KEY = Buffer.from("sketchwaresecure", "utf8"); // 16 bytes = AES-128

function encryptText(plain) {
  const cipher = crypto.createCipheriv("aes-128-cbc", SK_KEY, SK_KEY);
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
}

function decryptText(content) {
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", SK_KEY, SK_KEY);
    return Buffer.concat([decipher.update(Buffer.from(String(content).trim(), "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null; // não estava criptografado (ex.: projeto antigo em JSON puro)
  }
}

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
    throw new Error(`Backend recusou a operação (${res.status}): ${body.slice(0, 300)}`);
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

const STANDARD_FILES = ["project", "view", "logic", "resource", "library"];

function buildSkeleton(appName, packageName) {
  const scId = String(Date.now()).slice(-9);
  const wsName = appName.replace(/[^A-Za-z0-9]/g, "") || "NewProject";
  const config = {
    my_app_name: appName,
    my_ws_name: wsName,
    my_sc_pkg_name: packageName,
    sc_id: scId,
    sc_ver_code: 1,
    sc_ver_name: "1.0",
    sketchware_ver: 150,
    proj_type: 0,
    custom_icon: false,
    isIconAdaptive: false,
    color_accent: -2634552,
    color_primary: -13447885,
    color_primary_dark: -13615201,
    color_control_highlight: 587202559,
    color_control_normal: -1979711488,
  };
  const files = {};
  for (const [name, content] of Object.entries({
    project: JSON.stringify(config),
    view: JSON.stringify([
      { fileName: "main", fileType: 0, keyboardSetting: 0, orientation: 0, presetName: "", views: [] },
    ]),
    logic: "[]",
    resource: "[]",
    library: "{}",
  })) {
    files[name] = encryptText(content); // gravado criptografado, como o app espera
  }
  return { scId, config, files };
}

// Lê um arquivo do projeto descriptografando quando necessário
function readFilePlain(files, path) {
  const value = files?.[path];
  if (value == null) return null;
  if (typeof value !== "string") return value; // marcador binário etc.
  const plain = decryptText(value);
  return plain ?? value; // se não descriptografar, devolve como está
}

function summarizeView(v) {
  const out = { id: v.id, type: v.type, parent: v.parent };
  const cls = v.classInfo?.className ?? v.classInfo?.a ?? v.classInfo?.b;
  if (cls) out.class = cls;
  if (v.text?.text) out.text = v.text.text;
  return out;
}

function summarizeViews(viewText) {
  try {
    const parsed = JSON.parse(viewText);
    if (Array.isArray(parsed)) {
      return {
        screens: parsed.map((screen) => ({
          screen: screen.fileName ?? screen.name ?? "?",
          orientation: screen.orientation,
          widgetCount: Array.isArray(screen.views) ? screen.views.length : 0,
          views: Array.isArray(screen.views) ? screen.views.map(summarizeView) : [],
        })),
      };
    }
    return { raw: parsed };
  } catch {
    return { raw: viewText, note: "conteúdo bruto (não-JSON)" };
  }
}

const COMPONENTS = [
  { name: "Linear vertical (box)", className: "LinearLayout", kind: "layout", notes: "orientation=vertical" },
  { name: "Linear horizontal", className: "LinearLayout", kind: "layout", notes: "orientation=horizontal" },
  { name: "ScrollView", className: "ScrollView", kind: "layout" },
  { name: "TextView", className: "TextView", kind: "widget" },
  { name: "EditText", className: "EditText", kind: "widget" },
  { name: "Button", className: "Button", kind: "widget" },
  { name: "ImageView", className: "ImageView", kind: "widget" },
  { name: "WebView", className: "WebView", kind: "widget" },
  { name: "Switch", className: "Switch", kind: "widget" },
  { name: "CheckBox", className: "CheckBox", kind: "widget" },
  { name: "RadioButton", className: "RadioButton", kind: "widget" },
  { name: "SeekBar", className: "SeekBar", kind: "widget" },
  { name: "ProgressBar", className: "ProgressBar", kind: "widget" },
  { name: "Spinner", className: "Spinner", kind: "widget" },
  { name: "ListView", className: "ListView", kind: "widget" },
  { name: "CalendarView", className: "CalendarView", kind: "widget" },
  { name: "CardView", className: "androidx.cardview.widget.CardView", kind: "widget" },
  { name: "TabLayout", className: "com.google.android.material.tabs.TabLayout", kind: "widget" },
  { name: "BottomNavigationView", className: "com.google.android.material.bottomnavigation.BottomNavigationView", kind: "widget" },
  { name: "MapView", className: "com.google.android.gms.maps.MapView", kind: "widget" },
  { name: "AdView", className: "com.google.android.gms.ads.AdView", kind: "widget" },
];

async function getProject(token, id) {
  return rpc("mcp_projects_get", { p_token: token, p_id: id });
}

async function saveProjectData(token, row, newData) {
  return rpc("mcp_projects_upsert", {
    p_token: token,
    p_id: row.id,
    p_name: row.name,
    p_data: newData,
    p_sc_id: newData.sc_id ?? null,
  });
}

function createServer(token) {
  const server = new McpServer({ name: "sketup-mcp", version: "2.1.0" });

  server.registerTool(
    "list_projects",
    { description: "Lista os projetos da conta vinculada (id, sc_id, pacote, versão, atualização)", inputSchema: {} },
    async () => asText(await rpc("mcp_projects_list", { p_token: token }))
  );

  server.registerTool(
    "get_project",
    {
      description: "Lê um projeto completo: config (nome, pacote, cores) + arquivos (já descriptografados)",
      inputSchema: { id: z.string().describe("ID do projeto") },
    },
    async ({ id }) => {
      const row = await getProject(token, id);
      const files = row?.data?.files ?? {};
      const plainFiles = {};
      for (const path of Object.keys(files)) {
        plainFiles[path] = readFilePlain(files, path);
      }
      return asText({ ...row, data: { ...(row.data ?? {}), files: plainFiles } });
    }
  );

  server.registerTool(
    "create_project",
    {
      description: "Cria um projeto novo válido (esqueleto com tela main, arquivos criptografados). Aparece no app após o sync.",
      inputSchema: {
        app_name: z.string().describe("Nome do app (ex.: Minha Lista)"),
        package_name: z.string().describe("Pacote (ex.: com.meuapp.lista)"),
      },
    },
    async ({ app_name, package_name }) => {
      const { scId, config, files } = buildSkeleton(app_name, package_name);
      const row = await rpc("mcp_projects_upsert", {
        p_token: token,
        p_id: null,
        p_name: app_name,
        p_data: { sc_id: scId, config, files },
        p_sc_id: scId,
      });
      return asText({ created: row, note: "Projeto criado na nuvem. No app, rode a sincronização para baixar." });
    }
  );

  server.registerTool(
    "get_file",
    {
      description: "Lê um arquivo do projeto (view, logic, resource, library, project...) já descriptografado",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: view"),
      },
    },
    async ({ project_id, path }) => {
      const row = await getProject(token, project_id);
      const files = row?.data?.files ?? {};
      if (!(path in files)) {
        return asText({ error: "arquivo não encontrado", available: Object.keys(files) });
      }
      return asText({ path, content: readFilePlain(files, path) });
    }
  );

  server.registerTool(
    "save_file",
    {
      description: "Grava um arquivo do projeto (texto puro — o servidor criptografa). Marca o projeto como atualizado para o sync.",
      inputSchema: {
        project_id: z.string(),
        path: z.string(),
        content: z.string().describe("Conteúdo em texto puro (JSON)"),
      },
    },
    async ({ project_id, path, content }) => {
      const row = await getProject(token, project_id);
      const data = row?.data ?? {};
      const files = { ...(data.files ?? {}), [path]: encryptText(content) };
      const newData = { ...data, files };
      const saved = await saveProjectData(token, row, newData);
      return asText({ saved: true, updated_at: saved.updated_at, path });
    }
  );

  server.registerTool(
    "get_views",
    {
      description: "Resume as telas e widgets (views) do projeto: id, tipo, classe, texto, hierarquia",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const row = await getProject(token, project_id);
      const viewText = readFilePlain(row?.data?.files, "view");
      if (!viewText) return asText({ error: "projeto sem arquivo view" });
      return asText(summarizeViews(viewText));
    }
  );

  server.registerTool(
    "get_components_catalog",
    {
      description: "Catálogo dos componentes/widgets disponíveis no SKET-UP (Linear/box, TextView, Button, etc.)",
      inputSchema: {},
    },
    async () => asText({ components: COMPONENTS, standardFiles: STANDARD_FILES })
  );

  server.registerTool(
    "delete_project",
    {
      description: "Remove um projeto da conta vinculada (nuvem; o aparelho mantém a cópia local até novo sync)",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asText({ deleted: await rpc("mcp_projects_delete", { p_token: token, p_id: id }) })
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sketup-mcp", version: "2.1.0", time: new Date().toISOString() });
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
app.listen(port, () => console.log(`sketup-mcp v2.1 ouvindo na porta ${port}`));

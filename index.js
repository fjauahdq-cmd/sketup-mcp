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

// ---- Formato de arquivo do app ----
// Cada arquivo de projeto é binário: AES-128-CBC(texto UTF-8), chave = IV = "sketchwaresecure".
// Na nuvem os arquivos trafegam como { "__b64": "<base64 dos bytes criptografados>" }.
const SK_KEY = Buffer.from("sketchwaresecure", "utf8");

function encryptFile(plain) {
  const cipher = crypto.createCipheriv("aes-128-cbc", SK_KEY, SK_KEY);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { __b64: encrypted.toString("base64") };
}

function decryptFile(value) {
  try {
    if (value && typeof value === "object" && typeof value.__b64 === "string") {
      const raw = Buffer.from(value.__b64, "base64");
      const decipher = crypto.createDecipheriv("aes-128-cbc", SK_KEY, SK_KEY);
      return Buffer.concat([decipher.update(raw), decipher.final()]).toString("utf8");
    }
    if (typeof value === "string") return value; // legado em texto puro
    return value;
  } catch {
    return typeof value === "string" ? value : null;
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

// ---- Estrutura de um projeto SKET-UP ----
// files: { "list/project": meta criptografada, "data/view": telas, "data/logic": lógica,
//          "data/file": declaração de telas, "data/resource": recursos, "data/library": libs }

const STANDARD_FILES = ["list/project", "data/view", "data/logic", "data/file", "data/resource", "data/library"];

const VIEW_TYPES = {
  0: "LinearLayout", 1: "RelativeLayout", 2: "HScrollView", 3: "Button", 4: "TextView",
  5: "EditText", 6: "ImageView", 7: "WebView", 8: "ProgressBar", 9: "ListView",
  10: "Spinner", 11: "CheckBox", 12: "VScrollView", 13: "Switch", 14: "SeekBar",
  15: "CalendarView", 16: "FAB", 17: "AdView",
};

function rootLinearView() {
  return {
    adSize: "", adUnitId: "", alpha: 1.0, checked: 0, choiceMode: 0, clickable: 1,
    customView: "", dividerHeight: 1, enabled: 1, firstDayOfWeek: 1, id: "linear1",
    image: { rotate: 0, scaleType: "CENTER" }, indeterminate: "false", index: 0,
    layout: {
      backgroundColor: 16777215, gravity: 0, height: -1, layoutGravity: 0,
      marginBottom: 0, marginLeft: 0, marginRight: 0, marginTop: 0, orientation: 1,
      paddingBottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 8, weight: 0,
      weightSum: 0, width: -1,
    },
    max: 100, parent: "", parentType: 0, preId: "", preIndex: 0, preParentType: 0,
    progress: 0, progressStyle: "?android:progressBarStyle", scaleX: 1.0, scaleY: 1.0,
    spinnerMode: 1,
    text: {
      hint: "", hintColor: -10453621, imeOption: 1, inputType: 1, line: 0,
      singleLine: 0, text: "", textColor: -16777216, textFont: "default_font",
      textSize: 12, textType: 0,
    },
    translationX: 0.0, translationY: 0.0, type: 0,
  };
}

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

  const libOff = JSON.stringify({ adUnits: [], data: "", libType: 0, reserved1: "", reserved2: "", reserved3: "", testDevices: [], useYn: "N" });
  const libCompat = JSON.stringify({ adUnits: [], data: "", libType: 0, reserved1: "", reserved2: "", reserved3: "", testDevices: [], useYn: "Y" });

  const plain = {
    "list/project": JSON.stringify(config),
    "data/file": `@activity\n${JSON.stringify({ fileName: "main", fileType: 0, keyboardSetting: 0, options: 1, orientation: 0, theme: 0 })}\n@customview\n`,
    "data/view": `@main.xml\n${JSON.stringify(rootLinearView())}`,
    "data/logic": "@main.java_var\n\n@main.java_list\n\n@main.java_components\n\n@main.java_events\n\n@main.java_func",
    "data/resource": "[]",
    "data/library": `@firebaseDB\n${libOff}\n@compat\n${libCompat}\n@admob\n${libOff}\n@googleMap\n${libOff}`,
  };

  const files = {};
  for (const [path, content] of Object.entries(plain)) {
    files[path] = encryptFile(content);
  }
  return { scId, config, files };
}

function summarizeViews(viewText) {
  const lines = String(viewText).split("\n");
  const screens = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("@")) {
      const dot = line.indexOf(".");
      current = {
        screen: dot > 0 ? line.slice(1, dot) : line.slice(1),
        kind: dot > 0 ? line.slice(dot + 1) : "",
        widgets: [],
      };
      screens.push(current);
      continue;
    }
    if (!line.trim() || !current) continue;
    try {
      const v = JSON.parse(line);
      const widget = { id: v.id, type: VIEW_TYPES[v.type] ?? v.type, parent: v.parent };
      if (v.text?.text) widget.text = v.text.text;
      current.widgets.push(widget);
    } catch {
      current.widgets.push({ raw: line.slice(0, 120) });
    }
  }
  return { screens };
}

const COMPONENTS = [
  { type: 0, name: "Linear (box) vertical/horizontal", className: "LinearLayout", kind: "layout" },
  { type: 1, name: "RelativeLayout", className: "RelativeLayout", kind: "layout" },
  { type: 2, name: "HScrollView", className: "HorizontalScrollView", kind: "layout" },
  { type: 12, name: "VScrollView", className: "ScrollView", kind: "layout" },
  { type: 3, name: "Button", className: "Button", kind: "widget" },
  { type: 4, name: "TextView", className: "TextView", kind: "widget" },
  { type: 5, name: "EditText", className: "EditText", kind: "widget" },
  { type: 6, name: "ImageView", className: "ImageView", kind: "widget" },
  { type: 7, name: "WebView", className: "WebView", kind: "widget" },
  { type: 8, name: "ProgressBar", className: "ProgressBar", kind: "widget" },
  { type: 9, name: "ListView", className: "ListView", kind: "widget" },
  { type: 10, name: "Spinner", className: "Spinner", kind: "widget" },
  { type: 11, name: "CheckBox", className: "CheckBox", kind: "widget" },
  { type: 13, name: "Switch", className: "Switch", kind: "widget" },
  { type: 14, name: "SeekBar", className: "SeekBar", kind: "widget" },
  { type: 15, name: "CalendarView", className: "CalendarView", kind: "widget" },
  { type: 16, name: "FAB (botão flutuante)", className: "FloatingActionButton", kind: "widget" },
  { type: 17, name: "AdView", className: "com.google.android.gms.ads.AdView", kind: "widget" },
];

async function getProject(token, id) {
  return rpc("mcp_projects_get", { p_token: token, p_id: id });
}

function createServer(token) {
  const server = new McpServer({ name: "sketup-mcp", version: "2.2.0" });

  server.registerTool(
    "list_projects",
    { description: "Lista os projetos da conta vinculada (id, sc_id, pacote, versão, atualização)", inputSchema: {} },
    async () => asText(await rpc("mcp_projects_list", { p_token: token }))
  );

  server.registerTool(
    "get_project",
    {
      description: "Lê um projeto completo: config + arquivos descriptografados (list/project, data/view, data/logic...)",
      inputSchema: { id: z.string().describe("ID do projeto") },
    },
    async ({ id }) => {
      const row = await getProject(token, id);
      const files = row?.data?.files ?? {};
      const plainFiles = {};
      for (const path of Object.keys(files)) {
        plainFiles[path] = decryptFile(files[path]);
      }
      return asText({ ...row, data: { ...(row.data ?? {}), files: plainFiles } });
    }
  );

  server.registerTool(
    "create_project",
    {
      description: "Cria um projeto novo válido (tela main com Linear raiz, arquivos criptografados no formato do app). Aparece no app após o sync.",
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
      return asText({ created: { id: row.id, name: row.name, sc_id: row.sc_id }, note: "Projeto criado na nuvem. Abra o app para sincronizar e baixar." });
    }
  );

  server.registerTool(
    "get_file",
    {
      description: "Lê um arquivo do projeto (list/project, data/view, data/logic, data/file, data/resource, data/library) descriptografado",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: data/view"),
      },
    },
    async ({ project_id, path }) => {
      const row = await getProject(token, project_id);
      const files = row?.data?.files ?? {};
      if (!(path in files)) {
        return asText({ error: "arquivo não encontrado", available: Object.keys(files) });
      }
      return asText({ path, content: decryptFile(files[path]) });
    }
  );

  server.registerTool(
    "save_file",
    {
      description: "Grava um arquivo do projeto (texto puro — o servidor criptografa no formato do app). Marca o projeto como atualizado para o sync.",
      inputSchema: {
        project_id: z.string(),
        path: z.string().describe("ex.: data/view"),
        content: z.string().describe("Conteúdo em texto puro (formato do arquivo do app)"),
      },
    },
    async ({ project_id, path, content }) => {
      const row = await getProject(token, project_id);
      const data = row?.data ?? {};
      const files = { ...(data.files ?? {}), [path]: encryptFile(content) };
      const newData = { ...data, files };
      const saved = await rpc("mcp_projects_upsert", {
        p_token: token,
        p_id: row.id,
        p_name: row.name,
        p_data: newData,
        p_sc_id: newData.sc_id ?? null,
      });
      return asText({ saved: true, updated_at: saved.updated_at, path });
    }
  );

  server.registerTool(
    "get_views",
    {
      description: "Resume as telas e widgets do projeto (seções @tela.xml): id, tipo, pai, texto",
      inputSchema: { project_id: z.string() },
    },
    async ({ project_id }) => {
      const row = await getProject(token, project_id);
      const viewText = decryptFile(row?.data?.files?.["data/view"]);
      if (!viewText) return asText({ error: "projeto sem arquivo data/view" });
      return asText(summarizeViews(viewText));
    }
  );

  server.registerTool(
    "get_components_catalog",
    {
      description: "Catálogo dos widgets/layouts do SKET-UP com o type numérico (0=Linear/box, 3=Button, 4=TextView...)",
      inputSchema: {},
    },
    async () => asText({ components: COMPONENTS, standardFiles: STANDARD_FILES })
  );

  server.registerTool(
    "delete_project",
    {
      description: "Remove um projeto da conta vinculada (nuvem; o aparelho mantém a cópia local)",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => asText({ deleted: await rpc("mcp_projects_delete", { p_token: token, p_id: id }) })
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sketup-mcp", version: "2.2.0", time: new Date().toISOString() });
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
app.listen(port, () => console.log(`sketup-mcp v2.2 ouvindo na porta ${port}`));

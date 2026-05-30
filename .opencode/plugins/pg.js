/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills path and provides the pg_dispatch tool
 * for dispatching sub-agents defined in agent-defs/.
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");

/** Parse nested YAML by indentation (covers pg-spec/config.yaml format). */
function parseYaml(text) {
  const lines = text.split("\n");
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const raw of lines) {
    const trimmed = raw.trimEnd();
    if (!trimmed.trim() || trimmed.trim().startsWith("#")) continue;
    const indent = trimmed.search(/\S|$/);
    const content = trimmed.trim();
    const colonIdx = content.indexOf(":");
    if (colonIdx < 0) continue;
    const key = content.slice(0, colonIdx).trim();
    const val = content.slice(colonIdx + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    let current = stack[stack.length - 1].obj;

    if (val === "") {
      const child = {};
      current[key] = child;
      stack.push({ indent, obj: child });
    } else {
      current[key] = val;
    }
  }
  return root;
}

/** Read pg-spec/config.yaml from project. */
function readProjectConfig(projectDir) {
  const configPath = path.join(projectDir, "pg-spec", "config.yaml");
  if (!fs.existsSync(configPath)) return {};
  return parseYaml(fs.readFileSync(configPath, "utf-8"));
}

/** Read model config. */
function readModelConfig(projectDir) {
  const modelPath = path.join(projectDir, "pg-spec", "config-model.yaml");
  if (!fs.existsSync(modelPath)) return {};
  const models = {};
  for (const line of fs.readFileSync(modelPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i > 0) { const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim(); if (k && v) models[k] = v; }
  }
  return models;
}

/** Convert agent frontmatter permissions to tools map. */
function frontmatterToTools(fm) {
  const t = {};
  if (fm.edit === "allow")     { t.Edit = true; t.Write = true; }
  if (fm.bash === "allow")     { t.Bash = true; }
  if (fm.read === "allow")     { t.Read = true; t.Glob = true; t.Grep = true; }
  if (fm.list === "allow")     { t.List = true; }
  if (fm.task === "allow")     { t.Task = true; }
  return t;
}

/** Poll session status until completed. */
async function waitForCompletion(sessionID, client) {
  for (;;) {
    const res = await client.session.status({ path: { id: sessionID } });
    const status = res.data?.[sessionID] || res.data;
    const type = status?.type || status?.status;
    if (type === "idle") return;
    if (type === "error" || type === "aborted") {
      throw new Error(`Session ${sessionID} ended with status: ${type}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Read the last assistant text response. */
async function getResultText(sessionID, client) {
  const res = await client.session.messages({ path: { id: sessionID }, query: { limit: 50 } });
  const messages = res.data?.messages || res.data || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts || []) {
      if (part.type === "text" && part.text) return part.text;
    }
  }
  return "(no text response from agent)";
}

/** Initialize pg-spec/ project files if missing. */
function ensureProjectFiles(projectDir) {
  const pgSpecDir = path.join(projectDir, "pg-spec");
  if (!fs.existsSync(pgSpecDir)) return;
  const files = [
    [".gitignore", "config-model.yaml\n"],
    ["config-model.yaml", path.join(pgRoot, "scripts", "config-model.default.yaml")],
    ["config.yaml", path.join(pgRoot, "scripts", "config.default.yaml")],
  ];
  for (const [name, source] of files) {
    const dest = path.join(pgSpecDir, name);
    if (!fs.existsSync(dest)) {
      if (typeof source === "string" && source.endsWith(".yaml")) {
        if (fs.existsSync(source)) fs.copyFileSync(source, dest);
      } else {
        fs.writeFileSync(dest, source, "utf-8");
      }
    }
  }
}

export const PgSkillsPlugin = async (input) => {
  const projectDir = input.worktree || input.directory;
  const skillsDir = path.join(pgRoot, "skills");
  const agentDefsDir = path.join(pgRoot, "agent-defs");
  const client = input.client;

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
      ensureProjectFiles(projectDir);
    },

    tool: {
      pg_dispatch: {
        description:
          "Dispatch a pg-* sub-agent. Reads the agent definition from the pg-skills package, auto-injects project config from pg-spec/config.yaml, and uses model config from pg-spec/config-model.yaml.",
        args: {
          agent_name: { type: "string", description: "Agent identifier, e.g. 'pg-fix-issue/coder' or 'pg-apply-change/backend-dev'" },
          task: { type: "string", description: "The task description for the agent to execute" },
        },
        execute: async (args, ctx) => {
          const agentParts = args.agent_name.split("/");
          const agentFile = path.join(agentDefsDir, ...agentParts) + ".md";
          if (!fs.existsSync(agentFile)) {
            return `Error: Agent "${args.agent_name}" not found`;
          }

          const content = fs.readFileSync(agentFile, "utf-8");
          const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
          const frontmatter = {};
          if (match) {
            for (const line of match[1].split("\n")) {
              const idx = line.indexOf(":");
              if (idx > 0) frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
          }
          const agentPrompt = (match ? match[2] : content).trim();

          // Model: config-model.yaml > frontmatter
          const modelConfig = readModelConfig(projectDir);
          const modelStr = modelConfig[args.agent_name] || frontmatter.model || undefined;

          let model;
          if (modelStr) {
            const slashIdx = modelStr.indexOf("/");
            if (slashIdx > 0) {
              model = { providerID: modelStr.slice(0, slashIdx), modelID: modelStr.slice(slashIdx + 1) };
            } else {
              model = { providerID: "default", modelID: modelStr };
            }
          }

          // Config context
          const projectConfig = readProjectConfig(projectDir);
          const configBlock = Object.keys(projectConfig).length
            ? "\n\n## Project Config\n" + JSON.stringify(projectConfig, null, 2)
            : "";

          const taskText = [configBlock, "\n\n## Task\n" + args.task].join("\n");

          // Create child session
          const createRes = await client.session.create({
            body: { parentID: ctx.sessionID, title: `pg:${args.agent_name}` },
            query: { directory: projectDir },
          });
          const sessionID = createRes.data?.id || createRes.data?.sessionID;
          if (!sessionID) return `Error: Failed to create session for "${args.agent_name}"`;

          // Send prompt async with system, tools, and model
          if (typeof client.session.promptAsync === "function") {
            const promptBody = {
              system: agentPrompt,
              agent: args.agent_name,
              tools: frontmatterToTools(frontmatter),
              parts: [{ type: "text", text: taskText }],
            };
            if (model) promptBody.model = model;
            await client.session.promptAsync({ path: { id: sessionID }, body: promptBody });
          }

          // Wait for completion and read result
          await waitForCompletion(sessionID, client);
          const resultText = await getResultText(sessionID, client);

          const modelLabel = model ? `${model.providerID}/${model.modelID}` : "(default)";
          return `${resultText}\n\n<task_metadata>\nsession_id: ${sessionID}\nagent: ${args.agent_name}\nmodel: ${modelLabel}\n</task_metadata>`;
        },
      },
    },
  };
};

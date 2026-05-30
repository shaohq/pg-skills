/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills path and provides the pg_dispatch tool
 * for dispatching sub-agents defined in agents/.
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");

/** Parse nested YAML by indentation (covers pg-spec/config.yaml format). */
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
  const agentsDir = path.join(pgRoot, "agents");
  const client = input.client;

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
      config.agents = config.agents || {};
      config.agents.paths = config.agents.paths || [];
      if (!config.agents.paths.includes(agentsDir)) {
        config.agents.paths.push(agentsDir);
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
          // Read config-model.yaml for model override
          const modelStr = readModelConfig(projectDir)[args.agent_name];
          let model;
          if (modelStr) {
            const slashIdx = modelStr.indexOf("/");
            model = slashIdx > 0
              ? { providerID: modelStr.slice(0, slashIdx), modelID: modelStr.slice(slashIdx + 1) }
              : { providerID: "default", modelID: modelStr };
          }

          // Send subtask part to parent session — server handles agent dispatch
          const subtaskPart = {
            type: "subtask",
            prompt: args.task,
            description: `Running ${args.agent_name}`,
            agent: args.agent_name,
          };
          if (model) subtaskPart.model = model;

          const res = await client.session.prompt({
            path: { id: ctx.sessionID },
            body: { parts: [subtaskPart] },
          });

          // Extract child sessionID from the response
          const parts = res.data?.parts || [];
          let sessionID;
          for (const p of parts) {
            if (p.type === "subtask" && p.sessionID) { sessionID = p.sessionID; break; }
          }
          if (!sessionID) {
            return `Error: Agent "${args.agent_name}" dispatch failed — no session created`;
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

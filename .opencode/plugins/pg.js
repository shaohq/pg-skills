/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills path and provides the pg_dispatch tool
 * for dispatching sub-agents defined in agent-defs/.
 */
import path from "path";
import fs from "fs";
import { tool } from "@opencode-ai/plugin";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");

/** Parse simple YAML-like flat key: value pairs. */
function parseSimpleYaml(content) {
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && value) result[key] = value;
    }
  }
  return result;
}

/** Read model config from pg-spec/config-model.yaml. */
function readModelConfig(projectDir) {
  const configPath = path.join(projectDir, "pg-spec", "config-model.yaml");
  if (!fs.existsSync(configPath)) return {};
  return parseSimpleYaml(fs.readFileSync(configPath, "utf-8"));
}

/** Poll session status until completed or timeout. */
async function waitForCompletion(sessionID, client, maxSec = 120) {
  for (let i = 0; i < maxSec; i++) {
    const res = await client.session.status({ path: { id: sessionID } });
    const data = res.data;
    if (data.status === "completed" || data.status === "idle") return data;
    if (data.status === "aborted" || data.status === "error") {
      throw new Error(`Session ${sessionID} ended with status: ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Session ${sessionID} timed out after ${maxSec}s`);
}

/** Read the last assistant text response from a session. */
async function getResultText(sessionID, client) {
  const res = await client.session.messages({
    path: { id: sessionID },
    query: { limit: 50 },
  });
  const messages = res.data?.messages || res.data || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts || [];
    for (let j = parts.length - 1; j >= 0; j--) {
      if (parts[j].type === "text" && parts[j].text) {
        return parts[j].text;
      }
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
      pg_dispatch: tool({
        description:
          "Dispatch a pg-* sub-agent. Reads the agent definition from the pg-skills package's agent-defs/ directory and model config from pg-spec/config-model.yaml.",
        args: {
          agent_name: tool.schema.string().describe(
            "Agent identifier, e.g. 'pg-fix-issue/coder' or 'pg-apply-change/backend-dev'",
          ),
          task: tool.schema.string().describe(
            "The task description for the agent to execute",
          ),
        },
        async execute(args, ctx) {
          // Resolve agent definition file
          const agentParts = args.agent_name.split("/");
          const agentFile = path.join(agentDefsDir, ...agentParts) + ".md";
          if (!fs.existsSync(agentFile)) {
            return `Error: Agent "${args.agent_name}" not found at ${agentFile}`;
          }

          // Read agent .md and parse frontmatter
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

          // Resolve model: config-model.yaml > frontmatter > undefined
          const modelConfig = readModelConfig(projectDir);
          const model = modelConfig[args.agent_name] || frontmatter.model || undefined;

          // Build full prompt
          const fullPrompt = [agentPrompt, "\n\n## Task\n" + args.task].join("\n");

          // Create child session
          const createRes = await ctx.client.session.create({
            body: {
              parentID: ctx.sessionID,
              title: `pg:${args.agent_name}`,
            },
            query: { directory: projectDir },
          });
          const sessionID = createRes.data?.id || createRes.data?.sessionID;
          if (!sessionID) {
            return `Error: Failed to create session for "${args.agent_name}"`;
          }

          // Send prompt with model
          if (typeof ctx.client.session.prompt === "function") {
            const promptBody = { parts: [{ type: "text", text: fullPrompt }] };
            if (model) promptBody.model = { id: model };
            await ctx.client.session.prompt({ path: { id: sessionID }, body: promptBody });
          }

          // Wait for completion and read result
          await waitForCompletion(sessionID, ctx.client);
          const resultText = await getResultText(sessionID, ctx.client);

          return `${resultText}\n\n<task_metadata>\nsession_id: ${sessionID}\nagent: ${args.agent_name}\nmodel: ${model || "(default)"}\n</task_metadata>`;
        },
      }),
    },
  };
};

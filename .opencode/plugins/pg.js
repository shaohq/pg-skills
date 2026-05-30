/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills path and provides the pg_dispatch_agent tool
 * for dispatching sub-agents defined in the pg-skills package.
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");

/** Parse frontmatter from an agent .md file. */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter: fm, body: match[2] };
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

/** Read child session messages and return the last assistant response. */
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

export const PgSkillsPlugin = async () => {
  const skillsDir = path.join(pgRoot, "skills");

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    tool: {
      pg_dispatch_agent: {
        description:
          "Dispatch a pg-* sub-agent. Reads the agent's .md definition from the pg-skills package, creates a child session, and returns the result.",
        args: {
          agent_name: {
            type: "string",
            description:
              "Agent identifier, e.g. 'pg-fix-issue/coder' or 'pg-apply-change/backend-dev'",
          },
          task: {
            type: "string",
            description: "The task description for the agent to execute",
          },
          context: {
            type: "string",
            description:
              "JSON string with config values like {scriptsDir, backend, frontend}",
          },
        },
        execute: async (args, ctx) => {
          const agentFile = path.join(pgRoot, "agents", ...args.agent_name.split("/")) + ".md";
          if (!fs.existsSync(agentFile)) {
            return `Error: Agent "${args.agent_name}" not found at ${agentFile}`;
          }

          const content = fs.readFileSync(agentFile, "utf-8");
          const { frontmatter, body } = parseFrontmatter(content);
          const agentPrompt = body.trim();

          // Parse optional context
          let configContext = "";
          if (args.context) {
            try {
              const parsed = JSON.parse(args.context);
              configContext = "\n\n## Config Context\n" + JSON.stringify(parsed, null, 2);
            } catch {
              configContext = "\n\n## Config Context\n" + args.context;
            }
          }

          const fullPrompt = [
            agentPrompt,
            configContext,
            "\n\n## Task\n" + args.task,
          ].join("\n");

          // Resolve parent session directory
          const directory = ctx.worktree || ctx.directory;

          // Create child session
          const createRes = await ctx.client.session.create({
            body: {
              parentID: ctx.sessionID,
              title: `pg:${args.agent_name}`,
            },
            query: { directory },
          });
          const sessionID = createRes.data?.id || createRes.data?.sessionID;

          if (!sessionID) {
            return `Error: Failed to create session for agent "${args.agent_name}"`;
          }

          // Send prompt if session.prompt is available (OpenCode native)
          if (typeof ctx.client.session.prompt === "function") {
            const promptBody = {
              parts: [{ type: "text", text: fullPrompt }],
            };
            if (frontmatter.model) {
              promptBody.model = { id: frontmatter.model };
            }
            await ctx.client.session.prompt({
              path: { id: sessionID },
              body: promptBody,
            });
          }

          // Wait for completion
          await waitForCompletion(sessionID, ctx.client);

          // Read result
          const resultText = await getResultText(sessionID, ctx.client);

          return `${resultText}\n\n<task_metadata>\nsession_id: ${sessionID}\nagent: ${args.agent_name}\n</task_metadata>`;
        },
      },
    },
  };
};

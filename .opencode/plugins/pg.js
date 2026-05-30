/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills and agents directories
 * so they are auto-discovered by opencode.
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");
const skillsDir = path.join(pgRoot, "skills");
const agentsDir = path.join(pgRoot, "agents");

export const PgSkillsPlugin = async () => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);

      config.agents = config.agents || {};
      config.agents.paths = config.agents.paths || [];
      if (!config.agents.paths.includes(agentsDir)) config.agents.paths.push(agentsDir);
    },
  };
};

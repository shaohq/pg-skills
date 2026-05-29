/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills, agents, and commands directories
 * so they are auto-discovered by OpenCode.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, '../..');

export const PgPlugin = async () => {
  const dirs = {
    skills: path.join(pgRoot, 'skills'),
    agents: path.join(pgRoot, 'agents'),
    commands: path.join(pgRoot, 'commands'),
  };

  return {
    config: async (config) => {
      // Skills
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(dirs.skills)) {
        config.skills.paths.push(dirs.skills);
      }
      // Agents
      config.agents = config.agents || {};
      config.agents.paths = config.agents.paths || [];
      if (!config.agents.paths.includes(dirs.agents)) {
        config.agents.paths.push(dirs.agents);
      }
      // Commands
      config.commands = config.commands || {};
      config.commands.paths = config.commands.paths || [];
      if (!config.commands.paths.includes(dirs.commands)) {
        config.commands.paths.push(dirs.commands);
      }
    },
  };
};

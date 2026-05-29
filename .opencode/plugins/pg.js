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
    skills   : path.join(pgRoot, 'skills'),
    agents   : path.join(pgRoot, 'agents'),
    commands : path.join(pgRoot, 'commands'),
    scripts  : path.join(pgRoot, '.opencode', 'scripts'),
  };

  return {
    config: async (config) => {
      for (const key of ['skills', 'agents', 'commands', 'scripts']) {
        config[key] = config[key] || {};
        config[key].paths = config[key].paths || [];
        if (!config[key].paths.includes(dirs[key])) {
          config[key].paths.push(dirs[key]);
        }
      }
    },
  };
};

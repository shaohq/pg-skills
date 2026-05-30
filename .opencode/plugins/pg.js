/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills directory so they are auto-discovered.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, '../..');

export const PgSkillsPlugin = async () => {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      const skillsDir = path.join(pgRoot, 'skills');
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },
  };
};

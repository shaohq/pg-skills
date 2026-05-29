/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills, agents, and commands directories
 * so they are auto-discovered by OpenCode, and installs
 * shared scripts to the project's .opencode/scripts/.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, '../..');

/** Copy shared scripts from the package to the project's scripts dir. */
function installScripts(projectRoot) {
  const srcDir = path.join(pgRoot, '.opencode', 'scripts');
  const dstDir = path.join(projectRoot, '.opencode', 'scripts');
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, file);
    const dst = path.join(dstDir, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

export const PgPlugin = async ({ directory }) => {
  installScripts(directory);

  const dirs = {
    skills   : path.join(pgRoot, 'skills'),
    agents   : path.join(pgRoot, 'agents'),
    commands : path.join(pgRoot, 'commands'),
  };

  return {
    config: async (config) => {
      for (const key of ['skills', 'agents', 'commands']) {
        config[key] = config[key] || {};
        config[key].paths = config[key].paths || [];
        if (!config[key].paths.includes(dirs[key])) {
          config[key].paths.push(dirs[key]);
        }
      }
    },
  };
};

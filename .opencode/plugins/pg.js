/**
 * PG-Skills plugin for OpenCode
 *
 * Installs pg-* agents to ~/.config/opencode/agents/ for global availability.
 * Registers pg-* skills path for auto-discovery.
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");

function installAgents() {
  const srcDir = path.join(pgRoot, "agents");
  const dstDir = path.join(os.homedir(), ".config", "opencode", "agents");

  if (!fs.existsSync(srcDir)) return;

  // Copy all agent .md files, maintaining subdirectory structure
  for (const entry of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    if (fs.statSync(src).isDirectory()) {
      // e.g. pg-apply-change/ — copy all .md inside
      const subDst = path.join(dstDir, entry);
      fs.mkdirSync(subDst, { recursive: true });
      for (const file of fs.readdirSync(src)) {
        if (file.endsWith(".md")) {
          fs.copyFileSync(path.join(src, file), path.join(subDst, file));
        }
      }
    } else if (entry.endsWith(".md")) {
      // e.g. pg-manager.md
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, path.join(dstDir, entry));
    }
  }
}

export const PgSkillsPlugin = async () => {
  installAgents();

  const skillsDir = path.join(pgRoot, "skills");
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },
  };
};

/**
 * PG-Skills plugin for OpenCode
 *
 * Registers pg-* skills path for auto-discovery.
 * Agents and commands are auto-discovered from the plugin
 * package by opencode's built-in mechanism.
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pgRoot = path.resolve(__dirname, "../..");

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

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
      ensureProjectFiles(projectDir);
    },
  };
};

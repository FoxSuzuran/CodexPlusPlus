import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

function preserveUnchangedOutput(): Plugin {
  let outputDir: string;
  const snapshot = () => {
    const files = new Map<string, { content: Buffer; atime: Date; mtime: Date }>();
    if (!fs.existsSync(outputDir)) return files;
    for (const name of fs.readdirSync(outputDir, { recursive: true })) {
      const file = path.join(outputDir, name);
      const stat = fs.lstatSync(file);
      if (stat.isFile()) {
        files.set(file, { content: fs.readFileSync(file), atime: stat.atime, mtime: stat.mtime });
      }
    }
    return files;
  };
  let previous: ReturnType<typeof snapshot>;
  return {
    name: "preserve-unchanged-output",
    apply: "build",
    configResolved(config) {
      outputDir = path.resolve(config.root, config.build.outDir);
    },
    buildStart() {
      previous = snapshot();
    },
    writeBundle() {
      const current = snapshot();
      // 仅整个产物目录内容相同时恢复时间戳，避免无效 Rust 重编；增删文件也必须触发重建。
      if (current.size !== previous.size) return;
      for (const [file, { content }] of current) {
        if (!previous.get(file)?.content.equals(content)) return;
      }
      for (const [file, { atime, mtime }] of previous) fs.utimesSync(file, atime, mtime);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preserveUnchangedOutput()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});

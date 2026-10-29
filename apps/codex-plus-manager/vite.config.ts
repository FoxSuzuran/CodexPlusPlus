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
  build: {
    // 显式钉住构建目标（#2753）：macOS 上用的是系统自带的 WebKit，最低支持的 macOS 12 出厂是 15.0 版，
    // 旧 Intel Mac 常年停在 15.x。不写的话跟着 Vite 默认值走，升级 Vite 后默认目标会抬高到更新的浏览器基线。
    // safari14 是能落到的最低一档：代码里有 BigInt（模型窗口换算），14 以下没有 BigInt，降语法也救不回来。
    // 运行时 API（Object.hasOwn、Array.prototype.at、<dialog>）构建降不了，在 src/legacy-webkit.ts 里兜底；
    // 正则后行断言也降不了，源码里不要用（legacy-webkit.test.ts 守着）。
    target: ["es2020", "safari14", "chrome87", "edge88", "firefox78"],
    cssTarget: ["safari14", "chrome87", "edge88", "firefox78"],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
});

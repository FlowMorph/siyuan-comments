// 构建脚本：把 src 打包成思源插件需要的 dist/index.js、index.css，并拷贝 plugin.json 等静态文件
import * as esbuild from "esbuild";
import {cpSync, mkdirSync} from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", {recursive: true});
for (const file of ["plugin.json", "README.md", "icon.png"]) {
    cpSync(file, `dist/${file}`);
}

const options = {
    entryPoints: {index: "src/index.ts"},
    bundle: true,
    outdir: "dist",
    format: "cjs",
    platform: "browser",
    target: "es2020",
    external: ["siyuan"],
    loader: {".css": "css"},
    logLevel: "info",
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
} else {
    await esbuild.build(options);
}

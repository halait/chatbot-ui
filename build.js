import * as esbuild from "esbuild";

const opts = {
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "public/bundle.js",
  platform: "browser",
  format: "esm",
  target: "es2023",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(opts);
  console.log("Build complete: public/bundle.js");
}

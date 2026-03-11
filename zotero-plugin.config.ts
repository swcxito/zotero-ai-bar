import { defineConfig } from "zotero-plugin-scaffold";
import stylePlugin from "esbuild-style-plugin";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      // JavaScript bundle
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
        // 代码压缩和体积优化 - 仅在生产环境中启用
        minify: process.env.NODE_ENV === "production",
        minifyWhitespace: process.env.NODE_ENV === "production",
        minifyIdentifiers: process.env.NODE_ENV === "production",
        minifySyntax: process.env.NODE_ENV === "production",
        // 启用 Tree Shaking（移除未使用的代码）
        treeShaking: true,
        // 代码分割以优化加载
        splitting: false,
        // 移除死代码
        ignoreAnnotations: false,
      },
      // CSS bundle with Tailwind
      {
        entryPoints: ["src/styles/app.css"],
        bundle: true,
        target: "firefox115",
        outdir: `.scaffold/build/addon/content`,
        plugins: [
          stylePlugin({
            postcss: {
              plugins: [
                tailwindcss,
                autoprefixer,
                ...(process.env.NODE_ENV === "production"
                  ? [
                      cssnano({
                        preset: [
                          "default",
                          {
                            discardComments: { removeAll: true },
                            normalizeDeclarations: true,
                            normalizeUnicode: true,
                          },
                        ],
                      }),
                    ]
                  : []),
              ],
            },
          }),
        ],
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "TRACE",
});

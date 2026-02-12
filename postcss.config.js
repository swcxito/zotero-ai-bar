/* global process */

export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    ...(process.env.NODE_ENV === "production" && {
      cssnano: {
        preset: [
          "default",
          {
            discardComments: {
              removeAll: true,
            },
            normalizeDeclarations: true,
            normalizeUnicode: true,
          },
        ],
      },
    }),
  },
};

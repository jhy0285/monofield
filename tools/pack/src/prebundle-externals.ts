// `@vue/compiler-sfc` carries a copy of `consolidate`, which `require`s these template
// engines only when a `<template lang="...">` block asks to be preprocessed. The daemon's
// code-ontology analyzers and the post-run check parse `.vue` files without preprocessing,
// so none of these packages is ever loaded and none is installed. They are left as
// externals so esbuild bundles the compiler without them: most do not resolve at all, and
// `react`/`react-dom` do resolve in the workspace but are forbidden in the daemon bundle.
//
// `lodash` is in consolidate's table too but stays bundled: esbuild treats an external
// package's subpaths as external as well, and `java-parser` imports `lodash/camelCase.js`.
export const VUE_SFC_TEMPLATE_ENGINE_EXTERNALS = [
  "atpl",
  "babel-core",
  "bracket-template",
  "coffee-script",
  "dot",
  "dustjs-linkedin",
  "eco",
  "ect",
  "ejs",
  "haml-coffee",
  "hamlet",
  "hamljs",
  "handlebars",
  "hogan.js",
  "htmling",
  "jazz",
  "jqtpl",
  "just",
  "liquor",
  "marko",
  "mote",
  "mustache",
  "nunjucks",
  "plates",
  "qejs",
  "ractive",
  "react",
  "react-dom",
  "slm",
  "squirrelly",
  "teacup/lib/express",
  "templayed",
  "toffee",
  "twig",
  "twing",
  "underscore",
  "vash",
  "velocityjs",
  "walrus",
  "whiskers",
] as const;

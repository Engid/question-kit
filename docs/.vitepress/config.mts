import { defineConfig } from "vitepress";

// bun run docs:dev  ·  bun run docs:build (output in docs/.vitepress/dist)  ·  bun run docs:preview
// Deployed to https://docs.questionkit.dev by Cloudflare on every push to main (see wrangler.jsonc).
export default defineConfig({
  title: "question-kit",
  description: "The standard library for System One models: ready-made methods built by measurement, an order taker, and a service agent you configure. Jev first.",
  cleanUrls: true,
  sitemap: { hostname: "https://docs.questionkit.dev" },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#F4EEE2" }],
    ["meta", { property: "og:title", content: "question-kit" }],
    ["meta", { property: "og:description", content: "The standard library for System One models. Built by measurement, not guesswork." }],
    ["meta", { property: "og:url", content: "https://docs.questionkit.dev" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;1,400&family=Barlow+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
    ],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/getting-started", activeMatch: "^/(getting-started|service-agent|pizza-shop|how-the-agent-decides|building-blocks)" },
      { text: "Tutorials", link: "/tutorials/triage", activeMatch: "^/tutorials/" },
      { text: "Python", link: "/python/", activeMatch: "^/python/" },
      { text: "questionkit.dev", link: "https://questionkit.dev" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "What it is", link: "/" },
          { text: "Getting started", link: "/getting-started" },
        ],
      },
      {
        text: "Tutorials",
        items: [
          { text: "Sort a support inbox", link: "/tutorials/triage" },
          { text: "Build a service agent", link: "/tutorials/service-agent" },
        ],
      },
      {
        text: "The service agent",
        items: [
          { text: "Building an agent", link: "/service-agent" },
          { text: "The pizza shop, step by step", link: "/pizza-shop" },
          { text: "How the agent decides", link: "/how-the-agent-decides" },
        ],
      },
      {
        text: "Underneath",
        items: [{ text: "The building blocks", link: "/building-blocks" }],
      },
      {
        text: "Python (preview)",
        items: [{ text: "question-kit for Python", link: "/python/" }],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/Engid/question-kit" },
      { icon: "npm", link: "https://www.npmjs.com/package/question-kit" },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    footer: {
      message: "MIT licensed. An alpha: please <a href=\"https://github.com/Engid/question-kit/issues\">tell us what breaks</a>.",
      copyright: "© 2026 Nick Gideo",
    },
  },
});

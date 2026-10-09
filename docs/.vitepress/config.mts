import { defineConfig } from "vitepress";

// bunx vitepress dev docs  ·  bunx vitepress build docs (output in docs/.vitepress/dist)
export default defineConfig({
  title: "question-kit",
  description: "Building kits for System One models. Jev first.",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "GitHub", link: "https://github.com/Engid/question-kit" },
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
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/Engid/question-kit" }],
    search: { provider: "local" },
  },
});

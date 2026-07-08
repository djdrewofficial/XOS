import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";

/* A call-to-action button as a first-class editor node. Renders email-safe
   inline-styled HTML (a centered anchor button) that both displays in the editor
   and serializes into body_html for sending. Atom = edited via the toolbar, not
   inline typing. */

type ButtonAttrs = { text: string; href: string; bg: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    emailButton: {
      setEmailButton: (attrs: { text: string; href: string; bg?: string }) => ReturnType;
    };
  }
}

export const EmailButton = Node.create({
  name: "emailButton",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      text: { default: "Button" },
      href: { default: "#" },
      bg: { default: "#4b328e" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-email-button]",
        getAttrs: (el) => {
          const a = (el as HTMLElement).querySelector("a");
          return {
            text: a?.textContent || "Button",
            href: a?.getAttribute("href") || "#",
            bg: (el as HTMLElement).getAttribute("data-bg") || "#4b328e",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { text, href, bg } = node.attrs as ButtonAttrs;
    return [
      "div",
      mergeAttributes({ "data-email-button": "", "data-bg": bg, style: "text-align:center;margin:18px 0;" }),
      [
        "a",
        {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          style: `display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:1;padding:13px 30px;border-radius:6px;`,
        },
        text,
      ],
    ] as DOMOutputSpec;
  },

  addCommands() {
    return {
      setEmailButton:
        (attrs: { text: string; href: string; bg?: string }) =>
        ({ chain }: CommandProps) =>
          chain()
            .insertContent({ type: this.name, attrs: { bg: "#4b328e", ...attrs } })
            .run(),
    };
  },
});

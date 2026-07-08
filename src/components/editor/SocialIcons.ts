import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";

/* A row of social icons as a first-class editor node. Icons are self-hosted in
   XOS (public/social/*.png) — never external image hosting. Only networks with a
   URL are rendered. Serializes to email-safe HTML that both displays in the
   editor and sends. */

type SocialAttrs = { facebook: string; instagram: string; tiktok: string; youtube: string };
const NETWORKS: (keyof SocialAttrs)[] = ["facebook", "instagram", "tiktok", "youtube"];
const ICON_ORIGIN = "https://xos.xpressdjs.com/social";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    socialIcons: {
      setSocialIcons: (attrs: Partial<SocialAttrs>) => ReturnType;
    };
  }
}

export const SocialIcons = Node.create({
  name: "socialIcons",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      facebook: { default: "" },
      instagram: { default: "" },
      tiktok: { default: "" },
      youtube: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-social-icons]",
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return {
            facebook: e.getAttribute("data-facebook") || "",
            instagram: e.getAttribute("data-instagram") || "",
            tiktok: e.getAttribute("data-tiktok") || "",
            youtube: e.getAttribute("data-youtube") || "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as SocialAttrs;
    const anchors = NETWORKS.filter((n) => attrs[n]).map((n) => [
      "a",
      { href: attrs[n], target: "_blank", rel: "noopener noreferrer", style: "display:inline-block;margin:0 5px;text-decoration:none;" },
      ["img", { src: `${ICON_ORIGIN}/${n}.png`, alt: n, width: "32", height: "32", style: "display:inline-block;width:32px;height:32px;border:0;" }],
    ]);
    return [
      "div",
      mergeAttributes({
        "data-social-icons": "",
        "data-facebook": attrs.facebook,
        "data-instagram": attrs.instagram,
        "data-tiktok": attrs.tiktok,
        "data-youtube": attrs.youtube,
        style: "text-align:center;margin:18px 0;",
      }),
      ...anchors,
    ] as DOMOutputSpec;
  },

  addCommands() {
    return {
      setSocialIcons:
        (attrs: Partial<SocialAttrs>) =>
        ({ chain }: CommandProps) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    };
  },
});

/**
 * Vision subagent prompts.
 *
 * Each prompt instructs a headless `claude -p` process to Read one cropped
 * screenshot and reply with ONE minified JSON object matching a spelled-out
 * schema. Prompts carry a compact DOM-derived context (text/roles the model
 * should keep — text content comes from the DOM per §22, the model only judges
 * appearance: colors, gradients, typography, spacing, layout).
 */

import type { ComponentIR, SectionIR } from "@bricks-cdp/ir";

type CompSummary = { styleRole?: string; type: string; level?: string; text?: string };

/** Flatten a section's component tree into a capped summary list. */
function summarizeComponents(children: ComponentIR[], cap = 30): CompSummary[] {
  const out: CompSummary[] = [];
  const walk = (list: ComponentIR[]) => {
    for (const c of list) {
      if (out.length >= cap) return;
      const s: CompSummary = { type: c.type };
      if (c.styleRole) s.styleRole = c.styleRole;
      if (c.level) s.level = c.level;
      if (c.text) s.text = c.text.slice(0, 60);
      out.push(s);
      if (c.children && c.children.length > 0) walk(c.children);
    }
  };
  walk(children);
  return out;
}

export function buildSectionPrompt(section: SectionIR, imagePath: string, url: string): string {
  const context = {
    id: section.id,
    type: section.type,
    layout: section.layout,
    box: section.box,
    style: section.style || {},
    components: summarizeComponents(section.children),
  };
  const contextJson = JSON.stringify(context).slice(0, 2500);

  return [
    `You are a precise UI vision analyst. Use your Read tool to open this image: ${imagePath.replace(/\\/g, "/")}`,
    ``,
    `The image is a screenshot crop of ONE section of the web page ${url}. Below is what our DOM analyzer already extracted for this section (text content is authoritative — do NOT re-transcribe text). Your job is to report ONLY the VISUAL appearance the pixels show, so we can rebuild it faithfully.`,
    ``,
    `Section context:`,
    contextJson,
    ``,
    `Reply with ONLY one minified JSON object (no markdown fences, no prose) with this exact schema; OMIT any field you are not confident about:`,
    `{`,
    `"sectionId":"${section.id}",`,
    `"background":{"kind":"solid|gradient|image","color":"#rrggbb","gradientCss":"linear-gradient(135deg, #ff0080 0%, #7928ca 100%)","imageUrl":"https://..."},`,
    `"textColor":"#rrggbb",`,
    `"layout":{"type":"one-column|two-column|three-card-grid|grid|centered","columns":3,"columnGapPx":24,"rowGapPx":24,"alignItems":"flex-start|center|flex-end|stretch","justifyContent":"flex-start|center|flex-end|space-between","contentMaxWidthPx":1200,"paddingTopPx":80,"paddingBottomPx":80,"textAlign":"left|center|right"},`,
    `"typography":{"<styleRole or 'body'>":{"fontSizePx":48,"fontWeight":700,"lineHeight":1.1,"letterSpacingPx":0,"color":"#rrggbb","textAlign":"left|center|right","textTransform":"none|uppercase|lowercase|capitalize"}},`,
    `"buttons":[{"textStartsWith":"Get","backgroundColor":"#rrggbb","color":"#rrggbb","radiusPx":8,"borderColor":"#rrggbb","borderWidthPx":1,"paddingXPx":24,"paddingYPx":12,"fontSizePx":16,"fontWeight":600}],`,
    `"fixes":[{"match":{"type":"image","textStartsWith":"","styleRole":"","nth":1},"action":"drop|restyle","style":{"color":"#rrggbb"}}],`,
    `"notes":["short observation"],`,
    `"confidence":0.9`,
    `}`,
    ``,
    `Rules:`,
    `- Colors: 6-digit hex only (e.g. #0b0b1f). Report the ACTUAL rendered color, not a guess.`,
    `- background.kind: "gradient" ONLY if a real gradient is visible; give a valid CSS linear-gradient/radial-gradient with hex stops (<=300 chars). "image" only if a photographic/background image fills the section; give its URL only if you can infer it, else use kind "solid" with the dominant color.`,
    `- typography keys: use ONLY styleRoles present in the components list above, plus "body" for ordinary paragraph text. Report font-size in px as rendered.`,
    `- buttons: match by the visible label via textStartsWith. Report the pill/rounded radius and fill/stroke colors exactly.`,
    `- fixes: use action "drop" for elements that visibly do NOT belong (duplicated logo-marquee items, stray fragments, decorative slivers). Use "restyle" sparingly for a clearly wrong color.`,
    `- Integers for all px values. Only report what is VISIBLY true. When unsure, omit the field entirely.`,
  ].join("\n");
}

export function buildGlobalPrompt(imagePath: string, url: string): string {
  return [
    `You are a precise UI vision analyst. Use your Read tool to open this image: ${imagePath.replace(/\\/g, "/")}`,
    ``,
    `It is a downscaled full-page screenshot of ${url}. Report the page's GLOBAL visual theme.`,
    ``,
    `Reply with ONLY one minified JSON object (no fences, no prose); omit fields you are unsure about:`,
    `{"fontFamily":"Inter","fontStack":"Inter, -apple-system, Segoe UI, sans-serif","primaryColor":"#rrggbb","backgroundColor":"#rrggbb","textColor":"#rrggbb","mutedTextColor":"#rrggbb","radiusPx":12,"mode":"light|dark","notes":["short"]}`,
    ``,
    `Rules:`,
    `- fontFamily: your best single-name guess of the primary UI typeface by its letterforms (e.g. Inter, Roboto, Helvetica, Georgia, system-ui). fontStack: a reasonable CSS fallback stack starting with that font.`,
    `- primaryColor: the dominant brand/accent color (buttons, links, highlights).`,
    `- backgroundColor/textColor/mutedTextColor: the page's base surface and body text colors.`,
    `- radiusPx: typical corner radius of cards/buttons. mode: overall light or dark.`,
    `- 6-digit hex only. Integers for px.`,
  ].join("\n");
}

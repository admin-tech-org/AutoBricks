/**
 * Shared type contract for the whole pipeline.
 *
 * Data flow (per ARCHITECTURE.md):
 *   URL -> CaptureResult (screenshots + dom.json + css.json + layout.json + assets.json)
 *       -> VisionAnalysis (screenshot-level understanding)
 *       -> PageIR (merged, normalized intermediate representation)
 *       -> BricksTemplate (flat content array)
 *       -> ValidationReport
 */

// ---------------------------------------------------------------------------
// Geometry / viewports
// ---------------------------------------------------------------------------

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViewportName = "desktop" | "tablet" | "mobile";

export const VIEWPORT_SIZES: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

/** The viewport whose DOM/CSS/layout snapshots drive IR generation. */
export const PRIMARY_VIEWPORT: ViewportName = "desktop";

// ---------------------------------------------------------------------------
// Capture layer snapshots (storage/snapshots/<jobId>/*.json)
// ---------------------------------------------------------------------------

export type DomNode = {
  /** Stable id assigned during extraction, e.g. "dom_101". */
  id: string;
  /** Parent DomNode id, null for the root (body). */
  parentId: string | null;
  tag: string;
  /** Direct text content (own text, not descendants), trimmed. */
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  ariaLabel?: string;
  role?: string;
  className?: string;
  domId?: string;
  /** Depth in the DOM tree, body = 0. */
  depth: number;
  /** Bounding box in page coordinates (also mirrored in LayoutSnapshot). */
  box: Box;
  /** True if element is visible (non-zero box, not display:none/visibility:hidden). */
  visible: boolean;
};

export type DomSnapshot = {
  url: string;
  viewport: ViewportName;
  title?: string;
  nodes: DomNode[];
};

/** Computed CSS per DomNode id, whitelisted properties only (see ARCHITECTURE §6). */
export type CssSnapshot = {
  viewport: ViewportName;
  /** nodeId -> { display, position, width, ..., borderRadius } camelCase values. */
  styles: Record<string, Record<string, string>>;
};

export type LayoutSnapshot = {
  viewport: ViewportName;
  pageWidth: number;
  pageHeight: number;
  /** nodeId -> bounding box in page coordinates. */
  boxes: Record<string, Box>;
};

export type AssetType = "image" | "background-image" | "svg" | "font";

export type AssetItem = {
  type: AssetType;
  url: string;
  nodeId?: string;
  alt?: string;
};

export type AssetsSnapshot = {
  url: string;
  assets: AssetItem[];
};

export type CaptureOptions = {
  url: string;
  jobId: string;
  /** Absolute storage root (defaults to <repo>/storage). */
  storageRoot: string;
  viewports?: ViewportName[];
  /** "networkidle" | "load" | "domcontentloaded" */
  waitStrategy?: "networkidle" | "load" | "domcontentloaded";
  timeoutMs?: number;
  /** Scroll through the page first to trigger lazy loading. Default true. */
  scrollPage?: boolean;
  /** Try to dismiss common cookie/modal overlays. Default true. */
  dismissOverlays?: boolean;
  /** DOM node cap for extraction (default DEFAULT_MAX_NODES = 4000). Raise for
   *  dense pages captured in structural layout mode. */
  maxNodes?: number;
};

export type ScreenshotSet = {
  /** Absolute file paths. fullPage is the full-page shot of the primary viewport. */
  desktop?: string;
  tablet?: string;
  mobile?: string;
  fullPage?: string;
};

export type CaptureResult = {
  jobId: string;
  url: string;
  screenshots: ScreenshotSet;
  /** Snapshots of the primary (desktop) viewport. */
  dom: DomSnapshot;
  css: CssSnapshot;
  layout: LayoutSnapshot;
  assets: AssetsSnapshot;
  /** Layout snapshot of the mobile viewport (for responsive/stacking detection), if captured. */
  mobileLayout?: LayoutSnapshot;
  /** Absolute paths of everything written to disk. */
  savedPaths: {
    screenshots: ScreenshotSet;
    dom: string;
    css: string;
    layout: string;
    assets: string;
  };
};

// ---------------------------------------------------------------------------
// Vision analyzer output (ARCHITECTURE §8)
// ---------------------------------------------------------------------------

export type VisionTheme = {
  style?: string;
  mode?: "light" | "dark";
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: string;
  fontStyle?: string;
};

export type VisionSection = {
  /** e.g. "visual_sec_hero" */
  id: string;
  /** "hero" | "features" | "pricing" | "testimonial" | "cta" | "footer" | "header" | "content" ... */
  type: string;
  /** "one-column" | "two-column" | "three-card-grid" | "grid" | "centered" ... */
  layout: string;
  box?: Box;
  confidence: number;
};

export type VisionAnalysis = {
  pageType: string;
  theme: VisionTheme;
  sections: VisionSection[];
};

// ---------------------------------------------------------------------------
// Vision AI (ARCHITECTURE §8 upgrade — AI vision model refines the heuristic
// analysis; §22 source priority: Color/Theme style = screenshot, so the AI —
// which reads rendered pixels — may override heuristic colors/spacing).
// All fields optional/additive: heuristic-only pipelines ignore them.
// ---------------------------------------------------------------------------

/** How a section's background actually renders (from AI reading the pixels). */
export type VisionAIBackground = {
  kind: "solid" | "gradient" | "image";
  /** "#rrggbb" — required for kind "solid", fallback for the others. */
  color?: string;
  /** Full CSS gradient, e.g. "linear-gradient(135deg, #ff0080 0%, #7928ca 100%)". */
  gradientCss?: string;
  imageUrl?: string;
};

export type VisionAITypography = {
  fontSizePx?: number;
  fontWeight?: number;
  /** Unitless ratio, e.g. 1.2 */
  lineHeight?: number;
  letterSpacingPx?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
};

export type VisionAIButtonStyle = {
  /** Match target button by its label prefix (case-insensitive). Omit = all buttons in section. */
  textStartsWith?: string;
  backgroundColor?: string;
  color?: string;
  radiusPx?: number;
  borderColor?: string;
  borderWidthPx?: number;
  paddingXPx?: number;
  paddingYPx?: number;
  fontSizePx?: number;
  fontWeight?: number;
};

export type VisionAIComponentFix = {
  match: { type?: string; textStartsWith?: string; styleRole?: string; nth?: number };
  action: "restyle" | "drop";
  /** CSS-ish style record merged into the matched component's IR style. */
  style?: Record<string, string>;
};

/** Layout corrections a vision model reports for one section. */
export type VisionAILayoutHints = {
  /** "one-column" | "two-column" | "three-card-grid" | "grid" | "centered" */
  type?: string;
  columns?: number;
  columnGapPx?: number;
  rowGapPx?: number;
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between";
  contentMaxWidthPx?: number;
  paddingTopPx?: number;
  paddingBottomPx?: number;
  textAlign?: "left" | "center" | "right";
};

export type VisionAISectionResult = {
  sectionId: string;
  background?: VisionAIBackground;
  /** Dominant body-text color inside the section ("#rrggbb"). */
  textColor?: string;
  layout?: VisionAILayoutHints;
  /** Keyed by styleRole ("hero-title", "section-title", "card-title", "card-text", "nav-link", "body"...). */
  typography?: Record<string, VisionAITypography>;
  buttons?: VisionAIButtonStyle[];
  fixes?: VisionAIComponentFix[];
  notes?: string[];
  confidence?: number;
};

export type VisionAIGlobalResult = {
  /** Primary font family guess as rendered (e.g. "Inter"). */
  fontFamily?: string;
  /** Full CSS stack fallback, e.g. "Inter, -apple-system, sans-serif". */
  fontStack?: string;
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  radiusPx?: number;
  mode?: "light" | "dark";
  notes?: string[];
};

export type VisionAITaskInfo = {
  id: string;
  kind: "section" | "global";
  sectionId?: string;
  status: "ok" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
};

export type VisionAIReport = {
  jobId: string;
  backend: "claude-cli";
  model: string;
  concurrency: number;
  tasks: VisionAITaskInfo[];
  global?: VisionAIGlobalResult;
  sections: VisionAISectionResult[];
  createdAt: string;
};

/** Analyze-stage vision configuration (StageContext.vision). */
export type VisionOptions = {
  mode: "heuristic" | "ai";
  /** Model passed to the claude CLI (default "sonnet"). */
  model?: string;
  /** Parallel vision subagents (default 4). */
  concurrency?: number;
  /** Per-call timeout in ms (default 120000). */
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Page IR (ARCHITECTURE §11 — keep field names exactly as specified)
// ---------------------------------------------------------------------------

export type ThemeIR = {
  style?: string;
  mode?: "light" | "dark";
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  fontFamily?: string;
  radius?: string;
  sectionPaddingY?: string;
  containerMaxWidth?: string;
};

/**
 * Flex layout of a reconstructed container (structural layout mode). Carried on
 * "block" ComponentIRs so the planner can emit the source's real nested flex
 * structure (row/column/grid) instead of re-guessing from a single label.
 * Optional and additive — the heuristic path never sets it and ignores it.
 */
export type LayoutBox = {
  direction: "row" | "column";
  /** Wrap onto multiple lines (a grid). Only meaningful with direction "row". */
  wrap?: boolean;
  columnGap?: number;
  rowGap?: number;
  alignItems?: string;
  justifyContent?: string;
};

export type ComponentIR = {
  id: string;
  /** "heading" | "text" | "button" | "image" | "icon" | "divider" | "block" ... */
  type: string;
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
  level?: "h1" | "h2" | "h3" | "h4";
  styleRole?: string;
  box?: Box;
  style?: Record<string, string>;
  /** Flex layout for reconstructed container blocks (structural mode). */
  layout?: LayoutBox;
  /** This node's width as a fraction (0..1) of its parent's width — set on the
   *  children of a reconstructed row/grid so the planner can pin flex widths. */
  widthPct?: number;
  /** Nested children (e.g. a card block containing heading + text). */
  children?: ComponentIR[];
};

export type SectionIR = {
  id: string;
  type: string;
  layout: string;
  visualRole?: string;
  box?: Box;
  children: ComponentIR[];
  confidence?: number;
  /** Section-level style hints (background-color, padding...). */
  style?: Record<string, string>;
  /** Vision-AI layout corrections (gaps, columns, alignment) for the planner. */
  layoutHints?: VisionAILayoutHints;
};

export type PageIR = {
  url: string;
  pageType: string;
  theme: ThemeIR;
  sections: SectionIR[];
};

// ---------------------------------------------------------------------------
// Bricks output (ARCHITECTURE §14 — flat content array)
// ---------------------------------------------------------------------------

export type BricksElement = {
  id: string;
  name: string;
  parent: string | 0;
  children: string[];
  settings: Record<string, unknown>;
};

export type BricksTemplate = {
  content: BricksElement[];
  source: "cdpVisualGenerated";
  sourceUrl?: string;
  version?: string;
  /** Template display name in the Bricks template library after import. */
  name?: string;
  /** Bricks template type; "content" = a regular page-content template. */
  templateType?: string;
  /**
   * Design-system CSS for this page. Also embedded in the first element's
   * `_cssCustom` (so it travels with a template import); exposed here for
   * direct-write flows that write page-settings customCss instead.
   */
  customCss?: string;
};

export const ALLOWED_ELEMENTS = [
  "section",
  "container",
  "block",
  "heading",
  "text-basic",
  "text",
  "button",
  "image",
  "icon",
  "divider",
] as const;

export type AllowedElementName = (typeof ALLOWED_ELEMENTS)[number];

export type JsonValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Validation report (README "Validation" section)
// ---------------------------------------------------------------------------

export type ValidationReport = {
  score: number;
  layoutScore: number;
  colorScore: number;
  spacingScore: number;
  contentScore: number;
  warnings: string[];
};

export type AnalysisReport = {
  jobId: string;
  url: string;
  pageType: string;
  /** Which analyzer produced this report ("heuristic" when vision AI is off/failed). */
  visionMode?: "heuristic" | "ai";
  theme: ThemeIR;
  sections: Array<{
    id: string;
    type: string;
    layout: string;
    box?: Box;
    confidence?: number;
    componentCount: number;
  }>;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Jobs / pipeline stages (ARCHITECTURE §4, §5, §18)
// ---------------------------------------------------------------------------

export type JobStatus =
  | "queued"
  | "capturing"
  | "analyzing"
  | "generating"
  | "validating"
  | "exporting"
  | "done"
  | "failed";

export type JobMode = "landing-page" | "page" | "section";

export type JobRequest = {
  url: string;
  mode?: JobMode;
  viewports?: ViewportName[];
  output?: "bricks-json" | "bricks-zip";
};

export type JobRecord = {
  id: string;
  url: string;
  status: JobStatus;
  mode: JobMode;
  created_at: string;
  updated_at: string;
  error_message: string | null;
};

export type CaptureRecord = {
  id: string;
  job_id: string;
  viewport: ViewportName | "full-page";
  screenshot_path: string;
  dom_snapshot_path: string | null;
  css_snapshot_path: string | null;
  layout_snapshot_path: string | null;
  created_at: string;
};

export type AnalysisReportRecord = {
  id: string;
  job_id: string;
  page_type: string;
  theme_json: string;
  sections_json: string;
  confidence_json: string;
  created_at: string;
};

export type GeneratedTemplateRecord = {
  id: string;
  job_id: string;
  json_path: string;
  zip_path: string | null;
  bricks_json: string;
  validation_score: number | null;
  created_at: string;
};

export type AssetRecord = {
  id: string;
  job_id: string;
  original_url: string;
  local_path: string | null;
  wordpress_attachment_id: number | null;
  type: AssetType;
  status: "pending" | "downloaded" | "uploaded" | "remote" | "failed";
};

/**
 * Layout planning mode:
 *  - "heuristic"  (default) — sections classified to a coarse layout label, then
 *    rebuilt by the label-specific planners. Fast, tuned for landing pages.
 *  - "structural" — the DOM's real nested container tree is reconstructed from
 *    box geometry + computed flex CSS and emitted faithfully. For复刻 of complex
 *    pages (multi-column grids, mega-nav) that the label path collapses.
 */
export type LayoutMode = "heuristic" | "structural";

/** Context passed to every worker stage. */
export type StageContext = {
  jobId: string;
  url: string;
  mode: JobMode;
  viewports: ViewportName[];
  storageRoot: string;
  /** Analyze-stage vision configuration (default: heuristic-only). */
  vision?: VisionOptions;
  /** Layout planning mode (default: "heuristic"). */
  layoutMode?: LayoutMode;
  /** Override the capture-stage DOM node cap (default DEFAULT_MAX_NODES = 4000). */
  maxNodes?: number;
};

export type AnalysisResult = {
  vision: VisionAnalysis;
  pageIR: PageIR;
  report: AnalysisReport;
  savedPaths: { pageIR: string; analysisReport: string; visionAIReport?: string };
};

export type GenerateResult = {
  template: BricksTemplate;
  jsonValidation: JsonValidationResult;
  savedPaths: { templateJson: string; templateZip: string };
};

export type ValidateResult = {
  report: ValidationReport;
  savedPaths: { validationReport: string; previewHtml?: string; previewScreenshot?: string; diffImage?: string };
};

import resourceManifest from "../../../rulesets/v1.3.4/resources.json";

type ResourceEntry = {
  resourceKey: string;
  entityId: string;
  assetPath: string | null;
  fallbackResourceKey: string | null;
};

const entries = new Map(
  (resourceManifest.items as ResourceEntry[]).map((item) => [item.resourceKey, item]),
);
const entriesByEntityId = new Map(
  (resourceManifest.items as ResourceEntry[]).map((item) => [item.entityId, item]),
);

function assetUrl(assetPath: string): string {
  const relativePath = assetPath.replace(/^assets\//, "");
  return `/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function placeholder(label: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#183345"/><stop offset="1" stop-color="#08131c"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="235" r="92" fill="${accent}" opacity=".32"/><path d="M235 505c20-112 88-168 165-168s145 56 165 168" fill="${accent}" opacity=".22"/><text x="400" y="555" text-anchor="middle" fill="#b9d2dc" font-family="sans-serif" font-size="34">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const categoryFallbacks: Record<string, string> = {
  character: placeholder("角色图待补", "#70d0d1"),
  basic: placeholder("基础牌待补", "#d7e1e7"),
  weapon: placeholder("武器图待补", "#e4a85d"),
  equipment: placeholder("装备图待补", "#8fbbdf"),
};
const genericFallback = placeholder("图片待补", "#758c9a");

function categoryOf(resourceKey: string): string {
  if (resourceKey.startsWith("character.")) return "character";
  const parts = resourceKey.split(".");
  return parts[1] ?? parts[0] ?? "generic";
}

export function resolveResourceCandidates(resourceKey: string): string[] {
  const candidates: string[] = [];
  const visited = new Set<string>();
  let currentKey: string | null = resourceKey;

  while (currentKey && !visited.has(currentKey)) {
    visited.add(currentKey);
    const entityAlias: string = currentKey.endsWith(".portrait") ? currentKey.slice(0, -".portrait".length) : currentKey;
    const entry: ResourceEntry | undefined = entries.get(currentKey) ?? entriesByEntityId.get(entityAlias);
    if (!entry) break;
    if (entry.assetPath) candidates.push(assetUrl(entry.assetPath));
    currentKey = entry.fallbackResourceKey;
  }

  candidates.push(categoryFallbacks[categoryOf(resourceKey)] ?? genericFallback, genericFallback);
  return [...new Set(candidates)];
}

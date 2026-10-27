import type { MetadataRoute } from "next";
import { LANDING_LANGS, LANDING_PATHS, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    Object.entries(LANDING_LANGS)
      .filter(([lang]) => lang !== "x-default")
      .map(([lang, path]) => [lang, `${SITE_URL}${path}`]),
  );
  return [
    ...Object.values(LANDING_PATHS).map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "monthly" as const,
      priority: 1,
      alternates: { languages },
    })),
    { url: `${SITE_URL}/`, changeFrequency: "monthly" as const, priority: 0.5 },
    { url: `${SITE_URL}/integritet`, changeFrequency: "yearly" as const, priority: 0.2 },
  ];
}

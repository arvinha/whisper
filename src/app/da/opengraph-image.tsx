import { OG_SIZE, OG_TEXT, ogImage } from "@/components/OgImage";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = OG_TEXT.da.alt;

export default function OpengraphImage() {
  return ogImage("da");
}

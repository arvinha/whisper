import { Landing, landingMetadata } from "@/components/Landing";

export const metadata = landingMetadata("en");

export default function Page() {
  return <Landing lang="en" />;
}

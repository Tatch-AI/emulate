import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata("deepgram");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

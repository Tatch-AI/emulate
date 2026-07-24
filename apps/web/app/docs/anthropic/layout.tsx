import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata("anthropic");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
